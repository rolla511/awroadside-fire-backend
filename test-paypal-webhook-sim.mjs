import { getAccessToken } from "../backend/paypal-client.mjs";
import { sandboxWebhookEvents } from "./paypal-webhook-events.mjs";

const DEFAULT_WEBHOOK_PATH = "/api/paypal/webhook";
const DEFAULT_EVENT_TYPE = "PAYMENT.CAPTURE.COMPLETED";
const DEFAULT_TIMEOUT_MS = 15000;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.listEvents) {
    printSandboxEvents();
    return;
  }

  const targetBaseUrl = resolveTargetBaseUrl(options);
  const targetWebhookUrl = resolveTargetWebhookUrl(targetBaseUrl, options.path);
  const eventType = options.eventType || DEFAULT_EVENT_TYPE;
  const webhookId = options.webhookId || readOptionalEnv("PAYPAL_WEBHOOK_ID");
  const resourceVersion = options.resourceVersion || undefined;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  console.log(`[webhook-sim] target base url: ${targetBaseUrl}`);
  console.log(`[webhook-sim] target webhook url: ${targetWebhookUrl}`);
  console.log(`[webhook-sim] event type: ${eventType}`);
  console.log(`[webhook-sim] webhook id source: ${webhookId ? "env/arg" : "url-only"}`);

  const config = await fetchRuntimePaymentConfig(targetBaseUrl);
  if (config) {
    console.log(
      `[webhook-sim] runtime webhook config: path=${config.webhookPath || "unknown"} configured=${String(config.webhookConfigured)} mode=${config.mode || "unknown"}`
    );
  } else {
    console.log("[webhook-sim] runtime payment config unavailable from target base url");
  }

  const token = await getAccessToken();
  const apiBaseUrl = resolvePaypalApiBaseUrl();
  const simulatePayload = {
    event_type: eventType,
    ...(resourceVersion ? { resource_version: resourceVersion } : {}),
    ...(webhookId ? { webhook_id: webhookId } : { url: targetWebhookUrl })
  };

  console.log("[webhook-sim] sending PayPal sandbox simulation request...");
  const startedAt = Date.now();
  const response = await fetch(`${apiBaseUrl}/v1/notifications/simulate-event`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(simulatePayload)
  });
  const responseText = await response.text();
  const responsePayload = tryParseJson(responseText);

  console.log(`[webhook-sim] simulate-event status: ${response.status}`);
  console.log(
    `[webhook-sim] simulate-event response: ${JSON.stringify(responsePayload ?? responseText, null, 2)}`
  );

  if (!response.ok) {
    process.exitCode = 1;
    return;
  }

  const localLogResult = await maybeWatchLocalWebhookLog(targetBaseUrl, startedAt, timeoutMs);
  if (localLogResult) {
    console.log(
      `[webhook-sim] local webhook log detected: ${JSON.stringify(localLogResult, null, 2)}`
    );
    return;
  }

  console.log("[webhook-sim] simulation accepted by PayPal.");
  console.log("[webhook-sim] for Render targets, confirm delivery in Render logs and webhook processing state.");
}

function parseArgs(argv) {
  const options = {
    baseUrl: "",
    path: DEFAULT_WEBHOOK_PATH,
    eventType: DEFAULT_EVENT_TYPE,
    webhookId: "",
    resourceVersion: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    listEvents: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }
    if (value === "--list-events") {
      options.listEvents = true;
      continue;
    }
    if (value === "--base-url") {
      options.baseUrl = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (value === "--path") {
      options.path = argv[index + 1] || DEFAULT_WEBHOOK_PATH;
      index += 1;
      continue;
    }
    if (value === "--event") {
      options.eventType = argv[index + 1] || DEFAULT_EVENT_TYPE;
      index += 1;
      continue;
    }
    if (value === "--webhook-id") {
      options.webhookId = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (value === "--resource-version") {
      options.resourceVersion = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (value === "--timeout-ms") {
      options.timeoutMs = Number.parseInt(argv[index + 1] || `${DEFAULT_TIMEOUT_MS}`, 10) || DEFAULT_TIMEOUT_MS;
      index += 1;
      continue;
    }
  }

  return options;
}

function resolveTargetBaseUrl(options) {
  const explicit = String(options.baseUrl || "").trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  const envBase =
    readOptionalEnv("WEBHOOK_SIM_BASE_URL") ||
    readOptionalEnv("PUBLIC_BASE_URL") ||
    "http://127.0.0.1:3000";
  return envBase.replace(/\/$/, "");
}

function resolveTargetWebhookUrl(baseUrl, path) {
  const normalizedPath = String(path || DEFAULT_WEBHOOK_PATH).startsWith("/")
    ? String(path || DEFAULT_WEBHOOK_PATH)
    : `/${String(path || DEFAULT_WEBHOOK_PATH)}`;
  return `${baseUrl}${normalizedPath}`;
}

function resolvePaypalApiBaseUrl() {
  const env = String(process.env.PAYPAL_ENV || "sandbox").trim().toLowerCase();
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function fetchRuntimePaymentConfig(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/payments/config`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

async function maybeWatchLocalWebhookLog(baseUrl, startedAt, timeoutMs) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl)) {
    return null;
  }

  const { promises: fs } = await import("node:fs");
  const logPath = new URL("../app/runtime/payments/paypal-webhooks.jsonl", import.meta.url);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(logPath, "utf8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const match = lines
        .map((line) => tryParseJson(line))
        .filter(Boolean)
        .reverse()
        .find((entry) => Date.parse(entry.receivedAt || entry.timestamp || "") >= startedAt);
      if (match) {
        return match;
      }
    } catch {
      // Ignore while polling.
    }
    await delay(1000);
  }

  return null;
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readOptionalEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printHelp() {
  console.log(`Usage: node scripts/test-paypal-webhook-sim.mjs [options]

Options:
  --list-events             Print the clean sandbox event inventory
  --base-url <url>          Target base URL. Defaults to WEBHOOK_SIM_BASE_URL, PUBLIC_BASE_URL, or http://127.0.0.1:3000
  --path <path>             Webhook path. Default: ${DEFAULT_WEBHOOK_PATH}
  --event <event-type>      PayPal event type. Default: ${DEFAULT_EVENT_TYPE}
  --webhook-id <id>         PayPal webhook ID. Defaults to PAYPAL_WEBHOOK_ID
  --resource-version <v>    Optional PayPal resource version
  --timeout-ms <ms>         Local log polling timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --help                    Show this help

Examples:
  node scripts/test-paypal-webhook-sim.mjs --list-events
  node scripts/test-paypal-webhook-sim.mjs --base-url https://your-render-app.onrender.com --event PAYMENT.CAPTURE.COMPLETED
  PAYPAL_WEBHOOK_ID=ABC123 node scripts/test-paypal-webhook-sim.mjs --event PAYMENT.PAYOUTS-ITEM.SUCCEEDED
`);
}

function printSandboxEvents() {
  console.log(
    JSON.stringify(
      {
        environment: "sandbox",
        count: sandboxWebhookEvents.length,
        events: sandboxWebhookEvents
      },
      null,
      2
    )
  );
}

await main();
