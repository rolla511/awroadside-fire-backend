import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

const PASSWORD_HASH_ALGORITHM = "scrypt";
const PASSWORD_KEY_LENGTH = 64;
const DEFAULT_RELEASE_OFFSET_DAYS = 30;
const MAX_STRING_LENGTH = 1000;
const MAX_RECENT_INTAKE = 200;
const PRE_SIGNUP_PREFIXES = Object.freeze([
  "/api/pre-signup",
  "/intake-events.mjs",
  "/api/intake-events",
  "/server.mjs/pre-signup",
  "/index.mjs/pre-signup"
]);
const REDACTED_KEY_PATTERN = /(password|secret|token|authorization|cookie|signature|card|cvv|cvc)/i;

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
            serverCapture: "Send capturePaypal: true with orderId to capture on the backend. Intake is stored only after a captured payment."
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
          paymentsConfigured: Boolean(paymentsConfigured())
        });

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
  const payment = await resolvePayment(payload, helpers, context);
  requireCapturedPayment(payment);

  const passwordHash = await hashPassword(TEMP_PRE_SIGNUP_PASSWORD);
  console.log(`[INTAKE] Generated password hash for ${email}: ${passwordHash}`);

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
      passwordHash: passwordHash
    },
    logistics: {
      zip,
      city: optionalString(payload?.city),
      state: optionalString(payload?.state),
      serviceArea: optionalString(payload?.serviceArea)
    },
    vehicle,
    provider: role === "PROVIDER" ? normalizeProviderPayload(payload) : null,
    subscriber: role === "SUBSCRIBER" ? normalizeSubscriberPayload(payload) : null,
    payment,
    terms: {
      accepted: payload?.termsAccepted === true,
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
      ? ["fullName", "email", "phoneNumber", "passwordHash", "vehicle", "zip", "serviceArea", "paypal"]
      : ["fullName", "email", "phoneNumber", "passwordHash", "vehicle", "zip", "paypal"]
  };
}

async function resolvePayment(payload, helpers, context) {
  const paypal = payload?.paypal && typeof payload.paypal === "object" ? payload.paypal : {};
  const payment = payload?.payment && typeof payload.payment === "object" ? payload.payment : {};
  const orderId = optionalString(payload?.orderId || payload?.paypalOrderId || paypal.orderId || paypal.paypalOrderId || payment.orderId);
  const shouldCapture = payload?.capturePaypal === true;
  let capture = payload?.capture && typeof payload.capture === "object" ? payload.capture : null;

  if (shouldCapture) {
    if (!orderId) {
      const error = new Error("orderId is required when capturePaypal is true.");
      error.statusCode = 400;
      error.code = "paypal-order-required";
      throw error;
    }
    if (!context.paymentsConfigured) {
      const error = new Error("PayPal is not configured on this backend.");
      error.statusCode = 503;
      error.code = "paypal-not-configured";
      throw error;
    }
    capture = await helpers.capturePaypalOrder(orderId);
    await helpers.appendPaymentLog?.({
      event: "pre-signup-order-captured",
      paypalOrderId: orderId,
      status: capture?.status || "CAPTURED",
      paymentKind: "pre-signup",
      targetType: "pre-signup",
      createdAt: new Date().toISOString(),
      capture
    });
  }

  const captureId =
    optionalString(payload?.captureId || payload?.paypalCaptureId || paypal.captureId || payment.captureId) ||
    extractPaypalCaptureId(capture);
  const captureStatus = optionalString(capture?.status || payload?.captureStatus || paypal.status || payment.status);

  return {
    provider: "paypal",
    orderId: orderId || null,
    captureId: captureId || null,
    status: normalizePaymentStatus(captureStatus, Boolean(captureId)),
    amount: normalizeAmount(payload?.amount || payment.amount || paypal.amount),
    capturedAt: capture ? new Date().toISOString() : optionalString(payload?.capturedAt || payment.capturedAt) || null,
    serverCaptured: Boolean(shouldCapture && capture),
    capture: sanitizeValue(capture)
  };
}

const TEMP_PRE_SIGNUP_PASSWORD = "Roadside2026!";

async function syncIntakeToUserAccount(entry, helpers) {
  if (typeof helpers.mutateUsers !== "function") {
    console.warn("[INTAKE] helpers.mutateUsers not available, skipping user account sync.");
    return null;
  }

  let user = null;
  await helpers.mutateUsers(async (users) => {
    const existing = users.find((u) => u.email.toLowerCase() === entry.contact.email.toLowerCase());
    if (existing) {
      console.log(`[INTAKE] User already exists for ${entry.contact.email}, skipping auto-creation.`);
      user = existing;
      return;
    }

    const userId = helpers.allocateUserId(users);
    const now = new Date().toISOString();
    user = {
      id: userId,
      fullName: entry.contact.fullName,
      username: entry.contact.email, 
      email: entry.contact.email,
      phoneNumber: entry.contact.phoneNumber,
      passwordHash: entry.account.passwordHash,
      roles: [entry.role],
      subscriberActive: entry.role === "SUBSCRIBER",
      subscriberProfile: entry.role === "SUBSCRIBER" ? {
        membershipPrice: 7.99,
        vehicle: entry.vehicle,
        savedVehicles: [entry.vehicle],
        membershipStatus: "ACTIVE",
        paymentInfo: {
          paymentProvider: "paypal",
          paypalOrderId: entry.payment.orderId,
          paypalCaptureId: entry.payment.captureId,
          status: "CAPTURED"
        },
        updatedAt: now
      } : null,
      providerStatus: entry.role === "PROVIDER" ? "PENDING_APPROVAL" : null,
      providerProfile: entry.role === "PROVIDER" ? {
        serviceArea: entry.logistics.serviceArea,
        services: entry.provider?.services || [],
        paypal: {
          payoutEmail: entry.provider?.payoutEmail || entry.contact.email
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
  entry.emailConfirmation = await helpers.sendAccountEmail({
    recipientEmail: entry.contact.email,
    subject: "AW Roadside pre-signup received",
    body: [
      `Hello ${entry.contact.fullName},`,
      "",
      `Your AW Roadside ${roleLabel} pre-signup profile has been received.`,
      `Profile reference: ${entry.id}`,
      `Release completion target: ${entry.releaseDate}`,
      `Temporary Password: ${TEMP_PRE_SIGNUP_PASSWORD}`,
      `Payment status: ${entry.payment.status}`,
      "",
      "Keep this confirmation for your records. You will complete final approval and profile activation at release."
    ].join("\n")
  });
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
  if (normalized === "COMPLETED" || normalized === "CAPTURED") {
    return "CAPTURED";
  }
  if (hasCaptureId) {
    return "CAPTURED";
  }
  return normalized || "PENDING_CAPTURE";
}

function requireCapturedPayment(payment) {
  if (payment?.status === "CAPTURED" && payment?.captureId) {
    return;
  }
  const error = new Error("Pre-signup storage requires a captured PayPal payment.");
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
