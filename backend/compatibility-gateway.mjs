const CAPABILITY_ROUTES = {
  health: {
    method: "GET",
    path: "/api/aw-roadside/health",
    authority: "current-protected-backend",
    legacyFallback: false,
    cacheAllowed: true,
    staleAfterMs: 60 * 1000
  },
  frontendConfig: {
    method: "GET",
    path: "/api/aw-roadside/frontend-config",
    authority: "current-protected-backend",
    legacyFallback: false,
    cacheAllowed: true,
    staleAfterMs: 5 * 60 * 1000
  },
  requestCreate: {
    method: "POST",
    path: "/api/aw-roadside/requests",
    authority: "current-protected-backend",
    legacyFallback: "read-only-reference-only",
    cacheAllowed: false,
    staleAfterMs: null
  },
  requestQueue: {
    method: "GET",
    path: "/api/aw-roadside/requests",
    authority: "current-protected-backend",
    legacyFallback: "read-only-reference-only",
    cacheAllowed: true,
    staleAfterMs: 60 * 1000
  },
  providerAction: {
    method: "POST",
    path: "/api/aw-roadside/requests/:requestId/:action",
    authority: "provider-session-required",
    legacyFallback: false,
    cacheAllowed: false,
    staleAfterMs: null
  },
  servicePaymentQuote: {
    method: "POST",
    path: "/api/aw-roadside/payments/service-quote",
    authority: "backend-priced-hard-eta-required",
    legacyFallback: false,
    cacheAllowed: false,
    staleAfterMs: 30 * 1000
  },
  paymentCreate: {
    method: "POST",
    path: "/api/aw-roadside/payments/create-order",
    authority: "backend-priced-paypal-gated",
    legacyFallback: false,
    cacheAllowed: false,
    staleAfterMs: null
  },
  paymentCapture: {
    method: "POST",
    path: "/api/aw-roadside/payments/capture-order",
    authority: "backend-paypal-capture",
    legacyFallback: false,
    cacheAllowed: false,
    staleAfterMs: null
  },
  manifest: {
    method: "GET",
    path: "/api/compat/manifest",
    authority: "compatibility-gateway",
    legacyFallback: false,
    cacheAllowed: true,
    staleAfterMs: 60 * 1000
  },
  acknowledge: {
    method: "POST",
    path: "/api/compat/acknowledge",
    authority: "compatibility-gateway",
    legacyFallback: false,
    cacheAllowed: false,
    staleAfterMs: null
  },
  adminDashboard: {
    method: "GET",
    path: "/api/admin/dashboard",
    authority: "admin-session-required",
    legacyFallback: false,
    cacheAllowed: false,
    staleAfterMs: 60 * 1000
  }
};

const LEGACY_REFERENCES = [
  {
    name: "roadside-2-node-backend",
    path: "/Users/user/Downloads/AWroadside/roadside 2/backend",
    mode: "reference-only",
    usefulFor: ["pricing-shape", "old-service-request-field-map"],
    blockedRoutes: ["POST /api/service-requests/:id/accept"],
    note: "Contains an admin_override accept route and must not be used for live provider authority."
  },
  {
    name: "working-html-runtime-copy",
    path: "/Users/user/Downloads/AWroadside/roadside 2/working-html-runtime",
    mode: "reference-only",
    usefulFor: ["html-runtime-shape"],
    blockedRoutes: ["payment", "auth", "provider-completion"],
    note: "Reference copy only. Current backend/web runtime remains the active authority."
  },
  {
    name: "desktop-legacy-expo53",
    path: "/Users/user/Desktop/awroadside-fire",
    mode: "ui-reference-only",
    usefulFor: ["screen-layout-memory"],
    blockedRoutes: ["all-backend-authority"],
    note: "Old Expo 53 frontend variant. Do not use as the active backend or payment authority."
  }
];

export function createCompatibilityGateway() {
  return {
    async handle(req, res, pathname, helpers) {
      if (!pathname.startsWith("/api/compat/")) {
        return false;
      }

      if (pathname === "/api/compat/status") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }

        await helpers.recordCompatibilityAccess("gatewayStatus", {
          method: "GET",
          path: "/api/compat/status",
          authority: "compatibility-gateway",
          legacyFallback: false,
          cacheAllowed: true,
          staleAfterMs: 60 * 1000
        }, readRequestMetadata(req, "status"));
        helpers.sendJson(res, 200, buildStatus(req, helpers));
        return true;
      }

      if (pathname === "/api/compat/resolve") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }

        const url = new URL(req.url, helpers.getRequestBaseUrl(req));
        const capability = url.searchParams.get("capability") || "";
        const resolved = resolveCapability(capability, {
          requestId: url.searchParams.get("requestId") || ":requestId",
          action: url.searchParams.get("action") || ":action"
        });

        if (!resolved) {
          await helpers.recordCompatibilityAccess("resolve-miss", {
            method: "GET",
            path: "/api/compat/resolve",
            authority: "compatibility-gateway",
            legacyFallback: false,
            cacheAllowed: false,
            staleAfterMs: null
          }, {
            ...readRequestMetadata(req, "resolve-miss"),
            status: "failure",
            note: capability ? `capability=${capability}` : "capability missing",
            error: "compat-capability-not-found"
          });
          helpers.sendJson(res, 404, {
            error: "compat-capability-not-found",
            message: `No compatibility route is registered for ${capability}.`
          });
          return true;
        }

        await helpers.recordCompatibilityAccess(capability, routeDescriptor(capability), {
          ...readRequestMetadata(req, "resolve"),
          note: resolved.path
        });
        helpers.sendJson(res, 200, resolved);
        return true;
      }

      if (pathname === "/api/compat/repository") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }

        await helpers.recordCompatibilityAccess("repositoryStatus", {
          method: "GET",
          path: "/api/compat/repository",
          authority: "compatibility-gateway",
          legacyFallback: false,
          cacheAllowed: true,
          staleAfterMs: 60 * 1000
        }, readRequestMetadata(req, "repository"));
        helpers.sendJson(res, 200, await helpers.getCompatibilityRepository());
        return true;
      }

      if (pathname === "/api/compat/manifest") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }

        await helpers.recordCompatibilityAccess("manifest", routeDescriptor("manifest"), readRequestMetadata(req, "manifest"));
        helpers.sendJson(res, 200, await helpers.getCompatibilityManifest());
        return true;
      }

      if (pathname === "/api/compat/acknowledge") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        const payload = await helpers.readJsonBody(req);
        const result = await helpers.acknowledgeCompatibilityVariant({
          ...payload,
          source: normalizeString(payload.source) || readRequestMetadata(req).source,
          requester: normalizeString(payload.requester) || readRequestMetadata(req).requester
        });
        await helpers.recordCompatibilityAccess("acknowledge", routeDescriptor("acknowledge"), {
          ...readRequestMetadata(req, "acknowledge"),
          note: `${result.variant.variantId}:${result.variant.mode}`
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      if (pathname === "/api/compat/repository/record") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        const payload = await helpers.readJsonBody(req);
        const capability = normalizeString(payload.capability);
        if (!capability) {
          helpers.sendJson(res, 400, {
            error: "missing-compat-capability",
            message: "A capability name is required."
          });
          return true;
        }

        const descriptor = routeDescriptor(capability) || {
          method: normalizeString(payload.method) || "GET",
          path: normalizeString(payload.path) || "/unmapped",
          authority: normalizeString(payload.authority) || "runtime-client",
          legacyFallback: false,
          cacheAllowed: payload.cacheAllowed === true,
          staleAfterMs: payload.staleAfterMs ?? null
        };
        const entry = await helpers.recordCompatibilityAccess(capability, descriptor, {
          ...readRequestMetadata(req, "record"),
          source: normalizeString(payload.source) || readRequestMetadata(req).source,
          requester: normalizeString(payload.requester),
          status: payload.status,
          staleAfterMs: payload.staleAfterMs,
          cacheAllowed: payload.cacheAllowed,
          note: normalizeString(payload.note),
          error: normalizeString(payload.error)
        });
        helpers.sendJson(res, 200, {
          recorded: true,
          entry
        });
        return true;
      }

      helpers.sendJson(res, 404, {
        error: "compat-route-not-found"
      });
      return true;
    }
  };
}

function buildStatus(req, helpers) {
  const baseUrl = helpers.getRequestBaseUrl(req);
  return {
    controller: "aw-roadside-compatibility-gateway",
    policy: "current backend is authority; legacy variants are reference-only unless explicitly mapped",
    activeBackend: {
      protectedApiBaseUrl: `${baseUrl}/api/aw-roadside`,
      rawApiBaseUrl: `${baseUrl}/api`,
      uiBaseUrl: baseUrl
    },
    manifestPath: `${baseUrl}/api/compat/manifest`,
    capabilities: CAPABILITY_ROUTES,
    legacyReferences: LEGACY_REFERENCES,
    safeguards: [
      "No legacy fallback for payment.",
      "No legacy fallback for auth/session.",
      "No admin_override fallback for provider accept.",
      "Provider completion requires provider session on the protected backend.",
      "Service payment quote requires backend hard ETA and customer quote agreement."
    ],
    generatedAt: new Date().toISOString()
  };
}

function resolveCapability(capability, replacements) {
  const route = routeDescriptor(capability);
  if (!route) {
    return null;
  }

  return {
    capability,
    ...route,
    path: route.path
      .replace(":requestId", encodeURIComponent(replacements.requestId))
      .replace(":action", encodeURIComponent(replacements.action))
  };
}

function routeDescriptor(capability) {
  return CAPABILITY_ROUTES[capability] || null;
}

function readRequestMetadata(req, action = "") {
  const requester =
    normalizeString(req.headers["x-client-variant"]) ||
    normalizeString(req.headers["user-agent"]) ||
    "unknown-client";
  return {
    source: normalizeString(req.headers["x-client-variant"]) || "compatibility-gateway",
    requester,
    note: action ? `gateway-${action}` : null
  };
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}
