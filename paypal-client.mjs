// paypal-client.mjs

// Centralized PayPal API Calls

const PAYPAL_API_URL = 'https://api-m.sandbox.paypal.com/v1'; // Change to live URL for production
const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

// Function to create an order
export const createOrder = async (orderDetails) => {
    const response = await fetch(`${PAYPAL_API_URL}/checkout/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        },
        body: JSON.stringify(orderDetails)
    });
    return response.json();
};

// Function to capture an order
export const captureOrder = async (orderId) => {
    const response = await fetch(`${PAYPAL_API_URL}/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        }
    });
    return response.json();
};

// Function to get the status of an order
export const getOrderStatus = async (orderId) => {
    const response = await fetch(`${PAYPAL_API_URL}/checkout/orders/${orderId}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        }
    });
    return response.json();
};

// Function to validate webhook event
export const validateWebhook = async (transmissionId, transmissionTime, certUrl, webhookId, webhookEvent, authAlgo, transmissionSig) => {
    const response = await fetch(`${PAYPAL_API_URL}/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
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
