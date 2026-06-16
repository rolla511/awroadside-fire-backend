const INDEX_STORAGE_PREFIX = "awroadside-frontend-index";
const DEFAULT_RETENTION_MS = 48 * 60 * 60 * 1000;
const STATUS_EVENT_NAME = "awroadside:frontend-index-status";
const SERVER_EVENT_NAME = "awroadside:server-event";
const READY_EVENT_NAME = "awroadside:frontend-index-ready";
const defaultPublicBackendOrigin = "https://awroadside-fire-backend.onrender.com";
let currentConfig = readRuntimeConfig();
let urls = resolveUrls(currentConfig);

let eventSource = null;
let eventSourceUrl = "";

function normalizeUrlValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getDefaultBackendOrigin() {
  const currentOrigin = normalizeUrlValue(window.location.origin);
  if (!currentOrigin || currentOrigin === "null") {
    return defaultPublicBackendOrigin;
  }

  try {
    const url = new URL(currentOrigin);
    if (!["http:", "https:"].includes(url.protocol)) {
      return defaultPublicBackendOrigin;
    }
    if (url.hostname === "0.0.0.0") {
      return defaultPublicBackendOrigin;
    }
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return currentOrigin;
    }
  } catch {
    return defaultPublicBackendOrigin;
  }

  return defaultPublicBackendOrigin;
}

function readRuntimeConfig() {
  const config = window.AWRoadsideConfig || window.awRoadsideConfig || {};
  return {
    apiBaseUrl: normalizeUrlValue(config.apiBaseUrl),
    rawApiBaseUrl: normalizeUrlValue(config.rawApiBaseUrl),
    adminApiBaseUrl: normalizeUrlValue(config.adminApiBaseUrl),
    eventStreamUrl: normalizeUrlValue(config.eventStreamUrl),
    uiBaseUrl: normalizeUrlValue(config.uiBaseUrl)
  };
}

function resolveUrls(config) {
  const backendOrigin = resolveOrigin(
    config.rawApiBaseUrl ||
      config.apiBaseUrl ||
      config.adminApiBaseUrl ||
      config.uiBaseUrl ||
      getDefaultBackendOrigin()
  );

  return {
    backendOrigin,
    apiBaseUrl: config.apiBaseUrl || `${backendOrigin}/api/aw-roadside`,
    rawApiBaseUrl: config.rawApiBaseUrl || `${backendOrigin}/api`,
    adminApiBaseUrl: config.adminApiBaseUrl || `${backendOrigin}/api/admin`,
    eventStreamUrl: config.eventStreamUrl || `${backendOrigin}/events.mjs`
  };
}

function normalizeConfig(config = {}) {
  return {
    apiBaseUrl: normalizeUrlValue(config.apiBaseUrl),
    rawApiBaseUrl: normalizeUrlValue(config.rawApiBaseUrl),
    adminApiBaseUrl: normalizeUrlValue(config.adminApiBaseUrl),
    eventStreamUrl: normalizeUrlValue(config.eventStreamUrl),
    uiBaseUrl: normalizeUrlValue(config.uiBaseUrl)
  };
}

function resolveOrigin(value) {
  const candidate = normalizeUrlValue(value);
  if (!candidate) {
    return getDefaultBackendOrigin();
  }

  try {
    const url = new URL(candidate, window.location.origin);
    if (url.hostname === "0.0.0.0") {
      return getDefaultBackendOrigin();
    }
    return url.origin;
  } catch {
    return getDefaultBackendOrigin();
  }
}

function storageKey(key) {
  return `${INDEX_STORAGE_PREFIX}:${key}`;
}

function readValue(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) {
      const legacyRaw = window.localStorage.getItem(key);
      if (!legacyRaw) {
        return fallback;
      }
      const legacyValue = JSON.parse(legacyRaw);
      writeValue(key, legacyValue);
      window.localStorage.removeItem(key);
      return legacyValue;
    }
    const parsed = JSON.parse(raw);
    const expiresAt = Number(parsed?.expiresAt || 0);
    if (expiresAt && Date.now() > expiresAt) {
      window.localStorage.removeItem(storageKey(key));
      return fallback;
    }
    return Object.prototype.hasOwnProperty.call(parsed || {}, "value") ? parsed.value : fallback;
  } catch {
    return fallback;
  }
}

function writeValue(key, value, ttlMs = DEFAULT_RETENTION_MS) {
  try {
    if (value === null || typeof value === "undefined") {
      window.localStorage.removeItem(storageKey(key));
      return;
    }
    window.localStorage.setItem(storageKey(key), JSON.stringify({
      storedAt: new Date().toISOString(),
      expiresAt: Date.now() + Number(ttlMs || DEFAULT_RETENTION_MS),
      value
    }));
  } catch {
    // Ignore restricted-browser storage failures.
  }
}

function removeValue(key) {
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch {
    // Ignore restricted-browser storage failures.
  }
}

function sweepExpired() {
  try {
    const expiredKeys = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(`${INDEX_STORAGE_PREFIX}:`)) {
        continue;
      }
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        expiredKeys.push(key);
        continue;
      }
      const parsed = JSON.parse(raw);
      const expiresAt = Number(parsed?.expiresAt || 0);
      if (expiresAt && Date.now() > expiresAt) {
        expiredKeys.push(key);
      }
    }
    expiredKeys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Ignore malformed storage state and continue.
  }
}

function dispatch(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function syncWindowConfig() {
  window.AWRoadsideConfig = Object.assign({}, window.AWRoadsideConfig || {}, {
    apiBaseUrl: urls.apiBaseUrl,
    rawApiBaseUrl: urls.rawApiBaseUrl,
    adminApiBaseUrl: urls.adminApiBaseUrl,
    eventStreamUrl: urls.eventStreamUrl,
    frontendIndexRetentionMs: DEFAULT_RETENTION_MS
  });
}

function closeEventBridge() {
  if (!eventSource) {
    return;
  }
  try {
    eventSource.close();
  } catch {
    // Ignore close failures during reconnect.
  }
  eventSource = null;
  eventSourceUrl = "";
}

function updateConfig(nextConfig = {}) {
  currentConfig = {
    ...currentConfig,
    ...normalizeConfig(nextConfig)
  };
  urls = resolveUrls(currentConfig);
  syncWindowConfig();
  if (eventSource && eventSourceUrl !== urls.eventStreamUrl) {
    closeEventBridge();
    startEventBridge();
  }
  return urls;
}

function parseServerEvent(event) {
  if (!event || typeof event.data !== "string" || !event.data.trim()) {
    return null;
  }
  try {
    return JSON.parse(event.data);
  } catch {
    return { raw: event.data };
  }
}

function startEventBridge() {
  if (typeof window.EventSource !== "function") {
    return false;
  }
  if (eventSource && eventSourceUrl === urls.eventStreamUrl) {
    return true;
  }
  if (eventSource) {
    closeEventBridge();
  }

  const streamUrl = urls.eventStreamUrl;
  eventSource = new EventSource(streamUrl);
  eventSourceUrl = streamUrl;
  eventSource.onopen = () => {
    dispatch(STATUS_EVENT_NAME, {
      status: "connected",
      url: streamUrl,
      receivedAt: new Date().toISOString()
    });
  };
  eventSource.onerror = () => {
    dispatch(STATUS_EVENT_NAME, {
      status: "disconnected",
      url: streamUrl,
      receivedAt: new Date().toISOString()
    });
  };

  ["users-updated", "requests-updated", "payments-updated"].forEach((eventName) => {
    eventSource.addEventListener(eventName, (event) => {
      const payload = parseServerEvent(event);
      const detail = {
        event: eventName,
        payload,
        url: streamUrl,
        receivedAt: new Date().toISOString()
      };
      writeValue("last-server-event", detail);
      dispatch(SERVER_EVENT_NAME, detail);
      dispatch(`awroadside:${eventName}`, detail);
    });
  });

  return true;
}

syncWindowConfig();

window.AWRoadsideFrontendIndex = {
  version: "2026-05-30",
  retentionMs: DEFAULT_RETENTION_MS,
  get urls() {
    return urls;
  },
  readValue,
  writeValue,
  removeValue,
  startEventBridge,
  updateConfig,
  getState() {
    return {
      retentionMs: DEFAULT_RETENTION_MS,
      urls,
      lastServerEvent: readValue("last-server-event", null)
    };
  }
};

sweepExpired();
dispatch(READY_EVENT_NAME, window.AWRoadsideFrontendIndex.getState());
