import {
  applyProvider,
  createSignup,
  loginUser,
  setupSubscriber,
  uploadProviderDocuments
} from "./subscription-controller.mjs";

const DEFAULT_ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_ONLY_ACTIONS = new Set(["accept", "eta", "soft-contact", "hard-contact", "arrived", "completed"]);
const CUSTOMER_ONLY_ACTIONS = new Set([
  "subscriber-accept-eta",
  "customer-accept-eta",
  "confirm-arrived",
  "subscriber-arrived-confirm",
  "confirm-completion",
  "subscriber-completion-confirm"
]);
const SHARED_NOTE_ACTIONS = new Set(["note"]);

export function createAwRoadsideSecurityController({ requestServiceController, localWatchdog }) {
  const routeCache = new Map();
  const auditLog = [];
  const routeCacheTtlMs = Number.parseInt(process.env.AW_SECURITY_ROUTE_CACHE_TTL_MS || `${DEFAULT_ROUTE_CACHE_TTL_MS}`, 10);

  return {
    async handle(req, res, pathname, helpers) {
      if (!pathname.startsWith("/api/aw-roadside/")) {
        return false;
      }

      if (pathname === "/api/aw-roadside/security/status") {
        const watchdogStatus = await localWatchdog.getStatus();
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

      if (pathname === "/api/aw-roadside/security/watchdog") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        requireSession(req, helpers);
        helpers.sendJson(res, 200, await localWatchdog.scanAndRecord());
        return true;
      }

      if (pathname === "/api/aw-roadside/health") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(
          res,
          200,
          await readThroughCache("health", async () => ({
            ...(await helpers.getHealthPayload()),
            securityLayer: "aw-roadside-security",
            protectedApiBaseUrl: helpers.getProtectedApiBaseUrl(req)
          }))
        );
        return true;
      }

      if (pathname === "/api/aw-roadside/frontend-config") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(res, 200, await readThroughCache("frontend-config", () => helpers.getFrontendConfigPayload(req)));
        return true;
      }

      if (pathname === "/api/aw-roadside/location/config") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(res, 200, helpers.getLocationConfigPayload());
        return true;
      }

      if (pathname === "/api/aw-roadside/location/geocode") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const url = new URL(req.url, "http://localhost");
        const query = url.searchParams.get("q") || "";
        helpers.sendJson(res, 200, await helpers.forwardGeocodeLocation(query, { limit: 5 }));
        return true;
      }

      if (pathname === "/api/aw-roadside/location/isochrone") {
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

      if (pathname === "/api/aw-roadside/payments/config") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(res, 200, await readThroughCache("payments-config", helpers.getPaymentConfigPayload));
        return true;
      }

      if (pathname === "/api/aw-roadside/auth/signup") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const signup = await createSignup(payload, helpers);
        helpers.sendJson(res, 201, attachSession(signup, helpers));
        recordAudit("auth-signup", { userId: signup.userId, roles: signup.roles });
        await helpers.recordSecurityEvent("auth-signup", { userId: signup.userId });
        return true;
      }

      if (pathname === "/api/aw-roadside/auth/login") {
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

      if (pathname === "/api/aw-roadside/auth/profile") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const session = requireSession(req, helpers);
        const profile = await helpers.getUserProfile(session.userId);
        helpers.sendJson(res, 200, profile);
        return true;
      }

      if (pathname === "/api/aw-roadside/provider/wallet") {
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
        helpers.sendJson(res, 200, await helpers.getProviderWalletPayload(session.userId));
        return true;
      }

      if (pathname === "/api/aw-roadside/auth/subscriber/setup") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const session = requireSession(req, helpers);
        const payload = await helpers.readJsonBody(req);
        const updatedUser = await setupSubscriber(payload, helpers, session);
        helpers.sendJson(res, 200, {
          userId: updatedUser.id,
          subscriberActive: updatedUser.subscriberActive,
          membershipPrice: 5
        });
        recordAudit("subscriber-setup", { userId: updatedUser.id });
        await helpers.recordSecurityEvent("subscriber-setup", { userId: updatedUser.id });
        return true;
      }

      if (pathname === "/api/aw-roadside/auth/provider/apply") {
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

      if (pathname === "/api/aw-roadside/auth/provider/documents") {
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

      if (pathname === "/api/aw-roadside/requests") {
        if (req.method === "POST") {
          const session = helpers.resolveUserSession(req);
          const payload = await helpers.readJsonBody(req);
          const securePayload = sanitizeProtectedRequestPayload(payload, session);
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

      if (pathname === "/api/aw-roadside/payments/create-order") {
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

      if (pathname === "/api/aw-roadside/payments/service-quote") {
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

      if (pathname === "/api/aw-roadside/payments/capture-order") {
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
        helpers.sendJson(res, 200, {
          status: capture.status,
          orderId,
          capture,
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

function sanitizeProtectedRequestPayload(payload, session) {
  const fullName = requireString(payload.fullName, "fullName");
  const phoneNumber = requireString(payload.phoneNumber, "phoneNumber");
  const serviceType = requireString(payload.serviceType, "serviceType");
  const location = requireString(payload.location, "location");
  const notes = optionalString(payload.notes);
  const assignedProviderId = optionalString(payload.assignedProviderId);

  return {
    userId: session?.userId || null,
    roles: session?.roles || [],
    subscriberActive: Boolean(payload.subscriberActive),
    fullName,
    phoneNumber,
    serviceType,
    location,
    notes,
    ...(assignedProviderId ? { assignedProviderId } : {})
  };
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
