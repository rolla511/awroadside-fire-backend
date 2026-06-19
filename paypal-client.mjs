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
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v1/oauth2/token`, options);

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
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v1/oauth2/token/introspect`, {
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
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v1/oauth2/token/terminate`, {
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
  const requestId = orderDetails.requestId || orderDetails.PayPalRequestId || crypto.randomUUID();
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": requestId
    }),
    body: JSON.stringify(requestBody)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("create-order-failed", response.status, payload);
  }

  return payload;
}

export async function captureOrder(orderId, captureDetails = {}) {
  const normalizedOrderId = readRequiredString(orderId, "orderId");
  const token = await getAccessToken();
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}/capture`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": captureDetails.requestId || captureDetails.PayPalRequestId || crypto.randomUUID()
    }),
    body: captureDetails.body ? JSON.stringify(captureDetails.body) : undefined
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("capture-order-failed", response.status, payload);
  }

  return payload;
}

export async function authorizeOrder(orderId, authorizationDetails = {}) {
  const normalizedOrderId = readRequiredString(orderId, "orderId");
  const token = await getAccessToken();
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}/authorize`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": authorizationDetails.requestId || authorizationDetails.PayPalRequestId || crypto.randomUUID()
    }),
    body: authorizationDetails.body ? JSON.stringify(authorizationDetails.body) : undefined
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("authorize-order-failed", response.status, payload);
  }

  return payload;
}

export async function confirmOrder(orderId, confirmationDetails = {}) {
  const normalizedOrderId = readRequiredString(orderId, "orderId");
  const token = await getAccessToken();
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}/confirm-payment-source`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": confirmationDetails.requestId || confirmationDetails.PayPalRequestId || crypto.randomUUID()
    }),
    body: JSON.stringify(confirmationDetails.body || confirmationDetails)
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
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}/track`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      "PayPal-Request-Id": trackingDetails.requestId || trackingDetails.PayPalRequestId || crypto.randomUUID()
    }),
    body: JSON.stringify(trackingDetails.body || trackingDetails)
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
  const normalizedAuthId = readRequiredString(authorizationId, "authorizationId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/payments/authorizations/${encodeURIComponent(normalizedAuthId)}`, {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("get-authorized-payment-failed", response.status, payload);
  }

  return payload;
}

export async function voidAuthorizedPayment(authorizationId) {
  const normalizedAuthId = readRequiredString(authorizationId, "authorizationId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/payments/authorizations/${encodeURIComponent(normalizedAuthId)}/void`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      "PayPal-Request-Id": crypto.randomUUID()
    })
  });

  if (!response.ok) {
    const payload = await readJsonPayload(response);
    throw createPaypalError("void-authorized-payment-failed", response.status, payload);
  }

  // Void returns 204 No Content on success
  return {
    success: true,
    statusCode: response.status
  };
}

export async function reauthorizeAuthorizedPayment(authorizationId, reauthorizeDetails = {}) {
  const normalizedAuthId = readRequiredString(authorizationId, "authorizationId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/payments/authorizations/${encodeURIComponent(normalizedAuthId)}/reauthorize`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": crypto.randomUUID()
    }),
    body: reauthorizeDetails.body ? JSON.stringify(reauthorizeDetails.body) : undefined
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("reauthorize-authorized-payment-failed", response.status, payload);
  }

  return payload;
}

export async function captureAuthorizedPayment(authorizationId, captureDetails = {}) {
  const normalizedAuthId = readRequiredString(authorizationId, "authorizationId");
  const token = await getAccessToken();
  const requestBody = buildCaptureAuthorizedPaymentRequest(captureDetails);
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v2/payments/authorizations/${encodeURIComponent(normalizedAuthId)}/capture`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: "return=representation",
      "PayPal-Request-Id": crypto.randomUUID()
    }),
    body: JSON.stringify(requestBody)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("capture-authorized-payment-failed", response.status, payload);
  }

  return payload;
}

export async function activateBillingPlan(planId) {
  const normalizedPlanId = readRequiredString(planId, "planId");
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/billing/plans/${encodeURIComponent(normalizedPlanId)}/activate`, {
    method: "POST",
    headers: buildJsonHeaders(token)
  });

  if (!response.ok) {
    const payload = await readJsonPayload(response);
    throw createPaypalError("activate-billing-plan-failed", response.status, payload);
  }

  // Response for activate is 204 No Content if successful
  return {
    success: true,
    statusCode: response.status
  };
}

export async function createBillingPlan(data = {}) {
  const token = await getAccessToken();
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v1/billing/plans`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: data.prefer || "return=representation",
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

export async function createSubscription(data = {}) {
  const token = await getAccessToken();
  const body = data.body || data;

  // Handle application_context for native/mobile flows
  if (data.native_app || data.mobile_web || data.application_context || data.return_url || data.cancel_url || data.returnUrl || data.cancelUrl) {
    body.application_context = body.application_context || {};
    if (data.native_app) body.application_context.native_app = data.native_app;
    if (data.mobile_web) body.application_context.mobile_web = data.mobile_web;
    if (data.return_url) body.application_context.return_url = data.return_url;
    if (data.cancel_url) body.application_context.cancel_url = data.cancel_url;
    if (data.returnUrl) body.application_context.return_url = data.returnUrl;
    if (data.cancelUrl) body.application_context.cancel_url = data.cancelUrl;
    if (data.application_context) Object.assign(body.application_context, data.application_context);
  }

  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      Prefer: data.prefer || "return=representation",
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

export async function getSubscription(id, query = {}) {
  const token = await getAccessToken();
  const url = new URL(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions/${id}`);
  
  if (query.fields) url.searchParams.append("fields", query.fields);

  const response = await paypalFetch(url.toString(), {
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

export async function listSubscriptionTransactions(id, query = {}) {
  const token = await getAccessToken();
  const url = new URL(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions/${id}/transactions`);
  
  if (query.startTime) url.searchParams.append("start_time", query.startTime);
  if (query.endTime) url.searchParams.append("end_time", query.endTime);

  const response = await paypalFetch(url.toString(), {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("list-subscription-transactions-failed", response.status, payload);
  }

  return payload;
}

export async function activateSubscription(id, reason = "Activating subscription") {
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions/${id}/activate`, {
    method: "POST",
    headers: buildJsonHeaders(token),
    body: JSON.stringify({ reason })
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

export async function suspendSubscription(id, reason = "Suspending subscription") {
  const token = await getAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions/${id}/suspend`, {
    method: "POST",
    headers: buildJsonHeaders(token),
    body: JSON.stringify({ reason })
  });

  if (response.status === 204) {
    return { success: true };
  }

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("suspend-subscription-failed", response.status, payload);
  }

  return payload || { success: true };
}

export async function captureSubscription(id, options = {}) {
  const token = await getAccessToken();
  const headers = buildJsonHeaders(token);
  if (options.paypalRequestId) {
    headers["PayPal-Request-Id"] = options.paypalRequestId;
  }

  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/billing/subscriptions/${id}/capture`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body || {})
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("capture-subscription-failed", response.status, payload);
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
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v3/vault/setup-tokens`, {
    method: "POST",
    headers: buildJsonHeaders(token, {
      "PayPal-Request-Id": data.requestId || data.paypalRequestId || crypto.randomUUID()
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
  const requestId = options.requestId || options.paypalRequestId || crypto.randomUUID();
  const headers = buildJsonHeaders(token, {
    "PayPal-Request-Id": requestId
  });

  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v3/vault/payment-tokens`, {
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

  const response = await paypalFetch(url.toString(), {
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
  
  const params = [
    "start_date", "end_date", "transaction_id", "transaction_type",
    "transaction_status", "transaction_amount", "transaction_currency",
    "payment_instrument_type", "store_id", "terminal_id", "fields",
    "balance_affecting_records_only", "page_size", "page"
  ];

  params.forEach(param => {
    const camelParam = param.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
    if (query[camelParam] !== undefined) {
      url.searchParams.append(param, query[camelParam]);
    } else if (query[param] !== undefined) {
      url.searchParams.append(param, query[param]);
    }
  });

  const response = await paypalFetch(url.toString(), {
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

export async function listBillingPlans(query = {}) {
  const token = await getAccessToken();
  const url = new URL(`${PAYPAL_API_BASE_URL}/v1/billing/plans`);
  
  if (query.productId) url.searchParams.append("product_id", query.productId);
  if (query.pageSize) url.searchParams.append("page_size", query.pageSize);
  if (query.page) url.searchParams.append("page", query.page);
  if (query.totalRequired !== undefined) url.searchParams.append("total_required", query.totalRequired);

  const response = await paypalFetch(url.toString(), {
    method: "GET",
    headers: buildJsonHeaders(token, {
      Prefer: query.prefer || "return=minimal"
    })
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("list-billing-plans-failed", response.status, payload);
  }

  return payload;
}

export async function listInvoices(query = {}) {
  const token = await getAccessToken();
  const url = new URL(`${PAYPAL_API_BASE_URL}/v1/invoicing/invoices`);

  if (query.page) url.searchParams.append("page", query.page);
  if (query.pageSize || query.page_size) url.searchParams.append("page_size", query.pageSize || query.page_size);
  if (query.totalCountRequired || query.total_count_required) {
    url.searchParams.append("total_count_required", query.totalCountRequired || query.total_count_required);
  }

  const response = await paypalFetch(url.toString(), {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("list-invoices-failed", response.status, payload);
  }

  return payload;
}

export async function createPartnerReferral(referralData) {
  const token = await getAccessToken();
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v2/customer/partner-referrals`, {
    method: "POST",
    headers: buildJsonHeaders(token),
    body: JSON.stringify(referralData)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("create-partner-referral-failed", response.status, payload);
  }

  return payload;
}

export async function getPartnerReferral(referralId) {
  const token = await getAccessToken();
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v2/customer/partner-referrals/${referralId}`, {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("get-partner-referral-failed", response.status, payload);
  }

  return payload;
}

export async function getMerchantIntegrationStatus(partnerId, merchantId) {
  const token = await getAccessToken();
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v1/customer/partners/${partnerId}/merchant-integrations/${merchantId}`, {
    method: "GET",
    headers: buildJsonHeaders(token)
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("get-merchant-integration-status-failed", response.status, payload);
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
  const response = await paypalFetch(`${PAYPAL_API_BASE_URL}/v1/notifications/verify-webhook-signature`, {
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

export function buildOrderRequest(orderDetails) {
  const amount = orderDetails.purchase_units?.[0]?.amount 
    ? normalizeAmount(orderDetails.purchase_units[0].amount)
    : (orderDetails.amount ? normalizeAmount(orderDetails.amount) : undefined);

  const description = readString(orderDetails.description || orderDetails.purchase_units?.[0]?.description) || "AW Roadside Service";
  const customId = readString(orderDetails.customId || orderDetails.purchase_units?.[0]?.custom_id) || undefined;
  const referenceId = readString(orderDetails.referenceId || orderDetails.purchase_units?.[0]?.reference_id) || undefined;

  const purchaseUnit = {
    amount,
    description,
    soft_descriptor: PAYPAL_SOFT_DESCRIPTOR
  };
  if (customId) {
    purchaseUnit.custom_id = customId;
  }
  if (referenceId) {
    purchaseUnit.reference_id = referenceId;
  }

  // Preserve other purchase unit fields if provided (items, shipping, etc.)
  if (orderDetails.purchase_units?.[0]) {
    const originalPU = orderDetails.purchase_units[0];
    if (originalPU.items) purchaseUnit.items = originalPU.items;
    if (originalPU.shipping) purchaseUnit.shipping = originalPU.shipping;
    if (originalPU.payee) purchaseUnit.payee = originalPU.payee;
  }

  const applicationContext = {
    brand_name: PAYPAL_BRAND_NAME,
    landing_page: "LOGIN",
    shipping_preference: "NO_SHIPPING",
    user_action: "PAY_NOW"
  };

  // Merge return/cancel URLs
  if (orderDetails.return_url) applicationContext.return_url = orderDetails.return_url;
  if (orderDetails.cancel_url) applicationContext.cancel_url = orderDetails.cancel_url;
  if (orderDetails.returnUrl) applicationContext.return_url = orderDetails.returnUrl;
  if (orderDetails.cancelUrl) applicationContext.cancel_url = orderDetails.cancelUrl;

  if (orderDetails.native_app) {
    applicationContext.native_app = orderDetails.native_app;
  }
  if (orderDetails.mobile_web) {
    applicationContext.mobile_web = orderDetails.mobile_web;
  }
  if (orderDetails.application_context) {
    Object.assign(applicationContext, orderDetails.application_context);
  }

  const request = {
    intent: orderDetails.intent || "CAPTURE",
    purchase_units: [purchaseUnit]
  };

  if (applicationContext.return_url || applicationContext.cancel_url || orderDetails.application_context) {
    request.application_context = applicationContext;
  }

  if (orderDetails.payment_source) {
    request.payment_source = orderDetails.payment_source;
  }

  if (orderDetails.customer) {
    request.customer = orderDetails.customer;
  }

  if (orderDetails.preferences) {
    request.preferences = orderDetails.preferences;
  }
  
  if (orderDetails.vault) {
    request.vault = orderDetails.vault;
  }

  return request;
}

function buildCaptureAuthorizedPaymentRequest(captureDetails) {
  const amount = captureDetails.amount ? normalizeAmount(captureDetails.amount) : undefined;
  const isFinalCapture = captureDetails.finalCapture === true || captureDetails.isFinalCapture === true;
  const note = readString(captureDetails.note || captureDetails.description);

  const request = {
    final_capture: isFinalCapture
  };
  if (amount) {
    request.amount = amount;
  }
  if (note) {
    request.note_to_payer = note;
  }
  return request;
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

async function paypalFetch(url, options = {}) {
  const fetchOptions = { ...options };
  
  // Proxy support could be implemented here if an agent library like https-proxy-agent was available.
  // For now, we provide the configuration constants (PAYPAL_PROXY_URL, etc.) and this wrapper
  // to centralize fetch calls for easier future proxy injection.
  if (PAYPAL_PROXY_URL) {
    console.log(`[DEBUG_LOG] PayPal request through proxy: ${PAYPAL_PROXY_URL}`);
    // If undici is used (Node 18+ default fetch), we could set a Dispatcher here.
    // fetchOptions.dispatcher = new ProxyAgent(PAYPAL_PROXY_URL);
  }

  return fetch(url, fetchOptions);
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
      readEnv("PAYPAL_CLIENT_SECRET")
    );
  }
  return readEnv("PAYPAL_CLIENT_SECRET");
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
  error.statusCode = statusCode;
  error.code = "paypal-request-failed";
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
