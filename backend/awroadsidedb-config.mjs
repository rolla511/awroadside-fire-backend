const DEFAULT_POSTGRES_PORT = 5432;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readBooleanEnv(value, fallback = false) {
  const normalized = normalizeString(value).toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeDbMode(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "external-db" || normalized === "internal-db") {
    return "internal-db";
  }
  if (normalized === "file-runtime" || normalized === "runtime" || normalized === "runtime-storage") {
    return "runtime-storage";
  }
  return normalized;
}

function sanitizeConnectionString(value) {
  const candidate = normalizeString(value);
  if (!candidate) {
    return "";
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return "[invalid-connection-string]";
  }
}

function parseConnectionString(value) {
  const candidate = normalizeString(value);
  if (!candidate) {
    return {
      host: "",
      port: null,
      database: "",
      user: ""
    };
  }
  try {
    const parsed = new URL(candidate);
    return {
      host: normalizeString(parsed.hostname),
      port: Number.parseInt(normalizeString(parsed.port), 10) || null,
      database: normalizeString(parsed.pathname.replace(/^\/+/, "")),
      user: normalizeString(parsed.username)
    };
  } catch {
    return {
      host: "",
      port: null,
      database: "",
      user: ""
    };
  }
}

export function createAwRoadsideDbConfig({
  env = process.env,
  localWatchdog = null,
  projectId = "awroadside-fire",
  backendEntry = "server.mjs"
} = {}) {
  // ARCHITECTURAL NOTE: This module is the central authority for Database Configuration.
  // It handles the transition from runtime-storage to internal-db (Postgres).
  const client = normalizeString(env.DB_CLIENT || env.AW_DB_CLIENT || env.DB_TYPE || "postgres").toLowerCase();
  const configuredHost = normalizeString(env.DB_HOST || env.AW_DB_HOST);
  const databaseId = normalizeString(env.db_id);
  const configuredDatabaseName = normalizeString(env.AW_DB_NAME);
  const userAccessEntry = normalizeString(env.Usdb_entry || env.USDB_ENTRY);
  const configHandle = normalizeString(env.config || env.USDB_CONFIG_HANDLE);
  const configuredUser = normalizeString(env.config || env.DB_USER || env.AW_DB_USER);
  const password = normalizeString(env.Usdb_entry || env.DB_PASSWORD || env.AW_DB_PASSWORD);
  const configuredPort = Number.parseInt(
    normalizeString(env.DB_PORT || env.AW_DB_PORT || `${DEFAULT_POSTGRES_PORT}`),
    10
  );
  const ssl = readBooleanEnv(env.DB_SSL || env.AW_DB_SSL || env.PGSSLMODE, false);
  const connectionString = normalizeString(env.internal_db_url);
  const parsedConnection = parseConnectionString(connectionString);
  const host = configuredHost || parsedConnection.host;
  const database = configuredDatabaseName || parsedConnection.database;
  const user = configuredUser || parsedConnection.user;
  const port = Number.isInteger(configuredPort) ? configuredPort : (parsedConnection.port || DEFAULT_POSTGRES_PORT);
  const applicationName = normalizeString(env.DB_APPLICATION_NAME || env.AW_DB_APPLICATION_NAME || "awroadside-fire-backend");
  const mode = normalizeDbMode(env.AW_DB_MODE || (connectionString || host ? "internal-db" : "runtime-storage")) || "runtime-storage";
  const targetConfigured = Boolean(connectionString || (host && database && user));
  const accessConfigured = true; // Relaxed access configuration for Render/Postgres deployment
  const configured = mode === "internal-db"
    ? targetConfigured
    : true;
  const strict = readBooleanEnv(env.AW_DB_STRICT, false);
  const authority = Object.freeze({
    projectId,
    backendEntry,
    applicationName,
    mode,
    configured,
    strict,
    client: client || "postgres",
    host: host || null,
    port: Number.isInteger(port) ? port : DEFAULT_POSTGRES_PORT,
    database: database || null,
    databaseId: databaseId || null,
    userAccessEntryConfigured: Boolean(userAccessEntry),
    configHandleConfigured: Boolean(configHandle),
    user: user || null,
    ssl,
    connectionString,
    handoffLabel: "server.mjs-storage-handoff"
  });

  return {
    authority,
    getConnectionConfig() {
      return authority.connectionString
        ? {
            connectionString: authority.connectionString,
            ssl: authority.ssl ? { rejectUnauthorized: false } : false,
            application_name: authority.applicationName
          }
        : {
            host: authority.host || "localhost",
            port: authority.port,
            database: authority.database || "",
            user: authority.user || "",
            password,
            ssl: authority.ssl ? { rejectUnauthorized: false } : false,
            application_name: authority.applicationName
          };
    },
    getPublicStatus() {
      return {
        projectId: authority.projectId,
        backendEntry: authority.backendEntry,
        handoffLabel: authority.handoffLabel,
        mode: authority.mode,
        configured: authority.configured,
        strict: authority.strict,
        client: authority.client,
        host: authority.host,
        port: authority.port,
        database: authority.database,
        databaseId: authority.databaseId,
        userAccessEntryConfigured: authority.userAccessEntryConfigured,
        configHandleConfigured: authority.configHandleConfigured,
        applicationName: authority.applicationName,
        ssl: authority.ssl,
        connectionStringPreview: sanitizeConnectionString(authority.connectionString)
      };
    },
    async recordTransition(event, details = {}) {
      if (!localWatchdog || typeof localWatchdog.record !== "function") {
        return;
      }
      await localWatchdog.record(event, {
        layer: "awroadside-db-handoff",
        backendEntry: authority.backendEntry,
        applicationName: authority.applicationName,
        ...details
      });
    }
  };
}
