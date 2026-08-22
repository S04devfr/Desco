const assert = require('assert');
const { PLANS } = require('../src/services/billingService');
const { apiSuccess, apiError } = require('../src/utils/response');
const { parsePagination, buildPaginationMeta } = require('../src/utils/pagination');

async function runSaaSTests() {
  console.log('\n==================================================');
  console.log('🧪 RUNNING ENTERPRISE SAAS UNIT & INTEGRATION TESTS');
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

  // Test 1: Plan definitions
  await test('1. Plan Matrix Integrity Check', async () => {
    assert(PLANS.free && PLANS.starter && PLANS.pro && PLANS.enterprise);
    assert.strictEqual(PLANS.free.limits.maxUsers, 3);
    assert.strictEqual(PLANS.pro.limits.maxUsers, 30);
    assert.strictEqual(PLANS.enterprise.limits.maxUsers, 9999);
  });

  // Test 2: Pagination parsing
  await test('2. Pagination Parsing & Default Limits', async () => {
    const p1 = parsePagination({});
    assert.strictEqual(p1.page, 1);
    assert.strictEqual(p1.limit, 20);
    assert.strictEqual(p1.skip, 0);

    const p2 = parsePagination({ page: '3', limit: '50' });
    assert.strictEqual(p2.page, 3);
    assert.strictEqual(p2.limit, 50);
    assert.strictEqual(p2.skip, 100);

    const p3 = parsePagination({ page: '-5', limit: '9999' });
    assert.strictEqual(p3.page, 1);
    assert.strictEqual(p3.limit, 100); // capped at max limit
  });

  // Test 3: Pagination metadata calculation
  await test('3. Pagination Metadata Calculation', async () => {
    const meta = buildPaginationMeta(95, 2, 20);
    assert.strictEqual(meta.total, 95);
    assert.strictEqual(meta.page, 2);
    assert.strictEqual(meta.totalPages, 5);
    assert.strictEqual(meta.hasNext, true);
    assert.strictEqual(meta.hasPrev, true);
  });

  // Test 4: Response formatter envelope
  await test('4. Standard API Response Formatter Envelope', async () => {
    let capturedStatus = null;
    let capturedJson = null;

    const mockRes = {
      status(code) {
        capturedStatus = code;
        return this;
      },
      json(payload) {
        capturedJson = payload;
        return this;
      },
      req: { id: 'test-req-uuid-1234' }
    };

    apiSuccess(mockRes, { name: 'Test Deal' }, { page: 1, total: 1 });
    assert.strictEqual(capturedStatus, 200);
    assert.strictEqual(capturedJson.success, true);
    assert.strictEqual(capturedJson.data.name, 'Test Deal');
    assert.strictEqual(capturedJson.requestId, 'test-req-uuid-1234');

    apiError(mockRes, 'Validation Failed', 400, { phone: 'Invalid format' });
    assert.strictEqual(capturedStatus, 400);
    assert.strictEqual(capturedJson.success, false);
    assert.strictEqual(capturedJson.error.message, 'Validation Failed');
    assert.strictEqual(capturedJson.error.details.phone, 'Invalid format');
  });

  // Test 5: Request ID generation
  await test('5. Request Correlation ID Generation', async () => {
    const requestIdMiddleware = require('../src/middleware/requestId');
    let nextCalled = false;
    const req = { headers: {} };
    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; }
    };

    requestIdMiddleware(req, res, () => { nextCalled = true; });
    assert(nextCalled);
    assert(req.id && typeof req.id === 'string' && req.id.length > 10);
    assert.strictEqual(res.headers['X-Request-Id'], req.id);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runSaaSTests();
}

module.exports = runSaaSTests;
