import crypto from "crypto";

const PASSWORD_HASH_ALGORITHM = "scrypt";
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_RESET_TTL_MS = Number.parseInt(process.env.AW_PASSWORD_RESET_TTL_MS || `${60 * 60 * 1000}`, 10);
const DEFAULT_SUBSCRIBER_MONTHLY = 7.99;
const DEFAULT_PROVIDER_MONTHLY = 6;
const CANONICAL_SUBSCRIPTION_API_PREFIX = "/server.mjs";
const SUBSCRIPTION_API_PREFIX_ALIASES = Object.freeze([
  CANONICAL_SUBSCRIPTION_API_PREFIX,
  "/subscription-controller.mjs",
  "/api"
]);

function testingTermsBypassEnabled() {
  const value = String(process.env.AW_TESTING_SKIP_TERMS || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function createSubscriptionController() {
  return {
    async handle(req, res, pathname, helpers) {
      pathname = normalizeSubscriptionApiPath(pathname);
      if (!pathname) {
        return false;
      }

      if (pathname === "/server.mjs/subscriptions/config") {
        const policy = getRoadsidePolicy(helpers);
        helpers.sendJson(res, 200, {
          subscriberMonthly: policy.subscriber.monthlyFee,
          providerMonthly: policy.provider.monthlyFee,
          roles: ["SUBSCRIBER", "PROVIDER"],
          subscriberTermsVersion: policy.subscriber.termsVersion,
          providerTermsVersion: policy.provider.termsVersion,
          noRefundPolicy: policy.financial.noRefundsAfterPayment
        });
        return true;
      }

      if (pathname === "/server.mjs/auth/signup") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        try {
          const payload = await helpers.readJsonBody(req);
          const signup = await createSignup(payload, helpers);
          await helpers.markInboundPayloadProcessed?.(req, {
            route: "/server.mjs/auth/signup",
            userId: signup.userId,
            outcome: "created"
          });
          helpers.sendJson(res, 201, withSession(signup, helpers));
        } catch (error) {
          await helpers.markInboundPayloadRejected?.(req, error, {
            route: "/server.mjs/auth/signup"
          });
          helpers.sendJson(res, 400, {
            error: "signup-failed",
            message: error.message
          });
        }
        return true;
      }

      if (pathname === "/server.mjs/auth/login") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        try {
          const payload = await helpers.readJsonBody(req);
          const login = await loginUser(payload, helpers);
          helpers.sendJson(res, 200, withSession(login, helpers));
        } catch (error) {
          helpers.sendJson(res, 401, {
            error: "login-failed",
            message: error.message
          });
        }
        return true;
      }

      if (pathname === "/server.mjs/auth/password/forgot") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        try {
          const payload = await helpers.readJsonBody(req);
          const reset = await requestPasswordReset(payload, helpers, req);
          helpers.sendJson(res, 200, reset);
        } catch (error) {
          helpers.sendJson(res, 400, {
            error: "password-reset-request-failed",
            message: error.message
          });
        }
        return true;
      }

      if (pathname === "/server.mjs/auth/password/reset") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        try {
          const payload = await helpers.readJsonBody(req);
          const updatedUser = await resetAccountPassword(payload, helpers);
          helpers.sendJson(res, 200, {
            userId: updatedUser.id,
            message: "Password reset complete."
          });
        } catch (error) {
          helpers.sendJson(res, 400, {
            error: "password-reset-failed",
            message: error.message
          });
        }
        return true;
      }

      if (pathname === "/server.mjs/auth/subscriber/setup") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        try {
          const payload = await helpers.readJsonBody(req);
          const session = requireAuthenticatedUser(req, helpers);
          const updatedUser = await setupSubscriber(payload, helpers, session);
          await helpers.markInboundPayloadProcessed?.(req, {
            route: "/server.mjs/auth/subscriber/setup",
            userId: updatedUser.id,
            outcome: "subscriber-setup"
          });
          helpers.sendJson(res, 200, {
            userId: updatedUser.id,
            subscriberActive: updatedUser.subscriberActive,
            subscriptionStatus: updatedUser.subscriptionStatus || null,
            membershipStatus: updatedUser.subscriberProfile?.membershipStatus || null,
            paymentRequired: updatedUser.subscriberActive !== true,
            membershipPrice: Number(updatedUser.subscriberProfile?.membershipPrice || DEFAULT_SUBSCRIBER_MONTHLY)
          });
        } catch (error) {
          await helpers.markInboundPayloadRejected?.(req, error, {
            route: "/server.mjs/auth/subscriber/setup"
          });
          helpers.sendJson(res, 400, {
            error: "subscriber-setup-failed",
            message: error.message
          });
        }
        return true;
      }

      if (pathname === "/server.mjs/auth/subscriber/profile") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        try {
          const payload = await helpers.readJsonBody(req);
          const session = requireAuthenticatedUser(req, helpers);
          const updatedUser = await updateSubscriberProfile(payload, helpers, session);
          helpers.sendJson(res, 200, {
            userId: updatedUser.id,
            subscriberActive: updatedUser.subscriberActive,
            subscriberProfile: updatedUser.subscriberProfile || null,
            nextBillingDate: updatedUser.nextBillingDate || null
          });
        } catch (error) {
          helpers.sendJson(res, 400, {
            error: "subscriber-profile-update-failed",
            message: error.message
          });
        }
        return true;
      }

      if (pathname === "/server.mjs/auth/password/change") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        try {
          const payload = await helpers.readJsonBody(req);
          const session = requireAuthenticatedUser(req, helpers);
          const updatedUser = await changeAccountPassword(payload, helpers, session);
          helpers.sendJson(res, 200, {
            userId: updatedUser.id,
            message: "Password updated."
          });
        } catch (error) {
          helpers.sendJson(res, 400, {
            error: "password-change-failed",
            message: error.message
          });
        }
        return true;
      }

      if (pathname === "/server.mjs/auth/subscriber/cancel") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        try {
          const payload = await helpers.readJsonBody(req);
          const session = requireAuthenticatedUser(req, helpers);
          const updatedUser = await cancelSubscriberMembership(payload, helpers, session);
          helpers.sendJson(res, 200, {
            userId: updatedUser.id,
            subscriberActive: updatedUser.subscriberActive,
            nextBillingDate: updatedUser.nextBillingDate || null,
            subscriberProfile: updatedUser.subscriberProfile || null
          });
        } catch (error) {
          helpers.sendJson(res, 400, {
            error: "subscriber-cancel-failed",
            message: error.message
          });
        }
        return true;
      }

      if (pathname === "/server.mjs/auth/provider/apply") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        try {
          const payload = await helpers.readJsonBody(req);
          const session = requireAuthenticatedUser(req, helpers);
          const updatedUser = await applyProvider(payload, helpers, session);
          helpers.sendJson(res, 200, {
            userId: updatedUser.id,
            providerStatus: updatedUser.providerStatus,
            providerMonthly: DEFAULT_PROVIDER_MONTHLY
          });
        } catch (error) {
          helpers.sendJson(res, 400, {
            error: "provider-apply-failed",
            message: error.message
          });
        }
        return true;
      }

      if (pathname === "/server.mjs/auth/provider/documents") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        try {
          const payload = await helpers.readJsonBody(req);
          const session = requireAuthenticatedUser(req, helpers);
          const updatedUser = await uploadProviderDocuments(payload, helpers, session);
          helpers.sendJson(res, 200, {
            userId: updatedUser.id,
            providerStatus: updatedUser.providerStatus,
            documents: updatedUser.providerProfile?.documents || {}
          });
        } catch (error) {
          helpers.sendJson(res, 400, {
            error: "document-upload-failed",
            message: error.message
          });
        }
        return true;
      }

      return false;
    }
  };
}

function normalizeSubscriptionApiPath(pathname) {
  if (typeof pathname !== "string" || !pathname) {
    return "";
  }
  for (const prefix of SUBSCRIPTION_API_PREFIX_ALIASES) {
    if (pathname === `${prefix}/subscriptions/config`) {
      return `${CANONICAL_SUBSCRIPTION_API_PREFIX}/subscriptions/config`;
    }
    if (pathname.startsWith(`${prefix}/auth/`)) {
      return `${CANONICAL_SUBSCRIPTION_API_PREFIX}${pathname.slice(prefix.length)}`;
    }
  }
  return "";
}

export async function createSignup(payload, helpers) {
  const policy = getRoadsidePolicy(helpers);
  const fullName = requireString(payload.fullName, "fullName");
  const username = normalizeUsername(requireString(payload.username, "username"));
  const email = requireString(payload.email, "email").toLowerCase();
  const password = requireString(payload.password, "password");
  const confirmPassword = optionalString(payload.confirmPassword);

  if (confirmPassword && password !== confirmPassword) {
    throw new Error("Passwords do not match.");
  }

  const phoneNumber = optionalString(payload.phoneNumber);
  const role = requireString(payload.role, "role").toUpperCase();
  const termsBypass = testingTermsBypassEnabled();
  const termsAccepted = payload.termsAccepted === true || termsBypass;
  const createdAt = new Date().toISOString();
  const termsAcceptedAt = payload.subscriberTermsAcceptedAt || payload.providerTermsAcceptedAt || createdAt;

  if (!["SUBSCRIBER", "PROVIDER"].includes(role)) {
    throw new Error('Role must be "SUBSCRIBER" or "PROVIDER".');
  }

  if (!termsAccepted) {
    throw new Error("Terms of agreement are required.");
  }

  if (role === "SUBSCRIBER" && payload.subscriberTermsAccepted !== true && !termsBypass) {
    throw new Error("Subscriber terms must be accepted.");
  }

  if (role === "PROVIDER" && payload.providerTermsAccepted !== true && !termsBypass) {
    throw new Error("Provider terms must be accepted.");
  }

  const createUser = async (users) => {
    if (users.some((user) => user.username === username)) {
      throw new Error("An account with that username already exists.");
    }
    if (users.some((user) => user.email === email)) {
      throw new Error("An account with that email already exists.");
    }

    const newUser = {
      id: helpers.allocateUserId(users),
      fullName,
      username,
      email,
      phoneNumber,
      passwordHash: await hashPassword(password),
      roles: [role],
      subscriberActive: false,
      subscriberProfile: null,
      providerStatus: role === "PROVIDER" ? "DRAFT" : null,
      providerProfile: null,
      termsAccepted: true,
      terms: buildTermsRecord(payload, role, policy, termsAcceptedAt),
      trustedZone: null,
      services: [],
      available: false,
      activeShiftId: null,
      accountState: "ACTIVE",
      nextBillingDate: null,
      subscriptionStatus: role === "SUBSCRIBER" ? "PENDING_PROFILE" : null,
      createdAt,
      signUpDate: createdAt
    };

    users.push(newUser);
    return buildLoginPayload(newUser);
  };

  if (typeof helpers.mutateUsers === "function") {
    return helpers.mutateUsers(createUser);
  }

  const users = await helpers.readUsers();
  const result = await createUser(users);
  await helpers.writeUsers(users);
  return result;
}

export async function loginUser(payload, helpers) {
  const rawIdentifier = requireString(payload.identifier || payload.email, "identifier");
  const identifier = rawIdentifier.toLowerCase();
  const password = requireString(payload.password, "password");
  const users = await helpers.readUsers();
  const user = users.find((entry) => {
    const email = typeof entry.email === "string" ? entry.email.toLowerCase() : "";
    const username = resolveUsername(entry);
    return email === identifier || username === identifier;
  });

  if (!user || !(await verifyStoredPassword(user, password))) {
    throw new Error("Invalid credentials.");
  }

  if (!user.passwordHash) {
    if (typeof helpers.mutateUsers === "function") {
      await helpers.mutateUsers(async (mutableUsers) => {
        const mutableUser = mutableUsers.find((entry) => Number(entry.id) === Number(user.id));
        if (!mutableUser) {
          throw new Error("User not found.");
        }
        mutableUser.passwordHash = await hashPassword(password);
        delete mutableUser.password;
      });
    } else {
      user.passwordHash = await hashPassword(password);
      delete user.password;
      await helpers.writeUsers(users);
    }
  }

  return buildLoginPayload(user);
}

export async function setupSubscriber(payload, helpers, session = null) {
  const policy = getRoadsidePolicy(helpers);
  const termsBypass = testingTermsBypassEnabled();
  const vehicle = payload.vehicle || {};
  const primaryAddress = normalizeSubscriberAddress(payload.address || payload.primaryAddress || {});
  const make = requireString(vehicle.make, "vehicle.make");
  const model = requireString(vehicle.model, "vehicle.model");
  const year = requireString(vehicle.year, "vehicle.year");
  const color = requireString(vehicle.color, "vehicle.color");
  const paymentMethodMasked = optionalString(payload.paymentMethodMasked) || optionalString(payload.paymentMethod);
  const paypalSubscriptionId = optionalString(payload.paypalSubscriptionId || payload.subscriptionId);
  const paypalPlanId = optionalString(payload.paypalPlanId || payload.planId);
  const paypalStatus = optionalString(payload.paypalStatus || payload.subscriptionStatus) || (paypalSubscriptionId ? "APPROVED" : null);
  const paymentInfo = {
    paymentMethodMasked,
    billingZip: optionalString(payload.billingZip),
    paymentProvider: optionalString(payload.paymentProvider) || (paypalSubscriptionId ? "paypal" : null),
    paypalSubscriptionId: paypalSubscriptionId || null,
    paypalPlanId: paypalPlanId || null,
    paypalStatus: paypalStatus || null
  };
  const users = await helpers.readUsers();
  const user = users.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
  if (!user) {
    throw new Error("User not found.");
  }
  if (!user.roles.includes("SUBSCRIBER")) {
    throw new Error("Not a subscriber.");
  }
  if (!termsBypass && payload.subscriberTermsAccepted !== true && user.terms?.subscriber?.accepted !== true) {
    throw new Error("Subscriber terms must be accepted before setup.");
  }
  if (!termsBypass && payload.dispatchOnlyLiabilityAccepted !== true && user.terms?.subscriber?.dispatchOnlyLiabilityAccepted !== true) {
    throw new Error("Dispatch-only liability terms must be accepted before setup.");
  }
  if (!termsBypass && payload.noRefundPolicyAccepted !== true && user.terms?.subscriber?.noRefundPolicyAccepted !== true) {
    throw new Error("No-refund policy must be accepted before setup.");
  }

  const updateUser = async (mutableUser) => {
    const setupAt = new Date().toISOString();
    const existingProfile = mutableUser.subscriberProfile && typeof mutableUser.subscriberProfile === "object"
      ? mutableUser.subscriberProfile
      : {};
    const existingPaymentInfo = existingProfile.paymentInfo && typeof existingProfile.paymentInfo === "object"
      ? existingProfile.paymentInfo
      : {};
    const hasPaypalSubscriptionApproval = Boolean(paypalSubscriptionId);
    const membershipStatus = mutableUser.subscriberActive || hasPaypalSubscriptionApproval ? "ACTIVE" : "PENDING_PAYMENT";

    mutableUser.accountState = mutableUser.accountState || "ACTIVE";
    mutableUser.subscriberActive = mutableUser.subscriberActive || hasPaypalSubscriptionApproval;
    mutableUser.subscriptionStatus = mutableUser.subscriberActive ? "ACTIVE" : "PENDING_PAYMENT";
    if (hasPaypalSubscriptionApproval && !mutableUser.nextBillingDate) {
      mutableUser.nextBillingDate = addDays(setupAt, 30);
    }
    mutableUser.subscriberProfile = {
      ...existingProfile,
      membershipPrice: policy.subscriber.monthlyFee,
      vehicle: { make, model, year, color },
      savedVehicles: [{ make, model, year, color }],
      primaryAddress,
      savedAddresses: primaryAddress.line1 ? [primaryAddress] : [],
      paymentMethodMasked: paymentMethodMasked || existingProfile.paymentMethodMasked || null,
      paymentInfo: {
        ...existingPaymentInfo,
        ...paymentInfo,
        paymentMethodMasked: paymentMethodMasked || existingPaymentInfo.paymentMethodMasked || null,
        billingZip: paymentInfo.billingZip || existingPaymentInfo.billingZip || primaryAddress.postalCode || null,
        paymentProvider: paymentInfo.paymentProvider || existingPaymentInfo.paymentProvider || null,
        paypalSubscriptionId: paypalSubscriptionId || existingPaymentInfo.paypalSubscriptionId || null,
        paypalPlanId: paypalPlanId || existingPaymentInfo.paypalPlanId || null,
        paypalStatus: paypalStatus || existingPaymentInfo.paypalStatus || null
      },
      paypalSubscriptionId: paypalSubscriptionId || existingProfile.paypalSubscriptionId || null,
      paypalPlanId: paypalPlanId || existingProfile.paypalPlanId || null,
      paypalStatus: paypalStatus || existingProfile.paypalStatus || null,
      membershipStatus,
      setupCompletedAt: setupAt,
      updatedAt: setupAt,
      termsAcceptedAt: setupAt,
      termsVersion: policy.subscriber.termsVersion,
      confirmation: mutableUser.subscriberActive
        ? existingProfile.confirmation || null
        : {
            status: "PENDING_PAYMENT",
            confirmedAt: null,
            recipientEmail: mutableUser.email || null,
            subject: "AW Roadside subscription pending payment",
            body: "Subscriber profile is on file. Payment capture is required before membership becomes active."
          }
    };
    mutableUser.terms = {
      ...(mutableUser.terms || {}),
      subscriber: {
        accepted: true,
        acceptedAt: setupAt,
        termsVersion: policy.subscriber.termsVersion,
        dispatchOnlyLiabilityAccepted: true,
        noRefundPolicyAccepted: true,
        platformLiability: policy.subscriber.platformLiability,
        providerLiability: policy.provider.liabilityStatement
      }
    };
    return mutableUser;
  };

  if (typeof helpers.mutateUsers === "function") {
    return helpers.mutateUsers(async (mutableUsers) => {
      const mutableUser = mutableUsers.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
      if (!mutableUser) {
        throw new Error("User not found.");
      }
      if (!mutableUser.roles.includes("SUBSCRIBER")) {
        throw new Error("Not a subscriber.");
      }
      return updateUser(mutableUser);
    });
  }

  const result = await updateUser(user);
  await helpers.writeUsers(users);
  return result;
}

export async function activateSubscriberMembership(payload, helpers, session = null) {
  const policy = getRoadsidePolicy(helpers);
  const users = await helpers.readUsers();
  const user = users.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
  if (!user) {
    throw new Error("User not found.");
  }
  if (!Array.isArray(user.roles) || !user.roles.includes("SUBSCRIBER")) {
    throw new Error("Not a subscriber.");
  }

  const activateUser = async (mutableUser) => {
    const activatedAt = optionalIsoString(payload.paidAt || payload.capturedAt) || new Date().toISOString();
    const existingProfile = mutableUser.subscriberProfile && typeof mutableUser.subscriberProfile === "object"
      ? mutableUser.subscriberProfile
      : {};
    const existingPaymentInfo = existingProfile.paymentInfo && typeof existingProfile.paymentInfo === "object"
      ? existingProfile.paymentInfo
      : {};
    const alreadyActive = Boolean(mutableUser.subscriberActive) && optionalString(existingProfile.membershipStatus) === "ACTIVE";
    const paymentMethodMasked =
      optionalString(payload.paymentMethodMasked) ||
      optionalString(payload.paymentMethod) ||
      existingProfile.paymentMethodMasked ||
      existingPaymentInfo.paymentMethodMasked ||
      null;
    const paymentProvider = optionalString(payload.paymentProvider) || existingPaymentInfo.paymentProvider || "paypal";
    const vehicle = existingProfile.vehicle && typeof existingProfile.vehicle === "object"
      ? existingProfile.vehicle
      : {};
    const confirmationRecord = buildSubscriberConfirmationRecord({
      user: mutableUser,
      vehicle,
      membershipPrice: Number(existingProfile.membershipPrice || policy.subscriber.monthlyFee),
      confirmedAt: activatedAt
    });
    const delivery = alreadyActive
      ? existingProfile.confirmation || {
          deliveryStatus: "already-active",
          deliveredAt: existingProfile.activatedAt || activatedAt,
          transport: "profile-record-only",
          message: "Subscriber membership was already active."
        }
      : typeof helpers.sendSubscriberConfirmationEmail === "function"
        ? await helpers.sendSubscriberConfirmationEmail(confirmationRecord)
        : {
            deliveryStatus: "stored-no-transport",
            deliveredAt: null,
            transport: "profile-record-only",
            message: "Subscriber confirmation stored in profile. No outbound email transport is configured."
          };

    mutableUser.subscriberActive = true;
    mutableUser.accountState = "ACTIVE";
    mutableUser.subscriptionStatus = "ACTIVE";
    mutableUser.nextBillingDate = addDays(activatedAt, 30);
    mutableUser.subscriberProfile = {
      ...existingProfile,
      membershipPrice: Number(existingProfile.membershipPrice || policy.subscriber.monthlyFee),
      paymentMethodMasked: paymentMethodMasked || existingProfile.paymentMethodMasked || null,
      paymentInfo: {
        ...existingPaymentInfo,
        paymentMethodMasked: paymentMethodMasked || existingPaymentInfo.paymentMethodMasked || null,
        billingZip: optionalString(payload.billingZip) || existingPaymentInfo.billingZip || existingProfile.primaryAddress?.postalCode || null,
        paymentProvider,
        lastMembershipPaymentStatus: optionalString(payload.paymentStatus) || "CAPTURED",
        lastMembershipPaymentOrderId: optionalString(payload.paypalOrderId) || existingPaymentInfo.lastMembershipPaymentOrderId || null,
        lastMembershipPaymentCaptureId: optionalString(payload.paypalCaptureId) || existingPaymentInfo.lastMembershipPaymentCaptureId || null,
        lastMembershipPaymentEventType: optionalString(payload.paymentEventType) || existingPaymentInfo.lastMembershipPaymentEventType || null,
        lastMembershipPaymentAt: activatedAt,
        lastMembershipPaymentAmount: Number.isFinite(Number(payload.paymentAmount))
          ? Number(payload.paymentAmount)
          : existingPaymentInfo.lastMembershipPaymentAmount || null
      },
      membershipStatus: "ACTIVE",
      activatedAt,
      updatedAt: activatedAt,
      confirmation: alreadyActive
        ? existingProfile.confirmation || null
        : {
            ...confirmationRecord,
            ...delivery
          }
    };
    return mutableUser;
  };

  if (typeof helpers.mutateUsers === "function") {
    return helpers.mutateUsers(async (mutableUsers) => {
      const mutableUser = mutableUsers.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
      if (!mutableUser) {
        throw new Error("User not found.");
      }
      if (!mutableUser.roles.includes("SUBSCRIBER")) {
        throw new Error("Not a subscriber.");
      }
      return activateUser(mutableUser);
    });
  }

  const result = await activateUser(user);
  await helpers.writeUsers(users);
  return result;
}

export async function applyProvider(payload, helpers, session = null) {
  const policy = getRoadsidePolicy(helpers);
  const termsBypass = testingTermsBypassEnabled();
  const users = await helpers.readUsers();
  const user = users.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
  if (!user) {
    throw new Error("User not found.");
  }
  if (!user.roles.includes("PROVIDER")) {
    throw new Error("Not a provider.");
  }

  const existingProviderProfile = user.providerProfile && typeof user.providerProfile === "object"
    ? user.providerProfile
    : {};
  const providerPaypalSubscription = normalizeProviderPaypalSubscription(payload, payload.providerInfo || {});
  if (!existingProviderProfile.profileSubmittedAt && !hasCapturedProviderMembership(user) && !providerPaypalSubscription.subscriptionId) {
    throw new Error("Provider membership payment must be captured before provider profile submission.");
  }

  const vehicleInfo = payload.vehicleInfo || {};
  const documents = payload.documents || {};
  const existingDocuments = existingProviderProfile.documents || {};
  const storedDocuments = typeof helpers.saveProviderDocuments === "function"
    ? await helpers.saveProviderDocuments(user.id, existingDocuments, documents)
    : normalizeProviderDocuments(documents, existingDocuments);
  const documentStatus = summarizeProviderDocuments(storedDocuments);
  if (!termsBypass && payload.providerTermsAccepted !== true && user.terms?.provider?.accepted !== true) {
    throw new Error("Provider terms must be accepted before profile submission.");
  }
  if (!termsBypass && payload.providerLiabilityAccepted !== true && user.terms?.provider?.liabilityAccepted !== true) {
    throw new Error("Provider liability acknowledgement is required.");
  }

  const providerInfo = normalizeProviderInfo(payload.providerInfo || payload);
  const hoursOfService = normalizeHoursOfService(payload.hoursOfService || payload.availability || {});
  const serviceArea = normalizeString(payload.serviceArea || payload.coverageArea || "");
  const equipment = normalizeStringArray(payload.equipment);
  const assessment = evaluateProviderAssessment(payload.assessmentAnswers || {}, policy);

  const currentLocation = normalizeString(payload.currentLocation || payload.location);
  const locationMetadata = typeof helpers.resolveProviderLocationMetadata === "function"
    ? await helpers.resolveProviderLocationMetadata({
        currentLocation,
        serviceArea
      })
    : {};
  const normalizedVehicleInfo = {
    make: requireString(vehicleInfo.make, "vehicleInfo.make"),
    model: requireString(vehicleInfo.model, "vehicleInfo.model"),
    year: requireString(vehicleInfo.year, "vehicleInfo.year"),
    color: requireString(vehicleInfo.color, "vehicleInfo.color")
  };
  const approvalEligibility = buildProviderApprovalEligibility({
    providerInfo,
    vehicleInfo: normalizedVehicleInfo,
    documentStatus,
    assessment,
    hoursOfService,
    serviceArea,
    currentLocation,
    ...locationMetadata
  });

  const providerPatch = (mutableUser) => {
    const submittedAt = new Date().toISOString();
    const mutableProviderProfile = mutableUser.providerProfile && typeof mutableUser.providerProfile === "object"
      ? mutableUser.providerProfile
      : {};
    const existingPayoutTerms = mutableProviderProfile.payoutTerms && typeof mutableProviderProfile.payoutTerms === "object"
      ? mutableProviderProfile.payoutTerms
      : {};
    const existingProviderPayoutTerms = mutableUser.terms?.providerPayout && typeof mutableUser.terms.providerPayout === "object"
      ? mutableUser.terms.providerPayout
      : {};
    const existingBilling = mutableProviderProfile.billing && typeof mutableProviderProfile.billing === "object"
      ? mutableProviderProfile.billing
      : {};
    const existingPaypal = mutableProviderProfile.paypal && typeof mutableProviderProfile.paypal === "object"
      ? mutableProviderProfile.paypal
      : {};
    mutableUser.providerStatus = "PENDING_APPROVAL";
    mutableUser.accountState = mutableUser.accountState || "ACTIVE";
    mutableUser.available = false;
    if (providerPaypalSubscription.subscriptionId && !mutableUser.nextBillingDate) {
      mutableUser.nextBillingDate = addDays(submittedAt, 30);
    }
    mutableUser.providerProfile = {
      ...mutableProviderProfile,
      providerInfo,
      paypal: {
        ...existingPaypal,
        subscriptionId: providerPaypalSubscription.subscriptionId || existingPaypal.subscriptionId || null,
        planId: providerPaypalSubscription.planId || existingPaypal.planId || null,
        status: providerPaypalSubscription.status || existingPaypal.status || null,
        paymentProvider: providerPaypalSubscription.subscriptionId ? "paypal" : existingPaypal.paymentProvider || null,
        lastSubscriptionApprovalAt: providerPaypalSubscription.subscriptionId
          ? submittedAt
          : existingPaypal.lastSubscriptionApprovalAt || null
      },
      billing: {
        ...existingBilling,
        paymentProvider: providerPaypalSubscription.subscriptionId ? "paypal" : existingBilling.paymentProvider || null,
        membershipStatus: providerPaypalSubscription.subscriptionId
          ? "ACTIVE"
          : existingBilling.membershipStatus || null,
        lastBillingStatus: providerPaypalSubscription.subscriptionId
          ? providerPaypalSubscription.status || "APPROVED"
          : existingBilling.lastBillingStatus || null,
        paypalSubscriptionId: providerPaypalSubscription.subscriptionId || existingBilling.paypalSubscriptionId || null,
        paypalPlanId: providerPaypalSubscription.planId || existingBilling.paypalPlanId || null,
        paypalStatus: providerPaypalSubscription.status || existingBilling.paypalStatus || null,
        lastBillingAt: providerPaypalSubscription.subscriptionId ? submittedAt : existingBilling.lastBillingAt || null
      },
      vehicleInfo: normalizedVehicleInfo,
      documents: storedDocuments,
      documentStatus,
      experience: optionalString(payload.experience),
      assessment,
      hoursOfService,
      serviceArea,
      currentLocation,
      ...locationMetadata,
      equipment,
      profileSubmittedAt: submittedAt,
      pendingReceivedAt: submittedAt,
      profileSubmissionStatus: approvalEligibility.assessmentPassed ? "PASSED_PENDING_PROVIDER" : "FAILED_PENDING_PROVIDER",
      approvalEligibility,
      subscriptionStartsOnApproval: false,
      approvalReviewWindowEndsAt: addBusinessDays(submittedAt, 3),
      rates: normalizeProviderRates(payload.rates),
      noteExchangeEnabled: true,
      payoutTerms: {
        ...existingPayoutTerms,
        accepted: existingPayoutTerms.accepted === true,
        acceptedAt: existingPayoutTerms.acceptedAt || null,
        termsVersion: policy.financial?.walletDisplayTerms?.payoutTermsVersion || "provider-payout-2026-05-30",
        disputeWindowAccepted: existingPayoutTerms.disputeWindowAccepted === true,
        noPostReceiptDisputeAccepted: existingPayoutTerms.noPostReceiptDisputeAccepted === true,
        safeModeActive: existingPayoutTerms.safeModeActive !== false
      }
    };
    mutableUser.services = Array.isArray(payload.services) && payload.services.length > 0 ? payload.services : ["LOCKOUT"];
    mutableUser.providerMonthly = policy.provider.monthlyFee;
    mutableUser.terms = {
      ...(mutableUser.terms || {}),
      provider: {
        accepted: true,
        acceptedAt: new Date().toISOString(),
        termsVersion: policy.provider.termsVersion,
        liabilityAccepted: true,
        liabilityStatement: policy.provider.liabilityStatement,
        holdHarmlessAccepted: true
      },
      providerPayout: {
        ...existingProviderPayoutTerms,
        accepted: existingProviderPayoutTerms.accepted === true,
        acceptedAt: existingProviderPayoutTerms.acceptedAt || null,
        termsVersion: policy.financial?.walletDisplayTerms?.payoutTermsVersion || "provider-payout-2026-05-30",
        disputeWindowAccepted: existingProviderPayoutTerms.disputeWindowAccepted === true,
        noPostReceiptDisputeAccepted: existingProviderPayoutTerms.noPostReceiptDisputeAccepted === true,
        safeModeActive: existingProviderPayoutTerms.safeModeActive !== false
      }
    };
    return mutableUser;
  };

  if (typeof helpers.mutateUsers === "function") {
    return helpers.mutateUsers(async (mutableUsers) => {
      const mutableUser = mutableUsers.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
      if (!mutableUser) {
        throw new Error("User not found.");
      }
      if (!mutableUser.roles.includes("PROVIDER")) {
        throw new Error("Not a provider.");
      }
      return providerPatch(mutableUser);
    });
  }

  const result = providerPatch(user);
  await helpers.writeUsers(users);
  return result;
}

export async function updateSubscriberProfile(payload, helpers, session = null) {
  const policy = getRoadsidePolicy(helpers);
  const users = await helpers.readUsers();
  const user = users.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
  if (!user) {
    throw new Error("User not found.");
  }
  if (!Array.isArray(user.roles) || !user.roles.includes("SUBSCRIBER")) {
    throw new Error("Not a subscriber.");
  }

  const currentProfile = user.subscriberProfile && typeof user.subscriberProfile === "object"
    ? user.subscriberProfile
    : {};
  const currentVehicle = currentProfile.vehicle && typeof currentProfile.vehicle === "object"
    ? currentProfile.vehicle
    : {};
  const currentPaymentInfo = currentProfile.paymentInfo && typeof currentProfile.paymentInfo === "object"
    ? currentProfile.paymentInfo
    : {};
  const currentAddress = currentProfile.primaryAddress && typeof currentProfile.primaryAddress === "object"
    ? currentProfile.primaryAddress
    : {};

  const nextVehicle = {
    year: requireString(payload.vehicle?.year || currentVehicle.year, "vehicle.year"),
    make: requireString(payload.vehicle?.make || currentVehicle.make, "vehicle.make"),
    model: requireString(payload.vehicle?.model || currentVehicle.model, "vehicle.model"),
    color: requireString(payload.vehicle?.color || currentVehicle.color, "vehicle.color")
  };
  const nextAddress = normalizeSubscriberAddress({
    ...currentAddress,
    ...(payload.address && typeof payload.address === "object" ? payload.address : {})
  });
  const paymentMethodMasked = optionalString(payload.paymentMethodMasked) || currentProfile.paymentMethodMasked || currentPaymentInfo.paymentMethodMasked || null;
  const paymentInfo = {
    ...currentPaymentInfo,
    paymentMethodMasked,
    billingZip: optionalString(payload.billingZip) || currentPaymentInfo.billingZip || nextAddress.postalCode || null,
    paymentProvider: optionalString(payload.paymentProvider) || currentPaymentInfo.paymentProvider || null
  };

  const patchUser = (mutableUser) => {
    const existingProfile = mutableUser.subscriberProfile && typeof mutableUser.subscriberProfile === "object"
      ? mutableUser.subscriberProfile
      : {};
    mutableUser.fullName = requireString(payload.fullName || mutableUser.fullName, "fullName");
    mutableUser.phoneNumber = requireString(payload.phoneNumber || mutableUser.phoneNumber, "phoneNumber");
    mutableUser.email = requireString(payload.email || mutableUser.email, "email").toLowerCase();
    mutableUser.subscriberProfile = {
      ...existingProfile,
      membershipPrice: Number(existingProfile.membershipPrice || policy.subscriber.monthlyFee),
      vehicle: nextVehicle,
      savedVehicles: [nextVehicle],
      primaryAddress: nextAddress,
      savedAddresses: nextAddress.line1 ? [nextAddress] : [],
      paymentMethodMasked,
      paymentInfo,
      updatedAt: new Date().toISOString()
    };
    return mutableUser;
  };

  if (typeof helpers.mutateUsers === "function") {
    return helpers.mutateUsers(async (mutableUsers) => {
      const mutableUser = mutableUsers.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
      if (!mutableUser) {
        throw new Error("User not found.");
      }
      if (!mutableUser.roles.includes("SUBSCRIBER")) {
        throw new Error("Not a subscriber.");
      }
      return patchUser(mutableUser);
    });
  }

  const result = patchUser(user);
  await helpers.writeUsers(users);
  return result;
}

export async function changeAccountPassword(payload, helpers, session = null) {
  const currentPassword = requireString(payload.currentPassword, "currentPassword");
  const nextPassword = requireString(payload.newPassword, "newPassword");
  const confirmPassword = requireString(payload.confirmPassword, "confirmPassword");
  if (nextPassword !== confirmPassword) {
    throw new Error("Passwords do not match.");
  }
  if (nextPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const users = await helpers.readUsers();
  const user = users.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
  if (!user) {
    throw new Error("User not found.");
  }
  if (!(await verifyStoredPassword(user, currentPassword))) {
    throw new Error("Current password is invalid.");
  }

  const applyPassword = async (mutableUser) => {
    mutableUser.passwordHash = await hashPassword(nextPassword);
    delete mutableUser.password;
    mutableUser.passwordChangedAt = new Date().toISOString();
    return mutableUser;
  };

  if (typeof helpers.mutateUsers === "function") {
    return helpers.mutateUsers(async (mutableUsers) => {
      const mutableUser = mutableUsers.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
      if (!mutableUser) {
        throw new Error("User not found.");
      }
      return applyPassword(mutableUser);
    });
  }

  const result = await applyPassword(user);
  await helpers.writeUsers(users);
  return result;
}

export async function requestPasswordReset(payload, helpers, req = null) {
  const rawIdentifier = requireString(payload.identifier || payload.email, "identifier");
  const identifier = rawIdentifier.toLowerCase();
  const genericMessage = "If an account matched that identifier, a password reset link has been sent.";
  const users = await helpers.readUsers();
  const user = users.find((entry) => {
    const email = typeof entry.email === "string" ? entry.email.toLowerCase() : "";
    const username = resolveUsername(entry);
    return email === identifier || username === identifier;
  });

  if (!user || !optionalString(user.email)) {
    await helpers.recordSecurityEvent?.("password-reset-requested", {
      matchedAccount: false,
      identifierType: identifier.includes("@") ? "email" : "username"
    });
    return {
      message: genericMessage,
      deliveryStatus: "accepted"
    };
  }

  const token = crypto.randomBytes(24).toString("hex");
  const requestedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
  const tokenHash = hashPasswordResetToken(token);
  const applyResetRecord = (mutableUser) => {
    mutableUser.passwordReset = {
      tokenHash,
      requestedAt,
      expiresAt,
      deliveryStatus: "pending",
      deliveryMessage: ""
    };
    return mutableUser;
  };

  if (typeof helpers.mutateUsers === "function") {
    await helpers.mutateUsers(async (mutableUsers) => {
      const mutableUser = mutableUsers.find((entry) => Number(entry.id) === Number(user.id));
      if (!mutableUser) {
        return null;
      }
      return applyResetRecord(mutableUser);
    });
  } else {
    applyResetRecord(user);
    await helpers.writeUsers(users);
  }

  const resetLink = buildPasswordResetLink({
    token,
    email: user.email,
    helpers,
    req
  });
  const emailRecord = buildPasswordResetEmailRecord({
    user,
    resetLink,
    requestedAt,
    expiresAt
  });
  const delivery = typeof helpers.sendAccountEmail === "function"
    ? await helpers.sendAccountEmail(emailRecord)
    : {
        deliveryStatus: "stored-no-transport",
        deliveredAt: null,
        transport: "smtp-not-configured",
        message: "Password reset stored. Outbound email transport is not configured."
      };

  if (typeof helpers.mutateUsers === "function") {
    await helpers.mutateUsers(async (mutableUsers) => {
      const mutableUser = mutableUsers.find((entry) => Number(entry.id) === Number(user.id));
      if (!mutableUser || !mutableUser.passwordReset) {
        return mutableUser || null;
      }
      mutableUser.passwordReset.deliveryStatus = delivery.deliveryStatus || "stored";
      mutableUser.passwordReset.deliveryMessage = optionalString(delivery.message);
      mutableUser.passwordReset.deliveredAt = delivery.deliveredAt || null;
      return mutableUser;
    });
  } else {
    user.passwordReset = {
      ...(user.passwordReset || {}),
      deliveryStatus: delivery.deliveryStatus || "stored",
      deliveryMessage: optionalString(delivery.message),
      deliveredAt: delivery.deliveredAt || null
    };
    await helpers.writeUsers(users);
  }

  await helpers.recordSecurityEvent?.("password-reset-requested", {
    matchedAccount: true,
    userId: user.id,
    deliveryStatus: delivery.deliveryStatus || "stored"
  });

  return {
    message: genericMessage,
    deliveryStatus: delivery.deliveryStatus || "stored"
  };
}

export async function resetAccountPassword(payload, helpers) {
  const token = requireString(payload.token, "token");
  const nextPassword = requireString(payload.newPassword, "newPassword");
  const confirmPassword = requireString(payload.confirmPassword, "confirmPassword");
  if (nextPassword !== confirmPassword) {
    throw new Error("Passwords do not match.");
  }
  if (nextPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const tokenHash = hashPasswordResetToken(token);
  const users = await helpers.readUsers();
  const user = users.find((entry) => entry?.passwordReset?.tokenHash === tokenHash);
  if (!user) {
    throw new Error("Password reset link is invalid or expired.");
  }

  const expiresAt = Date.parse(user.passwordReset?.expiresAt || "");
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    throw new Error("Password reset link is invalid or expired.");
  }

  const completedAt = new Date().toISOString();
  const applyPasswordReset = async (mutableUser) => {
    if (mutableUser?.passwordReset?.tokenHash !== tokenHash) {
      throw new Error("Password reset link is invalid or expired.");
    }
    mutableUser.passwordHash = await hashPassword(nextPassword);
    delete mutableUser.password;
    mutableUser.passwordChangedAt = completedAt;
    mutableUser.passwordReset = {
      requestedAt: mutableUser.passwordReset?.requestedAt || null,
      deliveredAt: mutableUser.passwordReset?.deliveredAt || null,
      deliveryStatus: mutableUser.passwordReset?.deliveryStatus || null,
      completedAt,
      tokenHash: null,
      expiresAt: null
    };
    return mutableUser;
  };

  let updatedUser = null;
  if (typeof helpers.mutateUsers === "function") {
    updatedUser = await helpers.mutateUsers(async (mutableUsers) => {
      const mutableUser = mutableUsers.find((entry) => Number(entry.id) === Number(user.id));
      if (!mutableUser) {
        throw new Error("User not found.");
      }
      return applyPasswordReset(mutableUser);
    });
  } else {
    updatedUser = await applyPasswordReset(user);
    await helpers.writeUsers(users);
  }

  helpers.revokeUserSessionsByUserId?.(updatedUser.id);
  await helpers.recordSecurityEvent?.("password-reset-completed", {
    userId: updatedUser.id,
    completedAt
  });
  return updatedUser;
}

export async function cancelSubscriberMembership(payload, helpers, session = null) {
  const users = await helpers.readUsers();
  const user = users.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
  if (!user) {
    throw new Error("User not found.");
  }
  if (!Array.isArray(user.roles) || !user.roles.includes("SUBSCRIBER")) {
    throw new Error("Not a subscriber.");
  }

  const cancelReason = optionalString(payload.reason) || "Cancelled by subscriber.";
  const patchUser = (mutableUser) => {
    const now = new Date().toISOString();
    mutableUser.subscriberActive = false;
    mutableUser.subscriptionStatus = "CANCELLED";
    mutableUser.nextBillingDate = null;
    mutableUser.subscriberProfile = {
      ...(mutableUser.subscriberProfile && typeof mutableUser.subscriberProfile === "object" ? mutableUser.subscriberProfile : {}),
      membershipStatus: "CANCELLED",
      cancelledAt: now,
      cancelReason
    };
    mutableUser.terms = {
      ...(mutableUser.terms || {}),
      subscriber: {
        ...(mutableUser.terms?.subscriber || {}),
        cancelledAt: now
      }
    };
    return mutableUser;
  };

  if (typeof helpers.mutateUsers === "function") {
    return helpers.mutateUsers(async (mutableUsers) => {
      const mutableUser = mutableUsers.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
      if (!mutableUser) {
        throw new Error("User not found.");
      }
      if (!mutableUser.roles.includes("SUBSCRIBER")) {
        throw new Error("Not a subscriber.");
      }
      return patchUser(mutableUser);
    });
  }

  const result = patchUser(user);
  await helpers.writeUsers(users);
  return result;
}

export async function acceptProviderPayoutTerms(payload, helpers, session = null) {
  const policy = getRoadsidePolicy(helpers);
  const users = await helpers.readUsers();
  const user = users.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
  if (!user) {
    throw new Error("User not found.");
  }
  if (!Array.isArray(user.roles) || !user.roles.includes("PROVIDER")) {
    throw new Error("Not a provider.");
  }
  if (payload.providerPayoutTermsAccepted !== true) {
    throw new Error("Provider payout terms must be accepted before payout can be released.");
  }
  if (payload.providerPayoutDisputeWindowAccepted !== true) {
    throw new Error("Provider payout dispute timing must be accepted before payout can be released.");
  }
  if (payload.providerPayoutNoPostReceiptDisputeAccepted !== true) {
    throw new Error("Provider payout post-receipt dispute limits must be accepted before payout can be released.");
  }

  const acceptedAt = new Date().toISOString();
  const payoutTermsRecord = {
    accepted: true,
    acceptedAt,
    termsVersion: policy.financial?.walletDisplayTerms?.payoutTermsVersion || "provider-payout-2026-05-30",
    disputeWindowAccepted: true,
    noPostReceiptDisputeAccepted: true,
    safeModeActive: false
  };

  const patchUser = (mutableUser) => {
    mutableUser.providerProfile = {
      ...(mutableUser.providerProfile || {}),
      payoutTerms: payoutTermsRecord
    };
    mutableUser.terms = {
      ...(mutableUser.terms || {}),
      providerPayout: payoutTermsRecord
    };
    return mutableUser;
  };

  if (typeof helpers.mutateUsers === "function") {
    return helpers.mutateUsers(async (mutableUsers) => {
      const mutableUser = mutableUsers.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
      if (!mutableUser) {
        throw new Error("User not found.");
      }
      if (!mutableUser.roles.includes("PROVIDER")) {
        throw new Error("Not a provider.");
      }
      return patchUser(mutableUser);
    });
  }

  const result = patchUser(user);
  await helpers.writeUsers(users);
  return result;
}

export async function uploadProviderDocuments(payload, helpers, session = null) {
  const users = await helpers.readUsers();
  const user = users.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
  if (!user) {
    throw new Error("User not found.");
  }
  if (!user.roles.includes("PROVIDER")) {
    throw new Error("Not a provider.");
  }

  const documents = payload.documents && typeof payload.documents === "object" ? payload.documents : {};
  const existingDocuments = user.providerProfile?.documents || {};
  const storedDocuments = typeof helpers.saveProviderDocuments === "function"
    ? await helpers.saveProviderDocuments(user.id, existingDocuments, documents)
    : normalizeProviderDocuments(documents, existingDocuments);

  const patchUser = (mutableUser) => {
    const providerProfile = mutableUser.providerProfile && typeof mutableUser.providerProfile === "object"
      ? mutableUser.providerProfile
      : {};
    const documentStatus = summarizeProviderDocuments(storedDocuments);
    const approvalEligibility = buildProviderApprovalEligibility({
      providerInfo: providerProfile.providerInfo || {},
      vehicleInfo: providerProfile.vehicleInfo || {},
      documentStatus,
      assessment: providerProfile.assessment || {},
      hoursOfService: providerProfile.hoursOfService || {},
      serviceArea: providerProfile.serviceArea || "",
      currentLocation: providerProfile.currentLocation || "",
      currentLocationCoordinates: providerProfile.currentLocationCoordinates || null,
      serviceAreaCoordinates: providerProfile.serviceAreaCoordinates || null
    });
    mutableUser.providerProfile = {
      ...providerProfile,
      documents: storedDocuments,
      documentStatus,
      approvalEligibility,
      profileSubmissionStatus: mutableUser.providerStatus === "APPROVED"
        ? "APPROVED"
        : approvalEligibility.assessmentPassed
          ? "PASSED_PENDING_PROVIDER"
          : "FAILED_PENDING_PROVIDER"
    };
    mutableUser.providerStatus = mutableUser.providerStatus || "DRAFT";
    return mutableUser;
  };

  if (typeof helpers.mutateUsers === "function") {
    return helpers.mutateUsers(async (mutableUsers) => {
      const mutableUser = mutableUsers.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
      if (!mutableUser) {
        throw new Error("User not found.");
      }
      if (!mutableUser.roles.includes("PROVIDER")) {
        throw new Error("Not a provider.");
      }
      return patchUser(mutableUser);
    });
  }

  const result = patchUser(user);
  await helpers.writeUsers(users);
  return result;
}

function buildLoginPayload(user) {
  const payload = {
    userId: user.id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    roles: user.roles,
    phoneNumber: user.phoneNumber || "",
    providerStatus: user.providerStatus,
    subscriberActive: user.subscriberActive,
    subscriptionStatus: user.subscriptionStatus || null,
    accountState: user.accountState || "ACTIVE"
  };

  // Ensure no admin-only fields leak to the public/client
  delete payload.adminFields;
  delete payload.internalNotes;

  return payload;
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Field "${fieldName}" is required.`);
  }
  return value.trim();
}

function normalizeUsername(value) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(normalized)) {
    throw new Error('Username must be 3-32 characters using letters, numbers, ".", "_" or "-".');
  }
  return normalized;
}

function resolveUsername(user) {
  if (typeof user.username === "string" && user.username.trim()) {
    return user.username.trim().toLowerCase();
  }

  if (typeof user.email === "string" && user.email.includes("@")) {
    return user.email.split("@")[0].trim().toLowerCase();
  }

  return "";
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSubscriberAddress(value) {
  const address = value && typeof value === "object" ? value : {};
  return {
    line1: optionalString(address.line1 || address.addressLine),
    line2: optionalString(address.line2),
    city: optionalString(address.city),
    state: optionalString(address.state || address.stateRegion),
    postalCode: optionalString(address.postalCode || address.zip || address.billingZip),
    crossStreet: optionalString(address.crossStreet)
  };
}

function buildPasswordResetEmailRecord({ user, resetLink, requestedAt, expiresAt }) {
  const subject = "AW Roadside password reset";
  const body = [
    `Hello ${user.fullName || user.username || "user"},`,
    "",
    "A password reset was requested for your AW Roadside account.",
    `Requested at: ${requestedAt}`,
    `Expires at: ${expiresAt}`,
    "",
    "Open the link below to choose a new password:",
    resetLink,
    "",
    "If you did not request this reset, you can ignore this email."
  ].join("\n");

  return {
    recipientEmail: user.email || null,
    subject,
    body
  };
}

function buildPasswordResetLink({ token, email, helpers, req }) {
  const configuredUrl = optionalString(process.env.PUBLIC_RESET_PASSWORD_URL || process.env.RESET_PASSWORD_URL);
  const fallbackBase = `${resolveRequestBaseUrl(helpers, req)}/reset-password.html`;
  const url = new URL(configuredUrl || fallbackBase);
  url.searchParams.set("token", token);
  if (email) {
    url.searchParams.set("email", email);
  }
  return url.toString();
}

function resolveRequestBaseUrl(helpers, req) {
  const value = typeof helpers.getRequestBaseUrl === "function"
    ? optionalString(helpers.getRequestBaseUrl(req))
    : "";
  return value.replace(/\/$/, "") || "https://awroadside-fire-backend.onrender.com";
}

export function buildSubscriberConfirmationRecord({ user, vehicle, membershipPrice, confirmedAt }) {
  const subject = "AW Roadside subscription confirmed";
  const body = [
    `Hello ${user.fullName || user.username || "subscriber"},`,
    "",
    "Your AW Roadside subscription is now active.",
    `Membership price: $${Number(membershipPrice || 0).toFixed(2)}/month`,
    `Vehicle on file: ${[vehicle.year, vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ") || "not provided"}`,
    `Confirmation date: ${confirmedAt}`,
    "",
    "Keep this confirmation for your records."
  ].join("\n");

  return {
    status: "CONFIRMED",
    confirmedAt,
    recipientEmail: user.email || null,
    subject,
    body
  };
}

function normalizeString(value) {
  return optionalString(value);
}

function optionalIsoString(value) {
  const normalized = optionalString(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeProviderDocuments(incomingDocuments = {}, existingDocuments = {}) {
  const supported = ["license", "registration", "insurance", "profilePhoto", "proofOfAddress", "helperId"];
  const normalized = {};
  for (const docType of supported) {
    normalized[docType] = normalizeProviderDocumentEntry(
      incomingDocuments?.[docType],
      existingDocuments?.[docType]
    );
  }
  return normalized;
}

function normalizeProviderDocumentEntry(incoming, existing) {
  const previous = normalizeExistingProviderDocument(existing);
  if (incoming === undefined) {
    return previous;
  }
  if (incoming === false || incoming === null) {
    return normalizeExistingProviderDocument(false);
  }
  if (incoming === true) {
    return {
      ...previous,
      submitted: true,
      uploadedAt: previous.uploadedAt || new Date().toISOString()
    };
  }
  if (!incoming || typeof incoming !== "object") {
    return {
      ...previous,
      submitted: Boolean(incoming)
    };
  }
  return {
    submitted: incoming.submitted !== false,
    verified: Boolean(incoming.verified ?? previous.verified),
    uploadedAt: previous.uploadedAt || new Date().toISOString(),
    fileName: optionalString(incoming.fileName) || previous.fileName,
    contentType: optionalString(incoming.contentType) || previous.contentType,
    sizeBytes: Number.isFinite(Number(incoming.sizeBytes)) ? Number(incoming.sizeBytes) : previous.sizeBytes,
    storagePath: optionalString(incoming.storagePath) || previous.storagePath,
    sourceUrl: optionalString(incoming.sourceUrl) || previous.sourceUrl,
    documentNumber: optionalString(incoming.documentNumber) || previous.documentNumber,
    expiresAt: optionalString(incoming.expiresAt) || previous.expiresAt,
    note: optionalString(incoming.note) || previous.note
  };
}

function normalizeExistingProviderDocument(value) {
  if (value === true) {
    return {
      submitted: true,
      verified: false,
      uploadedAt: null,
      fileName: null,
      contentType: null,
      sizeBytes: 0,
      storagePath: null,
      sourceUrl: null,
      documentNumber: null,
      expiresAt: null,
      note: null
    };
  }
  if (!value || value === false) {
    return {
      submitted: false,
      verified: false,
      uploadedAt: null,
      fileName: null,
      contentType: null,
      sizeBytes: 0,
      storagePath: null,
      sourceUrl: null,
      documentNumber: null,
      expiresAt: null,
      note: null
    };
  }
  return {
    submitted: Boolean(value.submitted ?? value.fileName ?? value.storagePath ?? value.sourceUrl),
    verified: Boolean(value.verified),
    uploadedAt: optionalString(value.uploadedAt) || null,
    fileName: optionalString(value.fileName) || null,
    contentType: optionalString(value.contentType) || null,
    sizeBytes: Number.isFinite(Number(value.sizeBytes)) ? Number(value.sizeBytes) : 0,
    storagePath: optionalString(value.storagePath) || null,
    sourceUrl: optionalString(value.sourceUrl) || null,
    documentNumber: optionalString(value.documentNumber) || null,
    expiresAt: optionalString(value.expiresAt) || null,
    note: optionalString(value.note) || null
  };
}

function summarizeProviderDocuments(documents = {}) {
  const required = ["license", "registration", "insurance", "profilePhoto", "proofOfAddress"];
  const expirationRequired = new Set(["license", "registration", "insurance"]);
  const missing = required.filter((docType) => !Boolean(documents?.[docType]?.submitted));
  const expired = required.filter((docType) => {
    if (!expirationRequired.has(docType) || !documents?.[docType]?.submitted) {
      return false;
    }
    return !isFutureDocumentDate(documents?.[docType]?.expiresAt);
  });
  const submittedCount = Object.values(documents).filter((entry) => entry?.submitted).length;
  return {
    required,
    expirationRequired: [...expirationRequired],
    submittedCount,
    missing,
    expired,
    meetsMinimumRequirements: missing.length === 0 && expired.length === 0
  };
}

function isFutureDocumentDate(value) {
  const normalized = optionalString(value);
  if (!normalized) {
    return false;
  }
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function buildProviderApprovalEligibility({
  providerInfo = {},
  vehicleInfo = {},
  documentStatus = {},
  assessment = {},
  hoursOfService = {},
  serviceArea = "",
  currentLocation = "",
  currentLocationCoordinates = null,
  serviceAreaCoordinates = null
} = {}) {
  const vehicleReady = Boolean(
    optionalString(vehicleInfo.year) &&
    optionalString(vehicleInfo.make) &&
    optionalString(vehicleInfo.model) &&
    optionalString(vehicleInfo.color)
  );
  const assessmentPassed = assessment?.passed === true;
  const assessmentComplete = assessment?.complete === true;
  const documentsReady = documentStatus?.meetsMinimumRequirements === true;
  const hoursReady = hoursOfService?.hasHours === true;
  const serviceAreaReady = Boolean(optionalString(serviceArea));
  const currentLocationReady = Boolean(optionalString(currentLocation));
  const locationResolved = Boolean(
    (currentLocationCoordinates && Number.isFinite(Number(currentLocationCoordinates.longitude)) && Number.isFinite(Number(currentLocationCoordinates.latitude))) ||
    (serviceAreaCoordinates && Number.isFinite(Number(serviceAreaCoordinates.longitude)) && Number.isFinite(Number(serviceAreaCoordinates.latitude)))
  );
  const payoutMethodReady = Boolean(optionalString(providerInfo.payoutProvider) && optionalString(providerInfo.payoutMethodMasked));
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

function getRoadsidePolicy(helpers) {
  const policy = helpers.getRoadsidePolicy?.();
  return {
    subscriber: {
      monthlyFee: Number(policy?.subscriber?.monthlyFee || DEFAULT_SUBSCRIBER_MONTHLY),
      termsVersion: policy?.subscriber?.termsVersion || "subscriber-2026-04-18",
      platformLiability: policy?.subscriber?.platformLiability || "dispatch-only"
    },
    provider: {
      monthlyFee: Number(policy?.provider?.monthlyFee || DEFAULT_PROVIDER_MONTHLY),
      termsVersion: policy?.provider?.termsVersion || "provider-2026-04-18",
      liabilityStatement:
        policy?.provider?.liabilityStatement ||
        "Independent providers are liable for civil or criminal damages arising from their services.",
      assessmentQuestions: Array.isArray(policy?.provider?.assessmentQuestions)
        ? policy.provider.assessmentQuestions
        : []
    },
    financial: {
      noRefundsAfterPayment: Boolean(policy?.financial?.noRefundsAfterPayment),
      walletDisplayTerms: policy?.financial?.walletDisplayTerms || null
    }
  };
}

function buildTermsRecord(payload, role, policy, acceptedAt) {
  const base = {
    acceptedAt,
    accepted: true
  };
  if (role === "SUBSCRIBER") {
    return {
      subscriber: {
        ...base,
        termsVersion: policy.subscriber.termsVersion,
        dispatchOnlyLiabilityAccepted: payload.dispatchOnlyLiabilityAccepted === true,
        noRefundPolicyAccepted: payload.noRefundPolicyAccepted === true,
        platformLiability: policy.subscriber.platformLiability
      }
    };
  }
  return {
    provider: {
      ...base,
      termsVersion: policy.provider.termsVersion,
      liabilityAccepted: payload.providerLiabilityAccepted === true,
      holdHarmlessAccepted: payload.providerHoldHarmlessAccepted === true || payload.providerLiabilityAccepted === true,
      liabilityStatement: policy.provider.liabilityStatement
    }
  };
}

function normalizeProviderInfo(value) {
  const providerInfo = value && typeof value === "object" ? value : {};
  return {
    legalName: requireString(providerInfo.legalName || providerInfo.fullName || value.fullName, "providerInfo.legalName"),
    phoneNumber: requireString(providerInfo.phoneNumber || value.phoneNumber, "providerInfo.phoneNumber"),
    email: requireString(providerInfo.email || value.email, "providerInfo.email"),
    companyName: optionalString(providerInfo.companyName),
    w9Name: optionalString(providerInfo.w9Name),
    taxIdLast4: optionalString(providerInfo.taxIdLast4),
    payoutProvider: optionalString(providerInfo.payoutProvider),
    payoutMethodMasked: optionalString(providerInfo.payoutMethodMasked)
  };
}

function hasCapturedProviderMembership(user) {
  const billing = user?.providerProfile?.billing && typeof user.providerProfile.billing === "object"
    ? user.providerProfile.billing
    : {};
  const membershipStatus = optionalString(billing.membershipStatus).toUpperCase();
  const lastBillingStatus = optionalString(billing.lastBillingStatus).toUpperCase();
  const nextBillingDate = optionalString(user?.nextBillingDate);
  return membershipStatus === "ACTIVE" || lastBillingStatus === "CAPTURED" || Boolean(nextBillingDate);
}

function normalizeProviderPaypalSubscription(payload = {}, providerInfo = {}) {
  const subscriptionId = optionalString(
    payload.paypalSubscriptionId ||
      payload.subscriptionId ||
      providerInfo.paypalSubscriptionId ||
      providerInfo.subscriptionId
  );
  return {
    subscriptionId,
    planId: optionalString(payload.paypalPlanId || payload.planId || providerInfo.paypalPlanId || providerInfo.planId),
    status: optionalString(payload.paypalStatus || payload.subscriptionStatus || providerInfo.paypalStatus || providerInfo.subscriptionStatus) ||
      (subscriptionId ? "APPROVED" : null)
  };
}

function normalizeHoursOfService(value) {
  const hours = value && typeof value === "object" ? value : {};
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const normalized = {};
  let hasHours = false;
  for (const day of days) {
    const dayValue = hours[day];
    if (typeof dayValue === "string" && dayValue.trim()) {
      normalized[day] = dayValue.trim();
      hasHours = true;
    }
  }
  return {
    timezone: optionalString(hours.timezone) || "America/New_York",
    days: normalized,
    hasHours
  };
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => optionalString(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function normalizeProviderRates(value) {
  const rates = value && typeof value === "object" ? value : {};
  const ratingTotal = Number.isFinite(Number(rates.ratingTotal)) ? Number(rates.ratingTotal) : 0;
  const ratingCount = Number.isFinite(Number(rates.ratingCount)) ? Number(rates.ratingCount) : 0;
  return {
    ratingTotal,
    ratingCount,
    averageRating: ratingCount > 0 ? Number((ratingTotal / ratingCount).toFixed(2)) : 0
  };
}

function evaluateProviderAssessment(answers, policy) {
  const normalizedAnswers = answers && typeof answers === "object" ? answers : {};
  const questions = policy.provider.assessmentQuestions || [];
  const missing = [];
  const responseMap = {};
  for (const question of questions) {
    const answer = optionalString(normalizedAnswers[question.id]);
    if (!answer) {
      missing.push(question.id);
      continue;
    }
    responseMap[question.id] = answer;
  }
  const severeDamageAnswer = optionalString(normalizedAnswers.severeDamageDecision).toLowerCase();
  const safeDamageDecision =
    severeDamageAnswer.includes("inform") ||
    severeDamageAnswer.includes("possible damage") ||
    severeDamageAnswer.includes("do not complete") ||
    severeDamageAnswer.includes("mark");

  return {
    complete: missing.length === 0,
    passed: missing.length === 0 && safeDamageDecision,
    missing,
    answers: responseMap,
    evaluatedAt: new Date().toISOString(),
    safeDamageDecision
  };
}

function addDays(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function addBusinessDays(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  let remaining = Number(days || 0);
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  return date.toISOString();
}

function withSession(payload, helpers) {
  if (!helpers.issueUserSession) {
    return payload;
  }

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

function requireAuthenticatedUser(req, helpers) {
  if (!helpers.resolveUserSession) {
    throw new Error("Authenticated sessions are not configured.");
  }

  const session = helpers.resolveUserSession(req);
  if (!session) {
    throw new Error("A valid session token is required.");
  }
  return session;
}

function resolveAuthenticatedUserId(payload, session) {
  if (session && Number.isInteger(session.userId)) {
    return session.userId;
  }

  const userId = Number(payload.userId);
  if (!Number.isInteger(userId)) {
    throw new Error("A valid authenticated user is required.");
  }
  return userId;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await derivePasswordKey(password, salt);
  return `${PASSWORD_HASH_ALGORITHM}$${salt}$${derivedKey}`;
}

function hashPasswordResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function verifyStoredPassword(user, password) {
  if (typeof user.passwordHash === "string" && user.passwordHash.startsWith(`${PASSWORD_HASH_ALGORITHM}$`)) {
    const [, salt, expectedKey] = user.passwordHash.split("$");
    if (!salt || !expectedKey) {
      return false;
    }
    const actualKey = await derivePasswordKey(password, salt);
    return timingSafeEqual(actualKey, expectedKey);
  }

  return typeof user.password === "string" && user.password === password;
}

async function derivePasswordKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, PASSWORD_KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey.toString("hex"));
    });
  });
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
