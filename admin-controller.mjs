import crypto from "crypto";

const DEFAULT_TRUSTED_ZONES = ["HOME_BASE"];
const DEFAULT_ADMIN_EMAIL = "admin@adub.com";
const DEFAULT_ADMIN_PASSWORD = "change-me";
const DEFAULT_ADMIN_ROLES = ["ADMIN"];
const DEFAULT_2FA_CODE = "246810";
const ACCOUNT_STATES = new Set(["ACTIVE", "INACTIVE", "SUSPENDED"]);
const CANONICAL_ADMIN_API_PREFIX = "/admin-controller.mjs";
const ADMIN_API_PREFIX_ALIASES = Object.freeze([
  CANONICAL_ADMIN_API_PREFIX,
  "/api/admin"
]);

export function createAdminController() {
  const sessions = new Map();
  const trustedZones = readTrustedZones();

  return {
    async handle(req, res, pathname, helpers) {
      pathname = normalizeAdminApiPath(pathname);
      if (!pathname) {
        return false;
      }

      if (pathname === "/admin-controller.mjs/login") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        const payload = await helpers.readJsonBody(req);
        const loginResult = loginAdmin(payload, trustedZones, sessions);
        helpers.sendJson(res, loginResult.statusCode, loginResult.body);
        return true;
      }

      if (pathname === "/admin-controller.mjs/dashboard") {
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

      if (pathname === "/admin-controller.mjs/payments/config") {
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

      if (pathname === "/admin-controller.mjs/requests") {
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

      if (pathname === "/admin-controller.mjs/subscribers") {
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

      if (pathname === "/admin-controller.mjs/search") {
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
        const role = normalizeString(url.searchParams.get("role"));
        const [users, requests] = await Promise.all([helpers.readUsers(), helpers.readRequestLog()]);
        helpers.sendJson(res, 200, runKeywordSearch(query, role, users, requests));
        return true;
      }

      const userProfileMatch = pathname.match(/^\/admin-controller\.mjs\/users\/(\d+)\/profile$/);
      if (userProfileMatch) {
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
        const profile = buildAdminUserProfile(Number(userProfileMatch[1]), users, requests);
        helpers.sendJson(res, 200, profile);
        return true;
      }

      const accountStateMatch = pathname.match(/^\/admin-controller\.mjs\/users\/(\d+)\/account-state$/);
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

      if (pathname === "/admin-controller.mjs/provider/approve") {
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
        const result = await approveProvider(providerId, {
          ...payload,
          adminEmail: adminSession.session.email
        }, helpers);
        await recordAdminEvent(helpers, "admin-provider-approve", {
          adminEmail: adminSession.session.email,
          userId: result.provider.id
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      const providerApproveMatch = pathname.match(/^\/admin-controller\.mjs\/providers\/(\d+)\/approve$/);
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
        const result = await approveProvider(Number(providerApproveMatch[1]), {
          ...payload,
          adminEmail: adminSession.session.email
        }, helpers);
        await recordAdminEvent(helpers, "admin-provider-approve", {
          adminEmail: adminSession.session.email,
          userId: result.provider.id
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      const providerTrainingMatch = pathname.match(/^\/admin-controller\.mjs\/providers\/(\d+)\/training$/);
      if (providerTrainingMatch) {
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
        const result = await updateProviderTraining(Number(providerTrainingMatch[1]), payload, helpers);
        await recordAdminEvent(helpers, "admin-provider-training", {
          adminEmail: adminSession.session.email,
          userId: result.provider.id,
          trainingStatus: result.provider.discipline?.training?.status || null
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      if (pathname === "/admin-controller.mjs/refund") {
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

      const requestResetMatch = pathname.match(/^\/admin-controller\.mjs\/requests\/([^/]+)\/reset$/);
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

      if (pathname === "/admin-controller.mjs/payout") {
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

      const requestRefundMatch = pathname.match(/^\/admin-controller\.mjs\/requests\/([^/]+)\/refund$/);
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

      const payoutCompleteMatch = pathname.match(/^\/admin-controller\.mjs\/payouts\/([^/]+)\/complete$/);
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

      const forceActionMatch = pathname.match(/^\/admin-controller\.mjs\/requests\/([^/]+)\/force-action$/);
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
        const allowed = new Set([
          "force-accept",
          "force-arrived",
          "force-complete",
          "prompt-payment",
          "note",
          "cancel-service",
          "approve-service-change",
          "deny-service-change"
        ]);
        if (!allowed.has(action)) {
          helpers.sendJson(res, 400, {
            error: "unsupported-force-action",
            message:
              "Supported force actions: force-accept, force-arrived, force-complete, prompt-payment, note, cancel-service, approve-service-change, deny-service-change."
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

      const requestReassignMatch = pathname.match(/^\/admin-controller\.mjs\/requests\/([^/]+)\/reassign$/);
      if (requestReassignMatch) {
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
        const result = await reassignRequest(decodeURIComponent(requestReassignMatch[1]), payload, helpers, adminSession.session.email);
        await recordAdminEvent(helpers, "admin-request-reassign", {
          adminEmail: adminSession.session.email,
          requestId: result.request.id || result.request.requestId || null,
          reassignment: result.request.lastReassignment || null
        });
        helpers.sendJson(res, 200, result);
        return true;
      }

      return false;
    }
  };
}

function loginAdmin(payload, trustedZoneList, sessions) {
  const identifier = normalizeString(payload.identifier || payload.email).toLowerCase();
  const password = normalizeString(payload.password);
  const locationZone = normalizeString(payload.locationZone) || null;
  const twoFactorCode = normalizeString(payload.twoFactorCode);
  const configuredEmail = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  const configuredIdentifier = configuredEmail.toLowerCase();
  const configuredUsername = configuredIdentifier.includes("@") ? configuredIdentifier.split("@")[0] : configuredIdentifier;
  const configuredPassword = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  const configuredRoles = readRoles();

  if (!identifier || !password) {
    return {
      statusCode: 400,
      body: {
        error: "missing-admin-credentials",
        message: "Admin identifier and password are required."
      }
    };
  }

  if (![configuredIdentifier, configuredUsername].includes(identifier) || password !== configuredPassword) {
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
    email: configuredEmail,
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
  const now = new Date().toISOString();
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
  const providerApprovalAlerts = providers
    .map((provider) => buildProviderApprovalAlert(provider, now))
    .filter((entry) => entry?.redFlag);
  const serviceHistory = requests.map((request) => mapServiceHistory(request, userById));
  const financials = requests.map((request) => mapFinancialRecord(request, userById));
  const overdueSubscribers = subscribers.filter((entry) => entry.subscriptionStatus === "OVERDUE");
  const queue = requests.filter((request) => ["SUBMITTED", "ASSIGNED"].includes(normalizeString(request.status).toUpperCase()));
  const inService = requests.filter((request) => ["EN_ROUTE", "ARRIVED"].includes(normalizeString(request.status).toUpperCase()));
  const trainingCalendar = providers
    .filter((entry) => entry.discipline?.training?.scheduledFor)
    .sort((left, right) => String(left.discipline.training.scheduledFor).localeCompare(String(right.discipline.training.scheduledFor)))
    .map((entry) => ({
      providerId: entry.id,
      fullName: entry.fullName,
      status: entry.discipline?.training?.status || "SCHEDULED",
      scheduledFor: entry.discipline?.training?.scheduledFor || null,
      note: entry.discipline?.training?.note || null
    }));
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
      providerApprovalAlerts: providerApprovalAlerts.length,
      overdueSubscriptions: overdueSubscribers.length,
      payoutsPending: financials.filter((entry) => entry.providerPayoutStatus === "PENDING").length,
      refundsFlagged: financials.filter((entry) => entry.refundIssued || entry.refundFlag || entry.disputeFlag).length,
      trainingScheduled: trainingCalendar.length
    },
    policy,
    subscribers,
    providers,
    providerApprovalAlerts,
    overdueSubscribers,
    queue,
    inService,
    trainingCalendar,
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

  const discipline = user.providerProfile?.discipline || null;
  const trainingStatus = normalizeString(discipline?.training?.status).toUpperCase();
  const indefiniteSuspension = Boolean(discipline?.currentSuspension?.active && discipline?.currentSuspension?.indefinite);
  const restrictionActive = Boolean(discipline?.restriction?.active);
  if (nextState === "ACTIVE" && restrictionActive) {
    throw new Error("This provider is flagged and restricted from services.");
  }
  if (nextState === "ACTIVE" && indefiniteSuspension && trainingStatus !== "COMPLETED") {
    throw new Error("This provider requires completed roadside training before reactivation.");
  }

  user.accountState = nextState;
  if (nextState === "SUSPENDED") {
    user.subscriberActive = false;
  }
  if (Array.isArray(user.roles) && user.roles.includes("PROVIDER")) {
    user.providerStatus = nextState === "SUSPENDED" ? "SUSPENDED" : user.providerStatus === "SUSPENDED" ? "APPROVED" : user.providerStatus;
    user.available = nextState === "ACTIVE" ? Boolean(user.available) : false;
    if (nextState === "ACTIVE" && user.providerProfile?.discipline?.currentSuspension) {
      user.providerProfile.discipline.currentSuspension = {
        ...user.providerProfile.discipline.currentSuspension,
        active: false
      };
    }
    if (nextState === "ACTIVE" && indefiniteSuspension && user.providerProfile?.discipline) {
      const now = new Date().toISOString();
      user.providerProfile.discipline.probation = {
        active: true,
        reinstatedAt: now,
        endsAt: addCalendarYears(now, 1),
        clearedAt: null,
        sourceSuspensionId: user.providerProfile.discipline.currentSuspension?.suspensionId || null
      };
      user.providerProfile.discipline.restriction = {
        active: false,
        flaggedAt: null,
        reason: null,
        sourceProbationId: null,
        note: null
      };
      user.providerProfile.discipline.clearedAt = null;
    }
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
  if (provider.terms?.provider?.accepted !== true) {
    throw new Error("Provider terms have not been accepted.");
  }
  const documentStatus = provider.providerProfile?.documentStatus || summarizeProviderDocuments(provider.providerProfile?.documents);
  const approvalEligibility = buildProviderApprovalEligibility(provider, documentStatus);
  const forceApproval = payload.force === true || payload.forceApprove === true;
  if (!forceApproval && !approvalEligibility.canApprove) {
    throw new Error(`Provider is not approval-ready: ${approvalEligibility.missingRequirements.join(", ")}.`);
  }

  const approvedAt = new Date().toISOString();
  const billing = provider.providerProfile?.billing && typeof provider.providerProfile.billing === "object"
    ? provider.providerProfile.billing
    : {};
  const subscriptionStartedAt =
    provider.providerSubscriptionStartedAt ||
    billing.lastBillingAt ||
    approvedAt;
  provider.providerStatus = "APPROVED";
  provider.accountState = "ACTIVE";
  provider.available = true;
  provider.approvedAt = approvedAt;
  provider.approvalNote = normalizeString(payload.note) || null;
  provider.providerSubscriptionStartedAt = subscriptionStartedAt;
  provider.nextBillingDate = provider.nextBillingDate || addCalendarDays(subscriptionStartedAt, 30);
  provider.providerProfile = {
    ...(provider.providerProfile && typeof provider.providerProfile === "object" ? provider.providerProfile : {}),
    documentStatus,
    approvalEligibility: forceApproval
      ? {
          ...approvalEligibility,
          canApprove: true
        }
      : approvalEligibility,
    profileSubmissionStatus: "APPROVED",
    subscriptionStartsOnApproval: false,
    approvalReviewWindowEndsAt: provider.providerProfile?.approvalReviewWindowEndsAt || null,
    forcedApproval: forceApproval,
    forcedApprovalAt: forceApproval ? approvedAt : provider.providerProfile?.forcedApprovalAt || null,
    forcedApprovalBy: forceApproval
      ? normalizeString(payload.adminEmail || payload.approvedBy) || null
      : provider.providerProfile?.forcedApprovalBy || null
  };

  await helpers.writeUsers(users);
  return {
    message: `Provider ${provider.fullName || provider.email} approved.`,
    provider: summarizeUser(provider)
  };
}

async function updateProviderTraining(userId, payload, helpers) {
  const users = await helpers.readUsers();
  const provider = users.find((entry) => Number(entry.id) === Number(userId));
  if (!provider) {
    throw new Error(`Provider ${userId} was not found.`);
  }
  if (!Array.isArray(provider.roles) || !provider.roles.includes("PROVIDER")) {
    throw new Error("Selected user is not a provider.");
  }

  const providerProfile = provider.providerProfile && typeof provider.providerProfile === "object" ? provider.providerProfile : {};
  const discipline = providerProfile.discipline && typeof providerProfile.discipline === "object" ? providerProfile.discipline : {};
  const training = discipline.training && typeof discipline.training === "object" ? discipline.training : {};
  const status = normalizeString(payload.status).toUpperCase() || "SCHEDULED";
  const allowed = new Set(["REQUIRED", "SCHEDULED", "ENROLLED", "COMPLETED", "NOT_REQUIRED"]);
  if (!allowed.has(status)) {
    throw new Error("Training status must be REQUIRED, SCHEDULED, ENROLLED, COMPLETED, or NOT_REQUIRED.");
  }

  const now = new Date().toISOString();
  provider.providerProfile = {
    ...providerProfile,
    discipline: {
      ...discipline,
      training: {
        ...training,
        required: status !== "NOT_REQUIRED",
        status,
        scheduledFor: normalizeString(payload.scheduledFor) || training.scheduledFor || null,
        enrolledAt: status === "ENROLLED" && !training.enrolledAt ? now : training.enrolledAt || null,
        completedAt: status === "COMPLETED" ? now : training.completedAt || null,
        note: normalizeString(payload.note) || training.note || null,
        updatedAt: now,
        updatedBy: "ADMIN"
      }
    }
  };

  await helpers.writeUsers(users);
  return {
    message: `Training status updated for provider ${provider.fullName || provider.email}.`,
    provider: mapProvider(provider)
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
    dispatchRequeueCount: 0,
    lastRequeuedAt: null,
    expiredAt: null,
    requestAcceptanceExpiresAt: addMinutes(now, Number(current.requestAcceptanceWindowMinutes || 5)),
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

async function reassignRequest(requestId, payload, helpers, adminEmail = null) {
  const [requests, users] = await Promise.all([helpers.readRequestLog(), helpers.readUsers()]);
  const index = requests.findIndex((entry) => String(entry.id || entry.requestId) === String(requestId));
  if (index === -1) {
    throw new Error(`Request ${requestId} was not found.`);
  }

  const current = requests[index];
  const currentStatus = normalizeString(current.status).toUpperCase();
  if (["COMPLETED", "EXPIRED"].includes(currentStatus)) {
    throw new Error("Completed or expired requests cannot be reassigned.");
  }

  const replacementProviderId = Number(payload.providerUserId ?? payload.reassignedProviderId ?? payload.assignedProviderId);
  if (!Number.isInteger(replacementProviderId)) {
    throw new Error("A replacement provider id is required for reassignment.");
  }

  const replacementProvider = users.find((entry) => Number(entry.id) === replacementProviderId);
  if (!replacementProvider || !Array.isArray(replacementProvider.roles) || !replacementProvider.roles.includes("PROVIDER")) {
    throw new Error("Replacement provider was not found.");
  }
  if (normalizeAccountState(replacementProvider.accountState) !== "ACTIVE") {
    throw new Error("Replacement provider must be ACTIVE.");
  }
  if (!["APPROVED", "ACTIVE"].includes(normalizeString(replacementProvider.providerStatus).toUpperCase())) {
    throw new Error("Replacement provider must be approved before reassignment.");
  }
  if (replacementProvider.available !== true) {
    throw new Error("Replacement provider must be available for reassignment.");
  }

  const requestServiceType = normalizeString(current.serviceType).toUpperCase();
  const replacementServices = Array.isArray(replacementProvider.services)
    ? replacementProvider.services.map((value) => normalizeString(value).toUpperCase()).filter(Boolean)
    : [];
  if (requestServiceType && replacementServices.length && !replacementServices.includes(requestServiceType)) {
    throw new Error("Replacement provider is not enabled for this service type.");
  }

  const originalProviderId = Number.isInteger(Number(current.assignedProviderId)) ? Number(current.assignedProviderId) : null;
  if (originalProviderId !== null && originalProviderId === replacementProviderId) {
    throw new Error("Replacement provider must differ from the current provider.");
  }

  const originalProvider = originalProviderId === null
    ? null
    : users.find((entry) => Number(entry.id) === originalProviderId) || null;
  const customerFault = payload.customerFault === true;
  const secondChargeRequired = payload.secondChargeRequired === true;
  const newRequestRequired = payload.newRequestRequired === true;
  const transferPayoutInternally = payload.transferPayoutInternally === true;
  const reversePaymentInternally = payload.reversePaymentInternally === true || transferPayoutInternally;
  const payOrderRequired = payload.payOrderRequired === true || transferPayoutInternally;
  if (transferPayoutInternally && (current.providerPayoutStatus === "COMPLETED" || current.payoutCompletedAt)) {
    throw new Error("Internal payout transfer is not available after payout is already completed.");
  }

  const now = new Date().toISOString();
  const reassignment = {
    reassignedAt: now,
    reassignedBy: adminEmail,
    reason: normalizeString(payload.reason) || "Admin reassignment",
    note: normalizeString(payload.note) || null,
    customerFault,
    secondChargeRequired,
    newRequestRequired,
    transferPayoutInternally,
    reversePaymentInternally,
    payOrderRequired,
    payoutTransferredFromProviderId: transferPayoutInternally ? originalProviderId : null,
    payoutTransferredFromProviderName: transferPayoutInternally ? (originalProvider?.fullName || originalProvider?.email || null) : null,
    payoutTransferredToProviderId: transferPayoutInternally ? replacementProviderId : null,
    payoutTransferredToProviderName: transferPayoutInternally ? (replacementProvider.fullName || replacementProvider.email || null) : null,
    originalProviderId,
    originalProviderName: originalProvider?.fullName || originalProvider?.email || null,
    replacementProviderId,
    replacementProviderName: replacementProvider.fullName || replacementProvider.email || null
  };

  const nextNoteExchange = [
    ...(Array.isArray(current.noteExchange) ? current.noteExchange : []),
    {
      id: `admin-reassign-${Date.now()}`,
      type: "ADMIN_REASSIGNMENT",
      authorRole: "ADMIN",
      authorUserId: adminEmail || null,
      note: [
        `Provider reassigned from ${reassignment.originalProviderName || "unassigned"} to ${reassignment.replacementProviderName}.`,
        `Reason: ${reassignment.reason}.`,
        `Customer fault: ${customerFault ? "yes" : "no"}.`,
        `Second charge required: ${secondChargeRequired ? "yes" : "no"}.`,
        `New request required: ${newRequestRequired ? "yes" : "no"}.`,
        `Internal payout transfer: ${transferPayoutInternally ? "yes" : "no"}.`
      ].join(" "),
      createdAt: now
    }
  ];

  const nextProviderActions = [
    ...(Array.isArray(current.providerActions) ? current.providerActions : []),
    {
      providerUserId: replacementProviderId,
      action: "ADMIN_REASSIGN",
      note: reassignment.note || reassignment.reason,
      createdAt: now,
      actorRole: "ADMIN",
      actorUserId: adminEmail || null
    }
  ];

  requests[index] = {
    ...current,
    status: "SUBMITTED",
    completionStatus: "OPEN",
    assignedProviderId: replacementProviderId,
    acceptedAt: null,
    etaMinutes: null,
    etaUpdatedAt: null,
    softEtaMinutes: null,
    hardEtaMinutes: null,
    etaStage: "PENDING",
    locationDisclosureLevel: "MASKED",
    contactDisclosureLevel: "LOCKED",
    directCommunicationEnabled: false,
    softContactedAt: null,
    hardContactedAt: null,
    arrivedAt: null,
    arrivalConfirmedAt: null,
    completedAt: null,
    completionConfirmedAt: null,
    requestAcceptanceExpiresAt: addMinutes(now, Number(current.requestAcceptanceWindowMinutes || 5)),
    dispatchRequeueCount: Number.parseInt(current.dispatchRequeueCount || 0, 10) + 1,
    lastRequeuedAt: now,
    reassignedAt: now,
    reassignedBy: adminEmail,
    reassignmentReason: reassignment.reason,
    customerFault,
    secondChargeRequired,
    newRequestRequired,
    transferPayoutInternally,
    reversePaymentInternally,
    payOrderRequired,
    providerPayoutTransferredFromProviderId: reassignment.payoutTransferredFromProviderId,
    providerPayoutTransferredToProviderId: reassignment.payoutTransferredToProviderId,
    reassignmentHistory: [...(Array.isArray(current.reassignmentHistory) ? current.reassignmentHistory : []), reassignment],
    lastReassignment: reassignment,
    providerActions: nextProviderActions,
    noteExchange: nextNoteExchange,
    updatedAt: now
  };
  await helpers.writeRequestLog(requests);

  return {
    message: `Request ${requestId} reassigned to ${replacementProvider.fullName || replacementProvider.email}.`,
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
  if (normalizeString(current.paymentStatus).toUpperCase() !== "CAPTURED") {
    const error = new Error("Provider payout cannot be completed before customer payment is captured.");
    error.statusCode = 409;
    throw error;
  }
  if (Boolean(current.disputeFlag)) {
    const error = new Error("Resolve the provider payout dispute before completing payout.");
    error.statusCode = 409;
    throw error;
  }
  const users = await helpers.readUsers();
  const provider = users.find((entry) => Number(entry.id) === Number(current.assignedProviderId));
  const payoutTermsAccepted = provider?.terms?.providerPayout?.accepted === true ||
    provider?.providerProfile?.payoutTerms?.accepted === true;
  if (!payoutTermsAccepted) {
    const error = new Error("Provider payout terms must be accepted before payout can be released from safe mode.");
    error.statusCode = 409;
    throw error;
  }
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
        message: "Send a Bearer token from /admin-controller.mjs/login."
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

function normalizeAdminApiPath(pathname) {
  if (typeof pathname !== "string" || !pathname) {
    return null;
  }

  for (const prefix of ADMIN_API_PREFIX_ALIASES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return `${CANONICAL_ADMIN_API_PREFIX}${pathname.slice(prefix.length)}`;
    }
  }

  return null;
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
    primaryAddress: user.subscriberProfile?.primaryAddress || null,
    paymentInfo: user.subscriberProfile?.paymentInfo || null,
    terms: user.terms?.subscriber || null,
    serviceHistoryCount: requests.filter((request) => Number(request.userId) === Number(user.id)).length
  };
}

function mapProvider(user) {
  const documentStatus = user.providerProfile?.documentStatus || summarizeProviderDocuments(user.providerProfile?.documents);
  const approvalEligibility = user.providerProfile?.approvalEligibility || buildProviderApprovalEligibility(user, documentStatus);
  const approvalAlert = buildProviderApprovalAlert({
    providerStatus: user.providerStatus || "DRAFT",
    profileSubmissionStatus: user.providerProfile?.profileSubmissionStatus || null,
    fullName: user.fullName || "",
    email: user.email || "",
    pendingReceivedAt: user.providerProfile?.pendingReceivedAt || user.providerProfile?.profileSubmittedAt || null,
    approvalReviewWindowEndsAt: user.providerProfile?.approvalReviewWindowEndsAt || null
  });
  const rating = mapProviderRating(user);
  const discipline = mapProviderDiscipline(user);
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
    paypal: user.providerProfile?.paypal || null,
    assessment: user.providerProfile?.assessment || null,
    rating,
    discipline,
    profileSubmissionStatus: user.providerProfile?.profileSubmissionStatus || null,
    approvalEligibility,
    approvalAlert,
    documentStatus,
    documents: user.providerProfile?.documents || {},
    terms: user.terms?.provider || null
  };
}

function mapServiceHistory(request, userById) {
  const lastReassignment = request.lastReassignment || (Array.isArray(request.reassignmentHistory) ? request.reassignmentHistory[request.reassignmentHistory.length - 1] : null);
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
    customerRating: Number.isFinite(Number(request.customerFeedback?.rating)) ? Number(request.customerFeedback.rating) : null,
    refundFlag: Boolean(request.refundFlag || request.refundIssued),
    disputeFlag: Boolean(request.disputeFlag),
    reassignmentCount: Array.isArray(request.reassignmentHistory) ? request.reassignmentHistory.length : 0,
    lastReassignmentSummary: lastReassignment
      ? `Reassigned ${lastReassignment.reassignedAt || "recently"} from ${lastReassignment.originalProviderName || "unassigned"} to ${lastReassignment.replacementProviderName || "unknown provider"}${lastReassignment.customerFault ? " · customer at fault" : ""}${lastReassignment.secondChargeRequired ? " · second charge required" : ""}${lastReassignment.transferPayoutInternally ? " · payout transfer queued" : ""}`
      : ""
  };
}

function mapFinancialRecord(request, userById) {
  const policy = typeof userById.getRoadsidePolicy === "function" ? userById.getRoadsidePolicy() : null;
  const serviceChargeRate = policy?.financial?.platformServiceChargeRate || 0.02;
  
  const customerTier = request.customerTier || request.customerType || "GUEST";
  const amountCharged = Number(request.amountCharged || 0);
  const amountCollected = Number(request.amountCollected || 0);
  const serviceFee = Number(
    request.pricing?.serviceCharge ??
      request.pricing?.serviceFee ??
      amountCharged ??
      0
  );
  const additionalServices = Number(request.pricing?.additionalServices || 0);
  const totalServiceGross = serviceFee + additionalServices;
  
  const dispatchFee = Number(request.pricing?.dispatchFee || 0);
  const assignmentFee = Number(request.pricing?.assignmentFee || 0);
  const storedPercentageCharge = Number(
    request.platformPercentageChargeAmount ??
      request.pricing?.platformPercentageCharge ??
      0
  );
  
  let platformCharge = 0;
  let calculationFormula = "";
  let percentageCharge = 0;

  if (customerTier === "SUBSCRIBER") {
    // Subscriber: $40 - $5.50 assignment - 2% service rate
    percentageCharge = storedPercentageCharge || Number((totalServiceGross * serviceChargeRate).toFixed(2));
    platformCharge = assignmentFee + percentageCharge;
    calculationFormula = `${totalServiceGross} (gross) - ${assignmentFee} (assignment) - ${percentageCharge} (2% platform) = ${Number((totalServiceGross - platformCharge).toFixed(2))} (payout)`;
  } else {
    // Guest: $55 - $10 dispatch - $5.50 assignment = $39.50 payout
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
    platformServiceChargeRate: serviceChargeRate,
    platformFixedFeeAmount: dispatchFee + assignmentFee,
    platformServiceCharge: platformCharge,
    platformPercentageCharge: percentageCharge,
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
    reassignmentCount: Array.isArray(request.reassignmentHistory) ? request.reassignmentHistory.length : 0,
    lastReassignment: request.lastReassignment || (Array.isArray(request.reassignmentHistory) ? request.reassignmentHistory[request.reassignmentHistory.length - 1] : null),
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
  const platformServiceChargeRate = Number(paymentConfig.platformServiceChargeRate || 0);
  const guestPercentageCharge = 0;
  const subscriberPercentageCharge = Number(
    (Number(paymentConfig.subscriberServicePrice || 0) * platformServiceChargeRate).toFixed(2)
  );
  const guestPayout = Number(paymentConfig.guestServicePrice || 0) -
    Number(paymentConfig.guestDispatchFee || 0) -
    Number(paymentConfig.assignmentFee || 0);
  const subscriberPayout = Number(paymentConfig.subscriberServicePrice || 0) -
    Number(paymentConfig.assignmentFee || 0) -
    subscriberPercentageCharge;
  return {
    provider: paymentConfig.provider || "paypal",
    enabled: Boolean(paymentConfig.enabled),
    mode: paymentConfig.mode || "sandbox",
    priorityServicePrice: Number(paymentConfig.priorityServicePrice || 0),
    guestServicePrice: Number(paymentConfig.guestServicePrice || 0),
    subscriberServicePrice: Number(paymentConfig.subscriberServicePrice || 0),
    platformServiceChargeRate,
    assignmentFee: Number(paymentConfig.assignmentFee || 0),
    guestDispatchFee: Number(paymentConfig.guestDispatchFee || 0),
    subscriberDispatchFee: Number(paymentConfig.subscriberDispatchFee || 0),
    guestPlatformPercentageCharge: guestPercentageCharge,
    subscriberPlatformPercentageCharge: subscriberPercentageCharge,
    providerSuspensionFees: paymentConfig.providerSuspensionFees || null,
    estimatedGuestProviderPayout: Math.max(guestPayout, 0),
    estimatedSubscriberProviderPayout: Math.max(subscriberPayout, 0)
  };
}

function summarizeProviderDocuments(documents = {}) {
  const required = ["license", "registration", "insurance", "profilePhoto", "proofOfAddress"];
  const missing = required.filter((docType) => !Boolean(documents?.[docType]?.submitted || documents?.[docType] === true));
  const submittedCount = Object.values(documents || {}).filter((entry) => entry?.submitted || entry === true).length;
  return {
    required,
    submittedCount,
    missing,
    meetsMinimumRequirements: missing.length === 0
  };
}

function buildProviderApprovalEligibility(user, documentStatus = summarizeProviderDocuments(user?.providerProfile?.documents)) {
  const providerProfile = user?.providerProfile && typeof user.providerProfile === "object" ? user.providerProfile : {};
  const providerInfo = providerProfile.providerInfo && typeof providerProfile.providerInfo === "object" ? providerProfile.providerInfo : {};
  const vehicleInfo = providerProfile.vehicleInfo && typeof providerProfile.vehicleInfo === "object" ? providerProfile.vehicleInfo : {};
  const assessment = providerProfile.assessment && typeof providerProfile.assessment === "object" ? providerProfile.assessment : {};
  const hoursOfService = providerProfile.hoursOfService && typeof providerProfile.hoursOfService === "object" ? providerProfile.hoursOfService : {};
  const serviceAreaCoordinates = providerProfile.serviceAreaCoordinates;
  const currentLocationCoordinates = providerProfile.currentLocationCoordinates;
  const vehicleReady = Boolean(
    normalizeString(vehicleInfo.year) &&
    normalizeString(vehicleInfo.make) &&
    normalizeString(vehicleInfo.model) &&
    normalizeString(vehicleInfo.color)
  );
  const assessmentPassed = assessment?.passed === true;
  const assessmentComplete = assessment?.complete === true;
  const documentsReady = documentStatus?.meetsMinimumRequirements === true;
  const hoursReady = hoursOfService?.hasHours === true;
  const serviceAreaReady = Boolean(normalizeString(providerProfile.serviceArea));
  const currentLocationReady = Boolean(normalizeString(providerProfile.currentLocation));
  const locationResolved = Boolean(
    (currentLocationCoordinates && Number.isFinite(Number(currentLocationCoordinates.longitude)) && Number.isFinite(Number(currentLocationCoordinates.latitude))) ||
    (serviceAreaCoordinates && Number.isFinite(Number(serviceAreaCoordinates.longitude)) && Number.isFinite(Number(serviceAreaCoordinates.latitude)))
  );
  const payoutMethodReady = Boolean(normalizeString(providerInfo.payoutProvider) && normalizeString(providerInfo.payoutMethodMasked));
  const identityReady = Array.isArray(documentStatus?.missing)
    ? !documentStatus.missing.some((entry) => entry === "license" || entry === "profilePhoto" || entry === "proofOfAddress")
    : false;

  const missingRequirements = [];
  if (!assessmentComplete) {
    missingRequirements.push("assessment_incomplete");
  } else if (!assessmentPassed) {
    missingRequirements.push("assessment_failed");
  }
  if (!documentsReady) {
    missingRequirements.push("documents_incomplete");
  }
  if (!hoursReady) {
    missingRequirements.push("hours_of_service_missing");
  }
  if (!serviceAreaReady) {
    missingRequirements.push("service_area_missing");
  }
  if (!currentLocationReady) {
    missingRequirements.push("current_location_missing");
  }
  if (!locationResolved) {
    missingRequirements.push("location_unverified");
  }
  if (!vehicleReady) {
    missingRequirements.push("vehicle_incomplete");
  }
  if (!payoutMethodReady) {
    missingRequirements.push("payout_method_missing");
  }
  if (!identityReady) {
    missingRequirements.push("identity_documents_missing");
  }

  return {
    assessmentComplete,
    assessmentPassed,
    documentsReady,
    hoursReady,
    serviceAreaReady,
    currentLocationReady,
    locationResolved,
    vehicleReady,
    payoutMethodReady,
    identityReady,
    canApprove: missingRequirements.length === 0,
    pendingDisposition: assessmentPassed ? "PASSED_PENDING_PROVIDER" : "FAILED_PENDING_PROVIDER",
    missingRequirements
  };
}

function buildProviderApprovalAlert(provider, nowValue = new Date().toISOString()) {
  if (normalizeString(provider?.providerStatus).toUpperCase() !== "PENDING_APPROVAL") {
    return null;
  }
  if (normalizeString(provider?.profileSubmissionStatus).toUpperCase() !== "PASSED_PENDING_PROVIDER") {
    return null;
  }

  const submittedAt = normalizeString(provider?.pendingReceivedAt || provider?.profileSubmittedAt);
  const reviewDeadlineAt = normalizeString(provider?.approvalReviewWindowEndsAt);
  const submittedTime = submittedAt ? new Date(submittedAt).getTime() : Number.NaN;
  const deadlineTime = reviewDeadlineAt ? new Date(reviewDeadlineAt).getTime() : Number.NaN;
  const nowTime = new Date(nowValue).getTime();
  if (!Number.isFinite(submittedTime) || !Number.isFinite(deadlineTime) || !Number.isFinite(nowTime)) {
    return null;
  }

  const msUntilDeadline = deadlineTime - nowTime;
  const hoursUntilDeadline = Number((msUntilDeadline / (60 * 60 * 1000)).toFixed(1));
  const overdue = msUntilDeadline < 0;
  const dueSoon = !overdue && msUntilDeadline <= 24 * 60 * 60 * 1000;
  const redFlag = overdue || dueSoon;
  if (!redFlag) {
    return null;
  }

  return {
    providerId: provider?.id || null,
    fullName: provider?.fullName || provider?.email || "Provider",
    submittedAt,
    reviewDeadlineAt,
    hoursUntilDeadline,
    overdue,
    dueSoon,
    redFlag: true,
    severity: overdue ? "OVERDUE" : "DUE_SOON",
    message: overdue
      ? "Passed pending provider is beyond the third-business-day approval window."
      : "Passed pending provider is approaching the third-business-day approval window."
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

function mapProviderDiscipline(user) {
  const discipline = user?.providerProfile?.discipline || {};
  return {
    strikeCount: Number(discipline.strikeCount || 0),
    currentSuspension: discipline.currentSuspension || null,
    training: discipline.training || { status: "NOT_REQUIRED", scheduledFor: null, note: null },
    probation: discipline.probation || null,
    restriction: discipline.restriction || null,
    clearedAt: discipline.clearedAt || null,
    lowRatingEvents: Array.isArray(discipline.lowRatingEvents) ? discipline.lowRatingEvents.slice(0, 10) : [],
    suspensionHistory: Array.isArray(discipline.suspensionHistory) ? discipline.suspensionHistory.slice(0, 10) : []
  };
}

function runKeywordSearch(query, role, users, requests) {
  const normalizedRole = normalizeString(role).toUpperCase();
  if (!query) {
    return {
      query: "",
      role: normalizedRole || "ALL",
      users: [],
      subscribers: [],
      providers: [],
      requests: []
    };
  }
  const loweredQuery = query.toLowerCase();
  const match = (value) => normalizeString(value).toLowerCase().includes(loweredQuery);
  const roleAllowed = (user) => {
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    if (!normalizedRole || normalizedRole === "ALL") {
      return roles.includes("SUBSCRIBER") || roles.includes("PROVIDER");
    }
    return roles.includes(normalizedRole);
  };

  const matchedSubscribers = users
    .filter((user) => Array.isArray(user.roles) && user.roles.includes("SUBSCRIBER"))
    .filter((user) => roleAllowed(user))
    .filter((user) => [
      user.id,
      user.fullName,
      user.email,
      user.phoneNumber,
      user.accountState,
      user.subscriberProfile?.paymentInfo,
      user.subscriberProfile?.vehicle?.make,
      user.subscriberProfile?.vehicle?.model
    ].some(match))
    .map((user) => mapAdminDirectoryUser(user, requests));

  const matchedProviders = users
    .filter((user) => Array.isArray(user.roles) && user.roles.includes("PROVIDER"))
    .filter((user) => roleAllowed(user))
    .filter((user) => [
      user.id,
      user.fullName,
      user.email,
      user.phoneNumber,
      user.providerProfile?.serviceArea,
      user.providerProfile?.currentLocation,
      user.providerStatus,
      ...(Array.isArray(user.services) ? user.services : [])
    ].some(match))
    .map((user) => mapAdminDirectoryUser(user, requests));

  return {
    query,
    role: normalizedRole || "ALL",
    users: [...matchedSubscribers, ...matchedProviders].sort((left, right) =>
      String(left.fullName || left.email || "").localeCompare(String(right.fullName || right.email || ""))
    ),
    subscribers: matchedSubscribers,
    providers: matchedProviders,
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

function mapAdminDirectoryUser(user, requests) {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const directRequests = requests.filter((request) => Number(request.userId) === Number(user.id));
  const providerRequests = requests.filter((request) => Number(request.assignedProviderId) === Number(user.id));
  const relevantRequests = roles.includes("PROVIDER") ? providerRequests : directRequests;
  return {
    id: user.id,
    fullName: user.fullName || "",
    email: user.email || "",
    phoneNumber: user.phoneNumber || "",
    roles,
    accountState: normalizeAccountState(user.accountState),
    providerStatus: user.providerStatus || null,
    subscriberActive: Boolean(user.subscriberActive),
    serviceArea: user.providerProfile?.serviceArea || null,
    currentLocation: user.providerProfile?.currentLocation || null,
    requestCount: relevantRequests.length,
    activeRequestCount: relevantRequests.filter((request) =>
      ["SUBMITTED", "ASSIGNED", "EN_ROUTE", "ARRIVED"].includes(normalizeString(request.status).toUpperCase())
    ).length
  };
}

function buildAdminUserProfile(userId, users, requests) {
  const user = users.find((entry) => Number(entry.id) === Number(userId));
  if (!user) {
    const error = new Error(`User ${userId} was not found.`);
    error.statusCode = 404;
    throw error;
  }

  const roles = Array.isArray(user.roles) ? user.roles : [];
  const customerRequests = requests.filter((request) => Number(request.userId) === Number(user.id));
  const providerRequests = requests.filter((request) => Number(request.assignedProviderId) === Number(user.id));
  const liveRequestStatuses = new Set(["SUBMITTED", "ASSIGNED", "EN_ROUTE", "ARRIVED"]);
  const latestCustomerRequest = customerRequests
    .slice()
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))[0] || null;
  const latestProviderRequest = providerRequests
    .slice()
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))[0] || null;

  return {
    user: {
      id: user.id,
      fullName: user.fullName || "",
      email: user.email || "",
      phoneNumber: user.phoneNumber || "",
      roles,
      accountState: normalizeAccountState(user.accountState),
      signUpDate: user.signUpDate || user.createdAt || null,
      providerStatus: user.providerStatus || null,
      subscriberActive: Boolean(user.subscriberActive),
      available: Boolean(user.available)
    },
    supportSummary: {
      customerRequestCount: customerRequests.length,
      providerRequestCount: providerRequests.length,
      activeCustomerRequests: customerRequests.filter((request) => liveRequestStatuses.has(normalizeString(request.status).toUpperCase())).length,
      activeProviderRequests: providerRequests.filter((request) => liveRequestStatuses.has(normalizeString(request.status).toUpperCase())).length,
      latestCustomerRequestId: latestCustomerRequest?.id || latestCustomerRequest?.requestId || null,
      latestProviderRequestId: latestProviderRequest?.id || latestProviderRequest?.requestId || null
    },
    subscriber: roles.includes("SUBSCRIBER") ? mapSubscriber(user, requests) : null,
    provider: roles.includes("PROVIDER") ? mapProvider(user) : null,
    recentCustomerRequests: customerRequests
      .slice()
      .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))
      .slice(0, 10)
      .map((request) => ({
        requestId: request.id || request.requestId,
        submittedAt: request.submittedAt || request.createdAt || null,
        serviceType: request.serviceType || "",
        status: request.status || "UNKNOWN",
        paymentStatus: request.paymentStatus || "UNKNOWN",
        location: request.location || ""
      })),
    recentProviderRequests: providerRequests
      .slice()
      .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))
      .slice(0, 10)
      .map((request) => ({
        requestId: request.id || request.requestId,
        submittedAt: request.submittedAt || request.createdAt || null,
        serviceType: request.serviceType || "",
        status: request.status || "UNKNOWN",
        paymentStatus: request.paymentStatus || "UNKNOWN",
        fullName: request.fullName || "",
        location: request.location || "",
        lastReassignmentSummary: request.lastReassignment
          ? `Reassigned to ${resolveProviderName(request.lastReassignment.replacementProviderId, new Map(users.map((entry) => [Number(entry.id), entry])))}`
          : ""
      }))
  };
}

function normalizeAccountState(value) {
  return normalizeString(value || "ACTIVE").toUpperCase() || "ACTIVE";
}

function addCalendarYears(value, years) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setFullYear(date.getFullYear() + years);
  return date.toISOString();
}

function addCalendarDays(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString();
}

function addMinutes(value, minutes) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Date(date.getTime() + Number(minutes || 0) * 60 * 1000).toISOString();
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
