import path from "path";

const ACCEPTED_STATUSES = new Set(["ACCEPTED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "COMPLETED"]);
const PROVIDER_ACTIONS = new Set([
  "accept",
  "eta",
  "soft-contact",
  "hard-contact",
  "arrived",
  "completed",
  "subscriber-accept-eta",
  "customer-accept-eta",
  "confirm-arrived",
  "subscriber-arrived-confirm",
  "confirm-completion",
  "subscriber-completion-confirm",
  "prompt-payment",
  "note",
  "force-accept",
  "force-arrived",
  "force-complete",
  "mark-complete"
]);
const DEFAULT_API_STYLE = "adapter";

export function createRequestServiceController({ cacheRoot, fallbackApiBaseUrl = "", fallbackApiStyle = "roadside-backend" }) {
  const cacheTtlMs = Number.parseInt(process.env.REQUEST_SERVICE_CACHE_TTL_MS || "30000", 10);
  const configuredApiBaseUrl = (process.env.REQUEST_SERVICE_API_BASE_URL || "").trim().replace(/\/$/, "");
  const resolvedFallbackApiBaseUrl = fallbackApiBaseUrl.trim().replace(/\/$/, "");
  const configuredApiStyle = (process.env.REQUEST_SERVICE_API_STYLE || "").trim().toLowerCase();
  const resolvedFallbackApiStyle = fallbackApiStyle.trim().toLowerCase() || "roadside-backend";

  return {
    async handle(req, res, pathname, helpers) {
      if (!pathname.startsWith("/api/request-service/")) {
        return false;
      }

      const apiBaseUrl = getApiBaseUrl();
      if (!apiBaseUrl) {
        helpers.sendJson(res, 503, {
          error: "request-service-not-configured",
          message: "Set REQUEST_SERVICE_API_BASE_URL for the request service adapter."
        });
        return true;
      }

      if (pathname === "/api/request-service/health") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(res, 200, await getHealth(helpers));
        return true;
      }

      if (pathname === "/api/request-service/status") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(res, 200, await getStatus(helpers));
        return true;
      }

      if (pathname === "/api/request-service/requests") {
        if (req.method === "GET") {
          helpers.sendJson(res, 200, await listRequests(helpers));
          return true;
        }

        if (req.method === "POST") {
          const body = await helpers.readJsonBody(req);
          helpers.sendJson(res, 201, await createRequest(body, helpers));
          return true;
        }

        helpers.sendMethodNotAllowed(res, "GET, POST");
        return true;
      }

      const requestActionMatch = pathname.match(/^\/api\/request-service\/requests\/([^/]+)\/([^/]+)$/);
      if (requestActionMatch) {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        const payload = await helpers.readJsonBody(req);
        helpers.sendJson(
          res,
          200,
          await applyProviderAction(decodeURIComponent(requestActionMatch[1]), decodeURIComponent(requestActionMatch[2]), payload, helpers)
        );
        return true;
      }

      const requestMatch = pathname.match(/^\/api\/request-service\/requests\/([^/]+)$/);
      if (requestMatch) {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(res, 200, await getRequest(decodeURIComponent(requestMatch[1]), helpers));
        return true;
      }

      helpers.sendJson(res, 404, {
        error: "request-service-route-not-found"
      });
      return true;
    },
    getHealth,
    getStatus,
    listRequests,
    createRequest,
    getRequest,
    applyProviderAction,
    isConfigured() {
      return Boolean(getApiBaseUrl());
    }
  };

  function getApiBaseUrl() {
    return configuredApiBaseUrl || resolvedFallbackApiBaseUrl;
  }

  function getApiStyle() {
    return configuredApiStyle || resolvedFallbackApiStyle;
  }

  async function getHealth(helpers) {
    const apiStyle = getApiStyle();
    return fetchJsonWithCache({
      apiBaseUrl: getApiBaseUrl(),
      remotePath: getRemotePath(apiStyle, "health"),
      cacheFile: path.join(cacheRoot, "health.json"),
      cacheTtlMs,
      helpers,
      transform: (payload) => normalizeHealthPayload(apiStyle, payload)
    });
  }

  async function getStatus(helpers) {
    if (getApiStyle() === "roadside-backend") {
      const [health, requestsPayload] = await Promise.all([
        getHealth(helpers),
        listRequests(helpers)
      ]);

      return {
        status: health.status || "ok",
        service: "roadside-backend",
        requestCount: Array.isArray(requestsPayload.requests) ? requestsPayload.requests.length : 0,
        source: "roadside-backend"
      };
    }

    return fetchJsonWithCache({
      apiBaseUrl: getApiBaseUrl(),
      remotePath: getRemotePath(getApiStyle(), "status"),
      cacheFile: path.join(cacheRoot, "status.json"),
      cacheTtlMs,
      helpers
    });
  }

  async function listRequests(helpers) {
    const apiStyle = getApiStyle();
    const payload = await fetchJsonWithCache({
      apiBaseUrl: getApiBaseUrl(),
      remotePath: getRemotePath(apiStyle, "requests"),
      cacheFile: path.join(cacheRoot, "requests.json"),
      cacheTtlMs,
      helpers,
      transform: (responsePayload) => normalizeListPayload(apiStyle, responsePayload)
    });

    const requests = normalizeRequestList(payload);
    await writeRequestCache(requests, cacheRoot, helpers);
    await purgeUnacceptedCacheEntries(requests, cacheRoot, helpers);

    return {
      source: "request-service",
      cache: "read-only",
      requests
    };
  }

  async function createRequest(body, helpers) {
    const apiStyle = getApiStyle();
    const payload = sanitizeCreateRequest(body);
    const response = await fetch(`${getApiBaseUrl()}${getRemotePath(apiStyle, "requests")}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(mapCreatePayload(apiStyle, payload))
    });

    const created = normalizeCreatedPayload(apiStyle, await safeJson(response));
    if (!response.ok) {
      throw new Error(
        created?.message || created?.error || `Request service POST /requests failed with ${response.status}.`
      );
    }

    const requestId = created?.id || created?.requestId;
    if (requestId) {
      await helpers.writeCacheJson(path.join(cacheRoot, "requests", `${sanitizeId(String(requestId))}.json`), created);
    }
    await helpers.deleteFile(path.join(cacheRoot, "requests.json"));

    return created;
  }

  async function getRequest(requestId, helpers) {
    if (getApiStyle() === "roadside-backend") {
      const list = await listRequests(helpers);
      const request = list.requests.find((entry) => String(entry.id || entry.requestId) === String(requestId));
      if (!request) {
        throw new Error(`Request service request ${requestId} was not found.`);
      }
      return request;
    }

    const payload = await fetchJsonWithCache({
      apiBaseUrl: getApiBaseUrl(),
      remotePath: `${getRemotePath(getApiStyle(), "requests")}/${encodeURIComponent(requestId)}`,
      cacheFile: path.join(cacheRoot, "requests", `${sanitizeId(requestId)}.json`),
      cacheTtlMs,
      helpers
    });

    if (!isAcceptedRequest(payload)) {
      await helpers.deleteFile(path.join(cacheRoot, "requests", `${sanitizeId(requestId)}.json`));
    }

    return payload;
  }

  async function applyProviderAction(requestId, action, body, helpers) {
    const apiStyle = getApiStyle();
    const payload = sanitizeProviderAction(action, body);
    const remotePath = `${getRemotePath(apiStyle, "requests")}/${encodeURIComponent(requestId)}/${payload.action}`;
    const response = await fetch(`${getApiBaseUrl()}${remotePath}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(mapProviderActionPayload(apiStyle, payload))
    });

    const responsePayload = await safeJson(response);
    if (!response.ok) {
      if (response.status === 404) {
        return {
          requestId,
          action: payload.action,
          accepted: true,
          committed: false,
          status: null,
          message: "Request service action route is not exposed. The backend accepted the provider command as pending."
        };
      }
      throw new Error(
        responsePayload?.message || responsePayload?.error || `Request service POST ${remotePath} failed with ${response.status}.`
      );
    }

    const normalized = normalizeActionPayload(apiStyle, responsePayload, requestId, payload.action);
    if (normalized.request?.requestId || normalized.request?.id) {
      const cacheId = normalized.request.requestId || normalized.request.id;
      await helpers.writeCacheJson(path.join(cacheRoot, "requests", `${sanitizeId(String(cacheId))}.json`), normalized.request);
    }
    await helpers.deleteFile(path.join(cacheRoot, "requests.json"));

    return normalized;
  }
}

function getRemotePath(apiStyle, resource) {
  if (apiStyle === "roadside-backend") {
    if (resource === "health") {
      return "/api/health";
    }
    if (resource === "status") {
      return "/api/health";
    }
    if (resource === "requests") {
      return "/api/requests";
    }
  }

  if (resource === "health") {
    return "/health";
  }
  if (resource === "status") {
    return "/status";
  }
  if (resource === "requests") {
    return "/requests";
  }

  throw new Error(`Unknown request service resource: ${resource}`);
}

async function fetchJsonWithCache({ apiBaseUrl, remotePath, cacheFile, cacheTtlMs, helpers, transform = null }) {
  if (!apiBaseUrl) {
    throw new Error("Request service adapter is not configured.");
  }

  const cached = await helpers.readCacheJson(cacheFile, cacheTtlMs);
  if (cached) {
    return cached;
  }

  const response = await fetch(`${apiBaseUrl}${remotePath}`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Request service GET ${remotePath} failed with ${response.status}.`);
  }

  const payload = transform ? transform(await response.json()) : await response.json();
  await helpers.writeCacheJson(cacheFile, payload);
  return payload;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeRequestList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.requests)) {
    return payload.requests;
  }
  return [];
}

function normalizeHealthPayload(apiStyle, payload) {
  if (apiStyle === "roadside-backend") {
    return {
      status: payload?.status === "ok" || payload?.ok ? "ok" : "error",
      service: payload?.service || "roadside-backend",
      storage: payload?.storage || null
    };
  }
  return payload;
}

function normalizeListPayload(apiStyle, payload) {
  if (apiStyle === "roadside-backend") {
    const requests = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.requests)
        ? payload.requests
        : [];
    return {
      requests: requests.map(normalizeRoadsideRequest)
    }
  }
  return payload;
}

function normalizeCreatedPayload(apiStyle, payload) {
  if (apiStyle === "roadside-backend") {
    return normalizeRoadsideRequest(payload?.request || payload);
  }
  return payload;
}

function normalizeActionPayload(apiStyle, payload, requestId, action) {
  if (apiStyle === "roadside-backend") {
    const request = normalizeRoadsideRequest(payload?.request || payload);
    return {
      requestId: request?.requestId || request?.id || requestId,
      action,
      accepted: true,
      committed: true,
      status: request?.status || null,
      request
    };
  }

  const request = normalizeRoadsideRequest(payload?.request || payload);
  return {
    requestId: payload?.requestId || request?.requestId || request?.id || requestId,
    action: payload?.action || action,
    accepted: payload?.accepted !== false,
    committed: payload?.committed !== false,
    status: payload?.status || request?.status || null,
    request,
    ...(payload?.message ? { message: payload.message } : {})
  };
}

function normalizeRoadsideRequest(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  return {
    id: payload.id || payload.requestId || null,
    requestId: payload.id || payload.requestId || null,
    status: typeof payload.status === "string" ? payload.status.trim().toUpperCase() : "UNKNOWN",
    completionStatus: payload.completionStatus || null,
    userId: Number.isInteger(payload.userId) ? payload.userId : null,
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    fullName: payload.fullName || payload.customerName || "",
    phoneNumber: payload.phoneNumber || payload.phone || "",
    vehicleInfo: payload.vehicleInfo || payload.vehicle || "",
    location: payload.location || "",
    locationSummary: payload.locationSummary || "",
    serviceType: payload.serviceType || "",
    notes: payload.notes || "",
    maskedNotes: payload.maskedNotes || "",
    assignedProviderId: payload.assignedProviderId || null,
    paymentStatus: payload.paymentStatus || null,
    providerPayoutStatus: payload.providerPayoutStatus || null,
    providerPayoutAmount: Number.isFinite(Number(payload.providerPayoutAmount)) ? Number(payload.providerPayoutAmount) : null,
    amountCharged: Number.isFinite(Number(payload.amountCharged)) ? Number(payload.amountCharged) : null,
    amountCollected: Number.isFinite(Number(payload.amountCollected)) ? Number(payload.amountCollected) : null,
    platformShareAmount: Number.isFinite(Number(payload.platformShareAmount)) ? Number(payload.platformShareAmount) : null,
    etaMinutes: Number.isFinite(Number(payload.etaMinutes)) ? Number(payload.etaMinutes) : null,
    softEtaMinutes: Number.isFinite(Number(payload.softEtaMinutes)) ? Number(payload.softEtaMinutes) : null,
    hardEtaMinutes: Number.isFinite(Number(payload.hardEtaMinutes)) ? Number(payload.hardEtaMinutes) : null,
    etaStage: payload.etaStage || null,
    locationDisclosureLevel: payload.locationDisclosureLevel || null,
    contactDisclosureLevel: payload.contactDisclosureLevel || null,
    providerActivatedAt: payload.providerActivatedAt || null,
    exactLocationUnlockedAt: payload.exactLocationUnlockedAt || null,
    contactUnlockedAt: payload.contactUnlockedAt || null,
    customerEtaAcceptedAt: payload.customerEtaAcceptedAt || null,
    arrivalConfirmedAt: payload.arrivalConfirmedAt || null,
    completionConfirmedAt: payload.completionConfirmedAt || null,
    paymentPromptedAt: payload.paymentPromptedAt || null,
    noteExchange: Array.isArray(payload.noteExchange) ? payload.noteExchange : [],
    providerActions: Array.isArray(payload.providerActions) ? payload.providerActions : [],
    acceptedAt: payload.acceptedAt || null,
    etaUpdatedAt: payload.etaUpdatedAt || null,
    softContactedAt: payload.softContactedAt || null,
    hardContactedAt: payload.hardContactedAt || null,
    arrivedAt: payload.arrivedAt || null,
    completedAt: payload.completedAt || null,
    createdAt: payload.createdAt || null,
    updatedAt: payload.updatedAt || null
  };
}

function mapCreatePayload(apiStyle, payload) {
  if (apiStyle !== "roadside-backend") {
    return payload;
  }

  return {
    ...(payload.userId !== null ? { userId: payload.userId } : {}),
    ...(payload.roles?.length ? { roles: payload.roles } : {}),
    fullName: payload.fullName,
    phoneNumber: payload.phoneNumber,
    vehicleInfo:
      optionalString(payload.vehicleInfo) ||
      "Vehicle details not provided from app runtime",
    location: payload.location,
    serviceType: payload.serviceType,
    notes: payload.notes || "",
    ...(payload.assignedProviderId ? { assignedProviderId: payload.assignedProviderId } : {})
  };
}

async function writeRequestCache(requests, cacheRoot, helpers) {
  for (const request of requests) {
    if (!request || typeof request !== "object") {
      continue;
    }
    const requestId = request.id || request.requestId;
    if (!requestId) {
      continue;
    }
    const cacheFile = path.join(cacheRoot, "requests", `${sanitizeId(String(requestId))}.json`);
    await helpers.writeCacheJson(cacheFile, request);
  }
}

async function purgeUnacceptedCacheEntries(requests, cacheRoot, helpers) {
  const acceptedIds = new Set();

  for (const request of requests) {
    if (!request || typeof request !== "object") {
      continue;
    }
    const requestId = request.id || request.requestId;
    if (!requestId) {
      continue;
    }
    if (isAcceptedRequest(request)) {
      acceptedIds.add(sanitizeId(String(requestId)));
      continue;
    }
    await helpers.deleteFile(path.join(cacheRoot, "requests", `${sanitizeId(String(requestId))}.json`));
  }

  const existingFiles = await helpers.listCacheFiles(path.join(cacheRoot, "requests"));
  for (const fileName of existingFiles) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const id = fileName.slice(0, -5);
    if (!acceptedIds.has(id)) {
      await helpers.deleteFile(path.join(cacheRoot, "requests", fileName));
    }
  }
}

function isAcceptedRequest(request) {
  const status = typeof request?.status === "string" ? request.status.trim().toUpperCase() : "";
  return ACCEPTED_STATUSES.has(status);
}

function sanitizeId(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function sanitizeCreateRequest(payload) {
  const fullName = requireString(payload.fullName, "fullName");
  const phoneNumber = requireString(payload.phoneNumber, "phoneNumber");
  const serviceType = requireString(payload.serviceType, "serviceType");
  const location = requireString(payload.location, "location");
  const notes = optionalString(payload.notes);
  const vehicleInfo = optionalString(payload.vehicleInfo);
  const assignedProviderId = optionalString(payload.assignedProviderId);
  const userId = Number.isInteger(payload.userId) ? payload.userId : null;
  const roles = Array.isArray(payload.roles) ? payload.roles.filter((value) => typeof value === "string") : [];

  return {
    ...(userId !== null ? { userId } : {}),
    ...(roles.length ? { roles } : {}),
    fullName,
    phoneNumber,
    serviceType,
    location,
    notes,
    ...(vehicleInfo ? { vehicleInfo } : {}),
    ...(assignedProviderId ? { assignedProviderId } : {})
  };
}

function sanitizeProviderAction(action, payload) {
  const normalizedAction = typeof action === "string" ? action.trim().toLowerCase() : "";
  if (!PROVIDER_ACTIONS.has(normalizedAction)) {
    throw new Error(`Unsupported provider action: ${action}`);
  }

  const etaMinutes = Number.isFinite(Number(payload?.etaMinutes)) ? Number(payload.etaMinutes) : null;
  const note = optionalString(payload?.note);
  const softContact = optionalString(payload?.softContact);
  const hardContact = optionalString(payload?.hardContact);
  const providerUserId = Number.isInteger(payload?.providerUserId) ? payload.providerUserId : null;

  return {
    action: normalizedAction,
    ...(etaMinutes !== null ? { etaMinutes } : {}),
    ...(note ? { note } : {}),
    ...(softContact ? { softContact } : {}),
    ...(hardContact ? { hardContact } : {}),
    ...(providerUserId !== null ? { providerUserId } : {})
  };
}

function mapProviderActionPayload(apiStyle, payload) {
  if (apiStyle !== "roadside-backend") {
    return payload;
  }
  return {
    action: payload.action,
    etaMinutes: payload.etaMinutes ?? null,
    note: payload.note || "",
    softContact: payload.softContact || "",
    hardContact: payload.hardContact || "",
    providerUserId: payload.providerUserId ?? null
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
