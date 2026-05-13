function readOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sortProviderRequestsByNewest(left, right) {
  const leftTime = new Date(left?.updatedAt || left?.submittedAt || left?.createdAt || 0).getTime();
  const rightTime = new Date(right?.updatedAt || right?.submittedAt || right?.createdAt || 0).getTime();
  return rightTime - leftTime;
}

function mapProviderLedgerEntry(request) {
  const estimatedPayoutAmount = Number(request?.providerPayoutAmount || 0);
  const payoutStatus = readOptionalString(request?.providerPayoutStatus).toUpperCase() || "UNASSIGNED";
  const disputeFlag = Boolean(request?.disputeFlag);
  const refundFlag = Boolean(request?.refundFlag || request?.refundIssued);
  const holdFlag = disputeFlag || refundFlag || ["ON_HOLD", "HELD", "BLOCKED", "FAILED"].includes(payoutStatus);

  return {
    requestId: request?.requestId || request?.id || null,
    serviceType: request?.serviceType || null,
    customerName: request?.fullName || "",
    customerTier: request?.customerTier || request?.customerType || "GUEST",
    status: request?.status || null,
    completionStatus: request?.completionStatus || null,
    paymentStatus: request?.paymentStatus || null,
    providerPayoutStatus: payoutStatus,
    estimatedPayoutAmount,
    actualPayoutAmount: payoutStatus === "COMPLETED" ? estimatedPayoutAmount : null,
    disputeFlag,
    refundFlag,
    holdFlag,
    payoutReference: request?.payoutReference || null,
    payoutBatchId: request?.payoutBatchId || null,
    payoutItemId: request?.payoutItemId || null,
    payoutCompletedAt: request?.payoutCompletedAt || null,
    payoutLastEventType: request?.payoutLastEventType || null,
    payoutLastEventAt: request?.payoutLastEventAt || null,
    updatedAt: request?.updatedAt || request?.submittedAt || request?.createdAt || null
  };
}

function summarizeLedger(ledger) {
  const summary = ledger.reduce(
    (accumulator, entry) => {
      const amount = Number(entry.estimatedPayoutAmount || 0);
      accumulator.totalEstimated += amount;

      if (entry.providerPayoutStatus === "COMPLETED") {
        accumulator.fundsPaidOut += amount;
      } else if (entry.disputeFlag) {
        accumulator.fundsDispute += amount;
      } else if (["ON_HOLD", "HELD", "BLOCKED", "FAILED"].includes(entry.providerPayoutStatus) || entry.holdFlag) {
        accumulator.fundsOnHold += amount;
      } else if (["PENDING", "PROCESSING", "UNCLAIMED"].includes(entry.providerPayoutStatus)) {
        accumulator.fundsPending += amount;
      } else if (entry.providerPayoutStatus === "UNASSIGNED" && entry.paymentStatus === "CAPTURED") {
        accumulator.fundsPending += amount;
      } else if (entry.paymentStatus === "CAPTURED") {
        accumulator.fundsAvailable += amount;
      }

      return accumulator;
    },
    {
      totalEstimated: 0,
      fundsAvailable: 0,
      fundsPending: 0,
      fundsOnHold: 0,
      fundsDispute: 0,
      fundsPaidOut: 0
    }
  );

  return {
    totalEstimated: Number(summary.totalEstimated.toFixed(2)),
    fundsAvailable: Number(summary.fundsAvailable.toFixed(2)),
    fundsPending: Number(summary.fundsPending.toFixed(2)),
    fundsOnHold: Number(summary.fundsOnHold.toFixed(2)),
    fundsDispute: Number(summary.fundsDispute.toFixed(2)),
    fundsPaidOut: Number(summary.fundsPaidOut.toFixed(2)),
    completedPayoutCount: ledger.filter((entry) => entry.providerPayoutStatus === "COMPLETED").length,
    pendingPayoutCount: ledger.filter((entry) => ["PENDING", "PROCESSING", "UNCLAIMED", "UNASSIGNED"].includes(entry.providerPayoutStatus)).length,
    onHoldCount: ledger.filter((entry) => ["ON_HOLD", "HELD", "BLOCKED", "FAILED"].includes(entry.providerPayoutStatus)).length,
    disputeCount: ledger.filter((entry) => entry.disputeFlag).length
  };
}

export function createProviderWalletPayload({
  provider,
  requests,
  walletDisplayTerms,
  normalizeProviderPaypalProfile
}) {
  if (!provider) {
    throw new Error("Provider not found.");
  }
  if (!Array.isArray(provider.roles) || !provider.roles.includes("PROVIDER")) {
    throw new Error("Provider wallet is available only for provider accounts.");
  }

  const paypal = normalizeProviderPaypalProfile(provider.providerProfile?.paypal);
  const providerRequests = (Array.isArray(requests) ? requests : [])
    .filter((request) => Number(request?.assignedProviderId) === Number(provider.id))
    .sort(sortProviderRequestsByNewest);
  const ledger = providerRequests.map(mapProviderLedgerEntry);
  const summary = summarizeLedger(ledger);

  return {
    provider: {
      userId: provider.id,
      fullName: provider.fullName || "",
      email: provider.email || "",
      providerStatus: provider.providerStatus || null,
      accountState: provider.accountState || "ACTIVE",
      services: Array.isArray(provider.services) ? provider.services : [],
      vehicle: provider.providerProfile?.vehicleInfo || null,
      // The PayPal email is used solely for payouts from the platform to the partner.
      paypalEmail: paypal.email || null
    },
    summary,
    payoutTelemetry: {
      lastStatus: paypal.payouts.lastStatus,
      lastEventType: paypal.payouts.lastEventType,
      lastEventAt: paypal.payouts.lastEventAt,
      lastRequestId: paypal.payouts.lastRequestId,
      succeededCount: paypal.payouts.succeededCount,
      failedCount: paypal.payouts.failedCount,
      heldCount: paypal.payouts.heldCount
    },
    paypalState: {
      providerAccountId: paypal.providerAccountId,
      accountId: paypal.accountId,
      email: paypal.email,
      accountLifecycleStatus: paypal.accountLifecycleStatus,
      partnerBalance: paypal.partnerBalance,
      lastWebhookEventType: paypal.lastWebhookEventType,
      lastWebhookAt: paypal.lastWebhookAt
    },
    walletDisplayTerms,
    ledger
  };
}
