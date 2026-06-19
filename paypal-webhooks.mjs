import crypto from "crypto";
import { promises as fs } from "fs";

function crc32(buf) {
  if (typeof buf === 'string') buf = Buffer.from(buf);
  let crc = 0 ^ -1;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

const CACHE_DIR = "./app/runtime/security";

async function downloadAndCache(url) {
  const cacheKey = url.replace(/\W+/g, '-');
  const filePath = `${CACHE_DIR}/${cacheKey}`;

  const cachedData = await fs.readFile(filePath, 'utf-8').catch(() => null);
  if (cachedData) {
    return cachedData;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download certificate from ${url}: ${response.statusText}`);
  }
  const data = await response.text();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(filePath, data);

  return data;
}

async function verifySignatureLocally(event, headers, webhookId) {
  const transmissionId = headers['paypal-transmission-id'];
  const timeStamp = headers['paypal-transmission-time'];
  const sig = headers['paypal-transmission-sig'];
  const certUrl = headers['paypal-cert-url'];

  if (!transmissionId || !timeStamp || !sig || !certUrl) {
    return false;
  }

  const crc = crc32(event);
  const message = `${transmissionId}|${timeStamp}|${webhookId}|${crc}`;
  console.log(`[DEBUG_LOG] Local verification message: ${message}`);

  try {
    const certPem = await downloadAndCache(certUrl);
    const signatureBuffer = Buffer.from(sig, 'base64');
    const verifier = crypto.createVerify('SHA256');
    verifier.update(message);
    return verifier.verify(certPem, signatureBuffer);
  } catch (error) {
    console.error("[ERROR] Webhook local verification failed:", error);
    return false;
  }
}

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

      const isLocalValid = await verifySignatureLocally(rawBody, req.headers, paypalWebhookId);
      
      let verificationStatus = "FAILED";
      if (isLocalValid) {
        verificationStatus = "SUCCESS";
      } else {
        // Fallback to API verification if local fails (e.g. if CRC logic differs)
        const verification = await paypal.validateWebhook(
          transmissionId,
          transmissionTime,
          certUrl,
          paypalWebhookId,
          webhookEvent,
          authAlgo,
          transmissionSig
        );
        verificationStatus = readOptionalString(
          verification.verification_status || verification.status
        ).toUpperCase();
      }
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
