function sanitizeHeadersForStorage(headers = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowered = String(key).toLowerCase();
    if (['authorization', 'cookie', 'x-system-key'].includes(lowered)) {
      continue;
    }

    sanitized[lowered] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  return sanitized;
}

function normalizeProvider(value) {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    : '';
}

function summarizeWebhookEvent(provider, payload = {}) {
  const normalizedProvider = normalizeProvider(provider);
  if (normalizedProvider === 'paypal') {
    return {
      externalEventId: String(payload.id || '').trim(),
      eventType: String(payload.event_type || '').trim() || 'unknown_paypal_event',
      resourceId: String(payload.resource?.id || payload.resource?.supplementary_data?.related_ids?.order_id || '').trim(),
    };
  }

  return {
    externalEventId: String(payload.id || payload.event_id || '').trim(),
    eventType:
      String(payload.type || payload.event || payload.event_type || '').trim() ||
      `${normalizedProvider || 'unknown'}_event`,
    resourceId:
      String(payload.resource?.id || payload.resource_id || payload.mapbox_id || '').trim(),
  };
}

module.exports = {
  normalizeProvider,
  sanitizeHeadersForStorage,
  summarizeWebhookEvent,
};
