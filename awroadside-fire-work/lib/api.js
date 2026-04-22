const DEFAULT_BASE_URL =
  typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_BASE_URL?.trim?.() || '' : '';

export function createApiClient({ baseUrl = DEFAULT_BASE_URL, getToken = null } = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  return {
    baseUrl: normalizedBaseUrl,
    getFrontendConfig() {
      return request('/api/aw-roadside/frontend-config');
    },
    getCompatibilityManifest() {
      return request('/api/compat/manifest');
    },
    acknowledgeVariant(payload) {
      return request('/api/compat/acknowledge', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    getHealth() {
      return request('/api/aw-roadside/health');
    },
    getPaymentConfig() {
      return request('/api/aw-roadside/payments/config');
    },
    getSecurityStatus() {
      return request('/api/aw-roadside/security/status');
    },
    signup(payload) {
      return request('/api/aw-roadside/auth/signup', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    login(payload) {
      return request('/api/aw-roadside/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    getProfile(tokenOverride = null) {
      return request('/api/aw-roadside/auth/profile', {
        token: tokenOverride,
      });
    },
    setupSubscriber(payload, tokenOverride = null) {
      return request('/api/aw-roadside/auth/subscriber/setup', {
        method: 'POST',
        body: JSON.stringify(payload),
        token: tokenOverride,
      });
    },
    applyProvider(payload, tokenOverride = null) {
      return request('/api/aw-roadside/auth/provider/apply', {
        method: 'POST',
        body: JSON.stringify(payload),
        token: tokenOverride,
      });
    },
    listRequests(tokenOverride = null) {
      return request('/api/aw-roadside/requests', {
        token: tokenOverride,
      });
    },
    createRequest(payload, tokenOverride = null) {
      return request('/api/aw-roadside/requests', {
        method: 'POST',
        body: JSON.stringify(payload),
        token: tokenOverride,
      });
    },
    applyProviderAction(requestId, action, payload = {}, tokenOverride = null) {
      return request(`/api/aw-roadside/requests/${encodeURIComponent(requestId)}/${encodeURIComponent(action)}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        token: tokenOverride,
      });
    },
    getServicePaymentQuote(payload, tokenOverride = null) {
      return request('/api/aw-roadside/payments/service-quote', {
        method: 'POST',
        body: JSON.stringify(payload),
        token: tokenOverride,
      });
    },
    createPaypalOrder(payload, tokenOverride = null) {
      return request('/api/aw-roadside/payments/create-order', {
        method: 'POST',
        body: JSON.stringify(payload),
        token: tokenOverride,
      });
    },
    capturePaypalOrder(payload, tokenOverride = null) {
      return request('/api/aw-roadside/payments/capture-order', {
        method: 'POST',
        body: JSON.stringify(payload),
        token: tokenOverride,
      });
    },
    adminLogin(payload) {
      return request('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    getAdminDashboard(tokenOverride = null, extraHeaders = {}) {
      return request('/api/admin/dashboard', {
        token: tokenOverride,
        headers: extraHeaders,
      });
    },
    getAdminRequests(tokenOverride = null, extraHeaders = {}) {
      return request('/api/admin/requests', {
        token: tokenOverride,
        headers: extraHeaders,
      });
    },
    getAdminSubscribers(tokenOverride = null, extraHeaders = {}) {
      return request('/api/admin/subscribers', {
        token: tokenOverride,
        headers: extraHeaders,
      });
    },
    approveProvider(payload, tokenOverride = null, extraHeaders = {}) {
      return request('/api/admin/provider/approve', {
        method: 'POST',
        body: JSON.stringify(payload),
        token: tokenOverride,
        headers: extraHeaders,
      });
    },
    refundRequest(payload, tokenOverride = null, extraHeaders = {}) {
      return request('/api/admin/refund', {
        method: 'POST',
        body: JSON.stringify(payload),
        token: tokenOverride,
        headers: extraHeaders,
      });
    },
    completePayout(payload, tokenOverride = null, extraHeaders = {}) {
      return request('/api/admin/payout', {
        method: 'POST',
        body: JSON.stringify(payload),
        token: tokenOverride,
        headers: extraHeaders,
      });
    },
    resetRequest(requestId, payload = {}, tokenOverride = null, extraHeaders = {}) {
      return request(`/api/admin/requests/${encodeURIComponent(requestId)}/reset`, {
        method: 'POST',
        body: JSON.stringify(payload),
        token: tokenOverride,
        headers: extraHeaders,
      });
    },
  };

  async function request(path, options = {}) {
    if (!normalizedBaseUrl) {
      throw new Error('Backend URL is required. Set EXPO_PUBLIC_API_BASE_URL or enter it in the app runtime panel.');
    }
    const token = options.token || resolveToken(getToken);
    const headers = {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const response = await fetch(`${normalizedBaseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body,
    });

    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { message: text || 'Unexpected response.' };
    }

    if (!response.ok) {
      const error = new Error(payload.message || payload.error || `Request failed with ${response.status}.`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }
}

function resolveToken(getToken) {
  if (typeof getToken !== 'function') {
    return null;
  }
  const token = getToken();
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

function normalizeBaseUrl(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return (candidate || DEFAULT_BASE_URL).replace(/\/$/, '');
}
