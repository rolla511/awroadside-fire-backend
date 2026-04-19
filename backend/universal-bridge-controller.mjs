import {
  applyProvider,
  createSignup,
  loginUser,
  setupSubscriber
} from "./subscription-controller.mjs";

export function createUniversalBridgeController() {
  return {
    async handle(req, res, pathname, helpers) {
      if (pathname === "/health") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(res, 200, {
          ...(await helpers.getHealthPayload()),
          route: "universal-bridge-controller"
        });
        return true;
      }

      if (pathname === "/api/auth/logout") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const session = helpers.resolveUserSession(req);
        if (session) {
          helpers.revokeUserSession(session.sessionId);
        }
        helpers.sendJson(res, 200, {
          loggedOut: true,
          message: "Session cleared."
        });
        return true;
      }

      if (pathname === "/api/requests/guest") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const normalized = helpers.normalizeServiceRequest(mapGuestRequestPayload(payload));
        const created = await helpers.createServiceRequest(normalized);
        helpers.sendJson(res, 201, created);
        return true;
      }

      if (pathname === "/api/requests/member") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const session = requireSession(req, helpers);
        const payload = await helpers.readJsonBody(req);
        const normalized = helpers.normalizeServiceRequest(mapAuthenticatedRequestPayload(payload, session));
        const created = await helpers.createServiceRequest(normalized);
        helpers.sendJson(res, 201, created);
        return true;
      }

      if (pathname === "/api/requests/history") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const session = requireSession(req, helpers);
        const requests = await helpers.readRequestLog();
        helpers.sendJson(res, 200, {
          requests: requests.filter((entry) => Number(entry.userId) === Number(session.userId))
        });
        return true;
      }

      if (pathname === "/api/subscriptions/start") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const session = requireSession(req, helpers);
        const payload = await helpers.readJsonBody(req);
        const updatedUser = await setupSubscriber(mapSubscriptionPayload(payload), helpers, session);
        helpers.sendJson(res, 200, {
          userId: updatedUser.id,
          subscriberActive: updatedUser.subscriberActive,
          membershipPrice: 5,
          subscriberProfile: updatedUser.subscriberProfile || null
        });
        return true;
      }

      if (pathname === "/api/subscriptions/status") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const session = requireSession(req, helpers);
        const profile = await helpers.getUserProfile(session.userId);
        helpers.sendJson(res, 200, {
          userId: profile.userId,
          subscriberActive: Boolean(profile.subscriberActive),
          subscriberProfile: profile.subscriberProfile || null,
          nextBillingDate: profile.nextBillingDate || null,
          accountState: profile.accountState || "ACTIVE"
        });
        return true;
      }

      if (pathname === "/api/providers/login") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const login = await loginUser(payload, helpers);
        if (!Array.isArray(login.roles) || !login.roles.includes("PROVIDER")) {
          helpers.sendJson(res, 403, {
            error: "provider-role-required",
            message: "Account is not a provider."
          });
          return true;
        }
        const sessionToken = helpers.issueUserSession({
          userId: login.userId,
          email: login.email || null,
          roles: login.roles || []
        });
        helpers.sendJson(res, 200, {
          ...login,
          sessionToken,
          token: sessionToken
        });
        return true;
      }

      if (pathname === "/api/providers/apply") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const existingSession = helpers.resolveUserSession(req);

        let session = existingSession;
        let signup = null;
        if (!session) {
          signup = await createSignup(mapProviderSignupPayload(payload), helpers);
          session = {
            userId: signup.userId,
            roles: signup.roles || [],
            email: signup.email || null
          };
        }

        const updatedUser = await applyProvider(mapProviderApplicationPayload(payload), helpers, session);
        const sessionToken = signup
          ? helpers.issueUserSession({
              userId: updatedUser.id,
              email: signup?.email || null,
              roles: signup?.roles || ["PROVIDER"]
            })
          : null;

        helpers.sendJson(res, 200, {
          userId: updatedUser.id,
          providerStatus: updatedUser.providerStatus,
          providerMonthly: updatedUser.providerMonthly || 5.99,
          ...(sessionToken ? { sessionToken, token: sessionToken } : {})
        });
        return true;
      }

      if (pathname === "/api/providers/jobs") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const session = requireProviderSession(req, helpers);
        const requests = await helpers.readRequestLog();
        const jobs = requests.filter((request) => {
          const status = normalizeString(request.status).toUpperCase();
          if (!status || status === "SUBMITTED") {
            return true;
          }
          return Number(request.assignedProviderId) === Number(session.userId) && status !== "COMPLETED";
        });
        helpers.sendJson(res, 200, { jobs });
        return true;
      }

      if (pathname === "/api/providers/jobs/accept") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const session = requireProviderSession(req, helpers);
        const payload = await helpers.readJsonBody(req);
        const requestId = readRequestId(payload);
        const updatedRequest = await helpers.applyLocalRequestAction(requestId, "accept", {
          ...payload,
          providerUserId: session.userId
        });
        helpers.sendJson(res, 200, {
          requestId: updatedRequest.id,
          action: "accept",
          accepted: true,
          committed: true,
          status: updatedRequest.status,
          request: updatedRequest
        });
        return true;
      }

      if (pathname === "/api/providers/jobs/finish") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const session = requireProviderSession(req, helpers);
        const payload = await helpers.readJsonBody(req);
        const requestId = readRequestId(payload);
        const updatedRequest = await helpers.applyLocalRequestAction(requestId, "completed", {
          ...payload,
          providerUserId: session.userId
        });
        helpers.sendJson(res, 200, {
          requestId: updatedRequest.id,
          action: "completed",
          accepted: true,
          committed: true,
          status: updatedRequest.status,
          request: updatedRequest
        });
        return true;
      }

      return false;
    }
  };
}

function requireSession(req, helpers) {
  const session = helpers.resolveUserSession(req);
  if (!session) {
    const error = new Error("A valid session token is required.");
    error.statusCode = 401;
    error.code = "session-token-required";
    throw error;
  }
  return session;
}

function requireProviderSession(req, helpers) {
  const session = requireSession(req, helpers);
  if (!Array.isArray(session.roles) || !session.roles.includes("PROVIDER")) {
    const error = new Error("A provider session is required.");
    error.statusCode = 403;
    error.code = "provider-session-required";
    throw error;
  }
  return session;
}

function mapGuestRequestPayload(payload) {
  return {
    fullName: normalizeString(payload.fullName || payload.name || "WordPress Guest"),
    phoneNumber: normalizeString(payload.phoneNumber || payload.phone || "not-provided"),
    serviceType: normalizeString(payload.serviceType || "jumpstart"),
    location: normalizeString(payload.location || "unknown"),
    notes: normalizeString(payload.notes || payload.source || "wordpress")
  };
}

function mapAuthenticatedRequestPayload(payload, session) {
  return {
    ...mapGuestRequestPayload(payload),
    userId: session.userId,
    roles: session.roles || [],
    subscriberActive: Boolean(payload.subscriberActive)
  };
}

function mapSubscriptionPayload(payload) {
  const vehicle = payload.vehicle && typeof payload.vehicle === "object" ? payload.vehicle : {};
  return {
    vehicle: {
      year: normalizeString(vehicle.year || payload.year),
      make: normalizeString(vehicle.make || payload.make),
      model: normalizeString(vehicle.model || payload.model),
      color: normalizeString(vehicle.color || payload.color)
    },
    paymentMethodMasked: normalizeString(
      payload.paymentMethodMasked || payload.paymentMethod || payload.cardMasked || "manual-test-mode"
    ),
    paymentProvider: normalizeString(payload.paymentProvider || "manual-test-mode"),
    billingZip: normalizeString(payload.billingZip),
    subscriberTermsAccepted: payload.subscriberTermsAccepted === true,
    dispatchOnlyLiabilityAccepted: payload.dispatchOnlyLiabilityAccepted === true,
    noRefundPolicyAccepted: payload.noRefundPolicyAccepted === true
  };
}

function mapProviderSignupPayload(payload) {
  return {
    fullName: normalizeString(payload.fullName || payload.name),
    phoneNumber: normalizeString(payload.phoneNumber || payload.phone),
    username: normalizeString(payload.username || payload.email?.split?.("@")?.[0] || "provider"),
    email: normalizeString(payload.email),
    password: normalizeString(payload.password),
    role: "PROVIDER",
    termsAccepted: payload.termsAccepted === true,
    providerTermsAccepted: payload.providerTermsAccepted === true,
    providerLiabilityAccepted: payload.providerLiabilityAccepted === true,
    providerHoldHarmlessAccepted: payload.providerHoldHarmlessAccepted === true
  };
}

function mapProviderApplicationPayload(payload) {
  const vehicleInfo = payload.vehicleInfo && typeof payload.vehicleInfo === "object" ? payload.vehicleInfo : {};
  const documents = payload.documents && typeof payload.documents === "object" ? payload.documents : {};
  const services = Array.isArray(payload.services)
    ? payload.services
    : typeof payload.services === "string"
      ? payload.services.split(",").map((value) => value.trim()).filter(Boolean)
      : ["LOCKOUT"];

  return {
    vehicleInfo: {
      year: normalizeString(vehicleInfo.year || payload.year),
      make: normalizeString(vehicleInfo.make || payload.make),
      model: normalizeString(vehicleInfo.model || payload.model),
      color: normalizeString(vehicleInfo.color || payload.color)
    },
    documents: {
      license: normalizeDocumentPayload(documents.license ?? payload.license),
      registration: normalizeDocumentPayload(documents.registration ?? payload.registration),
      insurance: normalizeDocumentPayload(documents.insurance ?? payload.insurance),
      helperId: normalizeDocumentPayload(documents.helperId ?? payload.helperId)
    },
    experience: normalizeString(payload.experience),
    services,
    providerTermsAccepted: payload.providerTermsAccepted === true,
    providerLiabilityAccepted: payload.providerLiabilityAccepted === true,
    providerInfo: payload.providerInfo && typeof payload.providerInfo === "object" ? payload.providerInfo : {
      legalName: normalizeString(payload.fullName || payload.name),
      phoneNumber: normalizeString(payload.phoneNumber || payload.phone),
      email: normalizeString(payload.email)
    },
    hoursOfService: payload.hoursOfService && typeof payload.hoursOfService === "object" ? payload.hoursOfService : {},
    serviceArea: normalizeString(payload.serviceArea || payload.coverageArea),
    currentLocation: normalizeString(payload.currentLocation || payload.location),
    equipment: Array.isArray(payload.equipment) ? payload.equipment : [],
    assessmentAnswers: payload.assessmentAnswers && typeof payload.assessmentAnswers === "object" ? payload.assessmentAnswers : {},
    rates: payload.rates && typeof payload.rates === "object" ? payload.rates : {}
  };
}

function readRequestId(payload) {
  const requestId = normalizeString(payload.requestId || payload.jobId || payload.id);
  if (!requestId) {
    const error = new Error('Field "requestId" is required.');
    error.statusCode = 400;
    error.code = "missing-request-id";
    throw error;
  }
  return requestId;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDocumentPayload(value) {
  if (value && typeof value === "object") {
    return value;
  }
  return Boolean(value);
}
