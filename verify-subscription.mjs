import * as paypal from '../paypal-client.mjs';

async function verifySubscriptionImplementation() {
  console.log('[DEBUG_LOG] Starting verification of Subscription implementation...');

  try {
    console.log('[DEBUG_LOG] Checking createSubscription...');
    if (typeof paypal.createSubscription !== 'function') throw new Error('createSubscription is not defined');

    console.log('[DEBUG_LOG] Checking patchSubscription...');
    if (typeof paypal.patchSubscription !== 'function') throw new Error('patchSubscription is not defined');

    console.log('[DEBUG_LOG] Checking activateSubscription...');
    if (typeof paypal.activateSubscription !== 'function') throw new Error('activateSubscription is not defined');

    console.log('[DEBUG_LOG] All Subscription functions are correctly defined in paypal-client.mjs');
    console.log('[DEBUG_LOG] Verification complete.');
  } catch (error) {
    console.error('[ERROR] Verification failed:', error.message);
    process.exit(1);
  }
}

verifySubscriptionImplementation();
