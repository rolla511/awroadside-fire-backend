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

export function createAwRoadsideDbConfig({
  env = process.env,
  localWatchdog = null,
  projectId = "awroadside-fire",
  backendEntry = "backend/server.mjs"
} = {}) {
  const client = normalizeString(env.DB_CLIENT || env.AW_DB_CLIENT || "postgres").toLowerCase();
  const host = normalizeString(env.DB_HOST || env.AW_DB_HOST);
  const database = normalizeString(env.DB_NAME || env.AW_DB_NAME);
  const user = normalizeString(env.DB_USER || env.AW_DB_USER);
  const password = normalizeString(env.DB_PASSWORD || env.AW_DB_PASSWORD);
  const port = Number.parseInt(normalizeString(env.DB_PORT || env.AW_DB_PORT || `${DEFAULT_POSTGRES_PORT}`), 10);
  const ssl = readBooleanEnv(env.DB_SSL || env.AW_DB_SSL, false);
  const connectionString = normalizeString(env.DATABASE_URL || env.AW_DATABASE_URL);
  const applicationName = normalizeString(env.DB_APPLICATION_NAME || env.AW_DB_APPLICATION_NAME || "awroadside-server");
  const mode = normalizeString(env.AW_DB_MODE || (connectionString || host ? "external-db" : "file-runtime")) || "file-runtime";
  const configured = Boolean(connectionString || (host && database && user));
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
