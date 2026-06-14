export const PAYPAL_CAPTURE_PAYMENT_KINDS = Object.freeze([
  "priority",
  "service",
  "membership",
  "provider-membership",
  "provider-suspension"
]);

export const PAYPAL_WEBHOOK_EVENT_FAMILIES = Object.freeze([
  "BILLING.SUBSCRIPTION.*",
  "CUSTOMER.ACCOUNT-ENTITIES.*",
  "CUSTOMER.PARTNER-*",
  "PAYMENT.PAYOUTSBATCH.*",
  "PAYMENT.PAYOUTS-ITEM.*",
  "PAYMENTS.CUSTOMER-PAYOUTS.*",
  "PAYMENT.CAPTURE.*",
  "PAYMENT.REFUND.*",
  "PAYMENT.SALE.*",
  "PAYMENT.ORDER.CANCELLED"
]);

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isUserScopedPaymentKind(paymentKind) {
  return paymentKind === "membership" || paymentKind === "provider-membership" || paymentKind === "provider-suspension";
}

function buildUnsupportedPaymentKindError(paymentKind) {
  const error = new Error(
    `Payment kind must be ${PAYPAL_CAPTURE_PAYMENT_KINDS.join(", ")}.`
  );
  error.statusCode = 400;
  error.code = "unsupported-payment-kind";
  error.paymentKind = paymentKind || null;
  return error;
}

function buildMissingOrderIdError() {
  const error = new Error("A PayPal orderId is required.");
  error.statusCode = 400;
  error.code = "invalid-order-id";
  return error;
}

export function createPaypalCaptureController(helpers) {
  const {
    readOptionalString = optionalString,
    normalizeServiceRequest,
    createServicePaymentQuote,
    normalizeServicePaymentRequest,
    getServiceRequestById,
    shouldTreatPaymentAsSubscriberMembership,
    createSubscriberMembershipPaymentRequest,
    createProviderRecurringPaymentRequest,
    createProviderSuspensionPaymentRequest,
    createPaypalOrder,
    updatePaypalOrder,
    capturePaypalOrder,
    extractPaypalCapturedAmount,
    extractPaypalCaptureId,
    appendPaymentLog,
    updateRequestRecord,
    recordSubscriberMembershipPaymentOrder,
    recordProviderRecurringPaymentOrder,
    recordProviderSuspensionPaymentOrder,
    activateSubscriberMembershipByUserId,
    activateProviderRecurringBillingByUserId,
    recordProviderSuspensionFeeCaptureByUserId,
    sendPaymentReceiptEmailForRequest,
    getAuthorizedPayment,
    captureAuthorizedPayment,
    activateBillingPlan,
    createBillingPlan,
    createSubscription,
    getSubscription,
    patchSubscription,
    reviseSubscription,
    activateSubscription,
    captureSubscription,
    getSetupToken,
    createPaymentToken,
    deletePaymentToken,
    searchTransactions,
    listSubscriptionTransactions,
    listBillingPlans,
    applyPaypalSubscriptionWebhook,
    applyPaypalProviderWebhook,
    applyPaypalPaymentWebhook
  } = helpers;

  function getPaymentCoverage() {
    return {
      paymentKinds: [...PAYPAL_CAPTURE_PAYMENT_KINDS],
      webhookEventFamilies: [...PAYPAL_WEBHOOK_EVENT_FAMILIES]
    };
  }

  async function resolvePaymentKind(payload = {}, session = null) {
    const requestedKind = readOptionalString(payload?.paymentKind).toLowerCase();
    const useMembershipPayment = await shouldTreatPaymentAsSubscriberMembership(payload, session);
    const paymentKind = useMembershipPayment ? "membership" : requestedKind || "priority";
    if (!PAYPAL_CAPTURE_PAYMENT_KINDS.includes(paymentKind)) {
      throw buildUnsupportedPaymentKindError(paymentKind);
    }
    return paymentKind;
  }

  async function buildNormalizedRequest(payload = {}, session = null, paymentKind = "priority") {
    if (paymentKind === "service") {
      const requestId = readOptionalString(payload.requestId);
      if (!requestId) {
        const error = new Error("A backend requestId is required before service payment.");
        error.statusCode = 400;
        error.code = "request-id-required";
        throw error;
      }
      const request = await getServiceRequestById(requestId);
      const quote = createServicePaymentQuote(request);
      return normalizeServicePaymentRequest(payload, request, quote);
    }

    if (paymentKind === "membership") {
      return createSubscriberMembershipPaymentRequest(payload, session);
    }

    if (paymentKind === "provider-membership") {
      return createProviderRecurringPaymentRequest(payload, session);
    }

    if (paymentKind === "provider-suspension") {
      return createProviderSuspensionPaymentRequest(payload, session);
    }

    return normalizeServiceRequest(payload);
  }

  async function createOrderForPayload({ payload = {}, session = null, route = null } = {}) {
    const paymentKind = await resolvePaymentKind(payload, session);
    const normalizedRequest = await buildNormalizedRequest(payload, session, paymentKind);
    const createdAt = new Date().toISOString();
    const order = await createPaypalOrder(normalizedRequest);

    await appendPaymentLog({
      event: "order-created",
      request: normalizedRequest,
      paymentKind,
      userId: isUserScopedPaymentKind(paymentKind) ? normalizedRequest.userId : null,
      targetType: isUserScopedPaymentKind(paymentKind) ? "user" : "request",
      targetId: isUserScopedPaymentKind(paymentKind)
        ? String(normalizedRequest.userId)
        : normalizedRequest.requestId || null,
      paypalOrderId: order.id,
      status: order.status,
      createdAt,
      route: route || null
    });

    if (paymentKind === "membership") {
      await recordSubscriberMembershipPaymentOrder(normalizedRequest.userId, {
        paymentMethodMasked: normalizedRequest.paymentMethodMasked || null,
        paymentProvider: "paypal",
        paypalOrderId: order.id,
        paymentStatus: order.status || "ORDER_CREATED",
        paymentEventType: "PAYPAL_ORDER_CREATED",
        recordedAt: createdAt
      });
    } else if (paymentKind === "provider-membership") {
      await recordProviderRecurringPaymentOrder(normalizedRequest.userId, {
        paymentMethodMasked: normalizedRequest.paymentMethodMasked || null,
        paymentProvider: "paypal",
        paypalOrderId: order.id,
        paymentStatus: order.status || "ORDER_CREATED",
        paymentEventType: "PAYPAL_ORDER_CREATED",
        recordedAt: createdAt
      });
    } else if (paymentKind === "provider-suspension") {
      await recordProviderSuspensionPaymentOrder(normalizedRequest.userId, {
        paymentMethodMasked: normalizedRequest.paymentMethodMasked || null,
        paymentProvider: "paypal",
        paypalOrderId: order.id,
        paymentStatus: order.status || "ORDER_CREATED",
        paymentEventType: "PAYPAL_ORDER_CREATED",
        recordedAt: createdAt,
        suspensionId: normalizedRequest.suspensionId || null,
        paymentAmount: Number(normalizedRequest.amount?.value || 0)
      });
    } else if (normalizedRequest.requestId && typeof updateRequestRecord === "function") {
      await updateRequestRecord(normalizedRequest.requestId, (request) => ({
        ...request,
        amountCharged: Number(normalizedRequest.amount?.value || 0),
        paymentStatus: "ORDER_CREATED",
        lastPaymentOrderId: order.id
      }));
    }

    return {
      orderId: order.id,
      status: order.status,
      paymentKind,
      userId: isUserScopedPaymentKind(paymentKind) ? normalizedRequest.userId : null,
      request: normalizedRequest
    };
  }

  async function updateOrderForPayload({ id, payload = [] } = {}) {
    return await updatePaypalOrder(id, payload);
  }

  async function captureOrderForPayload({ payload = {}, session = null, route = null } = {}) {
    const paymentKind = await resolvePaymentKind(payload, session);
    const orderId = optionalString(payload.orderId);
    if (!orderId) {
      throw buildMissingOrderIdError();
    }

    const capture = await capturePaypalOrder(orderId);
    const capturedAt = new Date().toISOString();
    const amountCaptured = extractPaypalCapturedAmount(capture);
    const captureId = extractPaypalCaptureId(capture);

    await appendPaymentLog({
      event: "order-captured",
      paypalOrderId: orderId,
      status: capture.status,
      paymentKind,
      userId: isUserScopedPaymentKind(paymentKind) ? session?.userId || Number(payload.userId) || null : null,
      targetType: isUserScopedPaymentKind(paymentKind) ? "user" : "request",
      targetId: isUserScopedPaymentKind(paymentKind)
        ? String(session?.userId || Number(payload.userId) || "") || null
        : readOptionalString(payload.requestId) || null,
      capturedAt,
      route: route || null,
      capture
    });

    if (paymentKind === "membership") {
      const userId = Number.isInteger(session?.userId) ? session.userId : Number(payload.userId);
      if (!Number.isInteger(userId)) {
        const error = new Error("A valid subscriber session is required to capture membership payment.");
        error.statusCode = 401;
        error.code = "session-required";
        throw error;
      }
      const updatedUser = await activateSubscriberMembershipByUserId(userId, {
        paypalOrderId: orderId,
        paypalCaptureId: captureId,
        paymentStatus: capture.status || "CAPTURED",
        paymentAmount: amountCaptured,
        paymentProvider: "paypal",
        paymentEventType: "PAYPAL_CAPTURE_API",
        paidAt: capturedAt
      });
      return {
        status: capture.status,
        orderId,
        capture,
        paymentKind,
        userId: updatedUser.id,
        user: updatedUser
      };
    }

    if (paymentKind === "provider-membership") {
      const userId = Number.isInteger(session?.userId) ? session.userId : Number(payload.userId);
      if (!Number.isInteger(userId)) {
        const error = new Error("A valid provider session is required to capture provider billing.");
        error.statusCode = 401;
        error.code = "session-required";
        throw error;
      }
      const updatedUser = await activateProviderRecurringBillingByUserId(userId, {
        paypalOrderId: orderId,
        paypalCaptureId: captureId,
        paymentStatus: capture.status || "CAPTURED",
        paymentAmount: amountCaptured,
        paymentProvider: "paypal",
        paymentEventType: "PAYPAL_CAPTURE_API",
        paidAt: capturedAt
      });
      return {
        status: capture.status,
        orderId,
        capture,
        paymentKind,
        userId: updatedUser.id,
        user: updatedUser
      };
    }

    if (paymentKind === "provider-suspension") {
      const userId = Number.isInteger(session?.userId) ? session.userId : Number(payload.userId);
      if (!Number.isInteger(userId)) {
        const error = new Error("A valid provider session is required to capture a suspension fee.");
        error.statusCode = 401;
        error.code = "session-required";
        throw error;
      }
      const updatedUser = await recordProviderSuspensionFeeCaptureByUserId(userId, {
        paypalOrderId: orderId,
        paypalCaptureId: captureId,
        paymentStatus: capture.status || "CAPTURED",
        paymentAmount: amountCaptured,
        paymentProvider: "paypal",
        paymentEventType: "PAYPAL_CAPTURE_API",
        paidAt: capturedAt
      });
      return {
        status: capture.status,
        orderId,
        capture,
        paymentKind,
        userId: updatedUser.id,
        user: updatedUser
      };
    }

    let updatedRequest = null;
    if (readOptionalString(payload.requestId) && typeof updateRequestRecord === "function") {
      updatedRequest = await updateRequestRecord(payload.requestId, (request) => ({
        ...request,
        paymentStatus: "CAPTURED",
        amountCollected: Number(request.amountCharged || request.amountCollected || 0),
        lastPaymentOrderId: orderId
      }));
    }

    const paymentReceipt =
      updatedRequest && typeof sendPaymentReceiptEmailForRequest === "function"
        ? await sendPaymentReceiptEmailForRequest(updatedRequest, {
            orderId,
            captureStatus: capture.status
          })
        : null;

    return {
      status: capture.status,
      orderId,
      capture,
      paymentKind,
      request: updatedRequest,
      paymentReceipt
    };
  }

  async function getAuthorizedPaymentForPayload({ payload = {} } = {}) {
    const authorizationId = optionalString(payload.authorizationId);
    if (!authorizationId) {
      const error = new Error("A PayPal authorizationId is required.");
      error.statusCode = 400;
      error.code = "authorization-id-required";
      throw error;
    }
    return await getAuthorizedPayment(authorizationId);
  }

  async function captureAuthorizedPaymentForPayload({ payload = {} } = {}) {
    const authorizationId = optionalString(payload.authorizationId);
    if (!authorizationId) {
      const error = new Error("A PayPal authorizationId is required.");
      error.statusCode = 400;
      error.code = "authorization-id-required";
      throw error;
    }
    return await captureAuthorizedPayment(authorizationId, payload);
  }

  async function activateBillingPlanForPayload({ payload = {} } = {}) {
    const planId = optionalString(payload.planId || payload.id);
    if (!planId) {
      const error = new Error("A PayPal planId is required.");
      error.statusCode = 400;
      error.code = "plan-id-required";
      throw error;
    }
    return await activateBillingPlan(planId);
  }

  async function listBillingPlansForPayload({ payload = {} } = {}) {
    return await listBillingPlans(payload);
  }

  async function createBillingPlanForPayload({ payload = {} } = {}) {
    return await createBillingPlan(payload);
  }

  async function createSubscriptionForPayload({ payload = {} } = {}) {
    return await createSubscription(payload);
  }

  async function getSubscriptionForPayload({ id, payload = {} } = {}) {
    return await getSubscription(id, payload);
  }

  async function patchSubscriptionForPayload({ id, payload = [] } = {}) {
    return await patchSubscription(id, payload);
  }

  async function reviseSubscriptionForPayload({ id, payload = {} } = {}) {
    return await reviseSubscription(id, { body: payload });
  }

  async function listSubscriptionTransactionsForPayload({ id, payload = {} } = {}) {
    return await listSubscriptionTransactions(id, payload);
  }

  async function activateSubscriptionForPayload({ id, payload = {} } = {}) {
    const reason = payload.reason || "Activating subscription";
    return await activateSubscription(id, reason);
  }

  async function captureSubscriptionForPayload({ id, payload = {}, paypalRequestId } = {}) {
    return await captureSubscription(id, { body: payload, paypalRequestId });
  }

  async function getPaymentTokenForPayload({ id } = {}) {
    return await getPaymentToken(id);
  }

  async function patchPaymentTokenForPayload({ id, payload } = {}) {
    return await patchPaymentToken(id, payload);
  }

  async function listPaymentTokensForPayload({ customerId } = {}) {
    return await listPaymentTokens(customerId);
  }

  async function createPaymentTokenForPayload({ payload = {}, paypalRequestId } = {}) {
    return await createPaymentToken({ body: payload, paypalRequestId });
  }

  async function createSetupTokenForPayload({ payload = {}, paypalRequestId } = {}) {
    return await createSetupToken({ body: payload, paypalRequestId });
  }

  async function deletePaymentTokenForPayload({ id } = {}) {
    return await deletePaymentToken(id);
  }

  async function getSetupTokenForPayload({ id } = {}) {
    return await getSetupToken(id);
  }

  async function searchTransactionsForPayload({ payload = {} } = {}) {
    return await searchTransactions(payload);
  }

  async function getUserInfoForPayload({ schema } = {}) {
    return await getUserInfo(schema);
  }

  async function applyWebhookEvent(webhookEvent) {
    const eventType = readOptionalString(webhookEvent?.event_type).toUpperCase();
    if (!eventType) {
      return {
        matched: false,
        applied: false,
        note: "missing-event-type"
      };
    }

    if (eventType.startsWith("BILLING.SUBSCRIPTION.")) {
      return applyPaypalSubscriptionWebhook(webhookEvent, eventType);
    }

    if (
      eventType.startsWith("CUSTOMER.ACCOUNT-ENTITIES.") ||
      eventType.startsWith("CUSTOMER.PARTNER-") ||
      eventType.startsWith("PAYMENT.PAYOUTSBATCH.") ||
      eventType.startsWith("PAYMENT.PAYOUTS-ITEM.") ||
      eventType.startsWith("PAYMENTS.CUSTOMER-PAYOUTS.")
    ) {
      return applyPaypalProviderWebhook(webhookEvent, eventType);
    }

    if (
      eventType.startsWith("PAYMENT.CAPTURE.") ||
      eventType.startsWith("PAYMENT.REFUND.") ||
      eventType.startsWith("PAYMENT.SALE.") ||
      eventType === "PAYMENT.ORDER.CANCELLED"
    ) {
      return applyPaypalPaymentWebhook(webhookEvent, eventType);
    }

    return {
      matched: false,
      applied: false,
      note: "ignored-event-type"
    };
  }

  return {
    getPaymentCoverage,
    resolvePaymentKind,
    createOrderForPayload,
    updateOrderForPayload,
    captureOrderForPayload,
    getAuthorizedPaymentForPayload,
    captureAuthorizedPaymentForPayload,
    activateBillingPlanForPayload,
    createBillingPlanForPayload,
    createSubscriptionForPayload,
    getSubscriptionForPayload,
    patchSubscriptionForPayload,
    reviseSubscriptionForPayload,
    activateSubscriptionForPayload,
    captureSubscriptionForPayload,
    getSetupTokenForPayload,
    createSetupTokenForPayload,
    getPaymentTokenForPayload,
    patchPaymentTokenForPayload,
    listPaymentTokensForPayload,
    createPaymentTokenForPayload,
    deletePaymentTokenForPayload,
    searchTransactionsForPayload,
    getUserInfoForPayload,
    listSubscriptionTransactionsForPayload,
    listBillingPlansForPayload,
    applyWebhookEvent
  };
}
