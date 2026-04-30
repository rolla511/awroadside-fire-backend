export function createAwRoadsideStorageAuthority({
  dbConfig,
  localWatchdog,
  bootAuthority = {},
  storageKernel = {}
}) {
  const repositories = Object.freeze(storageKernel.repositories || {});
  const schemaSql = typeof storageKernel.schemaSql === "string" ? storageKernel.schemaSql : "";
  const storageBootAuthority = Object.freeze({
    backendEntry: bootAuthority.backendEntry || dbConfig.authority.backendEntry,
    blueprintPath: bootAuthority.blueprintPath || null,
    serverRuntimeProvider: bootAuthority.serverRuntimeProvider || "node",
    serverRuntimeVersion: bootAuthority.serverRuntimeVersion || null,
    watchdogLayer: bootAuthority.watchdogLayer || "aw-roadside-local-watchdog",
    databaseRole: "storage-only",
    storageCoordinator: "backend/server.mjs"
  });

  let sql = null;
  let enabled = false;
  let status = {
    initialized: false,
    enabled: false,
    mode: dbConfig.authority.mode,
    configured: dbConfig.authority.configured,
    client: dbConfig.authority.client,
    database: dbConfig.authority.database || null,
    strict: dbConfig.authority.strict,
    bootAuthority: storageBootAuthority,
    lastEvent: "created"
  };

  return {
    repositories,
    getStatus() {
      return {
        ...status,
        bootAuthority: storageBootAuthority
      };
    },
    async initialize() {
      await dbConfig.recordTransition("db-config-initialized", {
        mode: dbConfig.authority.mode,
        configured: dbConfig.authority.configured,
        client: dbConfig.authority.client,
        strict: dbConfig.authority.strict
      });
      status = {
        ...status,
        initialized: true,
        lastEvent: "db-config-initialized"
      };
      await record("storage-authority-boot-linked", {
        bootAuthority: storageBootAuthority
      });

      if (!dbConfig.authority.configured || dbConfig.authority.mode === "file-runtime") {
        status = {
          ...status,
        enabled: false,
        lastEvent: "storage-authority-file-runtime"
      };
        await record("storage-authority-file-runtime", {
          repositories: Object.keys(repositories)
        });
        return;
      }

      if (!schemaSql || !repositories.users || !repositories.requests || !repositories.payments) {
        status = {
          ...status,
          enabled: false,
          lastEvent: "storage-authority-missing-kernel"
        };
        await handleFailure(
          new Error("Storage kernel not provided by backend/server.mjs."),
          "storage-authority-missing-kernel"
        );
        return;
      }

      if (dbConfig.authority.client !== "postgres") {
        status = {
          ...status,
          enabled: false,
          lastEvent: "storage-authority-unsupported-client"
        };
        await handleFailure(new Error(`Unsupported DB client: ${dbConfig.authority.client}`), "storage-authority-unsupported-client");
        return;
      }

      try {
        const { Pool } = await import("pg");
        sql = new Pool(dbConfig.getConnectionConfig());
        await sql.query(schemaSql);
        enabled = true;
        status = {
          ...status,
          enabled: true,
          lastEvent: "storage-authority-sql-ready"
        };
        await record("storage-authority-sql-ready", {
          repositories: Object.keys(repositories),
          client: dbConfig.authority.client,
          database: dbConfig.authority.database || null
        });
      } catch (error) {
        await handleFailure(error, "storage-authority-sql-unavailable");
      }
    },
    async syncUsers(users) {
      if (!enabled || !sql) {
        return;
      }
      try {
        await repositories.users.sync(sql, Array.isArray(users) ? users : []);
        await repositories.providerHistory.syncFromUsers(sql, Array.isArray(users) ? users : []);
      } catch (error) {
        await handleFailure(error, "storage-sync-users-failed");
      }
    },
    async syncRequests(requests) {
      if (!enabled || !sql) {
        return;
      }
      try {
        const list = Array.isArray(requests) ? requests : [];
        await repositories.requests.sync(sql, list);
        await repositories.providerWallet.syncFromRequests(sql, list);
      } catch (error) {
        await handleFailure(error, "storage-sync-requests-failed");
      }
    },
    async appendPaymentEvent(entry) {
      if (!enabled || !sql) {
        return;
      }
      try {
        await repositories.payments.insert(sql, entry);
      } catch (error) {
        await handleFailure(error, "storage-sync-payment-failed");
      }
    }
  };

  async function record(event, details = {}) {
    await dbConfig.recordTransition(event, details);
    if (localWatchdog && typeof localWatchdog.record === "function") {
      await localWatchdog.record(event, {
        layer: "awroadside-storage",
        ...details
      });
    }
  }

  async function handleFailure(error, event) {
    status = {
      ...status,
      enabled: false,
      lastEvent: event,
      lastError: error instanceof Error ? error.message : String(error)
    };
    await record(event, {
      message: error instanceof Error ? error.message : String(error)
    });
    if (dbConfig.authority.strict) {
      throw error;
    }
  }
}
