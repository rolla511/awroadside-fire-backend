import {
  buildPerformanceRowsFromUser,
  upsertPerformanceRow
} from "./sql-helpers.mjs";

export function createProviderHistoryRepository() {
  return {
    name: "providerHistory",
    writeAuthority: "server.mjs",
    targetTables: [
      "aw_provider_performance_history"
    ],
    async syncFromUsers(sql, users) {
      for (const user of users) {
        for (const row of buildPerformanceRowsFromUser(user)) {
          await upsertPerformanceRow(sql, row);
        }
      }
    }
  };
}
