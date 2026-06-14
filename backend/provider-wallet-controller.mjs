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
  const amountCharged = Number(request?.amountCharged || 0);
  const amountCollected = Number(request?.amountCollected || 0);
  const payoutStatus = readOptionalString(request?.providerPayoutStatus).toUpperCase() || "UNASSIGNED";
  const paymentStatus = readOptionalString(request?.paymentStatus).toUpperCase() || null;
  const paymentCompleted = paymentStatus === "CAPTURED";
  const disputeFlag = Boolean(request?.disputeFlag);
  const refundFlag = Boolean(request?.refundFlag || request?.refundIssued);
  const holdFlag = disputeFlag || refundFlag || ["ON_HOLD", "HELD", "BLOCKED", "FAILED"].includes(payoutStatus);
  const currentWalletImpactAmount = paymentCompleted && payoutStatus !== "COMPLETED" ? estimatedPayoutAmount : 0;

  return {
    requestId: request?.requestId || request?.id || null,
    serviceType: request?.serviceType || null,
    customerName: request?.fullName || "",
    customerTier: request?.customerTier || request?.customerType || "GUEST",
    status: request?.status || null,
    completionStatus: request?.completionStatus || null,
    paymentStatus: request?.paymentStatus || null,
    servicePaymentAmount: amountCharged,
    paymentCollectedAmount: amountCollected,
    paymentCompleted,
    providerPayoutStatus: payoutStatus,
    estimatedPayoutAmount,
    providerNetAmount: estimatedPayoutAmount,
    actualPayoutAmount: payoutStatus === "COMPLETED" ? estimatedPayoutAmount : null,
    currentWalletImpactAmount,
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
      accumulator.totalServiceCharged += Number(entry.servicePaymentAmount || 0);
      accumulator.totalPaymentsCollected += Number(entry.paymentCollectedAmount || 0);

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
      totalServiceCharged: 0,
      totalPaymentsCollected: 0,
      fundsAvailable: 0,
      fundsPending: 0,
      fundsOnHold: 0,
      fundsDispute: 0,
      fundsPaidOut: 0
    }
  );

  return {
    totalEstimated: Number(summary.totalEstimated.toFixed(2)),
    totalServiceCharged: Number(summary.totalServiceCharged.toFixed(2)),
    totalPaymentsCollected: Number(summary.totalPaymentsCollected.toFixed(2)),
    fundsAvailable: Number(summary.fundsAvailable.toFixed(2)),
    fundsPending: Number(summary.fundsPending.toFixed(2)),
    fundsOnHold: Number(summary.fundsOnHold.toFixed(2)),
    fundsDispute: Number(summary.fundsDispute.toFixed(2)),
    fundsPaidOut: Number(summary.fundsPaidOut.toFixed(2)),
    currentWalletBalance: Number((summary.fundsAvailable + summary.fundsPending + summary.fundsOnHold + summary.fundsDispute).toFixed(2)),
    completedPayoutCount: ledger.filter((entry) => entry.providerPayoutStatus === "COMPLETED").length,
    completedPaymentCount: ledger.filter((entry) => entry.paymentCompleted).length,
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
      payoutTermsAccepted: provider.terms?.providerPayout?.accepted === true || provider.providerProfile?.payoutTerms?.accepted === true,
      payoutTermsAcceptedAt: provider.terms?.providerPayout?.acceptedAt || provider.providerProfile?.payoutTerms?.acceptedAt || null,
      payoutSafeModeActive: provider.terms?.providerPayout?.safeModeActive !== false && provider.providerProfile?.payoutTerms?.safeModeActive !== false,
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
