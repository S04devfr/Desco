const BaseTelephonyAdapter = require('../baseAdapter');

/**
 * Mock Telephony Adapter
 * Used for development, local testing, and automated integration test suite.
 */
class MockTelephonyAdapter extends BaseTelephonyAdapter {
  constructor() {
    super('mock');
  }

  normalizeWebhookPayload(body = {}) {
    const callId = body.callId || `mock_call_${Date.now()}`;
    return {
      callId: String(callId),
      event: body.event || 'completed',
      direction: body.direction || 'incoming',
      fromNumber: String(body.fromNumber || '+998901234567'),
      toNumber: String(body.toNumber || '101'),
      duration: parseInt(body.duration || 45),
      status: body.status || 'answered',
      recordingUrl: body.recordingUrl || 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      notes: body.notes || 'Mock test qo\'ng\'irog\'i',
      startedAt: body.startedAt ? new Date(body.startedAt) : new Date(Date.now() - 45000),
      answeredAt: body.answeredAt ? new Date(body.answeredAt) : new Date(Date.now() - 40000),
      endedAt: body.endedAt ? new Date(body.endedAt) : new Date(),
      raw: body
    };
  }

  async initiateCall({ fromExtension, toNumber, managerId }) {
    return {
      success: true,
      callId: `mock_outbound_${Date.now()}`,
      status: 'dialing',
      fromNumber: fromExtension || '101',
      toNumber,
      provider: 'mock'
    };
  }

  async hangupCall({ callId }) {
    return {
      success: true,
      callId,
      status: 'completed',
      provider: 'mock'
    };
  }
}

module.exports = MockTelephonyAdapter;
