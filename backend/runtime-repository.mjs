import { promises as fs } from "fs";
import path from "path";

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_PROJECT_ID = "awroadside-fire";
const DEFAULT_ACTIVE_VARIANT_ID = "awroadside-fire-backend";
const DEFAULT_VARIANT_MODE = "active";

export function createRuntimeRepository({ runtimeRoot }) {
  const repositoryPath = path.join(runtimeRoot, "compatibility-repository.json");
  let state = createEmptyState();

  return {
    async initialize() {
      try {
        await fs.mkdir(runtimeRoot, { recursive: true });
      } catch (error) {
        console.error(`[WARN] Failed to create runtimeRoot ${runtimeRoot}:`, error.message);
        // If it's a permission error and we are on Render, we might be hitting a read-only area
        // or the disk hasn't been properly initialized/mounted yet.
      }
      state = await readState(repositoryPath);
      await persist(repositoryPath, state);
    },
    async recordCapabilityAccess(capability, descriptor = {}, details = {}) {
      if (!capability) {
        return null;
      }

      const now = new Date().toISOString();
      const record = state.records[capability] || createRecord(capability);
      const status = normalizeStatus(details.status);
      const staleAfterMs = normalizeStaleAfterMs(
        details.staleAfterMs ?? descriptor.staleAfterMs ?? record.staleAfterMs
      );

      record.capability = capability;
      record.method = descriptor.method || record.method || null;
      record.path = descriptor.path || record.path || null;
      record.authority = descriptor.authority || record.authority || "unknown";
      record.cacheAllowed =
        typeof descriptor.cacheAllowed === "boolean"
          ? descriptor.cacheAllowed
          : typeof details.cacheAllowed === "boolean"
            ? details.cacheAllowed
            : record.cacheAllowed;
      record.legacyFallback =
        descriptor.legacyFallback !== undefined ? descriptor.legacyFallback : record.legacyFallback;
      record.staleAfterMs = staleAfterMs;
      record.requestCount += 1;
      record.lastRequestedAt = now;
      record.lastServedAt = now;
      record.lastStatus = status;
      record.lastSource = normalizeString(details.source) || "compatibility-gateway";
      record.lastRequester = normalizeString(details.requester) || record.lastRequester || null;
      record.lastNote = normalizeString(details.note) || null;
      record.lastError = status === "failure" ? normalizeString(details.error) || null : null;
      record.lastUpdatedAt = now;
      record.staleAt = staleAfterMs === null ? null : new Date(Date.now() + staleAfterMs).toISOString();

      if (status === "failure") {
        record.failureCount += 1;
      } else {
        record.successCount += 1;
      }

      state.records[capability] = record;
      state.updatedAt = now;
      await persist(repositoryPath, state);
      return { ...record };
    },
    async getSnapshot() {
      state = await readState(repositoryPath);
      return {
        repository: "aw-roadside-runtime-repository",
        repositoryPath,
        manifest: state.manifest,
        updatedAt: state.updatedAt,
        recordCount: Object.keys(state.records).length,
        records: Object.values(state.records).sort((left, right) =>
          String(right.lastRequestedAt || "").localeCompare(String(left.lastRequestedAt || ""))
        )
      };
    },
    async getManifest() {
      state = await readState(repositoryPath);
      return {
        manifest: state.manifest,
        updatedAt: state.updatedAt
      };
    },
    async acknowledgeVariant(payload = {}) {
      state = await readState(repositoryPath);
      const now = new Date().toISOString();
      const variantId = normalizeString(payload.variantId);
      if (!variantId) {
        const error = new Error("A variantId is required.");
        error.statusCode = 400;
        error.code = "missing-variant-id";
        throw error;
      }

      const projectId = normalizeString(payload.projectId) || state.manifest.projectId;
      const declaredMode = normalizeString(payload.mode).toLowerCase();
      const activeVariantId = state.manifest.activeVariantId;
      const mode =
        projectId !== state.manifest.projectId
          ? "reference-only"
          : declaredMode === "reference-only"
            ? "reference-only"
            : variantId === activeVariantId
              ? "active"
              : "limited";

      const acknowledgement = {
        variantId,
        projectId,
        mode,
        sdkVersion: normalizeString(payload.sdkVersion) || null,
        appVersion: normalizeString(payload.appVersion) || null,
        platform: normalizeString(payload.platform) || null,
        note: normalizeString(payload.note) || null,
        acknowledgedAt: now
      };

      state.acknowledgedVariants = state.acknowledgedVariants.filter((entry) => entry.variantId !== variantId);
      state.acknowledgedVariants.unshift(acknowledgement);
      state.acknowledgedVariants = state.acknowledgedVariants.slice(0, 25);
      state.updatedAt = now;
      await persist(repositoryPath, state);

      return {
        acknowledged: true,
        manifest: state.manifest,
        variant: acknowledgement
      };
    }
  };
}

function createEmptyState() {
  return {
    updatedAt: null,
    manifest: createManifest(),
    records: {},
    acknowledgedVariants: []
  };
}

function createManifest() {
  return {
    projectId: DEFAULT_PROJECT_ID,
    activeVariantId: DEFAULT_ACTIVE_VARIANT_ID,
    mode: DEFAULT_VARIANT_MODE,
    authority: "protected-backend",
    releaseStrategy: "acknowledge-before-write",
    generatedAt: new Date().toISOString()
  };
}

function createRecord(capability) {
  return {
    capability,
    method: null,
    path: null,
    authority: null,
    cacheAllowed: false,
    legacyFallback: false,
    staleAfterMs: DEFAULT_STALE_AFTER_MS,
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    lastRequestedAt: null,
    lastServedAt: null,
    lastStatus: null,
    lastSource: null,
    lastRequester: null,
    lastNote: null,
    lastError: null,
    staleAt: null,
    lastUpdatedAt: null
  };
}

async function readState(repositoryPath) {
  try {
    const raw = await fs.readFile(repositoryPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.records !== "object") {
      return createEmptyState();
    }
    return {
      updatedAt: parsed.updatedAt || null,
      manifest: {
        ...createManifest(),
        ...(parsed.manifest || {})
      },
      records: parsed.records || {},
      acknowledgedVariants: Array.isArray(parsed.acknowledgedVariants) ? parsed.acknowledgedVariants : []
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return createEmptyState();
    }
    throw error;
  }
}

async function persist(repositoryPath, state) {
  try {
    await fs.writeFile(repositoryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error(`[WARN] Failed to persist state to ${repositoryPath}:`, error.message);
  }
}

function normalizeStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "failure" || normalized === "error" || normalized === "rejected") {
    return "failure";
  }
  return "success";
}

function normalizeStaleAfterMs(value) {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STALE_AFTER_MS;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}
