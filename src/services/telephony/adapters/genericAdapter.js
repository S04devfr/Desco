const BaseTelephonyAdapter = require('../baseAdapter');

/**
 * Universal Generic Provider Adapter
 * Handles standard JSON HTTP webhooks from standard VoIP/SIP gateways.
 */
class GenericTelephonyAdapter extends BaseTelephonyAdapter {
  constructor() {
    super('generic');
  }

  normalizeWebhookPayload(body = {}) {
    const callId = body.callId || body.call_id || body.uuid || `call_${Date.now()}`;
    const rawType = (body.event || body.type || body.direction || 'incoming').toLowerCase();
    const rawStatus = (body.status || 'answered').toLowerCase();

    let event = 'incoming';
    let direction = 'incoming';
    let status = 'answered';

    if (rawType.includes('out') || rawType === 'outgoing') {
      direction = 'outgoing';
    }

    if (rawStatus.includes('miss') || rawStatus === 'noanswer' || rawType.includes('miss')) {
      status = 'missed';
      event = 'missed';
    } else if (rawStatus.includes('busy')) {
      status = 'busy';
      event = 'failed';
    } else if (rawStatus.includes('reject')) {
      status = 'rejected';
      event = 'failed';
    } else if (rawStatus.includes('fail') || rawStatus === 'error') {
      status = 'failed';
      event = 'failed';
    } else if (rawStatus.includes('ring')) {
      status = 'ringing';
      event = 'incoming';
    } else {
      status = 'answered';
      event = 'completed';
    }

    return {
      callId: String(callId),
      event,
      direction,
      fromNumber: String(body.from || body.fromNumber || body.caller_id || 'Noma\'lum'),
      toNumber: String(body.to || body.toNumber || body.callee_id || '101'),
      duration: parseInt(body.duration || body.billsec || 0),
      status,
      recordingUrl: body.recordingUrl || body.recording_url || body.record_file || null,
      notes: body.notes || body.description || null,
      startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
      answeredAt: body.answeredAt ? new Date(body.answeredAt) : null,
      endedAt: body.endedAt ? new Date(body.endedAt) : null,
      raw: body
    };
  }

  async initiateCall({ fromExtension, toNumber, managerId }) {
    // Isolated provider trigger (Generic REST API call placeholder)
    return {
      success: true,
      callId: `outbound_${Date.now()}`,
      status: 'dialing',
      provider: this.name
    };
  }

  async hangupCall({ callId }) {
    return {
      success: true,
      callId,
      status: 'completed',
      provider: this.name
    };
  }
}

module.exports = GenericTelephonyAdapter;
