import { STORAGE_SCHEMA_SQL } from "./schema.mjs";

export function createAwRoadsideStorageAuthority({ dbConfig, localWatchdog, bootAuthority = {} }) {
  let repositories = Object.freeze({});
  let repositoriesPromise = null;
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
    get repositories() {
      return repositories;
    },
    getStatus() {
      return {
        ...status,
        bootAuthority: storageBootAuthority
      };
    },
    async initialize() {
      const activeRepositories = await getRepositories();
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
          repositories: Object.keys(activeRepositories)
        });
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
        await sql.query(STORAGE_SCHEMA_SQL);
        enabled = true;
        status = {
          ...status,
          enabled: true,
          lastEvent: "storage-authority-sql-ready"
        };
        await record("storage-authority-sql-ready", {
          repositories: Object.keys(activeRepositories),
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
        const activeRepositories = await getRepositories();
        await activeRepositories.users.sync(sql, Array.isArray(users) ? users : []);
        await activeRepositories.providerHistory.syncFromUsers(sql, Array.isArray(users) ? users : []);
      } catch (error) {
        await handleFailure(error, "storage-sync-users-failed");
      }
    },
    async syncRequests(requests) {
      if (!enabled || !sql) {
        return;
      }
      try {
        const activeRepositories = await getRepositories();
        const list = Array.isArray(requests) ? requests : [];
        await activeRepositories.requests.sync(sql, list);
        await activeRepositories.providerWallet.syncFromRequests(sql, list);
      } catch (error) {
        await handleFailure(error, "storage-sync-requests-failed");
      }
    },
    async appendPaymentEvent(entry) {
      if (!enabled || !sql) {
        return;
      }
      try {
        const activeRepositories = await getRepositories();
        await activeRepositories.payments.insert(sql, entry);
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

  async function getRepositories() {
    if (!repositoriesPromise) {
      repositoriesPromise = loadRepositories();
    }
    repositories = await repositoriesPromise;
    return repositories;
  }
}

async function loadRepositories() {
  const [
    { createPaymentsRepository },
    { createProviderHistoryRepository },
    { createProviderWalletRepository },
    { createRequestsRepository },
    { createUsersRepository }
  ] = await Promise.all([
    import("./payments-repository.mjs"),
    import("./provider-history-repository.mjs"),
    import("./provider-wallet-repository.mjs"),
    import("./requests-repository.mjs"),
    import("./users-repository.mjs")
  ]);

  return Object.freeze({
    users: createUsersRepository(),
    requests: createRequestsRepository(),
    payments: createPaymentsRepository(),
    providerWallet: createProviderWalletRepository(),
    providerHistory: createProviderHistoryRepository()
  });
}
