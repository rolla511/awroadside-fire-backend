import crypto from "node:crypto";

const PASSWORD_HASH_ALGORITHM = "scrypt";
const PASSWORD_KEY_LENGTH = 64;

export function createSubscriptionController() {
  return {
    async handle(req, res, pathname, helpers) {
      if (pathname === "/api/subscriptions/config") {
        helpers.sendJson(res, 200, {
          subscriberMonthly: 5,
          providerMonthly: 5.99,
          roles: ["SUBSCRIBER", "PROVIDER"]
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
          membershipPrice: 5
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
          providerMonthly: 5.99
        });
        return true;
      }

      return false;
    }
  };
}

export async function createSignup(payload, helpers) {
  const fullName = requireString(payload.fullName, "fullName");
  const username = normalizeUsername(requireString(payload.username, "username"));
  const email = requireString(payload.email, "email").toLowerCase();
  const password = requireString(payload.password, "password");
  const phoneNumber = optionalString(payload.phoneNumber);
  const role = requireString(payload.role, "role").toUpperCase();
  const termsAccepted = payload.termsAccepted === true;
  const createdAt = new Date().toISOString();

  if (!["SUBSCRIBER", "PROVIDER"].includes(role)) {
    throw new Error('Role must be "SUBSCRIBER" or "PROVIDER".');
  }

  if (!termsAccepted) {
    throw new Error("Terms of agreement are required.");
  }

  const users = await helpers.readUsers();
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
  await helpers.writeUsers(users);

  return buildLoginPayload(newUser);
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
    user.passwordHash = await hashPassword(password);
    delete user.password;
    await helpers.writeUsers(users);
  }

  return buildLoginPayload(user);
}

export async function setupSubscriber(payload, helpers, session = null) {
  const vehicle = payload.vehicle || {};
  const make = requireString(vehicle.make, "vehicle.make");
  const model = requireString(vehicle.model, "vehicle.model");
  const year = requireString(vehicle.year, "vehicle.year");
  const color = requireString(vehicle.color, "vehicle.color");
  const paymentMethodMasked =
    optionalString(payload.paymentMethodMasked) || optionalString(payload.paymentMethod) || "manual-test-mode";

  const users = await helpers.readUsers();
  const user = users.find((entry) => entry.id === resolveAuthenticatedUserId(payload, session));
  if (!user) {
    throw new Error("User not found.");
  }
  if (!user.roles.includes("SUBSCRIBER")) {
    throw new Error("Not a subscriber.");
  }

  user.subscriberActive = true;
  user.accountState = user.accountState || "ACTIVE";
  user.nextBillingDate = user.nextBillingDate || addDays(new Date().toISOString(), 30);
  user.subscriberProfile = {
    membershipPrice: 5,
    vehicle: { make, model, year, color },
    savedVehicles: [{ make, model, year, color }],
    paymentMethodMasked
  };

  await helpers.writeUsers(users);
  return user;
}

export async function applyProvider(payload, helpers, session = null) {
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

  user.providerStatus = "PENDING_APPROVAL";
  user.accountState = user.accountState || "ACTIVE";
  user.providerProfile = {
    vehicleInfo: {
      make: requireString(vehicleInfo.make, "vehicleInfo.make"),
      model: requireString(vehicleInfo.model, "vehicleInfo.model"),
      year: requireString(vehicleInfo.year, "vehicleInfo.year"),
      color: requireString(vehicleInfo.color, "vehicleInfo.color")
    },
    documents: {
      license: Boolean(documents.license),
      registration: Boolean(documents.registration),
      insurance: Boolean(documents.insurance),
      helperId: Boolean(documents.helperId)
    },
    experience: optionalString(payload.experience)
  };
  user.services = Array.isArray(payload.services) && payload.services.length > 0 ? payload.services : ["LOCKOUT"];
  user.providerMonthly = 5.99;

  await helpers.writeUsers(users);
  return user;
}

function buildLoginPayload(user) {
  return {
    userId: user.id,
    email: user.email,
    roles: user.roles,
    phoneNumber: user.phoneNumber || "",
    providerStatus: user.providerStatus,
    subscriberActive: user.subscriberActive,
    accountState: user.accountState || "ACTIVE"
  };
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
