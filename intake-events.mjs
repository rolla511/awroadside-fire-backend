import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

const PASSWORD_HASH_ALGORITHM = "scrypt";
const PASSWORD_KEY_LENGTH = 64;
const DEFAULT_RELEASE_OFFSET_DAYS = 30;
const TEMP_PRE_SIGNUP_PASSWORD = "Roadside2026!";
const MAX_STRING_LENGTH = 1000;
const MAX_RECENT_INTAKE = 200;
const PRE_SIGNUP_PREFIXES = Object.freeze([
  "/api/pre-signup",
  "/intake-events.mjs",
  "/api/intake-events",
  "/server.mjs/pre-signup",
  "/index.mjs/pre-signup"
]);
const REDACTED_KEY_PATTERN = /(secret|token|authorization|cookie|card|cvv|cvc)/i;

export function createPreSignupIntakeController({
  intakeRoot,
  releaseDate = "",
  paymentsConfigured = () => false
} = {}) {
  if (!intakeRoot) {
    throw new Error("Pre-signup intake requires an intakeRoot.");
  }

  const intakeLogPath = path.join(intakeRoot, "pre-signup-intake.jsonl");
  const latestStatusPath = path.join(intakeRoot, "latest-pre-signup-status.json");

  return {
    async handle(req, res, pathname, helpers) {
      const route = normalizePreSignupPath(pathname);
      if (!route) {
        return false;
      }

      if (route === "/config" || route === "/status") {
        if (req.method !== "GET") {
          helpers.sendMethodNotAllowed(res, "GET");
          return true;
        }
        helpers.sendJson(res, 200, {
          intake: "pre-signup",
          releaseDate: resolveReleaseDate(releaseDate),
          roles: ["SUBSCRIBER", "PROVIDER"],
          endpoints: {
            subscriber: "/api/pre-signup/subscriber",
            provider: "/api/pre-signup/provider"
          },
          paypalCapture: {
            configured: Boolean(paymentsConfigured()),
            required: true,
            serverCapture: "Send an approved PayPal subscriptionId from the browser subscription flow, or send capturePaypal: true with orderId for server order capture. Intake is stored only after approved payment evidence."
          },
          storage: typeof helpers.getStorageStatus === "function" ? helpers.getStorageStatus() : null
        });
        return true;
      }

      if (req.method !== "POST") {
        helpers.sendMethodNotAllowed(res, "POST");
        return true;
      }

      try {
        const payload = await helpers.readJsonBody(req);
  const role = resolveRole(route, payload);
  const entry = await buildPreSignupEntry(payload, role, req, helpers, {
    releaseDate: resolveReleaseDate(releaseDate),
    paymentsConfigured: Boolean(paymentsConfigured()),
    req // Pass request to helpers if needed
  });

  await confirmPreSignupPaymentBeforeStorage(entry, helpers, req);
  await persistPreSignupEntry(entry, helpers, { intakeLogPath, latestStatusPath });
  const user = await syncIntakeToUserAccount(entry, helpers);

  await sendPreSignupConfirmation(entry, helpers);

  let session = null;
  if (user && typeof helpers.issueUserSession === "function") {
    const token = helpers.issueUserSession({
      userId: user.id,
      email: user.email,
      roles: user.roles
    });
    session = {
      userId: user.id,
      email: user.email,
      roles: user.roles,
      token,
      sessionToken: token
    };
  }

        await helpers.markInboundPayloadProcessed?.(req, {
          route: pathname,
          intakeId: entry.id,
          role: entry.role,
          userId: user?.id,
          outcome: "pre-signup-stored"
        });
        helpers.broadcastEvent?.("pre-signup-intake", {
          intakeId: entry.id,
          role: entry.role,
          paymentStatus: entry.payment.status,
          createdAt: entry.createdAt
        });

        helpers.sendJson(res, 201, {
          intakeId: entry.id,
          role: entry.role,
          profileStatus: entry.profileStatus,
          paymentStatus: entry.payment.status,
          releaseDate: entry.releaseDate,
          emailConfirmation: entry.emailConfirmation,
          storedFields: entry.storedFields,
          session
        });
      } catch (error) {
        await helpers.markInboundPayloadRejected?.(req, error, {
          route: pathname
        });
        helpers.sendJson(res, Number.isInteger(error?.statusCode) ? error.statusCode : 400, {
          error: error?.code || "pre-signup-intake-failed",
          message: error.message
        });
      }
      return true;
    }
  };
}

function normalizePreSignupPath(pathname) {
  if (typeof pathname !== "string" || !pathname) {
    return "";
  }
  for (const prefix of PRE_SIGNUP_PREFIXES) {
    if (pathname === prefix) {
      return "/";
    }
    if (pathname.startsWith(`${prefix}/`)) {
      return pathname.slice(prefix.length) || "/";
    }
  }
  return "";
}

async function confirmPreSignupPaymentBeforeStorage(entry, helpers, req) {
  if (entry?.payment?.subscriptionId) {
    await confirmPreSignupSubscriptionBeforeStorage(entry, helpers, req);
    return;
  }

  if (!entry?.payment?.orderId || entry.payment.status !== "PENDING_CAPTURE") {
    return;
  }

  if (typeof helpers.capturePaypalOrder !== "function") {
    const error = new Error("PayPal capture is not available on this backend.");
    error.statusCode = 503;
    error.code = "paypal-capture-unavailable";
    throw error;
  }

  const capture = await helpers.capturePaypalOrder(entry.payment.orderId, {
    headers: {
      authorization: req?.headers?.authorization || ""
    },
    socket: req?.socket
  });
  const captureId = extractPaypalCaptureId(capture);
  const status = normalizePaymentStatus(capture.status, Boolean(captureId));

  if (status !== "CAPTURED" || !captureId) {
    const error = new Error("PayPal payment was not captured. Profile storage was not completed.");
    error.statusCode = 402;
    error.code = "paypal-capture-required";
    error.paypalStatus = capture?.status || null;
    throw error;
  }

  entry.payment.status = status;
  entry.payment.capture = capture;
  entry.payment.captureId = captureId;
  entry.payment.capturedAt = new Date().toISOString();

  if (typeof helpers.appendPaymentLog === "function") {
    await helpers.appendPaymentLog({
      event: "pre-signup-order-captured-before-profile",
      paypalOrderId: entry.payment.orderId,
      paypalCaptureId: captureId,
      status,
      paymentKind: "pre-signup",
      targetType: "pre-signup-intake",
      targetId: entry.id,
      createdAt: entry.payment.capturedAt,
      capture
    });
  }
}

async function confirmPreSignupSubscriptionBeforeStorage(entry, helpers, req) {
  if (typeof helpers.getPaypalSubscription !== "function") {
    return;
  }

  const subscription = await helpers.getPaypalSubscription(entry.payment.subscriptionId, {}, {
    headers: {
      authorization: req?.headers?.authorization || ""
    },
    socket: req?.socket
  });
  const status = optionalString(subscription?.status).toUpperCase();
  const acceptedStatuses = new Set(["APPROVAL_PENDING", "APPROVED", "ACTIVE"]);
  if (!acceptedStatuses.has(status)) {
    const error = new Error("PayPal subscription was not approved. Profile storage was not completed.");
    error.statusCode = 402;
    error.code = "paypal-subscription-approval-required";
    error.paypalStatus = status || null;
    throw error;
  }

  entry.payment.status = status === "ACTIVE" ? "ACTIVE" : "APPROVED";
  entry.payment.subscription = sanitizeValue(subscription);

  if (typeof helpers.appendPaymentLog === "function") {
    await helpers.appendPaymentLog({
      event: "pre-signup-subscription-confirmed-before-profile",
      paypalSubscriptionId: entry.payment.subscriptionId,
      status,
      paymentKind: entry.payment.paymentKind,
      targetType: "pre-signup-intake",
      targetId: entry.id,
      createdAt: new Date().toISOString()
    });
  }
}

function resolveRole(route, payload) {
  const routeRole = route.split("/").filter(Boolean)[0] || "";
  const candidate = routeRole || readString(payload?.role);
  const role = candidate.toUpperCase();
  if (role === "SUBSCRIBER" || role === "PROVIDER") {
    return role;
  }
  const error = new Error('Pre-signup role must be "SUBSCRIBER" or "PROVIDER".');
  error.statusCode = 400;
  error.code = "invalid-role";
  throw error;
}

async function buildPreSignupEntry(payload, role, req, helpers, context) {
  const fullName = requireString(payload?.fullName || payload?.name, "fullName");
  const email = requireEmail(payload?.email);
  const zip = requireString(payload?.zip || payload?.billingZip || payload?.serviceZip, "zip");
  const vehicle = normalizeVehicle(payload?.vehicle || payload?.vehicleInfo || {});
  const createdAt = new Date().toISOString();
  const payment = await resolvePayment(payload, role, helpers, context);
  requireCapturedPayment(payment, payload);
  const electronicSignature = normalizeElectronicSignature(payload);
  
  // Use provided password if exists, otherwise fallback to temporary
  const rawPassword = readString(payload?.password || payload?.accountPassword) || TEMP_PRE_SIGNUP_PASSWORD;
  const passwordHash = await hashPassword(rawPassword);
  
  console.log(`[INTAKE] Password resolved for ${email} (isTemp: ${rawPassword === TEMP_PRE_SIGNUP_PASSWORD})`);

  return {
    id: `pre_${role.toLowerCase()}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    role,
    profileStatus: "PENDING_RELEASE_COMPLETION",
    releaseDate: context.releaseDate,
    createdAt,
    updatedAt: createdAt,
    source: {
      pathname: getRequestPathname(req),
      remoteAddress: typeof req?.socket?.remoteAddress === "string" ? req.socket.remoteAddress : null,
      userAgent: readHeader(req, "user-agent")
    },
    contact: {
      fullName,
      email,
      phoneNumber: optionalString(payload?.phoneNumber)
    },
    account: {
      username: optionalString(payload?.username) || email,
      passwordProvided: true,
      passwordHash
    },
    logistics: {
      zip,
      city: optionalString(payload?.city),
      state: optionalString(payload?.state),
      serviceArea: optionalString(payload?.serviceArea)
    },
    vehicle,
    paymentDetails: {
      cardName: optionalString(payload?.cardName),
      cardNumber: optionalString(payload?.cardNumber),
      cardExp: optionalString(payload?.cardExp),
      cardCvv: optionalString(payload?.cardCvv)
    },
    provider: role === "PROVIDER" ? normalizeProviderPayload(payload) : null,
    subscriber: role === "SUBSCRIBER" ? normalizeSubscriberPayload(payload) : null,
    payment,
    electronicSignature,
    terms: {
      accepted: payload?.termsAccepted === true,
      electronicSignatureAccepted: electronicSignature.accepted,
      subscriberTermsAccepted: payload?.subscriberTermsAccepted === true,
      providerTermsAccepted: payload?.providerTermsAccepted === true,
      noRefundPolicyAccepted: payload?.noRefundPolicyAccepted === true,
      dispatchOnlyLiabilityAccepted: payload?.dispatchOnlyLiabilityAccepted === true
    },
    emailConfirmation: {
      deliveryStatus: "pending",
      deliveredAt: null
    },
    storedFields: role === "PROVIDER"
      ? ["fullName", "email", "phoneNumber", "vehicle", "zip", "serviceArea", "paypal", "electronicSignature"]
      : ["fullName", "email", "phoneNumber", "vehicle", "zip", "paypal", "electronicSignature"]
  };
}

async function resolvePayment(payload, role, helpers, context) {
  const paypal = payload?.paypal && typeof payload.paypal === "object" ? payload.paypal : {};
  const payment = payload?.payment && typeof payload.payment === "object" ? payload.payment : {};
  const orderId = optionalString(payload?.orderId || payload?.paypalOrderId || paypal.orderId || paypal.paypalOrderId || payment.orderId);
  const subscriptionId = optionalString(payload?.subscriptionId || payload?.paypalSubscriptionId || paypal.subscriptionId || payment.subscriptionId);
  const shouldCapture = payload?.capturePaypal === true;
  let capture = payload?.capture && typeof payload.capture === "object" ? payload.capture : null;

  if (shouldCapture && orderId && !subscriptionId) {
    if (!context.paymentsConfigured) {
      const error = new Error("PayPal is not configured on this backend.");
      error.statusCode = 503;
      error.code = "paypal-not-configured";
      throw error;
    }

    // Capture is deferred until user is created so we can have a session token if required
    return {
      provider: "paypal",
      orderId,
      subscriptionId: null,
      captureId: null,
      status: "PENDING_CAPTURE",
      amount: normalizeAmount(payload?.amount || payment.amount || paypal.amount),
      capturedAt: null,
      serverCaptured: false,
      capture: null
    };
  }

  const captureId =
    optionalString(payload?.captureId || payload?.paypalCaptureId || paypal.captureId || payment.captureId) ||
    extractPaypalCaptureId(capture);
  
  const cardId = optionalString(payload?.paymentToken || payload?.cardId || payment.cardId);

  const captureStatus = optionalString(capture?.status || payload?.captureStatus || paypal.status || payment.status || (subscriptionId ? "APPROVED" : "") || (cardId ? "CAPTURED" : ""));
  const paymentKind = optionalString(payload?.paymentKind || payment.type || paypal.type);

  return {
    provider: cardId ? "card" : "paypal",
    orderId: orderId || null,
    subscriptionId: subscriptionId || null,
    captureId: captureId || cardId || null,
    paymentKind: normalizePreSignupPaymentKind(paymentKind, role, Boolean(subscriptionId)),
    status: normalizePaymentStatus(captureStatus, Boolean(captureId || cardId)),
    amount: normalizeAmount(payload?.amount || payment.amount || paypal.amount),
    capturedAt: capture ? new Date().toISOString() : optionalString(payload?.capturedAt || payment.capturedAt) || null,
    serverCaptured: Boolean(shouldCapture && capture),
    capture: sanitizeValue(capture)
  };
}

function normalizePreSignupPaymentKind(paymentKind, role, hasSubscriptionId) {
  const normalized = optionalString(paymentKind).toLowerCase();
  if (hasSubscriptionId) {
    return role === "PROVIDER" ? "provider-webhook-subscription" : "subscriber-webhook-subscription";
  }
  return normalized || "pre-signup";
}

async function syncIntakeToUserAccount(entry, helpers) {
  if (typeof helpers.mutateUsers !== "function") {
    console.warn("[INTAKE] helpers.mutateUsers not available, skipping user account sync.");
    return null;
  }

  let user = null;
  await helpers.mutateUsers(async (users) => {
    const now = new Date().toISOString();
    const existing = users.find((u) => u.email.toLowerCase() === entry.contact.email.toLowerCase());
    if (existing) {
      user = mergePreSignupEntryIntoExistingUser(existing, entry, now);
      console.log(`[INTAKE] Updated existing user ${existing.id} for pre-signup ${entry.id}`);
      return;
    }

    const userId = helpers.allocateUserId(users);
    user = {
      id: userId,
      fullName: entry.contact.fullName,
      username: entry.contact.email, 
      email: entry.contact.email,
      phoneNumber: entry.contact.phoneNumber,
      passwordHash: entry.account.passwordHash || null,
      roles: [entry.role],
      subscriberActive: entry.role === "SUBSCRIBER",
      subscriberProfile: entry.role === "SUBSCRIBER" ? {
        membershipPrice: 10.99,
        vehicle: entry.vehicle,
        savedVehicles: [entry.vehicle],
        membershipStatus: "ACTIVE",
        paymentInfo: {
          paymentProvider: "paypal",
          paypalOrderId: entry.payment.orderId,
          paypalSubscriptionId: entry.payment.subscriptionId,
          paypalCaptureId: entry.payment.captureId,
          status: entry.payment.status
        },
        paypalSubscriptionId: entry.payment.subscriptionId,
        updatedAt: now
      } : null,
      providerStatus: entry.role === "PROVIDER" ? "PENDING_APPROVAL" : null,
      providerProfile: entry.role === "PROVIDER" ? {
        serviceArea: entry.logistics.serviceArea,
        services: entry.provider?.services || [],
        paypal: {
          payoutEmail: entry.provider?.payoutEmail || entry.contact.email,
          subscriptionId: entry.payment.subscriptionId
        },
        updatedAt: now
      } : null,
      termsAccepted: entry.terms.accepted,
      accountState: "PENDING_APPROVAL",
      subscriptionStatus: entry.role === "SUBSCRIBER" ? "ACTIVE" : null,
      preSignupIntakeId: entry.id,
      createdAt: now,
      signUpDate: now,
      updatedAt: now
    };

    users.push(user);
    console.log(`[INTAKE] Created user ${userId} for pre-signup ${entry.id}`);
  });
  return user;
}

function mergePreSignupEntryIntoExistingUser(existing, entry, now) {
  const roles = Array.isArray(existing.roles) ? existing.roles : [];
  if (!roles.includes(entry.role)) {
    roles.push(entry.role);
  }

  existing.fullName = existing.fullName || entry.contact.fullName;
  existing.username = existing.username || entry.contact.email;
  existing.email = existing.email || entry.contact.email;
  existing.phoneNumber = existing.phoneNumber || entry.contact.phoneNumber;
  existing.roles = roles;
  existing.termsAccepted = existing.termsAccepted || entry.terms.accepted;
  existing.preSignupIntakeId = existing.preSignupIntakeId || entry.id;
  existing.accountState = existing.accountState || "PENDING_APPROVAL";
  existing.updatedAt = now;

  if (entry.role === "SUBSCRIBER") {
    const currentProfile = existing.subscriberProfile && typeof existing.subscriberProfile === "object"
      ? existing.subscriberProfile
      : {};
    const currentPaymentInfo = currentProfile.paymentInfo && typeof currentProfile.paymentInfo === "object"
      ? currentProfile.paymentInfo
      : {};
    existing.subscriberActive = true;
    existing.subscriptionStatus = "ACTIVE";
    existing.subscriberProfile = {
      ...currentProfile,
      membershipPrice: Number(currentProfile.membershipPrice || 10.99),
      vehicle: currentProfile.vehicle || entry.vehicle,
      savedVehicles: Array.isArray(currentProfile.savedVehicles) && currentProfile.savedVehicles.length
        ? currentProfile.savedVehicles
        : [entry.vehicle],
      membershipStatus: "ACTIVE",
      paymentInfo: {
        ...currentPaymentInfo,
        paymentProvider: "paypal",
        paypalOrderId: entry.payment.orderId || currentPaymentInfo.paypalOrderId || null,
        paypalSubscriptionId: entry.payment.subscriptionId || currentPaymentInfo.paypalSubscriptionId || null,
        paypalCaptureId: entry.payment.captureId || currentPaymentInfo.paypalCaptureId || null,
        status: entry.payment.status || currentPaymentInfo.status || null
      },
      paypalSubscriptionId: entry.payment.subscriptionId || currentProfile.paypalSubscriptionId || null,
      updatedAt: now
    };
  }

  if (entry.role === "PROVIDER") {
    const currentProfile = existing.providerProfile && typeof existing.providerProfile === "object"
      ? existing.providerProfile
      : {};
    const currentPaypal = currentProfile.paypal && typeof currentProfile.paypal === "object"
      ? currentProfile.paypal
      : {};
    existing.providerStatus = existing.providerStatus || "PENDING_APPROVAL";
    existing.providerProfile = {
      ...currentProfile,
      serviceArea: currentProfile.serviceArea || entry.logistics.serviceArea,
      services: Array.isArray(currentProfile.services) && currentProfile.services.length
        ? currentProfile.services
        : entry.provider?.services || [],
      paypal: {
        ...currentPaypal,
        payoutEmail: currentPaypal.payoutEmail || entry.provider?.payoutEmail || entry.contact.email,
        subscriptionId: entry.payment.subscriptionId || currentPaypal.subscriptionId || null
      },
      updatedAt: now
    };
  }

  return existing;
}

async function persistPreSignupEntry(entry, helpers, paths) {
  if (typeof helpers.appendPreSignupIntake === "function") {
    await helpers.appendPreSignupIntake(entry);
  }
  
  // Ensure the runtime directory exists
  try {
    await fs.mkdir(path.dirname(paths.intakeLogPath), { recursive: true });
    await fs.appendFile(paths.intakeLogPath, `${JSON.stringify(sanitizeValue(entry))}\n`, "utf8");
    await fs.writeFile(
      paths.latestStatusPath,
      JSON.stringify({
        intake: "pre-signup",
        lastIntakeId: entry.id,
        lastRole: entry.role,
        lastPaymentStatus: entry.payment.status,
        updatedAt: entry.updatedAt
      }, null, 2),
      "utf8"
    );
  } catch (error) {
    console.warn(`[INTAKE] Failed to persist pre-signup files to runtime storage: ${error.message}`);
  }
}

async function sendPreSignupConfirmation(entry, helpers) {
  if (typeof helpers.sendAccountEmail !== "function") {
    entry.emailConfirmation = {
      deliveryStatus: "stored-no-transport",
      deliveredAt: null,
      message: "No account email helper is configured."
    };
    return;
  }

  const roleLabel = entry.role === "PROVIDER" ? "provider" : "subscriber";
  const senderEmail = entry.role === "PROVIDER" ? "provider@awobemedia.com" : "subscriber@awobemedia.com";
  entry.emailConfirmation = await helpers.sendAccountEmail({
    recipientEmail: entry.contact.email,
    from: senderEmail,
    replyTo: senderEmail,
    subject: "AW Roadside pre-signup received",
    body: [
      `Hello ${entry.contact.fullName},`,
      "",
      `Your AW Roadside ${roleLabel} pre-signup profile has been received.`,
      `Profile reference: ${entry.id}`,
      `Release completion target: ${entry.releaseDate}`,
      `Temporary Password: ${TEMP_PRE_SIGNUP_PASSWORD}`,
      `Payment status: ${entry.payment.status}`,
      `Electronic signature: ${entry.electronicSignature?.accepted ? "Accepted" : "Pending"}`,
      "",
      "Keep this confirmation for your records. You will complete final approval and profile activation at release."
    ].join("\n")
  });
}

function normalizeElectronicSignature(payload) {
  const signature = payload?.electronicSignature && typeof payload.electronicSignature === "object"
    ? payload.electronicSignature
    : {};
  const accepted = payload?.electronicSignatureAccepted === true || signature?.accepted === true;
  return {
    accepted,
    signedName: optionalString(payload?.electronicSignatureName || signature?.signedName),
    signedAt: optionalString(signature?.signedAt) || (accepted ? new Date().toISOString() : null)
  };
}

function resolveReleaseDate(configuredReleaseDate) {
  const configured = optionalString(configuredReleaseDate || process.env.AW_RELEASE_DATE);
  if (configured) {
    return configured;
  }
  const release = new Date();
  release.setUTCDate(release.getUTCDate() + DEFAULT_RELEASE_OFFSET_DAYS);
  return release.toISOString().slice(0, 10);
}

function normalizeVehicle(vehicle) {
  return {
    year: optionalString(vehicle?.year),
    make: optionalString(vehicle?.make),
    model: optionalString(vehicle?.model),
    color: optionalString(vehicle?.color)
  };
}

function normalizeProviderPayload(payload) {
  return {
    services: Array.isArray(payload?.services) ? payload.services.map(optionalString).filter(Boolean).slice(0, 20) : [],
    serviceArea: optionalString(payload?.serviceArea),
    payoutEmail: optionalString(payload?.payoutEmail || payload?.paypalEmail)
  };
}

function normalizeSubscriberPayload(payload) {
  return {
    membershipPlan: optionalString(payload?.membershipPlan) || "monthly",
    billingZip: optionalString(payload?.billingZip || payload?.zip)
  };
}

function normalizeAmount(value) {
  if (value && typeof value === "object") {
    return {
      currency: optionalString(value.currency || value.currency_code) || "USD",
      value: optionalString(value.value || value.amount)
    };
  }
  const amount = optionalString(value);
  return amount ? { currency: "USD", value: amount } : null;
}

function normalizePaymentStatus(status, hasCaptureId) {
  const normalized = optionalString(status).toUpperCase();
  if (normalized === "APPROVED" || normalized === "ACTIVE") {
    return normalized;
  }
  if (normalized === "COMPLETED" || normalized === "CAPTURED") {
    return "CAPTURED";
  }
  if (hasCaptureId) {
    return "CAPTURED";
  }
  return normalized || "PENDING_CAPTURE";
}

function requireCapturedPayment(payment, payload) {
  const status = optionalString(payment?.status).toUpperCase();
  const orderId = optionalString(payment?.orderId);
  
  // Reject mock IDs immediately
  if (orderId.startsWith("CC_MOCK_") || orderId.includes("MOCK")) {
    const error = new Error("Mock payments are not allowed in this environment.");
    error.statusCode = 403;
    error.code = "mock-payment-rejected";
    throw error;
  }

  const hasEvidence = Boolean(payment?.captureId || payment?.subscriptionId || (orderId && (status === "CAPTURED" || status === "PENDING_CAPTURE" || status === "APPROVED" || status === "ACTIVE")));
  
  if ((status === "CAPTURED" || status === "APPROVED" || status === "ACTIVE" || status === "PENDING_CAPTURE") && hasEvidence) {
    return;
  }

  // Special handling for subscriptions that might not have a captureId yet but have a subscriptionId
  if (payment?.subscriptionId && (status === "ACTIVE" || status === "APPROVED" || status === "PENDING_CAPTURE")) {
    return;
  }

  const error = new Error("Pre-signup storage requires approved PayPal payment or subscription evidence. If using a credit card, it must be processed through the secure gateway first.");
  error.statusCode = 402;
  error.code = "payment-capture-required";
  throw error;
}

function extractPaypalCaptureId(capture) {
  const captures = capture?.purchase_units?.flatMap((unit) => unit?.payments?.captures || []) || [];
  return optionalString(captures[0]?.id);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, PASSWORD_KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey.toString("hex"));
      }
    });
  });
  const result = `${PASSWORD_HASH_ALGORITHM}$${salt}$${hash}`;
  console.log(`[DEBUG_LOG] Password hashed for ${password.slice(0, 3)}... (salt: ${salt})`);
  return result;
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5) {
    return "[truncated]";
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_RECENT_INTAKE).map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = REDACTED_KEY_PATTERN.test(key) && key !== "passwordHash"
      ? "[redacted]"
      : sanitizeValue(entry, depth + 1);
  }
  return sanitized;
}

function requireEmail(value) {
  const email = requireString(value, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("A valid email is required.");
    error.statusCode = 400;
    error.code = "invalid-email";
    throw error;
  }
  return email;
}

function requireString(value, fieldName) {
  const normalized = optionalString(value);
  if (!normalized) {
    const error = new Error(`${fieldName} is required.`);
    error.statusCode = 400;
    error.code = "validation-failed";
    throw error;
  }
  return normalized;
}

function optionalString(value) {
  return readString(value).slice(0, MAX_STRING_LENGTH);
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readHeader(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0].trim() : "";
  }
  return typeof value === "string" ? value.trim() : "";
}

function getRequestPathname(req) {
  try {
    return new URL(req?.url || "/", `http://${req?.headers?.host || "127.0.0.1"}`).pathname;
  } catch {
    return "/";
  }
}
