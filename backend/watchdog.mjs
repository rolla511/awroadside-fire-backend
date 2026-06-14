import fs from "fs";
import path from "path";
const { promises: fsPromises } = fs;

const WATCHDOG_RETENTION_BUSINESS_DAYS = 14;
const WATCHDOG_RECENT_EVENT_LIMIT = 25;
const WATCHDOG_LAYER = "aw-roadside-watchdog";
const LEGACY_GENERATED_EVENTS = new Set([
  "baseline-created",
  "baseline-refreshed",
  "integrity-drift-detected",
  "periodic-scan-failed"
]);

export function createWatchdog({ runtimeRoot }) {
  const securityRoot = path.join(runtimeRoot, "security");
  const auditLogPath = path.join(securityRoot, "watchdog-events.jsonl");
  const latestStatusPath = path.join(securityRoot, "latest-status.json");
  let intervalHandle = null;

  return {
    securityRoot,
    auditLogPath,
    latestStatusPath,
    async initialize() {
      return ensureCurrentStatus();
    },
    async getStatus() {
      return ensureCurrentStatus();
    },
    async record(event, details = {}) {
      await ensureSecurityRoot(securityRoot);
      const retainedEvents = pruneExpiredEvents(await readAuditLog(auditLogPath));
      retainedEvents.push(buildEventEntry(event, details));
      const nextEvents = pruneExpiredEvents(retainedEvents);
      await writeAuditLog(auditLogPath, nextEvents);
      const status = buildStatus(nextEvents);
      await writeLatestStatus(latestStatusPath, status);
      return status;
    },
    async scanAndRecord() {
      return ensureCurrentStatus();
    },
    async refreshBaseline() {
      return ensureCurrentStatus();
    },
    startPeriodicScan(intervalMs) {
      this.stopPeriodicScan();
      intervalHandle = setInterval(() => {
        this.getStatus().catch((error) => {
          console.warn("[WARN] Watchdog status refresh failed:", error.message);
        });
      }, intervalMs);
      intervalHandle.unref?.();
      return intervalHandle;
    },
    stopPeriodicScan() {
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    }
  };

  async function ensureCurrentStatus() {
    await ensureSecurityRoot(securityRoot);
    const retainedEvents = pruneExpiredEvents(await readAuditLog(auditLogPath));
    await writeAuditLog(auditLogPath, retainedEvents);
    const status = buildStatus(retainedEvents);
    await writeLatestStatus(latestStatusPath, status);
    return status;
  }
}

export const createLocalWatchdog = createWatchdog;

function buildEventEntry(event, details) {
  return {
    event: normalizeEventName(event),
    ...normalizeEventDetails(details),
    timestamp: new Date().toISOString()
  };
}

function normalizeEventName(event) {
  return typeof event === "string" && event.trim() ? event.trim() : "watchdog-event";
}

function normalizeEventDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }
  return details;
}

function buildStatus(events) {
  const lastRecordedAt = events.at(-1)?.timestamp || null;
  const oldestRetainedAt = events[0]?.timestamp || null;

  return {
    layer: WATCHDOG_LAYER,
    active: true,
    logMode: "retained-runtime-log",
    retainedStorage: "app-runtime-security",
    retentionBusinessDays: WATCHDOG_RETENTION_BUSINESS_DAYS,
    refreshedAt: new Date().toISOString(),
    eventCount: events.length,
    lastRecordedAt,
    oldestRetainedAt,
    recentEvents: events.slice(-WATCHDOG_RECENT_EVENT_LIMIT).reverse()
  };
}

async function ensureSecurityRoot(securityRoot) {
  try {
    await fsPromises.mkdir(securityRoot, { recursive: true });
  } catch (error) {
    console.warn(`[WARN] Failed to create securityRoot ${securityRoot}:`, error.message);
  }
}

async function readAuditLog(auditLogPath) {
  try {
    const raw = await fsPromises.readFile(auditLogPath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry) => entry && typeof entry === "object" && !LEGACY_GENERATED_EVENTS.has(entry.event))
      .sort((left, right) => String(left.timestamp || "").localeCompare(String(right.timestamp || "")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    console.warn(`[WARN] Failed to read watchdog audit log ${auditLogPath}:`, error.message);
    return [];
  }
}

function pruneExpiredEvents(events, now = new Date()) {
  const cutoff = subtractBusinessDays(now, WATCHDOG_RETENTION_BUSINESS_DAYS);
  return events.filter((entry) => {
    const timestamp = parseTimestamp(entry?.timestamp);
    return timestamp && timestamp >= cutoff;
  });
}

function parseTimestamp(value) {
  const timestamp = new Date(typeof value === "string" ? value : "");
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function subtractBusinessDays(referenceDate, businessDays) {
  const cutoff = new Date(referenceDate);
  let remaining = businessDays;

  while (remaining > 0) {
    cutoff.setUTCDate(cutoff.getUTCDate() - 1);
    const day = cutoff.getUTCDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return cutoff;
}

async function writeAuditLog(auditLogPath, events) {
  try {
    const serialized = events.map((entry) => JSON.stringify(entry)).join("\n");
    await fsPromises.writeFile(auditLogPath, serialized ? `${serialized}\n` : "", "utf8");
  } catch (error) {
    console.warn(`[WARN] Failed to write watchdog audit log ${auditLogPath}:`, error.message);
  }
}

async function writeLatestStatus(latestStatusPath, status) {
  try {
    await fsPromises.writeFile(latestStatusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn(`[WARN] Failed to write latest status to ${latestStatusPath}:`, error.message);
  }
}
