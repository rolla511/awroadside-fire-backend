const path = require('path');

const DOMAIN_ACCESS_RULES = {
  system: ['system', 'admin'],
  identity: ['identity', 'admin', 'system'],
  profile: ['profile', 'admin', 'system'],
  financial: ['financial', 'admin', 'system'],
  integration: ['integration', 'admin', 'system'],
};

function normalizeRole(value) {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    : '';
}

function normalizeBaseUrl(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/\/+$/, '')
    : '';
}

function ensureApiBaseUrl(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return '';
  }

  return normalizedBaseUrl.endsWith('/api')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/api`;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function getConfiguredSystemRoles() {
  return Object.fromEntries(
    Object.entries(DOMAIN_ACCESS_RULES).map(([domain, roles]) => [domain, [...roles]])
  );
}

function readRequesterRoles(request) {
  const rawRoles = []
    .concat(request.headers['x-system-role'] || [])
    .concat(request.headers['x-system-roles'] || [])
    .join(',');

  return uniqueValues(
    rawRoles
      .split(',')
      .map((role) => normalizeRole(role))
      .filter(Boolean)
  );
}

function isLoopbackAddress(address) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'].includes(String(address || ''));
}

function authorizeSystemAccess(request, domain, env = process.env) {
  const allowedRoles = DOMAIN_ACCESS_RULES[domain] || [];
  const requesterRoles = readRequesterRoles(request);
  const roleAllowed = requesterRoles.some((role) => allowedRoles.includes(role));
  const configuredSystemKey = String(env.SYSTEM_API_KEY || '').trim();
  const providedSystemKey = String(request.headers['x-system-key'] || '').trim();
  const localLoopback = isLoopbackAddress(request.socket?.remoteAddress);

  if (roleAllowed && (!configuredSystemKey || providedSystemKey === configuredSystemKey)) {
    return {
      ok: true,
      requesterRoles,
      accessMode: configuredSystemKey ? 'role_and_key' : 'role',
    };
  }

  if (!configuredSystemKey && localLoopback && roleAllowed) {
    return {
      ok: true,
      requesterRoles,
      accessMode: 'role_and_loopback',
    };
  }

  return {
    ok: false,
    statusCode: 403,
    body: {
      error: 'system-access-denied',
      message: `Endpoint requires system access for domain "${domain}". Allowed roles: ${allowedRoles.join(', ') || 'none'}.`,
    },
  };
}

function buildSystemPathReport(env = process.env, options = {}) {
  const projectRoot = path.resolve(__dirname, '..');
  const backendRoot = __dirname;
  const runtimeRoot = path.join(projectRoot, 'working-html-runtime');
  const host = env.HOST || '127.0.0.1';
  const port = Number(env.PORT || 4000);
  const dbClient = String(env.DB_CLIENT || '').trim() || 'file';
  const baseCandidates = uniqueValues([
    normalizeBaseUrl(env.EXPO_PUBLIC_API_BASE_URL),
    normalizeBaseUrl(env.APP_BACKEND_BASE_URL),
    `http://${host}:${port}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);

  return {
    workspaceRoot: projectRoot,
    backendRoot,
    runtimeRoot,
    apiBaseUrl: ensureApiBaseUrl(baseCandidates[0] || `http://${host}:${port}`),
    fallbackApiBaseUrls: uniqueValues(baseCandidates.map(ensureApiBaseUrl)),
    storage: {
      mode: options.storageKind || dbClient,
      databaseClient: dbClient,
      databaseConfigured: Boolean(env.DATABASE_URL || env.DB_HOST),
      databaseTarget: summarizeDatabaseTarget(env),
    },
    dataPaths: {
      serviceRequestStore: env.ROADSIDE_DATA_PATH || path.join(backendRoot, 'data', 'store.json'),
      subscriberStore:
        env.ROADSIDE_SUBSCRIBER_DATA_PATH ||
        path.join(backendRoot, 'data', 'subscriber-store.json'),
      providerStore:
        env.ROADSIDE_PROVIDER_DATA_PATH || path.join(backendRoot, 'data', 'provider-store.json'),
      complianceStore:
        env.ROADSIDE_COMPLIANCE_DATA_PATH ||
        path.join(backendRoot, 'data', 'compliance-store.json'),
      providerDocumentsDir:
        env.ROADSIDE_PROVIDER_DOCUMENTS_DIR ||
        path.join(backendRoot, 'data', 'provider-documents'),
      accountStore:
        env.ROADSIDE_ACCOUNT_DATA_PATH || path.join(backendRoot, 'data', 'account-store.json'),
      integrationStore:
        env.ROADSIDE_INTEGRATION_DATA_PATH ||
        path.join(backendRoot, 'data', 'integration-store.json'),
    },
    domains: getConfiguredSystemRoles(),
  };
}

function summarizeDatabaseTarget(env = process.env) {
  if (env.DATABASE_URL) {
    try {
      const parsed = new URL(env.DATABASE_URL);
      const pathname = parsed.pathname.replace(/^\/+/, '');
      return {
        host: parsed.hostname,
        port: parsed.port || '',
        database: pathname,
      };
    } catch {
      return {
        host: '',
        port: '',
        database: '',
      };
    }
  }

  return {
    host: env.DB_HOST || '',
    port: env.DB_PORT || '',
    database: env.DB_NAME || '',
  };
}

module.exports = {
  authorizeSystemAccess,
  buildSystemPathReport,
  ensureApiBaseUrl,
  getConfiguredSystemRoles,
  readRequesterRoles,
};
