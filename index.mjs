import { STORAGE_SCHEMA_SQL } from "./schema.mjs";
import { createPaymentsRepository } from "./payments-repository.mjs";
import { createProviderHistoryRepository } from "./provider-history-repository.mjs";
import { createProviderWalletRepository } from "./provider-wallet-repository.mjs";
import { createRequestsRepository } from "./requests-repository.mjs";
import { createUsersRepository } from "./users-repository.mjs";

export function createAwRoadsideStorageAuthority({ dbConfig, localWatchdog }) {
  const usersRepository = createUsersRepository();
  const requestsRepository = createRequestsRepository();
  const paymentsRepository = createPaymentsRepository();
  const providerWalletRepository = createProviderWalletRepository();
  const providerHistoryRepository = createProviderHistoryRepository();
  const repositories = Object.freeze({
    users: usersRepository,
    requests: requestsRepository,
    payments: paymentsRepository,
    providerWallet: providerWalletRepository,
    providerHistory: providerHistoryRepository
  });

  let sql = null;
  let enabled = false;

  return {
    repositories,
    async initialize() {
      await dbConfig.recordTransition("db-config-initialized", {
        mode: dbConfig.authority.mode,
        configured: dbConfig.authority.configured,
        client: dbConfig.authority.client,
        strict: dbConfig.authority.strict
      });

      if (!dbConfig.authority.configured || dbConfig.authority.mode === "file-runtime") {
        await record("storage-authority-file-runtime", {
          repositories: Object.keys(repositories)
        });
        return;
      }

      if (dbConfig.authority.client !== "postgres") {
        await handleFailure(new Error(`Unsupported DB client: ${dbConfig.authority.client}`), "storage-authority-unsupported-client");
        return;
      }

      try {
        const { Pool } = await import("pg");
        sql = new Pool(dbConfig.getConnectionConfig());
        await sql.query(STORAGE_SCHEMA_SQL);
        enabled = true;
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
        await usersRepository.sync(sql, Array.isArray(users) ? users : []);
        await providerHistoryRepository.syncFromUsers(sql, Array.isArray(users) ? users : []);
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
        await requestsRepository.sync(sql, list);
        await providerWalletRepository.syncFromRequests(sql, list);
      } catch (error) {
        await handleFailure(error, "storage-sync-requests-failed");
      }
    },
    async appendPaymentEvent(entry) {
      if (!enabled || !sql) {
        return;
      }
      try {
        await paymentsRepository.insert(sql, entry);
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
    await record(event, {
      message: error instanceof Error ? error.message : String(error)
    });
    if (dbConfig.authority.strict) {
      throw error;
    }
  }
}
