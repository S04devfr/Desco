const BaseTelephonyAdapter = require('../baseAdapter');

/**
 * OnlinePBX / Asterisk SIP Adapter
 */
class OnlinePbxTelephonyAdapter extends BaseTelephonyAdapter {
  constructor() {
    super('onlinepbx');
  }

  normalizeWebhookPayload(body = {}) {
    const callId = body.call_id || body.uuid || `onlinepbx_${Date.now()}`;
    const rawType = (body.event || body.type || 'incoming').toLowerCase();
    
    let direction = body.direction === 'out' ? 'outgoing' : 'incoming';
    let status = 'answered';

    if (rawType.includes('hangup') || rawType.includes('end')) {
      status = body.duration > 0 ? 'answered' : 'missed';
    } else if (rawType.includes('miss')) {
      status = 'missed';
    }

    return {
      callId: String(callId),
      event: status === 'missed' ? 'missed' : 'completed',
      direction,
      fromNumber: String(body.from_number || body.caller || 'Noma\'lum'),
      toNumber: String(body.to_number || body.callee || '101'),
      duration: parseInt(body.duration || body.talk_time || 0),
      status,
      recordingUrl: body.download_url || body.recording || null,
      notes: body.comment || null,
      startedAt: body.start_time ? new Date(body.start_time * 1000) : new Date(),
      endedAt: new Date(),
      raw: body
    };
  }

  async initiateCall({ fromExtension, toNumber }) {
    return {
      success: true,
      callId: `opbx_${Date.now()}`,
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

module.exports = OnlinePbxTelephonyAdapter;
