import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeRoot = path.resolve(__dirname, process.env.RUNTIME_ROOT || "app/runtime");
const intakeRoot = path.join(runtimeRoot, "index-intake");
const intakeLogPath = path.join(intakeRoot, "intake-events.jsonl");
const intakeStatusPath = path.join(intakeRoot, "latest-status.json");
const MAX_RECENT_ENTRIES = 200;
const REDACTED_KEY_PATTERN = /(secret|token|authorization|cookie|card|cvv|cvc)/i;

function sanitizeValue(value, depth = 0) {
  if (depth > 5) {
    return "[truncated]";
  }
  if (typeof value === "string") {
    return value.length > 4000 ? `${value.slice(0, 4000)}...[truncated]` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = REDACTED_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeValue(entry, depth + 1);
  }
  return sanitized;
}

function createIndexRuntimeBuffer() {
  const recentEntries = [];
  const summary = {
    received: 0,
    processed: 0,
    rejected: 0,
    lastReceivedAt: null,
    lastProcessedAt: null,
    lastRejectedAt: null
  };

  return {
    runtimeEntry: "index.mjs",
    intakeRoot,
    intakeLogPath,
    async retain({ pathname, method, payload, remoteAddress, userAgent, contentType, details = {} } = {}) {
      const now = new Date().toISOString();
      const entry = {
        id: `intake_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        stage: "received",
        createdAt: now,
        runtimeEntry: "index.mjs",
        pathname: typeof pathname === "string" ? pathname : "/",
        method: typeof method === "string" ? method.toUpperCase() : "POST",
        remoteAddress: typeof remoteAddress === "string" ? remoteAddress : null,
        userAgent: typeof userAgent === "string" ? userAgent : null,
        contentType: typeof contentType === "string" ? contentType : null,
        details: sanitizeValue(details),
        payload: sanitizeValue(payload)
      };
      recentEntries.unshift(entry);
      if (recentEntries.length > MAX_RECENT_ENTRIES) {
        recentEntries.length = MAX_RECENT_ENTRIES;
      }
      summary.received += 1;
      summary.lastReceivedAt = now;
      await persistEntry(entry);
      return {
        id: entry.id,
        pathname: entry.pathname,
        receivedAt: entry.createdAt
      };
    },
    async markProcessed(receipt, details = {}) {
      if (!receipt?.id) {
        return;
      }
      const now = new Date().toISOString();
      summary.processed += 1;
      summary.lastProcessedAt = now;
      await persistEntry({
        id: receipt.id,
        stage: "processed",
        createdAt: now,
        runtimeEntry: "index.mjs",
        details: sanitizeValue(details)
      });
    },
    async markRejected(receipt, error, details = {}) {
      if (!receipt?.id) {
        return;
      }
      const now = new Date().toISOString();
      summary.rejected += 1;
      summary.lastRejectedAt = now;
      await persistEntry({
        id: receipt.id,
        stage: "rejected",
        createdAt: now,
        runtimeEntry: "index.mjs",
        error: error instanceof Error ? error.message : String(error),
        details: sanitizeValue(details)
      });
    },
    getStatus() {
      return {
        runtimeEntry: "index.mjs",
        intakeRoot,
        intakeLogPath,
        summary: { ...summary },
        recentEntries: recentEntries.slice(0, 10).map((entry) => ({
          id: entry.id,
          stage: entry.stage,
          createdAt: entry.createdAt,
          pathname: entry.pathname,
          method: entry.method
        }))
      };
    }
  };

  async function persistEntry(entry) {
    const line = `${JSON.stringify(entry)}\n`;
    try {
      await fs.mkdir(intakeRoot, { recursive: true });
      await fs.appendFile(intakeLogPath, line, "utf8");
      await fs.writeFile(
        intakeStatusPath,
        JSON.stringify({
          runtimeEntry: "index.mjs",
          intakeRoot,
          intakeLogPath,
          summary: { ...summary }
        }, null, 2)
      );
    } catch (error) {
      console.warn(`[WARN] Failed to persist index intake entry: ${error.message}`);
    }
  }
}

if (!globalThis.__AW_INDEX_RUNTIME_BUFFER__) {
  globalThis.__AW_INDEX_RUNTIME_BUFFER__ = createIndexRuntimeBuffer();
}

if (!process.env.AW_RUNTIME_ENTRYPOINT) {
  process.env.AW_RUNTIME_ENTRYPOINT = "index.mjs";
}

export const indexRuntimeBuffer = globalThis.__AW_INDEX_RUNTIME_BUFFER__;

await import("./server.mjs");
