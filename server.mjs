import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminController } from "./admin-controller.mjs";
import { createAwRoadsideSecurityController } from "./aw-roadside-security.mjs";
import { createCompatibilityGateway } from "./compatibility-gateway.mjs";
import { createLocalWatchdog } from "./local-watchdog.mjs";
import { createRequestServiceController } from "./request-service-controller.mjs";
import { createRuntimeRepository } from "./runtime-repository.mjs";
import { createSubscriptionController } from "./subscription-controller.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const webRoot = path.join(projectRoot, "web");
const appRoot = path.join(projectRoot, "app");
const runtimeRoot = path.join(appRoot, "runtime");
const reportsRoot = path.join(runtimeRoot, "reports");
const logsRoot = path.join(runtimeRoot, "logs");
const paymentsRoot = path.join(runtimeRoot, "payments");
const requestsRoot = path.join(runtimeRoot, "requests");
const authRoot = path.join(runtimeRoot, "auth");
const requestServiceCacheRoot = path.join(runtimeRoot, "request-service-cache");
const paymentLogPath = path.join(paymentsRoot, "paypal-orders.jsonl");
const requestLogPath = path.join(requestsRoot, "service-requests.jsonl");
const usersPath = path.join(authRoot, "users.json");

const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10);
const startedAt = new Date();
const publicBaseUrl = resolvePublicBaseUrl();
const paypalMode = (process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live" ? "live" : "sandbox";
const paypalApiBase =
  paypalMode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const paypalClientId = process.env.PAYPAL_CLIENT_ID || "";
const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET || "";
const priorityServicePrice = Number.parseFloat(process.env.PRIORITY_SERVICE_PRICE || "25");
const serviceBasePrice = Number.parseFloat(process.env.SERVICE_BASE_PRICE || "55");
const sessionSecret = process.env.AW_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const sessionTtlMs = Number.parseInt(process.env.AW_SESSION_TTL_MS || `${12 * 60 * 60 * 1000}`, 10);
const watchdogIntervalMs = Number.parseInt(process.env.AW_WATCHDOG_INTERVAL_MS || `${5 * 60 * 1000}`, 10);
const userSessions = new Map();
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
      allocateUserId,
      readCacheJson,
      writeCacheJson,
      deleteFile,
      listCacheFiles,
      appendPaymentLog,
      normalizeServiceRequest,
      normalizeServicePaymentRequest,
      createServicePaymentQuote,
      createPaypalOrder,
      capturePaypalOrder,
      resolveUserSession,
      issueUserSession,
      getUserProfile,
      getHealthPayload,
      getPaymentConfigPayload,
      getFrontendConfigPayload: (request) => getFrontendConfigPayload(request),
      getWatchdogStatus: () => localWatchdog.getStatus(),
      recordSecurityEvent: (event, details) => localWatchdog.record(event, details),
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
      readRequestLog,
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

      if (!paypalClientId || !paypalClientSecret) {
        sendJson(res, 503, {
          error: "paypal-not-configured",
          message: "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET before creating orders."
        });
        return;
      }

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

      sendJson(res, 201, {
        orderId: order.id,
        status: order.status
      });
      return;
    }

    if (pathname === "/api/payments/capture-order") {
      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      if (!paypalClientId || !paypalClientSecret) {
        sendJson(res, 503, {
          error: "paypal-not-configured",
          message: "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET before capturing orders."
        });
        return;
      }

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

      sendJson(res, 200, {
        status: capture.status,
        orderId,
        capture
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
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
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

  return {
    fullName,
    phoneNumber,
    serviceType,
    location,
    notes,
    amount: {
      currency_code: "USD",
      value: priorityServicePrice.toFixed(2)
    }
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
    timestamp: new Date().toISOString()
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
    priorityServicePrice
  };
}

async function getUserProfile(userId) {
  const users = await readUsers();
  const user = users.find((entry) => entry.id === Number(userId));
  if (!user) {
    throw new Error("User not found.");
  }

  return {
    userId: user.id,
    fullName: user.fullName || "",
    username: user.username || "",
    email: user.email || "",
    roles: Array.isArray(user.roles) ? user.roles : [],
    providerStatus: user.providerStatus || null,
    providerProfile: user.providerProfile || null,
    providerMonthly: user.providerMonthly || 5.99,
    services: Array.isArray(user.services) ? user.services : [],
    available: Boolean(user.available),
    activeShiftId: user.activeShiftId || null,
    subscriberActive: Boolean(user.subscriberActive),
    subscriberProfile: user.subscriberProfile || null,
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

  return {
    quoteId: `service:${requestId}:${status || "ETA"}:${etaMinutes ?? "confirmed"}:${serviceBasePrice.toFixed(2)}`,
    requestId,
    paymentKind: "service",
    serviceType: request.serviceType || "Roadside Service",
    status,
    etaMinutes,
    amount: {
      currency_code: "USD",
      value: serviceBasePrice.toFixed(2)
    },
    priceSource: "backend",
    agreementRequired: true,
    terms: "Service payment can be created only after the backend records a provider hard ETA and the customer accepts this backend quote."
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
    rawApiBaseUrl: `${baseUrl}/api`
  };
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

async function getPaypalAccessToken() {
  const credentials = Buffer.from(`${paypalClientId}:${paypalClientSecret}`).toString("base64");
  const response = await fetch(`${paypalApiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!response.ok) {
    throw new Error(`PayPal token request failed with ${response.status}.`);
  }

  const payload = await response.json();
  return payload.access_token;
}

async function createPaypalOrder(serviceRequest) {
  const accessToken = await getPaypalAccessToken();
  const response = await fetch(`${paypalApiBase}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          description: `${serviceRequest.paymentKind === "service" ? "Roadside service payment" : "Priority roadside service"} - ${serviceRequest.serviceType}`,
          amount: serviceRequest.amount,
          custom_id: `${serviceRequest.phoneNumber}:${serviceRequest.serviceType}`,
          soft_descriptor: "ADUBROADSIDE"
        }
      ],
      application_context: {
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW"
      }
    })
  });

  if (!response.ok) {
    const errorBody = await safeJson(response);
    throw new Error(
      `PayPal create order failed with ${response.status}: ${JSON.stringify(errorBody)}`
    );
  }

  return response.json();
}

async function capturePaypalOrder(orderId) {
  const accessToken = await getPaypalAccessToken();
  const response = await fetch(`${paypalApiBase}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const errorBody = await safeJson(response);
    throw new Error(
      `PayPal capture failed with ${response.status}: ${JSON.stringify(errorBody)}`
    );
  }

  return response.json();
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
  const savedRequest = {
    id: `req_${Date.now()}`,
    status: "submitted",
    paymentStatus: "not-required",
    submittedAt: new Date().toISOString(),
    ...serviceRequest
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
