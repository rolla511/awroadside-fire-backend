import crypto from "node:crypto";

const DEFAULT_TRUSTED_ZONES = ["HOME_BASE"];
const DEFAULT_ADMIN_EMAIL = "admin@adub.com";
const DEFAULT_ADMIN_PASSWORD = "change-me";
const DEFAULT_ADMIN_ROLES = ["ADMIN"];
const DEFAULT_2FA_CODE = "246810";

export function createAdminController() {
  const sessions = new Map();
  const trustedZones = readTrustedZones();

  return {
    async handle(req, res, pathname, helpers) {
      if (pathname === "/api/admin/login") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        const payload = await helpers.readJsonBody(req);
        const loginResult = loginAdmin(payload, trustedZones);
        helpers.sendJson(res, loginResult.statusCode, loginResult.body);
        return true;
      }

      if (pathname === "/api/admin/dashboard") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }

        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }

        helpers.sendJson(res, 200, {
          adminEmail: adminSession.session.email,
          roles: adminSession.session.roles,
          trustedZone: adminSession.session.trustedZone,
          locationZone: adminSession.locationZone,
          requestCount: (await helpers.readRequestLog()).length,
          paymentConfigured: helpers.paymentsConfigured(),
          runtimeStartedAt: helpers.startedAt
        });
        return true;
      }

      return false;
    }
  };

  function loginAdmin(payload, trustedZoneList) {
    const email = normalizeString(payload.email);
    const password = normalizeString(payload.password);
    const locationZone = normalizeString(payload.locationZone) || null;
    const twoFactorCode = normalizeString(payload.twoFactorCode);
    const configuredEmail = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
    const configuredPassword = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
    const configuredRoles = readRoles();

    if (!email || !password) {
      return {
        statusCode: 400,
        body: {
          error: "missing-admin-credentials",
          message: "Admin email and password are required."
        }
      };
    }

    if (email !== configuredEmail || password !== configuredPassword) {
      return {
        statusCode: 401,
        body: {
          error: "invalid-admin-credentials",
          message: "Admin credentials are invalid."
        }
      };
    }

    const trustedZone = trustedZoneList.includes(locationZone || "") ? locationZone : trustedZoneList[0] || null;
    const outsideTrustedZone = !locationZone || !trustedZoneList.includes(locationZone);
    if (outsideTrustedZone && twoFactorCode !== (process.env.ADMIN_2FA_CODE || DEFAULT_2FA_CODE)) {
      return {
        statusCode: 200,
        body: {
          twoFactorRequired: true,
          adminAccess: false,
          message: "2FA is required for admin access outside the trusted zone."
        }
      };
    }

    const token = crypto.randomUUID();
    const session = {
      token,
      email,
      roles: configuredRoles,
      trustedZone,
      twoFactorVerified: outsideTrustedZone,
      createdAt: new Date().toISOString()
    };
    sessions.set(token, session);

    return {
      statusCode: 200,
      body: {
        adminAccess: true,
        token,
        roles: session.roles,
        trustedZone: session.trustedZone,
        twoFactorVerified: session.twoFactorVerified
      }
    };
  }
}

function requireAdminSession(req, sessions, trustedZones) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    return {
      ok: false,
      statusCode: 401,
      body: {
        error: "admin-auth-required",
        message: "Send a Bearer token from /api/admin/login."
      }
    };
  }

  const session = sessions.get(token);
  if (!session) {
    return {
      ok: false,
      statusCode: 401,
      body: {
        error: "invalid-admin-session",
        message: "Admin token is invalid or expired."
      }
    };
  }

  const locationZone = normalizeString(req.headers["x-location-zone"]) || null;
  const outsideTrustedZone = !locationZone || !trustedZones.includes(locationZone);
  const twoFactorVerified = String(req.headers["x-2fa-verified"] || "").toLowerCase() === "true";
  if (outsideTrustedZone && !session.twoFactorVerified && !twoFactorVerified) {
    return {
      ok: false,
      statusCode: 401,
      body: {
        error: "admin-2fa-required",
        message: "2FA is required for admin access outside the trusted zone."
      }
    };
  }

  return {
    ok: true,
    session,
    locationZone
  };
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readTrustedZones() {
  const raw = process.env.ADMIN_TRUSTED_ZONES || "";
  const parsed = raw
    .split(",")
    .map((zone) => zone.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_TRUSTED_ZONES;
}

function readRoles() {
  const raw = process.env.ADMIN_ROLES || "";
  const parsed = raw
    .split(",")
    .map((role) => role.trim().toUpperCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_ADMIN_ROLES;
}
