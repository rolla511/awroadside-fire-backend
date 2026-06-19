import * as paypal from '../paypal-client.mjs';

async function verifyMerchantIntegrationStatus() {
  console.log('[DEBUG_LOG] Starting verification of Merchant Integration Status implementation...');

  try {
    console.log('[DEBUG_LOG] Checking getMerchantIntegrationStatus...');
    if (typeof paypal.getMerchantIntegrationStatus !== 'function') throw new Error('getMerchantIntegrationStatus is not defined');

    console.log('[DEBUG_LOG] getMerchantIntegrationStatus function is correctly defined in paypal-client.mjs');
    console.log('[DEBUG_LOG] Verification complete.');
  } catch (error) {
    console.error('[ERROR] Verification failed:', error.message);
    process.exit(1);
  }
}

verifyMerchantIntegrationStatus();
