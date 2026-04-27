import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const WATCHED_RELATIVE_FILES = [
  "backend/server.mjs",
  "backend/awroadsidedb-config.mjs",
  "backend/storage/index.mjs",
  "backend/storage/users-repository.mjs",
  "backend/storage/requests-repository.mjs",
  "backend/storage/provider-wallet-repository.mjs",
  "backend/storage/provider-history-repository.mjs",
  "backend/storage/payments-repository.mjs",
  "backend/storage/schema.mjs",
  "backend/storage/sql-helpers.mjs",
  "backend/aw-roadside-security.mjs",
  "backend/subscription-controller.mjs",
  "backend/smtp-mailer.mjs",
  "backend/request-service-controller.mjs",
  "backend/admin-controller.mjs",
  "web/app.js",
  "web/index.html",
  "web/customer.html",
  "web/provider.html",
  "package.json"
];

export function createLocalWatchdog({ projectRoot, runtimeRoot }) {
  const securityRoot = path.join(runtimeRoot, "security");
  const baselinePath = path.join(securityRoot, "baseline.json");
  const auditLogPath = path.join(securityRoot, "watchdog-events.jsonl");
  const latestStatusPath = path.join(securityRoot, "latest-status.json");
  let intervalHandle = null;

  return {
    securityRoot,
    baselinePath,
    auditLogPath,
    latestStatusPath,
    async initialize() {
      await fs.mkdir(securityRoot, { recursive: true });
      const baseline = await readBaseline();
      if (baseline) {
        return baseline;
      }

      const createdBaseline = await createBaseline();
      await appendAuditLog({
        event: "baseline-created",
        fileCount: createdBaseline.files.length
      });
      await writeLatestStatus({
        layer: "aw-roadside-local-watchdog",
        active: true,
        scannedAt: new Date().toISOString(),
        baselineCreatedAt: createdBaseline.createdAt,
        watchedFiles: createdBaseline.files.length,
        integrityOk: true,
        suspiciousFiles: [],
        recentEvents: await readRecentAuditEvents(auditLogPath)
      });
      return createdBaseline;
    },
    async getStatus() {
      const baseline = await this.initialize();
      const currentFiles = await hashWatchedFiles(projectRoot);
      const changes = compareFiles(baseline.files, currentFiles);
      const suspiciousFiles = changes.filter((change) => change.status !== "unchanged");
      const recentEvents = await readRecentAuditEvents(auditLogPath);

      const status = {
        layer: "aw-roadside-local-watchdog",
        active: true,
        scannedAt: new Date().toISOString(),
        baselineCreatedAt: baseline.createdAt,
        watchedFiles: currentFiles.length,
        integrityOk: suspiciousFiles.length === 0,
        suspiciousFiles,
        recentEvents
      };
      await writeLatestStatus(status);
      return status;
    },
    async record(event, details = {}) {
      await fs.mkdir(securityRoot, { recursive: true });
      await appendAuditLog({
        event,
        ...details
      });
    },
    async scanAndRecord() {
      const status = await this.getStatus();
      if (!status.integrityOk) {
        await this.record("integrity-drift-detected", {
          suspiciousFiles: status.suspiciousFiles
        });
      }
      await writeLatestStatus({
        ...status,
        recentEvents: await readRecentAuditEvents(auditLogPath)
      });
      return status;
    },
    async refreshBaseline() {
      await fs.mkdir(securityRoot, { recursive: true });
      const baseline = await createBaseline();
      await appendAuditLog({
        event: "baseline-refreshed",
        fileCount: baseline.files.length
      });
      const status = {
        layer: "aw-roadside-local-watchdog",
        active: true,
        scannedAt: new Date().toISOString(),
        baselineCreatedAt: baseline.createdAt,
        watchedFiles: baseline.files.length,
        integrityOk: true,
        suspiciousFiles: [],
        recentEvents: await readRecentAuditEvents(auditLogPath)
      };
      await writeLatestStatus(status);
      return status;
    },
    startPeriodicScan(intervalMs) {
      this.stopPeriodicScan();
      intervalHandle = setInterval(() => {
        this.scanAndRecord().catch(async (error) => {
          await this.record("periodic-scan-failed", {
            message: error instanceof Error ? error.message : String(error)
          });
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

  async function createBaseline() {
    const files = await hashWatchedFiles(projectRoot);
    const baseline = {
      createdAt: new Date().toISOString(),
      files
    };
    await fs.writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    return baseline;
  }

  async function readBaseline() {
    try {
      const raw = await fs.readFile(baselinePath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async function appendAuditLog(entry) {
    await fs.appendFile(
      auditLogPath,
      `${JSON.stringify({ ...entry, timestamp: new Date().toISOString() })}\n`
    );
  }

  async function writeLatestStatus(status) {
    await fs.writeFile(latestStatusPath, `${JSON.stringify(status, null, 2)}\n`);
  }
}

async function hashWatchedFiles(projectRoot) {
  const files = [];

  for (const relativePath of WATCHED_RELATIVE_FILES) {
    const absolutePath = path.join(projectRoot, relativePath);
    try {
      const raw = await fs.readFile(absolutePath);
      const stat = await fs.stat(absolutePath);
      files.push({
        path: relativePath,
        sha256: crypto.createHash("sha256").update(raw).digest("hex"),
        bytes: stat.size,
        mtime: stat.mtime.toISOString()
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        files.push({
          path: relativePath,
          missing: true
        });
        continue;
      }
      throw error;
    }
  }

  return files;
}

function compareFiles(baselineFiles, currentFiles) {
  const baselineMap = new Map(baselineFiles.map((entry) => [entry.path, entry]));

  return currentFiles.map((current) => {
    const baseline = baselineMap.get(current.path);
    if (!baseline) {
      return {
        path: current.path,
        status: "untracked"
      };
    }

    if (baseline.missing && current.missing) {
      return {
        path: current.path,
        status: "unchanged"
      };
    }

    if (Boolean(baseline.missing) !== Boolean(current.missing)) {
      return {
        path: current.path,
        status: current.missing ? "missing-now" : "appeared"
      };
    }

    if (baseline.sha256 !== current.sha256) {
      return {
        path: current.path,
        status: "modified",
        baselineSha256: baseline.sha256,
        currentSha256: current.sha256
      };
    }

    return {
      path: current.path,
      status: "unchanged"
    };
  });
}

async function readRecentAuditEvents(auditLogPath) {
  try {
    const raw = await fs.readFile(auditLogPath, "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-10)
      .map((line) => JSON.parse(line))
      .reverse();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
