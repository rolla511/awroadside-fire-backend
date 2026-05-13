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

export async function getAccessToken() {
  requireCredentials();

  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/oauth2/token`, {
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
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPaypalError("token-request-failed", response.status, payload);
  }

  const accessToken = readString(payload.access_token);
  if (!accessToken) {
    throw new Error("PayPal token response did not include an access_token.");
  }

  return accessToken;
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

  return {
    intent: "CAPTURE",
    purchase_units: [purchaseUnit],
    application_context: {
      brand_name: PAYPAL_BRAND_NAME,
      landing_page: "LOGIN",
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW"
    }
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
