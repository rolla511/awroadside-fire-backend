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
    captureOrderForPayload,
    applyWebhookEvent
  };
}
