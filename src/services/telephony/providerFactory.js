const GenericTelephonyAdapter = require('./adapters/genericAdapter');
const OnlinePbxTelephonyAdapter = require('./adapters/onlinePbxAdapter');
const MockTelephonyAdapter = require('./adapters/mockAdapter');
const config = require('./config');

/**
 * Telephony Provider Factory
 * Dynamically selects and instantiates active telephony adapter based on TELEPHONY_PROVIDER env.
 */
class TelephonyProviderFactory {
  static getAdapter(providerName) {
    const activeProvider = (providerName || config.provider || 'generic').toLowerCase();

    switch (activeProvider) {
      case 'mock':
      case 'test':
        return new MockTelephonyAdapter();
      case 'onlinepbx':
      case 'asterisk':
        return new OnlinePbxTelephonyAdapter();
      case 'generic':
      default:
        return new GenericTelephonyAdapter();
    }
  }
}

module.exports = TelephonyProviderFactory;
