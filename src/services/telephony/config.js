/**
 * Telephony Configuration Module
 * Loads environment variables cleanly with default fallbacks and security rules.
 */

module.exports = {
  provider: process.env.TELEPHONY_PROVIDER || 'generic', // generic | mock | onlinepbx | zadarma | asterisk
  apiUrl: process.env.TELEPHONY_API_URL || '',
  apiKey: process.env.TELEPHONY_API_KEY || '',
  apiSecret: process.env.TELEPHONY_API_SECRET || '',
  sipUsername: process.env.TELEPHONY_SIP_USERNAME || '',
  sipPassword: process.env.TELEPHONY_SIP_PASSWORD || '',
  sipDomain: process.env.TELEPHONY_SIP_DOMAIN || '',
  webhookSecret: process.env.TELEPHONY_WEBHOOK_SECRET || '',
  
  // Feature flags & defaults
  signatureValidationEnabled: process.env.TELEPHONY_VERIFY_SIGNATURE === 'true',
  defaultSipExtension: process.env.TELEPHONY_DEFAULT_EXTENSION || '101'
};
