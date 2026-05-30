import {createReadStream, existsSync, promises as fs, readFileSync} from "fs";
import crypto from "crypto";
import http from "http";
import path from "path";
import {fileURLToPath} from "url";
import * as paypal from "./paypal-client.mjs";
import {createAdminController} from "./admin-controller.mjs";
import {createAwRoadsideSecurityController} from "./aw-roadside-security.mjs";
import {createCompatibilityGateway} from "./compatibility-gateway.mjs";
import {createAwRoadsideDbConfig} from "./awroadsidedb-config.mjs";
import {createWatchdog} from "./watchdog.mjs";
import {createLocationService} from "./location-service.mjs";
import {createProviderWalletPayload} from "./provider-wallet-controller.mjs";
import {createRequestServiceController} from "./request-service-controller.mjs";
import {createRuntimeRepository} from "./runtime-repository.mjs";
import {createAwRoadsideStorageAuthority, createAwRoadsideStorageKernel} from "./db-index.mjs";
import {createSubscriptionController} from "./subscription-controller.mjs";
import {createSmtpMailer} from "./smtp-mailer.mjs";




loadInternalEnv();

const BLUEPRINT_RELATIVE_PATH = "aw.backend.yaml";
const WEB_ROOT_ENTRY_FILE = "home.html";
const runtimeFileRoot = path.resolve(__dirname);
const blueprintPath = resolveBlueprintPath(runtimeFileRoot);
console.log(`[DEBUG_LOG] Blueprint path resolved to: ${blueprintPath}`);
const blueprintNodeContract = readBlueprintNodeContract(blueprintPath);
const projectRoot = resolveProjectRoot(runtimeFileRoot, blueprintPath, blueprintNodeContract);
const webRoot = resolveWebRoot();
const appRoot = path.join(projectRoot, "app");
const runtimeRoot = resolveRuntimeRoot();
const reportsRoot = path.join(runtimeRoot, "reports");

console.log("[DEBUG_LOG] Runtime paths initialized:");
console.log(`[DEBUG_LOG]   __dirname: ${__dirname}`);
console.log(`[DEBUG_LOG]   projectRoot: ${projectRoot}`);
console.log(`[DEBUG_LOG]   webRoot: ${webRoot}`);
console.log(`[DEBUG_LOG]   runtimeRoot: ${runtimeRoot}`);
console.log(`[DEBUG_LOG]   cwd: ${process.cwd()}`);
const logsRoot = path.join(runtimeRoot, "logs");
const paymentsRoot = path.join(runtimeRoot, "payments");
const requestsRoot = path.join(runtimeRoot, "requests");
const authRoot = path.join(runtimeRoot, "auth");
const requestServiceCacheRoot = path.join(runtimeRoot, "request-service-cache");
const providerDocumentsRoot = path.join(runtimeRoot, "provider-documents");
const paymentLogPath = path.join(paymentsRoot, "paypal-orders.jsonl");
const webhookLogPath = path.join(paymentsRoot, "paypal-webhooks.jsonl");
const requestLogPath = path.join(requestsRoot, "service-requests.jsonl");
const usersPath = path.join(authRoot, "users.json");
const PUBLIC_RUNTIME_ENTRYPOINT = (process.env.AW_RUNTIME_ENTRYPOINT || "index.mjs").trim() || "index.mjs";
const ROOT_RUNTIME_FILES = Object.freeze([
  "package.json",
  "index.mjs",
  "server.mjs",
  "local.server.mjs",
  "watchdog.mjs",
  "admin-controller.mjs",
  "aw-roadside-security.mjs",
  "awroadsidedb-config.mjs",
  "compatibility-gateway.mjs",
  "location-service.mjs",
  "paypal-client.mjs",
  "provider-wallet-controller.mjs",
  "request-service-controller.mjs",
  "runtime-repository.mjs",
  "smtp-mailer.mjs",
  "db-index.mjs",
  "storage-index.mjs",
  "storage-schema.mjs",
  "subscription-controller.mjs",
  "render.yaml",
  "aw.backend.yaml"
]);
const PROVIDER_DOCUMENT_TYPES = ["license", "registration", "insurance", "helperId"];
const PROVIDER_RATING_MIN = 1;
const PROVIDER_RATING_MAX = 8;
const PROVIDER_LOW_RATING_THRESHOLD = 3;
const PROVIDER_LOW_RATING_STRIKE_THRESHOLD = 3;
const PROVIDER_LOW_RATING_WINDOW_MONTHS = 2;
const PROVIDER_SUSPENSION_DURATIONS_DAYS = [14, 60];
const PROVIDER_REINSTATEMENT_PROBATION_YEARS = 1;
const PROVIDER_DISCIPLINE_POLICY_VERSION = "2026-04-27";
const ALLOWED_PROVIDER_DOCUMENT_CONTENT_TYPES = new Map([
  ["text/plain", ".txt"],
  ["image/jpeg", ".jpeg"]
]);

function readBooleanEnv(value, fallback = false) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

const subscriberMonthlyFee = Number.parseFloat(process.env.SUBSCRIBER_MONTHLY_FEE || "7.99");
const providerMonthlyFee = Number.parseFloat(process.env.PROVIDER_MONTHLY_FEE || "6");
const publicPricingVisible = readBooleanEnv(process.env.PUBLIC_PRICING_VISIBLE, false);
const showInternalPreviewData = readBooleanEnv(process.env.SHOW_INTERNAL_PREVIEW_DATA, false);
const PROVIDER_ASSESSMENT_QUESTIONS = [
  { id: "jumpstartProcedure", prompt: "How do you safely perform a jumpstart?" },
  { id: "jackPlacement", prompt: "Where do you place a jack on a car?" },
  { id: "specialtyVehicleJack", prompt: "What type of jack do you use on BMW, van, truck, or Benz platforms?" },
  { id: "spoolDefinition", prompt: "What is a spool?" },
  { id: "frozenLugNut", prompt: "How do you remove a frozen lug nut?" },
  { id: "lockoutTools", prompt: "What tools do you use to perform a lockout?" },
  { id: "lockoutDamagePrevention", prompt: "What is the best way to prevent damage to a vehicle while performing a lockout?" },
  { id: "incorrectLockoutDamage", prompt: "What damages can happen if your perform a lockout incoorectly ?" },
  { id: "tirePlugKnowledge", prompt: "Do you know how to plug a tire?" },
  {
    id: "severeDamageDecision",
    prompt:
      "If perfoming a service for a customer and it can cause sever damage to the customer property or person do you complete the service or inform the customer of the possible damage and mark the service as complete"
  }
];
const AW_ROADSIDE_POLICY = Object.freeze({
  variantId: "awroadside-fire",
  termsVersion: "2026-04-18",
  platform: {
    liability: "dispatch-only",
    holdHarmless:
      "Subscribers and providers agree to hold the managing AW Roadside platform harmless for provider-contracted services."
  },
  subscriber: {
    monthlyFee: subscriberMonthlyFee,
    termsVersion: "subscriber-2026-04-18",
    platformLiability: "The platform is liable for dispatch coordination only.",
    noRefundPolicy:
      "No refund policy once payment is submitted. Subscriber use of service forms a contracted agreement to manage a transaction or service.",
    workflow: [
      "sign-up",
      "membership-activation",
      "request",
      "eta-acceptance",
      "service-payment",
      "arrival-confirmation",
      "completion-confirmation"
    ]
  },
  provider: {
    monthlyFee: providerMonthlyFee,
    termsVersion: "provider-2026-04-18",
    liabilityStatement:
      "Independent providers are responsible for civil or criminal damages resulting from their services.",
    assessmentQuestions: PROVIDER_ASSESSMENT_QUESTIONS,
    ratingPolicy: {
      ratingRange: `${PROVIDER_RATING_MIN} to ${PROVIDER_RATING_MAX}`,
      lowRatingThreshold: PROVIDER_LOW_RATING_THRESHOLD,
      lowRatingStrikeThreshold: PROVIDER_LOW_RATING_STRIKE_THRESHOLD,
      rollingWindowMonths: PROVIDER_LOW_RATING_WINDOW_MONTHS,
      suspensionDaysByStrike: PROVIDER_SUSPENSION_DURATIONS_DAYS,
      thirdStrike: "indefinite suspension until admin-managed roadside training enrollment",
      reinstatementProbationYears: PROVIDER_REINSTATEMENT_PROBATION_YEARS,
      postTrainingRestriction:
        "After third-strike training reinstatement, three low ratings inside one calendar year flags and restricts the provider from service."
    }
  },
  financial: {
    noRefundsAfterPayment: true,
    payoutLedgerEnabled: true,
    platformServiceChargeRate: 0.02,
    walletDisplayTerms: {
      title: "Wallet display and financial record",
      summary:
        "The site wallet displays provider earnings from completed work logs and payout states as a financial record, not as a separate money-holding account.",
      thirdPartyResponsibility:
        "The third-party payment company remains physically responsible for actual account balances, reserves, withholdings, and released funds.",
      expectedParity:
        "Displayed wallet totals should match the third-party payout balance for the same completed work and payout events.",
      discrepancyProcess:
        "If the third-party balance does not match the site wallet, the user may dispute the discrepancy with the third-party company and use the site wallet record to validate the claim."
    }
  },
  requestLifecycle: [
    "SUBMITTED",
    "ASSIGNED",
    "EN_ROUTE",
    "ARRIVED",
    "COMPLETED"
  ],
  uiEventMap: {
    serviceTypes: {
      "Jump Start": "Jump Start",
      Lockout: "Lockout",
      "Tire Change": "Tire Change",
      "Gas Delivery": "Gas Delivery",
      "Battery Install": "Battery Install",
      JUMP_START: "Jump Start",
      LOCKOUT: "Lockout",
      TIRE_CHANGE: "Tire Change",
      GAS_DELIVERY: "Gas Delivery",
      BATTERY_INSTALL: "Battery Install"
    },
    requestStatus: {
      SUBMITTED: "Request received",
      ASSIGNED: "Provider assigned",
      ACCEPTED: "Provider assigned",
      EN_ROUTE: "Provider on the way",
      ARRIVED: "Provider arrived",
      COMPLETED: "Service completed",
      OPEN: "Open"
    },
    paymentStatus: {
      NOT_PAID: "Payment not started",
      ORDER_CREATED: "Payment started",
      PENDING_CAPTURE: "Payment pending",
      CAPTURED: "Payment completed",
      DECLINED: "Payment declined",
      REFUNDED: "Payment refunded",
      CANCELLED: "Payment canceled",
      CREATED: "Payment created",
      COMPLETED: "Payment completed",
      DENIED: "Payment denied",
      PENDING: "Payment pending"
    },
    providerStatus: {
      DRAFT: "Setup in progress",
      PENDING_APPROVAL: "Pending approval",
      APPROVED: "Approved",
      ACTIVE: "Active",
      SUSPENDED: "Suspended",
      INACTIVE: "Inactive"
    },
    payoutStatus: {
      UNASSIGNED: "Not ready",
      PENDING: "Pending payout",
      PROCESSING: "Payout in progress",
      COMPLETED: "Paid out",
      ON_HOLD: "On hold",
      HELD: "On hold",
      BLOCKED: "Blocked",
      FAILED: "Payout failed",
      UNCLAIMED: "Waiting to be claimed"
    },
    providerActions: {
      accept: "Accept request",
      eta: "Share ETA",
      "soft-contact": "Soft contact",
      "hard-contact": "Direct contact",
      arrived: "Mark arrived",
      completed: "Mark completed",
      note: "Send note"
    }
  }
});

const PROTECTED_API_BASE_PATH = "/aw-roadside-security.mjs";
const PROTECTED_API_ALIAS_PATHS = Object.freeze([
  "/api/aw-roadside",
  "/api/awroadside-fire"
]);
const SANDBOX_MANUAL_TEST_SERVICE_TYPES = Object.freeze([
  "JUMP_START",
  "LOCKOUT",
  "TIRE_CHANGE",
  "GAS_DELIVERY",
  "BATTERY_INSTALL"
]);
const SANDBOX_PROVIDER_DOCUMENT_TYPES = Object.freeze(["license", "registration", "insurance"]);
const SANDBOX_PROVIDER_ASSESSMENT_ANSWERS = Object.freeze({
  jumpstartProcedure: "Connect positive to positive, negative to ground, start donor, then disabled vehicle.",
  jackPlacement: "Use the manufacturer jack points on the pinch weld or frame support.",
  specialtyVehicleJack: "Use the vehicle-specific pad or low-profile jack that matches the lift points.",
  spoolDefinition: "A spool is a lift or jack support point adapter used on some vehicles.",
  frozenLugNut: "Use penetrating oil, proper socket fit, leverage, and controlled heat only when appropriate.",
  lockoutTools: "Air wedge, long reach tool, protective sleeve, and manufacturer-safe entry tools.",
  lockoutDamagePrevention: "Protect seals and paint, control tool angles, and follow the least-invasive entry method.",
  incorrectLockoutDamage: "Weather-strip damage, scratched trim, broken glass, bent frame sections, and airbag risk.",
  tirePlugKnowledge: "Yes, after confirming the puncture is repairable and not sidewall damage.",
  severeDamageDecision: "Inform the customer of the possible damage and do not complete the service."
});
const SANDBOX_MANUAL_TEST_USERS = Object.freeze([
  {
    key: "sandbox_subscriber_trenton_1",
    role: "SUBSCRIBER",
    fullName: "Sandbox Subscriber Trenton One",
    username: "sandbox.trenton.sub1",
    email: "sandbox.trenton.sub1@awroadside.test",
    password: "SandboxSubT1!",
    passwordHash: "scrypt$c4e066ac1332761cd6b24fe5912a54e9$4629c4a127f427de11da0ab4b19b30b8e0085f46f12c6af2228b9c179d31d9bf9259f683334a984c035a1b4046375bc3127193baee09b97f29dfc1413f4e81ba",
    phoneNumber: "6095551101",
    city: "Trenton, NJ",
    billingZip: "08608",
    vehicle: { year: "2022", make: "Toyota", model: "Camry", color: "Blue" },
    paymentMethodMasked: "SANDBOX-VISA-1101"
  },
  {
    key: "sandbox_subscriber_trenton_2",
    role: "SUBSCRIBER",
    fullName: "Sandbox Subscriber Trenton Two",
    username: "sandbox.trenton.sub2",
    email: "sandbox.trenton.sub2@awroadside.test",
    password: "SandboxSubT2!",
    passwordHash: "scrypt$1058e76f20c62ab1e9bedb5c70dc0d3f$080eba92cb3ef74a95c2cca9517feb43deb3e27833c68e118283577323966a15798894282cf36511a17a1438967eab4f2dd93297ae5db4996f4d9b8349747847",
    phoneNumber: "6095551102",
    city: "Trenton, NJ",
    billingZip: "08618",
    vehicle: { year: "2021", make: "Honda", model: "Accord", color: "Silver" },
    paymentMethodMasked: "SANDBOX-VISA-1102"
  },
  {
    key: "sandbox_subscriber_philadelphia_1",
    role: "SUBSCRIBER",
    fullName: "Sandbox Subscriber Philadelphia One",
    username: "sandbox.philly.sub1",
    email: "sandbox.philly.sub1@awroadside.test",
    password: "SandboxSubP1!",
    passwordHash: "scrypt$609850dfb4fe77cc367ac077d55f257b$a69fcde8f1f748942634a92dbd84f75dd40999496bc063e5547842b47195dba5b85739180480cbaa4cb641fec0bf31ba162a858da99647042a1a73438aa4bf1a",
    phoneNumber: "2155551103",
    city: "Philadelphia, PA",
    billingZip: "19107",
    vehicle: { year: "2020", make: "Nissan", model: "Altima", color: "Black" },
    paymentMethodMasked: "SANDBOX-VISA-1103"
  },
  {
    key: "sandbox_provider_trenton_1",
    role: "PROVIDER",
    fullName: "Sandbox Provider Trenton One",
    username: "sandbox.trenton.prov1",
    email: "sandbox.trenton.prov1@awroadside.test",
    password: "SandboxProvT1!",
    passwordHash: "scrypt$b822ab6d7ff07a0fd2342ad1c51df220$abf89bbbccf70136e0a9a2493b26bb71851fbb1c6437bdd993f69f3b52cf19816ee2d2cb5d8bdde89d94c18417fa4ae0acfaa31e7d60537b842778d443ee8503",
    phoneNumber: "6095552101",
    city: "Trenton, NJ",
    vehicleInfo: { year: "2020", make: "Ford", model: "Transit", color: "White" },
    payoutEmail: "sandbox.trenton.prov1-biz@awroadside.test",
    providerAccountId: "SBX-PROV-TRENTON-1",
    payoutStatus: "COMPLETED"
  },
  {
    key: "sandbox_provider_trenton_2",
    role: "PROVIDER",
    fullName: "Sandbox Provider Trenton Two",
    username: "sandbox.trenton.prov2",
    email: "sandbox.trenton.prov2@awroadside.test",
    password: "SandboxProvT2!",
    passwordHash: "scrypt$67c55b687f6fe77db39a6c097a03f1db$85050d3d5b88d8a835fa9d3dac6116fe5fb3f5916e189493cee1bcb2b0005b7e3fba5ee2c03328808c5af09517a83e66748eb23f989bb2dadb255128d34ed8f5",
    phoneNumber: "6095552102",
    city: "Trenton, NJ",
    vehicleInfo: { year: "2019", make: "Chevrolet", model: "Silverado", color: "Black" },
    payoutEmail: "sandbox.trenton.prov2-biz@awroadside.test",
    providerAccountId: "SBX-PROV-TRENTON-2",
    payoutStatus: "PENDING"
  },
  {
    key: "sandbox_provider_philadelphia_1",
    role: "PROVIDER",
    fullName: "Sandbox Provider Philadelphia One",
    username: "sandbox.philly.prov1",
    email: "sandbox.philly.prov1@awroadside.test",
    password: "SandboxProvP1!",
    passwordHash: "scrypt$5f22220413580fa71ec89258abed57e9$8ea516871fb3ad01df7e9033abd4b358641af1e101718e28250c64f6d0bc5fdc5a849cf2d8de201e2f9763f42d4b5996505f7225a2fab92e771babef8f95faca",
    phoneNumber: "2155552103",
    city: "Philadelphia, PA",
    vehicleInfo: { year: "2021", make: "Ram", model: "ProMaster", color: "Gray" },
    payoutEmail: "sandbox.philly.prov1-biz@awroadside.test",
    providerAccountId: "SBX-PROV-PHILLY-1",
    payoutStatus: "ON_HOLD"
  }
]);
const SANDBOX_MANUAL_TEST_REQUEST_FIXTURES = Object.freeze([
  {
    requestId: "sandbox-history-trenton-complete",
    subscriberKey: "sandbox_subscriber_trenton_1",
    providerKey: "sandbox_provider_trenton_1",
    location: "Trenton, NJ",
    serviceType: "LOCKOUT",
    requestState: "COMPLETED",
    paymentState: "CAPTURED",
    payoutState: "COMPLETED",
    startedMinutesAgo: 7200,
    note: "Completed sandbox lockout flow for wallet and subscriber history."
  },
  {
    requestId: "sandbox-history-trenton-pending",
    subscriberKey: "sandbox_subscriber_trenton_2",
    providerKey: "sandbox_provider_trenton_2",
    location: "Trenton, NJ",
    serviceType: "JUMP_START",
    requestState: "COMPLETED",
    paymentState: "CAPTURED",
    payoutState: "PENDING",
    startedMinutesAgo: 5760,
    note: "Captured sandbox jump start with payout still pending."
  },
  {
    requestId: "sandbox-history-philadelphia-hold",
    subscriberKey: "sandbox_subscriber_philadelphia_1",
    providerKey: "sandbox_provider_philadelphia_1",
    location: "Philadelphia, PA",
    serviceType: "TIRE_CHANGE",
    requestState: "COMPLETED",
    paymentState: "CAPTURED",
    payoutState: "ON_HOLD",
    startedMinutesAgo: 4320,
    note: "Captured sandbox tire change with payout placed on hold."
  },
  {
    requestId: "sandbox-open-trenton-1",
    subscriberKey: "sandbox_subscriber_trenton_1",
    providerKey: null,
    location: "Trenton, NJ",
    serviceType: "BATTERY_INSTALL",
    requestState: "SUBMITTED",
    paymentState: "NOT_PAID",
    payoutState: "UNASSIGNED",
    startedMinutesAgo: 90,
    note: "Open sandbox battery install for provider acceptance testing."
  },
  {
    requestId: "sandbox-open-trenton-2",
    subscriberKey: "sandbox_subscriber_trenton_2",
    providerKey: null,
    location: "Trenton, NJ",
    serviceType: "GAS_DELIVERY",
    requestState: "SUBMITTED",
    paymentState: "NOT_PAID",
    payoutState: "UNASSIGNED",
    startedMinutesAgo: 60,
    note: "Open sandbox fuel delivery for provider acceptance testing."
  },
  {
    requestId: "sandbox-open-philadelphia-1",
    subscriberKey: "sandbox_subscriber_philadelphia_1",
    providerKey: null,
    location: "Philadelphia, PA",
    serviceType: "LOCKOUT",
    requestState: "SUBMITTED",
    paymentState: "NOT_PAID",
    payoutState: "UNASSIGNED",
    startedMinutesAgo: 30,
    note: "Open sandbox Philadelphia lockout for provider acceptance testing."
  }
]);

const SERVER_AUTHORITY = Object.freeze({
  serviceId: "awroadside-fire-backend",
  runtime: "node",
  activeEntrypoint: PUBLIC_RUNTIME_ENTRYPOINT,
  rootShimEntrypoint: null,
  compatibilityGatewayPath: "/compatibility-gateway.mjs/status",
  compatibilityManifestPath: "/compatibility-gateway.mjs/manifest",
  protectedApiBasePath: PROTECTED_API_BASE_PATH,
  protectedApiAliasPaths: PROTECTED_API_ALIAS_PATHS,
  rawApiBasePath: "/index.mjs",
  statement:
    "index.mjs is the public runtime buffer. server.mjs remains the processing authority behind that entry. Compatibility and protected API surfaces resolve through root runtime modules."
});
const RAW_API_BASE_PATH = SERVER_AUTHORITY.rawApiBasePath;
const RAW_API_BASE_PATH_ALIASES = Object.freeze([
  RAW_API_BASE_PATH,
  "/server.mjs",
  "/api"
]);
const ADMIN_API_BASE_PATH = "/admin-controller.mjs";

const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10);
const startedAt = new Date();
const publicBaseUrl = resolvePublicBaseUrl();

function buildAuthorityDescriptor(req = null) {
  return {
    serviceId: SERVER_AUTHORITY.serviceId,
    variantId: AW_ROADSIDE_POLICY.variantId,
    policyVersion: AW_ROADSIDE_POLICY.termsVersion,
    runtime: SERVER_AUTHORITY.runtime,
    activeEntrypoint: SERVER_AUTHORITY.activeEntrypoint,
    rootShimEntrypoint: SERVER_AUTHORITY.rootShimEntrypoint,
    pricingSource: "server.mjs",
    compatibilityMode: "compatibility-gateway.mjs",
    statement: SERVER_AUTHORITY.statement,
    rootFiles: {
      ui: null,
      health: "index.mjs",
      authority: "index.mjs",
      runtimeStatus: "index.mjs",
      compatibilityGateway: "compatibility-gateway.mjs",
      compatibilityManifest: "compatibility-gateway.mjs",
      protectedApiBase: "aw-roadside-security.mjs",
      protectedApiAliases: ["aw-roadside-security.mjs"],
      rawApiBase: "index.mjs"
    },
    rawApiBasePath: RAW_API_BASE_PATH,
    rawApiAliasPaths: RAW_API_BASE_PATH_ALIASES.filter((candidatePath) => candidatePath !== RAW_API_BASE_PATH)
  };
}

function resolveWebRoot() {
  const configuredWebRoot = (process.env.WEB_ROOT || "").trim();
  const cwd = process.cwd();
  const candidateRoots = [...new Set([
    configuredWebRoot
      ? path.isAbsolute(configuredWebRoot)
        ? configuredWebRoot
        : path.resolve(projectRoot, configuredWebRoot)
      : null,
    path.join(projectRoot, "web"),
    path.join(cwd, "web")
  ].filter(Boolean))];

  for (const candidateRoot of candidateRoots) {
    if (existsSync(path.join(candidateRoot, WEB_ROOT_ENTRY_FILE))) {
      console.log(`[DEBUG_LOG] Web root resolved to: ${candidateRoot}`);
      return candidateRoot;
    } else {
      console.log(`[DEBUG_LOG] Candidate web root does not contain ${WEB_ROOT_ENTRY_FILE}: ${candidateRoot}`);
    }
  }

  console.log(`[DEBUG_LOG] Static UI root not configured. Checked: ${candidateRoots.join(", ") || "none"}`);
  return null;
}

function resolveBlueprintPath(runtimeRootCandidate) {
  const candidatePaths = [
    path.join(runtimeRootCandidate, BLUEPRINT_RELATIVE_PATH),
    path.join(process.cwd(), BLUEPRINT_RELATIVE_PATH)
  ];

  for (const candidatePath of candidatePaths) {
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return path.join(runtimeRootCandidate, BLUEPRINT_RELATIVE_PATH);
}

function resolveProjectRoot(runtimeRootCandidate, resolvedBlueprintPath, blueprintContract) {
  const configuredRootDir = normalizeYamlScalar(blueprintContract?.rootDir);
  const parentOfBlueprint = path.dirname(resolvedBlueprintPath);
  
  if (!configuredRootDir) {
    return parentOfBlueprint;
  }

  return path.resolve(parentOfBlueprint, configuredRootDir);
}

function readBlueprintNodeContract(resolvedBlueprintPath) {
  if (!existsSync(resolvedBlueprintPath)) {
    return Object.freeze({
      blueprintPath: resolvedBlueprintPath,
      runtime: "",
      rootDir: "",
      startCommand: "",
      healthCheckPath: "",
      nodeVersion: "",
      runtimeRoot: ""
    });
  }

  const raw = readFileSync(resolvedBlueprintPath, "utf8");
  return Object.freeze({
    blueprintPath: resolvedBlueprintPath,
    runtime: readYamlScalar(raw, "runtime"),
    rootDir: readYamlScalar(raw, "rootDir"),
    startCommand: readYamlScalar(raw, "startCommand"),
    healthCheckPath: readYamlScalar(raw, "healthCheckPath"),
    nodeVersion: readYamlEnvVarValue(raw, "NODE_VERSION"),
    runtimeRoot: readYamlEnvVarValue(raw, "RUNTIME_ROOT")
  });
}

function readYamlScalar(raw, key) {
  const match = String(raw || "").match(new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(.+?)\\s*$`, "m"));
  return match ? normalizeYamlScalar(match[1]) : "";
}

function readYamlEnvVarValue(raw, envKey) {
  const lines = String(raw || "").split("\n");
  let activeKey = "";

  for (const line of lines) {
    const keyMatch = line.match(/^\s*-\s+key:\s+(.+?)\s*$/);
    if (keyMatch) {
      activeKey = normalizeYamlScalar(keyMatch[1]);
      continue;
    }

    if (!activeKey) {
      continue;
    }

    const valueMatch = line.match(/^\s*value:\s+(.+?)\s*$/);
    if (valueMatch && activeKey === envKey) {
      return normalizeYamlScalar(valueMatch[1]);
    }
  }

  return "";
}

function normalizeYamlScalar(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
const paypalMode = (process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live" ? "live" : "sandbox";
const paypalClientId = process.env.PAYPAL_CLIENT_ID || "";
const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET || "";
const paypalPlatformId = process.env.PAYPAL_PLATFORM_ID || "";
const PAYPAL_WEBHOOK_IDS = Object.freeze({
  live: "27268198X79844346",
  sandbox: "4RN22635Y61567938"
});
const paypalWebhookId =
  (process.env.PAYPAL_WEBHOOK_ID || "").trim() || PAYPAL_WEBHOOK_IDS[paypalMode] || "";
const paypalClientModule = "paypal-client.mjs";
const paypalWebhookModule = "paypal-webhooks.mjs";
const paypalWebhookPath = `/${paypalWebhookModule}`;
const paypalWebhookPaths = Object.freeze([
  paypalWebhookPath,
  "/paypal-webhook.mjs",
  "/api/paypal-webhooks",
  "/api/paypal-webhook",
  "/api/paypal/webhooks",
  "/api/paypal/webhook",
  "/paypal-webhook",
  "/paypal-webhooks"
]);
const mapboxAccessToken = (process.env.mapbox_access_token || process.env.MAPBOX_ACCESS_TOKEN || "").trim();
const providerServiceRadiusMiles = Number.parseFloat(process.env.PROVIDER_SERVICE_RADIUS_MILES || "20");
const requestAcceptanceWindowMinutes = Number.parseFloat(process.env.REQUEST_ACCEPTANCE_WINDOW_MINUTES || "5");
const parsedRequestAcceptanceRequeueLimit = Number.parseInt(process.env.REQUEST_ACCEPTANCE_REQUEUE_LIMIT || "1", 10);
const requestAcceptanceRequeueLimit = Number.isFinite(parsedRequestAcceptanceRequeueLimit)
  ? Math.max(0, parsedRequestAcceptanceRequeueLimit)
  : 1;
const mailHost = (process.env.MAIL_HOST || "").trim();
const mailPort = Number.parseInt(process.env.MAIL_PORT || "587", 10);
const mailSecure = readBooleanEnv(process.env.MAIL_SECURE, false);
const mailRequireStartTls = readBooleanEnv(process.env.MAIL_REQUIRE_STARTTLS, true);
const mailUser = (process.env.MAIL_USER || "").trim();
const mailPassword = (process.env.MAIL_PASSWORD || "").trim();
const mailFrom = (process.env.MAIL_FROM || "").trim();
const mailReplyTo = (process.env.MAIL_REPLY_TO || mailFrom).trim();
const priorityServicePrice = Number.parseFloat(process.env.PRIORITY_SERVICE_PRICE || "25");
const serviceBasePrice = Number.parseFloat(process.env.SERVICE_BASE_PRICE || "55");
const guestServicePrice = Number.parseFloat(process.env.GUEST_SERVICE_PRICE || `${serviceBasePrice}`);
const subscriberServicePrice = Number.parseFloat(process.env.SUBSCRIBER_SERVICE_PRICE || "40");
const assignmentFee = Number.parseFloat(process.env.PROVIDER_ASSIGNMENT_FEE || "5.5");
const guestDispatchFee = Number.parseFloat(process.env.GUEST_DISPATCH_FEE || "10");
const subscriberDispatchFee = Number.parseFloat(process.env.SUBSCRIBER_DISPATCH_FEE || "0");
const sessionSecret = process.env.AW_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const sessionTtlMs = Number.parseInt(process.env.AW_SESSION_TTL_MS || `${12 * 60 * 60 * 1000}`, 10);
const watchdogIntervalMs = Number.parseInt(process.env.AW_WATCHDOG_INTERVAL_MS || `${5 * 60 * 1000}`, 10);
const sseClients = new Set();

function broadcastSseEvent(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(payload);
    } catch (err) {
      console.error("[DEBUG_LOG] Error broadcasting SSE to client:", err.message);
    }
  }
}
const userSessions = new Map();
let userMutationQueue = Promise.resolve();
let requestMutationQueue = Promise.resolve();
const adminController = createAdminController();
const compatibilityGateway = createCompatibilityGateway();
const requestServiceController = createRequestServiceController({
  cacheRoot: requestServiceCacheRoot,
  fallbackApiBaseUrl: publicBaseUrl,
  fallbackApiStyle: PUBLIC_RUNTIME_ENTRYPOINT
});
const subscriptionController = createSubscriptionController();
const watchdog = createWatchdog({
  projectRoot,
  runtimeRoot
});
const awRoadsideDbConfig = createAwRoadsideDbConfig({
  env: process.env,
  localWatchdog: watchdog,
  projectId: "awroadside-fire",
  backendEntry: "server.mjs"
});
const smtpMailer = createSmtpMailer({
  host: mailHost,
  port: mailPort,
  secure: mailSecure,
  requireStartTls: mailRequireStartTls,
  username: mailUser,
  password: mailPassword,
  from: mailFrom,
  replyTo: mailReplyTo,
  localWatchdog: watchdog
});
const storageKernel = createAwRoadsideStorageKernel();
const storageAuthority = createAwRoadsideStorageAuthority({
  awRoadsideDbConfig,
  localWatchdog: watchdog,
  storageKernel
});
const runtimeRepository = createRuntimeRepository({
  runtimeRoot
});
const locationService = createLocationService({
  accessToken: mapboxAccessToken,
  defaultRadiusMiles: providerServiceRadiusMiles,
  defaultAcceptanceWindowMinutes: requestAcceptanceWindowMinutes
});
const awRoadsideSecurityController = createAwRoadsideSecurityController({
  requestServiceController,
  watchdog
});

await runtimeRepository.initialize();
watchdog.initialize().catch((error) => {
  console.warn("[WARN] Watchdog initialization failed:", error.message);
});
await auditBlueprintNodeRuntime();
await storageAuthority.initialize();
const [initialUsers, initialRequests, initialPayments] = await Promise.all([
  readUsersFromRuntimeStorage(),
  readRequestLogFromRuntimeStorage(),
  readPaymentLogFromRuntimeStorage()
]);
await storageAuthority.syncUsers(initialUsers);
await storageAuthority.syncRequests(initialRequests);
for (const payment of initialPayments) {
  await storageAuthority.appendPaymentEvent(payment);
}
await ensureSandboxManualTestFixtures();
watchdog.startPeriodicScan(watchdogIntervalMs);
// Web entry audit is intentionally not part of the active boot path.
watchdog.record("server-started", {
  runtimeEntry: PUBLIC_RUNTIME_ENTRYPOINT,
  port,
  nodeVersion: process.version,
  dataAuthority: awRoadsideDbConfig.authority.configured ? "internal_db_url" : "runtime-storage",
  databaseConfigured: awRoadsideDbConfig.authority.configured,
  databaseId: awRoadsideDbConfig.authority.databaseId || null,
  databaseName: awRoadsideDbConfig.authority.database || null
});
await writeRuntimeArtifacts();

// --- ARCHITECTURAL NOTE: UNIFIED SIGNAL MULTIPLEXING ---
// This server uses a "Single Port, Dual Signal" architecture. 
// 1. Path-based Routing: Signals starting with /api/ are routed to the Transactional Backend.
// 2. Fallback Routing: All other signals serve the UI Shell (Frontend).
// This prevents port collision and ensures the AAB (Android App) and Browser share the same authority.

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

    const url = new URL(req.url, `http://${req.headers.host || host}`);
    let pathname = url.pathname.replace(/\/+$/, "");
    if (pathname === "") pathname = "/";

    if (pathname === "/provider-info") {
      const providerInfoCompatibilityPaths = webRoot
        ? [
            path.join(webRoot, "provider-info.html"),
            path.join(webRoot, "home.html"),
            path.join(webRoot, "index.html")
          ]
        : [];
      const providerInfoPath = providerInfoCompatibilityPaths.find((candidatePath) => existsSync(candidatePath));
      const requestBaseUrl = resolveRequestBaseUrl(req);
      const providerInfoDescriptor = {
        route: "/provider-info",
        source: "server.mjs",
        requestMethod: req.method,
        uiVariant: providerInfoPath ? path.basename(providerInfoPath) : null,
        uiVariants: providerInfoCompatibilityPaths.map((candidatePath) => path.basename(candidatePath)),
        frontendConfigUrl: `${requestBaseUrl}/aw-roadside-security.mjs/frontend-config`,
        protectedApiBaseUrl: getProtectedApiBaseUrl(req),
        protectedApiModule: "aw-roadside-security.mjs",
        locationConfigUrl: `${getProtectedApiBaseUrl(req)}/location/config`,
        compatibilityGatewayUrl: `${requestBaseUrl}/compatibility-gateway.mjs/status`
      };
      const acceptsHtml = readHeader(req, "accept").toLowerCase().includes("text/html");
      const documentRequest = readHeader(req, "sec-fetch-dest").toLowerCase() === "document";

      if (req.method !== "GET" && req.method !== "POST") {
        sendMethodNotAllowed(res, "GET, POST");
        return;
      }

      if (providerInfoPath && req.method === "GET" && (acceptsHtml || documentRequest)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(readFileSync(providerInfoPath));
        return;
      }

      sendJson(res, 200, providerInfoDescriptor);
      return;
    }

    if (pathname === "/events.mjs" || pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      res.write(": ok\n\n");
      const client = { req, res };
      sseClients.add(client);
      req.on("close", () => sseClients.delete(client));
      return;
    }

    const commonHelpers = {
      readJsonBody,
      sendJson,
      sendMethodNotAllowed,
      readUsers,
      writeUsers,
      mutateUsers,
      mutateRequests,
      allocateUserId,
      readPaymentLog,
      updateRequestRecord,
      readCacheJson,
      writeCacheJson,
      deleteFile,
      listCacheFiles,
      appendPaymentLog,
      normalizeServiceRequest,
      normalizeServicePaymentRequest,
      createServicePaymentQuote,
      createServiceRequest,
      createPaypalOrder,
      capturePaypalOrder,
      resolveUserSession,
      revokeUserSession,
      issueUserSession,
      getUserProfile,
      readRequestLog: () => readDispatchRequestLog(),
      writeRequestLog,
      applyLocalRequestAction,
      getHealthPayload,
      getPaymentConfigPayload,
      getProviderWalletPayload: (userId) => getProviderWalletPayload(userId),
      getFrontendConfigPayload: (request) => getFrontendConfigPayload(request),
      getLocationConfigPayload: () => getLocationConfigPayload(),
      forwardGeocodeLocation: (query, options) => locationService.forwardGeocode(query, options),
      getLocationIsochrone: (longitude, latitude, options) => locationService.getIsochrone(longitude, latitude, options),
      resolveProviderLocationMetadata: (payload) => resolveProviderLocationMetadata(payload),
      filterRequestsForSession: (requests, session) => filterRequestsForSession(requests, session),
      getRoadsidePolicy: () => AW_ROADSIDE_POLICY,
      presentRequestForSession: (request, session) => presentRequestForSession(request, session),
      presentRequestsForSession: (requests, session) => presentRequestsForSession(requests, session),
      getWatchdogStatus: () => watchdog.getStatus(),
      recordSecurityEvent: (event, details) => watchdog.record(event, details),
      saveProviderDocuments: (userId, currentDocuments, documentsPayload) =>
        saveProviderDocuments(userId, currentDocuments, documentsPayload),
      recordCustomerFeedback: (requestId, payload, session) => recordCustomerFeedback(requestId, payload, session),
      sendSubscriberConfirmationEmail: (payload) => sendSubscriberConfirmationEmail(payload),
      recordCompatibilityAccess: (capability, descriptor, details) =>
        runtimeRepository.recordCapabilityAccess(capability, descriptor, details),
      getCompatibilityRepository: () => runtimeRepository.getSnapshot(),
      getCompatibilityManifest: () => runtimeRepository.getManifest(),
      acknowledgeCompatibilityVariant: (payload) => runtimeRepository.acknowledgeVariant(payload),
      retainInboundPayload: (request, payload, details = {}) => retainInboundPayload(request, payload, details),
      markInboundPayloadProcessed: (request, details = {}) => markInboundPayloadProcessed(request, details),
      markInboundPayloadRejected: (request, error, details = {}) => markInboundPayloadRejected(request, error, details),
      getProtectedApiBaseUrl: (request) => getProtectedApiBaseUrl(request),
      getRequestBaseUrl: (request) => resolveRequestBaseUrl(request),
      broadcastEvent: (event, data) => broadcastSseEvent(event, data)
    };

    const adminHandled = await adminController.handle(req, res, pathname, {
      ...commonHelpers,
      paymentsConfigured: () => Boolean(paypalClientId && paypalClientSecret),
      startedAt: startedAt.toISOString()
    });
    if (adminHandled) {
      return;
    }

    const compatibilityHandled = await compatibilityGateway.handle(req, res, pathname, commonHelpers);
    if (compatibilityHandled) {
      return;
    }

    const awRoadsideHandled = await awRoadsideSecurityController.handle(req, res, pathname, commonHelpers);
    if (awRoadsideHandled) {
      return;
    }

    const requestServiceHandled = await requestServiceController.handle(req, res, pathname, {
      ...commonHelpers
    });
    if (requestServiceHandled) {
      return;
    }

    const subscriptionHandled = await subscriptionController.handle(req, res, pathname, {
      ...commonHelpers
    });
    if (subscriptionHandled) {
      return;
    }

    const normalizedRawApiPath = normalizeRawApiPath(pathname);

    if (normalizedRawApiPath === `${RAW_API_BASE_PATH}/health`) {
      res.setHeader("Content-Type", "application/json");
      sendJson(res, 200, await getHealthPayload(req));
      return;
    }

    if (normalizedRawApiPath === `${RAW_API_BASE_PATH}/authority`) {
      sendJson(res, 200, getAuthorityPayload(req));
      return;
    }

    if (normalizedRawApiPath === `${RAW_API_BASE_PATH}/frontend-config`) {
      sendJson(res, 200, await getFrontendConfigPayload(req));
      return;
    }

    if (normalizedRawApiPath === `${RAW_API_BASE_PATH}/integration-target`) {
      sendJson(res, 200, getIntegrationTargetPayload(req));
      return;
    }

    if (normalizedRawApiPath === `${RAW_API_BASE_PATH}/runtime/status`) {
      sendJson(res, 200, await createRuntimeStatus());
      return;
    }

    if (normalizedRawApiPath === `${RAW_API_BASE_PATH}/runtime/files`) {
      sendJson(res, 200, {
        root: ".",
        files: listRootRuntimeFiles()
      });
      return;
    }

    if (normalizedRawApiPath === `${RAW_API_BASE_PATH}/payments/config`) {
      sendJson(res, 200, await getPaymentConfigPayload());
      return;
    }

    if (paypalWebhookPaths.includes(pathname)) {
      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      if (!paypalClientId || !paypalClientSecret || !paypalWebhookId) {
        sendJson(res, 503, {
          error: "paypal-webhook-not-configured",
          message: "Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_WEBHOOK_ID before accepting webhooks."
        });
        return;
      }

      try {
        const rawBody = await readRawBody(req);
        if (!rawBody.trim()) {
          sendJson(res, 400, {
            error: "invalid-webhook-payload",
            message: "Webhook payload must be valid JSON."
          });
          return;
        }

        let webhookEvent;
        try {
          webhookEvent = JSON.parse(rawBody);
        } catch {
          sendJson(res, 400, {
            error: "invalid-webhook-payload",
            message: "Webhook payload must be valid JSON."
          });
          return;
        }

        const transmissionId = readHeader(req, "paypal-transmission-id");
        const transmissionTime = readHeader(req, "paypal-transmission-time");
        const transmissionSig = readHeader(req, "paypal-transmission-sig");
        const certUrl = readHeader(req, "paypal-cert-url");
        const authAlgo = readHeader(req, "paypal-auth-algo");
        const missingHeaders = [
          ["paypal-transmission-id", transmissionId],
          ["paypal-transmission-time", transmissionTime],
          ["paypal-transmission-sig", transmissionSig],
          ["paypal-cert-url", certUrl],
          ["paypal-auth-algo", authAlgo]
        ]
          .filter(([, value]) => !value)
          .map(([name]) => name);

        if (missingHeaders.length > 0) {
          sendJson(res, 400, {
            error: "missing-webhook-headers",
            message: `Missing PayPal webhook headers: ${missingHeaders.join(", ")}.`
          });
          return;
        }

        const verification = await paypal.validateWebhook(
          transmissionId,
          transmissionTime,
          certUrl,
          paypalWebhookId,
          webhookEvent,
          authAlgo,
          transmissionSig
        );
        const verificationStatus = readOptionalString(
          verification.verification_status || verification.status
        ).toUpperCase();
        const eventId = readOptionalString(webhookEvent.id) || transmissionId;
        const eventType = readOptionalString(webhookEvent.event_type).toUpperCase() || "UNKNOWN";

        if (verificationStatus !== "SUCCESS") {
          await appendPaypalWebhookLog({
            receivedAt: new Date().toISOString(),
            deliveryId: transmissionId,
            eventId,
            eventType,
            verificationStatus: verificationStatus || "FAILED",
            matched: false,
            applied: false,
            note: "verification-failed"
          });
          sendJson(res, 400, {
            error: "paypal-webhook-verification-failed",
            eventId,
            eventType,
            verificationStatus: verificationStatus || "FAILED"
          });
          return;
        }

        const duplicate = await hasProcessedPaypalWebhook({
          deliveryId: transmissionId,
          eventId
        });
        if (duplicate) {
          sendJson(res, 200, {
            ok: true,
            duplicate: true,
            eventId,
            eventType
          });
          return;
        }

        const processing = await applyPaypalWebhookEvent(webhookEvent);
        await appendPaypalWebhookLog({
          receivedAt: new Date().toISOString(),
          deliveryId: transmissionId,
          eventId,
          eventType,
          resourceId: readOptionalString(webhookEvent?.resource?.id),
          verificationStatus,
          matched: processing.matched,
          applied: processing.applied,
          targetType: processing.targetType || null,
          targetId: processing.targetId || null,
          note: processing.note || null
        });

        sendJson(res, 200, {
          ok: true,
          duplicate: false,
          eventId,
          eventType,
          verificationStatus,
          matched: processing.matched,
          applied: processing.applied,
          targetType: processing.targetType || null,
          targetId: processing.targetId || null,
          note: processing.note || null
        });
      } catch (error) {
        console.error("[ERROR] PayPal Webhook Route Failed:", error);
        sendJson(res, 500, {
          error: "paypal-webhook-failed",
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (normalizedRawApiPath === `${RAW_API_BASE_PATH}/requests`) {
      if (req.method === "POST") {
        try {
          const payload = await readJsonBody(req);
          const normalizedRequest = normalizeServiceRequest(payload);
          const savedRequest = await createServiceRequest(normalizedRequest);
          await markInboundPayloadProcessed(req, {
            route: `${RAW_API_BASE_PATH}/requests`,
            requestId: savedRequest.id,
            outcome: "created"
          });
          sendJson(res, 201, {
            requestId: savedRequest.id,
            status: savedRequest.status,
            paymentStatus: savedRequest.paymentStatus,
            request: savedRequest
          });
        } catch (error) {
          await markInboundPayloadRejected(req, error, {
            route: `${RAW_API_BASE_PATH}/requests`
          });
          if (error.statusCode === 400 || error.code === "validation-failed") {
            sendJson(res, 400, {
              error: error.code || "validation-failed",
              message: error.message
            });
          } else {
            throw error;
          }
        }
        return;
      }

      if (req.method === "GET") {
        sendJson(res, 200, {
          requests: await readRequestLog()
        });
        return;
      }

      sendMethodNotAllowed(res, "GET, POST");
      return;
    }

    if (normalizedRawApiPath === `${RAW_API_BASE_PATH}/payments/create-order`) {
      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
        sendJson(res, 503, {
          error: "paypal-not-configured",
          message: "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET before creating orders."
        });
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const normalizedRequest = normalizeServiceRequest(payload);
        const order = await createPaypalOrder(normalizedRequest);

        await appendPaymentLog({
          event: "order-created",
          request: normalizedRequest,
          paypalOrderId: order.id,
          status: order.status,
          createdAt: new Date().toISOString()
        });
        if (normalizedRequest.requestId) {
          await updateRequestRecord(normalizedRequest.requestId, (request) => ({
            ...request,
            amountCharged: Number(normalizedRequest.amount?.value || 0),
            paymentStatus: "ORDER_CREATED",
            lastPaymentOrderId: order.id
          }));
        }

        sendJson(res, 201, {
          orderId: order.id,
          status: order.status
        });
      } catch (error) {
        console.error('[ERROR] Create Order Route Failed:', error);
        sendJson(res, 500, {
          error: "paypal-create-failed",
          message: error.message
        });
      }
      return;
    }

    if (normalizedRawApiPath === `${RAW_API_BASE_PATH}/payments/capture-order`) {
      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
        sendJson(res, 503, {
          error: "paypal-not-configured",
          message: "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET before capturing orders."
        });
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
        if (!orderId) {
          sendJson(res, 400, {
            error: "invalid-order-id",
            message: "A PayPal orderId is required."
          });
          return;
        }

        const capture = await capturePaypalOrder(orderId);
        await appendPaymentLog({
          event: "order-captured",
          paypalOrderId: orderId,
          status: capture.status,
          capturedAt: new Date().toISOString(),
          capture
        });
        if (typeof payload.requestId === "string" && payload.requestId.trim()) {
          await updateRequestRecord(payload.requestId, (request) => ({
            ...request,
            paymentStatus: "CAPTURED",
            amountCollected: Number(request.amountCharged || request.amountCollected || 0),
            lastPaymentOrderId: orderId
          }));
        }

        sendJson(res, 200, {
          status: capture.status,
          orderId,
          capture
        });
      } catch (error) {
        console.error('[ERROR] Capture Order Route Failed:', error);
        sendJson(res, 500, {
          error: "paypal-capture-failed",
          message: error.message
        });
      }
      return;
    }

    const requestActionMatch = pathname.match(/^\/api\/requests\/([^/]+)\/([^/]+)$/);
    if (requestActionMatch) {
      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      const payload = await readJsonBody(req);
      const requestId = decodeURIComponent(requestActionMatch[1]);
      const action = decodeURIComponent(requestActionMatch[2]);
      const updatedRequest = await applyLocalRequestAction(requestId, action, payload);
      sendJson(res, 200, {
        requestId: updatedRequest.id,
        action,
        accepted: true,
        committed: true,
        status: updatedRequest.status,
        request: updatedRequest
      });
      return;
    }

    if (webRoot) {
      const relativePath = pathname === "/" ? WEB_ROOT_ENTRY_FILE : pathname.slice(1);
      const candidate = path.normalize(path.join(webRoot, relativePath));
      if (candidate.startsWith(webRoot)) {
        try {
          const stat = await fs.stat(candidate);
          if (stat.isFile()) {
            const body = await fs.readFile(candidate);
            res.writeHead(200, { 
              "Content-Type": contentType(candidate),
              "Cache-Control": "public, max-age=3600"
            });
            res.end(body);
            return;
          }
        } catch {
          // Fall through to explicit not-found handling below.
        }
      }
    }

    if (pathname.startsWith("/api/")) {
      await recordBlockedFallback(pathname, "unknown-api-route");
      sendJson(res, 404, {
        error: "not-found",
        message: `No API route matches ${pathname}.`
      });
      return;
    }

    const fallbackType = path.extname(pathname)
      ? "missing-static-file"
      : webRoot
        ? "blocked-shell-fallback"
        : "ui-not-configured";
    await recordBlockedFallback(pathname, fallbackType);
    
    // Do NOT fallback to a shell html file for unknown paths to avoid stale state confusion.
    // Return a clear 404 for static files and unknown routes.
    sendNotFound(res, pathname);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, Number.isInteger(error?.statusCode) ? error.statusCode : 500, {
      error: error?.code || "internal-server-error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, host, () => {
  const isPublic = isPublicBaseUrl(publicBaseUrl);
  console.log(`Runtime listening at http://${host}:${port}`);
  console.log(`Health endpoint: http://${host}:${port}${RAW_API_BASE_PATH}/health`);
  console.log(`Runtime status: http://${host}:${port}${RAW_API_BASE_PATH}/runtime/status`);
  console.log(`PayPal Webhook Target: ${publicBaseUrl}${paypalWebhookPath} ${isPublic ? "(Public)" : "(Local/Testing)"}`);
  if (!isPublic) {
    console.log(`[HINT] For live PayPal events, set PUBLIC_BASE_URL to your Render or Tunnel URL.`);
  }
  console.log(webRoot ? `Serving static files from ${webRoot}` : "Static UI root not configured.");
  console.log(`Runtime artifacts in ${runtimeRoot}`);
  console.log(`Blueprint node contract: ${blueprintNodeContract.blueprintPath}`);
  console.log(`Running Node: ${process.version}`);
});

function toRelativePath(absolutePath) {
  if (!absolutePath || typeof absolutePath !== "string") return absolutePath;
  if (!path.isAbsolute(absolutePath)) return absolutePath;
  if (absolutePath.startsWith(projectRoot)) {
    return path.relative(projectRoot, absolutePath);
  }
  return absolutePath;
}

async function writeRuntimeArtifacts() {
  const uiUrl = webRoot ? `${publicBaseUrl}/` : null;
  try {
    await fs.mkdir(reportsRoot, { recursive: true });
    await fs.mkdir(logsRoot, { recursive: true });
    await fs.mkdir(paymentsRoot, { recursive: true });
    await fs.mkdir(requestsRoot, { recursive: true });
    await fs.mkdir(authRoot, { recursive: true });
    await fs.mkdir(requestServiceCacheRoot, { recursive: true });
    await fs.mkdir(providerDocumentsRoot, { recursive: true });
  } catch (error) {
    console.warn("[WARN] Failed to create some runtime directories. This might be normal if running in a restricted environment without a persistent disk.", error.message);
  }

  const manifest = {
    app: "index-node-runtime",
    runtimeEntry: PUBLIC_RUNTIME_ENTRYPOINT,
    runtimeImplementation: "server.mjs",
    host,
    port,
    startedAt: startedAt.toISOString(),
    blueprintPath: toRelativePath(blueprintNodeContract.blueprintPath),
    blueprintRuntime: blueprintNodeContract.runtime || null,
    blueprintNodeVersion: blueprintNodeContract.nodeVersion || null,
    runningNodeVersion: process.version,
    uiUrl,
    frontendConfigUrl: `${publicBaseUrl}${PROTECTED_API_BASE_PATH}/frontend-config`,
    apiUrl: `${publicBaseUrl}${PROTECTED_API_BASE_PATH}`,
    protectedApiBaseUrl: `${publicBaseUrl}${PROTECTED_API_BASE_PATH}`,
    rawApiBaseUrl: `${publicBaseUrl}${RAW_API_BASE_PATH}`
  };

  try {
    await fs.writeFile(
      path.join(runtimeRoot, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    await fs.writeFile(
      path.join(reportsRoot, "startup-report.txt"),
      [
        "Public Runtime Startup Report",
        `Started: ${startedAt.toLocaleString()}`,
        `Runtime Entry: ${PUBLIC_RUNTIME_ENTRYPOINT}`,
        `Runtime Implementation: server.mjs`,
        `Blueprint: ${toRelativePath(blueprintNodeContract.blueprintPath)}`,
        `Blueprint Runtime: ${blueprintNodeContract.runtime || "not set"}`,
        `Blueprint Node Version: ${blueprintNodeContract.nodeVersion || "not set"}`,
        `Running Node Version: ${process.version}`,
        `UI: ${uiUrl || "not configured"}`,
        `Frontend Config: ${publicBaseUrl}${PROTECTED_API_BASE_PATH}/frontend-config`,
        `API: ${publicBaseUrl}${PROTECTED_API_BASE_PATH}`,
        `Raw API: ${publicBaseUrl}${RAW_API_BASE_PATH}`,
        `Protected API: ${publicBaseUrl}${PROTECTED_API_BASE_PATH}`,
        `Runtime Folder: ${toRelativePath(runtimeRoot)}`,
        `Watchdog Status: ${toRelativePath(path.join(runtimeRoot, "security", "latest-status.json"))}`,
        `PayPal Mode: ${paypalMode}`,
        `PayPal Configured: ${paypalClientId && paypalClientSecret ? "yes" : "no"}`,
        `PayPal Webhook: ${publicBaseUrl}${paypalWebhookPath}`,
        `PayPal Webhook ID: ${paypalWebhookId || "not set"}`
      ].join("\n")
    );

    await fs.writeFile(
      path.join(logsRoot, "session.log"),
      `[${startedAt.toISOString()}] Runtime initialized for ${host}:${port}\n`
    );
  } catch (error) {
    console.warn("[WARN] Failed to write some runtime artifacts:", error.message);
  }
}

async function createRuntimeStatus() {
  const uiUrl = webRoot ? `${publicBaseUrl}/` : null;
  return {
    status: "running",
    host,
    port,
    startedAt: startedAt.toISOString(),
    runtimeEntry: PUBLIC_RUNTIME_ENTRYPOINT,
    authority: buildAuthorityDescriptor(),
    blueprint: {
      path: toRelativePath(blueprintNodeContract.blueprintPath),
      runtime: blueprintNodeContract.runtime || null,
      nodeVersion: blueprintNodeContract.nodeVersion || null,
      rootDir: blueprintNodeContract.rootDir || null,
      runtimeRoot: blueprintNodeContract.runtimeRoot || null,
      startCommand: blueprintNodeContract.startCommand || null,
      healthCheckPath: blueprintNodeContract.healthCheckPath || null
    },
    runningNodeVersion: process.version,
    uiUrl,
    apiBaseUrl: `${publicBaseUrl}${RAW_API_BASE_PATH}`,
    adminApiBaseUrl: `${publicBaseUrl}${ADMIN_API_BASE_PATH}`,
    rawApiBaseUrl: `${publicBaseUrl}${RAW_API_BASE_PATH}`,
    frontendConfigUrl: `${publicBaseUrl}${PROTECTED_API_BASE_PATH}/frontend-config`,
    protectedApiBaseUrl: `${publicBaseUrl}${PROTECTED_API_BASE_PATH}`,
    compatibilityRepositoryUrl: `${publicBaseUrl}/compatibility-gateway.mjs/repository`,
    securityLayer: "aw-roadside-security.mjs",
    projectFolders: [],
    projectFiles: listRootRuntimeFiles(),
    payments: {
      provider: "paypal",
      mode: paypalMode,
      configured: Boolean(paypalClientId && paypalClientSecret),
      webhookConfigured: Boolean(paypalClientId && paypalClientSecret && paypalWebhookId),
      webhookPath: paypalWebhookPath,
      webhookModule: paypalWebhookModule,
      clientModule: paypalClientModule
    },
    database: typeof awRoadsideDbConfig.getPublicStatus === "function"
      ? {
          module: "awroadsidedb-config.mjs",
          ...awRoadsideDbConfig.getPublicStatus()
        }
      : null,
    watchdog: {
      module: "watchdog.mjs",
      active: true,
      intervalMs: watchdogIntervalMs,
      latestStatusPath: toRelativePath(path.join(runtimeRoot, "security", "latest-status.json"))
    },
    storage: typeof storageAuthority.getStatus === "function"
      ? {
          module: "db-index.mjs",
          ...storageAuthority.getStatus()
        }
      : null
  };
}

async function listFiles(rootDir) {
  const output = [];
  await walk(rootDir, rootDir, output);
  output.sort();
  return output;
}

function listRootRuntimeFiles() {
  return ROOT_RUNTIME_FILES.filter((fileName) => existsSync(path.join(projectRoot, fileName)));
}

async function walk(rootDir, currentDir, output) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walk(rootDir, fullPath, output);
      continue;
    }
    output.push(path.relative(rootDir, fullPath).replaceAll(path.sep, "/"));
  }
}

function applyHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Location-Zone, X-2FA-Verified, X-WP-Nonce"
  );
  res.setHeader("X-Backend-Authority", "awroadside-fire-secure");
}

function sendJson(res, statusCode, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function sendMethodNotAllowed(res, allowedMethod) {
  res.setHeader("Allow", allowedMethod);
  sendJson(res, 405, {
    error: "method-not-allowed",
    message: `Use ${allowedMethod} for this endpoint.`
  });
}

function sendNotFound(res, pathname) {
  const body = `Not found: ${pathname}\n`;
  res.writeHead(404, { 
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0"
  });
  res.end(body);
}

function resolveRuntimeEntryBuffer() {
  const candidate = globalThis.__AW_INDEX_RUNTIME_BUFFER__;
  if (
    candidate &&
    typeof candidate.retain === "function" &&
    typeof candidate.markProcessed === "function" &&
    typeof candidate.markRejected === "function"
  ) {
    return candidate;
  }
  return null;
}

function getRequestPathname(req) {
  try {
    return new URL(req?.url || "/", `http://${req?.headers?.host || "127.0.0.1"}`).pathname;
  } catch {
    return typeof req?.url === "string" ? req.url : "/";
  }
}

async function retainInboundPayload(req, payload, details = {}) {
  const method = typeof req?.method === "string" ? req.method.toUpperCase() : "";
  if (!["POST", "PUT", "PATCH"].includes(method)) {
    return null;
  }
  if (req.__awIndexReceipt) {
    return req.__awIndexReceipt;
  }
  const buffer = resolveRuntimeEntryBuffer();
  if (!buffer) {
    return null;
  }
  try {
    const receipt = await buffer.retain({
      pathname: getRequestPathname(req),
      method,
      payload,
      remoteAddress: typeof req?.socket?.remoteAddress === "string" ? req.socket.remoteAddress : null,
      userAgent: readHeader(req, "user-agent"),
      contentType: readHeader(req, "content-type"),
      details
    });
    req.__awIndexReceipt = receipt;
    return receipt;
  } catch (error) {
    console.warn(`[WARN] Failed to retain inbound payload in index buffer: ${error.message}`);
    return null;
  }
}

async function markInboundPayloadProcessed(req, details = {}) {
  const receipt = req?.__awIndexReceipt;
  const buffer = resolveRuntimeEntryBuffer();
  if (!receipt || !buffer) {
    return;
  }
  try {
    await buffer.markProcessed(receipt, {
      sink: "server.mjs",
      ...details
    });
  } catch (error) {
    console.warn(`[WARN] Failed to mark inbound payload processed: ${error.message}`);
  }
}

async function markInboundPayloadRejected(req, error, details = {}) {
  const receipt = req?.__awIndexReceipt;
  const buffer = resolveRuntimeEntryBuffer();
  if (!receipt || !buffer) {
    return;
  }
  try {
    await buffer.markRejected(receipt, error, {
      sink: "server.mjs",
      ...details
    });
  } catch (recordError) {
    console.warn(`[WARN] Failed to mark inbound payload rejected: ${recordError.message}`);
  }
}

async function readJsonBody(req) {
  const rawBody = await readRawBody(req);
  if (!rawBody) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawBody);
    await retainInboundPayload(req, parsed, {
      source: "readJsonBody",
      runtimeEntry: PUBLIC_RUNTIME_ENTRYPOINT
    });
    return parsed;
  } catch {
    await retainInboundPayload(req, {
      invalidJson: true,
      rawBody
    }, {
      source: "readJsonBody",
      runtimeEntry: PUBLIC_RUNTIME_ENTRYPOINT,
      invalidJson: true
    });
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    error.code = "invalid-json";
    await markInboundPayloadRejected(req, error, {
      route: getRequestPathname(req),
      invalidJson: true
    });
    throw error;
  }
}

async function readRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return "";
  }

  return Buffer.concat(chunks).toString("utf8");
}

function readHeader(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0].trim() : "";
  }
  return typeof value === "string" ? value.trim() : "";
}

function normalizeServiceRequest(payload) {
  const fullName = readRequiredString(payload.fullName, "fullName");
  const phoneNumber = readRequiredString(payload.phoneNumber, "phoneNumber");
  const serviceType = readRequiredString(payload.serviceType, "serviceType");
  const location = readRequiredString(payload.location, "location");
  const notes = readOptionalString(payload.notes);
  const requestId = readOptionalString(payload.requestId);
  const vehicleInfo = normalizeVehicleInfo(payload.vehicleInfo);
  const assignedProviderId = readOptionalString(payload.assignedProviderId);
  const userId = Number.isInteger(payload.userId) ? payload.userId : null;
  const roles = Array.isArray(payload.roles) ? payload.roles.filter((value) => typeof value === "string") : [];
  const subscriberActive = Boolean(payload.subscriberActive);
  const customerTier = resolveCustomerTier({ roles, subscriberActive });
  const pricing = resolveServicePricing({ roles, subscriberActive, customerTier });
  const termsAccepted = Boolean(
    payload.termsAccepted ||
    payload.subscriberTermsAccepted ||
    payload.guestTermsAccepted ||
    payload.dispatchOnlyLiabilityAccepted
  );
  const noRefundPolicyAccepted = Boolean(payload.noRefundPolicyAccepted || customerTier === "SUBSCRIBER");
  const dispatchOnlyLiabilityAccepted = Boolean(
    payload.dispatchOnlyLiabilityAccepted || customerTier === "SUBSCRIBER"
  );

  return {
    ...(requestId ? { requestId } : {}),
    ...(userId !== null ? { userId } : {}),
    ...(roles.length ? { roles } : {}),
    subscriberActive,
    customerTier,
    pricing,
    fullName,
    phoneNumber,
    serviceType,
    location,
    locationSummary: summarizeLocationForDispatch(location),
    notes,
    ...(vehicleInfo ? { vehicleInfo } : {}),
    ...(assignedProviderId ? { assignedProviderId } : {}),
    termsAccepted,
    noRefundPolicyAccepted,
    dispatchOnlyLiabilityAccepted,
    liabilityNotice: AW_ROADSIDE_POLICY.platform.holdHarmless,
    amount: {
      currency_code: "USD",
      value: priorityServicePrice.toFixed(2)
    }
  };
}

function summarizeLocationForDispatch(location) {
  const normalized = readOptionalString(location);
  if (!normalized) {
    return "Approximate service area pending.";
  }

  const segments = normalized.split(",").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length >= 2) {
    return segments.slice(-2).join(", ");
  }

  const withoutLeadingStreetNumber = normalized.replace(/^\d+\s+/, "").trim();
  if (withoutLeadingStreetNumber) {
    return `Area near ${withoutLeadingStreetNumber.slice(0, 32)}`;
  }

  return "Approximate service area pending.";
}

function resolveCustomerTier(request) {
  if (request?.customerTier === "SUBSCRIBER") {
    return "SUBSCRIBER";
  }
  if (Boolean(request?.subscriberActive)) {
    return "SUBSCRIBER";
  }
  if (Array.isArray(request?.roles) && request.roles.includes("SUBSCRIBER")) {
    return "SUBSCRIBER";
  }
  return "GUEST";
}

function resolveServicePricing(request) {
  const customerTier = resolveCustomerTier(request);
  const serviceCharge = customerTier === "SUBSCRIBER" ? subscriberServicePrice : guestServicePrice;
  const dispatchFee = customerTier === "SUBSCRIBER" ? subscriberDispatchFee : guestDispatchFee;
  const serviceChargeRate = AW_ROADSIDE_POLICY?.financial?.platformServiceChargeRate || 0.02;

  let platformShare;
  let providerPayout;

  if (customerTier === "SUBSCRIBER") {
    // Subscriber: $40 total - $5.50 assignment - 2% service rate
    const platformPercentageCharge = Number((serviceCharge * serviceChargeRate).toFixed(2));
    platformShare = assignmentFee + platformPercentageCharge;
    providerPayout = serviceCharge - platformShare;
  } else {
    // Guest: $55 total - $10 dispatch - $5.50 assignment = $39.50 payout
    platformShare = dispatchFee + assignmentFee;
    providerPayout = serviceCharge - platformShare;
  }

  return {
    customerTier,
    serviceCharge,
    dispatchFee,
    assignmentFee,
    platformShare,
    providerPayout,
    serviceTaxAmount: 0,
    providerTaxWithheld: false
  };
}

function readRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`Field "${fieldName}" is required.`);
    error.statusCode = 400;
    error.code = "validation-failed";
    throw error;
  }
  return value.trim();
}

function readOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readNumericValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getAuthorityPayload(req = null) {
  return {
    status: "ok",
    authority: buildAuthorityDescriptor(req)
  };
}

async function getHealthPayload(req = null) {
  return {
    status: "ok",
    service: SERVER_AUTHORITY.serviceId,
    timestamp: new Date().toISOString(),
    policyVersion: AW_ROADSIDE_POLICY.termsVersion,
    pricingSource: "server.mjs",
    authority: buildAuthorityDescriptor(req),
    locationServicesConfigured: locationService.isConfigured()
  };
}

function getLocationConfigPayload() {
  return {
    providerServiceRadiusMiles,
    requestAcceptanceWindowMinutes,
    mapbox: locationService.getConfig()
  };
}

async function resolveProviderLocationMetadata(payload = {}) {
  const currentLocation = readOptionalString(payload.currentLocation);
  const serviceArea = readOptionalString(payload.serviceArea);
  const metadata = {
    serviceRadiusMiles: providerServiceRadiusMiles
  };

  if (!locationService.isConfigured()) {
    return metadata;
  }

  if (currentLocation) {
    const currentLocationMatch = await tryForwardGeocode(currentLocation);
    if (currentLocationMatch) {
      metadata.currentLocationCoordinates = {
        longitude: currentLocationMatch.longitude,
        latitude: currentLocationMatch.latitude
      };
      metadata.currentLocationGeocodeSource = "mapbox-forward-geocode";
      metadata.currentLocationGeocodedAt = new Date().toISOString();
      metadata.currentLocationMapboxId = currentLocationMatch.mapboxId || null;
    }
  }

  if (serviceArea) {
    const serviceAreaMatch = await tryForwardGeocode(serviceArea);
    if (serviceAreaMatch) {
      metadata.serviceAreaCoordinates = {
        longitude: serviceAreaMatch.longitude,
        latitude: serviceAreaMatch.latitude
      };
      metadata.serviceAreaGeocodeSource = "mapbox-forward-geocode";
      metadata.serviceAreaGeocodedAt = new Date().toISOString();
      metadata.serviceAreaMapboxId = serviceAreaMatch.mapboxId || null;
    }
  }

  return metadata;
}

async function tryForwardGeocode(query) {
  try {
    const result = await locationService.forwardGeocode(query, { limit: 1, autocomplete: false });
    const match = Array.isArray(result.features) ? result.features[0] : null;
    const longitude = Number(match?.routableLongitude ?? match?.longitude);
    const latitude = Number(match?.routableLatitude ?? match?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return null;
    }
    return {
      longitude,
      latitude,
      mapboxId: match?.mapboxId || null
    };
  } catch {
    return null;
  }
}

async function getPaymentConfigPayload() {
  return {
    provider: "paypal",
    enabled: Boolean(paypalClientId && paypalClientSecret),
    clientId: paypalClientId || null,
    webhookId: paypalWebhookId || null,
    webhookPath: paypalWebhookPath,
    webhookUrl: `${publicBaseUrl}${paypalWebhookPath}`,
    webhookModule: paypalWebhookModule,
    clientModule: paypalClientModule,
    webhookConfigured: Boolean(paypalClientId && paypalClientSecret && paypalWebhookId),
    currency: "USD",
    intent: "CAPTURE",
    mode: paypalMode,
    priorityServicePrice,
    guestServicePrice,
    subscriberServicePrice,
    subscriberMonthlyFee,
    providerMonthlyFee,
    assignmentFee,
    guestDispatchFee,
    subscriberDispatchFee,
    noRefundPolicy: AW_ROADSIDE_POLICY.financial.noRefundsAfterPayment,
    dispatchOnlyLiability: AW_ROADSIDE_POLICY.platform.liability,
    walletDisplayTerms: AW_ROADSIDE_POLICY.financial.walletDisplayTerms,
    uiEventMap: AW_ROADSIDE_POLICY.uiEventMap
  };
}

async function sendSubscriberConfirmationEmail(payload) {
  const recipientEmail = readOptionalString(payload?.recipientEmail);
  const subject = readOptionalString(payload?.subject);
  const body = readOptionalString(payload?.body);
  if (!recipientEmail || !subject || !body) {
    return {
      deliveryStatus: "failed",
      deliveredAt: null,
      transport: "smtp",
      message: "Confirmation email payload is incomplete."
    };
  }
  return smtpMailer.sendTextEmail({
    to: recipientEmail,
    subject,
    text: body
  });
}

async function getUserProfile(userId) {
  const [users, requests] = await Promise.all([readUsers(), readDispatchRequestLog()]);
  const user = users.find((entry) => entry.id === Number(userId));
  if (!user) {
    throw new Error("User not found.");
  }

  const providerRating = calculateProviderRatingSummary(user);
  const providerSelection = calculateProviderSelectionSummary(user);
  const subscriberRequestHistory = buildSubscriberRequestHistory(user, requests, users);

  return {
    userId: user.id,
    fullName: user.fullName || "",
    username: user.username || "",
    email: user.email || "",
    phoneNumber: user.phoneNumber || "",
    roles: Array.isArray(user.roles) ? user.roles : [],
    providerStatus: user.providerStatus || null,
    providerProfile: user.providerProfile || null,
    providerMonthly: user.providerMonthly || providerMonthlyFee,
    services: Array.isArray(user.services) ? user.services : [],
    available: Boolean(user.available),
    activeShiftId: user.activeShiftId || null,
    providerRating,
    providerDiscipline: createProviderDisciplineSnapshot(user),
    providerSelection,
    subscriberActive: Boolean(user.subscriberActive),
    subscriberProfile: user.subscriberProfile || null,
    requestHistory: subscriberRequestHistory,
    requestHistoryCount: subscriberRequestHistory.length,
    savedVehicles: Array.isArray(user.subscriberProfile?.savedVehicles)
      ? user.subscriberProfile.savedVehicles
      : user.subscriberProfile?.vehicle
        ? [user.subscriberProfile.vehicle]
        : [],
    accountState: user.accountState || "ACTIVE",
    nextBillingDate: user.nextBillingDate || null,
    signUpDate: user.signUpDate || user.createdAt || null,
    terms: user.terms || {},
    trustedZone: user.trustedZone || null,
    createdAt: user.createdAt || null
  };
}

async function getProviderWalletPayload(userId) {
  const [users, requests] = await Promise.all([readUsers(), readDispatchRequestLog()]);
  const provider = users.find((entry) => Number(entry.id) === Number(userId));
  return createProviderWalletPayload({
    provider,
    requests,
    walletDisplayTerms: AW_ROADSIDE_POLICY.financial.walletDisplayTerms,
    normalizeProviderPaypalProfile
  });
}

function buildSubscriberRequestHistory(user, requests, users = []) {
  if (!Array.isArray(user?.roles) || !user.roles.includes("SUBSCRIBER")) {
    return [];
  }

  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  return (Array.isArray(requests) ? requests : [])
    .filter((request) => Number(request?.userId) === Number(user.id))
    .filter((request) => {
      const sourceDate = request?.submittedAt || request?.createdAt || request?.updatedAt || null;
      if (!sourceDate) {
        return true;
      }
      const parsed = new Date(sourceDate).getTime();
      return Number.isFinite(parsed) ? parsed >= oneYearAgo : true;
    })
    .map((request) => ({
      requestId: request.id || request.requestId || null,
      requestDate: request.submittedAt || request.createdAt || null,
      updatedAt: request.updatedAt || null,
      status: request.status || null,
      completionStatus: request.completionStatus || null,
      paymentStatus: request.paymentStatus || null,
      providerPayoutStatus: request.providerPayoutStatus || null,
      fullName: request.fullName || "",
      phoneNumber: request.phoneNumber || "",
      location: canCustomerSeeExactLocation(request, user.id) ? request.location || "" : request.locationSummary || "",
      exactLocation: canCustomerSeeExactLocation(request, user.id) ? request.location || "" : null,
      vehicleInfo: request.vehicleInfo || "",
      serviceType: request.serviceType || "",
      notes: request.notes || "",
      etaMinutes: readNumericValue(request.etaMinutes),
      softEtaMinutes: readNumericValue(request.softEtaMinutes),
      hardEtaMinutes: readNumericValue(request.hardEtaMinutes),
      etaStage: request.etaStage || null,
      assignedProviderId: request.assignedProviderId || null,
      directCommunicationEnabled: isDirectCommunicationUnlocked(request),
      customerCallbackNumber: request.phoneNumber || "",
      providerCallbackNumber: resolveAssignedProviderPhoneNumber(request, users, { actorRole: "SUBSCRIBER", userId: user.id }),
      locationDisclosureLevel: resolveLocationDisclosureLevel(request, { actorRole: "SUBSCRIBER", userId: user.id }),
      contactDisclosureLevel: resolveContactDisclosureLevel(request, { actorRole: "SUBSCRIBER", userId: user.id }),
      customerEtaAcceptedAt: request.customerEtaAcceptedAt || null,
      arrivalConfirmedAt: request.arrivalConfirmedAt || null,
      completionConfirmedAt: request.completionConfirmedAt || null,
      paymentPromptedAt: request.paymentPromptedAt || null,
      amountCharged: Number(request.amountCharged || 0),
      amountCollected: Number(request.amountCollected || 0),
      customerFeedback: normalizeRequestCustomerFeedback(request.customerFeedback)
    }))
    .sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.requestDate || 0).getTime();
      const rightTime = new Date(right.updatedAt || right.requestDate || 0).getTime();
      return rightTime - leftTime;
    });
}

function isPaymentCaptured(request) {
  return readOptionalString(request?.paymentStatus).toUpperCase() === "CAPTURED";
}

function isProviderActivated(request) {
  return Boolean(request?.providerActivatedAt || request?.hardContactedAt);
}

function isDirectCommunicationUnlocked(request) {
  return isPaymentCaptured(request) && isProviderActivated(request);
}

function canCustomerSeeExactLocation(request, userId) {
  return Number(request?.userId) === Number(userId);
}

function isGuestOwnerSession(request, session = {}) {
  return session?.ownsRequest === true && readOptionalString(session.actorRole).toUpperCase() === "GUEST";
}

function canProviderSeeExactLocation(request, userId) {
  return Number(request?.assignedProviderId) === Number(userId) && isDirectCommunicationUnlocked(request);
}

function resolveLocationDisclosureLevel(request, session = {}) {
  const actorRole = readOptionalString(session.actorRole).toUpperCase();
  if (actorRole === "ADMIN") {
    return "EXACT";
  }
  if (actorRole === "SUBSCRIBER" && canCustomerSeeExactLocation(request, session.userId)) {
    return "EXACT";
  }
  if (isGuestOwnerSession(request, session)) {
    return "EXACT";
  }
  if (actorRole === "PROVIDER" && canProviderSeeExactLocation(request, session.userId)) {
    return "EXACT";
  }
  return "MASKED";
}

function resolveContactDisclosureLevel(request, session = {}) {
  const actorRole = readOptionalString(session.actorRole).toUpperCase();
  if (actorRole === "ADMIN") {
    return "UNLOCKED";
  }
  if (actorRole === "SUBSCRIBER" && canCustomerSeeExactLocation(request, session.userId)) {
    return isDirectCommunicationUnlocked(request) ? "UNLOCKED" : "LOCKED";
  }
  if (isGuestOwnerSession(request, session)) {
    return isDirectCommunicationUnlocked(request) ? "UNLOCKED" : "LOCKED";
  }
  if (actorRole === "PROVIDER" && Number(request?.assignedProviderId) === Number(session.userId)) {
    return isDirectCommunicationUnlocked(request) ? "UNLOCKED" : "LOCKED";
  }
  return "LOCKED";
}

function resolveAssignedProviderPhoneNumber(request, users = [], session = {}) {
  if (!isDirectCommunicationUnlocked(request)) {
    return "";
  }
  if (readOptionalString(session.actorRole).toUpperCase() !== "SUBSCRIBER") {
    return "";
  }
  const provider = users.find((entry) => Number(entry.id) === Number(request?.assignedProviderId));
  return readOptionalString(provider?.phoneNumber);
}

async function presentRequestForSession(request, session = null) {
  const resolvedRequest = derivePresentedRequestState(request);
  const declaredActorRole = readOptionalString(session?.actorRole).toUpperCase();
  const actorRole = declaredActorRole || (session?.roles?.includes("ADMIN")
    ? "ADMIN"
    : session?.roles?.includes("PROVIDER")
      ? "PROVIDER"
      : session?.roles?.includes("SUBSCRIBER")
        ? "SUBSCRIBER"
        : "GUEST");
  const visibleLocationLevel = resolveLocationDisclosureLevel(resolvedRequest, {
    actorRole,
    userId: session?.userId || null,
    ownsRequest: session?.ownsRequest === true
  });
  const visibleContactLevel = resolveContactDisclosureLevel(resolvedRequest, {
    actorRole,
    userId: session?.userId || null,
    ownsRequest: session?.ownsRequest === true
  });
  const users = actorRole === "SUBSCRIBER" && isDirectCommunicationUnlocked(resolvedRequest)
    ? await readUsers()
    : [];
  const providerCallbackNumber = resolveAssignedProviderPhoneNumber(resolvedRequest, users, {
    actorRole,
    userId: session?.userId || null,
    ownsRequest: session?.ownsRequest === true
  });

  return {
    ...resolvedRequest,
    location: visibleLocationLevel === "EXACT" ? resolvedRequest.location || "" : resolvedRequest.locationSummary || "Exact location unlocks after payment.",
    exactLocation: visibleLocationLevel === "EXACT" ? resolvedRequest.location || "" : null,
    notes:
      visibleLocationLevel === "EXACT"
        ? resolvedRequest.notes || ""
        : resolvedRequest.maskedNotes || "Detailed customer notes unlock after payment and provider activation.",
    phoneNumber:
      visibleContactLevel === "UNLOCKED" || actorRole === "SUBSCRIBER" || isGuestOwnerSession(resolvedRequest, session || {})
        ? resolvedRequest.phoneNumber || ""
        : "Locked until payment and provider activation",
    customerCallbackNumber:
      visibleContactLevel === "UNLOCKED" || actorRole === "SUBSCRIBER" || isGuestOwnerSession(resolvedRequest, session || {})
        ? resolvedRequest.phoneNumber || ""
        : "",
    providerCallbackNumber,
    directCommunicationEnabled: isDirectCommunicationUnlocked(resolvedRequest),
    locationDisclosureLevel: visibleLocationLevel,
    contactDisclosureLevel: visibleContactLevel,
    softEtaMinutes: readNumericValue(resolvedRequest.softEtaMinutes),
    hardEtaMinutes: readNumericValue(resolvedRequest.hardEtaMinutes),
    etaStage: resolvedRequest.etaStage || null,
    customerFeedback: normalizeRequestCustomerFeedback(resolvedRequest.customerFeedback)
  };
}

async function presentRequestsForSession(requests, session = null) {
  return Promise.all((Array.isArray(requests) ? requests : []).map((request) => presentRequestForSession(request, session)));
}

async function filterRequestsForSession(requests, session = null) {
  const list = Array.isArray(requests) ? requests : [];
  if (!session?.roles?.includes("PROVIDER") || !session?.userId) {
    return list;
  }

  const users = await readUsers();
  const provider = users.find((entry) => Number(entry.id) === Number(session.userId));
  if (!provider) {
    return [];
  }

  return list.filter((request) => isRequestEligibleForProvider(request, provider));
}

function isRequestEligibleForProvider(request, provider) {
  const status = readOptionalString(request?.status).toUpperCase();
  if (!["SUBMITTED", "ASSIGNED", "EN_ROUTE", "ARRIVED"].includes(status)) {
    return false;
  }

  const providerId = Number(provider?.id);
  const assignedProviderId = Number(request?.assignedProviderId);
  if (Number.isInteger(assignedProviderId)) {
    if (assignedProviderId !== providerId) {
      return false;
    }
    if (status === "SUBMITTED") {
      return isProviderEligibleForPendingRequest(request, provider);
    }
    return true;
  }

  if (status !== "SUBMITTED") {
    return false;
  }

  return isProviderEligibleForPendingRequest(request, provider);
}

function isProviderEligibleForPendingRequest(request, provider, { ignoreExpiry = false } = {}) {
  const requestServiceType = readOptionalString(request?.serviceType).toUpperCase();
  const providerServices = Array.isArray(provider?.services)
    ? provider.services.map((value) => readOptionalString(value).toUpperCase()).filter(Boolean)
    : [];
  if (requestServiceType && providerServices.length && !providerServices.includes(requestServiceType)) {
    return false;
  }

  if (provider?.available !== true) {
    return false;
  }

  if (provider?.providerStatus !== "APPROVED" && provider?.providerStatus !== "ACTIVE") {
    return false;
  }

  if (!ignoreExpiry && isRequestAcceptanceExpired(request)) {
    return false;
  }

  return isProviderWithinCoverage(request, provider);
}

function isRequestAcceptanceExpired(request) {
  const expiry = readOptionalString(request?.requestAcceptanceExpiresAt);
  if (!expiry) {
    return false;
  }
  const time = new Date(expiry).getTime();
  return Number.isFinite(time) ? time < Date.now() : false;
}

function isPendingProviderAcceptanceRequest(request) {
  const status = readOptionalString(request?.status).toUpperCase();
  return status === "SUBMITTED";
}

function derivePresentedRequestState(request) {
  if (!isPendingProviderAcceptanceRequest(request) || !isRequestAcceptanceExpired(request)) {
    return request;
  }

  return {
    ...request,
    status: "EXPIRED",
    completionStatus: "EXPIRED",
    expiredAt: request?.expiredAt || request?.requestAcceptanceExpiresAt || new Date().toISOString()
  };
}

function getRequestAcceptanceWindowForRequest(request) {
  const minutes = Number.parseFloat(request?.requestAcceptanceWindowMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : requestAcceptanceWindowMinutes;
}

function getRequestRequeueCount(request) {
  const value = Number.parseInt(request?.dispatchRequeueCount, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function listEligibleProvidersForPendingRequest(request, users = [], options = {}) {
  return (Array.isArray(users) ? users : []).filter((provider) => {
    return Array.isArray(provider?.roles) &&
      provider.roles.includes("PROVIDER") &&
      isProviderEligibleForPendingRequest(request, provider, options);
  });
}

function reconcilePendingRequestWindows(requests, users = []) {
  let changed = false;
  const now = new Date().toISOString();

  const nextRequests = (Array.isArray(requests) ? requests : []).map((request) => {
    if (!isPendingProviderAcceptanceRequest(request) || !isRequestAcceptanceExpired(request)) {
      return request;
    }

    const requeueCount = getRequestRequeueCount(request);
    const eligibleProviders = listEligibleProvidersForPendingRequest(request, users, { ignoreExpiry: true });
    if (eligibleProviders.length > 0 && requeueCount < requestAcceptanceRequeueLimit) {
      changed = true;
      return {
        ...request,
        assignedProviderId: null,
        acceptedAt: null,
        requestAcceptanceExpiresAt: addMinutes(now, getRequestAcceptanceWindowForRequest(request)),
        dispatchRequeueCount: requeueCount + 1,
        lastRequeuedAt: now,
        expiredAt: null,
        updatedAt: now
      };
    }

    changed = true;
    return {
      ...request,
      status: "EXPIRED",
      completionStatus: "EXPIRED",
      assignedProviderId: null,
      acceptedAt: null,
      expiredAt: request?.expiredAt || request?.requestAcceptanceExpiresAt || now,
      updatedAt: now
    };
  });

  return {
    changed,
    requests: nextRequests
  };
}

function isProviderWithinCoverage(request, provider) {
  const requestCoordinates = normalizeCoordinateRecord(request?.locationCoordinates);
  const providerCoordinates =
    normalizeCoordinateRecord(provider?.providerProfile?.currentLocationCoordinates) ||
    normalizeCoordinateRecord(provider?.providerProfile?.serviceAreaCoordinates);

  if (requestCoordinates && providerCoordinates) {
    return locationService.isWithinRadius(providerCoordinates, requestCoordinates, providerServiceRadiusMiles);
  }

  const requestLocation = readOptionalString(request?.locationFullAddress || request?.location || request?.locationSummary).toLowerCase();
  const serviceArea = readOptionalString(provider?.providerProfile?.serviceArea).toLowerCase();
  const currentLocation = readOptionalString(provider?.providerProfile?.currentLocation).toLowerCase();

  if (!requestLocation) {
    return false;
  }

  if (serviceArea && requestLocation.includes(serviceArea)) {
    return true;
  }
  if (currentLocation && requestLocation.includes(currentLocation)) {
    return true;
  }

  return false;
}

async function getFrontendConfigPayload(req = null) {
  const baseUrl = resolveRequestBaseUrl(req);
  const uiBaseUrl = webRoot ? baseUrl : null;
  return {
    authority: buildAuthorityDescriptor(req),
    apiBaseUrl: getProtectedApiBaseUrl(req),
    apiModule: "aw-roadside-security.mjs",
    adminApiBaseUrl: `${baseUrl}${ADMIN_API_BASE_PATH}`,
    adminApiModule: "admin-controller.mjs",
    rawApiBaseUrl: `${baseUrl}${RAW_API_BASE_PATH}`,
    rawApiModule: PUBLIC_RUNTIME_ENTRYPOINT,
    locationConfigUrl: `${getProtectedApiBaseUrl(req)}/location/config`,
    uiBaseUrl,
    expectedHtmlIntegrationPath: null,
    syncMode: "api",
    runtimeFolder: null,
    runtimeEntry: PUBLIC_RUNTIME_ENTRYPOINT,
    paypalEnabled: Boolean(paypalClientId && paypalClientSecret),
    priorityServicePrice,
    serviceBasePrice,
    guestServicePrice,
    subscriberServicePrice,
    subscriberMonthlyFee,
    providerMonthlyFee,
    publicPricingVisible,
    showInternalPreviewData,
    assignmentFee,
    guestDispatchFee,
    subscriberDispatchFee,
    noRefundPolicy: AW_ROADSIDE_POLICY.financial.noRefundsAfterPayment,
    walletDisplayTerms: AW_ROADSIDE_POLICY.financial.walletDisplayTerms,
    uiEventMap: AW_ROADSIDE_POLICY.uiEventMap,
    policyVersion: AW_ROADSIDE_POLICY.termsVersion,
    compatibilityGatewayUrl: `${baseUrl}/compatibility-gateway.mjs/status`,
    compatibilityManifestUrl: `${baseUrl}/compatibility-gateway.mjs/manifest`,
    compatibilityRepositoryUrl: `${baseUrl}/compatibility-gateway.mjs/repository`,
    securityLayer: "aw-roadside-security.mjs"
  };
}

function createServicePaymentQuote(request) {
  const requestId = readOptionalString(request?.requestId || request?.id);
  if (!requestId) {
    throw new Error("A backend requestId is required before service payment.");
  }

  const etaMinutes = readNumericValue(request?.softEtaMinutes ?? request?.etaMinutes);
  const status = readOptionalString(request?.status).toUpperCase();
  if (etaMinutes === null) {
    const error = new Error("Service payment is locked until a provider soft ETA is recorded.");
    error.statusCode = 409;
    error.code = "hard-eta-required";
    throw error;
  }
  if (!request?.customerEtaAcceptedAt) {
    const error = new Error("Service payment is locked until the customer accepts the soft ETA.");
    error.statusCode = 409;
    error.code = "customer-eta-acceptance-required";
    throw error;
  }

  const pricing = resolveServicePricing(request);

  return {
    quoteId: `service:${requestId}:${status || "ETA"}:${etaMinutes ?? "confirmed"}:${pricing.serviceCharge.toFixed(2)}`,
    requestId,
    paymentKind: "service",
    serviceType: request.serviceType || "Roadside Service",
    status,
    etaMinutes,
    customerTier: pricing.customerTier,
    pricing,
    amount: {
      currency_code: "USD",
      value: pricing.serviceCharge.toFixed(2)
    },
    priceSource: "backend",
    agreementRequired: true,
    noRefundPolicy: AW_ROADSIDE_POLICY.subscriber.noRefundPolicy,
    platformLiability: AW_ROADSIDE_POLICY.platform.liability,
    providerLiability: AW_ROADSIDE_POLICY.provider.liabilityStatement,
    terms:
      "Service payment can be created only after the backend records a provider soft ETA and the customer accepts this backend quote."
  };
}

function normalizeServicePaymentRequest(payload, request, quote) {
  if (payload?.quoteAccepted !== true) {
    const error = new Error("Customer must accept the backend service quote before service payment.");
    error.statusCode = 409;
    error.code = "service-quote-not-accepted";
    throw error;
  }
  if (payload?.quoteId !== quote.quoteId) {
    const error = new Error("Service payment quote does not match the current backend quote.");
    error.statusCode = 409;
    error.code = "service-quote-mismatch";
    throw error;
  }

  return {
    fullName: readOptionalString(request.fullName) || "Roadside Customer",
    phoneNumber: readOptionalString(request.phoneNumber),
    serviceType: request.serviceType || "Roadside Service",
    location: request.location || "",
    notes: request.notes || "",
    amount: quote.amount,
    requestId: quote.requestId,
    paymentKind: "service",
    quoteId: quote.quoteId
  };
}

function getIntegrationTargetPayload(req = null) {
  const baseUrl = resolveRequestBaseUrl(req);
  return {
    status: "ready",
    message: "Use the AW Roadside runtime API entry and protected API.",
    authority: buildAuthorityDescriptor(req),
    expectedPayload: {
      runtimeEntry: PUBLIC_RUNTIME_ENTRYPOINT,
      apiHealthUrl: `${getProtectedApiBaseUrl(req)}/health`
    },
    expectedHtmlIntegrationPath: null,
    uiBaseUrl: baseUrl,
    apiBaseUrl: getProtectedApiBaseUrl(req),
    apiModule: "aw-roadside-security.mjs",
    adminApiBaseUrl: `${baseUrl}${ADMIN_API_BASE_PATH}`,
    adminApiModule: "admin-controller.mjs",
    rawApiBaseUrl: `${baseUrl}${RAW_API_BASE_PATH}`,
    rawApiModule: PUBLIC_RUNTIME_ENTRYPOINT,
    locationConfigUrl: `${getProtectedApiBaseUrl(req)}/location/config`,
    policyVersion: AW_ROADSIDE_POLICY.termsVersion
  };
}

function normalizeVehicleInfo(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const parts = [value.year, value.make, value.model, value.color]
    .map((entry) => readOptionalString(entry))
    .filter(Boolean);
  return parts.join(" ").trim();
}

function getProtectedApiBaseUrl(req = null) {
  return `${resolveRequestBaseUrl(req)}${resolveProtectedApiBasePath(req)}`;
}

function normalizeRawApiPath(pathname) {
  if (typeof pathname !== "string" || !pathname) {
    return null;
  }

  for (const prefix of RAW_API_BASE_PATH_ALIASES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return `${RAW_API_BASE_PATH}${pathname.slice(prefix.length)}`;
    }
  }

  return null;
}

function resolveProtectedApiBasePath(req = null) {
  return PROTECTED_API_BASE_PATH;
}

function resolveRequestBaseUrl(req = null) {
  if (req?.headers?.host) {
    const protoHeader = req.headers["x-forwarded-proto"];
    const proto = typeof protoHeader === "string" && protoHeader.trim() ? protoHeader.trim().split(",")[0] : "http";
    return `${proto}://${req.headers.host}`;
  }
  return publicBaseUrl;
}

function resolvePublicBaseUrl() {
  const configuredBaseUrl = (process.env.PUBLIC_BASE_URL || "https://awroadside-fire-backend.onrender.com").trim().replace(/\/$/, "");
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const fallbackHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  return `http://${fallbackHost}:${port}`;
}

function isPublicBaseUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }
    return !["0.0.0.0", "127.0.0.1", "localhost"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function resolveRuntimeRoot() {
  const configuredRuntimeRoot = (process.env.RUNTIME_ROOT || "").trim();
  const blueprintRuntimeRoot = normalizeYamlScalar(blueprintNodeContract.runtimeRoot);
  const selectedRuntimeRoot = configuredRuntimeRoot || blueprintRuntimeRoot;
  if (!selectedRuntimeRoot) {
    return path.join(appRoot, "runtime");
  }

  return path.isAbsolute(selectedRuntimeRoot)
    ? selectedRuntimeRoot
    : path.resolve(projectRoot, selectedRuntimeRoot);
}

async function auditBlueprintNodeRuntime() {
  const issues = [];
  const expectedRuntime = normalizeYamlScalar(blueprintNodeContract.runtime).toLowerCase();
  const expectedNodeVersion = normalizeYamlScalar(blueprintNodeContract.nodeVersion);

  if (expectedRuntime && expectedRuntime !== "node") {
    issues.push(`Blueprint runtime is ${expectedRuntime}, expected node.`);
  }

  if (expectedNodeVersion && !matchesNodeVersionSpec(process.version, expectedNodeVersion)) {
    issues.push(`Running Node ${process.version} does not match Blueprint NODE_VERSION ${expectedNodeVersion}.`);
  }

  if (issues.length === 0) {
    return;
  }

  for (const issue of issues) {
    console.error("[WARN]", issue);
  }

  try {
    await watchdog.record("blueprint-node-mismatch", {
      runtime: process.release?.name || "node",
      runningNodeVersion: process.version,
      expectedRuntime: expectedRuntime || null,
      expectedNodeVersion: expectedNodeVersion || null,
      issues
    });
  } catch (error) {
    console.error("[WARN] Failed to record Blueprint node mismatch:", error);
  }
}

function matchesNodeVersionSpec(version, spec) {
  const currentMajor = extractMajorVersion(version);
  const normalizedSpec = String(spec || "").trim();
  if (!Number.isInteger(currentMajor) || !normalizedSpec) {
    return true;
  }

  const exactMajorMatch = normalizedSpec.match(/^v?(\d+)(?:\.x)?$/i);
  if (exactMajorMatch) {
    return currentMajor === Number.parseInt(exactMajorMatch[1], 10);
  }

  const lowerBoundMatch = normalizedSpec.match(/>=\s*(\d+)/);
  const upperBoundMatch = normalizedSpec.match(/<\s*(\d+)/);
  if (lowerBoundMatch || upperBoundMatch) {
    const lowerBound = lowerBoundMatch ? Number.parseInt(lowerBoundMatch[1], 10) : Number.NEGATIVE_INFINITY;
    const upperBound = upperBoundMatch ? Number.parseInt(upperBoundMatch[1], 10) : Number.POSITIVE_INFINITY;
    return currentMajor >= lowerBound && currentMajor < upperBound;
  }

  return true;
}

function extractMajorVersion(version) {
  const match = String(version || "").match(/v?(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
}

async function saveProviderDocuments(userId, currentDocuments = {}, documentsPayload = {}) {
  if (!Number.isInteger(Number(userId))) {
    throw new Error("A valid provider userId is required for document storage.");
  }

  const normalizedCurrent = normalizeStoredProviderDocuments(currentDocuments);
  const nextDocuments = { ...normalizedCurrent };
  const userDocumentsRoot = path.join(providerDocumentsRoot, `${Number(userId)}`);
  try {
    if (!existsSync(userDocumentsRoot)) {
      await fs.mkdir(userDocumentsRoot, { recursive: true });
    }
  } catch (error) {
    console.warn(`[WARN] Failed to create userDocumentsRoot ${userDocumentsRoot}:`, error.message);
  }

  for (const docType of PROVIDER_DOCUMENT_TYPES) {
    if (!(docType in documentsPayload)) {
      continue;
    }

    const nextValue = documentsPayload[docType];
    const previous = normalizedCurrent[docType];
    nextDocuments[docType] = await storeSingleProviderDocument(userDocumentsRoot, docType, nextValue, previous);
  }

  return nextDocuments;
}

function normalizeStoredProviderDocuments(documents = {}) {
  const normalized = {};
  for (const docType of PROVIDER_DOCUMENT_TYPES) {
    normalized[docType] = normalizeStoredProviderDocument(documents?.[docType]);
  }
  return normalized;
}

function normalizeStoredProviderDocument(value) {
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

  if (typeof value !== "object") {
    return normalizeStoredProviderDocument(Boolean(value));
  }

  return {
    submitted: Boolean(value.submitted ?? value.uploadedAt ?? value.fileName ?? value.storagePath ?? value.sourceUrl),
    verified: Boolean(value.verified),
    uploadedAt: optionalIsoString(value.uploadedAt),
    fileName: optionalString(value.fileName) || null,
    contentType: optionalString(value.contentType) || null,
    sizeBytes: Number.isFinite(Number(value.sizeBytes)) ? Number(value.sizeBytes) : 0,
    storagePath: optionalString(value.storagePath) || null,
    sourceUrl: optionalString(value.sourceUrl) || null,
    documentNumber: optionalString(value.documentNumber) || null,
    expiresAt: optionalIsoString(value.expiresAt),
    note: optionalString(value.note) || null
  };
}

async function storeSingleProviderDocument(userDocumentsRoot, docType, value, previous) {
  const normalizedPrevious = normalizeStoredProviderDocument(previous);
  const now = new Date().toISOString();

  if (value === false || value === null) {
    return normalizeStoredProviderDocument(false);
  }

  if (value === true) {
    return {
      ...normalizedPrevious,
      submitted: true,
      uploadedAt: normalizedPrevious.uploadedAt || now
    };
  }

  if (!value || typeof value !== "object") {
    return {
      ...normalizedPrevious,
      submitted: Boolean(value),
      uploadedAt: Boolean(value) ? normalizedPrevious.uploadedAt || now : null
    };
  }

  const nextDocument = {
    ...normalizedPrevious,
    submitted: value.submitted !== false,
    verified: Boolean(value.verified ?? normalizedPrevious.verified),
    uploadedAt: now,
    fileName: optionalString(value.fileName) || normalizedPrevious.fileName,
    contentType: optionalString(value.contentType) || normalizedPrevious.contentType,
    sizeBytes: Number.isFinite(Number(value.sizeBytes)) ? Number(value.sizeBytes) : normalizedPrevious.sizeBytes,
    sourceUrl: optionalString(value.sourceUrl) || normalizedPrevious.sourceUrl,
    documentNumber: optionalString(value.documentNumber) || normalizedPrevious.documentNumber,
    expiresAt: optionalIsoString(value.expiresAt) || normalizedPrevious.expiresAt,
    note: optionalString(value.note) || normalizedPrevious.note,
    storagePath: normalizedPrevious.storagePath
  };

  const binaryPayload = readDocumentBinaryPayload(value);
  validateProviderDocumentFormat(nextDocument.fileName, nextDocument.contentType, binaryPayload?.contentType || null);
  if (binaryPayload) {
    const extension = resolveProviderDocumentExtension(nextDocument.fileName, nextDocument.contentType, binaryPayload.contentType);
    const storedFileName = `${docType}${extension}`;
    const storedPath = path.join(userDocumentsRoot, storedFileName);
    await fs.writeFile(storedPath, binaryPayload.buffer);
    nextDocument.fileName = nextDocument.fileName || storedFileName;
    nextDocument.contentType = nextDocument.contentType || binaryPayload.contentType;
    nextDocument.sizeBytes = binaryPayload.buffer.byteLength;
    nextDocument.storagePath = path.relative(runtimeRoot, storedPath).replaceAll(path.sep, "/");
  }

  return nextDocument;
}

function readDocumentBinaryPayload(value) {
  const explicitBase64 = optionalString(value.dataBase64 || value.base64);
  if (explicitBase64) {
    return {
      buffer: Buffer.from(explicitBase64, "base64"),
      contentType: optionalString(value.contentType) || "application/octet-stream"
    };
  }

  const dataUrl = optionalString(value.dataUrl);
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    buffer: Buffer.from(match[2], "base64"),
    contentType: match[1]
  };
}

function resolveProviderDocumentExtension(fileName, contentType, fallbackContentType) {
  const explicitExtension = path.extname(optionalString(fileName)).trim();
  if (explicitExtension) {
    const normalizedExtension = explicitExtension.toLowerCase();
    if (normalizedExtension === ".txt" || normalizedExtension === ".jpeg") {
      return normalizedExtension;
    }
    throw new Error("Provider documents must use .txt or .jpeg files only.");
  }

  const resolvedContentType = optionalString(contentType) || optionalString(fallbackContentType);
  if (ALLOWED_PROVIDER_DOCUMENT_CONTENT_TYPES.has(resolvedContentType)) {
    return ALLOWED_PROVIDER_DOCUMENT_CONTENT_TYPES.get(resolvedContentType);
  }
  throw new Error("Provider documents must use text/plain or image/jpeg content only.");
}

function optionalIsoString(value) {
  const normalized = readOptionalString(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function optionalString(value) {
  return readOptionalString(value);
}

function validateProviderDocumentFormat(fileName, contentType, fallbackContentType) {
  const normalizedFileName = optionalString(fileName);
  const normalizedContentType = optionalString(contentType) || optionalString(fallbackContentType);
  const explicitExtension = path.extname(normalizedFileName).trim().toLowerCase();

  if (normalizedContentType && !ALLOWED_PROVIDER_DOCUMENT_CONTENT_TYPES.has(normalizedContentType)) {
    throw new Error("Provider documents must be uploaded as text/plain or image/jpeg only.");
  }

  if (explicitExtension && explicitExtension !== ".txt" && explicitExtension !== ".jpeg") {
    throw new Error("Provider documents must use .txt or .jpeg files only.");
  }

  if (explicitExtension && normalizedContentType) {
    const expectedExtension = ALLOWED_PROVIDER_DOCUMENT_CONTENT_TYPES.get(normalizedContentType);
    if (expectedExtension && explicitExtension !== expectedExtension) {
      throw new Error("Provider document file extension does not match the uploaded content type.");
    }
  }
}


async function createPaypalOrder(serviceRequest) {
  return paypal.createOrder({
    description: `${serviceRequest.paymentKind === "service" ? "Roadside service payment" : "Priority roadside service"} - ${serviceRequest.serviceType}`,
    amount: serviceRequest.amount,
    customId: serviceRequest.requestId || `${serviceRequest.phoneNumber}:${serviceRequest.serviceType}`
  });
}

async function capturePaypalOrder(orderId) {
  return paypal.captureOrder(orderId);
}

async function applyPaypalWebhookEvent(webhookEvent) {
  const eventType = readOptionalString(webhookEvent?.event_type).toUpperCase();
  if (!eventType) {
    return {
      matched: false,
      applied: false,
      note: "missing-event-type"
    };
  }

  if (eventType.startsWith("BILLING.SUBSCRIPTION.")) {
    return applyPaypalSubscriptionWebhook(webhookEvent, eventType);
  }

  if (isPaypalProviderWebhookEvent(eventType)) {
    return applyPaypalProviderWebhook(webhookEvent, eventType);
  }

  if (
    eventType.startsWith("PAYMENT.CAPTURE.") ||
    eventType.startsWith("PAYMENT.REFUND.") ||
    eventType.startsWith("PAYMENT.SALE.") ||
    eventType === "PAYMENT.ORDER.CANCELLED"
  ) {
    return applyPaypalPaymentWebhook(webhookEvent, eventType);
  }

  return {
    matched: false,
    applied: false,
    note: "ignored-event-type"
  };
}

function isPaypalProviderWebhookEvent(eventType) {
  return (
    eventType.startsWith("CUSTOMER.ACCOUNT-ENTITIES.") ||
    eventType.startsWith("CUSTOMER.PARTNER-") ||
    eventType.startsWith("PAYMENT.PAYOUTSBATCH.") ||
    eventType.startsWith("PAYMENT.PAYOUTS-ITEM.") ||
    eventType.startsWith("PAYMENTS.CUSTOMER-PAYOUTS.")
  );
}

async function applyPaypalSubscriptionWebhook(webhookEvent, eventType) {
  const resource = normalizePaypalResource(webhookEvent?.resource);
  const matchedUser = await findUserForPaypalSubscription(resource);
  if (!matchedUser) {
    return {
      matched: false,
      applied: false,
      note: "subscriber-not-found"
    };
  }

  const now = new Date().toISOString();
  const subscriptionId = readOptionalString(resource.id);
  const nextBillingDate = resolvePaypalNextBillingDate(resource);
  const resourceStatus = readOptionalString(resource.status).toUpperCase();
  const subscriptionState = mapPaypalSubscriptionState(eventType, resourceStatus);

  const updatedUser = await mutateUsers(async (users) => {
    const user = users.find((entry) => Number(entry.id) === Number(matchedUser.id));
    if (!user) {
      throw new Error(`User ${matchedUser.id} was not found for PayPal webhook processing.`);
    }

    const existingSubscriberProfile = user.subscriberProfile && typeof user.subscriberProfile === "object"
      ? user.subscriberProfile
      : {};
    const existingPaymentInfo = existingSubscriberProfile.paymentInfo && typeof existingSubscriberProfile.paymentInfo === "object"
      ? existingSubscriberProfile.paymentInfo
      : {};

    user.subscriberActive = subscriptionState.active;
    user.accountState = subscriptionState.accountState;
    user.nextBillingDate = nextBillingDate || user.nextBillingDate || null;
    user.subscriberProfile = {
      ...existingSubscriberProfile,
      paymentInfo: {
        ...existingPaymentInfo,
        paymentProvider: "paypal"
      },
      paypalSubscriptionId: subscriptionId || existingSubscriberProfile.paypalSubscriptionId || null,
      paypalPlanId: readOptionalString(resource.plan_id) || existingSubscriberProfile.paypalPlanId || null,
      paypalStatus: subscriptionState.profileStatus,
      paypalSubscriberEmail:
        readOptionalString(resource?.subscriber?.email_address) ||
        existingSubscriberProfile.paypalSubscriberEmail ||
        user.email ||
        null,
      lastPaypalWebhookEventId: readOptionalString(webhookEvent.id) || existingSubscriberProfile.lastPaypalWebhookEventId || null,
      lastPaypalWebhookEventType: eventType,
      lastPaypalWebhookAt: now,
      lastPaymentFailureAt:
        eventType === "BILLING.SUBSCRIPTION.PAYMENT.FAILED"
          ? now
          : existingSubscriberProfile.lastPaymentFailureAt || null
    };
    user.subscriptionStatus = subscriptionState.profileStatus;
    return user;
  });

  return {
    matched: true,
    applied: true,
    targetType: "user",
    targetId: String(updatedUser.id),
    note: subscriptionState.profileStatus
  };
}

async function applyPaypalProviderWebhook(webhookEvent, eventType) {
  if (
    eventType.startsWith("PAYMENT.PAYOUTSBATCH.") ||
    eventType.startsWith("PAYMENT.PAYOUTS-ITEM.") ||
    eventType.startsWith("PAYMENTS.CUSTOMER-PAYOUTS.")
  ) {
    return applyPaypalProviderPayoutWebhook(webhookEvent, eventType);
  }

  return applyPaypalProviderAccountWebhook(webhookEvent, eventType);
}

async function applyPaypalProviderAccountWebhook(webhookEvent, eventType) {
  const resource = normalizePaypalResource(webhookEvent?.resource);
  const matchedProvider = await findProviderForPaypalEvent(resource);
  if (!matchedProvider) {
    return {
      matched: false,
      applied: false,
      note: "provider-not-found"
    };
  }

  const updatedProvider = await mutateUsers(async (users) => {
    const provider = users.find((entry) => Number(entry.id) === Number(matchedProvider.id));
    if (!provider) {
      throw new Error(`Provider ${matchedProvider.id} was not found for PayPal webhook processing.`);
    }

    const existingProviderProfile = provider.providerProfile && typeof provider.providerProfile === "object"
      ? provider.providerProfile
      : {};
    const paypalState = normalizeProviderPaypalProfile(existingProviderProfile.paypal);
    const identifiers = extractProviderPaypalIdentifiers(resource);
    const now = new Date().toISOString();

    const nextPaypal = {
      ...paypalState,
      providerAccountId: identifiers.providerAccountId || paypalState.providerAccountId || null,
      accountId: identifiers.accountId || paypalState.accountId || null,
      trackingId: identifiers.trackingId || paypalState.trackingId || null,
      payerId: identifiers.payerId || paypalState.payerId || null,
      email:
        identifiers.email ||
        paypalState.email ||
        readOptionalString(provider?.providerProfile?.providerInfo?.email) ||
        readOptionalString(provider.email) ||
        null,
      lastWebhookEventId: readOptionalString(webhookEvent.id) || paypalState.lastWebhookEventId || null,
      lastWebhookEventType: eventType,
      lastWebhookAt: now
    };

    // MERCHANT onboarding events in PayPal refer to the Partner/Provider being linked for payouts
    if (eventType === "MERCHANT.ONBOARDING.COMPLETED") {
      nextPaypal.onboardingStatus = "COMPLETED";
      nextPaypal.consentStatus = "GRANTED";
      nextPaypal.onboardingCompletedAt = now;
    } else if (eventType === "MERCHANT.PARTNER-CONSENT.REVOKED") {
      nextPaypal.consentStatus = "REVOKED";
      nextPaypal.partnerConsentRevokedAt = now;
    } else if (eventType === "CUSTOMER.ACCOUNT-ENTITIES.ACCOUNT-CREATED") {
      nextPaypal.accountLifecycleStatus = "CREATED";
      nextPaypal.accountCreatedAt = now;
    } else if (
      eventType === "CUSTOMER.ACCOUNT-ENTITIES.ACCOUNT-UPDATED" ||
      eventType === "CUSTOMER.ACCOUNT-ENTITIES.ACCOUNT-SETTINGS-UPDATED"
    ) {
      nextPaypal.accountLifecycleStatus = "UPDATED";
      nextPaypal.lastAccountUpdateAt = now;
    } else if (eventType === "CUSTOMER.ACCOUNT-ENTITIES.ACCOUNT-LIMITS") {
      nextPaypal.accountLimits = extractPaypalAccountLimits(resource);
      nextPaypal.lastAccountLimitEventAt = now;
    } else if (eventType === "CUSTOMER.ACCOUNT-ENTITIES.CAPABILITY-UPDATED") {
      nextPaypal.capabilities = extractPaypalCapabilities(resource, paypalState.capabilities);
      nextPaypal.lastCapabilityUpdateAt = now;
    } else if (eventType === "CUSTOMER.ACCOUNT-ENTITIES.REQUIREMENTS-UPDATED") {
      nextPaypal.requirements = extractPaypalRequirements(resource, paypalState.requirements);
      nextPaypal.lastRequirementsUpdateAt = now;
    } else if (
      eventType === "CUSTOMER.ACCOUNT-ENTITIES.BANK-ACCOUNTS.CREATED" ||
      eventType === "CUSTOMER.ACCOUNT-ENTITIES.BANK-ACCOUNTS.UPDATED" ||
      eventType === "CUSTOMER.ACCOUNT-ENTITIES.BANK-ACCOUNTS.REMOVED"
    ) {
      nextPaypal.bankAccounts = extractPaypalBankAccounts(resource, paypalState.bankAccounts, eventType, now);
    } else if (
      eventType === "CUSTOMER.ACCOUNT-ENTITIES.STAKEHOLDERS.CREATED" ||
      eventType === "CUSTOMER.ACCOUNT-ENTITIES.STAKEHOLDERS.UPDATED" ||
      eventType === "CUSTOMER.ACCOUNT-ENTITIES.STAKEHOLDERS.REMOVED"
    ) {
      nextPaypal.stakeholders = extractPaypalStakeholders(resource, paypalState.stakeholders, eventType, now);
    } else if (eventType === "CUSTOMER.PARTNER-BALANCE.CHANGED") {
      nextPaypal.partnerBalance = extractPaypalPartnerBalance(resource, paypalState.partnerBalance, now);
    } else if (eventType === "CUSTOMER.PARTNER-FINANCIAL-ACCOUNT.DEBITED") {
      nextPaypal.lastPartnerFinancialDebit = extractPaypalPartnerFinancialDebit(resource, now);
    }

    nextPaypal.recentEvents = pushProviderPaypalEvent(
      paypalState.recentEvents,
      buildProviderPaypalEventSummary(webhookEvent, eventType, resource, now)
    );

    provider.providerProfile = {
      ...existingProviderProfile,
      paypal: nextPaypal
    };

    if (eventType === "MERCHANT.ONBOARDING.COMPLETED" && !provider.providerStatus) {
      provider.providerStatus = "PENDING_APPROVAL";
    }

    return provider;
  });

  return {
    matched: true,
    applied: true,
    targetType: "user",
    targetId: String(updatedProvider.id),
    note: eventType
  };
}

async function applyPaypalProviderPayoutWebhook(webhookEvent, eventType) {
  const resource = normalizePaypalResource(webhookEvent?.resource);
  const matchedRequest = await findRequestForPaypalPayout(resource);
  const matchedProvider = await findProviderForPaypalPayout(resource, matchedRequest);

  if (!matchedRequest && !matchedProvider) {
    return {
      matched: false,
      applied: false,
      note: "provider-payout-not-found"
    };
  }

  const payoutStatus = mapPaypalProviderPayoutStatus(eventType);
  const payoutIdentifiers = extractPaypalPayoutIdentifiers(resource);
  const now = new Date().toISOString();

  if (matchedRequest) {
    await updateRequestRecord(matchedRequest.requestId || matchedRequest.id, (request) => {
      const next = {
        providerPayoutStatus: payoutStatus.requestStatus,
        payoutBatchId: payoutIdentifiers.batchId || request.payoutBatchId || null,
        payoutItemId: payoutIdentifiers.itemId || request.payoutItemId || null,
        payoutCustomerId: payoutIdentifiers.customerPayoutId || request.payoutCustomerId || null,
        payoutReference:
          payoutIdentifiers.itemId ||
          payoutIdentifiers.batchId ||
          payoutIdentifiers.customerPayoutId ||
          request.payoutReference ||
          null,
        payoutLastEventId: readOptionalString(webhookEvent.id) || request.payoutLastEventId || null,
        payoutLastEventType: eventType,
        payoutLastEventAt: now
      };

      if (payoutStatus.completed) {
        next.payoutCompletedAt = now;
      }

      return next;
    });
  }

  let updatedProvider = matchedProvider;
  if (matchedProvider) {
    updatedProvider = await mutateUsers(async (users) => {
      const provider = users.find((entry) => Number(entry.id) === Number(matchedProvider.id));
      if (!provider) {
        throw new Error(`Provider ${matchedProvider.id} was not found for PayPal payout webhook processing.`);
      }

      const existingProviderProfile = provider.providerProfile && typeof provider.providerProfile === "object"
        ? provider.providerProfile
        : {};
      const paypalState = normalizeProviderPaypalProfile(existingProviderProfile.paypal);

      const nextPayoutState = {
        ...paypalState.payouts,
        lastStatus: payoutStatus.profileStatus,
        lastEventType: eventType,
        lastEventId: readOptionalString(webhookEvent.id) || paypalState.payouts.lastEventId || null,
        lastEventAt: now,
        lastRequestId: matchedRequest ? String(matchedRequest.requestId || matchedRequest.id) : paypalState.payouts.lastRequestId || null,
        lastBatchId: payoutIdentifiers.batchId || paypalState.payouts.lastBatchId || null,
        lastItemId: payoutIdentifiers.itemId || paypalState.payouts.lastItemId || null,
        lastCustomerPayoutId: payoutIdentifiers.customerPayoutId || paypalState.payouts.lastCustomerPayoutId || null,
        succeededCount: paypalState.payouts.succeededCount + (payoutStatus.completed ? 1 : 0),
        failedCount: paypalState.payouts.failedCount + (payoutStatus.failed ? 1 : 0),
        heldCount: paypalState.payouts.heldCount + (payoutStatus.held ? 1 : 0)
      };

      const nextPaypal = {
        ...paypalState,
        providerAccountId: payoutIdentifiers.providerAccountId || paypalState.providerAccountId || null,
        accountId: payoutIdentifiers.accountId || paypalState.accountId || null,
        email: payoutIdentifiers.email || paypalState.email || readOptionalString(provider.email) || null,
        lastWebhookEventId: readOptionalString(webhookEvent.id) || paypalState.lastWebhookEventId || null,
        lastWebhookEventType: eventType,
        lastWebhookAt: now,
        payouts: nextPayoutState,
        recentEvents: pushProviderPaypalEvent(
          paypalState.recentEvents,
          buildProviderPaypalEventSummary(webhookEvent, eventType, resource, now, matchedRequest)
        )
      };

      provider.providerProfile = {
        ...existingProviderProfile,
        paypal: nextPaypal
      };

      return provider;
    });
  }

  return {
    matched: true,
    applied: true,
    targetType: matchedRequest ? "request" : "user",
    targetId: matchedRequest
      ? String(matchedRequest.requestId || matchedRequest.id)
      : String(updatedProvider.id),
    note: payoutStatus.profileStatus
  };
}

async function findProviderForPaypalEvent(resource) {
  const users = await readUsers();
  const identifiers = extractProviderPaypalIdentifiers(resource);

  return (
    users.find((user) => isPaypalProviderMatch(user, identifiers)) ||
    null
  );
}

async function findProviderForPaypalPayout(resource, matchedRequest = null) {
  if (matchedRequest?.assignedProviderId) {
    const users = await readUsers();
    const provider = users.find((user) => Number(user.id) === Number(matchedRequest.assignedProviderId));
    if (provider) {
      return provider;
    }
  }

  return findProviderForPaypalEvent(resource);
}

async function findRequestForPaypalPayout(resource) {
  const requests = await readRequestLog();
  const requestIdCandidates = [
    resource.sender_item_id,
    resource.senderItemId,
    resource.custom_id,
    resource.customId,
    resource.transaction_reference_id,
    resource.transactionReferenceId,
    resource.invoice_id,
    resource.reference_id,
    resource?.payout_item?.sender_item_id,
    resource?.payout_item?.senderItemId
  ]
    .map((value) => readOptionalString(value))
    .filter(Boolean);

  for (const candidate of requestIdCandidates) {
    const request = requests.find((entry) => {
      const requestId = String(entry.requestId || entry.id || "");
      return requestId === candidate;
    });
    if (request) {
      return request;
    }
  }

  const payoutIdentifiers = extractPaypalPayoutIdentifiers(resource);
  return (
    requests.find((entry) => {
      return (
        (payoutIdentifiers.batchId && readOptionalString(entry.payoutBatchId) === payoutIdentifiers.batchId) ||
        (payoutIdentifiers.itemId && readOptionalString(entry.payoutItemId) === payoutIdentifiers.itemId) ||
        (payoutIdentifiers.customerPayoutId && readOptionalString(entry.payoutCustomerId) === payoutIdentifiers.customerPayoutId)
      );
    }) || null
  );
}

function isPaypalProviderMatch(user, identifiers) {
  if (!Array.isArray(user?.roles) || !user.roles.includes("PROVIDER")) {
    return false;
  }

  const providerPaypal = normalizeProviderPaypalProfile(user?.providerProfile?.paypal);
  const providerInfo = user?.providerProfile?.providerInfo && typeof user.providerProfile.providerInfo === "object"
    ? user.providerProfile.providerInfo
    : {};

  const candidateEmails = new Set(
    [readOptionalString(providerPaypal.email), readOptionalString(providerInfo.email), readOptionalString(user.email)]
      .map((value) => value.toLowerCase())
      .filter(Boolean)
  );
  if (identifiers.email && candidateEmails.has(identifiers.email.toLowerCase())) {
    return true;
  }

  const candidateProviderAccountIds = new Set(
    [
      readOptionalString(providerPaypal.providerAccountId),
      readOptionalString(providerPaypal.merchantId),
      readOptionalString(providerPaypal.accountId),
      readOptionalString(providerPaypal.trackingId),
      readOptionalString(providerPaypal.payerId)
    ].filter(Boolean)
  );
  if (
    (identifiers.providerAccountId && candidateProviderAccountIds.has(identifiers.providerAccountId)) ||
    (identifiers.accountId && candidateProviderAccountIds.has(identifiers.accountId)) ||
    (identifiers.trackingId && candidateProviderAccountIds.has(identifiers.trackingId)) ||
    (identifiers.payerId && candidateProviderAccountIds.has(identifiers.payerId))
  ) {
    return true;
  }

  const payoutState = providerPaypal.payouts || {};
  if (
    (identifiers.batchId && readOptionalString(payoutState.lastBatchId) === identifiers.batchId) ||
    (identifiers.itemId && readOptionalString(payoutState.lastItemId) === identifiers.itemId) ||
    (identifiers.customerPayoutId && readOptionalString(payoutState.lastCustomerPayoutId) === identifiers.customerPayoutId)
  ) {
    return true;
  }

  return false;
}

function extractProviderPaypalIdentifiers(resource) {
  const parties = [
    resource,
    resource?.merchant,
    resource?.partner,
    resource?.account,
    resource?.payee,
    resource?.seller,
    resource?.recipient,
    resource?.payout_item,
    resource?.payer
  ].filter((entry) => entry && typeof entry === "object");
  const payoutIdentifiers = extractPaypalPayoutIdentifiers(resource);

  return {
    ...payoutIdentifiers,
    providerAccountId: firstNonEmptyString([
      payoutIdentifiers.providerAccountId,
      resource.merchant_id,
      resource.merchantId,
      resource.merchant_id_in_paypal,
      resource.merchantIdInPayPal,
      resource.partner_merchant_id,
      resource.partnerMerchantId,
      ...parties.map((entry) => entry.merchant_id),
      ...parties.map((entry) => entry.merchantId)
    ]),
    accountId: firstNonEmptyString([
      payoutIdentifiers.accountId,
      resource.account_id,
      resource.accountId,
      resource.managed_account_id,
      resource.managedAccountId,
      ...parties.map((entry) => entry.account_id),
      ...parties.map((entry) => entry.accountId)
    ]),
    trackingId: firstNonEmptyString([
      resource.tracking_id,
      resource.trackingId,
      ...parties.map((entry) => entry.tracking_id),
      ...parties.map((entry) => entry.trackingId)
    ]),
    payerId: firstNonEmptyString([
      resource.payer_id,
      resource.payerId,
      resource.receiver,
      resource.receiver_id,
      ...parties.map((entry) => entry.payer_id),
      ...parties.map((entry) => entry.payerId)
    ]),
    email: firstNonEmptyString([
      payoutIdentifiers.email,
      resource.email,
      resource.email_address,
      resource.receiver_email,
      resource.receiver,
      ...parties.map((entry) => entry.email),
      ...parties.map((entry) => entry.email_address),
      ...parties.map((entry) => entry.receiver_email)
    ])
  };
}

function extractPaypalPayoutIdentifiers(resource) {
  return {
    batchId: firstNonEmptyString([
      resource.payout_batch_id,
      resource.payoutBatchId,
      resource.sender_batch_id,
      resource.senderBatchId,
      resource?.payout_batch?.payout_batch_id,
      resource?.batch_header?.payout_batch_id,
      resource?.sender_batch_header?.sender_batch_id
    ]),
    itemId: firstNonEmptyString([
      resource.payout_item_id,
      resource.payoutItemId,
      resource.item_id,
      resource.itemId,
      resource.transaction_id,
      resource.transactionId,
      resource?.payout_item?.payout_item_id,
      resource?.payout_item?.payoutItemId
    ]),
    customerPayoutId: firstNonEmptyString([
      resource.customer_payout_id,
      resource.customerPayoutId,
      resource.payout_id,
      resource.payoutId,
      resource.id
    ]),
    // In the context of AW Roadside, 'merchant_id' refers to the Provider's PayPal account ID used for receiving payouts.
    // The Platform (AW Roadside) remains the primary merchant for customer payments.
    providerAccountId: firstNonEmptyString([resource.merchant_id, resource.merchantId, resource?.payee?.merchant_id, resource?.payee?.merchantId]),
    accountId: firstNonEmptyString([resource.account_id, resource.accountId]),
    email: firstNonEmptyString([resource.receiver_email, resource.receiver, resource.email, resource.email_address])
  };
}

function normalizeProviderPaypalProfile(value) {
  const paypal = value && typeof value === "object" ? value : {};
  return {
    providerAccountId: readOptionalString(paypal.providerAccountId) || readOptionalString(paypal.merchantId) || null,
    accountId: readOptionalString(paypal.accountId) || null,
    trackingId: readOptionalString(paypal.trackingId) || null,
    payerId: readOptionalString(paypal.payerId) || null,
    email: readOptionalString(paypal.email) || null,
    onboardingStatus: readOptionalString(paypal.onboardingStatus) || null,
    consentStatus: readOptionalString(paypal.consentStatus) || null,
    accountLifecycleStatus: readOptionalString(paypal.accountLifecycleStatus) || null,
    accountLimits: paypal.accountLimits && typeof paypal.accountLimits === "object" ? paypal.accountLimits : {},
    capabilities: paypal.capabilities && typeof paypal.capabilities === "object" ? paypal.capabilities : {},
    requirements: paypal.requirements && typeof paypal.requirements === "object" ? paypal.requirements : {},
    bankAccounts: paypal.bankAccounts && typeof paypal.bankAccounts === "object" ? paypal.bankAccounts : {},
    stakeholders: paypal.stakeholders && typeof paypal.stakeholders === "object" ? paypal.stakeholders : {},
    partnerBalance: paypal.partnerBalance && typeof paypal.partnerBalance === "object" ? paypal.partnerBalance : {},
    lastPartnerFinancialDebit:
      paypal.lastPartnerFinancialDebit && typeof paypal.lastPartnerFinancialDebit === "object"
        ? paypal.lastPartnerFinancialDebit
        : {},
    payouts: normalizeProviderPaypalPayoutState(paypal.payouts),
    recentEvents: Array.isArray(paypal.recentEvents) ? paypal.recentEvents : [],
    lastWebhookEventId: readOptionalString(paypal.lastWebhookEventId) || null,
    lastWebhookEventType: readOptionalString(paypal.lastWebhookEventType) || null,
    lastWebhookAt: optionalIsoString(paypal.lastWebhookAt),
    onboardingCompletedAt: optionalIsoString(paypal.onboardingCompletedAt),
    partnerConsentRevokedAt: optionalIsoString(paypal.partnerConsentRevokedAt),
    accountCreatedAt: optionalIsoString(paypal.accountCreatedAt),
    lastAccountUpdateAt: optionalIsoString(paypal.lastAccountUpdateAt),
    lastAccountLimitEventAt: optionalIsoString(paypal.lastAccountLimitEventAt),
    lastCapabilityUpdateAt: optionalIsoString(paypal.lastCapabilityUpdateAt),
    lastRequirementsUpdateAt: optionalIsoString(paypal.lastRequirementsUpdateAt)
  };
}

function normalizeProviderPaypalPayoutState(value) {
  const payouts = value && typeof value === "object" ? value : {};
  return {
    lastStatus: readOptionalString(payouts.lastStatus) || null,
    lastEventType: readOptionalString(payouts.lastEventType) || null,
    lastEventId: readOptionalString(payouts.lastEventId) || null,
    lastEventAt: optionalIsoString(payouts.lastEventAt),
    lastRequestId: readOptionalString(payouts.lastRequestId) || null,
    lastBatchId: readOptionalString(payouts.lastBatchId) || null,
    lastItemId: readOptionalString(payouts.lastItemId) || null,
    lastCustomerPayoutId: readOptionalString(payouts.lastCustomerPayoutId) || null,
    succeededCount: Number.isFinite(Number(payouts.succeededCount)) ? Number(payouts.succeededCount) : 0,
    failedCount: Number.isFinite(Number(payouts.failedCount)) ? Number(payouts.failedCount) : 0,
    heldCount: Number.isFinite(Number(payouts.heldCount)) ? Number(payouts.heldCount) : 0
  };
}

function extractPaypalAccountLimits(resource) {
  return {
    status: readOptionalString(resource.status) || null,
    limits: Array.isArray(resource.limits) ? resource.limits : [],
    currencyCode: readOptionalString(resource.currency_code || resource.currencyCode) || null,
    updatedAt: optionalIsoString(resource.updated_at || resource.update_time) || new Date().toISOString()
  };
}

function extractPaypalCapabilities(resource, currentCapabilities = {}) {
  const capabilities = Array.isArray(resource.capabilities) ? resource.capabilities : [];
  const nextCapabilities = { ...currentCapabilities };
  for (const capability of capabilities) {
    if (!capability || typeof capability !== "object") {
      continue;
    }
    const key = readOptionalString(capability.name || capability.type || capability.capability) || crypto.randomUUID();
    nextCapabilities[key] = {
      status: readOptionalString(capability.status) || null,
      details: capability
    };
  }
  return nextCapabilities;
}

function extractPaypalRequirements(resource, currentRequirements = {}) {
  return {
    ...currentRequirements,
    status: readOptionalString(resource.status) || currentRequirements.status || null,
    requirements: Array.isArray(resource.requirements) ? resource.requirements : currentRequirements.requirements || [],
    details: resource
  };
}

function extractPaypalBankAccounts(resource, currentBankAccounts = {}, eventType, recordedAt) {
  return {
    ...currentBankAccounts,
    lastEventType: eventType,
    lastEventAt: recordedAt,
    count: Array.isArray(resource.bank_accounts) ? resource.bank_accounts.length : currentBankAccounts.count || 0,
    details: Array.isArray(resource.bank_accounts) ? resource.bank_accounts : currentBankAccounts.details || []
  };
}

function extractPaypalStakeholders(resource, currentStakeholders = {}, eventType, recordedAt) {
  return {
    ...currentStakeholders,
    lastEventType: eventType,
    lastEventAt: recordedAt,
    count: Array.isArray(resource.stakeholders) ? resource.stakeholders.length : currentStakeholders.count || 0,
    details: Array.isArray(resource.stakeholders) ? resource.stakeholders : currentStakeholders.details || []
  };
}

function extractPaypalPartnerBalance(resource, currentBalance = {}, recordedAt) {
  const amount = resource.balance || resource.amount || resource.available_balance || {};
  return {
    ...currentBalance,
    currencyCode: readOptionalString(amount.currency_code || amount.currencyCode) || currentBalance.currencyCode || null,
    value: readOptionalString(amount.value) || currentBalance.value || null,
    asOf: recordedAt,
    details: resource
  };
}

function extractPaypalPartnerFinancialDebit(resource, recordedAt) {
  const amount = resource.amount || resource.debit_amount || {};
  return {
    amount: readOptionalString(amount.value) || null,
    currencyCode: readOptionalString(amount.currency_code || amount.currencyCode) || null,
    reason: readOptionalString(resource.reason || resource.description) || null,
    debitId: readOptionalString(resource.id) || null,
    recordedAt,
    details: resource
  };
}

function mapPaypalProviderPayoutStatus(eventType) {
  switch (eventType) {
    case "PAYMENT.PAYOUTSBATCH.PROCESSING":
      return { requestStatus: "PENDING", profileStatus: "PROCESSING", completed: false, failed: false, held: false };
    case "PAYMENT.PAYOUTSBATCH.SUCCESS":
      return { requestStatus: "COMPLETED", profileStatus: "SUCCESS", completed: true, failed: false, held: false };
    case "PAYMENT.PAYOUTSBATCH.DENIED":
      return { requestStatus: "DENIED", profileStatus: "DENIED", completed: false, failed: true, held: false };
    case "PAYMENT.PAYOUTS-ITEM.SUCCEEDED":
      return { requestStatus: "COMPLETED", profileStatus: "SUCCEEDED", completed: true, failed: false, held: false };
    case "PAYMENT.PAYOUTS-ITEM.HELD":
      return { requestStatus: "ON_HOLD", profileStatus: "HELD", completed: false, failed: false, held: true };
    case "PAYMENT.PAYOUTS-ITEM.BLOCKED":
      return { requestStatus: "BLOCKED", profileStatus: "BLOCKED", completed: false, failed: true, held: true };
    case "PAYMENT.PAYOUTS-ITEM.UNCLAIMED":
      return { requestStatus: "UNCLAIMED", profileStatus: "UNCLAIMED", completed: false, failed: false, held: true };
    case "PAYMENT.PAYOUTS-ITEM.RETURNED":
      return { requestStatus: "RETURNED", profileStatus: "RETURNED", completed: false, failed: true, held: false };
    case "PAYMENT.PAYOUTS-ITEM.REFUNDED":
      return { requestStatus: "REFUNDED", profileStatus: "REFUNDED", completed: false, failed: true, held: false };
    case "PAYMENT.PAYOUTS-ITEM.CANCELED":
      return { requestStatus: "CANCELED", profileStatus: "CANCELED", completed: false, failed: true, held: false };
    case "PAYMENT.PAYOUTS-ITEM.FAILED":
      return { requestStatus: "FAILED", profileStatus: "FAILED", completed: false, failed: true, held: false };
    case "PAYMENTS.CUSTOMER-PAYOUTS.CREATED":
      return { requestStatus: "PENDING", profileStatus: "CREATED", completed: false, failed: false, held: false };
    case "PAYMENTS.CUSTOMER-PAYOUTS.PENDING":
      return { requestStatus: "PENDING", profileStatus: "PENDING", completed: false, failed: false, held: false };
    case "PAYMENTS.CUSTOMER-PAYOUTS.COMPLETED":
      return { requestStatus: "COMPLETED", profileStatus: "COMPLETED", completed: true, failed: false, held: false };
    case "PAYMENTS.CUSTOMER-PAYOUTS.CANCELED":
      return { requestStatus: "CANCELED", profileStatus: "CANCELED", completed: false, failed: true, held: false };
    case "PAYMENTS.CUSTOMER-PAYOUTS.FAILED":
      return { requestStatus: "FAILED", profileStatus: "FAILED", completed: false, failed: true, held: false };
    case "PAYMENTS.CUSTOMER-PAYOUTS.REVERSED":
      return { requestStatus: "REVERSED", profileStatus: "REVERSED", completed: false, failed: true, held: false };
    default:
      return { requestStatus: eventType.split(".").slice(-1)[0] || "UPDATED", profileStatus: eventType, completed: false, failed: false, held: false };
  }
}

function buildProviderPaypalEventSummary(webhookEvent, eventType, resource, recordedAt, matchedRequest = null) {
  return {
    eventId: readOptionalString(webhookEvent?.id) || null,
    eventType,
    resourceId: readOptionalString(resource?.id) || null,
    requestId: matchedRequest ? String(matchedRequest.requestId || matchedRequest.id) : null,
    recordedAt
  };
}

function pushProviderPaypalEvent(events, entry) {
  const history = Array.isArray(events) ? events.slice(0, 24) : [];
  history.unshift(entry);
  return history;
}

function firstNonEmptyString(values) {
  for (const value of values) {
    const normalized = readOptionalString(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

async function applyPaypalPaymentWebhook(webhookEvent, eventType) {
  const resource = normalizePaypalResource(webhookEvent?.resource);
  const matchedRequest = await findRequestForPaypalPayment(resource);
  if (!matchedRequest) {
    return {
      matched: false,
      applied: false,
      note: "request-not-found"
    };
  }

  const amountValue = Number.parseFloat(
    readOptionalString(resource?.amount?.value) ||
      readOptionalString(resource?.seller_receivable_breakdown?.gross_amount?.value) ||
      "0"
  );
  const captureId = readOptionalString(resource.id);
  const orderId =
    readOptionalString(resource?.supplementary_data?.related_ids?.order_id) ||
    readOptionalString(resource?.invoice_id) ||
    matchedRequest.lastPaymentOrderId ||
    "";

  const updatedRequest = await updateRequestRecord(matchedRequest.requestId || matchedRequest.id, (request) => {
    const next = {
      lastPaymentOrderId: orderId || request.lastPaymentOrderId || null,
      lastPaymentEventId: readOptionalString(webhookEvent.id) || request.lastPaymentEventId || null,
      lastPaymentEventType: eventType,
      lastPaymentCaptureId: captureId || request.lastPaymentCaptureId || null
    };

    if (eventType === "PAYMENT.CAPTURE.COMPLETED" || eventType === "PAYMENT.SALE.COMPLETED") {
      next.paymentStatus = "CAPTURED";
      next.amountCollected = Number.isFinite(amountValue) && amountValue > 0 ? amountValue : request.amountCollected || 0;
      next.refundIssued = false;
      next.refundFlag = false;
    } else if (eventType === "PAYMENT.CAPTURE.PENDING" || eventType === "PAYMENT.SALE.PENDING") {
      next.paymentStatus = "PENDING_CAPTURE";
    } else if (
      eventType === "PAYMENT.CAPTURE.DENIED" ||
      eventType === "PAYMENT.CAPTURE.DECLINED" ||
      eventType === "PAYMENT.SALE.DENIED"
    ) {
      next.paymentStatus = "DECLINED";
    } else if (
      eventType === "PAYMENT.CAPTURE.REFUNDED" ||
      eventType === "PAYMENT.CAPTURE.REVERSED" ||
      eventType === "PAYMENT.REFUND.COMPLETED" ||
      eventType === "PAYMENT.SALE.REFUNDED" ||
      eventType === "PAYMENT.SALE.REVERSED"
    ) {
      next.paymentStatus = "REFUNDED";
      next.refundIssued = true;
      next.refundFlag = true;
    } else if (
      eventType === "PAYMENT.REFUND.PENDING" ||
      eventType === "PAYMENT.REFUND.FAILED" ||
      eventType === "PAYMENT.REFUND.DENIED" ||
      eventType === "PAYMENT.REFUND.CANCELLED"
    ) {
      next.paymentStatus = eventType.split(".").slice(-1)[0];
    } else if (eventType === "PAYMENT.ORDER.CANCELLED") {
      next.paymentStatus = "CANCELLED";
    }

    return next;
  });

  return {
    matched: true,
    applied: true,
    targetType: "request",
    targetId: String(updatedRequest.requestId || updatedRequest.id),
    note: updatedRequest.paymentStatus || "updated"
  };
}

function normalizePaypalResource(resource) {
  return resource && typeof resource === "object" ? resource : {};
}

async function findUserForPaypalSubscription(resource) {
  const users = await readUsers();
  const subscriptionId = readOptionalString(resource.id);
  const email = readOptionalString(resource?.subscriber?.email_address).toLowerCase();
  const customId = readOptionalString(resource.custom_id);
  const explicitUserId = readPaypalUserId(customId);

  if (subscriptionId) {
    const bySubscriptionId = users.find(
      (user) => readOptionalString(user?.subscriberProfile?.paypalSubscriptionId) === subscriptionId
    );
    if (bySubscriptionId) {
      return bySubscriptionId;
    }
  }

  if (explicitUserId !== null) {
    const byUserId = users.find((user) => Number(user.id) === explicitUserId);
    if (byUserId) {
      return byUserId;
    }
  }

  if (email) {
    const byEmail = users.find((user) => readOptionalString(user.email).toLowerCase() === email);
    if (byEmail) {
      return byEmail;
    }
  }

  return null;
}

async function findRequestForPaypalPayment(resource) {
  const requests = await readRequestLog();
  const explicitRequestId = readOptionalString(resource.custom_id);
  const orderId =
    readOptionalString(resource?.supplementary_data?.related_ids?.order_id) ||
    readOptionalString(resource?.supplementary_data?.related_ids?.authorization_id) ||
    readOptionalString(resource.invoice_id) ||
    readOptionalString(resource.id);

  if (explicitRequestId) {
    const byRequestId = requests.find((entry) => {
      const requestId = String(entry.requestId || entry.id || "");
      return requestId === explicitRequestId;
    });
    if (byRequestId) {
      return byRequestId;
    }
  }

  if (orderId) {
    const byOrderId = requests.find(
      (entry) => readOptionalString(entry.lastPaymentOrderId) === orderId
    );
    if (byOrderId) {
      return byOrderId;
    }
  }

  return null;
}

function readPaypalUserId(value) {
  const normalized = readOptionalString(value);
  if (!normalized) {
    return null;
  }
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }
  const match = normalized.match(/(?:^|:)user:(\d+)$/i);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function resolvePaypalNextBillingDate(resource) {
  const candidates = [
    resource?.billing_info?.next_billing_time,
    resource?.billing_info?.last_payment?.time,
    resource?.start_time,
    resource?.status_update_time
  ];

  for (const candidate of candidates) {
    const normalized = optionalIsoString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function mapPaypalSubscriptionState(eventType, resourceStatus) {
  const normalizedStatus = resourceStatus || "";
  if (
    eventType === "BILLING.SUBSCRIPTION.ACTIVATED" ||
    eventType === "BILLING.SUBSCRIPTION.RE-ACTIVATED" ||
    normalizedStatus === "ACTIVE"
  ) {
    return {
      active: true,
      accountState: "ACTIVE",
      profileStatus: "ACTIVE"
    };
  }

  if (eventType === "BILLING.SUBSCRIPTION.CREATED" || normalizedStatus === "APPROVAL_PENDING") {
    return {
      active: false,
      accountState: "ACTIVE",
      profileStatus: "CREATED"
    };
  }

  if (eventType === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") {
    return {
      active: false,
      accountState: "ACTIVE",
      profileStatus: "PAYMENT_FAILED"
    };
  }

  if (eventType === "BILLING.SUBSCRIPTION.SUSPENDED" || normalizedStatus === "SUSPENDED") {
    return {
      active: false,
      accountState: "ACTIVE",
      profileStatus: "SUSPENDED"
    };
  }

  if (eventType === "BILLING.SUBSCRIPTION.CANCELLED" || normalizedStatus === "CANCELLED") {
    return {
      active: false,
      accountState: "ACTIVE",
      profileStatus: "CANCELLED"
    };
  }

  if (eventType === "BILLING.SUBSCRIPTION.EXPIRED" || normalizedStatus === "EXPIRED") {
    return {
      active: false,
      accountState: "ACTIVE",
      profileStatus: "EXPIRED"
    };
  }

  return {
    active: normalizedStatus === "ACTIVE",
    accountState: "ACTIVE",
    profileStatus: normalizedStatus || "UPDATED"
  };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: "unparseable-response" };
  }
}

async function appendPaymentLog(entry) {
  await fs.mkdir(paymentsRoot, { recursive: true });
  await fs.appendFile(paymentLogPath, `${JSON.stringify(entry)}\n`);
  await storageAuthority.appendPaymentEvent(entry);
}

async function appendPaypalWebhookLog(entry) {
  await fs.mkdir(paymentsRoot, { recursive: true });
  await fs.appendFile(webhookLogPath, `${JSON.stringify(entry)}\n`);
}

async function hasProcessedPaypalWebhook({ deliveryId, eventId }) {
  try {
    const raw = await fs.readFile(webhookLogPath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .some((line) => {
        const parsed = JSON.parse(line);
        return (
          (deliveryId && readOptionalString(parsed.deliveryId) === deliveryId) ||
          (eventId && readOptionalString(parsed.eventId) === eventId)
        );
      });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function preferSqlStorageReads() {
  if (typeof storageAuthority?.getStatus !== "function") {
    return false;
  }
  const status = storageAuthority.getStatus();
  return status.enabled === true && status.mode === "internal-db";
}

async function readPaymentLogFromRuntimeStorage() {
  try {
    const raw = await fs.readFile(paymentLogPath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .reverse();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readPaymentLog() {
  if (preferSqlStorageReads() && typeof storageAuthority.readPaymentEvents === "function") {
    return storageAuthority.readPaymentEvents();
  }
  return readPaymentLogFromRuntimeStorage();
}

function issueUserSession({ userId, email, roles }) {
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + sessionTtlMs;
  const payload = {
    sessionId,
    userId: Number(userId),
    email: email || null,
    roles: Array.isArray(roles) ? roles : [],
    expiresAt
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signSessionBody(body);
  const token = `${body}.${signature}`;
  userSessions.set(sessionId, payload);
  return token;
}

function resolveUserSession(req) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    return null;
  }

  const [body, signature] = token.split(".");
  if (!body || !signature || signSessionBody(body) !== signature) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload || !payload.sessionId || Date.now() > Number(payload.expiresAt)) {
    userSessions.delete(payload?.sessionId);
    return null;
  }

  const liveSession = userSessions.get(payload.sessionId);
  if (!liveSession || liveSession.expiresAt !== payload.expiresAt || liveSession.userId !== payload.userId) {
    return null;
  }

  return {
    sessionId: payload.sessionId,
    userId: Number(payload.userId),
    email: payload.email || null,
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    expiresAt: payload.expiresAt
  };
}

function revokeUserSession(sessionId) {
  if (!sessionId) {
    return false;
  }
  return userSessions.delete(sessionId);
}

function signSessionBody(body) {
  return crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
}

function normalizeRequestCustomerFeedback(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rating = Number.parseInt(value.rating, 10);
  if (!Number.isInteger(rating)) {
    return null;
  }

  return {
    rating: Math.max(PROVIDER_RATING_MIN, Math.min(PROVIDER_RATING_MAX, rating)),
    notes: optionalString(value.notes) || "",
    submittedAt: optionalIsoString(value.submittedAt) || null,
    submittedByUserId: Number.isInteger(Number(value.submittedByUserId)) ? Number(value.submittedByUserId) : null,
    customerName: optionalString(value.customerName) || "",
    source: optionalString(value.source) || "customer"
  };
}

function normalizeProviderTrainingRecord(value, required = false) {
  const training = value && typeof value === "object" ? value : {};
  const rawStatus = optionalString(training.status).toUpperCase();
  const status = rawStatus || (required ? "REQUIRED" : "NOT_REQUIRED");
  return {
    status,
    required: Boolean(required || status !== "NOT_REQUIRED"),
    scheduledFor: optionalIsoString(training.scheduledFor),
    enrolledAt: optionalIsoString(training.enrolledAt),
    completedAt: optionalIsoString(training.completedAt),
    note: optionalString(training.note) || null,
    updatedAt: optionalIsoString(training.updatedAt),
    updatedBy: optionalString(training.updatedBy) || null
  };
}

function normalizeProviderDisciplineState(value) {
  const discipline = value && typeof value === "object" ? value : {};
  const lowRatingEvents = Array.isArray(discipline.lowRatingEvents)
    ? discipline.lowRatingEvents
      .map((entry, index) => normalizeProviderLowRatingEvent(entry, index))
      .filter(Boolean)
    : [];
  const suspensionHistory = Array.isArray(discipline.suspensionHistory)
    ? discipline.suspensionHistory
      .map((entry, index) => normalizeProviderSuspensionRecord(entry, index))
      .filter(Boolean)
    : [];
  const strikeCount = Number.isFinite(Number(discipline.strikeCount))
    ? Number(discipline.strikeCount)
    : suspensionHistory.length;
  const currentSuspension = normalizeCurrentProviderSuspension(discipline.currentSuspension, suspensionHistory, strikeCount);
  const training = normalizeProviderTrainingRecord(discipline.training, currentSuspension.indefinite);
  const probation = normalizeProviderProbationRecord(discipline.probation);
  const restriction = normalizeProviderRestrictionRecord(discipline.restriction);

  return {
    policyVersion: optionalString(discipline.policyVersion) || PROVIDER_DISCIPLINE_POLICY_VERSION,
    strikeCount,
    lowRatingEvents,
    suspensionHistory,
    currentSuspension,
    training,
    probation,
    restriction,
    clearedAt: optionalIsoString(discipline.clearedAt)
  };
}

function normalizeProviderLowRatingEvent(value, index = 0) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const rating = Number.parseInt(value.rating, 10);
  if (!Number.isInteger(rating)) {
    return null;
  }
  const createdAt = optionalIsoString(value.submittedAt || value.createdAt);
  return {
    eventId: optionalString(value.eventId) || `low-rating-${index + 1}`,
    requestId: optionalString(value.requestId) || null,
    rating: Math.max(PROVIDER_RATING_MIN, Math.min(PROVIDER_RATING_MAX, rating)),
    notes: optionalString(value.notes) || "",
    submittedAt: createdAt,
    submittedByUserId: Number.isInteger(Number(value.submittedByUserId)) ? Number(value.submittedByUserId) : null,
    consumedBySuspensionId: optionalString(value.consumedBySuspensionId) || null,
    consumedByRestrictionId: optionalString(value.consumedByRestrictionId) || null
  };
}

function normalizeProviderProbationRecord(value) {
  const probation = value && typeof value === "object" ? value : {};
  return {
    active: Boolean(probation.active),
    reinstatedAt: optionalIsoString(probation.reinstatedAt),
    endsAt: optionalIsoString(probation.endsAt),
    clearedAt: optionalIsoString(probation.clearedAt),
    sourceSuspensionId: optionalString(probation.sourceSuspensionId) || null
  };
}

function normalizeProviderRestrictionRecord(value) {
  const restriction = value && typeof value === "object" ? value : {};
  return {
    active: Boolean(restriction.active),
    flaggedAt: optionalIsoString(restriction.flaggedAt),
    reason: optionalString(restriction.reason) || null,
    sourceProbationId: optionalString(restriction.sourceProbationId) || null,
    note: optionalString(restriction.note) || null
  };
}

function normalizeProviderSuspensionRecord(value, index = 0) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const level = Number.isFinite(Number(value.level)) ? Number(value.level) : index + 1;
  const triggerRequestIds = Array.isArray(value.triggerRequestIds)
    ? value.triggerRequestIds.map((entry) => optionalString(entry)).filter(Boolean)
    : [];
  return {
    suspensionId: optionalString(value.suspensionId) || `provider-suspension-${index + 1}`,
    level,
    startedAt: optionalIsoString(value.startedAt),
    endsAt: optionalIsoString(value.endsAt),
    indefinite: Boolean(value.indefinite || level >= 3),
    durationDays: Number.isFinite(Number(value.durationDays)) ? Number(value.durationDays) : null,
    lowRatingWindowStart: optionalIsoString(value.lowRatingWindowStart),
    lowRatingWindowEnd: optionalIsoString(value.lowRatingWindowEnd),
    triggerRequestIds,
    resolvedAt: optionalIsoString(value.resolvedAt),
    previousProviderStatus: optionalString(value.previousProviderStatus) || "APPROVED"
  };
}

function normalizeCurrentProviderSuspension(value, suspensionHistory = [], strikeCount = 0) {
  if (value && typeof value === "object") {
    return {
      suspensionId: optionalString(value.suspensionId) || null,
      active: Boolean(value.active),
      level: Number.isFinite(Number(value.level)) ? Number(value.level) : strikeCount,
      startedAt: optionalIsoString(value.startedAt),
      endsAt: optionalIsoString(value.endsAt),
      indefinite: Boolean(value.indefinite),
      previousProviderStatus: optionalString(value.previousProviderStatus) || "APPROVED"
    };
  }

  const latest = suspensionHistory[0] || null;
  return {
    suspensionId: latest?.suspensionId || null,
    active: false,
    level: latest?.level || strikeCount,
    startedAt: latest?.startedAt || null,
    endsAt: latest?.endsAt || null,
    indefinite: Boolean(latest?.indefinite),
    previousProviderStatus: latest?.previousProviderStatus || "APPROVED"
  };
}

function createProviderDisciplineSnapshot(user) {
  return normalizeProviderDisciplineState(user?.providerProfile?.discipline);
}

function reconcileProviderDiscipline(user) {
  if (!user || typeof user !== "object") {
    return user;
  }
  if (!Array.isArray(user.roles) || !user.roles.includes("PROVIDER")) {
    return user;
  }

  const providerProfile = user.providerProfile && typeof user.providerProfile === "object" ? user.providerProfile : {};
  const discipline = normalizeProviderDisciplineState(providerProfile.discipline);
  const current = discipline.currentSuspension;
  const now = Date.now();

  if (current.active && !current.indefinite && current.endsAt) {
    const endsAt = new Date(current.endsAt).getTime();
    if (Number.isFinite(endsAt) && endsAt <= now) {
      discipline.currentSuspension = {
        ...current,
        active: false
      };
      discipline.suspensionHistory = discipline.suspensionHistory.map((entry) =>
        entry.suspensionId === current.suspensionId && !entry.resolvedAt
          ? {
              ...entry,
              resolvedAt: new Date(now).toISOString()
            }
          : entry
      );
      if ((user.accountState || "ACTIVE") === "SUSPENDED") {
        user.accountState = "ACTIVE";
      }
      if (optionalString(user.providerStatus).toUpperCase() === "SUSPENDED") {
        user.providerStatus = current.previousProviderStatus || "APPROVED";
      }
    }
  }

  if (discipline.probation.active && discipline.probation.endsAt) {
    const probationEndsAt = new Date(discipline.probation.endsAt).getTime();
    if (Number.isFinite(probationEndsAt) && probationEndsAt <= now && !discipline.restriction.active) {
      clearProviderDisciplineAfterSuccessfulProbation(discipline, new Date(now).toISOString());
      user.accountState = "ACTIVE";
      if (optionalString(user.providerStatus).toUpperCase() === "SUSPENDED") {
        user.providerStatus = current.previousProviderStatus || "APPROVED";
      }
    }
  }

  if (discipline.restriction.active || discipline.currentSuspension.active) {
    user.accountState = "SUSPENDED";
    user.providerStatus = "SUSPENDED";
    user.available = false;
  }

  user.providerProfile = {
    ...providerProfile,
    discipline
  };
  return user;
}

function isEligibleGuestFeedbackForRequest(request, payload) {
  const requestPhone = normalizePhoneNumber(request?.phoneNumber);
  const payloadPhone = normalizePhoneNumber(payload?.phoneNumber);
  if (!requestPhone || !payloadPhone || requestPhone !== payloadPhone) {
    return false;
  }
  const requestName = optionalString(request?.fullName).toLowerCase();
  const payloadName = optionalString(payload?.fullName).toLowerCase();
  return !payloadName || !requestName || requestName === payloadName;
}

function normalizePhoneNumber(value) {
  return optionalString(value).replace(/\D/g, "");
}

function startOfRollingCalendarWindow(value, months = 0, years = 0) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (years) {
    date.setFullYear(date.getFullYear() - years);
  }
  if (months) {
    date.setMonth(date.getMonth() - months);
  }
  return date.getTime();
}

function addCalendarYears(value, years) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setFullYear(date.getFullYear() + years);
  return date.toISOString();
}

function activateProviderProbation(discipline, reinstatedAt, suspensionId = null) {
  discipline.probation = {
    active: true,
    reinstatedAt,
    endsAt: addCalendarYears(reinstatedAt, PROVIDER_REINSTATEMENT_PROBATION_YEARS),
    clearedAt: null,
    sourceSuspensionId: suspensionId
  };
}

function clearProviderDisciplineAfterSuccessfulProbation(discipline, clearedAt) {
  discipline.strikeCount = 0;
  discipline.currentSuspension = {
    ...discipline.currentSuspension,
    active: false,
    level: 0,
    suspensionId: null,
    startedAt: null,
    endsAt: null,
    indefinite: false
  };
  discipline.probation = {
    ...discipline.probation,
    active: false,
    clearedAt
  };
  discipline.training = normalizeProviderTrainingRecord({
    ...discipline.training,
    status: "NOT_REQUIRED",
    required: false,
    updatedAt: clearedAt
  });
  discipline.restriction = {
    ...discipline.restriction,
    active: false,
    flaggedAt: null,
    reason: null,
    sourceProbationId: null,
    note: null
  };
  discipline.clearedAt = clearedAt;
}

function buildSuspensionRecord(level, eventGroup, previousProviderStatus) {
  const startedAt = new Date().toISOString();
  const indefinite = level >= 3;
  const durationDays = indefinite ? null : PROVIDER_SUSPENSION_DURATIONS_DAYS[Math.min(level, 2) - 1] || null;
  return {
    suspensionId: `provider-suspension-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    level,
    startedAt,
    endsAt: durationDays ? addDays(startedAt, durationDays) : null,
    indefinite,
    durationDays,
    lowRatingWindowStart: eventGroup[0]?.submittedAt || null,
    lowRatingWindowEnd: eventGroup[eventGroup.length - 1]?.submittedAt || null,
    triggerRequestIds: eventGroup.map((entry) => entry.requestId).filter(Boolean),
    resolvedAt: null,
    previousProviderStatus: previousProviderStatus || "APPROVED"
  };
}

async function recordCustomerFeedback(requestId, payload, session = null) {
  const rating = Number.parseInt(payload?.rating, 10);
  if (!Number.isInteger(rating) || rating < PROVIDER_RATING_MIN || rating > PROVIDER_RATING_MAX) {
    const error = new Error(`Rating must be between ${PROVIDER_RATING_MIN} and ${PROVIDER_RATING_MAX}.`);
    error.statusCode = 400;
    throw error;
  }

  const feedbackNotes = optionalString(payload?.notes) || "";
  const source = optionalString(payload?.source) || (session?.userId ? "subscriber" : "guest");
  const now = new Date().toISOString();
  let feedbackRecord = null;

  const updatedRequest = await updateRequestRecord(requestId, (request) => {
    const providerUserId = Number(request?.assignedProviderId);
    if (!Number.isInteger(providerUserId)) {
      const error = new Error("This request does not have an assigned provider.");
      error.statusCode = 409;
      throw error;
    }
    if (optionalString(request?.status).toUpperCase() !== "COMPLETED") {
      const error = new Error("Customer feedback is available after service completion.");
      error.statusCode = 409;
      throw error;
    }
    if (request.customerFeedback) {
      const error = new Error("Customer feedback has already been recorded for this request.");
      error.statusCode = 409;
      throw error;
    }

    const sessionRoles = Array.isArray(session?.roles) ? session.roles : [];
    const authenticatedCustomer = session?.userId && sessionRoles.includes("SUBSCRIBER") && Number(request?.userId) === Number(session.userId);
    const guestCustomer = !session?.userId && isEligibleGuestFeedbackForRequest(request, payload);
    if (!authenticatedCustomer && !guestCustomer) {
      const error = new Error("Customer feedback could not be matched to this request.");
      error.statusCode = 403;
      throw error;
    }

    feedbackRecord = {
      rating,
      notes: feedbackNotes,
      submittedAt: now,
      submittedByUserId: authenticatedCustomer ? Number(session.userId) : null,
      customerName: optionalString(request.fullName) || optionalString(payload.fullName) || "",
      source
    };

    return {
      ...request,
      customerFeedback: feedbackRecord
    };
  });

  await mutateUsers(async (users) => {
    const requestProviderId = Number(updatedRequest.assignedProviderId);
    const provider = users.find((entry) => Number(entry.id) === requestProviderId);
    if (!provider) {
      throw new Error("Assigned provider was not found.");
    }

    const providerProfile = provider.providerProfile && typeof provider.providerProfile === "object" ? provider.providerProfile : {};
    const rates = providerProfile.rates && typeof providerProfile.rates === "object" ? providerProfile.rates : {};
    const discipline = normalizeProviderDisciplineState(providerProfile.discipline);

    provider.providerProfile = {
      ...providerProfile,
      rates: {
        ratingTotal: Number(rates.ratingTotal || 0) + rating,
        ratingCount: Number(rates.ratingCount || 0) + 1
      },
      discipline
    };

    if (rating <= PROVIDER_LOW_RATING_THRESHOLD) {
      const eventId = `low-rating-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const nextEvent = {
        eventId,
        requestId: optionalString(updatedRequest.id || updatedRequest.requestId) || null,
        rating,
        notes: feedbackNotes,
        submittedAt: now,
        submittedByUserId: feedbackRecord?.submittedByUserId || null,
        consumedBySuspensionId: null
      };
      provider.providerProfile.discipline.lowRatingEvents = [nextEvent, ...discipline.lowRatingEvents];
      const unconsumed = provider.providerProfile.discipline.lowRatingEvents
        .filter((entry) => !entry.consumedBySuspensionId)
        .sort((left, right) => String(left.submittedAt || "").localeCompare(String(right.submittedAt || "")));
      const standardWindowStart = startOfRollingCalendarWindow(now, PROVIDER_LOW_RATING_WINDOW_MONTHS, 0);
      const probationWindowStart = discipline.probation.active
        ? new Date(discipline.probation.reinstatedAt || now).getTime()
        : null;
      const standardEligible = unconsumed.filter((entry) => {
        const submittedAt = new Date(entry.submittedAt || "").getTime();
        return Number.isFinite(submittedAt) && standardWindowStart !== null && submittedAt >= standardWindowStart;
      });
      const probationEligible = discipline.probation.active
        ? unconsumed.filter((entry) => {
            const submittedAt = new Date(entry.submittedAt || "").getTime();
            return Number.isFinite(submittedAt) && probationWindowStart !== null && submittedAt >= probationWindowStart;
          })
        : [];

      if (discipline.probation.active && probationEligible.length >= PROVIDER_LOW_RATING_STRIKE_THRESHOLD) {
        const eventGroup = probationEligible.slice(0, PROVIDER_LOW_RATING_STRIKE_THRESHOLD);
        const restrictionId = `provider-restriction-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        provider.providerProfile.discipline.restriction = {
          active: true,
          flaggedAt: now,
          reason: "Three low ratings during one-year post-training probation.",
          sourceProbationId: restrictionId,
          note: "Provider flagged and restricted from service after post-training probation failure."
        };
        provider.providerProfile.discipline.probation = {
          ...discipline.probation,
          active: false
        };
        provider.providerProfile.discipline.lowRatingEvents = provider.providerProfile.discipline.lowRatingEvents.map((entry) =>
          eventGroup.some((candidate) => candidate.eventId === entry.eventId)
            ? {
                ...entry,
                consumedByRestrictionId: restrictionId
              }
            : entry
        );
        provider.accountState = "SUSPENDED";
        provider.providerStatus = "SUSPENDED";
        provider.available = false;
      } else if (!discipline.probation.active && standardEligible.length >= PROVIDER_LOW_RATING_STRIKE_THRESHOLD) {
        const eventGroup = standardEligible.slice(0, PROVIDER_LOW_RATING_STRIKE_THRESHOLD);
        const nextStrikeLevel = Number(provider.providerProfile.discipline.strikeCount || 0) + 1;
        const previousProviderStatus = optionalString(provider.providerStatus).toUpperCase() || "APPROVED";
        const suspension = buildSuspensionRecord(nextStrikeLevel, eventGroup, previousProviderStatus);
        provider.providerProfile.discipline.strikeCount = nextStrikeLevel;
        provider.providerProfile.discipline.currentSuspension = {
          suspensionId: suspension.suspensionId,
          active: true,
          level: suspension.level,
          startedAt: suspension.startedAt,
          endsAt: suspension.endsAt,
          indefinite: suspension.indefinite,
          previousProviderStatus
        };
        provider.providerProfile.discipline.suspensionHistory = [
          suspension,
          ...provider.providerProfile.discipline.suspensionHistory
        ];
        provider.providerProfile.discipline.lowRatingEvents = provider.providerProfile.discipline.lowRatingEvents.map((entry) =>
          eventGroup.some((candidate) => candidate.eventId === entry.eventId)
            ? {
                ...entry,
                consumedBySuspensionId: suspension.suspensionId
              }
            : entry
        );
        provider.providerProfile.discipline.training = normalizeProviderTrainingRecord(
          provider.providerProfile.discipline.training,
          suspension.indefinite
        );
        if (suspension.indefinite) {
          provider.providerProfile.discipline.training.status = "REQUIRED";
        }
        provider.providerProfile.discipline.probation = {
          ...discipline.probation,
          active: false
        };
        provider.providerProfile.discipline.restriction = {
          ...discipline.restriction,
          active: false,
          flaggedAt: null,
          reason: null,
          sourceProbationId: null,
          note: null
        };
        provider.providerProfile.discipline.clearedAt = null;
        provider.accountState = "SUSPENDED";
        provider.providerStatus = "SUSPENDED";
        provider.available = false;
      }
    }
  });

  const provider = (await readUsers()).find((entry) => Number(entry.id) === Number(updatedRequest.assignedProviderId));

  return {
    message: "Customer feedback recorded.",
    request: await presentRequestForSession(updatedRequest, session || { roles: ["GUEST"], actorRole: "GUEST", ownsRequest: true }),
    providerRating: calculateProviderRatingSummary(provider),
    providerDiscipline: createProviderDisciplineSnapshot(provider)
  };
}

async function ensureSandboxManualTestFixtures() {
  if (paypalMode !== "sandbox") {
    return;
  }

  const sandboxUserIds = await ensureSandboxManualTestUsers();
  await ensureSandboxManualTestRequests(sandboxUserIds);
  console.log(
    `[DEBUG_LOG] Sandbox manual test fixtures ready: ${sandboxUserIds.size} users, ${SANDBOX_MANUAL_TEST_REQUEST_FIXTURES.length} requests`
  );
}

async function ensureSandboxManualTestUsers() {
  return mutateUsers(async (users) => {
    const seededUsers = new Map();
    for (const descriptor of SANDBOX_MANUAL_TEST_USERS) {
      let user = users.find((entry) => {
        return (
          readOptionalString(entry?.username).toLowerCase() === descriptor.username.toLowerCase() ||
          readOptionalString(entry?.email).toLowerCase() === descriptor.email.toLowerCase()
        );
      });

      if (!user) {
        user = { id: allocateUserId(users) };
        users.push(user);
      }

      const normalized = descriptor.role === "PROVIDER"
        ? buildSandboxProviderUser(user, descriptor)
        : buildSandboxSubscriberUser(user, descriptor);
      Object.keys(user).forEach((key) => {
        delete user[key];
      });
      Object.assign(user, normalized);
      seededUsers.set(descriptor.key, user.id);
    }
    return seededUsers;
  });
}

async function ensureSandboxManualTestRequests(sandboxUserIds) {
  await mutateRequests(async (requests) => {
    for (const fixture of SANDBOX_MANUAL_TEST_REQUEST_FIXTURES) {
      const record = buildSandboxManualTestRequest(fixture, sandboxUserIds);
      const index = requests.findIndex((entry) => String(entry?.requestId || entry?.id) === fixture.requestId);
      if (index >= 0) {
        requests[index] = record;
      } else {
        requests.unshift(record);
      }
    }
    return null;
  });
}

function buildSandboxSubscriberUser(existingUser, descriptor) {
  const createdAt = optionalIsoString(existingUser?.createdAt) || new Date().toISOString();
  const seededAt = new Date().toISOString();
  const vehicle = descriptor.vehicle;
  return {
    ...existingUser,
    id: Number(existingUser?.id),
    fullName: descriptor.fullName,
    username: descriptor.username,
    email: descriptor.email,
    phoneNumber: descriptor.phoneNumber,
    passwordHash: descriptor.passwordHash,
    roles: ["SUBSCRIBER"],
    subscriberActive: true,
    subscriberProfile: {
      ...(existingUser?.subscriberProfile && typeof existingUser.subscriberProfile === "object" ? existingUser.subscriberProfile : {}),
      membershipPrice: subscriberMonthlyFee,
      vehicle,
      savedVehicles: [vehicle],
      paymentMethodMasked: descriptor.paymentMethodMasked,
      paymentInfo: {
        paymentMethodMasked: descriptor.paymentMethodMasked,
        billingZip: descriptor.billingZip,
        paymentProvider: "paypal-sandbox"
      },
      termsAcceptedAt: seededAt,
      termsVersion: AW_ROADSIDE_POLICY.subscriber.termsVersion
    },
    providerStatus: null,
    providerProfile: null,
    termsAccepted: true,
    terms: {
      ...(existingUser?.terms && typeof existingUser.terms === "object" ? existingUser.terms : {}),
      subscriber: {
        accepted: true,
        acceptedAt: seededAt,
        termsVersion: AW_ROADSIDE_POLICY.subscriber.termsVersion,
        dispatchOnlyLiabilityAccepted: true,
        noRefundPolicyAccepted: true,
        platformLiability: AW_ROADSIDE_POLICY.subscriber.platformLiability,
        providerLiability: AW_ROADSIDE_POLICY.provider.liabilityStatement
      }
    },
    trustedZone: {
      type: "sandbox-city",
      label: descriptor.city
    },
    services: [],
    available: false,
    activeShiftId: null,
    accountState: "ACTIVE",
    nextBillingDate: ensureFutureIso(existingUser?.nextBillingDate, 30),
    createdAt,
    signUpDate: optionalIsoString(existingUser?.signUpDate) || createdAt,
    sandboxProfile: {
      key: descriptor.key,
      city: descriptor.city,
      role: descriptor.role,
      seededBy: "server.mjs",
      seededAt
    }
  };
}

function buildSandboxProviderUser(existingUser, descriptor) {
  const createdAt = optionalIsoString(existingUser?.createdAt) || new Date().toISOString();
  const seededAt = new Date().toISOString();
  const existingProviderProfile =
    existingUser?.providerProfile && typeof existingUser.providerProfile === "object"
      ? existingUser.providerProfile
      : {};
  const existingPaypal = normalizeProviderPaypalProfile(existingProviderProfile.paypal);
  const paypalProfile = buildSandboxProviderPaypalProfile(descriptor, existingPaypal, seededAt);

  return {
    ...existingUser,
    id: Number(existingUser?.id),
    fullName: descriptor.fullName,
    username: descriptor.username,
    email: descriptor.email,
    phoneNumber: descriptor.phoneNumber,
    passwordHash: descriptor.passwordHash,
    roles: ["PROVIDER"],
    subscriberActive: false,
    subscriberProfile: null,
    providerStatus: "APPROVED",
    providerProfile: {
      ...existingProviderProfile,
      providerInfo: {
        legalName: descriptor.fullName,
        phoneNumber: descriptor.phoneNumber,
        email: descriptor.email,
        companyName: "AW Roadside Sandbox Network",
        w9Name: "Sandbox Provider",
        taxIdLast4: "0000"
      },
      vehicleInfo: descriptor.vehicleInfo,
      documents: createSandboxProviderDocuments(seededAt),
      documentStatus: {
        required: [...SANDBOX_PROVIDER_DOCUMENT_TYPES],
        submittedCount: SANDBOX_PROVIDER_DOCUMENT_TYPES.length,
        missing: [],
        meetsMinimumRequirements: true
      },
      experience: "Sandbox manual test provider",
      assessment: {
        complete: true,
        passed: true,
        missing: [],
        answers: SANDBOX_PROVIDER_ASSESSMENT_ANSWERS,
        evaluatedAt: seededAt,
        safeDamageDecision: true
      },
      hoursOfService: {
        timezone: "America/New_York",
        days: {
          monday: "00:00-23:59",
          tuesday: "00:00-23:59",
          wednesday: "00:00-23:59",
          thursday: "00:00-23:59",
          friday: "00:00-23:59",
          saturday: "00:00-23:59",
          sunday: "00:00-23:59"
        },
        hasHours: true
      },
      serviceArea: descriptor.city,
      currentLocation: descriptor.city,
      equipment: ["Jump pack", "Lockout kit", "Hydraulic jack", "Fuel can"],
      profileSubmittedAt: optionalIsoString(existingProviderProfile.profileSubmittedAt) || createdAt,
      profileSubmissionStatus: "APPROVED",
      rates: existingProviderProfile.rates && typeof existingProviderProfile.rates === "object"
        ? existingProviderProfile.rates
        : {
            ratingTotal: 0,
            ratingCount: 0,
            averageRating: 0
          },
      noteExchangeEnabled: true,
      paypal: paypalProfile
    },
    termsAccepted: true,
    terms: {
      ...(existingUser?.terms && typeof existingUser.terms === "object" ? existingUser.terms : {}),
      provider: {
        accepted: true,
        acceptedAt: seededAt,
        termsVersion: AW_ROADSIDE_POLICY.provider.termsVersion,
        liabilityAccepted: true,
        liabilityStatement: AW_ROADSIDE_POLICY.provider.liabilityStatement,
        holdHarmlessAccepted: true
      }
    },
    trustedZone: {
      type: "sandbox-city",
      label: descriptor.city
    },
    services: [...SANDBOX_MANUAL_TEST_SERVICE_TYPES],
    available: true,
    activeShiftId: null,
    accountState: "ACTIVE",
    nextBillingDate: null,
    createdAt,
    signUpDate: optionalIsoString(existingUser?.signUpDate) || createdAt,
    providerMonthly: providerMonthlyFee,
    approvedAt: optionalIsoString(existingUser?.approvedAt) || seededAt,
    approvalNote: "sandbox manual test profile",
    sandboxProfile: {
      key: descriptor.key,
      city: descriptor.city,
      role: descriptor.role,
      seededBy: "server.mjs",
      seededAt
    }
  };
}

function buildSandboxProviderPaypalProfile(descriptor, existingPaypal, seededAt) {
  const payouts = {
    ...existingPaypal.payouts,
    lastStatus: descriptor.payoutStatus,
    lastEventType: descriptor.payoutStatus === "COMPLETED"
      ? "PAYMENT.PAYOUTS-ITEM.SUCCEEDED"
      : descriptor.payoutStatus === "PENDING"
        ? "PAYMENT.PAYOUTSBATCH.PROCESSING"
        : "PAYMENT.PAYOUTS-ITEM.HELD",
    lastEventId: existingPaypal.payouts.lastEventId || `sandbox-payout-${descriptor.key}`,
    lastEventAt: existingPaypal.payouts.lastEventAt || seededAt,
    lastRequestId: existingPaypal.payouts.lastRequestId || null,
    lastBatchId: existingPaypal.payouts.lastBatchId || `sandbox-batch-${descriptor.key}`,
    lastItemId: existingPaypal.payouts.lastItemId || `sandbox-item-${descriptor.key}`,
    lastCustomerPayoutId: existingPaypal.payouts.lastCustomerPayoutId || `sandbox-customer-payout-${descriptor.key}`,
    succeededCount: descriptor.payoutStatus === "COMPLETED" ? Math.max(existingPaypal.payouts.succeededCount, 1) : existingPaypal.payouts.succeededCount,
    failedCount: existingPaypal.payouts.failedCount,
    heldCount: descriptor.payoutStatus === "ON_HOLD" ? Math.max(existingPaypal.payouts.heldCount, 1) : existingPaypal.payouts.heldCount
  };

  return {
    ...existingPaypal,
    providerAccountId: descriptor.providerAccountId,
    email: descriptor.payoutEmail,
    onboardingStatus: existingPaypal.onboardingStatus || "COMPLETED",
    consentStatus: existingPaypal.consentStatus || "GRANTED",
    accountLifecycleStatus: existingPaypal.accountLifecycleStatus || "ACTIVE",
    payouts,
    recentEvents: Array.isArray(existingPaypal.recentEvents) ? existingPaypal.recentEvents : [],
    lastWebhookEventId: existingPaypal.lastWebhookEventId || payouts.lastEventId,
    lastWebhookEventType: existingPaypal.lastWebhookEventType || payouts.lastEventType,
    lastWebhookAt: existingPaypal.lastWebhookAt || payouts.lastEventAt,
    onboardingCompletedAt: existingPaypal.onboardingCompletedAt || seededAt,
    accountCreatedAt: existingPaypal.accountCreatedAt || seededAt,
    lastAccountUpdateAt: existingPaypal.lastAccountUpdateAt || seededAt
  };
}

function createSandboxProviderDocuments(timestamp) {
  const documents = {};
  for (const docType of PROVIDER_DOCUMENT_TYPES) {
    documents[docType] = {
      submitted: docType !== "helperId",
      verified: false,
      uploadedAt: docType !== "helperId" ? timestamp : null,
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
  return documents;
}

function buildSandboxManualTestRequest(fixture, sandboxUserIds) {
  const subscriber = findSandboxUserDescriptor(fixture.subscriberKey);
  const userId = sandboxUserIds.get(fixture.subscriberKey);
  const providerId = fixture.providerKey ? sandboxUserIds.get(fixture.providerKey) : null;
  if (!Number.isInteger(userId)) {
    throw new Error(`Sandbox subscriber fixture ${fixture.subscriberKey} is missing a seeded user id.`);
  }
  if (fixture.providerKey && !Number.isInteger(providerId)) {
    throw new Error(`Sandbox provider fixture ${fixture.providerKey} is missing a seeded user id.`);
  }

  const pricing = resolveServicePricing({
    customerTier: "SUBSCRIBER",
    subscriberActive: true,
    roles: ["SUBSCRIBER"]
  });
  const submittedAt = minutesAgoIso(fixture.startedMinutesAgo);
  const acceptedAt = fixture.providerKey ? shiftIso(submittedAt, 8) : null;
  const etaUpdatedAt = fixture.providerKey ? shiftIso(submittedAt, 15) : null;
  const arrivedAt = fixture.requestState === "COMPLETED" ? shiftIso(submittedAt, 55) : null;
  const completedAt = fixture.requestState === "COMPLETED" ? shiftIso(submittedAt, 80) : null;
  const payoutCompletedAt = fixture.payoutState === "COMPLETED" ? shiftIso(submittedAt, 95) : null;
  const updatedAt = payoutCompletedAt || completedAt || etaUpdatedAt || submittedAt;
  const amountCollected = fixture.paymentState === "CAPTURED" ? pricing.serviceCharge : 0;

  return {
    id: fixture.requestId,
    requestId: fixture.requestId,
    status: fixture.requestState,
    completionStatus: fixture.requestState === "COMPLETED" ? "COMPLETED" : "OPEN",
    paymentStatus: fixture.paymentState,
    locationDisclosureLevel: fixture.paymentState === "CAPTURED" ? "EXACT" : "MASKED",
    contactDisclosureLevel: fixture.paymentState === "CAPTURED" ? "UNLOCKED" : "LOCKED",
    softEtaMinutes: fixture.providerKey ? 18 : null,
    hardEtaMinutes: fixture.requestState === "COMPLETED" ? 12 : null,
    etaStage: fixture.providerKey ? (fixture.requestState === "COMPLETED" ? "HARD" : "SOFT") : "PENDING",
    providerActivatedAt: fixture.paymentState === "CAPTURED" ? acceptedAt : null,
    exactLocationUnlockedAt: fixture.paymentState === "CAPTURED" ? acceptedAt : null,
    contactUnlockedAt: fixture.paymentState === "CAPTURED" ? acceptedAt : null,
    customerEtaAcceptedAt: fixture.requestState === "COMPLETED" ? shiftIso(submittedAt, 20) : null,
    arrivalConfirmedAt: fixture.requestState === "COMPLETED" ? arrivedAt : null,
    completionConfirmedAt: fixture.requestState === "COMPLETED" ? completedAt : null,
    paymentPromptedAt: fixture.requestState === "COMPLETED" ? shiftIso(submittedAt, 70) : null,
    noteExchange: fixture.requestState === "COMPLETED"
      ? [
          {
            actorRole: "PROVIDER",
            authorUserId: providerId,
            message: fixture.note,
            createdAt: shiftIso(submittedAt, 40)
          }
        ]
      : [],
    providerPayoutStatus: fixture.payoutState,
    amountCharged: amountCollected,
    amountCollected,
    refundIssued: false,
    refundFlag: false,
    disputeFlag: false,
    lastPaymentOrderId: fixture.paymentState === "CAPTURED" ? `sandbox-order-${fixture.requestId}` : null,
    serviceTaxAmount: pricing.serviceTaxAmount,
    providerTaxWithheld: pricing.providerTaxWithheld,
    assignmentFee: pricing.assignmentFee,
    dispatchFee: pricing.dispatchFee,
    platformShareAmount: pricing.platformShare,
    providerPayoutAmount: pricing.providerPayout,
    requestAcceptanceWindowMinutes: 720,
    requestAcceptanceExpiresAt: shiftIso(submittedAt, 720),
    dispatchRequeueCount: 0,
    lastRequeuedAt: null,
    expiredAt: null,
    submittedAt,
    createdAt: submittedAt,
    updatedAt,
    userId,
    roles: ["SUBSCRIBER"],
    subscriberActive: true,
    customerTier: "SUBSCRIBER",
    pricing,
    fullName: subscriber.fullName,
    phoneNumber: subscriber.phoneNumber,
    serviceType: fixture.serviceType,
    location: fixture.location,
    locationSummary: fixture.location,
    notes: fixture.note,
    vehicleInfo: formatSandboxVehicleLabel(subscriber.vehicle),
    termsAccepted: true,
    noRefundPolicyAccepted: true,
    dispatchOnlyLiabilityAccepted: true,
    liabilityNotice: AW_ROADSIDE_POLICY.platform.holdHarmless,
    amount: {
      currency_code: "USD",
      value: priorityServicePrice.toFixed(2)
    },
    maskedNotes: "Detailed customer notes unlock after payment and provider activation.",
    policyVersion: AW_ROADSIDE_POLICY.subscriber.termsVersion,
    assignedProviderId: providerId,
    acceptedAt,
    providerActions: fixture.providerKey
      ? buildSandboxProviderActionLog(providerId, submittedAt, fixture.requestState === "COMPLETED")
      : [],
    etaMinutes: fixture.providerKey ? 18 : null,
    etaUpdatedAt,
    arrivedAt,
    completedAt,
    payoutCompletedAt,
    payoutReference: fixture.payoutState === "COMPLETED" ? `sandbox-payout-${fixture.requestId}` : null,
    payoutBatchId: fixture.payoutState !== "UNASSIGNED" ? `sandbox-batch-${fixture.requestId}` : null,
    payoutItemId: fixture.payoutState !== "UNASSIGNED" ? `sandbox-item-${fixture.requestId}` : null,
    payoutLastEventType: fixture.payoutState === "COMPLETED"
      ? "PAYMENT.PAYOUTS-ITEM.SUCCEEDED"
      : fixture.payoutState === "PENDING"
        ? "PAYMENT.PAYOUTSBATCH.PROCESSING"
        : fixture.payoutState === "ON_HOLD"
          ? "PAYMENT.PAYOUTS-ITEM.HELD"
          : null,
    payoutLastEventAt: fixture.payoutState !== "UNASSIGNED" ? updatedAt : null,
    paymentProvider: fixture.paymentState === "CAPTURED" ? "paypal" : "manual-test-mode"
  };
}

function buildSandboxProviderActionLog(providerId, submittedAt, includeCompletion) {
  const actions = [
    {
      action: "accept",
      providerUserId: providerId,
      etaMinutes: 0,
      note: "",
      actorRole: "PROVIDER",
      createdAt: shiftIso(submittedAt, 8)
    },
    {
      action: "eta",
      providerUserId: providerId,
      etaMinutes: 18,
      note: "",
      actorRole: "PROVIDER",
      createdAt: shiftIso(submittedAt, 15)
    }
  ];

  if (includeCompletion) {
    actions.push(
      {
        action: "arrived",
        providerUserId: providerId,
        etaMinutes: 0,
        note: "",
        actorRole: "PROVIDER",
        createdAt: shiftIso(submittedAt, 55)
      },
      {
        action: "completed",
        providerUserId: providerId,
        etaMinutes: 0,
        note: "",
        actorRole: "PROVIDER",
        createdAt: shiftIso(submittedAt, 80)
      }
    );
  }

  return actions;
}

function findSandboxUserDescriptor(key) {
  const descriptor = SANDBOX_MANUAL_TEST_USERS.find((entry) => entry.key === key);
  if (!descriptor) {
    throw new Error(`Sandbox descriptor ${key} was not found.`);
  }
  return descriptor;
}

function formatSandboxVehicleLabel(vehicle) {
  if (!vehicle || typeof vehicle !== "object") {
    return "Vehicle details not provided from app runtime";
  }
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ");
}

function ensureFutureIso(value, daysFromNow) {
  const parsed = new Date(value || "").getTime();
  if (Number.isFinite(parsed) && parsed > Date.now()) {
    return new Date(parsed).toISOString();
  }
  return shiftIso(new Date().toISOString(), daysFromNow * 24 * 60);
}

function minutesAgoIso(minutes) {
  return new Date(Date.now() - Number(minutes || 0) * 60 * 1000).toISOString();
}

function shiftIso(baseIso, minutes) {
  const base = new Date(baseIso);
  return new Date(base.getTime() + Number(minutes || 0) * 60 * 1000).toISOString();
}

async function readUsersFromRuntimeStorage() {
  try {
    const raw = await fs.readFile(usersPath, "utf8");
    const users = JSON.parse(raw);
    return Array.isArray(users) ? users.map((user) => reconcileProviderDiscipline(user)) : [];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readUsers() {
  if (preferSqlStorageReads() && typeof storageAuthority.readUsers === "function") {
    const users = await storageAuthority.readUsers();
    return Array.isArray(users) ? users.map((user) => reconcileProviderDiscipline(user)) : [];
  }
  return readUsersFromRuntimeStorage();
}

async function writeUsers(users) {
  await fs.mkdir(authRoot, { recursive: true });
  const normalizedUsers = (Array.isArray(users) ? users : []).map((user) => reconcileProviderDiscipline(user));
  await fs.writeFile(usersPath, `${JSON.stringify(normalizedUsers, null, 2)}\n`);
  await storageAuthority.syncUsers(normalizedUsers);
}

function mutateUsers(mutator) {
  const task = async () => {
    const users = await readUsers();
    const result = await mutator(users);
    await writeUsers(users);
    broadcastSseEvent("users-updated", { timestamp: new Date().toISOString() });
    return result;
  };
  const run = userMutationQueue.then(task, task);
  userMutationQueue = run.catch(() => {});
  return run;
}

function allocateUserId(users) {
  return users.reduce((maxId, user) => Math.max(maxId, Number(user.id) || 0), 0) + 1;
}

async function readCacheJson(filePath, cacheTtlMs) {
  try {
    const stat = await fs.stat(filePath);
    if (Date.now() - stat.mtimeMs > cacheTtlMs) {
      return null;
    }
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeCacheJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function deleteFile(filePath) {
  await fs.rm(filePath, { force: true });
}

async function listCacheFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function createServiceRequest(serviceRequest) {
  const now = new Date().toISOString();
  const requestId = `req_${Date.now()}`;
  const customerType = resolveCustomerTier(serviceRequest);
  const resolvedLocation = await resolveRequestLocation(serviceRequest);
  const pricing = resolveServicePricing({
    ...serviceRequest,
    customerTier: customerType
  });
  const savedRequest = {
    id: requestId,
    requestId,
    status: "SUBMITTED",
    completionStatus: "OPEN",
    paymentStatus: "NOT_PAID",
    locationDisclosureLevel: "MASKED",
    contactDisclosureLevel: "LOCKED",
    softEtaMinutes: null,
    hardEtaMinutes: null,
    etaStage: "PENDING",
    providerActivatedAt: null,
    exactLocationUnlockedAt: null,
    contactUnlockedAt: null,
    customerEtaAcceptedAt: null,
    arrivalConfirmedAt: null,
    completionConfirmedAt: null,
    paymentPromptedAt: null,
    noteExchange: [],
    providerPayoutStatus: "UNASSIGNED",
    amountCharged: 0,
    amountCollected: 0,
    refundIssued: false,
    refundFlag: false,
    disputeFlag: false,
    lastPaymentOrderId: null,
    serviceTaxAmount: pricing.serviceTaxAmount,
    providerTaxWithheld: pricing.providerTaxWithheld,
    assignmentFee: pricing.assignmentFee,
    dispatchFee: pricing.dispatchFee,
    platformShareAmount: pricing.platformShare,
    providerPayoutAmount: pricing.providerPayout,
    requestAcceptanceWindowMinutes,
    requestAcceptanceExpiresAt: addMinutes(now, requestAcceptanceWindowMinutes),
    dispatchRequeueCount: 0,
    lastRequeuedAt: null,
    expiredAt: null,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
    ...serviceRequest,
    ...resolvedLocation,
    maskedNotes: "Detailed customer notes unlock after payment and provider activation.",
    customerTier: pricing.customerTier,
    pricing,
    policyVersion: AW_ROADSIDE_POLICY.termsVersion
  };

  await fs.mkdir(requestsRoot, { recursive: true });
  await fs.appendFile(requestLogPath, `${JSON.stringify(savedRequest)}\n`);
  await storageAuthority.syncRequests([savedRequest]);

  return savedRequest;
}

async function resolveRequestLocation(serviceRequest) {
  const explicitCoordinates = normalizeCoordinateRecord(
    serviceRequest?.locationCoordinates || {
      longitude: serviceRequest?.longitude,
      latitude: serviceRequest?.latitude
    }
  );
  if (explicitCoordinates) {
    return {
      locationCoordinates: explicitCoordinates,
      locationGeocodeSource: "provided-coordinates",
      locationGeocodedAt: new Date().toISOString()
    };
  }

  if (!locationService.isConfigured()) {
    return {};
  }

  const location = readOptionalString(serviceRequest?.location);
  if (!location) {
    return {};
  }

  try {
    const result = await locationService.forwardGeocode(location, { limit: 1, autocomplete: false });
    const match = Array.isArray(result.features) ? result.features[0] : null;
    const longitude = Number(match?.routableLongitude ?? match?.longitude);
    const latitude = Number(match?.routableLatitude ?? match?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return {};
    }

    return {
      locationCoordinates: {
        longitude,
        latitude
      },
      locationGeocodeSource: "mapbox-forward-geocode",
      locationGeocodedAt: new Date().toISOString(),
      locationMapboxId: match?.mapboxId || null,
      locationFullAddress: match?.fullAddress || serviceRequest.location,
      locationAccuracy: match?.accuracy || null
    };
  } catch {
    return {};
  }
}

function normalizeCoordinateRecord(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const longitude = Number(value.longitude);
  const latitude = Number(value.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }

  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return null;
  }

  return {
    longitude,
    latitude
  };
}

function addMinutes(value, minutes) {
  const base = new Date(value);
  if (Number.isNaN(base.getTime())) {
    return value;
  }
  return new Date(base.getTime() + Number(minutes || 0) * 60 * 1000).toISOString();
}

async function readRequestLogFromRuntimeStorage() {
  try {
    const raw = await fs.readFile(requestLogPath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .reverse();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readRequestLog() {
  if (preferSqlStorageReads() && typeof storageAuthority.readRequests === "function") {
    return storageAuthority.readRequests();
  }
  return readRequestLogFromRuntimeStorage();
}

async function readDispatchRequestLog() {
  const task = async () => {
    const [requests, users] = await Promise.all([readRequestLog(), readUsers()]);
    const reconciled = reconcilePendingRequestWindows(requests, users);
    if (reconciled.changed) {
      await writeRequestLog(reconciled.requests);
    }
    return reconciled.requests;
  };
  const run = requestMutationQueue.then(task, task);
  requestMutationQueue = run.catch(() => {});
  return run;
}

async function writeRequestLog(requests) {
  await fs.mkdir(requestsRoot, { recursive: true });
  const serialized = requests
    .slice()
    .reverse()
    .map((entry) => JSON.stringify(entry))
    .join("\n");
  await fs.writeFile(requestLogPath, serialized ? `${serialized}\n` : "");
  await storageAuthority.syncRequests(requests);
}

function mutateRequests(mutator) {
  const task = async () => {
    const requests = await readRequestLog();
    const result = await mutator(requests);
    await writeRequestLog(requests);
    broadcastSseEvent("requests-updated", { timestamp: new Date().toISOString() });
    return result;
  };
  const run = requestMutationQueue.then(task, task);
  requestMutationQueue = run.catch(() => {});
  return run;
}

async function updateRequestRecord(requestId, updater) {
  return mutateRequests(async (requests) => {
    const index = requests.findIndex((entry) => String(entry.id || entry.requestId) === String(requestId));
    if (index === -1) {
      throw new Error(`Request ${requestId} was not found.`);
    }

    const current = requests[index];
    requests[index] = {
      ...current,
      ...updater(current),
      id: current.id || current.requestId,
      requestId: current.requestId || current.id,
      updatedAt: new Date().toISOString()
    };
    return requests[index];
  });
}

async function applyLocalRequestAction(requestId, action, payload) {
  const normalizedAction = typeof action === "string" ? action.trim().toLowerCase() : "";
  const now = new Date().toISOString();
  const actorRole = resolveActionActorRole(payload);
  const providerUserId = Number.isInteger(Number(payload?.providerUserId)) ? Number(payload.providerUserId) : null;
  const userId = Number.isInteger(Number(payload?.userId)) ? Number(payload.userId) : null;
  const hasAdminAuthority = payload?.adminAction === true || actorRole === "ADMIN";
  const isForcedAction =
    normalizedAction === "force-accept" ||
    normalizedAction === "force-arrived" ||
    normalizedAction === "force-complete" ||
    normalizedAction === "mark-complete";
  const provider = providerUserId === null ? null : (await readUsers()).find((entry) => Number(entry.id) === providerUserId) || null;

  await readDispatchRequestLog();

  return updateRequestRecord(requestId, (request) => {
    if (isPendingProviderAcceptanceRequest(request) && isRequestAcceptanceExpired(request)) {
      const error = new Error("This request timed out before a provider accepted it.");
      error.statusCode = 409;
      error.code = "request-acceptance-expired";
      throw error;
    }

    const isProviderOnlyAction =
      normalizedAction === "accept" ||
      normalizedAction === "eta" ||
      normalizedAction === "soft-contact" ||
      normalizedAction === "hard-contact" ||
      normalizedAction === "arrived" ||
      normalizedAction === "completed" ||
      normalizedAction === "prompt-payment";
    const isCustomerOnlyAction =
      normalizedAction === "subscriber-accept-eta" ||
      normalizedAction === "customer-accept-eta" ||
      normalizedAction === "confirm-arrived" ||
      normalizedAction === "subscriber-arrived-confirm" ||
      normalizedAction === "confirm-completion" ||
      normalizedAction === "subscriber-completion-confirm";

    if (isForcedAction && !hasAdminAuthority) {
      const error = new Error("Administrative request actions require the admin workflow.");
      error.statusCode = 403;
      error.code = "admin-route-required";
      throw error;
    }

    if (isProviderOnlyAction && actorRole !== "PROVIDER" && !hasAdminAuthority) {
      const error = new Error("A provider session is required for this request action.");
      error.statusCode = 403;
      error.code = "provider-session-required";
      throw error;
    }

    if (isCustomerOnlyAction && actorRole !== "SUBSCRIBER" && !hasAdminAuthority) {
      const error = new Error("A subscriber session is required for this request action.");
      error.statusCode = 403;
      error.code = "subscriber-session-required";
      throw error;
    }

    if (normalizedAction === "note" && !["PROVIDER", "SUBSCRIBER", "ADMIN"].includes(actorRole)) {
      const error = new Error("A provider or subscriber session is required for request notes.");
      error.statusCode = 403;
      error.code = "request-note-session-required";
      throw error;
    }

    if (actorRole === "PROVIDER" && !hasAdminAuthority) {
      if (!Number.isInteger(providerUserId) || !provider) {
        const error = new Error("A valid provider session is required for this request action.");
        error.statusCode = 403;
        error.code = "provider-session-required";
        throw error;
      }

      if (normalizedAction === "accept") {
        if (!isRequestEligibleForProvider(request, provider)) {
          const error = new Error("This request is no longer eligible for the current provider.");
          error.statusCode = 409;
          error.code = "provider-request-ineligible";
          throw error;
        }
      } else if (Number(request?.assignedProviderId) !== providerUserId) {
        const error = new Error("Only the assigned provider can continue this dispatch.");
        error.statusCode = 403;
        error.code = "provider-not-assigned";
        throw error;
      }
    }

    if (
      (actorRole === "SUBSCRIBER" ||
        normalizedAction === "subscriber-accept-eta" ||
        normalizedAction === "customer-accept-eta" ||
        normalizedAction === "confirm-arrived" ||
        normalizedAction === "subscriber-arrived-confirm" ||
        normalizedAction === "confirm-completion" ||
        normalizedAction === "subscriber-completion-confirm") &&
      !hasAdminAuthority
    ) {
      if (!Number.isInteger(userId) || Number(request?.userId) !== userId) {
        const error = new Error("This request action is only available to the subscriber who placed the request.");
        error.statusCode = 403;
        error.code = "subscriber-request-mismatch";
        throw error;
      }
    }

    const providerActions = Array.isArray(request.providerActions) ? [...request.providerActions] : [];
    const next = {
      ...request
    };

    if (normalizedAction === "accept" || normalizedAction === "force-accept") {
      if (!hasAdminAuthority && readOptionalString(request?.status).toUpperCase() !== "SUBMITTED") {
        const error = new Error("This request has already been accepted or closed.");
        error.statusCode = 409;
        error.code = "request-not-open";
        throw error;
      }
      next.status = "ASSIGNED";
      next.assignedProviderId = payload.providerUserId ?? request.assignedProviderId ?? null;
      next.acceptedAt = now;
      next.providerPayoutStatus = request.providerPayoutStatus === "UNASSIGNED" ? "PENDING" : request.providerPayoutStatus;
    } else if (normalizedAction === "eta") {
      const nextEta = Number.isFinite(Number(payload.etaMinutes)) ? Number(payload.etaMinutes) : request.etaMinutes ?? null;
      next.status = "EN_ROUTE";
      next.etaMinutes = nextEta;
      next.etaUpdatedAt = now;
      if (isDirectCommunicationUnlocked(request)) {
        next.hardEtaMinutes = nextEta;
        next.etaStage = "HARD";
      } else {
        next.softEtaMinutes = nextEta;
        next.etaStage = "SOFT";
      }
    } else if (normalizedAction === "soft-contact") {
      next.softContactedAt = now;
      next.status = request.status === "SUBMITTED" ? "ASSIGNED" : request.status;
    } else if (normalizedAction === "hard-contact") {
      if (!isPaymentCaptured(request)) {
        const error = new Error("Payment must be captured before live communication is unlocked.");
        error.statusCode = 409;
        error.code = "payment-required-before-contact";
        throw error;
      }
      next.hardContactedAt = now;
      next.providerActivatedAt = now;
      next.exactLocationUnlockedAt = now;
      next.contactUnlockedAt = now;
      next.locationDisclosureLevel = "EXACT";
      next.contactDisclosureLevel = "UNLOCKED";
      next.status = "EN_ROUTE";
    } else if (normalizedAction === "arrived" || normalizedAction === "force-arrived") {
      next.status = "ARRIVED";
      next.arrivedAt = now;
    } else if (
      normalizedAction === "completed" ||
      normalizedAction === "force-complete" ||
      normalizedAction === "mark-complete"
    ) {
      next.status = "COMPLETED";
      next.completionStatus = "COMPLETED";
      next.completedAt = now;
      next.providerPayoutStatus =
        request.providerPayoutStatus === "UNASSIGNED" ? "PENDING" : request.providerPayoutStatus || "PENDING";
    } else if (normalizedAction === "subscriber-accept-eta" || normalizedAction === "customer-accept-eta") {
      if (readNumericValue(request.etaMinutes) === null) {
        throw new Error("A hard ETA must be recorded before customer ETA acceptance.");
      }
      next.customerEtaAcceptedAt = now;
      next.completionStatus = request.completionStatus || "OPEN";
    } else if (normalizedAction === "confirm-arrived" || normalizedAction === "subscriber-arrived-confirm") {
      next.arrivalConfirmedAt = now;
    } else if (normalizedAction === "confirm-completion" || normalizedAction === "subscriber-completion-confirm") {
      next.completionConfirmedAt = now;
      next.completionStatus = "CONFIRMED_BY_CUSTOMER";
    } else if (normalizedAction === "prompt-payment") {
      next.paymentPromptedAt = now;
      next.paymentStatus = request.paymentStatus === "CAPTURED" ? request.paymentStatus : "PROMPTED";
    } else if (normalizedAction === "note") {
      const noteMessage = readRequiredString(payload.note || payload.message, "note");
      const noteExchange = Array.isArray(request.noteExchange) ? [...request.noteExchange] : [];
      noteExchange.unshift({
        actorRole: readOptionalString(payload.actorRole).toUpperCase() || resolveActionActorRole(payload),
        authorUserId:
          Number.isInteger(Number(payload?.providerUserId))
            ? Number(payload.providerUserId)
            : Number.isInteger(Number(payload?.userId))
              ? Number(payload.userId)
              : null,
        message: noteMessage,
        createdAt: now
      });
      next.noteExchange = noteExchange.slice(0, 50);
    } else {
      throw new Error(`Unsupported provider action: ${action}`);
    }

    providerActions.unshift({
      action: normalizedAction,
      providerUserId,
      etaMinutes: Number.isFinite(Number(payload.etaMinutes)) ? Number(payload.etaMinutes) : null,
      note: readOptionalString(payload.note),
      actorRole,
      createdAt: now
    });
    next.providerActions = providerActions.slice(0, 20);
    return next;
  });
}

function resolveActionActorRole(payload) {
  const actorRole = readOptionalString(payload.actorRole).toUpperCase();
  if (actorRole) {
    return actorRole;
  }
  if (Number.isInteger(Number(payload?.providerUserId))) {
    return "PROVIDER";
  }
  if (Number.isInteger(Number(payload?.userId))) {
    return "SUBSCRIBER";
  }
  if (payload.adminAction === true) {
    return "ADMIN";
  }
  return "SYSTEM";
}

function calculateProviderRatingSummary(user) {
  const ratingTotal = Number(user?.providerProfile?.rates?.ratingTotal || 0);
  const ratingCount = Number(user?.providerProfile?.rates?.ratingCount || 0);
  const averageRating = ratingCount > 0 ? Number((ratingTotal / ratingCount).toFixed(2)) : 0;
  return {
    ratingTotal,
    ratingCount,
    averageRating,
    ratingRange: `${PROVIDER_RATING_MIN} to ${PROVIDER_RATING_MAX}`
  };
}

function calculateProviderSelectionSummary(user) {
  const rating = calculateProviderRatingSummary(user);
  const availabilityScore = Boolean(user?.available) ? 35 : 0;
  const approvedScore = user?.providerStatus === "APPROVED" ? 25 : 0;
  const locationScore = readOptionalString(user?.providerProfile?.currentLocation) ? 10 : 0;
  const hoursScore = user?.providerProfile?.hoursOfService?.hasHours ? 10 : 0;
  const ratingScore = Math.min(rating.averageRating * 5, 40);
  return {
    available: Boolean(user?.available),
    currentLocation: readOptionalString(user?.providerProfile?.currentLocation) || null,
    score: Number((availabilityScore + approvedScore + locationScore + hoursScore + ratingScore).toFixed(2)),
    rating
  };
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".json":
      return "application/json; charset=utf-8";
    case ".html":
    default:
      return "text/html; charset=utf-8";
  }
}

async function recordBlockedFallback(pathname, reason) {
  try {
    await watchdog.record("blocked-web-fallback", {
      pathname,
      reason
    });
  } catch (error) {
    console.error("[WARN] Failed to record blocked fallback:", error);
  }
}
