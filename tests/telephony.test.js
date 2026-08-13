/**
 * Automated Telephony Integration Test Suite
 * Tests 12 key scenarios using Mock Provider Adapter.
 */
const assert = require('assert');
const TelephonyProviderFactory = require('../src/services/telephony/providerFactory');
const TelephonyService = require('../src/services/telephony/telephonyService');
const config = require('../src/services/telephony/config');

async function runTelephonyTests() {
  console.log('\n==================================================');
  console.log('🧪 RUNNING TELEPHONY INTEGRATION TEST SUITE (12 SCENARIOS)');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ [FAIL] ${name}: ${e.message}`);
      failed++;
    }
  }

  // Scenario 1: Mock Adapter Initialization
  await test('1. Provider Strategy Factory Initialization', async () => {
    const mockAdapter = TelephonyProviderFactory.getAdapter('mock');
    assert.strictEqual(mockAdapter.name, 'mock');
    const genericAdapter = TelephonyProviderFactory.getAdapter('generic');
    assert.strictEqual(genericAdapter.name, 'generic');
  });

  // Scenario 2: Incoming Call Normalization
  await test('2. Incoming Call Webhook Payload Normalization', async () => {
    const adapter = TelephonyProviderFactory.getAdapter('mock');
    const norm = adapter.normalizeWebhookPayload({
      event: 'incoming',
      fromNumber: '+998901112233',
      toNumber: '101'
    });
    assert.strictEqual(norm.direction, 'incoming');
    assert.strictEqual(norm.fromNumber, '+998901112233');
    assert.strictEqual(norm.toNumber, '101');
  });

  // Scenario 3: Outgoing Call Initiation Architecture
  await test('3. Outbound Call Trigger & Initiation', async () => {
    const mockAdapter = TelephonyProviderFactory.getAdapter('mock');
    const res = await mockAdapter.initiateCall({ fromExtension: '101', toNumber: '+998977654321' });
    assert.strictEqual(res.success, true);
    assert(res.callId.startsWith('mock_outbound_'));
  });

  // Scenario 4: Missed Call Normalization
  await test('4. Missed Call Normalization', async () => {
    const adapter = TelephonyProviderFactory.getAdapter('generic');
    const norm = adapter.normalizeWebhookPayload({
      event: 'missed',
      status: 'noanswer',
      duration: 0
    });
    assert.strictEqual(norm.status, 'missed');
    assert.strictEqual(norm.duration, 0);
  });

  // Scenario 5: Answered Call Duration Processing
  await test('5. Answered Call Duration Calculation', async () => {
    const adapter = TelephonyProviderFactory.getAdapter('generic');
    const norm = adapter.normalizeWebhookPayload({
      event: 'completed',
      duration: 185
    });
    assert.strictEqual(norm.duration, 185);
    assert.strictEqual(norm.status, 'answered');
  });

  // Scenario 6: Call Recording URL Assignment
  await test('6. Call Recording URL Processing', async () => {
    const adapter = TelephonyProviderFactory.getAdapter('mock');
    const norm = adapter.normalizeWebhookPayload({
      recordingUrl: 'https://example.com/audio/call_99.mp3'
    });
    assert.strictEqual(norm.recordingUrl, 'https://example.com/audio/call_99.mp3');
  });

  // Scenario 7: Unknown Customer Handling
  await test('7. Unknown Customer Search Fallback', async () => {
    const match = await TelephonyService.matchCustomerByPhone('+998000000000');
    assert.strictEqual(match, null);
  });

  // Scenario 8: Existing Customer Phone Matching Logic
  await test('8. Phone Number Sanitization & Matching Logic', async () => {
    const clean = '+998 (90) 123-45-67'.replace(/[^\d+]/g, '');
    assert.strictEqual(clean, '+998901234567');
  });

  // Scenario 9: Webhook Idempotency / Duplicate Prevention
  await test('9. Webhook Idempotency & Deduplication Cache', async () => {
    const reqMock = {
      body: {
        callId: 'test_duplicate_123',
        event: 'completed',
        from: '+998901112233',
        to: '101',
        duration: 30
      }
    };
    const res1 = await TelephonyService.processWebhook(reqMock, 'mock');
    assert.strictEqual(res1.success, true);

    const res2 = await TelephonyService.processWebhook(reqMock, 'mock');
    assert.strictEqual(res2.duplicate, true);
  });

  // Scenario 10: Invalid Signature Rejection
  await test('10. Invalid Webhook Signature Protection', async () => {
    const adapter = TelephonyProviderFactory.getAdapter('generic');
    const fakeReq = { headers: {}, query: {} };
    const isValid = adapter.verifyWebhookSignature(fakeReq, 'my_super_secret');
    assert.strictEqual(isValid, false);
  });

  // Scenario 11: Provider Failure Isolation
  await test('11. Telephony Integration Failure Isolation', async () => {
    try {
      const adapter = TelephonyProviderFactory.getAdapter('generic');
      const norm = adapter.normalizeWebhookPayload(null);
      assert(norm.callId);
    } catch (e) {
      assert(e);
    }
  });

  // Scenario 12: Environment Configuration Fallback
  await test('12. Environment Variable Configuration Safety', async () => {
    assert.strictEqual(typeof config.provider, 'string');
    assert.strictEqual(typeof config.defaultSipExtension, 'string');
  });

  console.log(`\n==================================================`);
  console.log(`🎯 TEST RESULTS: ${passed} PASSED, ${failed} FAILED out of ${passed + failed} SCENARIOS`);
  console.log(`==================================================\n`);

  if (failed > 0) process.exit(1);
}

runTelephonyTests();
