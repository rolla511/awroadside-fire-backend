import {
  acceptProviderPayoutTerms,
  applyProvider,
  createSignup,
  loginUser,
  setupSubscriber,
  uploadProviderDocuments
} from "./subscription-controller.mjs";

const DEFAULT_ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const CANONICAL_PROTECTED_API_PREFIX = "/aw-roadside-security.mjs";
const PROTECTED_API_PREFIX_ALIASES = Object.freeze([
  CANONICAL_PROTECTED_API_PREFIX,
  "/api/aw-roadside",
  "/api/awroadside-fire"
]);
const PROVIDER_ONLY_ACTIONS = new Set([
  "accept",
  "eta",
  "soft-eta",
  "hard-eta",
  "extend-eta",
  "enroute",
  "paused",
  "soft-contact",
  "hard-contact",
  "arrived",
  "completed",
  "approve-service-change",
  "deny-service-change"
]);
const CUSTOMER_ONLY_ACTIONS = new Set([
  "subscriber-accept-eta",
  "customer-accept-eta",
  "confirm-arrived",
  "subscriber-arrived-confirm",
  "confirm-completion",
  "subscriber-completion-confirm",
  "cancel-service",
  "request-service-change"
]);
const SHARED_NOTE_ACTIONS = new Set(["note"]);

export function createAwRoadsideSecurityController({ requestServiceController, watchdog, localWatchdog }) {
  const securityWatchdog = watchdog || localWatchdog;
  const routeCache = new Map();
  const auditLog = [];
  const routeCacheTtlMs = Number.parseInt(process.env.AW_SECURITY_ROUTE_CACHE_TTL_MS || `${DEFAULT_ROUTE_CACHE_TTL_MS}`, 10);

  return {
    async handle(req, res, pathname, helpers) {
      pathname = normalizeProtectedApiPath(pathname);
      if (!pathname) {
        return false;
      }

      if (pathname === "/aw-roadside-security.mjs/security/status") {
        const watchdogStatus = await securityWatchdog.getStatus();
        helpers.sendJson(res, 200, {
          layer: "aw-roadside-security",
          active: true,
          routeCacheEntries: routeCache.size,
          auditEvents: auditLog.length,
          requestServiceConfigured: requestServiceController.isConfigured(),
          watchdog: watchdogStatus
        });
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/security/watchdog") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        requireSession(req, helpers);
        helpers.sendJson(res, 200, await securityWatchdog.getStatus());
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/health") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(
          res,
          200,
          await readThroughCache("health", async () => ({
            ...(await helpers.getHealthPayload()),
            securityLayer: "aw-roadside-security.mjs",
            protectedApiBaseUrl: helpers.getProtectedApiBaseUrl(req)
          }))
        );
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/frontend-config") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(res, 200, await readThroughCache("frontend-config", () => helpers.getFrontendConfigPayload(req)));
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/location/config") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(res, 200, helpers.getLocationConfigPayload());
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/location/geocode") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const url = new URL(req.url, "http://localhost");
        const query = url.searchParams.get("q") || "";
        helpers.sendJson(res, 200, await helpers.forwardGeocodeLocation(query, { limit: 5 }));
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/location/isochrone") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const url = new URL(req.url, "http://localhost");
        const longitude = Number(url.searchParams.get("longitude"));
        const latitude = Number(url.searchParams.get("latitude"));
        const contoursMinutes = Number(url.searchParams.get("minutes"));
        const profile = url.searchParams.get("profile") || "driving";
        helpers.sendJson(
          res,
          200,
          await helpers.getLocationIsochrone(longitude, latitude, {
            contoursMinutes,
            profile
          })
        );
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/payments/config") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(res, 200, await readThroughCache("payments-config", helpers.getPaymentConfigPayload));
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/auth/signup") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        try {
          const payload = await helpers.readJsonBody(req);
          const signup = await createSignup(payload, helpers);
          await helpers.markInboundPayloadProcessed?.(req, {
            route: "/aw-roadside-security.mjs/auth/signup",
            userId: signup.userId,
            outcome: "created"
          });
          helpers.sendJson(res, 201, attachSession(signup, helpers));
          recordAudit("auth-signup", { userId: signup.userId, roles: signup.roles });
          await helpers.recordSecurityEvent("auth-signup", { userId: signup.userId });
        } catch (error) {
          await helpers.markInboundPayloadRejected?.(req, error, {
            route: "/aw-roadside-security.mjs/auth/signup"
          });
          throw error;
        }
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/auth/login") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const login = await loginUser(payload, helpers);
        helpers.sendJson(res, 200, attachSession(login, helpers));
        recordAudit("auth-login", { userId: login.userId, roles: login.roles });
        await helpers.recordSecurityEvent("auth-login", { userId: login.userId });
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/auth/reset-password") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        // Password reset is handled as a simulated event in the baseline runtime.
        // It records a security event and audit log.
        const email = helpers.optionalString(payload.email);
        if (!email) {
          helpers.sendJson(res, 400, { error: "missing-email", message: "Email is required for password reset." });
          return true;
        }
        recordAudit("auth-password-reset-requested", { email });
        await helpers.recordSecurityEvent("auth-password-reset-requested", { email });
        helpers.sendJson(res, 200, {
          ok: true,
          message: "If an account exists for that email, a reset link has been sent."
        });
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/auth/profile") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const session = requireSession(req, helpers);
        const profile = await helpers.getUserProfile(session.userId);
        helpers.sendJson(res, 200, profile);
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/provider/wallet") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const session = helpers.resolveUserSession(req);
        if (!session) {
          helpers.sendJson(res, 401, {
            error: "session-required",
            message: "A valid session token is required."
          });
          return true;
        }
        if (!session.roles.includes("PROVIDER")) {
          helpers.sendJson(res, 403, {
            error: "provider-session-required",
            message: "A provider session is required to view wallet records."
          });
          return true;
        }
        helpers.sendJson(res, 200, maskProviderWalletPayload(await helpers.getProviderWalletPayload(session.userId)));
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/provider/workflow") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const session = helpers.resolveUserSession(req);
        if (!session) {
          helpers.sendJson(res, 401, {
            error: "session-required",
            message: "A valid session token is required."
          });
          return true;
        }
        if (!session.roles.includes("PROVIDER")) {
          helpers.sendJson(res, 403, {
            error: "provider-session-required",
            message: "A provider session is required to view workflow records."
          });
          return true;
        }
        helpers.sendJson(res, 200, await buildProviderWorkflowPayload(session, helpers));
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/auth/subscriber/setup") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const session = requireSession(req, helpers);
        try {
          const payload = await helpers.readJsonBody(req);
          const updatedUser = await setupSubscriber(payload, helpers, session);
          await helpers.markInboundPayloadProcessed?.(req, {
            route: "/aw-roadside-security.mjs/auth/subscriber/setup",
            userId: updatedUser.id,
            outcome: "subscriber-setup"
          });
          helpers.sendJson(res, 200, {
            userId: updatedUser.id,
            subscriberActive: updatedUser.subscriberActive,
            membershipPrice: 5
          });
          recordAudit("subscriber-setup", { userId: updatedUser.id });
          await helpers.recordSecurityEvent("subscriber-setup", { userId: updatedUser.id });
        } catch (error) {
          await helpers.markInboundPayloadRejected?.(req, error, {
            route: "/aw-roadside-security.mjs/auth/subscriber/setup"
          });
          throw error;
        }
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/auth/provider/apply") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const session = requireSession(req, helpers);
        const payload = await helpers.readJsonBody(req);
        const updatedUser = await applyProvider(payload, helpers, session);
        helpers.sendJson(res, 200, {
          userId: updatedUser.id,
          providerStatus: updatedUser.providerStatus,
          providerMonthly: helpers.getRoadsidePolicy?.().provider?.monthlyFee || 6
        });
        recordAudit("provider-apply", { userId: updatedUser.id });
        await helpers.recordSecurityEvent("provider-apply", { userId: updatedUser.id });
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/auth/provider/documents") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const session = requireSession(req, helpers);
        const payload = await helpers.readJsonBody(req);
        const updatedUser = await uploadProviderDocuments(payload, helpers, session);
        helpers.sendJson(res, 200, {
          userId: updatedUser.id,
          providerStatus: updatedUser.providerStatus,
          documents: updatedUser.providerProfile?.documents || {}
        });
        recordAudit("provider-documents-upload", { userId: updatedUser.id });
        await helpers.recordSecurityEvent("provider-documents-upload", { userId: updatedUser.id });
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/auth/provider/payout-terms") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const session = requireSession(req, helpers);
        const payload = await helpers.readJsonBody(req);
        const updatedUser = await acceptProviderPayoutTerms(payload, helpers, session);
        helpers.sendJson(res, 200, {
          userId: updatedUser.id,
          payoutTermsAccepted: updatedUser.terms?.providerPayout?.accepted === true,
          payoutTermsAcceptedAt: updatedUser.terms?.providerPayout?.acceptedAt || null,
          payoutSafeModeActive: updatedUser.terms?.providerPayout?.safeModeActive !== false
        });
        recordAudit("provider-payout-terms-accepted", { userId: updatedUser.id });
        await helpers.recordSecurityEvent("provider-payout-terms-accepted", { userId: updatedUser.id });
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/provider/payout-dispute") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const session = requireSession(req, helpers);
        if (!session.roles.includes("PROVIDER")) {
          helpers.sendJson(res, 403, {
            error: "provider-session-required",
            message: "A provider session is required to dispute payout records."
          });
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const updatedRequest = await submitProviderPayoutDispute(payload, helpers, session);
        helpers.sendJson(res, 200, {
          requestId: updatedRequest.requestId || updatedRequest.id || null,
          providerPayoutStatus: updatedRequest.providerPayoutStatus || null,
          disputeFlag: Boolean(updatedRequest.disputeFlag),
          disputeRaisedAt: updatedRequest.disputeRaisedAt || null
        });
        recordAudit("provider-payout-dispute", {
          userId: session.userId,
          requestId: updatedRequest.requestId || updatedRequest.id || null
        });
        await helpers.recordSecurityEvent("provider-payout-dispute", {
          userId: session.userId,
          requestId: updatedRequest.requestId || updatedRequest.id || null
        });
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/requests") {
        if (req.method === "POST") {
          const session = helpers.resolveUserSession(req);
          const sessionProfile = session?.userId ? await helpers.getUserProfile(session.userId) : null;
          const payload = await helpers.readJsonBody(req);
          const securePayload = sanitizeProtectedRequestPayload(payload, session, sessionProfile);
          const created = await requestServiceController.createRequest(securePayload, helpers);
          routeCache.delete("request-list");
          helpers.sendJson(
            res,
            201,
            await helpers.presentRequestForSession(
              created,
              session || { roles: ["GUEST"], actorRole: "GUEST", ownsRequest: true }
            )
          );
          recordAudit("request-create", {
            userId: session?.userId || null,
            requestId: created.id || created.requestId || null,
            mode: session ? "authenticated" : "guest"
          });
          await helpers.recordSecurityEvent("request-create", {
            userId: session?.userId || null,
            requestId: created.id || created.requestId || null,
            mode: session ? "authenticated" : "guest"
          });
          return true;
        }

        if (req.method === "GET") {
          const session = requireSession(req, helpers);
          if (!session.roles.includes("PROVIDER") && !session.roles.includes("ADMIN")) {
            helpers.sendJson(res, 403, {
              error: "provider-or-admin-session-required",
              message: "A provider or admin session is required to read the provider request queue."
            });
            return true;
          }
          const payload = await readThroughCache("request-list", () => requestServiceController.listRequests(helpers));
          const visibleRequests = await helpers.filterRequestsForSession(payload.requests, session);
          helpers.sendJson(res, 200, {
            ...payload,
            requests: await helpers.presentRequestsForSession(visibleRequests, session)
          });
          return true;
        }

        helpers.sendMethodNotAllowed(res, "GET, POST");
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/request-status") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const url = new URL(req.url, "http://127.0.0.1");
        const requestId = requireString(url.searchParams.get("requestId"), "requestId");
        const phoneNumber = optionalString(url.searchParams.get("phoneNumber"));
        const session = helpers.resolveUserSession(req);
        const request = await requestServiceController.getRequest(requestId, helpers);
        const customerSession = buildCustomerRequestStatusSession(request, session, phoneNumber);
        if (!customerSession) {
          helpers.sendJson(res, 403, {
            error: "request-status-denied",
            message: "Customer request status requires the matching subscriber session or request phone number."
          });
          return true;
        }
        helpers.sendJson(res, 200, {
          request: await helpers.presentRequestForSession(request, customerSession)
        });
        return true;
      }

      const requestActionMatch = pathname.match(/^\/api\/aw-roadside\/requests\/([^/]+)\/([^/]+)$/);
      if (requestActionMatch) {
        const requestId = decodeURIComponent(requestActionMatch[1]);
        const action = decodeURIComponent(requestActionMatch[2]);
        const normalizedAction = action.trim().toLowerCase();
        if (normalizedAction === "feedback") {
          if (req.method !== "POST") {
            helpers.sendMethodNotAllowed(res, "POST");
            return true;
          }
          const session = helpers.resolveUserSession(req);
          const payload = await helpers.readJsonBody(req);
          const result = await helpers.recordCustomerFeedback(requestId, payload, session);
          helpers.sendJson(res, 200, result);
          recordAudit("request-feedback", {
            userId: session?.userId || null,
            requestId
          });
          await helpers.recordSecurityEvent("request-feedback", {
            userId: session?.userId || null,
            requestId
          });
          return true;
        }
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        const session = requireSession(req, helpers);
        if (PROVIDER_ONLY_ACTIONS.has(normalizedAction) && !session.roles.includes("PROVIDER")) {
          helpers.sendJson(res, 403, {
            error: "provider-session-required",
            message: "A provider session is required for request work actions."
          });
          return true;
        }
        if (CUSTOMER_ONLY_ACTIONS.has(normalizedAction) && !session.roles.includes("SUBSCRIBER")) {
          helpers.sendJson(res, 403, {
            error: "subscriber-session-required",
            message: "A subscriber session is required for customer confirmations."
          });
          return true;
        }
        if (SHARED_NOTE_ACTIONS.has(normalizedAction) && !session.roles.some((role) => role === "SUBSCRIBER" || role === "PROVIDER")) {
          helpers.sendJson(res, 403, {
            error: "session-role-required",
            message: "A subscriber or provider session is required for note exchange."
          });
          return true;
        }

        const payload = await helpers.readJsonBody(req);
        const result = await requestServiceController.applyProviderAction(
          requestId,
          action,
          {
            ...payload,
            providerUserId: session.roles.includes("PROVIDER") ? session.userId : null,
            userId: session.userId,
            actorRole: session.roles.includes("PROVIDER") ? "PROVIDER" : session.roles.includes("SUBSCRIBER") ? "SUBSCRIBER" : "USER"
          },
          helpers
        );
        routeCache.delete("request-list");
        helpers.sendJson(res, result.committed === false ? 202 : 200, {
          ...result,
          request: result.request ? await helpers.presentRequestForSession(result.request, session) : null
        });
        recordAudit("provider-request-action", {
          userId: session.userId,
          requestId,
          action,
          committed: result.committed !== false
        });
        await helpers.recordSecurityEvent("provider-request-action", {
          userId: session.userId,
          requestId,
          action,
          committed: result.committed !== false
        });
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/payments/create-order") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const paymentKind = optionalString(payload.paymentKind) || "priority";
        let normalizedRequest = null;
        if (paymentKind === "service") {
          const requestId = requireString(payload.requestId, "requestId");
          const request = await requestServiceController.getRequest(requestId, helpers);
          const quote = helpers.createServicePaymentQuote(request);
          normalizedRequest = helpers.normalizeServicePaymentRequest(payload, request, quote);
        } else if (paymentKind !== "priority") {
          helpers.sendJson(res, 400, {
            error: "unsupported-payment-kind",
            message: "Payment kind must be priority or service."
          });
          return true;
        }
        const paymentConfig = await helpers.getPaymentConfigPayload();
        if (!paymentConfig.enabled) {
          helpers.sendJson(res, 503, {
            error: "paypal-not-configured",
            message: "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET before creating orders."
          });
          return true;
        }
        normalizedRequest = normalizedRequest || helpers.normalizeServiceRequest(payload);
        const order = await helpers.createPaypalOrder(normalizedRequest);
        await helpers.appendPaymentLog({
          event: "order-created",
          request: normalizedRequest,
          paymentKind,
          paypalOrderId: order.id,
          status: order.status,
          createdAt: new Date().toISOString(),
          route: "aw-roadside-security"
        });
        if (normalizedRequest.requestId && typeof helpers.updateRequestRecord === "function") {
          await helpers.updateRequestRecord(normalizedRequest.requestId, (request) => ({
            ...request,
            amountCharged: Number(normalizedRequest.amount?.value || 0),
            paymentStatus: "ORDER_CREATED",
            lastPaymentOrderId: order.id
          }));
        }
        helpers.sendJson(res, 201, {
          orderId: order.id,
          status: order.status
        });
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/payments/service-quote") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const requestId = requireString(payload.requestId, "requestId");
        const request = await requestServiceController.getRequest(requestId, helpers);
        helpers.sendJson(res, 200, helpers.createServicePaymentQuote(request));
        return true;
      }

      if (pathname === "/aw-roadside-security.mjs/payments/capture-order") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const paymentConfig = await helpers.getPaymentConfigPayload();
        if (!paymentConfig.enabled) {
          helpers.sendJson(res, 503, {
            error: "paypal-not-configured",
            message: "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET before capturing orders."
          });
          return true;
        }
        const session = helpers.resolveUserSession(req);
        const payload = await helpers.readJsonBody(req);
        const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
        if (!orderId) {
          throw new Error("A PayPal orderId is required.");
        }
        const capture = await helpers.capturePaypalOrder(orderId);
        await helpers.appendPaymentLog({
          event: "order-captured",
          paypalOrderId: orderId,
          status: capture.status,
          capturedAt: new Date().toISOString(),
          route: "aw-roadside-security",
          capture
        });
        let updatedRequest = null;
        if (typeof payload.requestId === "string" && payload.requestId.trim() && typeof helpers.updateRequestRecord === "function") {
          updatedRequest = await helpers.updateRequestRecord(payload.requestId, (request) => ({
            ...request,
            paymentStatus: "CAPTURED",
            amountCollected: Number(request.amountCharged || request.amountCollected || 0),
            lastPaymentOrderId: orderId
          }));
        }
        const paymentReceipt =
          updatedRequest && typeof helpers.sendPaymentReceiptEmailForRequest === "function"
            ? await helpers.sendPaymentReceiptEmailForRequest(updatedRequest, {
                orderId,
                captureStatus: capture.status
              })
            : null;
        helpers.sendJson(res, 200, {
          status: capture.status,
          orderId,
          capture,
          paymentReceipt,
          request: updatedRequest
            ? await helpers.presentRequestForSession(
                updatedRequest,
                session || { roles: ["GUEST"], actorRole: "GUEST", ownsRequest: true }
              )
            : null
        });
        return true;
      }

      helpers.sendJson(res, 404, {
        error: "aw-roadside-route-not-found"
      });
      return true;
    }
  };

  function normalizeProtectedApiPath(pathname) {
    if (typeof pathname !== "string" || !pathname) {
      return null;
    }

    for (const prefix of PROTECTED_API_PREFIX_ALIASES) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        return `${CANONICAL_PROTECTED_API_PREFIX}${pathname.slice(prefix.length)}`;
      }
    }

    return null;
  }

  async function readThroughCache(cacheKey, producer) {
    try {
      const payload = await producer();
      routeCache.set(cacheKey, {
        payload,
        updatedAt: Date.now()
      });
      return {
        ...payload,
        degraded: false
      };
    } catch (error) {
      if (cacheKey === "request-list") {
        throw error;
      }
      const cached = routeCache.get(cacheKey);
      if (cached && Date.now() - cached.updatedAt <= routeCacheTtlMs) {
        recordAudit("cache-fallback", {
          cacheKey,
          message: error instanceof Error ? error.message : String(error)
        });
        return {
          ...cached.payload,
          degraded: true,
          staleAt: new Date(cached.updatedAt).toISOString()
        };
      }
      throw error;
    }
  }

  function recordAudit(event, details) {
    auditLog.unshift({
      event,
      details,
      timestamp: new Date().toISOString()
    });
    auditLog.splice(50);
  }

}

function attachSession(payload, helpers) {
  const sessionToken = helpers.issueUserSession({
    userId: payload.userId,
    email: payload.email || null,
    roles: payload.roles || []
  });

  return {
    ...payload,
    sessionToken,
    token: sessionToken
  };
}

function requireSession(req, helpers) {
  const session = helpers.resolveUserSession(req);
  if (!session) {
    throw new Error("A valid session token is required.");
  }
  return session;
}

function sanitizeProtectedRequestPayload(payload, session, sessionProfile = null) {
  const fullName = requireString(payload.fullName, "fullName");
  const phoneNumber = requireString(payload.phoneNumber, "phoneNumber");
  const serviceType = requireString(payload.serviceType, "serviceType");
  const location = requireString(payload.location, "location");
  const notes = optionalString(payload.notes);
  const assignedProviderId = optionalString(payload.assignedProviderId);
  const addressLine = optionalString(payload.addressLine);
  const city = optionalString(payload.city);
  const stateRegion = optionalString(payload.stateRegion);
  const crossStreet = optionalString(payload.crossStreet);
  const vehicleSummary = optionalString(payload.vehicleSummary);
  const locationCoordinates = sanitizeCoordinatePayload(payload.locationCoordinates);
  const vehicleInfo = sanitizeVehicleInfo(payload.vehicleInfo);

  return {
    userId: session?.userId || null,
    roles: session?.roles || [],
    subscriberActive: Boolean(sessionProfile?.subscriberActive),
    fullName,
    phoneNumber,
    serviceType,
    location,
    notes,
    addressLine,
    city,
    stateRegion,
    crossStreet,
    guestTermsAccepted: payload.guestTermsAccepted === true,
    termsAccepted: payload.termsAccepted === true || payload.guestTermsAccepted === true,
    noRefundPolicyAccepted: payload.noRefundPolicyAccepted === true,
    dispatchOnlyLiabilityAccepted: payload.dispatchOnlyLiabilityAccepted === true,
    ...(vehicleInfo ? { vehicleInfo } : {}),
    ...(vehicleSummary ? { vehicleSummary } : {}),
    ...(locationCoordinates ? { locationCoordinates } : {}),
    ...(assignedProviderId ? { assignedProviderId } : {})
  };
}

async function buildProviderWorkflowPayload(session, helpers) {
  const [profile, requests] = await Promise.all([
    helpers.getUserProfile(session.userId),
    helpers.readRequestLog()
  ]);
  const visibleQueue = await helpers.filterRequestsForSession(requests, session);
  const assignedHistory = (Array.isArray(requests) ? requests : []).filter((request) => {
    const status = normalizeStatus(request?.status);
    return Number(request?.assignedProviderId) === Number(session.userId) &&
      ["ASSIGNED", "EN_ROUTE", "ARRIVED", "PAUSED", "COMPLETED"].includes(status);
  });
  const merged = dedupeRequestsById([...visibleQueue, ...assignedHistory]).sort(sortRequestsByRecent);
  const presented = await helpers.presentRequestsForSession(merged, session);
  const queued = presented.filter((request) => normalizeStatus(request?.status) === "SUBMITTED");
  const inProgress = presented.filter((request) => ["ASSIGNED", "EN_ROUTE", "ARRIVED", "PAUSED"].includes(normalizeStatus(request?.status)));
  const completed = presented.filter((request) => ["COMPLETED", "CANCELLED"].includes(normalizeStatus(request?.status)));

  return {
    provider: maskProviderWorkflowProfile(profile),
    queue: {
      queued,
      inProgress,
      completed,
      all: [...queued, ...inProgress, ...completed]
    }
  };
}

function maskProviderWorkflowProfile(profile) {
  const providerProfile = profile?.providerProfile && typeof profile.providerProfile === "object"
    ? profile.providerProfile
    : {};
  return {
    userId: profile?.userId || null,
    fullName: profile?.fullName || "",
    providerStatus: profile?.providerStatus || null,
    services: Array.isArray(profile?.services) ? profile.services : [],
    vehicleInfo: providerProfile.vehicleInfo || null,
    hoursOfService: providerProfile.hoursOfService || null,
    currentLocation: providerProfile.currentLocation || null,
    currentLocationCoordinates: sanitizeCoordinatePayload(providerProfile.currentLocationCoordinates),
    serviceArea: providerProfile.serviceArea || null,
    serviceAreaCoordinates: sanitizeCoordinatePayload(providerProfile.serviceAreaCoordinates)
  };
}

function maskProviderWalletPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  return {
    ...payload,
    provider: {
      ...(payload.provider || {}),
      email: maskEmail(payload.provider?.email),
      paypalEmail: maskEmail(payload.provider?.paypalEmail)
    },
    paypalState: {
      ...(payload.paypalState || {}),
      providerAccountId: maskReference(payload.paypalState?.providerAccountId),
      accountId: maskReference(payload.paypalState?.accountId),
      email: maskEmail(payload.paypalState?.email)
    }
  };
}

function sanitizeVehicleInfo(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const year = optionalString(value.year);
  const make = optionalString(value.make);
  const model = optionalString(value.model);
  const color = optionalString(value.color);
  if (!year && !make && !model && !color) {
    return null;
  }
  return { year, make, model, color };
}

function sanitizeCoordinatePayload(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const longitude = Number(value.longitude);
  const latitude = Number(value.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }
  return {
    longitude,
    latitude
  };
}

function dedupeRequestsById(requests) {
  const seen = new Set();
  const results = [];
  for (const request of Array.isArray(requests) ? requests : []) {
    const key = String(request?.requestId || request?.id || "");
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(request);
  }
  return results;
}

function sortRequestsByRecent(left, right) {
  const leftTime = new Date(left?.updatedAt || left?.completedAt || left?.submittedAt || left?.createdAt || 0).getTime();
  const rightTime = new Date(right?.updatedAt || right?.completedAt || right?.submittedAt || right?.createdAt || 0).getTime();
  return rightTime - leftTime;
}

function normalizeStatus(value) {
  return optionalString(value).toUpperCase();
}

function maskEmail(value) {
  const email = optionalString(value);
  if (!email || !email.includes("@")) {
    return email || null;
  }
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) {
    return email;
  }
  const visible = localPart.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(localPart.length - visible.length, 1))}@${domain}`;
}

function maskReference(value) {
  const reference = optionalString(value);
  if (!reference) {
    return null;
  }
  if (reference.length <= 6) {
    return "*".repeat(reference.length);
  }
  return `${reference.slice(0, 2)}${"*".repeat(reference.length - 4)}${reference.slice(-2)}`;
}

async function submitProviderPayoutDispute(payload, helpers, session) {
  const requestId = requireString(payload.requestId, "requestId");
  const disputeReason = requireString(payload.reason, "reason");
  const requests = await helpers.readRequestLog();
  const index = requests.findIndex((entry) => String(entry.id || entry.requestId) === String(requestId));
  if (index === -1) {
    throw new Error(`Request ${requestId} was not found.`);
  }

  const current = requests[index];
  if (Number(current.assignedProviderId) !== Number(session.userId)) {
    const error = new Error("Providers may dispute only their own payout records.");
    error.statusCode = 403;
    throw error;
  }
  if (normalizeStatus(current.providerPayoutStatus) === "COMPLETED" || current.payoutCompletedAt) {
    const error = new Error("Payout disputes must be filed before payout is received.");
    error.statusCode = 409;
    throw error;
  }

  const now = new Date().toISOString();
  requests[index] = {
    ...current,
    disputeFlag: true,
    disputeReason,
    disputeRaisedAt: now,
    providerPayoutStatus: "ON_HOLD",
    updatedAt: now
  };
  await helpers.writeRequestLog(requests);
  return requests[index];
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Field "${fieldName}" is required.`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhoneLookup(value) {
  return optionalString(value).replace(/\D+/g, "");
}

function buildCustomerRequestStatusSession(request, session = null, phoneNumber = "") {
  if (session?.roles?.includes("ADMIN")) {
    return {
      ...session,
      actorRole: "ADMIN"
    };
  }
  if (session?.roles?.includes("SUBSCRIBER") && Number(request?.userId) === Number(session.userId)) {
    return {
      ...session,
      actorRole: "SUBSCRIBER"
    };
  }
  if (normalizePhoneLookup(phoneNumber) && normalizePhoneLookup(request?.phoneNumber) === normalizePhoneLookup(phoneNumber)) {
    return {
      roles: ["GUEST"],
      actorRole: "GUEST",
      ownsRequest: true
    };
  }
  return null;
}
