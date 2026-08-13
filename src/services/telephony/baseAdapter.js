/**
 * Abstract Telephony Provider Adapter Interface
 * All concrete provider adapters (OnlinePBX, Zadarma, Asterisk, Generic, Mock) extend this class.
 * This guarantees SOLID design & Strategy Pattern compliance.
 */

class BaseTelephonyAdapter {
  constructor(name) {
    this.name = name || 'generic';
  }

  /**
   * Verify webhook signature if secret key is present.
   * @param {Object} req - Express request object
   * @param {String} secret - Shared secret key
   * @returns {Boolean}
   */
  verifyWebhookSignature(req, secret) {
    if (!secret) return true; // If secret is not set, skip check
    const signature = req.headers['x-telephony-signature'] || req.headers['x-signature'] || req.query.signature;
    if (!signature) return false;
    return signature === secret;
  }

  /**
   * Normalize incoming provider webhook payload into unified CRM Event Format.
   * Standard Internal Event Format:
   * {
   *   callId: 'call_123',
   *   event: 'incoming' | 'answered' | 'completed' | 'missed' | 'failed' | 'rejected',
   *   direction: 'incoming' | 'outgoing',
   *   fromNumber: '+998901234567',
   *   toNumber: '101',
   *   duration: 120,
   *   status: 'answered',
   *   recordingUrl: 'https://...',
   *   startedAt: Date,
   *   answeredAt: Date,
   *   endedAt: Date,
   *   raw: Object
   * }
   */
  normalizeWebhookPayload(body) {
    throw new Error(`normalizeWebhookPayload() must be implemented by subclass ${this.constructor.name}`);
  }

  /**
   * Trigger Outbound Call
   */
  async initiateCall({ fromExtension, toNumber, managerId }) {
    throw new Error(`initiateCall() must be implemented by subclass ${this.constructor.name}`);
  }

  /**
   * Hangup/Terminate Call
   */
  async hangupCall({ callId }) {
    throw new Error(`hangupCall() must be implemented by subclass ${this.constructor.name}`);
  }
}

module.exports = BaseTelephonyAdapter;
