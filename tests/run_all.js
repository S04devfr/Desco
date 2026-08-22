const runTelephonyTests = require('./telephony.test');
const runSaaSTests = require('./saas.test');
const runActivityTests = require('./activity.test');

async function main() {
  console.log('🚀 RUNNING ALL AUTOMATED TEST SUITES FOR DESCO ENTERPRISE CRM\n');
  try {
    if (typeof runTelephonyTests === 'function') {
      await runTelephonyTests();
    }
    if (typeof runSaaSTests === 'function') {
      await runSaaSTests();
    }
    if (typeof runActivityTests === 'function') {
      await runActivityTests();
    }
    console.log('✨ ALL TEST SUITES COMPLETED SUCCESSFULLY! ✨\n');
  } catch (err) {
    console.error('💥 Test suite failed:', err);
    process.exit(1);
  }
}

main();
