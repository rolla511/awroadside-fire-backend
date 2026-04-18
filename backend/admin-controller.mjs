import crypto from "node:crypto";

const DEFAULT_TRUSTED_ZONES = ["HOME_BASE"];
const DEFAULT_ADMIN_EMAIL = "admin@adub.com";
const DEFAULT_ADMIN_PASSWORD = "change-me";
const DEFAULT_ADMIN_ROLES = ["ADMIN"];
const DEFAULT_2FA_CODE = "246810";
const ACCOUNT_STATES = new Set(["ACTIVE", "INACTIVE", "SUSPENDED"]);

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
        const loginResult = loginAdmin(payload, trustedZones, sessions);
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

        helpers.sendJson(res, 200, await buildDashboardPayload(adminSession, helpers));
        return true;
      }

      if (pathname === "/api/admin/payments/config") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }
        helpers.sendJson(res, 200, mapPricingConfig(await helpers.getPaymentConfigPayload()));
        return true;
      }

      if (pathname === "/api/admin/requests") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }

        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }

        const [users, requests] = await Promise.all([helpers.readUsers(), helpers.readRequestLog()]);
        const userById = new Map(users.map((user) => [Number(user.id), user]));
        userById.getRoadsidePolicy = helpers.getRoadsidePolicy;
        helpers.sendJson(res, 200, {
          requests: requests.map((request) => mapServiceHistory(request, userById)),
          financials: requests.map((request) => mapFinancialRecord(request, userById))
        });
        return true;
      }

      if (pathname === "/api/admin/subscribers") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }

        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }

        const [users, requests] = await Promise.all([helpers.readUsers(), helpers.readRequestLog()]);
        helpers.sendJson(res, 200, {
          subscribers: users
            .filter((user) => Array.isArray(user.roles) && user.roles.includes("SUBSCRIBER"))
            .map((user) => mapSubscriber(user, requests))
        });
        return true;
      }

      if (pathname === "/api/admin/search") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }
        const url = new URL(req.url, "http://127.0.0.1");
        const query = normalizeString(url.searchParams.get("q"));
        const [users, requests] = await Promise.all([helpers.readUsers(), helpers.readRequestLog()]);
        helpers.sendJson(res, 200, runKeywordSearch(query, users, requests));
        return true;
      }

      const accountStateMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/account-state$/);
      if (accountStateMatch) {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const result = await updateUserAccountState(Number(accountStateMatch[1]), payload, helpers);
        await recordAdminEvent(helpers, "admin-user-account-state", {
          adminEmail: adminSession.session.email,
          userId: result.user.id,
          accountState: result.user.accountState
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      if (pathname === "/api/admin/provider/approve") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const providerId = Number(payload.providerId ?? payload.userId);
        const result = await approveProvider(providerId, payload, helpers);
        await recordAdminEvent(helpers, "admin-provider-approve", {
          adminEmail: adminSession.session.email,
          userId: result.provider.id
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      const providerApproveMatch = pathname.match(/^\/api\/admin\/providers\/(\d+)\/approve$/);
      if (providerApproveMatch) {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const result = await approveProvider(Number(providerApproveMatch[1]), payload, helpers);
        await recordAdminEvent(helpers, "admin-provider-approve", {
          adminEmail: adminSession.session.email,
          userId: result.provider.id
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      if (pathname === "/api/admin/refund") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const requestId = normalizeString(payload.requestId);
        const result = await refundRequest(requestId, payload, helpers);
        await recordAdminEvent(helpers, "admin-request-refund", {
          adminEmail: adminSession.session.email,
          requestId: result.request.id
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      const requestResetMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)\/reset$/);
      if (requestResetMatch) {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const result = await resetRequest(decodeURIComponent(requestResetMatch[1]), payload, helpers);
        await recordAdminEvent(helpers, "admin-request-reset", {
          adminEmail: adminSession.session.email,
          requestId: result.request.id
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      if (pathname === "/api/admin/payout") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const requestId = normalizeString(payload.requestId);
        const result = await completePayout(requestId, payload, helpers);
        await recordAdminEvent(helpers, "admin-payout-complete", {
          adminEmail: adminSession.session.email,
          requestId: result.request.id
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      const requestRefundMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)\/refund$/);
      if (requestRefundMatch) {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const result = await refundRequest(decodeURIComponent(requestRefundMatch[1]), payload, helpers);
        await recordAdminEvent(helpers, "admin-request-refund", {
          adminEmail: adminSession.session.email,
          requestId: result.request.id
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      const payoutCompleteMatch = pathname.match(/^\/api\/admin\/payouts\/([^/]+)\/complete$/);
      if (payoutCompleteMatch) {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const result = await completePayout(decodeURIComponent(payoutCompleteMatch[1]), payload, helpers);
        await recordAdminEvent(helpers, "admin-payout-complete", {
          adminEmail: adminSession.session.email,
          requestId: result.request.id
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      const forceActionMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)\/force-action$/);
      if (forceActionMatch) {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }
        const adminSession = requireAdminSession(req, sessions, trustedZones);
        if (!adminSession.ok) {
          helpers.sendJson(res, adminSession.statusCode, adminSession.body);
          return true;
        }
        const payload = await helpers.readJsonBody(req);
        const requestId = decodeURIComponent(forceActionMatch[1]);
        const action = normalizeString(payload.action).toLowerCase();
        const allowed = new Set(["force-accept", "force-arrived", "force-complete", "prompt-payment", "note"]);
        if (!allowed.has(action)) {
          helpers.sendJson(res, 400, {
            error: "unsupported-force-action",
            message: "Supported force actions: force-accept, force-arrived, force-complete, prompt-payment, note."
          });
          return true;
        }
        const request = await helpers.applyLocalRequestAction(requestId, action, {
          ...payload,
          adminAction: true,
          actorRole: "ADMIN"
        });
        await recordAdminEvent(helpers, "admin-force-action", {
          adminEmail: adminSession.session.email,
          requestId,
          action
        });
        helpers.sendJson(res, 200, {
          message: `Admin force action ${action} applied to ${requestId}.`,
          request
        });
        return true;
      }

      return false;
    }
  };
}

function loginAdmin(payload, trustedZoneList, sessions) {
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

async function buildDashboardPayload(adminSession, helpers) {
  const [users, requests, payments, paymentConfig] = await Promise.all([
    helpers.readUsers(),
    helpers.readRequestLog(),
    helpers.readPaymentLog ? helpers.readPaymentLog() : Promise.resolve([]),
    helpers.getPaymentConfigPayload()
  ]);
  const userById = new Map(users.map((user) => [Number(user.id), user]));
  userById.getRoadsidePolicy = helpers.getRoadsidePolicy;
  const subscribers = users
    .filter((user) => Array.isArray(user.roles) && user.roles.includes("SUBSCRIBER"))
    .map((user) => mapSubscriber(user, requests));
  const providers = users
    .filter((user) => Array.isArray(user.roles) && user.roles.includes("PROVIDER"))
    .map((user) => mapProvider(user));
  const serviceHistory = requests.map((request) => mapServiceHistory(request, userById));
  const financials = requests.map((request) => mapFinancialRecord(request, userById));
  const overdueSubscribers = subscribers.filter((entry) => entry.subscriptionStatus === "OVERDUE");
  const queue = requests.filter((request) => ["SUBMITTED", "ASSIGNED"].includes(normalizeString(request.status).toUpperCase()));
  const inService = requests.filter((request) => ["EN_ROUTE", "ARRIVED"].includes(normalizeString(request.status).toUpperCase()));
  const policy = helpers.getRoadsidePolicy?.() || null;

  return {
    adminEmail: adminSession.session.email,
    roles: adminSession.session.roles,
    trustedZone: adminSession.session.trustedZone,
    locationZone: adminSession.locationZone,
    requestCount: requests.length,
    paymentConfigured: helpers.paymentsConfigured(),
    runtimeStartedAt: helpers.startedAt,
    stats: {
      activeSubscribers: subscribers.filter((entry) => entry.accountState === "ACTIVE").length,
      suspendedUsers: users.filter((user) => normalizeAccountState(user.accountState) === "SUSPENDED").length,
      pendingProviders: providers.filter((entry) => entry.providerStatus === "PENDING_APPROVAL").length,
      overdueSubscriptions: overdueSubscribers.length,
      payoutsPending: financials.filter((entry) => entry.providerPayoutStatus === "PENDING").length,
      refundsFlagged: financials.filter((entry) => entry.refundIssued || entry.refundFlag || entry.disputeFlag).length
    },
    policy,
    subscribers,
    providers,
    overdueSubscribers,
    queue,
    inService,
    serviceHistory,
    financials,
    pricingConfig: mapPricingConfig(paymentConfig),
    paymentEvents: payments.slice(0, 20)
  };
}

async function updateUserAccountState(userId, payload, helpers) {
  const users = await helpers.readUsers();
  const user = users.find((entry) => Number(entry.id) === Number(userId));
  if (!user) {
    throw new Error(`User ${userId} was not found.`);
  }

  const nextState = normalizeAccountState(payload.accountState);
  if (!ACCOUNT_STATES.has(nextState)) {
    throw new Error("Account state must be ACTIVE, INACTIVE, or SUSPENDED.");
  }

  user.accountState = nextState;
  if (nextState === "SUSPENDED") {
    user.subscriberActive = false;
  }

  await helpers.writeUsers(users);
  return {
    message: `User ${user.fullName || user.email} marked ${nextState}.`,
    user: summarizeUser(user)
  };
}

async function approveProvider(userId, payload, helpers) {
  const users = await helpers.readUsers();
  const provider = users.find((entry) => Number(entry.id) === Number(userId));
  if (!provider) {
    throw new Error(`Provider ${userId} was not found.`);
  }
  if (!Array.isArray(provider.roles) || !provider.roles.includes("PROVIDER")) {
    throw new Error("Selected user is not a provider.");
  }
  const documentStatus = provider.providerProfile?.documentStatus || summarizeProviderDocuments(provider.providerProfile?.documents);
  if (!documentStatus.meetsMinimumRequirements) {
    throw new Error(`Provider documents missing: ${documentStatus.missing.join(", ")}.`);
  }
  if (provider.terms?.provider?.accepted !== true) {
    throw new Error("Provider terms have not been accepted.");
  }
  if (provider.providerProfile?.assessment?.passed !== true) {
    throw new Error("Provider safety assessment has not passed.");
  }
  if (!provider.providerProfile?.hoursOfService?.hasHours) {
    throw new Error("Provider hours of service are required before approval.");
  }
  if (!normalizeString(provider.providerProfile?.serviceArea)) {
    throw new Error("Provider service area is required before approval.");
  }

  provider.providerStatus = "APPROVED";
  provider.accountState = "ACTIVE";
  provider.approvedAt = new Date().toISOString();
  provider.approvalNote = normalizeString(payload.note) || null;

  await helpers.writeUsers(users);
  return {
    message: `Provider ${provider.fullName || provider.email} approved.`,
    provider: summarizeUser(provider)
  };
}

async function resetRequest(requestId, payload, helpers) {
  const requests = await helpers.readRequestLog();
  const index = requests.findIndex((entry) => String(entry.id || entry.requestId) === String(requestId));
  if (index === -1) {
    throw new Error(`Request ${requestId} was not found.`);
  }

  const current = requests[index];
  const now = new Date().toISOString();
  requests[index] = {
    ...current,
    status: "SUBMITTED",
    completionStatus: "OPEN",
    assignedProviderId: null,
    etaMinutes: null,
    acceptedAt: null,
    etaUpdatedAt: null,
    softContactedAt: null,
    hardContactedAt: null,
    arrivedAt: null,
    completedAt: null,
    providerPayoutStatus: current.refundIssued ? "ON_HOLD" : "UNASSIGNED",
    providerActions: [],
    adminResetAt: now,
    adminResetReason: normalizeString(payload.reason) || null,
    updatedAt: now
  };
  await helpers.writeRequestLog(requests);

  return {
    message: `Request ${requestId} reset for manual follow-up.`,
    request: requests[index]
  };
}

async function refundRequest(requestId, payload, helpers) {
  const policy = helpers.getRoadsidePolicy?.();
  if (policy?.financial?.noRefundsAfterPayment) {
    const error = new Error("Refunds are disabled by platform policy once payment is submitted.");
    error.statusCode = 409;
    error.code = "no-refund-policy";
    throw error;
  }
  const requests = await helpers.readRequestLog();
  const index = requests.findIndex((entry) => String(entry.id || entry.requestId) === String(requestId));
  if (index === -1) {
    throw new Error(`Request ${requestId} was not found.`);
  }

  const current = requests[index];
  const now = new Date().toISOString();
  requests[index] = {
    ...current,
    refundIssued: true,
    refundFlag: true,
    refundReason: normalizeString(payload.reason) || null,
    refundAt: now,
    paymentStatus: "REFUNDED",
    amountCollected: 0,
    providerPayoutStatus: "ON_HOLD",
    updatedAt: now
  };
  await helpers.writeRequestLog(requests);

  return {
    message: `Refund recorded for request ${requestId}.`,
    request: requests[index]
  };
}

async function completePayout(requestId, payload, helpers) {
  const requests = await helpers.readRequestLog();
  const index = requests.findIndex((entry) => String(entry.id || entry.requestId) === String(requestId));
  if (index === -1) {
    throw new Error(`Request ${requestId} was not found.`);
  }

  const current = requests[index];
  const now = new Date().toISOString();
  requests[index] = {
    ...current,
    providerPayoutStatus: "COMPLETED",
    payoutCompletedAt: now,
    payoutReference: normalizeString(payload.reference) || null,
    updatedAt: now
  };
  await helpers.writeRequestLog(requests);

  return {
    message: `Provider payout marked complete for request ${requestId}.`,
    request: requests[index]
  };
}

async function recordAdminEvent(helpers, event, details) {
  if (typeof helpers.recordSecurityEvent !== "function") {
    return;
  }
  await helpers.recordSecurityEvent(event, details);
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

function mapSubscriber(user, requests) {
  const savedVehicles = Array.isArray(user.subscriberProfile?.savedVehicles)
    ? user.subscriberProfile.savedVehicles
    : user.subscriberProfile?.vehicle
      ? [user.subscriberProfile.vehicle]
      : [];
  const nextBillingDate = user.nextBillingDate || null;
  const isOverdue = nextBillingDate ? new Date(nextBillingDate).getTime() < Date.now() : false;

  return {
    id: user.id,
    fullName: user.fullName || "",
    phoneNumber: user.phoneNumber || "",
    email: user.email || "",
    subscriptionStatus: isOverdue ? "OVERDUE" : user.subscriberActive ? "ACTIVE" : "INACTIVE",
    nextBillingDate,
    signUpDate: user.signUpDate || user.createdAt || null,
    accountState: normalizeAccountState(user.accountState),
    savedVehicles,
    paymentInfo: user.subscriberProfile?.paymentInfo || null,
    terms: user.terms?.subscriber || null,
    serviceHistoryCount: requests.filter((request) => Number(request.userId) === Number(user.id)).length
  };
}

function mapProvider(user) {
  const documentStatus = user.providerProfile?.documentStatus || summarizeProviderDocuments(user.providerProfile?.documents);
  const rating = mapProviderRating(user);
  return {
    id: user.id,
    fullName: user.fullName || "",
    phoneNumber: user.phoneNumber || "",
    email: user.email || "",
    accountState: normalizeAccountState(user.accountState),
    providerStatus: user.providerStatus || "DRAFT",
    services: Array.isArray(user.services) ? user.services : [],
    approvedAt: user.approvedAt || null,
    available: Boolean(user.available),
    hoursOfService: user.providerProfile?.hoursOfService || null,
    currentLocation: user.providerProfile?.currentLocation || null,
    serviceArea: user.providerProfile?.serviceArea || null,
    providerInfo: user.providerProfile?.providerInfo || null,
    assessment: user.providerProfile?.assessment || null,
    rating,
    documentStatus,
    documents: user.providerProfile?.documents || {},
    terms: user.terms?.provider || null
  };
}

function mapServiceHistory(request, userById) {
  return {
    requestId: request.id || request.requestId,
    requestDate: request.submittedAt || request.createdAt || null,
    serviceType: request.serviceType || "",
    customerType: request.customerType || (request.userId ? "SUBSCRIBER" : "GUEST"),
    fullName: request.fullName || "",
    phoneNumber: request.phoneNumber || "",
    location: request.location || "",
    vehicleInfo: request.vehicleInfo || "",
    etaMinutes: Number.isFinite(Number(request.etaMinutes)) ? Number(request.etaMinutes) : null,
    providerAssigned: resolveProviderName(request.assignedProviderId, userById),
    paymentStatus: request.paymentStatus || "UNKNOWN",
    completionStatus: request.completionStatus || request.status || "OPEN",
    customerEtaAcceptedAt: request.customerEtaAcceptedAt || null,
    arrivalConfirmedAt: request.arrivalConfirmedAt || null,
    completionConfirmedAt: request.completionConfirmedAt || null,
    paymentPromptedAt: request.paymentPromptedAt || null,
    noteCount: Array.isArray(request.noteExchange) ? request.noteExchange.length : 0,
    refundFlag: Boolean(request.refundFlag || request.refundIssued),
    disputeFlag: Boolean(request.disputeFlag)
  };
}

function mapFinancialRecord(request, userById) {
  const policy = typeof userById.getRoadsidePolicy === "function" ? userById.getRoadsidePolicy() : null;
  const serviceChargeRate = policy?.financial?.platformServiceChargeRate || 0.02;
  
  const customerTier = request.customerTier || request.customerType || "GUEST";
  const amountCharged = Number(request.amountCharged || 0);
  const amountCollected = Number(request.amountCollected || 0);
  const serviceFee = Number(request.pricing?.serviceFee || 0);
  const additionalServices = Number(request.pricing?.additionalServices || 0);
  const totalServiceGross = serviceFee + additionalServices;
  
  const dispatchFee = Number(request.pricing?.dispatchFee || 0);
  const assignmentFee = Number(request.pricing?.assignmentFee || 0);
  
  let platformCharge = 0;
  let calculationFormula = "";

  if (customerTier === "SUBSCRIBER") {
    // Subscriber: $40 - $2 assignment - 2% service rate
    const percentageCharge = Number((totalServiceGross * serviceChargeRate).toFixed(2));
    platformCharge = assignmentFee + percentageCharge;
    calculationFormula = `${totalServiceGross} (gross) - ${assignmentFee} (assignment) - ${percentageCharge} (2% platform) = ${Number((totalServiceGross - platformCharge).toFixed(2))} (payout)`;
  } else {
    // Guest: $55 - $10 dispatch - $2 assignment = $43 payout
    platformCharge = dispatchFee + assignmentFee;
    calculationFormula = `${totalServiceGross} (gross) - ${dispatchFee} (dispatch) - ${assignmentFee} (assignment) = ${Number((totalServiceGross - platformCharge).toFixed(2))} (payout)`;
  }

  const providerPayout = Number((totalServiceGross - platformCharge).toFixed(2));

  return {
    requestId: request.id || request.requestId,
    fullName: request.fullName || "",
    customerTier,
    providerAssigned: resolveProviderName(request.assignedProviderId, userById),
    amountCharged,
    amountCollected,
    totalServiceGross,
    serviceFee,
    additionalServices,
    platformServiceCharge: platformCharge,
    providerPayout,
    providerPayoutAmount: Number(request.providerPayoutAmount || providerPayout),
    platformShareAmount: Number(request.platformShareAmount || platformCharge),
    assignmentFee,
    dispatchFee,
    serviceTaxAmount: Number(request.serviceTaxAmount || request.pricing?.serviceTaxAmount || 0),
    paymentPromptedAt: request.paymentPromptedAt || null,
    refundIssued: Boolean(request.refundIssued),
    refundFlag: Boolean(request.refundFlag),
    disputeFlag: Boolean(request.disputeFlag),
    paymentStatus: request.paymentStatus || "UNKNOWN",
    providerPayoutStatus: request.providerPayoutStatus || "UNASSIGNED",
    spreadsheetLog: {
      calculation: calculationFormula,
      payout: providerPayout,
      platformServiceCharges: platformCharge,
      chargePercentage: customerTier === "SUBSCRIBER" ? `${(serviceChargeRate * 100).toFixed(0)}%` : "0%"
    }
  };
}

function resolveProviderName(providerId, userById) {
  if (!providerId) {
    return "Unassigned";
  }
  const provider = userById.get(Number(providerId));
  return provider ? `${provider.fullName || provider.email} (#${provider.id})` : `Provider #${providerId}`;
}

function summarizeUser(user) {
  const summary = {
    id: user.id,
    fullName: user.fullName || "",
    email: user.email || "",
    phoneNumber: user.phoneNumber || "",
    accountState: normalizeAccountState(user.accountState),
    providerStatus: user.providerStatus || null,
    subscriberActive: Boolean(user.subscriberActive),
    available: Boolean(user.available)
  };
  
  // Forbidden fields on public spectrum: Never include sensitive fields in summary
  // unless explicitly requested by an admin-specific mapper
  delete summary.password;
  delete summary.passwordHash;
  delete summary.adminFields; // hypothetical admin-only data
  
  return summary;
}

function mapPricingConfig(paymentConfig = {}) {
  const guestPayout = Number(paymentConfig.guestServicePrice || 0) -
    Number(paymentConfig.guestDispatchFee || 0) -
    Number(paymentConfig.assignmentFee || 0);
  const subscriberPayout = Number(paymentConfig.subscriberServicePrice || 0) -
    Number(paymentConfig.subscriberDispatchFee || 0) -
    Number(paymentConfig.assignmentFee || 0);
  return {
    provider: paymentConfig.provider || "paypal",
    enabled: Boolean(paymentConfig.enabled),
    mode: paymentConfig.mode || "sandbox",
    priorityServicePrice: Number(paymentConfig.priorityServicePrice || 0),
    guestServicePrice: Number(paymentConfig.guestServicePrice || 0),
    subscriberServicePrice: Number(paymentConfig.subscriberServicePrice || 0),
    assignmentFee: Number(paymentConfig.assignmentFee || 0),
    guestDispatchFee: Number(paymentConfig.guestDispatchFee || 0),
    subscriberDispatchFee: Number(paymentConfig.subscriberDispatchFee || 0),
    estimatedGuestProviderPayout: Math.max(guestPayout, 0),
    estimatedSubscriberProviderPayout: Math.max(subscriberPayout, 0)
  };
}

function summarizeProviderDocuments(documents = {}) {
  const required = ["license", "registration", "insurance"];
  const missing = required.filter((docType) => !Boolean(documents?.[docType]?.submitted || documents?.[docType] === true));
  const submittedCount = Object.values(documents || {}).filter((entry) => entry?.submitted || entry === true).length;
  return {
    required,
    submittedCount,
    missing,
    meetsMinimumRequirements: missing.length === 0
  };
}

function mapProviderRating(user) {
  const rates = user?.providerProfile?.rates || {};
  const ratingTotal = Number(rates.ratingTotal || 0);
  const ratingCount = Number(rates.ratingCount || 0);
  const averageRating = ratingCount > 0 ? Number((ratingTotal / ratingCount).toFixed(2)) : 0;
  return {
    ratingTotal,
    ratingCount,
    averageRating,
    ratingRange: "1 to 8"
  };
}

function runKeywordSearch(query, users, requests) {
  if (!query) {
    return {
      query: "",
      subscribers: [],
      providers: [],
      requests: []
    };
  }
  const match = (value) => normalizeString(value).toLowerCase().includes(query.toLowerCase());
  return {
    query,
    subscribers: users
      .filter((user) => Array.isArray(user.roles) && user.roles.includes("SUBSCRIBER"))
      .filter((user) => [user.fullName, user.email, user.phoneNumber].some(match))
      .map((user) => summarizeUser(user)),
    providers: users
      .filter((user) => Array.isArray(user.roles) && user.roles.includes("PROVIDER"))
      .filter((user) => [
        user.fullName,
        user.email,
        user.phoneNumber,
        user.providerProfile?.serviceArea,
        user.providerProfile?.currentLocation
      ].some(match))
      .map((user) => summarizeUser(user)),
    requests: requests
      .filter((request) => [
        request.id,
        request.fullName,
        request.phoneNumber,
        request.serviceType,
        request.location,
        request.vehicleInfo
      ].some(match))
      .map((request) => ({
        requestId: request.id || request.requestId,
        fullName: request.fullName || "",
        serviceType: request.serviceType || "",
        status: request.status || "UNKNOWN"
      }))
  };
}

function normalizeAccountState(value) {
  return normalizeString(value || "ACTIVE").toUpperCase() || "ACTIVE";
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
