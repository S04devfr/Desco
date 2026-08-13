const prisma = require('../../config/database');
const TelephonyProviderFactory = require('./providerFactory');
const config = require('./config');

// In-Memory Webhook Deduplication / Idempotency Cache (expires in 10 minutes)
const idempotencyCache = new Map();

function isDuplicateWebhook(callId, event) {
  if (!callId) return false;
  const key = `${callId}:${event || 'all'}`;
  if (idempotencyCache.has(key)) {
    return true;
  }
  idempotencyCache.set(key, Date.now());
  
  // Cleanup entries older than 10 mins
  if (idempotencyCache.size > 1000) {
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    for (const [k, ts] of idempotencyCache.entries()) {
      if (ts < tenMinAgo) idempotencyCache.delete(k);
    }
  }
  return false;
}

/**
 * Structured Telephony Security & Audit Logger
 */
function logTelephonyEvent(action, meta = {}) {
  const safeMeta = { ...meta };
  // Redact secrets/passwords if present
  delete safeMeta.password;
  delete safeMeta.secret;
  delete safeMeta.token;
  
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'telephony',
    action: `telephony.${action}`,
    ...safeMeta
  }));
}

class TelephonyService {
  /**
   * Automatic Customer Matching Engine
   * Searches Client & Contact databases for caller phone number.
   */
  static async matchCustomerByPhone(phoneNumber) {
    if (!phoneNumber) return null;
    const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
    if (!cleanPhone || cleanPhone.length < 6) return null;

    try {
      // 1. Search in Client model
      const client = await prisma.client.findFirst({
        where: {
          OR: [
            { phone: { contains: cleanPhone } },
            { companyPhone: { contains: cleanPhone } }
          ]
        }
      });
      if (client) return { type: 'client', record: client, id: client.id, name: client.name };

      // 2. Search in Deal model (via client phone or driverPhone)
      const deal = await prisma.deal.findFirst({
        where: {
          OR: [
            { driverPhone: { contains: cleanPhone } },
            { client: { phone: { contains: cleanPhone } } },
            { client: { companyPhone: { contains: cleanPhone } } }
          ]
        },
        include: { client: true }
      });
      if (deal) {
        return {
          type: 'deal',
          record: deal,
          id: deal.clientId || null,
          dealId: deal.id,
          name: deal.client?.name || deal.productName || deal.title || `Sdelka #${deal.id}`
        };
      }

      return null;
    } catch (e) {
      console.error('[Telephony Service] Customer Match Error:', e.message);
      return null;
    }
  }

  /**
   * Process Incoming Webhook Event with Provider Adapter & Customer Matching
   */
  static async processWebhook(req, providerOverride = null) {
    const adapter = TelephonyProviderFactory.getAdapter(providerOverride || config.provider);

    // 1. Webhook Signature Verification
    if (config.signatureValidationEnabled && config.webhookSecret) {
      const isValid = adapter.verifyWebhookSignature(req, config.webhookSecret);
      if (!isValid) {
        logTelephonyEvent('webhook.failed', { reason: 'invalid_signature' });
        throw new Error('Invalid Webhook Signature');
      }
    }

    // 2. Payload Normalization
    const normalized = adapter.normalizeWebhookPayload(req.body);
    logTelephonyEvent('webhook.received', { callId: normalized.callId, event: normalized.event });

    // 3. Deduplication Check
    if (isDuplicateWebhook(normalized.callId, normalized.event)) {
      logTelephonyEvent('webhook.duplicate_ignored', { callId: normalized.callId });
      return { success: true, duplicate: true };
    }

    // 4. Customer Matching
    const phoneToMatch = normalized.direction === 'outgoing' ? normalized.toNumber : normalized.fromNumber;
    const match = await this.matchCustomerByPhone(phoneToMatch);

    // 5. Find Operator / Manager by SIP extension
    let managerId = null;
    if (normalized.toNumber) {
      const managerUser = await prisma.user.findFirst({
        where: {
          OR: [
            { id: parseInt(normalized.toNumber) || 0 },
            { name: { contains: normalized.toNumber, mode: 'insensitive' } }
          ]
        }
      }).catch(() => null);
      if (managerUser) managerId = managerUser.id;
    }

    // 6. Upsert Call Log Record
    let callLog;
    if (normalized.callId) {
      callLog = await prisma.callLog.upsert({
        where: { callId: normalized.callId },
        update: {
          type: normalized.direction,
          status: normalized.status,
          duration: normalized.duration,
          recordingUrl: normalized.recordingUrl || undefined,
          notes: normalized.notes || undefined,
          endedAt: normalized.endedAt || new Date()
        },
        create: {
          callId: normalized.callId,
          provider: adapter.name,
          type: normalized.direction,
          fromNumber: normalized.fromNumber,
          toNumber: normalized.toNumber,
          clientName: match ? match.name : (normalized.direction === 'incoming' ? 'Kiruvchi (Noma\'lum)' : 'Chiquvchi'),
          duration: normalized.duration,
          status: normalized.status,
          recordingUrl: normalized.recordingUrl,
          notes: normalized.notes,
          sipExtension: normalized.toNumber,
          managerId,
          clientId: match ? match.id : null,
          dealId: match ? match.dealId : null,
          startedAt: normalized.startedAt || new Date()
        }
      }).catch(err => {
        console.error('[Telephony Service] Upsert Error:', err.message);
        return null;
      });
    }

    // 7. Emit Realtime Broadcast Event
    const broadcast = req.app?.get('broadcast');
    if (broadcast && callLog) {
      broadcast({
        type: normalized.event === 'incoming' ? 'incoming_call' : 'call_updated',
        callLog
      });
    }

    logTelephonyEvent(`call.${normalized.event}`, { callId: normalized.callId, status: normalized.status });
    return { success: true, callLog };
  }

  /**
   * Initiate Outbound Call
   */
  static async initiateOutboundCall({ phoneNumber, clientName, dealId, clientId, managerId, providerOverride }) {
    const adapter = TelephonyProviderFactory.getAdapter(providerOverride || config.provider);

    logTelephonyEvent('call.initiated', { phoneNumber, managerId });

    // Customer matching if not passed
    let client = null;
    if (clientId) {
      client = await prisma.client.findUnique({ where: { id: Number(clientId) } }).catch(() => null);
    } else {
      const match = await this.matchCustomerByPhone(phoneNumber);
      if (match && match.record) client = match.record;
    }

    // Provider trigger
    const providerResult = await adapter.initiateCall({
      fromExtension: '101',
      toNumber: phoneNumber,
      managerId
    });

    const callLog = await prisma.callLog.create({
      data: {
        callId: providerResult.callId || `outbound_${Date.now()}`,
        provider: adapter.name,
        type: 'outgoing',
        fromNumber: '101',
        toNumber: phoneNumber,
        clientName: clientName || client?.name || 'Noma\'lum mijoz',
        duration: 0,
        status: 'dialing',
        notes: 'Terilmoqda...',
        sipExtension: '101',
        managerId: managerId || null,
        clientId: client ? client.id : null,
        dealId: dealId ? Number(dealId) : null,
        startedAt: new Date()
      }
    });

    return { success: true, callLog, providerResult };
  }
}

module.exports = TelephonyService;
