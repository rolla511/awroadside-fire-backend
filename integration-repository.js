const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  normalizeProvider,
  sanitizeHeadersForStorage,
  summarizeWebhookEvent,
} = require('./integration-policy');

const defaultStore = {
  webhookEvents: [],
};

function getIntegrationDataPath(env = process.env) {
  return (
    env.ROADSIDE_INTEGRATION_DATA_PATH || path.join(__dirname, 'data', 'integration-store.json')
  );
}

function ensureArtifacts(env = process.env) {
  const dataPath = getIntegrationDataPath(env);
  const directory = path.dirname(dataPath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(dataPath, JSON.stringify(defaultStore, null, 2));
  }
}

function readStore(env = process.env) {
  ensureArtifacts(env);
  const parsed = JSON.parse(fs.readFileSync(getIntegrationDataPath(env), 'utf8'));
  return {
    webhookEvents: Array.isArray(parsed.webhookEvents) ? parsed.webhookEvents : [],
  };
}

function writeStore(store, env = process.env) {
  ensureArtifacts(env);
  fs.writeFileSync(getIntegrationDataPath(env), JSON.stringify(store, null, 2));
}

class FileIntegrationRepository {
  constructor(env = process.env) {
    this.env = env;
    this.kind = 'file';
  }

  async init() {
    ensureArtifacts(this.env);
  }

  async recordWebhookEvent(provider, payload, options = {}) {
    const store = readStore(this.env);
    const normalizedProvider = normalizeProvider(provider);
    const summary = summarizeWebhookEvent(normalizedProvider, payload);
    const event = {
      id: `wbh-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      provider: normalizedProvider,
      externalEventId: summary.externalEventId,
      eventType: summary.eventType,
      resourceId: summary.resourceId,
      sourcePath: options.sourcePath || '',
      verificationStatus: options.verificationStatus || 'not_verified',
      verificationDetail: options.verificationDetail || '',
      headers: sanitizeHeadersForStorage(options.headers),
      payload,
      receivedAt: new Date().toISOString(),
    };

    store.webhookEvents.unshift(event);
    writeStore(store, this.env);
    return event;
  }

  async listWebhookEvents(filters = {}) {
    const provider = normalizeProvider(filters.provider);
    const query = String(filters.q || '').trim().toLowerCase();
    const eventType = String(filters.eventType || '').trim().toLowerCase();
    const limit = Number(filters.limit || 50);

    return readStore(this.env).webhookEvents
      .filter((event) => {
        if (provider && event.provider !== provider) {
          return false;
        }

        if (eventType && String(event.eventType || '').toLowerCase() !== eventType) {
          return false;
        }

        if (!query) {
          return true;
        }

        const haystack = [event.externalEventId, event.resourceId, event.eventType, event.provider]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, Number.isFinite(limit) ? limit : 50);
  }
}

function createIntegrationRepository(env = process.env) {
  return new FileIntegrationRepository(env);
}

module.exports = {
  createIntegrationRepository,
};
