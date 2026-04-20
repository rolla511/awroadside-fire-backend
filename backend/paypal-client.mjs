// paypal-client.mjs
import { Buffer } from 'node:buffer';

/**
 * PayPal API Client for AW Roadside
 * Configured for v2 Checkout Orders API as per AW Roadside Method
 */

const PAYPAL_ENV = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase();
const PAYPAL_API_URL = PAYPAL_ENV === 'live' 
    ? 'https://api-m.paypal.com' 
    : 'https://api-m.sandbox.paypal.com';

const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
const platformId = process.env.PAYPAL_PLATFORM_ID; // The numeric Platform/Partner ID

/**
 * Get OAuth2 Access Token from PayPal
 */
export const getAccessToken = async () => {
    // Trim credentials to prevent whitespace-related "invalid_client" errors
    const cleanId = (clientId || '').trim();
    const cleanSecret = (clientSecret || '').trim();
    
    if (!cleanId || !cleanSecret) {
        throw new Error('Missing PayPal Credentials: PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is not set.');
    }

    const auth = Buffer.from(`${cleanId}:${cleanSecret}`).toString('base64');
    
    const response = await fetch(`${PAYPAL_API_URL}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${auth}`
        },
        body: 'grant_type=client_credentials'
    });
    
    if (!response.ok) {
        const error = await response.json();
        console.error('[ERROR] PayPal Auth Failed:', JSON.stringify(error));
        throw new Error(`PayPal Auth Failed: ${error.error_description || error.error || response.statusText}`);
    }
    
    const data = await response.json();
    return data.access_token;
};

/**
 * Create a PayPal Order (v2 API)
 * used for Service Payment or Priority Upgrade
 */
export const createOrder = async (orderDetails) => {
    const token = await getAccessToken();
    console.log('[DEBUG_LOG] Creating PayPal Order:', JSON.stringify(orderDetails));
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
    
    if (platformId) {
        headers['PayPal-Partner-Attribution-Id'] = platformId;
    }

    const orderBody = {
        intent: 'CAPTURE',
        purchase_units: [{
            description: orderDetails.description || 'AW Roadside Service',
            amount: orderDetails.amount, // { currency_code: 'USD', value: '55.00' }
            custom_id: orderDetails.customId,
            soft_descriptor: 'AWROADSIDE'
        }],
        application_context: {
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            brand_name: 'AW Roadside'
        }
    };

    // If platformId is provided, identify the platform as the payee/merchant
    if (platformId) {
        orderBody.purchase_units[0].payee = {
            merchant_id: platformId
        };
    }

    const response = await fetch(`${PAYPAL_API_URL}/v2/checkout/orders`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(orderBody)
    });
    
    const data = await response.json();
    if (!response.ok) {
        console.error('[ERROR] PayPal Create Order Failed:', JSON.stringify(data));
        throw new Error(`PayPal Create Order Failed: ${data.message || response.statusText}`);
    }
    console.log('[DEBUG_LOG] PayPal Order Created:', data.id);
    return data;
};

/**
 * Capture a PayPal Order (v2 API)
 */
export const captureOrder = async (orderId) => {
    const token = await getAccessToken();
    console.log('[DEBUG_LOG] Capturing PayPal Order:', orderId);
    const response = await fetch(`${PAYPAL_API_URL}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    
    const data = await response.json();
    if (!response.ok) {
        console.error('[ERROR] PayPal Capture Order Failed:', JSON.stringify(data));
        throw new Error(`PayPal Capture Order Failed: ${data.message || response.statusText}`);
    }
    console.log('[DEBUG_LOG] PayPal Order Captured:', orderId, 'Status:', data.status);
    return data;
};

/**
 * Get the status of an order (v2 API)
 */
export const getOrderStatus = async (orderId) => {
    const token = await getAccessToken();
    const response = await fetch(`${PAYPAL_API_URL}/v2/checkout/orders/${orderId}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    return response.json();
};

/**
 * Validate Webhook Signature
 */
export const validateWebhook = async (transmissionId, transmissionTime, certUrl, webhookId, webhookEvent, authAlgo, transmissionSig) => {
    const token = await getAccessToken();
    const response = await fetch(`${PAYPAL_API_URL}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            auth_algo: authAlgo,
            cert_url: certUrl,
            webhook_id: webhookId,
            webhook_event: webhookEvent,
            transmission_id: transmissionId,
            transmission_sig: transmissionSig,
            transmission_time: transmissionTime
        })
    });
    return response.json();
};
