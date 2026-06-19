import * as paypal from '../paypal-client.mjs';

async function verifyPartnerReferralImplementation() {
  console.log('[DEBUG_LOG] Starting verification of Partner Referral v2 implementation...');

  try {
    console.log('[DEBUG_LOG] Checking createPartnerReferral...');
    if (typeof paypal.createPartnerReferral !== 'function') throw new Error('createPartnerReferral is not defined');

    console.log('[DEBUG_LOG] Checking getPartnerReferral...');
    if (typeof paypal.getPartnerReferral !== 'function') throw new Error('getPartnerReferral is not defined');

    console.log('[DEBUG_LOG] Partner Referral functions are correctly defined in paypal-client.mjs');
    console.log('[DEBUG_LOG] Verification complete.');
  } catch (error) {
    console.error('[ERROR] Verification failed:', error.message);
    process.exit(1);
  }
}

verifyPartnerReferralImplementation();
