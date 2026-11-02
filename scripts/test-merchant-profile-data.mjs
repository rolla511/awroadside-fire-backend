import { normalizeProviderPaypalProfile } from '../server.mjs';

function testMerchantProfileNormalization() {
  console.log('[DEBUG_LOG] Starting test for Merchant Profile Normalization with complex data...');

  const complexPaypalData = {
    trackingId: "TRACK-123",
    merchantId: "MERCH-456",
    onboardingStatus: "SUBSCRIBED",
    oauth_third_party: [
      {
        partner_client_id: "PARTNER-ID",
        merchant_client_id: "MERCHANT-ID",
        scopes: ["https://uri.paypal.com/services/payments/realtimepayment"],
        access_token: "ACCESS-TOKEN",
        refresh_token: "REFRESH-TOKEN"
      }
    ],
    integration_type: "FIRST_PARTY_INTEGRATED",
    integration_method: "PAYPAL",
    status: "A"
  };

  try {
    const normalized = normalizeProviderPaypalProfile(complexPaypalData);
    console.log('[DEBUG_LOG] Normalized Profile:', JSON.stringify(normalized, null, 2));

    if (normalized.trackingId !== "TRACK-123") throw new Error('trackingId mapping failed');
    if (normalized.providerAccountId !== "MERCH-456") throw new Error('providerAccountId/merchantId mapping failed');
    
    // Check if oauth_third_party is preserved
    console.log('[DEBUG_LOG] oauthThirdParty in normalized:', JSON.stringify(normalized.oauthThirdParty, null, 2));
    if (!Array.isArray(normalized.oauthThirdParty) || normalized.oauthThirdParty.length === 0) {
      throw new Error('oauthThirdParty mapping failed');
    }
    if (normalized.integrationType !== "FIRST_PARTY_INTEGRATED") throw new Error('integrationType mapping failed');
    
    console.log('[DEBUG_LOG] Test complete.');
  } catch (error) {
    console.error('[ERROR] Test failed:', error.message);
    process.exit(1);
  }
}

testMerchantProfileNormalization();
