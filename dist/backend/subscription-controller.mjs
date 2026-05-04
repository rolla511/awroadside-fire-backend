import crypto from "crypto";

const PASSWORD_HASH_ALGORITHM = "scrypt";
const PASSWORD_KEY_LENGTH = 64;
const DEFAULT_SUBSCRIBER_MONTHLY = 7.99;
const DEFAULT_PROVIDER_MONTHLY = 6;

function testingTermsBypassEnabled() {
  const value = String(process.env.AW_TESTING_SKIP_TERMS || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function createSubscriptionController() {
  return {
    async handle(req, res, pathname, helpers) {
      if (pathname === "/api/subscriptions/config") {
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

      if (pathname === "/api/auth/signup") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        const payload = await helpers.readJsonBody(req);
        const signup = await createSignup(payload, helpers);
        helpers.sendJson(res, 201, withSession(signup, helpers));
        return true;
      }

      if (pathname === "/api/auth/login") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        const payload = await helpers.readJsonBody(req);
        const login = await loginUser(payload, helpers);
        helpers.sendJson(res, 200, withSession(login, helpers));
        return true;
      }

      if (pathname === "/api/auth/subscriber/setup") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        const payload = await helpers.readJsonBody(req);
        const session = requireAuthenticatedUser(req, helpers);
        const updatedUser = await setupSubscriber(payload, helpers, session);
        helpers.sendJson(res, 200, {
          userId: updatedUser.id,
          subscriberActive: updatedUser.subscriberActive,
          membershipPrice: DEFAULT_SUBSCRIBER_MONTHLY
        });
        return true;
      }

      if (pathname === "/api/auth/provider/apply") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        const payload = await helpers.readJsonBody(req);
        const session = requireAuthenticatedUser(req, helpers);
        const updatedUser = await applyProvider(payload, helpers, session);
        helpers.sendJson(res, 200, {
          userId: updatedUser.id,
          providerStatus: updatedUser.providerStatus,
          providerMonthly: DEFAULT_PROVIDER_MONTHLY
        });
        return true;
      }

      if (pathname === "/api/auth/provider/documents") {
        if (req.method !== "POST") {
          helpers.sendMethodNotAllowed(res, "POST");
          return true;
        }

        const payload = await helpers.readJsonBody(req);
        const session = requireAuthenticatedUser(req, helpers);
        const updatedUser = await uploadProviderDocuments(payload, helpers, session);
        helpers.sendJson(res, 200, {
          userId: updatedUser.id,
          providerStatus: updatedUser.providerStatus,
          documents: updatedUser.providerProfile?.documents || {}
        });
        return true;
      }

      return false;
    }
  };
}

export async function createSignup(payload, helpers) {
  const policy = getRoadsidePolicy(helpers);
  const fullName = requireString(payload.fullName, "fullName");
  const username = normalizeUsername(requireString(payload.username, "username"));
  const email = requireString(payload.email, "email").toLowerCase();
  const password = requireString(payload.password, "password");
  const phoneNumber = optionalString(payload.phoneNumber);
  const role = requireString(payload.role, "role").toUpperCase();
  const termsBypass = testingTermsBypassEnabled();
  const termsAccepted = payload.termsAccepted === true || termsBypass;
  const createdAt = new Date().toISOString();

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
      terms: buildTermsRecord(payload, role, policy, createdAt),
      trustedZone: null,
      services: [],
      available: false,
      activeShiftId: null,
      accountState: "ACTIVE",
      nextBillingDate: role === "SUBSCRIBER" ? addDays(createdAt, 30) : null,
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
  const make = requireString(vehicle.make, "vehicle.make");
  const model = requireString(vehicle.model, "vehicle.model");
  const year = requireString(vehicle.year, "vehicle.year");
  const color = requireString(vehicle.color, "vehicle.color");
  const paymentMethodMasked =
    optionalString(payload.paymentMethodMasked) || optionalString(payload.paymentMethod) || "manual-test-mode";
  const paymentInfo = {
    paymentMethodMasked,
    billingZip: optionalString(payload.billingZip),
    paymentProvider: optionalString(payload.paymentProvider) || "manual-test-mode"
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
    throw new Error("Subscriber terms must be accepted before activation.");
  }
  if (!termsBypass && payload.dispatchOnlyLiabilityAccepted !== true && user.terms?.subscriber?.dispatchOnlyLiabilityAccepted !== true) {
    throw new Error("Dispatch-only liability terms must be accepted before activation.");
  }
  if (!termsBypass && payload.noRefundPolicyAccepted !== true && user.terms?.subscriber?.noRefundPolicyAccepted !== true) {
    throw new Error("No-refund policy must be accepted before activation.");
  }

  const updateUser = async (mutableUser) => {
    const confirmedAt = new Date().toISOString();
    const confirmationRecord = buildSubscriberConfirmationRecord({
      user: mutableUser,
      vehicle: { make, model, year, color },
      membershipPrice: policy.subscriber.monthlyFee,
      confirmedAt
    });
    const delivery = typeof helpers.sendSubscriberConfirmationEmail === "function"
      ? await helpers.sendSubscriberConfirmationEmail(confirmationRecord)
      : {
          deliveryStatus: "stored-no-transport",
          deliveredAt: null,
          transport: "profile-record-only",
          message: "Subscriber confirmation stored in profile. No outbound email transport is configured."
        };

    mutableUser.subscriberActive = true;
    mutableUser.accountState = mutableUser.accountState || "ACTIVE";
    mutableUser.nextBillingDate = mutableUser.nextBillingDate || addDays(new Date().toISOString(), 30);
    mutableUser.subscriberProfile = {
      membershipPrice: policy.subscriber.monthlyFee,
      vehicle: { make, model, year, color },
      savedVehicles: [{ make, model, year, color }],
      paymentMethodMasked,
      paymentInfo,
      termsAcceptedAt: confirmedAt,
      termsVersion: policy.subscriber.termsVersion,
      confirmation: {
        ...confirmationRecord,
        ...delivery
      }
    };
    mutableUser.terms = {
      ...(mutableUser.terms || {}),
      subscriber: {
        accepted: true,
        acceptedAt: confirmedAt,
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

  const vehicleInfo = payload.vehicleInfo || {};
  const documents = payload.documents || {};
  const existingDocuments = user.providerProfile?.documents || {};
  const storedDocuments = typeof helpers.saveProviderDocuments === "function"
    ? await helpers.saveProviderDocuments(user.id, existingDocuments, documents)
    : normalizeProviderDocuments(documents, existingDocuments);
  const documentStatus = summarizeProviderDocuments(storedDocuments);
  if (!documentStatus.meetsMinimumRequirements) {
    throw new Error(`Provider documents missing: ${documentStatus.missing.join(", ")}.`);
  }
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
  if (!assessment.complete) {
    throw new Error(`Provider assessment incomplete: ${assessment.missing.join(", ")}.`);
  }
  if (!assessment.passed) {
    throw new Error("Provider assessment did not meet safety requirements.");
  }
  if (!serviceArea) {
    throw new Error("Provider service area is required.");
  }
  if (!hoursOfService.hasHours) {
    throw new Error("Provider hours of service are required.");
  }

  const currentLocation = normalizeString(payload.currentLocation || payload.location);
  const locationMetadata = typeof helpers.resolveProviderLocationMetadata === "function"
    ? await helpers.resolveProviderLocationMetadata({
        currentLocation,
        serviceArea
      })
    : {};

  const providerPatch = (mutableUser) => {
    mutableUser.providerStatus = "PENDING_APPROVAL";
    mutableUser.accountState = mutableUser.accountState || "ACTIVE";
    mutableUser.available = Boolean(payload.available ?? false);
    mutableUser.providerProfile = {
      providerInfo,
      vehicleInfo: {
        make: requireString(vehicleInfo.make, "vehicleInfo.make"),
        model: requireString(vehicleInfo.model, "vehicleInfo.model"),
        year: requireString(vehicleInfo.year, "vehicleInfo.year"),
        color: requireString(vehicleInfo.color, "vehicleInfo.color")
      },
      documents: storedDocuments,
      documentStatus,
      experience: optionalString(payload.experience),
      assessment,
      hoursOfService,
      serviceArea,
      currentLocation,
      ...locationMetadata,
      equipment,
      profileSubmittedAt: new Date().toISOString(),
      profileSubmissionStatus: "SUBMITTED",
      rates: normalizeProviderRates(payload.rates),
      noteExchangeEnabled: true
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
    mutableUser.providerProfile = {
      ...(mutableUser.providerProfile || {}),
      documents: storedDocuments,
      documentStatus: summarizeProviderDocuments(storedDocuments)
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

function buildSubscriberConfirmationRecord({ user, vehicle, membershipPrice, confirmedAt }) {
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

function normalizeProviderDocuments(incomingDocuments = {}, existingDocuments = {}) {
  const supported = ["license", "registration", "insurance", "helperId"];
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
  const required = ["license", "registration", "insurance"];
  const missing = required.filter((docType) => !Boolean(documents?.[docType]?.submitted));
  const submittedCount = Object.values(documents).filter((entry) => entry?.submitted).length;
  return {
    required,
    submittedCount,
    missing,
    meetsMinimumRequirements: missing.length === 0
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
      noRefundsAfterPayment: Boolean(policy?.financial?.noRefundsAfterPayment)
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
    taxIdLast4: optionalString(providerInfo.taxIdLast4)
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
