import http from "node:http";

const host = process.env.REQUEST_SERVICE_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.REQUEST_SERVICE_PORT || "3100", 10);

const requests = [];
let nextRequestId = 1;

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

    if (pathname === "/health") {
      sendJson(res, 200, {
        status: "ok",
        service: "mock-request-service",
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (pathname === "/status") {
      sendJson(res, 200, {
        status: "running",
        service: "mock-request-service",
        requestCount: requests.length,
        openRequests: requests.filter((request) => request.status !== "COMPLETED").length
      });
      return;
    }

    if (pathname === "/requests") {
      if (req.method === "GET") {
        sendJson(res, 200, { requests });
        return;
      }

      if (req.method === "POST") {
        const payload = await readJsonBody(req);
        const created = createRequest(payload);
        requests.unshift(created);
        sendJson(res, 201, created);
        return;
      }

      sendMethodNotAllowed(res, "GET, POST");
      return;
    }

    const requestActionMatch = pathname.match(/^\/requests\/([^/]+)\/([^/]+)$/);
    if (requestActionMatch) {
      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      const requestId = decodeURIComponent(requestActionMatch[1]);
      const action = decodeURIComponent(requestActionMatch[2]);
      const payload = await readJsonBody(req);
      const updated = applyProviderAction(requestId, action, payload);
      if (!updated) {
        sendJson(res, 404, {
          error: "request-not-found",
          message: `No mock request exists for ${requestId}.`
        });
        return;
      }

      sendJson(res, 200, updated);
      return;
    }

    const requestMatch = pathname.match(/^\/requests\/([^/]+)$/);
    if (requestMatch) {
      if (req.method !== "GET") {
        sendMethodNotAllowed(res, "GET");
        return;
      }

      const requestId = decodeURIComponent(requestMatch[1]);
      const request = requests.find((entry) => entry.id === requestId);
      if (!request) {
        sendJson(res, 404, {
          error: "request-not-found",
          message: `No mock request exists for ${requestId}.`
        });
        return;
      }

      sendJson(res, 200, request);
      return;
    }

    sendJson(res, 404, { error: "route-not-found" });
  } catch (error) {
    sendJson(res, 500, {
      error: "internal-server-error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, host, () => {
  console.log(`Mock request service running at http://${host}:${port}`);
});

function createRequest(payload) {
  const fullName = requireString(payload.fullName, "fullName");
  const phoneNumber = requireString(payload.phoneNumber, "phoneNumber");
  const serviceType = requireString(payload.serviceType, "serviceType");
  const location = requireString(payload.location, "location");
  const notes = optionalString(payload.notes);
  const assignedProviderId = optionalString(payload.assignedProviderId) || null;
  const roles = Array.isArray(payload.roles) ? payload.roles.filter((value) => typeof value === "string") : [];
  const now = new Date().toISOString();

  return {
    id: `REQ-${String(nextRequestId++).padStart(4, "0")}`,
    requestId: undefined,
    status: "ACCEPTED",
    userId: Number.isInteger(payload.userId) ? payload.userId : null,
    roles,
    fullName,
    phoneNumber,
    serviceType,
    location,
    notes,
    assignedProviderId,
    paymentStatus: "PENDING",
    createdAt: now,
    updatedAt: now
  };
}

function applyProviderAction(requestId, action, payload) {
  const request = requests.find((entry) => entry.id === requestId || entry.requestId === requestId);
  if (!request) {
    return null;
  }

  const normalizedAction = requireProviderAction(action);
  const now = new Date().toISOString();
  request.providerActions = Array.isArray(request.providerActions) ? request.providerActions : [];
  request.providerActions.unshift({
    action: normalizedAction,
    etaMinutes: Number.isFinite(Number(payload.etaMinutes)) ? Number(payload.etaMinutes) : null,
    note: optionalString(payload.note),
    softContact: optionalString(payload.softContact),
    hardContact: optionalString(payload.hardContact),
    providerUserId: Number.isInteger(payload.providerUserId) ? payload.providerUserId : null,
    createdAt: now
  });

  if (normalizedAction === "accept") {
    request.status = "ASSIGNED";
    request.acceptedAt = now;
    request.assignedProviderId = request.assignedProviderId || String(payload.providerUserId || "");
  }
  if (normalizedAction === "eta") {
    request.status = "EN_ROUTE";
    request.etaMinutes = Number.isFinite(Number(payload.etaMinutes)) ? Number(payload.etaMinutes) : null;
    request.etaUpdatedAt = now;
  }
  if (normalizedAction === "soft-contact") {
    request.softContact = optionalString(payload.softContact) || optionalString(payload.note) || true;
    request.softContactedAt = now;
  }
  if (normalizedAction === "hard-contact") {
    request.hardContact = optionalString(payload.hardContact) || optionalString(payload.note) || true;
    request.hardContactedAt = now;
  }
  if (normalizedAction === "arrived") {
    request.status = "ARRIVED";
    request.arrivedAt = now;
  }
  if (normalizedAction === "completed") {
    request.status = "COMPLETED";
    request.completedAt = now;
  }

  request.updatedAt = now;
  return {
    requestId: request.requestId || request.id,
    action: normalizedAction,
    accepted: true,
    committed: true,
    status: request.status,
    request
  };
}

function requireProviderAction(action) {
  const normalized = typeof action === "string" ? action.trim().toLowerCase() : "";
  if (!["accept", "eta", "soft-contact", "hard-contact", "arrived", "completed"].includes(normalized)) {
    throw new Error(`Unsupported provider action: ${action}`);
  }
  return normalized;
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

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function applyHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendMethodNotAllowed(res, allowedMethod) {
  res.setHeader("Allow", allowedMethod);
  sendJson(res, 405, {
    error: "method-not-allowed",
    message: `Use ${allowedMethod} for this endpoint.`
  });
}
