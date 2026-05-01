import { upsertWalletRow } from "./sql-helpers.mjs";

export function createProviderWalletRepository() {
  return {
    name: "providerWallet",
    syncCoordinator: "backend/server.mjs",
    targetTables: [
      "aw_provider_wallet_history"
    ],
    async syncFromRequests(sql, requests) {
      for (const request of requests) {
        const providerUserId = Number(request?.assignedProviderId);
        if (!Number.isInteger(providerUserId)) {
          continue;
        }
        await upsertWalletRow(sql, {
          entryId: `wallet:${providerUserId}:${request.id || request.requestId}`,
          providerUserId,
          requestId: String(request.id || request.requestId || ""),
          providerPayoutStatus: request.providerPayoutStatus || null,
          payoutReference: request.payoutReference || null,
          amountCollected: Number.isFinite(Number(request.amountCollected)) ? Number(request.amountCollected) : null,
          providerPayoutAmount: Number.isFinite(Number(request.providerPayoutAmount)) ? Number(request.providerPayoutAmount) : null,
          completedAt: request.completedAt || null,
          payoutCompletedAt: request.payoutCompletedAt || null,
          payload: request
        });
      }
    }
  };
}
