import { upsertServiceRequestRow } from "./sql-helpers.mjs";

export function createRequestsRepository() {
  return {
    name: "requests",
    syncCoordinator: "backend/server.mjs",
    targetTables: [
      "aw_service_requests"
    ],
    async sync(sql, requests) {
      for (const request of requests) {
        await upsertServiceRequestRow(sql, request);
      }
    }
  };
}
