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
    extractPaypalVerificationResult,
    appendPaymentLog,
    updateRequestRecord,
    recordSubscriberMembershipPaymentOrder,
    recordProviderRecurringPaymentOrder,
    recordProviderSuspensionPaymentOrder,
    activateSubscriberMembershipByUserId,
    activateProviderRecurringBillingByUserId,
    recordProviderSuspensionFeeCaptureByUserId,
    sendPaymentReceiptEmailForRequest,
    authorizePaypalOrder,
    confirmPaypalOrder,
    createPaypalOrderTracking,
    getPaypalAuthorizedPayment,
    capturePaypalAuthorizedPayment,
    voidPaypalAuthorizedPayment,
    reauthorizePaypalAuthorizedPayment,
    activatePaypalBillingPlan,
    createPaypalBillingPlan,
    createPaypalSubscription,
    getPaypalSubscription,
    patchPaypalSubscription,
    revisePaypalSubscription,
    activatePaypalSubscription,
    capturePaypalSubscription,
    getPaypalSetupToken,
    getPaypalPaymentToken,
    patchPaypalPaymentToken,
    listPaypalPaymentTokens,
    createPaypalSetupToken,
    createPaypalPaymentToken,
    deletePaypalPaymentToken,
    searchPaypalTransactions,
    getPaypalUserInfo,
    listPaypalSubscriptionTransactions,
    listPaypalBillingPlans,
    refundPaypalCapturedPayment,
    listPaypalInvoices,
    introspectPaypalToken,
    revokePaypalToken,
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
    
    // Transfer Expanded Checkout fields from the original payload if present
    if (payload.payment_source) {
      normalizedRequest.payment_source = payload.payment_source;
    }
    if (payload.payment_source_info) {
       normalizedRequest.payment_source = {
         ...normalizedRequest.payment_source,
         ...payload.payment_source_info
       };
    }
    if (payload.decrypted_token) {
       normalizedRequest.payment_source = {
         ...normalizedRequest.payment_source,
         tokenized_card: {
           ...normalizedRequest.payment_source?.tokenized_card,
           ...payload.decrypted_token
         }
       };
    }
    if (payload.card) {
       normalizedRequest.payment_source = {
         ...normalizedRequest.payment_source,
         card: {
           ...normalizedRequest.payment_source?.card,
           ...payload.card
         }
       };
    }
    if (payload.customer) {
      normalizedRequest.customer = payload.customer;
    }
    if (payload.preferences) {
      normalizedRequest.preferences = payload.preferences;
    }
    if (payload.vault) {
      normalizedRequest.vault = payload.vault;
    }
    if (payload.verification) {
      normalizedRequest.verification = payload.verification;
    }
    if (payload.level_2) {
      normalizedRequest.level_2 = payload.level_2;
    }
    if (payload.level_3) {
      normalizedRequest.level_3 = payload.level_3;
    }
    if (payload.intent) {
      normalizedRequest.intent = payload.intent;
    }
    if (payload.purchase_units?.[0]) {
       // Merge items and other purchase unit details if they were provided in the raw payload
       // but not handled by buildNormalizedRequest
       const rawPU = payload.purchase_units[0];
       if (!normalizedRequest.purchase_units) {
         normalizedRequest.purchase_units = [{}];
       }
       const pu = normalizedRequest.purchase_units[0];
       if (rawPU.items && !pu.items) pu.items = rawPU.items;
       if (rawPU.shipping && !pu.shipping) pu.shipping = rawPU.shipping;
       if (rawPU.payee && !pu.payee) pu.payee = rawPU.payee;
       if (rawPU.reference_id && !pu.reference_id) pu.reference_id = rawPU.reference_id;
       if (rawPU.description && !pu.description) pu.description = rawPU.description;
       if (rawPU.amount && !pu.amount) pu.amount = rawPU.amount;
    }
    if (payload.requestId || payload.PayPalRequestId) {
      normalizedRequest.requestId = payload.requestId || payload.PayPalRequestId;
    }

    const createdAt = new Date().toISOString();
    const order = await createPaypalOrder(normalizedRequest);
    const verificationResult = typeof extractPaypalVerificationResult === "function" 
      ? extractPaypalVerificationResult(order) 
      : {};

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
      status_details: order.status_details,
      ...verificationResult,
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

    const capture = await capturePaypalOrder(orderId, payload.capture || payload);
    const capturedAt = new Date().toISOString();
    const amountCaptured = extractPaypalCapturedAmount(capture);
    const captureId = extractPaypalCaptureId(capture);
    const verificationResult = typeof extractPaypalVerificationResult === "function" 
      ? extractPaypalVerificationResult(capture) 
      : {};

    await appendPaymentLog({
      event: "order-captured",
      paypalOrderId: orderId,
      status: capture.status,
      status_details: capture.status_details,
      ...verificationResult,
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

  async function authorizeOrderForPayload({ payload = {}, session = null, route = null } = {}) {
    const paymentKind = await resolvePaymentKind(payload, session);
    const orderId = optionalString(payload.orderId);
    if (!orderId) {
      throw buildMissingOrderIdError();
    }

    const authorization = await authorizePaypalOrder(orderId, payload.authorization || payload);
    const authorizedAt = new Date().toISOString();
    const verificationResult = typeof extractPaypalVerificationResult === "function" 
      ? extractPaypalVerificationResult(authorization) 
      : {};

    await appendPaymentLog({
      event: "order-authorized",
      paypalOrderId: orderId,
      status: authorization.status,
      status_details: authorization.status_details,
      ...verificationResult,
      paymentKind,
      userId: isUserScopedPaymentKind(paymentKind) ? session?.userId || Number(payload.userId) || null : null,
      targetType: isUserScopedPaymentKind(paymentKind) ? "user" : "request",
      targetId: isUserScopedPaymentKind(paymentKind)
        ? String(session?.userId || Number(payload.userId) || "") || null
        : readOptionalString(payload.requestId) || null,
      authorizedAt,
      route: route || null,
      authorization
    });

    return {
      status: authorization.status,
      orderId,
      authorization,
      paymentKind,
      userId: isUserScopedPaymentKind(paymentKind) ? session?.userId || Number(payload.userId) || null : null
    };
  }

  async function confirmOrderForPayload({ payload = {}, session = null, route = null } = {}) {
    const paymentKind = await resolvePaymentKind(payload, session);
    const orderId = optionalString(payload.orderId);
    if (!orderId) {
      throw buildMissingOrderIdError();
    }

    const confirmation = await confirmPaypalOrder(orderId, payload.confirmation || payload);
    const confirmedAt = new Date().toISOString();
    const verificationResult = typeof extractPaypalVerificationResult === "function" 
      ? extractPaypalVerificationResult(confirmation) 
      : {};

    await appendPaymentLog({
      event: "order-confirmed",
      paypalOrderId: orderId,
      status: confirmation.status,
      status_details: confirmation.status_details,
      ...verificationResult,
      paymentKind,
      userId: isUserScopedPaymentKind(paymentKind) ? session?.userId || Number(payload.userId) || null : null,
      targetType: isUserScopedPaymentKind(paymentKind) ? "user" : "request",
      targetId: isUserScopedPaymentKind(paymentKind)
        ? String(session?.userId || Number(payload.userId) || "") || null
        : readOptionalString(payload.requestId) || null,
      confirmedAt,
      route: route || null,
      confirmation
    });

    return {
      status: confirmation.status,
      orderId,
      confirmation,
      paymentKind,
      userId: isUserScopedPaymentKind(paymentKind) ? session?.userId || Number(payload.userId) || null : null
    };
  }

  async function createOrderTrackingForPayload({ payload = {}, session = null, route = null } = {}) {
    const paymentKind = await resolvePaymentKind(payload, session);
    const orderId = optionalString(payload.orderId);
    if (!orderId) {
      throw buildMissingOrderIdError();
    }

    const tracking = await createOrderTracking(orderId, payload.tracking || payload);
    const trackedAt = new Date().toISOString();

    await appendPaymentLog({
      event: "order-tracking-created",
      paypalOrderId: orderId,
      status: tracking.status,
      paymentKind,
      userId: isUserScopedPaymentKind(paymentKind) ? session?.userId || Number(payload.userId) || null : null,
      targetType: isUserScopedPaymentKind(paymentKind) ? "user" : "request",
      targetId: isUserScopedPaymentKind(paymentKind)
        ? String(session?.userId || Number(payload.userId) || "") || null
        : readOptionalString(payload.requestId) || null,
      trackedAt,
      route: route || null,
      tracking
    });

    return {
      status: tracking.status,
      orderId,
      tracking,
      paymentKind,
      userId: isUserScopedPaymentKind(paymentKind) ? session?.userId || Number(payload.userId) || null : null
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
    return await getPaypalAuthorizedPayment(authorizationId, context.req);
  }

  async function captureAuthorizedPaymentForPayload({ payload = {}, context = {} } = {}) {
    const authorizationId = optionalString(payload.authorizationId);
    if (!authorizationId) {
      const error = new Error("A PayPal authorizationId is required.");
      error.statusCode = 400;
      error.code = "authorization-id-required";
      throw error;
    }
    return await capturePaypalAuthorizedPayment(authorizationId, payload, context.req);
  }

  async function voidAuthorizedPaymentForPayload({ payload = {}, context = {} } = {}) {
    const authorizationId = optionalString(payload.authorizationId);
    if (!authorizationId) {
      const error = new Error("A PayPal authorizationId is required.");
      error.statusCode = 400;
      error.code = "authorization-id-required";
      throw error;
    }
    return await voidPaypalAuthorizedPayment(authorizationId, context.req);
  }

  async function reauthorizeAuthorizedPaymentForPayload({ payload = {}, context = {} } = {}) {
    const authorizationId = optionalString(payload.authorizationId);
    if (!authorizationId) {
      const error = new Error("A PayPal authorizationId is required.");
      error.statusCode = 400;
      error.code = "authorization-id-required";
      throw error;
    }
    return await reauthorizePaypalAuthorizedPayment(authorizationId, payload, context.req);
  }

  async function activateBillingPlanForPayload({ payload = {} } = {}) {
    const planId = optionalString(payload.planId || payload.id);
    if (!planId) {
      const error = new Error("A PayPal planId is required.");
      error.statusCode = 400;
      error.code = "plan-id-required";
      throw error;
    }
    return await activatePaypalBillingPlan(planId, context.req);
  }

  async function listBillingPlansForPayload({ payload = {}, context = {} } = {}) {
    return await listPaypalBillingPlans(payload, context.req);
  }

  async function createBillingPlanForPayload({ payload = {}, context = {} } = {}) {
    return await createPaypalBillingPlan(payload, context.req);
  }

  async function createSubscriptionForPayload({ payload = {}, context = {} } = {}) {
    return await createPaypalSubscription(payload, context.req);
  }

  async function getSubscriptionForPayload({ id, payload = {}, context = {} } = {}) {
    return await getPaypalSubscription(id, payload, context.req);
  }

  async function patchSubscriptionForPayload({ id, payload = [], context = {} } = {}) {
    return await patchPaypalSubscription(id, payload, context.req);
  }

  async function reviseSubscriptionForPayload({ id, payload = {}, context = {} } = {}) {
    return await revisePaypalSubscription(id, { body: payload }, context.req);
  }

  async function listSubscriptionTransactionsForPayload({ id, payload = {}, context = {} } = {}) {
    return await listPaypalSubscriptionTransactions(id, payload, context.req);
  }

  async function activateSubscriptionForPayload({ id, payload = {}, context = {} } = {}) {
    const reason = payload.reason || "Activating subscription";
    return await activatePaypalSubscription(id, reason, context.req);
  }

  async function suspendSubscriptionForPayload({ id, payload = {}, context = {} } = {}) {
    const reason = payload.reason || "Suspending subscription";
    return await suspendPaypalSubscription(id, reason, context.req);
  }

  async function captureSubscriptionForPayload({ id, payload = {}, paypalRequestId, context = {} } = {}) {
    return await capturePaypalSubscription(id, { body: payload, paypalRequestId }, context.req);
  }

  async function getPaymentTokenForPayload({ id, context = {} } = {}) {
    return await getPaypalPaymentToken(id, context.req);
  }

  async function patchPaymentTokenForPayload({ id, payload, context = {} } = {}) {
    return await patchPaypalPaymentToken(id, payload, context.req);
  }

  async function listPaymentTokensForPayload({ customerId, context = {} } = {}) {
    return await listPaypalPaymentTokens(customerId, context.req);
  }

  async function createPaymentTokenForPayload({ payload = {}, paypalRequestId, context = {} } = {}) {
    return await createPaypalPaymentToken({ body: payload, paypalRequestId }, context.req);
  }

  async function createSetupTokenForPayload({ payload = {}, paypalRequestId, context = {} } = {}) {
    return await createPaypalSetupToken({ body: payload, paypalRequestId }, context.req);
  }

  async function deletePaymentTokenForPayload({ id, context = {} } = {}) {
    return await deletePaypalPaymentToken(id, context.req);
  }

  async function getSetupTokenForPayload({ id, context = {} } = {}) {
    return await getPaypalSetupToken(id, context.req);
  }

  async function searchTransactionsForPayload({ payload = {}, context = {} } = {}) {
    return await searchPaypalTransactions(payload, context.req);
  }

  async function getUserInfoForPayload({ schema, context = {} } = {}) {
    return await getPaypalUserInfo(schema, context.req);
  }

  async function listInvoicesForPayload({ payload = {}, context = {} } = {}) {
    return await listPaypalInvoices(payload, context.req);
  }

  async function introspectTokenForPayload({ payload = {}, context = {} } = {}) {
    return await introspectPaypalToken(payload.token, payload.tokenTypeHint || "access_token", context.req);
  }

  async function createPartnerReferralForPayload({ payload = {}, context = {} } = {}) {
    return await createPaypalPartnerReferral(payload, context.req);
  }

  async function getPartnerReferralForPayload({ id, context = {} } = {}) {
    return await getPaypalPartnerReferral(id, context.req);
  }

  async function getMerchantIntegrationStatusForPayload({ partnerId, merchantId, context = {} } = {}) {
    return await getPaypalMerchantIntegrationStatus(partnerId, merchantId, context.req);
  }

  async function revokeTokenForPayload({ payload = {}, context = {} } = {}) {
    return await revokePaypalToken(payload.token, payload.tokenTypeHint || "access_token", context.req);
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
    authorizeOrderForPayload,
    confirmOrderForPayload,
    createOrderTrackingForPayload,
    captureOrderForPayload,
    getAuthorizedPaymentForPayload,
    captureAuthorizedPaymentForPayload,
    voidAuthorizedPaymentForPayload,
    reauthorizeAuthorizedPaymentForPayload,
    activateBillingPlanForPayload,
    createBillingPlanForPayload,
    createSubscriptionForPayload,
    getSubscriptionForPayload,
    patchSubscriptionForPayload,
    reviseSubscriptionForPayload,
    activateSubscriptionForPayload,
    suspendSubscriptionForPayload,
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
    listInvoicesForPayload,
    introspectTokenForPayload,
    revokeTokenForPayload,
    createPartnerReferralForPayload,
    getPartnerReferralForPayload,
    getMerchantIntegrationStatusForPayload,
    applyWebhookEvent
  };
}
