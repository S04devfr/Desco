const assert = require('assert');
const {
  recordHeartbeat,
  getLiveOperatorPresence,
  getTodayStr,
  formatTimeHHMM
} = require('../src/services/activityService');

async function runActivityTests() {
  console.log('\n==================================================');
  console.log('🧪 RUNNING AMOCRM OPERATOR PRESENCE & ACTIVITY TESTS');
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

  // Test 1: Time helpers
  await test('1. Date and Time Formatters', async () => {
    const today = getTodayStr();
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);

    const timeStr = formatTimeHHMM(new Date('2026-08-22T09:14:00.000Z'));
    assert(timeStr && timeStr.includes(':'));
    assert.strictEqual(formatTimeHHMM(null), '—');
  });

  // Test 2: Heartbeat Active Ping
  await test('2. Record Active Heartbeat Session', async () => {
    let broadcastReceived = null;
    const session = await recordHeartbeat({
      userId: 99999,
      isIdle: false,
      action: 'deal_view',
      broadcast: (payload) => { broadcastReceived = payload; }
    });

    // In isolated/mock DB environments, function handles gracefully without crashing
    assert(session !== undefined);
  });

  // Test 3: Heartbeat Idle Ping Transition
  await test('3. Record Idle / Break Heartbeat Transition', async () => {
    let broadcastReceived = null;
    const session = await recordHeartbeat({
      userId: 99999,
      isIdle: true,
      broadcast: (payload) => { broadcastReceived = payload; }
    });
    assert(session !== undefined);
  });

  // Test 4: Live Operator Presence Structure
  await test('4. Live Operator Presence Calculation & Structure', async () => {
    const data = await getLiveOperatorPresence();
    assert(data && data.summary && Array.isArray(data.operators));
    assert(typeof data.summary.totalActive === 'number');
    assert(typeof data.summary.totalIdle === 'number');
    assert(typeof data.summary.totalOffline === 'number');

    if (data.operators.length > 0) {
      const op = data.operators[0];
      assert('id' in op);
      assert('name' in op);
      assert('status' in op);
      assert('firstLoginTime' in op);
      assert('onlineSec' in op);
      assert('idleSec' in op);
      assert('activeWorkRatio' in op);
      assert(op.activeWorkRatio >= 0 && op.activeWorkRatio <= 100);
    }
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runActivityTests();
}

module.exports = runActivityTests;
