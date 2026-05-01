import { createPaymentsRepository } from "./payments-repository.mjs";
import { createProviderHistoryRepository } from "./provider-history-repository.mjs";
import { createProviderWalletRepository } from "./provider-wallet-repository.mjs";
import { createRequestsRepository } from "./requests-repository.mjs";
import { STORAGE_SCHEMA_SQL } from "./schema.mjs";
import { createUsersRepository } from "./users-repository.mjs";

export function createAwRoadsideStorageKernel() {
  return Object.freeze({
    schemaSql: STORAGE_SCHEMA_SQL,
    repositories: Object.freeze({
      users: createUsersRepository(),
      requests: createRequestsRepository(),
      payments: createPaymentsRepository(),
      providerWallet: createProviderWalletRepository(),
      providerHistory: createProviderHistoryRepository()
    })
  });
}

export function createAwRoadsideStorageAuthority({
  awRoadsideDbConfig = null,
  dbConfig = null,
  localWatchdog = null,
  storageKernel = createAwRoadsideStorageKernel()
} = {}) {
  const resolvedDbConfig = awRoadsideDbConfig || dbConfig;
  if (!resolvedDbConfig || !resolvedDbConfig.authority) {
    throw new Error("AW Roadside storage authority requires awRoadsideDbConfig.");
  }

  const repositories = Object.freeze(storageKernel.repositories || {});
  const schemaSql = typeof storageKernel.schemaSql === "string" ? storageKernel.schemaSql : "";
  let sql = null;
  let enabled = false;
  let status = {
    initialized: false,
    enabled: false,
    mode: resolvedDbConfig.authority.mode,
    configured: resolvedDbConfig.authority.configured,
    client: resolvedDbConfig.authority.client,
    database: resolvedDbConfig.authority.database || null,
    strict: resolvedDbConfig.authority.strict,
    repositories: Object.keys(repositories),
    lastEvent: "created"
  };

  return {
    repositories,
    getStatus() {
      return { ...status };
    },
    async initialize() {
      await resolvedDbConfig.recordTransition("awroadsidedb-config-initialized", {
        mode: resolvedDbConfig.authority.mode,
        configured: resolvedDbConfig.authority.configured,
        client: resolvedDbConfig.authority.client,
        strict: resolvedDbConfig.authority.strict
      });
      status = {
        ...status,
        initialized: true,
        lastEvent: "awroadsidedb-config-initialized"
      };

      if (!resolvedDbConfig.authority.configured || resolvedDbConfig.authority.mode === "file-runtime") {
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
        await handleFailure(
          new Error("AW Roadside storage kernel is incomplete."),
          "storage-authority-incomplete-kernel"
        );
        return;
      }

      if (resolvedDbConfig.authority.client !== "postgres") {
        await handleFailure(
          new Error(`Unsupported DB client: ${resolvedDbConfig.authority.client}`),
          "storage-authority-unsupported-client"
        );
        return;
      }

      try {
        const { Pool } = await import("pg");
        sql = new Pool(resolvedDbConfig.getConnectionConfig());
        await sql.query(schemaSql);
        enabled = true;
        status = {
          ...status,
          enabled: true,
          lastEvent: "storage-authority-sql-ready"
        };
        await record("storage-authority-sql-ready", {
          repositories: Object.keys(repositories),
          client: resolvedDbConfig.authority.client,
          database: resolvedDbConfig.authority.database || null
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
    await resolvedDbConfig.recordTransition(event, details);
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
    if (resolvedDbConfig.authority.strict) {
      throw error;
    }
  }
}
