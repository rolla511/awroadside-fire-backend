import { Buffer } from "buffer";
import crypto from "crypto";

const PAYPAL_ENV = normalizeEnvironment(process.env.PAYPAL_ENV);
const PAYPAL_API_BASE_URL =
  PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const PAYPAL_CLIENT_ID = resolvePaypalClientId();
const PAYPAL_CLIENT_SECRET = resolvePaypalClientSecret();
const PAYPAL_WEBHOOK_IDS = Object.freeze({
  live: "27268198X79844346",
  sandbox: "4RN22635Y61567938"
});
const PAYPAL_WEBHOOK_ID = readEnv("PAYPAL_WEBHOOK_ID") || PAYPAL_WEBHOOK_IDS[PAYPAL_ENV] || "";
const PAYPAL_BRAND_NAME = readEnv("PAYPAL_BRAND_NAME") || "AW Roadside";
const PAYPAL_SOFT_DESCRIPTOR = toSoftDescriptor(readEnv("PAYPAL_SOFT_DESCRIPTOR") || "AWROADSIDE");
const PAYPAL_PARTNER_ATTRIBUTION_ID = readEnv("PAYPAL_PARTNER_ATTRIBUTION_ID");
const PAYPAL_PROXY_URL = readEnv("PAYPAL_PROXY_URL");
const PAYPAL_PROXY_USERNAME = readEnv("PAYPAL_PROXY_USERNAME");
const PAYPAL_PROXY_PASSWORD = readEnv("PAYPAL_PROXY_PASSWORD");

let cachedToken = null;
let tokenExpiry = 0;

export async function getAccessToken() {
  requireCredentials();

  if (cachedToken && Date.now() < tokenExpiry) {
    console.log("[DEBUG_LOG] Using valid cached PayPal token");
    return cachedToken;
  }

  console.log("[DEBUG_LOG] PayPal token expired or missing. Fetching new one...");
  const options = {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Language": "en_US",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${encodeClientCredentials()}`
    },
    body: new URLSearchParams({
      grant_type: "client_credentials"
    }).toString()
  };
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/oauth2/token`, options);

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("token-request-failed", response.status, payload);
  }

  const accessToken = readString(payload.access_token);
  if (!accessToken) {
    throw new Error("PayPal token response did not include an access_token.");
  }

  cachedToken = accessToken;
  const expiresIn = Number(payload.expires_in) || 3600;
  // Set expiry with a 60-second buffer for safety
  tokenExpiry = Date.now() + (expiresIn * 1000) - 60000;

  console.log(`[DEBUG_LOG] New PayPal token acquired. Expires in ${expiresIn}s.`);
  return accessToken;
}

export async function introspectToken(token, tokenTypeHint = "access_token") {
  requireCredentials();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/oauth2/token/introspect`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${encodeClientCredentials()}`
    },
    body: new URLSearchParams({
      token: readRequiredString(token, "token"),
      token_type_hint: tokenTypeHint
    }).toString()
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("token-introspection-failed", response.status, payload);
  }

  return payload;
}

export async function revokeToken(token, tokenTypeHint = "access_token") {
  requireCredentials();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/oauth2/token/terminate`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${encodeClientCredentials()}`
    },
    body: new URLSearchParams({
      token: readRequiredString(token, "token"),
      token_type_hint: tokenTypeHint
    }).toString()
  });

  if (response.status === 200 || response.status === 204) {
    if (token === cachedToken) {
      cachedToken = null;
      tokenExpiry = 0;
    }
    return { success: true };
  }

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("token-revocation-failed", response.status, payload);
  }

  return payload || { success: true };
}

export async function createOrder(orderDetails = {}) {
  const token = await getAccessToken();
  const requestBody = buildOrderRequest(orderDetails);
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": crypto.randomUUID()
    }),
    body: JSON.stringify(requestBody)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("create-order-failed", response.status, payload);
  }

  return payload;
}

export async function captureOrder(orderId) {
  const normalizedOrderId = readRequiredString(orderId, "orderId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}/capture`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": crypto.randomUUID()
    })
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("capture-order-failed", response.status, payload);
  }

  return payload;
}

export async function authorizeOrder(orderId) {
  const normalizedOrderId = readRequiredString(orderId, "orderId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}/authorize`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": crypto.randomUUID()
    })
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("authorize-order-failed", response.status, payload);
  }

  return payload;
}

export async function confirmOrder(orderId) {
  const normalizedOrderId = readRequiredString(orderId, "orderId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}/confirm-payment-source`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": crypto.randomUUID()
    })
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("confirm-order-failed", response.status, payload);
  }

  return payload;
}

export async function createOrderTracking(orderId, trackingDetails = {}) {
  const normalizedOrderId = readRequiredString(orderId, "orderId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}/track`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      "PayPal-Request-Id": crypto.randomUUID()
    }),
    body: JSON.stringify(trackingDetails)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("create-order-tracking-failed", response.status, payload);
  }

  return payload;
}

export async function updateOrder(orderId, patches = []) {
  const normalizedOrderId = readRequiredString(orderId, "orderId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}`, {
    method: "PATCH",
    headers: buildJsonHeaders(token),
    body: JSON.stringify(patches)
  });

  if (response.status === 204) {
    return { success: true };
  }

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("update-order-failed", response.status, payload);
  }

  return payload || { success: true };
}

export async function getOrderStatus(orderId) {
  const normalizedOrderId = readRequiredString(orderId, "orderId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}`, {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("get-order-status-failed", response.status, payload);
  }

  return payload;
}

export async function getAuthorizedPayment(authorizationId) {
  const normalizedId = readRequiredString(authorizationId, "authorizationId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/payments/authorizations/${encodeURIComponent(normalizedId)}`, {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("get-authorized-payment-failed", response.status, payload);
  }

  return payload;
}

export async function captureAuthorizedPayment(authorizationId, options = {}) {
  const normalizedId = readRequiredString(authorizationId, "authorizationId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/payments/authorizations/${encodeURIComponent(normalizedId)}/capture`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      "PayPal-Request-Id": options.paypalRequestId
    }),
    body: JSON.stringify(options.body || {})
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("capture-authorized-payment-failed", response.status, payload);
  }

  return payload;
}

export async function listBillingPlans(query = {}) {
  const token = await getAccessToken();
  const url = new URL(`${PAYPAL_API_BASE_URL}/v1/billing/plans`);
  if (query.productId) url.searchParams.append("product_id", query.productId);
  if (query.pageSize) url.searchParams.append("page_size", query.pageSize);
  if (query.page) url.searchParams.append("page", query.page);
  if (query.totalRequired) url.searchParams.append("total_required", query.totalRequired);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildJsonHeaders(token, {
      Prefer: query.prefer
    })
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("list-billing-plans-failed", response.status, payload);
  }

  return payload;
}

export async function createBillingPlan(data = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/billing/plans`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": data.paypalRequestId
    }),
    body: JSON.stringify(data.body || data)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("create-billing-plan-failed", response.status, payload);
  }

  return payload;
}

export async function activateBillingPlan(planId) {
  const normalizedId = readRequiredString(planId, "planId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/billing/plans/${encodeURIComponent(normalizedId)}/activate`, {
    method: "POST",
    headers: buildJsonHeaders(token)
  });

  if (response.status === 204) {
    return { success: true };
  }

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("activate-billing-plan-failed", response.status, payload);
  }

  return payload || { success: true };
}

export async function createSubscription(data = {}) {
  const token = await getAccessToken();
  const body = data.body || data;

  // Handle application_context for native/mobile flows
  if (data.native_app || data.mobile_web || data.application_context) {
    body.application_context = body.application_context || {};
    if (data.native_app) body.application_context.native_app = data.native_app;
    if (data.mobile_web) body.application_context.mobile_web = data.mobile_web;
    if (data.application_context) Object.assign(body.application_context, data.application_context);
  }

  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": data.paypalRequestId,
      "PayPal-Client-Metadata-Id": data.paypalClientMetadataId
    }),
    body: JSON.stringify(body)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("create-subscription-failed", response.status, payload);
  }

  return payload;
}

export async function getSubscription(id, options = {}) {
  const token = await getAccessToken();
  const url = new URL(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions/${id}`);
  if (options.fields) url.searchParams.append("fields", options.fields);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("get-subscription-failed", response.status, payload);
  }

  return payload;
}

export async function reviseSubscription(id, options = {}) {
  const token = await getAccessToken();
  const headers = buildJsonHeaders(token);
  
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions/${id}/revise`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body || {})
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("revise-subscription-failed", response.status, payload);
  }

  return payload;
}

export async function patchSubscription(id, patches = []) {
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions/${id}`, {
    method: "PATCH",
    headers: buildJsonHeaders(token),
    body: JSON.stringify(patches)
  });

  if (response.status === 204) {
    return { success: true };
  }

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("patch-subscription-failed", response.status, payload);
  }

  return payload || { success: true };
}

export async function activateSubscription(id, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions/${id}/activate`, {
    method: "POST",
    headers: buildJsonHeaders(token),
    body: JSON.stringify(options.body || {})
  });

  if (response.status === 204) {
    return { success: true };
  }

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("activate-subscription-failed", response.status, payload);
  }

  return payload || { success: true };
}

export async function captureSubscription(id, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions/${id}/capture`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      "PayPal-Request-Id": options.paypalRequestId
    }),
    body: JSON.stringify(options.body || {})
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("capture-subscription-failed", response.status, payload);
  }

  return payload;
}

export async function listSubscriptionTransactions(id, query = {}) {
  const token = await getAccessToken();
  const url = new URL(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions/${id}/transactions`);
  if (query.startTime || query.start_time) url.searchParams.append("start_time", query.startTime || query.start_time);
  if (query.endTime || query.end_time) url.searchParams.append("end_time", query.endTime || query.end_time);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("list-subscription-transactions-failed", response.status, payload);
  }

  return payload;
}

export async function getSetupToken(tokenId) {
  const normalizedTokenId = readRequiredString(tokenId, "tokenId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v3/vault/setup-tokens/${encodeURIComponent(normalizedTokenId)}`, {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("get-setup-token-failed", response.status, payload);
  }

  return payload;
}

export async function getPaymentToken(tokenId) {
  const normalizedTokenId = readRequiredString(tokenId, "tokenId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v3/vault/payment-tokens/${encodeURIComponent(normalizedTokenId)}`, {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("get-payment-token-failed", response.status, payload);
  }

  return payload;
}

export async function patchPaymentToken(tokenId, patchOperations) {
  const normalizedTokenId = readRequiredString(tokenId, "tokenId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v3/vault/payment-tokens/${encodeURIComponent(normalizedTokenId)}`, {
    method: "PATCH",
    headers: buildJsonHeaders(token),
    body: JSON.stringify(patchOperations)
  });

  if (response.status === 204) {
    return { success: true };
  }

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("patch-payment-token-failed", response.status, payload);
  }

  return payload;
}

export async function listPaymentTokens(customerId) {
  const normalizedCustomerId = readRequiredString(customerId, "customerId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v3/vault/payment-tokens?customer_id=${encodeURIComponent(normalizedCustomerId)}`, {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("list-payment-tokens-failed", response.status, payload);
  }

  return payload;
}

export async function createSetupToken(data = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v3/vault/setup-tokens`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      "PayPal-Request-Id": data.paypalRequestId
    }),
    body: JSON.stringify(data.body || data)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("create-setup-token-failed", response.status, payload);
  }

  return payload;
}

export async function createPaymentToken(options = {}) {
  const token = await getAccessToken();
  const headers = buildJsonHeaders(token);
  if (options.paypalRequestId) {
    headers["PayPal-Request-Id"] = options.paypalRequestId;
  }

  const response = await fetch(`${PAYPAL_API_BASE_URL}/v3/vault/payment-tokens`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body || options)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("create-payment-token-failed", response.status, payload);
  }

  return payload;
}

export async function getUserInfo(schema = "openid") {
  const token = await getAccessToken();
  const url = new URL(`${PAYPAL_API_BASE_URL}/v1/identity/openidconnect/userinfo`);
  url.searchParams.append("schema", schema);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("get-user-info-failed", response.status, payload);
  }

  return payload;
}

export async function deletePaymentToken(tokenId) {
  const normalizedTokenId = readRequiredString(tokenId, "tokenId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v3/vault/payment-tokens/${encodeURIComponent(normalizedTokenId)}`, {
    method: "DELETE",
    headers: buildJsonHeaders(token)
  });

  if (response.status === 204) {
    return { success: true };
  }

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("delete-payment-token-failed", response.status, payload);
  }

  return payload || { success: true };
}

export async function searchTransactions(query = {}) {
  const token = await getAccessToken();
  const url = new URL(`${PAYPAL_API_BASE_URL}/v1/reporting/transactions`);
  
  // Dynamic mapping of query parameters
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    
    // Convert camelCase to snake_case if necessary for the API
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    url.searchParams.append(snakeKey, value);
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("search-transactions-failed", response.status, payload);
  }

  return payload;
}

export async function refundCapturedPayment(captureId, refundDetails = {}) {
  const normalizedCaptureId = readRequiredString(captureId, "captureId");
  const token = await getAccessToken();
  const requestBody = {};

  if (refundDetails.amount) {
    requestBody.amount = normalizeAmount(refundDetails.amount);
  }
  if (refundDetails.invoiceId || refundDetails.invoice_id) {
    requestBody.invoice_id = readString(refundDetails.invoiceId || refundDetails.invoice_id);
  }
  if (refundDetails.noteToPayer || refundDetails.note_to_payer || refundDetails.note) {
    requestBody.note_to_payer = readString(refundDetails.noteToPayer || refundDetails.note_to_payer || refundDetails.note);
  }

  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/payments/captures/${encodeURIComponent(normalizedCaptureId)}/refund`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": crypto.randomUUID()
    }),
    body: JSON.stringify(requestBody)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("refund-capture-failed", response.status, payload);
  }

  return payload;
}

export async function validateWebhook(
  transmissionId,
  transmissionTime,
  certUrl,
  webhookId,
  webhookEvent,
  authAlgo,
  transmissionSig
) {
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: buildJsonHeaders(token),
    body: JSON.stringify({
      auth_algo: readRequiredString(authAlgo, "authAlgo"),
      cert_url: readRequiredString(certUrl, "certUrl"),
      transmission_id: readRequiredString(transmissionId, "transmissionId"),
      transmission_sig: readRequiredString(transmissionSig, "transmissionSig"),
      transmission_time: readRequiredString(transmissionTime, "transmissionTime"),
      webhook_id: readRequiredString(webhookId || PAYPAL_WEBHOOK_ID, "webhookId"),
      webhook_event: webhookEvent
    })
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("webhook-validation-failed", response.status, payload);
  }

  return payload;
}

export function resolvePaypalWebhookId() {
  return PAYPAL_WEBHOOK_ID;
}

function buildOrderRequest(orderDetails) {
  const amount = normalizeAmount(orderDetails.amount);
  const description = readString(orderDetails.description) || "AW Roadside Service";
  const customId = readString(orderDetails.customId) || undefined;

  const purchaseUnit = {
    amount,
    description,
    soft_descriptor: PAYPAL_SOFT_DESCRIPTOR
  };
  if (customId) {
    purchaseUnit.custom_id = customId;
  }

  const applicationContext = {
    brand_name: PAYPAL_BRAND_NAME,
    landing_page: "LOGIN",
    shipping_preference: "NO_SHIPPING",
    user_action: "PAY_NOW"
  };

  // Merge native_app or mobile_web if provided in orderDetails
  if (orderDetails.native_app) {
    applicationContext.native_app = orderDetails.native_app;
  }
  if (orderDetails.mobile_web) {
    applicationContext.mobile_web = orderDetails.mobile_web;
  }
  if (orderDetails.application_context) {
    Object.assign(applicationContext, orderDetails.application_context);
  }

  return {
    intent: "CAPTURE",
    purchase_units: [purchaseUnit],
    application_context: applicationContext
  };
}

function buildJsonHeaders(token, extraHeaders = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...extraHeaders
  };
  if (PAYPAL_PARTNER_ATTRIBUTION_ID) {
    headers["PayPal-Partner-Attribution-Id"] = PAYPAL_PARTNER_ATTRIBUTION_ID;
  }
  return headers;
}

function normalizeAmount(value) {
  if (!value || typeof value !== "object") {
    throw new Error("PayPal order amount is required.");
  }

  const currencyCode = readRequiredString(value.currency_code || value.currencyCode, "amount.currency_code").toUpperCase();
  const normalizedValue = normalizeAmountValue(value.value);

  return {
    currency_code: currencyCode,
    value: normalizedValue
  };
}

function normalizeAmountValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error("PayPal order amount.value must be a positive number.");
  }
  return numericValue.toFixed(2);
}

function encodeClientCredentials() {
  return Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
}

function requireCredentials() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("Missing PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  }
}

function normalizeEnvironment(value) {
  return readEnvValue(value).toLowerCase() === "live" ? "live" : "sandbox";
}

function resolvePaypalClientId() {
  if (PAYPAL_ENV === "sandbox") {
    return (
      readEnv("PAYPAL_CLIENT_ID_SANDBOX") ||
      readEnv("PAYPAL_CLIENT_ID_sandbox") ||
      readEnv("PAYPAL_CLIENT_ID")
    );
  }
  return readEnv("PAYPAL_CLIENT_ID");
}

function resolvePaypalClientSecret() {
  if (PAYPAL_ENV === "sandbox") {
    return (
      readEnv("PAYPAL_CLIENT_SECRET_SANDBOX") ||
      readEnv("PAYPAL_CLIENT_SECRET_sandbox") ||
      readEnv("PAYPAL_CLIENT_SECRET_SANBOX") ||
      readEnv("PAYPAL_CLIENT_SECRET_sanbox") ||
      readEnv("PAYPAL_CLIENT_SECRET") ||
      readEnv("SECRET_KEY_1") ||
      readEnv("PAYPAL_SECRET_KEY_1")
    );
  }
  return (
    readEnv("PAYPAL_CLIENT_SECRET") ||
    readEnv("SECRET_KEY_1") ||
    readEnv("PAYPAL_SECRET_KEY_1")
  );
}

function readEnv(name) {
  return readEnvValue(process.env[name]);
}

function readEnvValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readRequiredString(value, fieldName) {
  const normalized = readString(value);
  if (!normalized) {
    throw new Error(`Field "${fieldName}" is required.`);
  }
  return normalized;
}

async function readJsonPayload(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      message: text
    };
  }
}

function createPaypalError(operation, statusCode, payload) {
  const name = readString(payload.error) || readString(payload.name);
  const description =
    readString(payload.error_description) ||
    readString(payload.message) ||
    readString(payload.description) ||
    responseStatusFallback(statusCode);
  const detail = name ? `${name}: ${description}` : description;
  const error = new Error(`PayPal ${operation} failed with ${statusCode}. ${detail}`);
  const isClientAuthFailure = operation === "token-request-failed" && statusCode === 401 && name === "invalid_client";
  error.statusCode = isClientAuthFailure ? 503 : statusCode;
  error.code = isClientAuthFailure ? "paypal-client-auth-failed" : "paypal-request-failed";
  error.paypal = payload;
  return error;
}

function responseStatusFallback(statusCode) {
  return statusCode ? `HTTP ${statusCode}` : "Unknown PayPal error";
}

function toSoftDescriptor(value) {
  return value
    .replace(/[^A-Za-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22) || "AWROADSIDE";
}
