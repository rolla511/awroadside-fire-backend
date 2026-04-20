import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as paypal from "./paypal-client.mjs";
import { createAdminController } from "./admin-controller.mjs";
import { createAwRoadsideSecurityController } from "./aw-roadside-security.mjs";
import { createCompatibilityGateway } from "./compatibility-gateway.mjs";
import { createLocalWatchdog } from "./local-watchdog.mjs";
import { createRequestServiceController } from "./request-service-controller.mjs";
import { createRuntimeRepository } from "./runtime-repository.mjs";
import { createSubscriptionController } from "./subscription-controller.mjs";
import { createUniversalBridgeController } from "./universal-bridge-controller.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const webRoot = path.join(projectRoot, "web");
const appRoot = path.join(projectRoot, "app");
const runtimeRoot = resolveRuntimeRoot();
const reportsRoot = path.join(runtimeRoot, "reports");
const logsRoot = path.join(runtimeRoot, "logs");
const paymentsRoot = path.join(runtimeRoot, "payments");
const requestsRoot = path.join(runtimeRoot, "requests");
const authRoot = path.join(runtimeRoot, "auth");
const requestServiceCacheRoot = path.join(runtimeRoot, "request-service-cache");
const providerDocumentsRoot = path.join(runtimeRoot, "provider-documents");
const paymentLogPath = path.join(paymentsRoot, "paypal-orders.jsonl");
const requestLogPath = path.join(requestsRoot, "service-requests.jsonl");
const usersPath = path.join(authRoot, "users.json");
const PROVIDER_DOCUMENT_TYPES = ["license", "registration", "insurance", "helperId"];
const ALLOWED_PROVIDER_DOCUMENT_CONTENT_TYPES = new Map([
  ["text/plain", ".txt"],
  ["image/jpeg", ".jpeg"]
]);
const subscriberMonthlyFee = Number.parseFloat(process.env.SUBSCRIBER_MONTHLY_FEE || "5");
const providerMonthlyFee = Number.parseFloat(process.env.PROVIDER_MONTHLY_FEE || "5.99");
const PROVIDER_ASSESSMENT_QUESTIONS = [
  { id: "jumpstartProcedure", prompt: "How do you safely perform a jumpstart?" },
  { id: "jackPlacement", prompt: "Where do you place a jack on a car?" },
  { id: "specialtyVehicleJack", prompt: "What type of jack do you use on BMW, van, truck, or Benz platforms?" },
  { id: "spoolDefinition", prompt: "What is a spool?" },
  { id: "frozenLugNut", prompt: "How do you remove a frozen lug nut?" },
  { id: "lockoutTools", prompt: "What tools do you use to perform a lockout?" },
  { id: "lockoutDamagePrevention", prompt: "What is the best way to prevent damage to a vehicle while performing a lockout?" },
  { id: "incorrectLockoutDamage", prompt: "What damages can happen if your perform a lockout incoorectly ?" },
  { id: "tirePlugKnowledge", prompt: "Do you know how to plug a tire?" },
  {
    id: "severeDamageDecision",
    prompt:
      "If perfoming a service for a customer and it can cause sever damage to the customer property or person do you complete the service or inform the customer of the possible damage and mark the service as complete"
  }
];
const AW_ROADSIDE_POLICY = Object.freeze({
  variantId: "awroadside-fire",
  termsVersion: "2026-04-18",
  platform: {
    liability: "dispatch-only",
    holdHarmless:
      "Subscribers and providers agree to hold the managing AW Roadside platform harmless for provider-contracted services."
  },
  subscriber: {
    monthlyFee: subscriberMonthlyFee,
    termsVersion: "subscriber-2026-04-18",
    platformLiability: "The platform is liable for dispatch coordination only.",
    noRefundPolicy:
      "No refund policy once payment is submitted. Subscriber use of service forms a contracted agreement to manage a transaction or service.",
    workflow: [
      "sign-up",
      "membership-activation",
      "request",
      "eta-acceptance",
      "service-payment",
      "arrival-confirmation",
      "completion-confirmation"
    ]
  },
  provider: {
    monthlyFee: providerMonthlyFee,
    termsVersion: "provider-2026-04-18",
    liabilityStatement:
      "Independent providers are responsible for civil or criminal damages resulting from their services.",
    assessmentQuestions: PROVIDER_ASSESSMENT_QUESTIONS
  },
  financial: {
    noRefundsAfterPayment: true,
    payoutLedgerEnabled: true,
    platformServiceChargeRate: 0.02
  },
  requestLifecycle: [
    "SUBMITTED",
    "ASSIGNED",
    "EN_ROUTE",
    "ARRIVED",
    "COMPLETED"
  ]
});

const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10);
const startedAt = new Date();
const publicBaseUrl = resolvePublicBaseUrl();
const paypalMode = (process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live" ? "live" : "sandbox";
const paypalClientId = process.env.PAYPAL_CLIENT_ID || "";
const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET || "";
const paypalPlatformId = process.env.PAYPAL_PLATFORM_ID || "";
const priorityServicePrice = Number.parseFloat(process.env.PRIORITY_SERVICE_PRICE || "25");
const serviceBasePrice = Number.parseFloat(process.env.SERVICE_BASE_PRICE || "55");
const guestServicePrice = Number.parseFloat(process.env.GUEST_SERVICE_PRICE || `${serviceBasePrice}`);
const subscriberServicePrice = Number.parseFloat(process.env.SUBSCRIBER_SERVICE_PRICE || "40");
const assignmentFee = Number.parseFloat(process.env.PROVIDER_ASSIGNMENT_FEE || "2");
const guestDispatchFee = Number.parseFloat(process.env.GUEST_DISPATCH_FEE || "10");
const subscriberDispatchFee = Number.parseFloat(process.env.SUBSCRIBER_DISPATCH_FEE || "0");
const sessionSecret = process.env.AW_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const sessionTtlMs = Number.parseInt(process.env.AW_SESSION_TTL_MS || `${12 * 60 * 60 * 1000}`, 10);
const watchdogIntervalMs = Number.parseInt(process.env.AW_WATCHDOG_INTERVAL_MS || `${5 * 60 * 1000}`, 10);
const userSessions = new Map();
let userMutationQueue = Promise.resolve();
let requestMutationQueue = Promise.resolve();
const adminController = createAdminController();
const compatibilityGateway = createCompatibilityGateway();
const requestServiceController = createRequestServiceController({
  cacheRoot: requestServiceCacheRoot,
  fallbackApiBaseUrl: publicBaseUrl,
  fallbackApiStyle: "roadside-backend"
});
const subscriptionController = createSubscriptionController();
const localWatchdog = createLocalWatchdog({
  projectRoot,
  runtimeRoot
});
const universalBridgeController = createUniversalBridgeController();
const runtimeRepository = createRuntimeRepository({
  runtimeRoot
});
const awRoadsideSecurityController = createAwRoadsideSecurityController({
  requestServiceController,
  localWatchdog
});

await runtimeRepository.initialize();
await localWatchdog.initialize();
await localWatchdog.scanAndRecord();
localWatchdog.startPeriodicScan(watchdogIntervalMs);
await writeRuntimeArtifacts();

const server = http.createServer(async (req, res) => {
  try {
    applyHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!req.url) {
      sendJson(res, 400, { error: "bad-request" });
      return;
    }

    const url = new URL(req.url, `http://${host}:${port}`);
    const pathname = url.pathname;
    const commonHelpers = {
      readJsonBody,
      sendJson,
      sendMethodNotAllowed,
      readUsers,
      writeUsers,
      mutateUsers,
      mutateRequests,
      allocateUserId,
      readPaymentLog,
      updateRequestRecord,
      readCacheJson,
      writeCacheJson,
      deleteFile,
      listCacheFiles,
      appendPaymentLog,
      normalizeServiceRequest,
      normalizeServicePaymentRequest,
      createServicePaymentQuote,
      createServiceRequest,
      createPaypalOrder,
      capturePaypalOrder,
      resolveUserSession,
      revokeUserSession,
      issueUserSession,
      getUserProfile,
      readRequestLog,
      writeRequestLog,
      applyLocalRequestAction,
      getHealthPayload,
      getPaymentConfigPayload,
      getFrontendConfigPayload: (request) => getFrontendConfigPayload(request),
      getRoadsidePolicy: () => AW_ROADSIDE_POLICY,
      getWatchdogStatus: () => localWatchdog.getStatus(),
      recordSecurityEvent: (event, details) => localWatchdog.record(event, details),
      saveProviderDocuments: (userId, currentDocuments, documentsPayload) =>
        saveProviderDocuments(userId, currentDocuments, documentsPayload),
      recordCompatibilityAccess: (capability, descriptor, details) =>
        runtimeRepository.recordCapabilityAccess(capability, descriptor, details),
      getCompatibilityRepository: () => runtimeRepository.getSnapshot(),
      getCompatibilityManifest: () => runtimeRepository.getManifest(),
      acknowledgeCompatibilityVariant: (payload) => runtimeRepository.acknowledgeVariant(payload),
      getProtectedApiBaseUrl: (request) => getProtectedApiBaseUrl(request),
      getRequestBaseUrl: (request) => resolveRequestBaseUrl(request)
    };

    const adminHandled = await adminController.handle(req, res, pathname, {
      ...commonHelpers,
      paymentsConfigured: () => Boolean(paypalClientId && paypalClientSecret),
      startedAt: startedAt.toISOString()
    });
    if (adminHandled) {
      return;
    }

    const compatibilityHandled = await compatibilityGateway.handle(req, res, pathname, commonHelpers);
    if (compatibilityHandled) {
      return;
    }

    const awRoadsideHandled = await awRoadsideSecurityController.handle(req, res, pathname, commonHelpers);
    if (awRoadsideHandled) {
      return;
    }

    const requestServiceHandled = await requestServiceController.handle(req, res, pathname, {
      ...commonHelpers
    });
    if (requestServiceHandled) {
      return;
    }

    const universalBridgeHandled = await universalBridgeController.handle(req, res, pathname, {
      ...commonHelpers
    });
    if (universalBridgeHandled) {
      return;
    }

    const subscriptionHandled = await subscriptionController.handle(req, res, pathname, {
      ...commonHelpers
    });
    if (subscriptionHandled) {
      return;
    }

    if (pathname === "/api/health") {
      sendJson(res, 200, await getHealthPayload());
      return;
    }

    if (pathname === "/api/frontend-config") {
      sendJson(res, 200, await getFrontendConfigPayload(req));
      return;
    }

    if (pathname === "/api/integration-target") {
      sendJson(res, 200, getIntegrationTargetPayload(req));
      return;
    }

    if (pathname === "/api/runtime/status") {
      sendJson(res, 200, await createRuntimeStatus());
      return;
    }

    if (pathname === "/api/runtime/files") {
      sendJson(res, 200, {
        root: "app",
        files: await listFiles(appRoot)
      });
      return;
    }

    if (pathname === "/api/payments/config") {
      sendJson(res, 200, await getPaymentConfigPayload());
      return;
    }

    if (pathname === "/api/requests") {
      if (req.method === "POST") {
        const payload = await readJsonBody(req);
        const normalizedRequest = normalizeServiceRequest(payload);
        const savedRequest = await createServiceRequest(normalizedRequest);
        sendJson(res, 201, {
          requestId: savedRequest.id,
          status: savedRequest.status,
          paymentStatus: savedRequest.paymentStatus,
          request: savedRequest
        });
        return;
      }

      if (req.method === "GET") {
        sendJson(res, 200, {
          requests: await readRequestLog()
        });
        return;
      }

      sendMethodNotAllowed(res, "GET, POST");
      return;
    }

    if (pathname === "/api/payments/create-order") {
      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
        sendJson(res, 503, {
          error: "paypal-not-configured",
          message: "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET before creating orders."
        });
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const normalizedRequest = normalizeServiceRequest(payload);
        const order = await createPaypalOrder(normalizedRequest);

        await appendPaymentLog({
          event: "order-created",
          request: normalizedRequest,
          paypalOrderId: order.id,
          status: order.status,
          createdAt: new Date().toISOString()
        });
        if (normalizedRequest.requestId) {
          await updateRequestRecord(normalizedRequest.requestId, (request) => ({
            ...request,
            amountCharged: Number(normalizedRequest.amount?.value || 0),
            paymentStatus: "ORDER_CREATED",
            lastPaymentOrderId: order.id
          }));
        }

        sendJson(res, 201, {
          orderId: order.id,
          status: order.status
        });
      } catch (error) {
        console.error('[ERROR] Create Order Route Failed:', error);
        sendJson(res, 500, {
          error: "paypal-create-failed",
          message: error.message
        });
      }
      return;
    }

    if (pathname === "/api/payments/capture-order") {
      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
        sendJson(res, 503, {
          error: "paypal-not-configured",
          message: "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET before capturing orders."
        });
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
        if (!orderId) {
          sendJson(res, 400, {
            error: "invalid-order-id",
            message: "A PayPal orderId is required."
          });
          return;
        }

        const capture = await capturePaypalOrder(orderId);
        await appendPaymentLog({
          event: "order-captured",
          paypalOrderId: orderId,
          status: capture.status,
          capturedAt: new Date().toISOString(),
          capture
        });
        if (typeof payload.requestId === "string" && payload.requestId.trim()) {
          await updateRequestRecord(payload.requestId, (request) => ({
            ...request,
            paymentStatus: "CAPTURED",
            amountCollected: Number(request.amountCharged || request.amountCollected || 0),
            lastPaymentOrderId: orderId
          }));
        }

        sendJson(res, 200, {
          status: capture.status,
          orderId,
          capture
        });
      } catch (error) {
        console.error('[ERROR] Capture Order Route Failed:', error);
        sendJson(res, 500, {
          error: "paypal-capture-failed",
          message: error.message
        });
      }
      return;
    }

    const requestActionMatch = pathname.match(/^\/api\/requests\/([^/]+)\/([^/]+)$/);
    if (requestActionMatch) {
      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      const payload = await readJsonBody(req);
      const requestId = decodeURIComponent(requestActionMatch[1]);
      const action = decodeURIComponent(requestActionMatch[2]);
      const updatedRequest = await applyLocalRequestAction(requestId, action, payload);
      sendJson(res, 200, {
        requestId: updatedRequest.id,
        action,
        accepted: true,
        committed: true,
        status: updatedRequest.status,
        request: updatedRequest
      });
      return;
    }

    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    const candidate = path.normalize(path.join(webRoot, relativePath));
    if (candidate.startsWith(webRoot)) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          const body = await fs.readFile(candidate);
          res.writeHead(200, { "Content-Type": contentType(candidate) });
          res.end(body);
          return;
        }
      } catch {
        // Fall through to SPA entrypoint below.
      }
    }

    const indexPath = path.join(webRoot, "index.html");
    const indexBody = await fs.readFile(indexPath);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(indexBody);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, Number.isInteger(error?.statusCode) ? error.statusCode : 500, {
      error: error?.code || "internal-server-error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, host, () => {
  console.log(`Local runtime running at http://${host}:${port}`);
  console.log(`Health endpoint: http://${host}:${port}/api/health`);
  console.log(`Runtime status: http://${host}:${port}/api/runtime/status`);
  console.log(`Serving static files from ${webRoot}`);
  console.log(`Runtime artifacts in ${runtimeRoot}`);
});

async function writeRuntimeArtifacts() {
  await fs.mkdir(reportsRoot, { recursive: true });
  await fs.mkdir(logsRoot, { recursive: true });
  await fs.mkdir(paymentsRoot, { recursive: true });
  await fs.mkdir(requestsRoot, { recursive: true });
  await fs.mkdir(authRoot, { recursive: true });
  await fs.mkdir(requestServiceCacheRoot, { recursive: true });
  await fs.mkdir(providerDocumentsRoot, { recursive: true });

  const manifest = {
    app: "local-node-runtime",
    host,
    port,
    startedAt: startedAt.toISOString(),
    uiUrl: `${publicBaseUrl}/`,
    apiUrl: `${publicBaseUrl}/api/aw-roadside/frontend-config`,
    protectedApiBaseUrl: `${publicBaseUrl}/api/aw-roadside`
  };

  await fs.writeFile(
    path.join(runtimeRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  await fs.writeFile(
    path.join(reportsRoot, "startup-report.txt"),
    [
      "Local Runtime Startup Report",
      `Started: ${startedAt.toLocaleString()}`,
      `UI: ${publicBaseUrl}/`,
      `API: ${publicBaseUrl}/api/aw-roadside/frontend-config`,
      `Protected API: ${publicBaseUrl}/api/aw-roadside`,
      `Runtime Folder: ${runtimeRoot}`,
      `Watchdog Status: ${path.join(runtimeRoot, "security", "latest-status.json")}`,
      `PayPal Mode: ${paypalMode}`,
      `PayPal Configured: ${paypalClientId && paypalClientSecret ? "yes" : "no"}`
    ].join("\n")
  );

  await fs.writeFile(
    path.join(logsRoot, "session.log"),
    `[${startedAt.toISOString()}] Runtime initialized for ${host}:${port}\n`
  );
}

async function createRuntimeStatus() {
  return {
    status: "running",
    host,
    port,
    startedAt: startedAt.toISOString(),
    uiUrl: `${publicBaseUrl}/`,
    apiBaseUrl: `${publicBaseUrl}/api`,
    protectedApiBaseUrl: `${publicBaseUrl}/api/aw-roadside`,
    projectFolders: [
      "backend",
      "web",
      "app/runtime",
      "app/runtime/reports",
      "app/runtime/logs",
      "app/runtime/payments",
      "app/runtime/requests",
      "app/runtime/auth",
      "app/runtime/request-service-cache",
      "app/runtime/provider-documents",
      "dist"
    ],
    payments: {
      provider: "paypal",
      mode: paypalMode,
      configured: Boolean(paypalClientId && paypalClientSecret)
    },
    watchdog: {
      active: true,
      intervalMs: watchdogIntervalMs,
      latestStatusPath: path.join(runtimeRoot, "security", "latest-status.json")
    }
  };
}

async function listFiles(rootDir) {
  const output = [];
  await walk(rootDir, rootDir, output);
  output.sort();
  return output;
}

async function walk(rootDir, currentDir, output) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walk(rootDir, fullPath, output);
      continue;
    }
    output.push(path.relative(rootDir, fullPath).replaceAll(path.sep, "/"));
  }
}

function applyHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Location-Zone, X-2FA-Verified, X-WP-Nonce"
  );
}

function sendJson(res, statusCode, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function sendMethodNotAllowed(res, allowedMethod) {
  res.setHeader("Allow", allowedMethod);
  sendJson(res, 405, {
    error: "method-not-allowed",
    message: `Use ${allowedMethod} for this endpoint.`
  });
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function normalizeServiceRequest(payload) {
  const fullName = readRequiredString(payload.fullName, "fullName");
  const phoneNumber = readRequiredString(payload.phoneNumber, "phoneNumber");
  const serviceType = readRequiredString(payload.serviceType, "serviceType");
  const location = readRequiredString(payload.location, "location");
  const notes = readOptionalString(payload.notes);
  const requestId = readOptionalString(payload.requestId);
  const vehicleInfo = normalizeVehicleInfo(payload.vehicleInfo);
  const assignedProviderId = readOptionalString(payload.assignedProviderId);
  const userId = Number.isInteger(payload.userId) ? payload.userId : null;
  const roles = Array.isArray(payload.roles) ? payload.roles.filter((value) => typeof value === "string") : [];
  const subscriberActive = Boolean(payload.subscriberActive);
  const customerTier = resolveCustomerTier({ roles, subscriberActive });
  const pricing = resolveServicePricing({ roles, subscriberActive, customerTier });
  const termsAccepted = Boolean(
    payload.termsAccepted ||
    payload.subscriberTermsAccepted ||
    payload.guestTermsAccepted ||
    payload.dispatchOnlyLiabilityAccepted
  );
  const noRefundPolicyAccepted = Boolean(payload.noRefundPolicyAccepted || customerTier === "SUBSCRIBER");
  const dispatchOnlyLiabilityAccepted = Boolean(
    payload.dispatchOnlyLiabilityAccepted || customerTier === "SUBSCRIBER"
  );

  return {
    ...(requestId ? { requestId } : {}),
    ...(userId !== null ? { userId } : {}),
    ...(roles.length ? { roles } : {}),
    subscriberActive,
    customerTier,
    pricing,
    fullName,
    phoneNumber,
    serviceType,
    location,
    notes,
    ...(vehicleInfo ? { vehicleInfo } : {}),
    ...(assignedProviderId ? { assignedProviderId } : {}),
    termsAccepted,
    noRefundPolicyAccepted,
    dispatchOnlyLiabilityAccepted,
    liabilityNotice: AW_ROADSIDE_POLICY.platform.holdHarmless,
    amount: {
      currency_code: "USD",
      value: priorityServicePrice.toFixed(2)
    }
  };
}

function resolveCustomerTier(request) {
  if (request?.customerTier === "SUBSCRIBER") {
    return "SUBSCRIBER";
  }
  if (Boolean(request?.subscriberActive)) {
    return "SUBSCRIBER";
  }
  if (Array.isArray(request?.roles) && request.roles.includes("SUBSCRIBER")) {
    return "SUBSCRIBER";
  }
  return "GUEST";
}

function resolveServicePricing(request) {
  const customerTier = resolveCustomerTier(request);
  const serviceCharge = customerTier === "SUBSCRIBER" ? subscriberServicePrice : guestServicePrice;
  const dispatchFee = customerTier === "SUBSCRIBER" ? subscriberDispatchFee : guestDispatchFee;
  const serviceChargeRate = AW_ROADSIDE_POLICY?.financial?.platformServiceChargeRate || 0.02;

  let platformShare;
  let providerPayout;

  if (customerTier === "SUBSCRIBER") {
    // Subscriber: $40 total - $2 assignment - 2% service rate
    const platformPercentageCharge = Number((serviceCharge * serviceChargeRate).toFixed(2));
    platformShare = assignmentFee + platformPercentageCharge;
    providerPayout = serviceCharge - platformShare;
  } else {
    // Guest: $55 total - $10 dispatch - $2 assignment = $43 payout
    platformShare = dispatchFee + assignmentFee;
    providerPayout = serviceCharge - platformShare;
  }

  return {
    customerTier,
    serviceCharge,
    dispatchFee,
    assignmentFee,
    platformShare,
    providerPayout,
    serviceTaxAmount: 0,
    providerTaxWithheld: false
  };
}

function readRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Field "${fieldName}" is required.`);
  }
  return value.trim();
}

function readOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function getHealthPayload() {
  return {
    status: "ok",
    service: "local-node-runtime",
    timestamp: new Date().toISOString(),
    policyVersion: AW_ROADSIDE_POLICY.termsVersion
  };
}

async function getPaymentConfigPayload() {
  return {
    provider: "paypal",
    enabled: Boolean(paypalClientId && paypalClientSecret),
    clientId: paypalClientId || null,
    currency: "USD",
    intent: "CAPTURE",
    mode: paypalMode,
    priorityServicePrice,
    guestServicePrice,
    subscriberServicePrice,
    subscriberMonthlyFee,
    providerMonthlyFee,
    assignmentFee,
    guestDispatchFee,
    subscriberDispatchFee,
    noRefundPolicy: AW_ROADSIDE_POLICY.financial.noRefundsAfterPayment,
    dispatchOnlyLiability: AW_ROADSIDE_POLICY.platform.liability
  };
}

async function getUserProfile(userId) {
  const users = await readUsers();
  const user = users.find((entry) => entry.id === Number(userId));
  if (!user) {
    throw new Error("User not found.");
  }

  const providerRating = calculateProviderRatingSummary(user);
  const providerSelection = calculateProviderSelectionSummary(user);

  return {
    userId: user.id,
    fullName: user.fullName || "",
    username: user.username || "",
    email: user.email || "",
    phoneNumber: user.phoneNumber || "",
    roles: Array.isArray(user.roles) ? user.roles : [],
    providerStatus: user.providerStatus || null,
    providerProfile: user.providerProfile || null,
    providerMonthly: user.providerMonthly || 5.99,
    services: Array.isArray(user.services) ? user.services : [],
    available: Boolean(user.available),
    activeShiftId: user.activeShiftId || null,
    providerRating,
    providerSelection,
    subscriberActive: Boolean(user.subscriberActive),
    subscriberProfile: user.subscriberProfile || null,
    savedVehicles: Array.isArray(user.subscriberProfile?.savedVehicles)
      ? user.subscriberProfile.savedVehicles
      : user.subscriberProfile?.vehicle
        ? [user.subscriberProfile.vehicle]
        : [],
    accountState: user.accountState || "ACTIVE",
    nextBillingDate: user.nextBillingDate || null,
    signUpDate: user.signUpDate || user.createdAt || null,
    terms: user.terms || {},
    trustedZone: user.trustedZone || null,
    createdAt: user.createdAt || null
  };
}

async function getFrontendConfigPayload(req = null) {
  const baseUrl = resolveRequestBaseUrl(req);
  return {
    apiBaseUrl: `${baseUrl}/api/aw-roadside`,
    rawApiBaseUrl: `${baseUrl}/api`,
    uiBaseUrl: baseUrl,
    expectedHtmlIntegrationPath: "web/index.html",
    syncMode: "local",
    runtimeFolder: "app/runtime",
    paypalEnabled: Boolean(paypalClientId && paypalClientSecret),
    priorityServicePrice,
    serviceBasePrice,
    guestServicePrice,
    subscriberServicePrice,
    subscriberMonthlyFee,
    providerMonthlyFee,
    assignmentFee,
    guestDispatchFee,
    subscriberDispatchFee,
    noRefundPolicy: AW_ROADSIDE_POLICY.financial.noRefundsAfterPayment,
    policyVersion: AW_ROADSIDE_POLICY.termsVersion,
    compatibilityGatewayUrl: `${baseUrl}/api/compat/status`,
    compatibilityManifestUrl: `${baseUrl}/api/compat/manifest`,
    compatibilityRepositoryUrl: `${baseUrl}/api/compat/repository`,
    securityLayer: "aw-roadside-security"
  };
}

function createServicePaymentQuote(request) {
  const requestId = readOptionalString(request?.requestId || request?.id);
  if (!requestId) {
    throw new Error("A backend requestId is required before service payment.");
  }

  const etaMinutes = Number.isFinite(Number(request?.etaMinutes)) ? Number(request.etaMinutes) : null;
  const status = readOptionalString(request?.status).toUpperCase();
  if (etaMinutes === null && !["EN_ROUTE", "ARRIVED", "COMPLETED"].includes(status)) {
    const error = new Error("Service payment is locked until a provider hard ETA is recorded.");
    error.statusCode = 409;
    error.code = "hard-eta-required";
    throw error;
  }
  if (!request?.customerEtaAcceptedAt) {
    const error = new Error("Service payment is locked until the customer accepts the hard ETA.");
    error.statusCode = 409;
    error.code = "customer-eta-acceptance-required";
    throw error;
  }

  const pricing = resolveServicePricing(request);

  return {
    quoteId: `service:${requestId}:${status || "ETA"}:${etaMinutes ?? "confirmed"}:${pricing.serviceCharge.toFixed(2)}`,
    requestId,
    paymentKind: "service",
    serviceType: request.serviceType || "Roadside Service",
    status,
    etaMinutes,
    customerTier: pricing.customerTier,
    pricing,
    amount: {
      currency_code: "USD",
      value: pricing.serviceCharge.toFixed(2)
    },
    priceSource: "backend",
    agreementRequired: true,
    noRefundPolicy: AW_ROADSIDE_POLICY.subscriber.noRefundPolicy,
    platformLiability: AW_ROADSIDE_POLICY.platform.liability,
    providerLiability: AW_ROADSIDE_POLICY.provider.liabilityStatement,
    terms:
      "Service payment can be created only after the backend records a provider hard ETA and the customer accepts this backend quote."
  };
}

function normalizeServicePaymentRequest(payload, request, quote) {
  if (payload?.quoteAccepted !== true) {
    const error = new Error("Customer must accept the backend service quote before service payment.");
    error.statusCode = 409;
    error.code = "service-quote-not-accepted";
    throw error;
  }
  if (payload?.quoteId !== quote.quoteId) {
    const error = new Error("Service payment quote does not match the current backend quote.");
    error.statusCode = 409;
    error.code = "service-quote-mismatch";
    throw error;
  }

  return {
    fullName: readOptionalString(request.fullName) || "Roadside Customer",
    phoneNumber: readOptionalString(request.phoneNumber),
    serviceType: request.serviceType || "Roadside Service",
    location: request.location || "",
    notes: request.notes || "",
    amount: quote.amount,
    requestId: quote.requestId,
    paymentKind: "service",
    quoteId: quote.quoteId
  };
}

function getIntegrationTargetPayload(req = null) {
  const baseUrl = resolveRequestBaseUrl(req);
  return {
    status: "ready",
    message: "Use the integrated AW Roadside runtime frontend and protected API.",
    expectedPayload: {
      htmlFile: "web/index.html",
      mountSelector: ".page-shell",
      apiConsumer: `fetch('${baseUrl}/api/aw-roadside/health')`
    },
    expectedHtmlIntegrationPath: "web/index.html",
    uiBaseUrl: baseUrl,
    apiBaseUrl: `${baseUrl}/api/aw-roadside`,
    rawApiBaseUrl: `${baseUrl}/api`,
    policyVersion: AW_ROADSIDE_POLICY.termsVersion
  };
}

function normalizeVehicleInfo(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const parts = [value.year, value.make, value.model, value.color]
    .map((entry) => readOptionalString(entry))
    .filter(Boolean);
  return parts.join(" ").trim();
}

function getProtectedApiBaseUrl(req = null) {
  return `${resolveRequestBaseUrl(req)}/api/aw-roadside`;
}

function resolveRequestBaseUrl(req = null) {
  if (req?.headers?.host) {
    const protoHeader = req.headers["x-forwarded-proto"];
    const proto = typeof protoHeader === "string" && protoHeader.trim() ? protoHeader.trim().split(",")[0] : "http";
    return `${proto}://${req.headers.host}`;
  }
  return publicBaseUrl;
}

function resolvePublicBaseUrl() {
  const configuredBaseUrl = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const fallbackHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  return `http://${fallbackHost}:${port}`;
}

function resolveRuntimeRoot() {
  const configuredRuntimeRoot = (process.env.RUNTIME_ROOT || "").trim();
  if (!configuredRuntimeRoot) {
    return path.join(appRoot, "runtime");
  }

  return path.isAbsolute(configuredRuntimeRoot)
    ? configuredRuntimeRoot
    : path.resolve(projectRoot, configuredRuntimeRoot);
}

async function saveProviderDocuments(userId, currentDocuments = {}, documentsPayload = {}) {
  if (!Number.isInteger(Number(userId))) {
    throw new Error("A valid provider userId is required for document storage.");
  }

  const normalizedCurrent = normalizeStoredProviderDocuments(currentDocuments);
  const nextDocuments = { ...normalizedCurrent };
  const userDocumentsRoot = path.join(providerDocumentsRoot, `${Number(userId)}`);
  await fs.mkdir(userDocumentsRoot, { recursive: true });

  for (const docType of PROVIDER_DOCUMENT_TYPES) {
    if (!(docType in documentsPayload)) {
      continue;
    }

    const nextValue = documentsPayload[docType];
    const previous = normalizedCurrent[docType];
    nextDocuments[docType] = await storeSingleProviderDocument(userDocumentsRoot, docType, nextValue, previous);
  }

  return nextDocuments;
}

function normalizeStoredProviderDocuments(documents = {}) {
  const normalized = {};
  for (const docType of PROVIDER_DOCUMENT_TYPES) {
    normalized[docType] = normalizeStoredProviderDocument(documents?.[docType]);
  }
  return normalized;
}

function normalizeStoredProviderDocument(value) {
  if (value === true) {
    return {
      submitted: true,
      verified: false,
      uploadedAt: null,
      fileName: null,
      contentType: null,
      sizeBytes: 0,
      storagePath: null,
      sourceUrl: null,
      documentNumber: null,
      expiresAt: null,
      note: null
    };
  }

  if (!value || value === false) {
    return {
      submitted: false,
      verified: false,
      uploadedAt: null,
      fileName: null,
      contentType: null,
      sizeBytes: 0,
      storagePath: null,
      sourceUrl: null,
      documentNumber: null,
      expiresAt: null,
      note: null
    };
  }

  if (typeof value !== "object") {
    return normalizeStoredProviderDocument(Boolean(value));
  }

  return {
    submitted: Boolean(value.submitted ?? value.uploadedAt ?? value.fileName ?? value.storagePath ?? value.sourceUrl),
    verified: Boolean(value.verified),
    uploadedAt: optionalIsoString(value.uploadedAt),
    fileName: optionalString(value.fileName) || null,
    contentType: optionalString(value.contentType) || null,
    sizeBytes: Number.isFinite(Number(value.sizeBytes)) ? Number(value.sizeBytes) : 0,
    storagePath: optionalString(value.storagePath) || null,
    sourceUrl: optionalString(value.sourceUrl) || null,
    documentNumber: optionalString(value.documentNumber) || null,
    expiresAt: optionalIsoString(value.expiresAt),
    note: optionalString(value.note) || null
  };
}

async function storeSingleProviderDocument(userDocumentsRoot, docType, value, previous) {
  const normalizedPrevious = normalizeStoredProviderDocument(previous);
  const now = new Date().toISOString();

  if (value === false || value === null) {
    return normalizeStoredProviderDocument(false);
  }

  if (value === true) {
    return {
      ...normalizedPrevious,
      submitted: true,
      uploadedAt: normalizedPrevious.uploadedAt || now
    };
  }

  if (!value || typeof value !== "object") {
    return {
      ...normalizedPrevious,
      submitted: Boolean(value),
      uploadedAt: Boolean(value) ? normalizedPrevious.uploadedAt || now : null
    };
  }

  const nextDocument = {
    ...normalizedPrevious,
    submitted: value.submitted !== false,
    verified: Boolean(value.verified ?? normalizedPrevious.verified),
    uploadedAt: now,
    fileName: optionalString(value.fileName) || normalizedPrevious.fileName,
    contentType: optionalString(value.contentType) || normalizedPrevious.contentType,
    sizeBytes: Number.isFinite(Number(value.sizeBytes)) ? Number(value.sizeBytes) : normalizedPrevious.sizeBytes,
    sourceUrl: optionalString(value.sourceUrl) || normalizedPrevious.sourceUrl,
    documentNumber: optionalString(value.documentNumber) || normalizedPrevious.documentNumber,
    expiresAt: optionalIsoString(value.expiresAt) || normalizedPrevious.expiresAt,
    note: optionalString(value.note) || normalizedPrevious.note,
    storagePath: normalizedPrevious.storagePath
  };

  const binaryPayload = readDocumentBinaryPayload(value);
  validateProviderDocumentFormat(nextDocument.fileName, nextDocument.contentType, binaryPayload?.contentType || null);
  if (binaryPayload) {
    const extension = resolveProviderDocumentExtension(nextDocument.fileName, nextDocument.contentType, binaryPayload.contentType);
    const storedFileName = `${docType}${extension}`;
    const storedPath = path.join(userDocumentsRoot, storedFileName);
    await fs.writeFile(storedPath, binaryPayload.buffer);
    nextDocument.fileName = nextDocument.fileName || storedFileName;
    nextDocument.contentType = nextDocument.contentType || binaryPayload.contentType;
    nextDocument.sizeBytes = binaryPayload.buffer.byteLength;
    nextDocument.storagePath = path.relative(runtimeRoot, storedPath).replaceAll(path.sep, "/");
  }

  return nextDocument;
}

function readDocumentBinaryPayload(value) {
  const explicitBase64 = optionalString(value.dataBase64 || value.base64);
  if (explicitBase64) {
    return {
      buffer: Buffer.from(explicitBase64, "base64"),
      contentType: optionalString(value.contentType) || "application/octet-stream"
    };
  }

  const dataUrl = optionalString(value.dataUrl);
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    buffer: Buffer.from(match[2], "base64"),
    contentType: match[1]
  };
}

function resolveProviderDocumentExtension(fileName, contentType, fallbackContentType) {
  const explicitExtension = path.extname(optionalString(fileName)).trim();
  if (explicitExtension) {
    const normalizedExtension = explicitExtension.toLowerCase();
    if (normalizedExtension === ".txt" || normalizedExtension === ".jpeg") {
      return normalizedExtension;
    }
    throw new Error("Provider documents must use .txt or .jpeg files only.");
  }

  const resolvedContentType = optionalString(contentType) || optionalString(fallbackContentType);
  if (ALLOWED_PROVIDER_DOCUMENT_CONTENT_TYPES.has(resolvedContentType)) {
    return ALLOWED_PROVIDER_DOCUMENT_CONTENT_TYPES.get(resolvedContentType);
  }
  throw new Error("Provider documents must use text/plain or image/jpeg content only.");
}

function optionalIsoString(value) {
  const normalized = readOptionalString(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function optionalString(value) {
  return readOptionalString(value);
}

function validateProviderDocumentFormat(fileName, contentType, fallbackContentType) {
  const normalizedFileName = optionalString(fileName);
  const normalizedContentType = optionalString(contentType) || optionalString(fallbackContentType);
  const explicitExtension = path.extname(normalizedFileName).trim().toLowerCase();

  if (normalizedContentType && !ALLOWED_PROVIDER_DOCUMENT_CONTENT_TYPES.has(normalizedContentType)) {
    throw new Error("Provider documents must be uploaded as text/plain or image/jpeg only.");
  }

  if (explicitExtension && explicitExtension !== ".txt" && explicitExtension !== ".jpeg") {
    throw new Error("Provider documents must use .txt or .jpeg files only.");
  }

  if (explicitExtension && normalizedContentType) {
    const expectedExtension = ALLOWED_PROVIDER_DOCUMENT_CONTENT_TYPES.get(normalizedContentType);
    if (expectedExtension && explicitExtension !== expectedExtension) {
      throw new Error("Provider document file extension does not match the uploaded content type.");
    }
  }
}


async function createPaypalOrder(serviceRequest) {
  return paypal.createOrder({
    description: `${serviceRequest.paymentKind === "service" ? "Roadside service payment" : "Priority roadside service"} - ${serviceRequest.serviceType}`,
    amount: serviceRequest.amount,
    customId: `${serviceRequest.phoneNumber}:${serviceRequest.serviceType}`
  });
}

async function capturePaypalOrder(orderId) {
  return paypal.captureOrder(orderId);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: "unparseable-response" };
  }
}

async function appendPaymentLog(entry) {
  await fs.mkdir(paymentsRoot, { recursive: true });
  await fs.appendFile(paymentLogPath, `${JSON.stringify(entry)}\n`);
}

async function readPaymentLog() {
  try {
    const raw = await fs.readFile(paymentLogPath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .reverse();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function issueUserSession({ userId, email, roles }) {
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + sessionTtlMs;
  const payload = {
    sessionId,
    userId: Number(userId),
    email: email || null,
    roles: Array.isArray(roles) ? roles : [],
    expiresAt
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signSessionBody(body);
  const token = `${body}.${signature}`;
  userSessions.set(sessionId, payload);
  return token;
}

function resolveUserSession(req) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    return null;
  }

  const [body, signature] = token.split(".");
  if (!body || !signature || signSessionBody(body) !== signature) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload || !payload.sessionId || Date.now() > Number(payload.expiresAt)) {
    userSessions.delete(payload?.sessionId);
    return null;
  }

  const liveSession = userSessions.get(payload.sessionId);
  if (!liveSession || liveSession.expiresAt !== payload.expiresAt || liveSession.userId !== payload.userId) {
    return null;
  }

  return {
    sessionId: payload.sessionId,
    userId: Number(payload.userId),
    email: payload.email || null,
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    expiresAt: payload.expiresAt
  };
}

function revokeUserSession(sessionId) {
  if (!sessionId) {
    return false;
  }
  return userSessions.delete(sessionId);
}

function signSessionBody(body) {
  return crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
}

async function readUsers() {
  try {
    const raw = await fs.readFile(usersPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeUsers(users) {
  await fs.mkdir(authRoot, { recursive: true });
  await fs.writeFile(usersPath, `${JSON.stringify(users, null, 2)}\n`);
}

function mutateUsers(mutator) {
  const task = async () => {
    const users = await readUsers();
    const result = await mutator(users);
    await writeUsers(users);
    return result;
  };
  const run = userMutationQueue.then(task, task);
  userMutationQueue = run.catch(() => {});
  return run;
}

function allocateUserId(users) {
  return users.reduce((maxId, user) => Math.max(maxId, Number(user.id) || 0), 0) + 1;
}

async function readCacheJson(filePath, cacheTtlMs) {
  try {
    const stat = await fs.stat(filePath);
    if (Date.now() - stat.mtimeMs > cacheTtlMs) {
      return null;
    }
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeCacheJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function deleteFile(filePath) {
  await fs.rm(filePath, { force: true });
}

async function listCacheFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function createServiceRequest(serviceRequest) {
  const now = new Date().toISOString();
  const requestId = `req_${Date.now()}`;
  const customerType = resolveCustomerTier(serviceRequest);
  const pricing = resolveServicePricing({
    ...serviceRequest,
    customerTier: customerType
  });
  const savedRequest = {
    id: requestId,
    requestId,
    status: "SUBMITTED",
    completionStatus: "OPEN",
    paymentStatus: "NOT_PAID",
    customerEtaAcceptedAt: null,
    arrivalConfirmedAt: null,
    completionConfirmedAt: null,
    paymentPromptedAt: null,
    noteExchange: [],
    providerPayoutStatus: "UNASSIGNED",
    amountCharged: 0,
    amountCollected: 0,
    refundIssued: false,
    refundFlag: false,
    disputeFlag: false,
    lastPaymentOrderId: null,
    serviceTaxAmount: pricing.serviceTaxAmount,
    providerTaxWithheld: pricing.providerTaxWithheld,
    assignmentFee: pricing.assignmentFee,
    dispatchFee: pricing.dispatchFee,
    platformShareAmount: pricing.platformShare,
    providerPayoutAmount: pricing.providerPayout,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
    ...serviceRequest,
    customerTier: pricing.customerTier,
    pricing,
    policyVersion: AW_ROADSIDE_POLICY.termsVersion
  };

  await fs.mkdir(requestsRoot, { recursive: true });
  await fs.appendFile(requestLogPath, `${JSON.stringify(savedRequest)}\n`);

  return savedRequest;
}

async function readRequestLog() {
  try {
    const raw = await fs.readFile(requestLogPath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .reverse();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeRequestLog(requests) {
  await fs.mkdir(requestsRoot, { recursive: true });
  const serialized = requests
    .slice()
    .reverse()
    .map((entry) => JSON.stringify(entry))
    .join("\n");
  await fs.writeFile(requestLogPath, serialized ? `${serialized}\n` : "");
}

function mutateRequests(mutator) {
  const task = async () => {
    const requests = await readRequestLog();
    const result = await mutator(requests);
    await writeRequestLog(requests);
    return result;
  };
  const run = requestMutationQueue.then(task, task);
  requestMutationQueue = run.catch(() => {});
  return run;
}

async function updateRequestRecord(requestId, updater) {
  return mutateRequests(async (requests) => {
    const index = requests.findIndex((entry) => String(entry.id || entry.requestId) === String(requestId));
    if (index === -1) {
      throw new Error(`Request ${requestId} was not found.`);
    }

    const current = requests[index];
    requests[index] = {
      ...current,
      ...updater(current),
      id: current.id || current.requestId,
      requestId: current.requestId || current.id,
      updatedAt: new Date().toISOString()
    };
    return requests[index];
  });
}

async function applyLocalRequestAction(requestId, action, payload) {
  const normalizedAction = typeof action === "string" ? action.trim().toLowerCase() : "";
  const now = new Date().toISOString();

  return updateRequestRecord(requestId, (request) => {
    const providerActions = Array.isArray(request.providerActions) ? [...request.providerActions] : [];
    const next = {
      ...request
    };

    if (normalizedAction === "accept" || normalizedAction === "force-accept") {
      next.status = "ASSIGNED";
      next.assignedProviderId = payload.providerUserId ?? request.assignedProviderId ?? null;
      next.acceptedAt = now;
      next.providerPayoutStatus = request.providerPayoutStatus === "UNASSIGNED" ? "PENDING" : request.providerPayoutStatus;
    } else if (normalizedAction === "eta") {
      next.status = "EN_ROUTE";
      next.etaMinutes = Number.isFinite(Number(payload.etaMinutes)) ? Number(payload.etaMinutes) : request.etaMinutes ?? null;
      next.etaUpdatedAt = now;
    } else if (normalizedAction === "soft-contact") {
      next.softContactedAt = now;
      next.status = request.status === "SUBMITTED" ? "ASSIGNED" : request.status;
    } else if (normalizedAction === "hard-contact") {
      next.hardContactedAt = now;
      next.status = "EN_ROUTE";
    } else if (normalizedAction === "arrived" || normalizedAction === "force-arrived") {
      next.status = "ARRIVED";
      next.arrivedAt = now;
    } else if (
      normalizedAction === "completed" ||
      normalizedAction === "force-complete" ||
      normalizedAction === "mark-complete"
    ) {
      next.status = "COMPLETED";
      next.completionStatus = "COMPLETED";
      next.completedAt = now;
      next.providerPayoutStatus =
        request.providerPayoutStatus === "UNASSIGNED" ? "PENDING" : request.providerPayoutStatus || "PENDING";
    } else if (normalizedAction === "subscriber-accept-eta" || normalizedAction === "customer-accept-eta") {
      if (!Number.isFinite(Number(request.etaMinutes))) {
        throw new Error("A hard ETA must be recorded before customer ETA acceptance.");
      }
      next.customerEtaAcceptedAt = now;
      next.completionStatus = request.completionStatus || "OPEN";
    } else if (normalizedAction === "confirm-arrived" || normalizedAction === "subscriber-arrived-confirm") {
      next.arrivalConfirmedAt = now;
    } else if (normalizedAction === "confirm-completion" || normalizedAction === "subscriber-completion-confirm") {
      next.completionConfirmedAt = now;
      next.completionStatus = "CONFIRMED_BY_CUSTOMER";
    } else if (normalizedAction === "prompt-payment") {
      next.paymentPromptedAt = now;
      next.paymentStatus = request.paymentStatus === "CAPTURED" ? request.paymentStatus : "PROMPTED";
    } else if (normalizedAction === "note") {
      const noteMessage = readRequiredString(payload.note || payload.message, "note");
      const noteExchange = Array.isArray(request.noteExchange) ? [...request.noteExchange] : [];
      noteExchange.unshift({
        actorRole: readOptionalString(payload.actorRole).toUpperCase() || resolveActionActorRole(payload),
        authorUserId: Number.isInteger(payload.providerUserId) ? payload.providerUserId : Number.isInteger(payload.userId) ? payload.userId : null,
        message: noteMessage,
        createdAt: now
      });
      next.noteExchange = noteExchange.slice(0, 50);
    } else {
      throw new Error(`Unsupported provider action: ${action}`);
    }

    providerActions.unshift({
      action: normalizedAction,
      providerUserId: Number.isInteger(payload.providerUserId) ? payload.providerUserId : null,
      etaMinutes: Number.isFinite(Number(payload.etaMinutes)) ? Number(payload.etaMinutes) : null,
      note: readOptionalString(payload.note),
      actorRole: resolveActionActorRole(payload),
      createdAt: now
    });
    next.providerActions = providerActions.slice(0, 20);
    return next;
  });
}

function resolveActionActorRole(payload) {
  const actorRole = readOptionalString(payload.actorRole).toUpperCase();
  if (actorRole) {
    return actorRole;
  }
  if (Number.isInteger(payload.providerUserId)) {
    return "PROVIDER";
  }
  if (Number.isInteger(payload.userId)) {
    return "SUBSCRIBER";
  }
  if (payload.adminAction === true) {
    return "ADMIN";
  }
  return "SYSTEM";
}

function calculateProviderRatingSummary(user) {
  const ratingTotal = Number(user?.providerProfile?.rates?.ratingTotal || 0);
  const ratingCount = Number(user?.providerProfile?.rates?.ratingCount || 0);
  const averageRating = ratingCount > 0 ? Number((ratingTotal / ratingCount).toFixed(2)) : 0;
  return {
    ratingTotal,
    ratingCount,
    averageRating,
    ratingRange: "1 to 8"
  };
}

function calculateProviderSelectionSummary(user) {
  const rating = calculateProviderRatingSummary(user);
  const availabilityScore = Boolean(user?.available) ? 35 : 0;
  const approvedScore = user?.providerStatus === "APPROVED" ? 25 : 0;
  const locationScore = readOptionalString(user?.providerProfile?.currentLocation) ? 10 : 0;
  const hoursScore = user?.providerProfile?.hoursOfService?.hasHours ? 10 : 0;
  const ratingScore = Math.min(rating.averageRating * 5, 40);
  return {
    available: Boolean(user?.available),
    currentLocation: readOptionalString(user?.providerProfile?.currentLocation) || null,
    score: Number((availabilityScore + approvedScore + locationScore + hoursScore + ratingScore).toFixed(2)),
    rating
  };
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".html":
    default:
      return "text/html; charset=utf-8";
  }
}
