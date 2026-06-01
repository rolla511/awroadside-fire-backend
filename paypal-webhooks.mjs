export function createPaypalWebhookRouteHandler({
  paypal,
  paypalClientId,
  paypalClientSecret,
  paypalWebhookId,
  paypalWebhookPaths,
  sendJson,
  sendMethodNotAllowed,
  readRawBody,
  readHeader,
  readOptionalString,
  appendPaypalWebhookLog,
  appendPaymentLog,
  hasProcessedPaypalWebhook,
  applyPaypalWebhookEvent
}) {
  return async function handlePaypalWebhookRoute(req, res, pathname) {
    if (!paypalWebhookPaths.includes(pathname)) {
      return false;
    }

    if (req.method !== "POST") {
      sendMethodNotAllowed(res, "POST");
      return true;
    }

    if (!paypalClientId || !paypalClientSecret || !paypalWebhookId) {
      sendJson(res, 503, {
        error: "paypal-webhook-not-configured",
        message: "Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_WEBHOOK_ID before accepting webhooks."
      });
      return true;
    }

    try {
      const rawBody = await readRawBody(req);
      if (!rawBody.trim()) {
        sendJson(res, 400, {
          error: "invalid-webhook-payload",
          message: "Webhook payload must be valid JSON."
        });
        return true;
      }

      let webhookEvent;
      try {
        webhookEvent = JSON.parse(rawBody);
      } catch {
        sendJson(res, 400, {
          error: "invalid-webhook-payload",
          message: "Webhook payload must be valid JSON."
        });
        return true;
      }

      const transmissionId = readHeader(req, "paypal-transmission-id");
      const transmissionTime = readHeader(req, "paypal-transmission-time");
      const transmissionSig = readHeader(req, "paypal-transmission-sig");
      const certUrl = readHeader(req, "paypal-cert-url");
      const authAlgo = readHeader(req, "paypal-auth-algo");
      const missingHeaders = [
        ["paypal-transmission-id", transmissionId],
        ["paypal-transmission-time", transmissionTime],
        ["paypal-transmission-sig", transmissionSig],
        ["paypal-cert-url", certUrl],
        ["paypal-auth-algo", authAlgo]
      ]
        .filter(([, value]) => !value)
        .map(([name]) => name);

      if (missingHeaders.length > 0) {
        sendJson(res, 400, {
          error: "missing-webhook-headers",
          message: `Missing PayPal webhook headers: ${missingHeaders.join(", ")}.`
        });
        return true;
      }

      const verification = await paypal.validateWebhook(
        transmissionId,
        transmissionTime,
        certUrl,
        paypalWebhookId,
        webhookEvent,
        authAlgo,
        transmissionSig
      );
      const verificationStatus = readOptionalString(
        verification.verification_status || verification.status
      ).toUpperCase();
      const eventId = readOptionalString(webhookEvent.id) || transmissionId;
      const eventType = readOptionalString(webhookEvent.event_type).toUpperCase() || "UNKNOWN";

      if (verificationStatus !== "SUCCESS") {
        await appendPaypalWebhookLog({
          receivedAt: new Date().toISOString(),
          deliveryId: transmissionId,
          eventId,
          eventType,
          verificationStatus: verificationStatus || "FAILED",
          matched: false,
          applied: false,
          note: "verification-failed"
        });
        sendJson(res, 400, {
          error: "paypal-webhook-verification-failed",
          eventId,
          eventType,
          verificationStatus: verificationStatus || "FAILED"
        });
        return true;
      }

      const duplicate = await hasProcessedPaypalWebhook({
        deliveryId: transmissionId,
        eventId
      });
      if (duplicate) {
        sendJson(res, 200, {
          ok: true,
          duplicate: true,
          eventId,
          eventType
        });
        return true;
      }

      const processing = await applyPaypalWebhookEvent(webhookEvent);
      await appendPaypalWebhookLog({
        receivedAt: new Date().toISOString(),
        deliveryId: transmissionId,
        eventId,
        eventType,
        resourceId: readOptionalString(webhookEvent?.resource?.id),
        verificationStatus,
        matched: processing.matched,
        applied: processing.applied,
        targetType: processing.targetType || null,
        targetId: processing.targetId || null,
        note: processing.note || null
      });
      await appendPaymentLog({
        event: "paypal-webhook",
        eventType,
        paypalEventId: eventId,
        resourceId: readOptionalString(webhookEvent?.resource?.id),
        requestId: processing.targetType === "request" ? processing.targetId || null : null,
        targetType: processing.targetType || null,
        targetId: processing.targetId || null,
        status: processing.note || verificationStatus || "processed",
        createdAt: new Date().toISOString()
      });

      sendJson(res, 200, {
        ok: true,
        duplicate: false,
        eventId,
        eventType,
        verificationStatus,
        matched: processing.matched,
        applied: processing.applied,
        targetType: processing.targetType || null,
        targetId: processing.targetId || null,
        note: processing.note || null
      });
    } catch (error) {
      console.error("[ERROR] PayPal Webhook Route Failed:", error);
      sendJson(res, 500, {
        error: "paypal-webhook-failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return true;
  };
}
