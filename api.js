const DEFAULT_BASE_URL =
  typeof process !== 'undefined'
    ? process.env?.EXPO_PUBLIC_API_BASE_URL?.trim?.() || 'https://awroadside-fire-backend-1.onrender.com'
    : 'https://awroadside-fire-backend-1.onrender.com';

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
    submitRequestFeedback(requestId, payload, tokenOverride = null) {
      return request(`/api/aw-roadside/requests/${encodeURIComponent(requestId)}/feedback`, {
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
    searchAdminAccounts(query, role = 'ALL', tokenOverride = null, extraHeaders = {}) {
      const params = new URLSearchParams({
        q: query,
        role,
      });
      return request(`/api/admin/search?${params.toString()}`, {
        token: tokenOverride,
        headers: extraHeaders,
      });
    },
    getAdminUserProfile(userId, tokenOverride = null, extraHeaders = {}) {
      return request(`/api/admin/users/${encodeURIComponent(userId)}/profile`, {
        token: tokenOverride,
        headers: extraHeaders,
      });
    },
    setAdminAccountState(userId, payload, tokenOverride = null, extraHeaders = {}) {
      return request(`/api/admin/users/${encodeURIComponent(userId)}/account-state`, {
        method: 'POST',
        body: JSON.stringify(payload),
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
    updateProviderTraining(userId, payload, tokenOverride = null, extraHeaders = {}) {
      return request(`/api/admin/providers/${encodeURIComponent(userId)}/training`, {
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
      const error = new Error(normalizeApiErrorMessage(payload, response.status));
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

function normalizeApiErrorMessage(payload, status) {
  const code = readValue(payload?.code || payload?.error).toLowerCase();

  const mapped =
    {
      'hard-eta-required': 'Service payment will unlock once the provider confirms the arrival estimate.',
      'customer-eta-acceptance-required': 'Please accept the arrival estimate before continuing.',
      'service-quote-not-accepted': 'Please accept the current service price before continuing.',
      'service-quote-mismatch': 'Refresh the current service price and try again.',
      'invalid-admin-credentials': 'Admin sign-in details were not accepted.',
      'missing-admin-credentials': 'Enter the admin email and password to continue.',
      'admin-auth-required': 'Admin sign-in is required.',
      'invalid-admin-session': 'Your admin session expired. Please sign in again.',
      'admin-2fa-required': 'Enter the verification code to continue.',
      'no-refund-policy': 'Refunds are not available after payment is submitted.',
      'request-service-not-configured': 'Dispatch service is not ready yet.',
      'payment-required-before-contact': 'Direct provider-to-customer communication unlocks only after payment is captured.',
      'paypal-not-configured': 'Payments are not ready yet.',
      'paypal-create-failed': 'Unable to start the payment right now.',
      'paypal-capture-failed': 'Unable to complete the payment right now.',
      'method-not-allowed': 'That action is not available right now.',
    }[code];

  if (mapped) {
    return mapped;
  }

  if (status >= 500) {
    return 'Something went wrong on the service side. Please try again.';
  }

  return readValue(payload?.message) || readValue(payload?.error) || `Request failed with ${status}.`;
}

function readValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}
