const backendUrl = normalizeBaseUrl(
  process.env.AW_BACKEND_URL ||
    process.env.BACKEND_URL ||
    "https://awroadside-fire-backend.onrender.com"
);

const requestId = readArg("--request-id") || process.env.AW_REQUEST_ID || "";
const orderId = readArg("--order-id") || process.env.PAYPAL_ORDER_ID || "";
const step = (readArg("--step") || process.env.PAYPAL_PRIORITY_STEP || "create-get").toLowerCase();

const defaultRequest = {
  requestId: requestId || `priority-${Date.now()}`,
  fullName: process.env.AW_CUSTOMER_NAME || "Priority Test Customer",
  phoneNumber: process.env.AW_CUSTOMER_PHONE || "5555550100",
  serviceType: process.env.AW_SERVICE_TYPE || "JUMP_START",
  location: process.env.AW_SERVICE_LOCATION || "2211 N First Street, San Jose, CA 95131",
  notes: process.env.AW_SERVICE_NOTES || "Priority PayPal order flow verification.",
  termsAccepted: true,
  noRefundPolicyAccepted: true,
  dispatchOnlyLiabilityAccepted: true,
  paymentKind: "priority",
  intent: "AUTHORIZE"
};

async function main() {
  if (step === "get") {
    requireOrderId();
    await getOrder(orderId);
    return;
  }

  if (step === "patch") {
    requireOrderId();
    await patchOrder(orderId, buildPatchPayload());
    await getOrder(orderId);
    return;
  }

  if (step === "authorize") {
    requireOrderId();
    await authorizeOrder(orderId, requestId);
    return;
  }

  if (step === "capture-authorization") {
    const authorizationId = readArg("--authorization-id") || process.env.PAYPAL_AUTHORIZATION_ID || "";
    if (!authorizationId) {
      throw new Error("Set --authorization-id or PAYPAL_AUTHORIZATION_ID for capture-authorization.");
    }
    await captureAuthorization(authorizationId);
    return;
  }

  if (step !== "create-get") {
    throw new Error(`Unknown step "${step}". Use create-get, get, patch, authorize, or capture-authorization.`);
  }

  const created = await createOrder(defaultRequest);
  await getOrder(created.orderId);
}

async function createOrder(payload) {
  const result = await requestJson("/payments/create-order", {
    method: "POST",
    body: payload
  });
  printJson("CREATE_ORDER", result);

  const approvalLink = findLink(result, "approve") || findLink(result.order, "approve");
  if (approvalLink) {
    console.log(`APPROVAL_LINK=${approvalLink}`);
  } else {
    console.log("APPROVAL_LINK not returned by backend response. Use Get Order to inspect links.");
  }
  console.log(`PAYPAL_ORDER_ID=${result.orderId || ""}`);
  console.log(`AW_REQUEST_ID=${payload.requestId || ""}`);
  return result;
}

async function getOrder(id) {
  const result = await requestJson(`/payments/orders/${encodeURIComponent(id)}`, {
    method: "GET"
  });
  printJson("GET_ORDER", result);
  const approvalLink = findLink(result.order, "approve");
  if (approvalLink) {
    console.log(`APPROVAL_LINK=${approvalLink}`);
  }
  return result;
}

async function patchOrder(id, patches) {
  const result = await requestJson(`/payments/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patches
  });
  printJson("PATCH_ORDER", result);
  return result;
}

async function authorizeOrder(id, linkedRequestId) {
  const result = await requestJson("/payments/authorize-order", {
    method: "POST",
    body: {
      orderId: id,
      requestId: linkedRequestId || null,
      paymentKind: "priority"
    }
  });
  printJson("AUTHORIZE_ORDER", result);
  console.log(`PAYPAL_AUTHORIZATION_ID=${result.authorizationId || ""}`);
  return result;
}

async function captureAuthorization(authorizationId) {
  const result = await requestJson(`/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, {
    method: "POST",
    body: {
      final_capture: true
    }
  });
  printJson("CAPTURE_AUTHORIZATION", result);
  return result;
}

function buildPatchPayload() {
  const description = process.env.AW_ORDER_DESCRIPTION || "Priority roadside service authorization";
  const referenceId = requestId || process.env.AW_REQUEST_ID || "";
  if (!referenceId) {
    return [
      {
        op: "replace",
        path: "/purchase_units/@reference_id=='default'/description",
        value: description
      }
    ];
  }
  return [
    {
      op: "replace",
      path: `/purchase_units/@reference_id=='${referenceId}'/description`,
      value: description
    }
  ];
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${backendUrl}/api/aw-roadside${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(process.env.AW_SESSION_TOKEN ? { Authorization: `Bearer ${process.env.AW_SESSION_TOKEN}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload.message || payload.error || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function findLink(payload, rel) {
  const links = Array.isArray(payload?.links) ? payload.links : [];
  const match = links.find((link) => String(link.rel || "").toLowerCase() === rel);
  return match?.href || "";
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return "";
  }
  return process.argv[index + 1] || "";
}

function requireOrderId() {
  if (!orderId) {
    throw new Error("Set --order-id or PAYPAL_ORDER_ID.");
  }
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function printJson(label, value) {
  console.log(`\n${label}`);
  console.log(JSON.stringify(value, null, 2));
}

main().catch((error) => {
  console.error("PAYPAL_PRIORITY_FLOW_FAILED");
  console.error(error.message);
  if (error.payload) {
    console.error(JSON.stringify(error.payload, null, 2));
  }
  process.exitCode = 1;
});
