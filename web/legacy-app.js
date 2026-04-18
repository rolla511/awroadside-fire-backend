const storageKey = "adub-auth-session";

const state = {
  frontendConfig: null,
  paymentConfig: null,
  pendingRequest: null,
  paypalScriptPromise: null,
  auth: readStoredAuth(),
  admin: readStoredAdmin()
};

document.addEventListener("DOMContentLoaded", () => {
  initializeApp().catch((error) => {
    setText("api-status", `Service unavailable: ${error.message}`);
  });
});

async function initializeApp() {
  setupNavigation();
  renderIdentity();
  renderAdminState();
  setupHomeAuth();
  setupSubscriberModal();
  setupProviderSignup();
  setupProviderSignin();
  setupAdminPanel();
  setupRequestForm();
  await loadFrontendConfig();
  await loadPaymentConfig();
  await loadSecurityStatus();
  await loadAdminDashboard();
}

function setupHomeAuth() {
  const signInForm = document.getElementById("signin-form");
  if (signInForm) {
    signInForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const formData = new FormData(signInForm);
        const response = await apiFetch("/auth/login", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({
            identifier: normalizeField(formData.get("identifier")),
            password: normalizeField(formData.get("password"))
          })
        });
        const payload = await response.json();
        if (!response.ok || !payload.userId) {
          throw new Error(payload.message || payload.error || "Unable to sign in.");
        }
        state.auth = {
          userId: payload.userId,
          roles: payload.roles || [],
          providerStatus: payload.providerStatus || null,
          subscriberActive: Boolean(payload.subscriberActive),
          sessionToken: payload.sessionToken || null
        };
        storeAuth(state.auth);
        renderIdentity();
        switchScreen("customer");
        showBox("signin-status", "Signed in.");
      } catch (error) {
        showBox("signin-status", error.message);
      }
    });
  }

  wireModal("member-signup-open", "member-signup-close", "member-signup-modal");
  wireModal("provider-signup-open", "provider-signup-close", "provider-signup-modal");
}

function setupSubscriberModal() {
  const form = document.getElementById("member-signup-form") || document.getElementById("subscriber-signup-form");
  if (!form) {
    return;
  }

  setupSubscriberPaymentUi(form);
  const statusId = form.id === "member-signup-form" ? "member-signup-status" : "subscriber-signup-status";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(form);
      const signup = await createAccount({
        fullName: normalizeField(formData.get("fullName")),
        username: normalizeField(formData.get("username")),
        email: normalizeField(formData.get("email")),
        password: normalizeField(formData.get("password")),
        role: "SUBSCRIBER"
      });

      const response = await apiFetch("/auth/subscriber/setup", {
        method: "POST",
        headers: jsonHeaders(signup.sessionToken),
        body: JSON.stringify({
          vehicle: {
            year: normalizeField(formData.get("year")),
            make: normalizeField(formData.get("make")),
            model: normalizeField(formData.get("model")),
            color: normalizeField(formData.get("color"))
          },
          paymentMethodMasked: buildSubscriberPaymentValue(formData)
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.userId) {
        throw new Error(payload.message || payload.error || "Unable to activate subscriber membership.");
      }

      state.auth = {
        userId: payload.userId,
        roles: ["SUBSCRIBER"],
        providerStatus: null,
        subscriberActive: true,
        sessionToken: signup.sessionToken || null
      };
      storeAuth(state.auth);
      renderIdentity();
      switchScreen("customer");
      showBox(statusId, "Member account created and subscription activated.");
      hideModal("member-signup-modal");
      hideModal("subscriber-modal");
    } catch (error) {
      showBox(statusId, error.message);
    }
  });
}

function setupProviderSignup() {
  const form = document.getElementById("provider-signup-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(form);
      const signup = await createAccount({
        fullName: normalizeField(formData.get("fullName")),
        username: normalizeField(formData.get("username")),
        email: normalizeField(formData.get("email")),
        password: normalizeField(formData.get("password")),
        role: "PROVIDER"
      });
      const selectedServices = collectCheckedValues(form, "services");
      if (selectedServices.length === 0) {
        throw new Error("Select at least one provider service.");
      }

      const response = await apiFetch("/auth/provider/apply", {
        method: "POST",
        headers: jsonHeaders(signup.sessionToken),
        body: JSON.stringify({
          vehicleInfo: {
            year: normalizeField(formData.get("year")),
            make: normalizeField(formData.get("make")),
            model: normalizeField(formData.get("model")),
            color: normalizeField(formData.get("color"))
          },
          documents: {
            license: formData.get("license") === "on",
            registration: formData.get("registration") === "on",
            insurance: formData.get("insurance") === "on",
            helperId: formData.get("helperId") === "on"
          },
          experience: normalizeField(formData.get("experience")),
          services: selectedServices
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.userId) {
        throw new Error(payload.message || payload.error || "Unable to submit provider application.");
      }

      state.auth = {
        userId: payload.userId,
        roles: ["PROVIDER"],
        providerStatus: payload.providerStatus || "PENDING_APPROVAL",
        subscriberActive: false,
        sessionToken: signup.sessionToken || null
      };
      storeAuth(state.auth);
      renderIdentity();
      switchScreen("provider");
      showBox("provider-signup-status", "Provider account created. Waiting for admin approval.");
      hideModal("provider-signup-modal");
    } catch (error) {
      showBox("provider-signup-status", error.message);
    }
  });
}

function setupSubscriberPaymentUi(form) {
  const methodInput = document.getElementById("member-payment-method");
  const maskedInput = document.getElementById("member-payment-masked");
  const upiInput = document.getElementById("member-payment-upi");

  if (!methodInput || !maskedInput || !upiInput) {
    return;
  }

  const syncPaymentInputs = () => {
    const method = normalizeField(methodInput.value).toUpperCase();
    const isUpi = method === "UPI";
    maskedInput.style.display = isUpi ? "none" : "block";
    upiInput.style.display = isUpi ? "block" : "none";
    maskedInput.required = !isUpi;
    upiInput.required = isUpi;

    if (!isUpi && !normalizeField(maskedInput.value)) {
      maskedInput.value = method === "MANUAL" ? "manual-test-mode" : "****1111";
    }
  };

  methodInput.addEventListener("change", syncPaymentInputs);
  syncPaymentInputs();
}

function buildSubscriberPaymentValue(formData) {
  const method = normalizeField(formData.get("paymentMethodType")).toUpperCase();
  const maskedValue = normalizeField(formData.get("paymentMethodMasked"));
  const upiValue = normalizeField(formData.get("paymentUpiId"));

  if (method === "UPI") {
    if (!upiValue) {
      throw new Error("UPI ID is required when UPI is selected.");
    }
    return `UPI:${upiValue}`;
  }

  if (method === "MANUAL") {
    return maskedValue || "manual-test-mode";
  }

  return maskedValue || "****1111";
}

function collectCheckedValues(form, fieldName) {
  return Array.from(form.querySelectorAll(`input[name="${fieldName}"]:checked`))
    .map((input) => normalizeField(input.value))
    .filter(Boolean);
}

function setupProviderSignin() {
  const form = document.getElementById("provider-signin-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(form);
      const response = await apiFetch("/auth/login", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          identifier: normalizeField(formData.get("identifier")),
          password: normalizeField(formData.get("password"))
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.userId) {
        throw new Error(payload.message || payload.error || "Unable to sign in as provider.");
      }
      state.auth = {
        userId: payload.userId,
        roles: payload.roles,
        providerStatus: payload.providerStatus || null,
        subscriberActive: Boolean(payload.subscriberActive),
        sessionToken: payload.sessionToken || null
      };
      storeAuth(state.auth);
      renderIdentity();
      switchScreen("provider");
      showBox("provider-signin-status", "Provider signed in.");
    } catch (error) {
      showBox("provider-signin-status", error.message);
    }
  });
}

function setupRequestForm() {
  const form = document.getElementById("request-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      state.pendingRequest = collectRequestFormData(form);
      enforceRequestIdentityRules(state.pendingRequest);
      const response = await apiFetch("/requests", {
        method: "POST",
        headers: jsonHeaders(true),
        body: JSON.stringify(state.pendingRequest)
      });
      const payload = await response.json();
      const requestId = payload.requestId || payload.id;
      if (!response.ok || !requestId) {
        throw new Error(payload.message || payload.error || "Unable to submit request.");
      }

      state.pendingRequest = { ...state.pendingRequest, requestId };
      showBox("submit-status", `Request submitted. Reference ${requestId}.`);
      if (state.paymentConfig?.enabled) {
        setText("paypal-status", "Priority payment is available.");
        togglePaypalContainer(true);
      } else {
        setText("paypal-status", "Request submitted. PayPal priority upgrade is not configured.");
        togglePaypalContainer(false);
      }
    } catch (error) {
      showBox("submit-status", error.message);
      if (!state.pendingRequest) {
        setText("paypal-status", "Check your request details before continuing.");
        togglePaypalContainer(false);
      }
    }
  });
}

async function loadFrontendConfig() {
  try {
    const [healthResponse, configResponse] = await Promise.all([
      apiFetch("/health"),
      apiFetch("/frontend-config")
    ]);

    const health = await healthResponse.json();
    const config = await configResponse.json();
    state.frontendConfig = {
      ...config,
      apiBaseUrl: resolveApiBaseUrl(config?.apiBaseUrl),
      rawApiBaseUrl: resolveRawApiBaseUrl(config?.rawApiBaseUrl),
      uiBaseUrl: resolveUiBaseUrl(config?.uiBaseUrl)
    };

    setText("backend-status", health.status.toUpperCase());
    setText("backend-service", "Service is available");
    setText("api-port", "24/7");
    setText("api-url", "Dispatch online");
    setText("api-status", "Service is available.");
    setText("security-layer-name", "Ready");
    setText("priority-price", formatUsd(config.priorityServicePrice || 25));
    setText("subscriber-monthly-price", "$5.00/mo");
    setText("provider-monthly-price", "$5.99/mo");
  } catch (error) {
    setText("backend-status", "OFF");
    setText("backend-service", "Service unavailable");
    setText("api-status", `Unable to reach dispatch: ${error.message}`);
  }
}

async function loadPaymentConfig() {
  const paypalStatus = document.getElementById("paypal-status");
  if (!paypalStatus) {
    return;
  }

  try {
    const response = await apiFetch("/payments/config");
    const config = await response.json();
    state.paymentConfig = config;

    if (!response.ok || !config.enabled || !config.clientId) {
      setText("paypal-status", "PayPal priority upgrade is not configured.");
      togglePaypalContainer(false);
      return;
    }

    setText("paypal-status", "Priority payment is available after request submission.");
    setText("priority-price", formatUsd(config.priorityServicePrice || 25));
    await ensurePaypalSdk(config.clientId, config.currency || "USD");
    renderPaypalButtons();
  } catch (error) {
    setText("paypal-status", `Payment config failed: ${error.message}`);
    togglePaypalContainer(false);
  }
}

async function ensurePaypalSdk(clientId, currency) {
  if (state.paypalScriptPromise) {
    return state.paypalScriptPromise;
  }

  state.paypalScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-paypal-sdk="true"]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load PayPal SDK.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture`;
    script.async = true;
    script.dataset.paypalSdk = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load PayPal SDK."));
    document.head.appendChild(script);
  });

  return state.paypalScriptPromise;
}

function renderPaypalButtons() {
  const container = document.getElementById("paypal-button-container");
  if (!container || !window.paypal || !state.paymentConfig?.enabled) {
    togglePaypalContainer(false);
    return;
  }

  container.innerHTML = "";

  window.paypal.Buttons({
    style: { shape: "pill", layout: "vertical", label: "pay" },
    onClick(data, actions) {
      if (!state.pendingRequest) {
        showBox("submit-status", "Submit your request first.");
        return actions.reject();
      }
      setText("paypal-status", "Opening payment window...");
      return actions.resolve();
    },
    async createOrder() {
      const response = await apiFetch("/payments/create-order", {
        method: "POST",
        headers: jsonHeaders(true),
        body: JSON.stringify(state.pendingRequest)
      });

      const payload = await response.json();
      if (!response.ok || !payload.orderId) {
        throw new Error(payload.message || payload.error || "Unable to create PayPal order.");
      }

      setText("paypal-status", `Order ${payload.orderId} created. Complete payment in the popup window.`);
      return payload.orderId;
    },
    async onApprove(data) {
      const response = await apiFetch("/payments/capture-order", {
        method: "POST",
        headers: jsonHeaders(true),
        body: JSON.stringify({ orderId: data.orderID })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Unable to capture PayPal order.");
      }

      showBox("submit-status", `Priority payment captured for request ${state.pendingRequest.requestId || "pending"}.`);
      setText("paypal-status", `Captured with status ${payload.status}.`);
    },
    onCancel() {
      setText("paypal-status", "Payment popup closed before approval.");
    },
    onError(error) {
      setText("paypal-status", `PayPal error: ${error.message}`);
    }
  }).render("#paypal-button-container");
}

async function createAccount(payload) {
  const response = await apiFetch("/auth/signup", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      ...payload,
      termsAccepted: true
    })
  });
  const data = await response.json();
  if (!response.ok || !data.userId) {
    throw new Error(data.message || data.error || "Unable to create account.");
  }
  return data;
}

function setupAdminPanel() {
  const form = document.getElementById("admin-login-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(form);
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizeField(formData.get("email")),
          password: normalizeField(formData.get("password")),
          locationZone: normalizeField(formData.get("locationZone")),
          twoFactorCode: normalizeField(formData.get("twoFactorCode"))
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Unable to login as admin.");
      }
      if (payload.twoFactorRequired) {
        state.admin = {
          token: null,
          locationZone: normalizeField(formData.get("locationZone")) || null,
          pendingTwoFactor: true
        };
        storeAdmin(state.admin);
        renderAdminState();
        showBox("admin-login-status", payload.message || "2FA is required.");
        return;
      }
      if (!payload.token) {
        throw new Error("Admin token missing from backend response.");
      }

      state.admin = {
        token: payload.token,
        roles: payload.roles || [],
        trustedZone: payload.trustedZone || null,
        locationZone: normalizeField(formData.get("locationZone")) || null,
        twoFactorVerified: Boolean(payload.twoFactorVerified),
        pendingTwoFactor: false
      };
      storeAdmin(state.admin);
      renderAdminState();
      await loadAdminDashboard();
      showBox("admin-login-status", "Admin session established.");
    } catch (error) {
      showBox("admin-login-status", error.message);
    }
  });

  const refreshButton = document.getElementById("watchdog-refresh-button");
  if (refreshButton) {
    refreshButton.addEventListener("click", async () => {
      await loadSecurityStatus();
    });
  }
}

async function loadAdminDashboard() {
  if (!state.admin?.token) {
    return;
  }

  try {
    const headers = {
      Authorization: `Bearer ${state.admin.token}`
    };
    if (state.admin.locationZone) {
      headers["x-location-zone"] = state.admin.locationZone;
    }
    if (state.admin.twoFactorVerified) {
      headers["x-2fa-verified"] = "true";
    }

    const response = await fetch("/api/admin/dashboard", {
      method: "GET",
      headers
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Unable to load admin dashboard.");
    }

    setText("admin-email", payload.adminEmail || "Unknown");
    setText("admin-roles", (payload.roles || []).join(", ") || "None");
    setText("admin-request-count", String(payload.requestCount ?? 0));
    setText("admin-payment-configured", payload.paymentConfigured ? "Configured" : "Not Ready");
    setText("admin-status-label", "Signed in");
    setText("admin-status-badge", payload.trustedZone || "Active");
    setText("admin-status-text", `Location zone: ${payload.locationZone || "not set"}.`);
  } catch (error) {
    showBox("admin-login-status", error.message);
  }
}

async function loadSecurityStatus() {
  try {
    const response = await apiFetch("/security/status");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Unable to load security status.");
    }

    setText("security-layer-state", payload.watchdog?.integrityOk ? "READY" : "CHECK");
    setText("security-layer-detail", payload.watchdog?.integrityOk ? "System ready" : "System needs review");
    setText("security-layer-name", "Ready");
    setText("watchdog-integrity", payload.watchdog?.integrityOk ? "READY" : "CHECK");
    setText("watchdog-summary", payload.watchdog?.integrityOk ? "System looks ready." : "System needs review.");
    setText("watchdog-scanned-at", formatTimestamp(payload.watchdog?.scannedAt));
    renderWatchdogFiles(payload.watchdog?.suspiciousFiles || []);
  } catch (error) {
    setText("security-layer-state", "OFF");
    setText("security-layer-detail", error.message);
    setText("watchdog-integrity", "ERROR");
    setText("watchdog-summary", error.message);
  }
}

function collectRequestFormData(form) {
  const formData = new FormData(form);
  return {
    userId: state.auth?.userId || null,
    roles: state.auth?.roles || [],
    fullName: normalizeField(formData.get("fullName")),
    phoneNumber: normalizeField(formData.get("phoneNumber")),
    serviceType: normalizeField(formData.get("serviceType")),
    location: normalizeField(formData.get("location")),
    notes: normalizeField(formData.get("notes")),
    assignedProviderId: ""
  };
}

function enforceRequestIdentityRules(payload) {
  if (!payload.fullName || !payload.phoneNumber || !payload.serviceType || !payload.location) {
    throw new Error("Full name, phone number, service type, and location are required.");
  }
}

function renderIdentity() {
  const auth = state.auth;
  const roleText = auth?.roles?.join("/") || "None";
  const detail = auth
    ? auth.roles.includes("PROVIDER")
      ? `Provider signed in${auth.providerStatus ? ` · ${auth.providerStatus}` : ""}`
      : auth.roles.includes("SUBSCRIBER")
        ? `Subscriber signed in${auth.subscriberActive ? " · membership active" : ""}`
        : "Signed in"
    : "Continue as a guest or sign in.";

  setText("identity-role", roleText);
  setText("identity-state", detail);
  setText("customer-identity-role", roleText);
  setText("customer-identity-state", detail);
  setText("provider-identity-role", roleText);
  setText("provider-identity-state", detail);
  setText("provider-admin-status", auth?.providerStatus ? `Provider status: ${auth.providerStatus}.` : "Provider status will appear after sign-in.");
}

function renderAdminState() {
  const admin = state.admin;
  if (!admin?.token) {
    setText("admin-status-label", admin?.pendingTwoFactor ? "2FA required" : "Signed out");
    setText("admin-status-badge", admin?.pendingTwoFactor ? "2FA" : "Pending");
    setText("admin-status-text", admin?.pendingTwoFactor ? "Resubmit admin login with the required 2FA code." : "Use admin credentials to view dashboard status.");
    return;
  }

  setText("admin-status-label", "Signed in");
  setText("admin-status-badge", admin.trustedZone || "Active");
  setText("admin-status-text", `Admin token loaded for ${admin.locationZone || "default zone"}.`);
}

function setupNavigation() {
  window.addEventListener("hashchange", () => {
    switchScreen(readScreenFromHash());
  });
  switchScreen(readScreenFromHash());
}

function readScreenFromHash() {
  const value = window.location.hash.replace(/^#/, "").trim().toLowerCase();
  if (["home", "customer", "provider", "admin", "security"].includes(value)) {
    return value;
  }
  return "home";
}

function switchScreen(screen) {
  document.querySelectorAll("[data-screen]").forEach((element) => {
    element.hidden = element.getAttribute("data-screen") !== screen;
  });
  document.querySelectorAll("[data-nav]").forEach((element) => {
    element.classList.toggle("active", element.getAttribute("data-nav") === screen);
  });

  if (window.location.hash !== `#${screen}`) {
    window.history.replaceState(null, "", `#${screen}`);
  }
}

function renderWatchdogFiles(files) {
  const container = document.getElementById("watchdog-file-list");
  if (!container) {
    return;
  }

  if (!files.length) {
    container.innerHTML = '<div class="item"><div class="value">No integrity drift detected.</div><div class="muted">Protected files match the trusted baseline.</div></div>';
    return;
  }

  container.innerHTML = files
    .map((file) => {
      const detail = file.status === "modified"
        ? `Baseline ${shortHash(file.baselineSha256)} / Current ${shortHash(file.currentSha256)}`
        : "Review required.";
      return `<div class="item"><div class="value">${escapeHtml(file.path)} · ${escapeHtml(file.status)}</div><div class="muted">${escapeHtml(detail)}</div></div>`;
    })
    .join("");
}

function wireModal(openId, closeId, modalId) {
  const openButton = document.getElementById(openId);
  const closeButton = document.getElementById(closeId);
  const modal = document.getElementById(modalId);

  if (openButton && modal) {
    openButton.addEventListener("click", () => {
      modal.hidden = false;
    });
  }

  if (closeButton && modal) {
    closeButton.addEventListener("click", () => {
      modal.hidden = true;
    });
  }
}

function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.hidden = true;
  }
}

function readStoredAuth() {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readStoredAdmin() {
  try {
    const raw = window.localStorage.getItem(`${storageKey}-admin`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeAuth(auth) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(auth));
  } catch {
    // Ignore storage failures in restricted browsers.
  }
}

function storeAdmin(admin) {
  try {
    window.localStorage.setItem(`${storageKey}-admin`, JSON.stringify(admin));
  } catch {
    // Ignore storage failures in restricted browsers.
  }
}

function apiBaseUrl() {
  return resolveApiBaseUrl(state.frontendConfig?.apiBaseUrl);
}

function apiFetch(path, options = {}) {
  return fetch(`${apiBaseUrl()}${path}`, options);
}

function resolveApiBaseUrl(value) {
  const fallback = `${window.location.origin}/api/aw-roadside`;
  const candidate = normalizeUrlValue(value);
  if (!candidate) {
    return fallback;
  }

  try {
    const url = new URL(candidate, window.location.origin);
    if (url.hostname === "0.0.0.0") {
      return fallback;
    }
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return fallback;
  }
}

function resolveRawApiBaseUrl(value) {
  const fallback = `${window.location.origin}/api`;
  const candidate = normalizeUrlValue(value);
  if (!candidate) {
    return fallback;
  }

  try {
    const url = new URL(candidate, window.location.origin);
    if (url.hostname === "0.0.0.0") {
      return fallback;
    }
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return fallback;
  }
}

function resolveUiBaseUrl(value) {
  const fallback = window.location.origin;
  const candidate = normalizeUrlValue(value);
  if (!candidate) {
    return fallback;
  }

  try {
    const url = new URL(candidate, window.location.origin);
    if (url.hostname === "0.0.0.0") {
      return fallback;
    }
    return url.origin;
  } catch {
    return fallback;
  }
}

function normalizeUrlValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function jsonHeaders(withAuth = false) {
  const headers = { "Content-Type": "application/json" };
  const token =
    typeof withAuth === "string"
      ? withAuth
      : withAuth
        ? state.auth?.sessionToken
        : null;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function normalizeField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function showBox(id, message) {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }
  element.textContent = message;
  element.style.display = "block";
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function togglePaypalContainer(show) {
  const container = document.getElementById("paypal-button-container");
  if (container) {
    container.style.display = show ? "block" : "none";
  }
}

function formatUsd(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(amount) || 0);
}

function formatTimestamp(value) {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function shortHash(value) {
  return typeof value === "string" ? value.slice(0, 12) : "n/a";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
