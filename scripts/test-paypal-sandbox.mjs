import { getAccessToken, createOrder } from '../backend/paypal-client.mjs';

async function runSandboxTest() {
    console.log('[DEBUG_LOG] Starting PayPal Sandbox Test...');
    
    // 1. Check if Credentials are set
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
        console.error('[ERROR] Missing PayPal Credentials in environment (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET).');
        process.exit(1);
    }

    console.log(`[DEBUG_LOG] Using Client ID: ${process.env.PAYPAL_CLIENT_ID.substring(0, 5)}...`);
    console.log(`[DEBUG_LOG] Environment: ${process.env.PAYPAL_ENV || 'sandbox'}`);

    try {
        // 2. Test Access Token
        console.log('[DEBUG_LOG] Requesting OAuth2 Access Token...');
        const token = await getAccessToken();
        console.log('[DEBUG_LOG] Success! Access Token received.');

        // 3. Test Order Creation
        console.log('[DEBUG_LOG] Creating Test Order for Guest Payout ($55 total)...');
        const orderDetails = {
            description: 'AW Roadside Sandbox Test (Guest)',
            amount: {
                currency_code: 'USD',
                value: '55.00'
            },
            customId: 'SANDBOX-TEST-12345'
        };

        const order = await createOrder(orderDetails);
        if (order.id) {
            console.log(`[DEBUG_LOG] Success! Order Created. Order ID: ${order.id}`);
            console.log(`[DEBUG_LOG] Status: ${order.status}`);
            console.log(`[DEBUG_LOG] Approve URL: ${order.links.find(l => l.rel === 'approve')?.href}`);
        } else {
            console.error('[ERROR] Order created but no ID returned:', JSON.stringify(order));
        }

    } catch (error) {
        console.error('[ERROR] PayPal Sandbox Test Failed:', error.message);
    }
}

runSandboxTest();
