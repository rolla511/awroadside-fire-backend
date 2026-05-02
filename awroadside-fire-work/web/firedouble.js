/*
 * firedouble.js
 *
 * Base runtime: web/app.js
 * Mobile baseline compared against: /Users/user/awroadside-fire HEAD:App.js
 *
 * Shared product concepts between the two app variants:
 * - home, provider, admin, and security states
 * - auth/session handling
 * - customer request submission
 * - subscriber/provider signup flows
 * - compatibility handshake and backend bootstrap
 *
 * Runtime incompatibilities that prevent a direct swap:
 * - this file uses DOM APIs such as document/window/FormData
 * - the mobile file uses React Native components and state hooks
 * - PayPal browser SDK flow is web-only
 * - screen rendering is hash/DOM driven here, component/state driven on mobile
 *
 * This merged file intentionally preserves the current web controller and
 * exposes a compatibility snapshot for inspection without modifying the
 * original web/app.js or the mobile App.js source.
 */

const fireDoubleCompatibility = Object.freeze({
  baseRuntime: "web",
  comparedMobileSource: "/Users/user/awroadside-fire HEAD:App.js",
  sharedFlows: [
    "bootstrap",
    "signin",
    "subscriber-signup",
    "provider-signup",
    "provider-work",
    "admin-dashboard",
    "compatibility-handshake"
  ],
  incompatibleRuntimeApis: [
    "document",
    "window",
    "FormData",
    "paypal-browser-sdk",
    "react-native-components",
    "react-hooks"
  ],
  directSwapSafe: false,
  note: "Use this file to inspect overlap while preserving the current browser implementation."
});

if (typeof window !== "undefined") {
  window.AWRoadsideFireDouble = fireDoubleCompatibility;
}

const storageKey = "adub-auth-session";
const processingLogKey = `${storageKey}-processing-log`;
const requestHistoryKey = `${storageKey}-request-history`;
const paymentLedgerKey = `${storageKey}-payment-ledger`;
const providerActionQueueKey = `${storageKey}-provider-action-queue`;
const runtimeConfig = readRuntimeConfig();

const state = {
  frontendConfig: null,
  paymentConfig: null,
  compatibilityManifest: null,
  compatibilityAcknowledgement: null,
  pendingRequest: null,
  paypalScriptPromise: null,
  processingLog: readStoredArray(processingLogKey),
  requestHistory: readStoredArray(requestHistoryKey),
  paymentLedger: readStoredArray(paymentLedgerKey),
  providerActionQueue: readStoredArray(providerActionQueueKey),
  providerQueue: [],
  servicePaymentQuote: null,
  serviceQuoteAccepted: false,
  auth: readStoredAuth(),
  admin: readStoredAdmin(),
  adminDashboard: null
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
  setupProviderWorkPanel();
  setupPaymentAgreement();
  setupAdminPanel();
  setupRequestForm();
  renderProcessingCenter();
  renderProviderActionQueue();
  await loadFrontendConfig();
  await acknowledgeRuntimeVariant();
  await hydrateStoredSession();
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
        await hydrateStoredSession();
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
        phoneNumber: normalizeField(formData.get("phoneNumber")),
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
      await hydrateStoredSession();
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
        phoneNumber: normalizeField(formData.get("phoneNumber")),
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
      await hydrateStoredSession();
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
      await hydrateStoredSession();
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
      recordRequestHistory({
        requestId,
        serviceType: state.pendingRequest.serviceType,
        location: state.pendingRequest.location,
        mode: state.auth?.userId ? "signed-in" : "guest",
        status: payload.status || "submitted"
      });
      showBox("submit-status", `Request submitted. Reference ${requestId}.`);
      if (state.paymentConfig?.enabled) {
        setText("paypal-status", "Optional skip-the-line priority upgrade is available. Service payment remains locked until backend hard ETA agreement.");
        togglePaypalContainer(true);
      } else {
        setText("paypal-status", "Request submitted. Optional priority upgrade is not configured. Service payment remains locked until backend hard ETA agreement.");
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
    const configPayload = runtimeConfig.frontendConfig || null;
    const [health, config, manifest] = await Promise.all([
      fetchBootstrapJson(dedupeUrls([
        runtimeConfig.bootstrapHealthUrl,
        `${window.location.origin}/api/aw-roadside/health`,
        `${window.location.origin}/api/health`
      ])),
      configPayload || fetchBootstrapJson(dedupeUrls([
        runtimeConfig.bootstrapFrontendConfigUrl,
        `${window.location.origin}/api/aw-roadside/frontend-config`,
        `${window.location.origin}/api/frontend-config`
      ])),
      fetchBootstrapJson(dedupeUrls([
        runtimeConfig.bootstrapManifestUrl,
        `${window.location.origin}/api/compat/manifest`
      ]))
    ]);
    state.frontendConfig = {
      ...config,
      apiBaseUrl: resolveApiBaseUrl(config?.apiBaseUrl || runtimeConfig.apiBaseUrl),
      rawApiBaseUrl: resolveRawApiBaseUrl(config?.rawApiBaseUrl || runtimeConfig.rawApiBaseUrl),
      uiBaseUrl: resolveUiBaseUrl(config?.uiBaseUrl || runtimeConfig.uiBaseUrl),
      adminApiBaseUrl: resolveAdminApiBaseUrl(config?.adminApiBaseUrl || runtimeConfig.adminApiBaseUrl)
    };
    state.compatibilityManifest = manifest?.manifest || null;

    setText("backend-status", health.status.toUpperCase());
    setText("backend-service", "Service is available");
    setText("api-port", "24/7");
    setText("api-url", "Dispatch online");
    setText("api-status", "Service is available.");
    setText("security-layer-name", "Ready");
    setText("priority-price", formatUsd(config.priorityServicePrice || 25));
    setText("subscriber-monthly-price", "$5.00/mo");
    setText("provider-monthly-price", "$5.99/mo");
    setVariantState(
      state.compatibilityManifest?.mode || "ready",
      state.compatibilityManifest
        ? `${state.compatibilityManifest.projectId} · ${state.compatibilityManifest.activeVariantId}`
        : "Manifest loaded"
    );
  } catch (error) {
    setText("backend-status", "OFF");
    setText("backend-service", "Service unavailable");
    setText("api-status", `Unable to reach dispatch: ${error.message}`);
    setVariantState("offline", "Manifest unavailable");
  }
}

async function acknowledgeRuntimeVariant() {
  try {
    const payload = await fetchBootstrapJson(dedupeUrls([
      runtimeConfig.bootstrapAcknowledgeUrl,
      `${window.location.origin}/api/compat/acknowledge`
    ]), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        projectId: "awroadside-family",
        variantId: "awroadside-web-runtime",
        platform: "web",
        appVersion: "runtime-local",
        mode: "active",
        note: "website-runtime-handshake"
      })
    });
    state.compatibilityAcknowledgement = payload?.variant || null;
    if (state.compatibilityAcknowledgement) {
      setVariantState(
        state.compatibilityAcknowledgement.mode,
        `${state.compatibilityAcknowledgement.variantId} · ${state.compatibilityAcknowledgement.projectId}`
      );
    }
  } catch (error) {
    setVariantState("unverified", error.message);
  }
}

async function loadPaymentConfig() {
  const paypalStatus = document.getElementById("paypal-status");
  if (!paypalStatus) {
    return;
  }

  try {
    const config = await fetchApiJsonWithFallback("/payments/config", [
      `${window.location.origin}/api/payments/config`
    ]);
    state.paymentConfig = config;

    if (!config.enabled || !config.clientId) {
      setText("paypal-status", "PayPal priority upgrade is not configured.");
      togglePaypalContainer(false);
      return;
    }

    setText("paypal-status", "Optional skip-the-line priority upgrade is available after request submission.");
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
        body: JSON.stringify({
          ...state.pendingRequest,
          paymentKind: "priority"
        })
      });

      const payload = await response.json();
      if (!response.ok || !payload.orderId) {
        throw new Error(payload.message || payload.error || "Unable to create PayPal order.");
      }

      recordPaymentEvent({
        event: "order-created",
        orderId: payload.orderId,
        requestId: state.pendingRequest.requestId || null,
        status: payload.status || "created"
      });
      setText("paypal-status", `Order ${payload.orderId} created. Complete payment in the popup window.`);
      return payload.orderId;
    },
    async onApprove(data) {
      const response = await apiFetch("/payments/capture-order", {
        method: "POST",
        headers: jsonHeaders(true),
        body: JSON.stringify({
          orderId: data.orderID,
          requestId: state.pendingRequest?.requestId || null
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Unable to capture PayPal order.");
      }

      recordPaymentEvent({
        event: "order-captured",
        orderId: data.orderID,
        requestId: state.pendingRequest.requestId || null,
        status: payload.status || "captured"
      });
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

function setupPaymentAgreement() {
  const quoteButton = document.getElementById("service-payment-quote-button");
  const agreeButton = document.getElementById("service-payment-agree-button");

  if (quoteButton) {
    quoteButton.addEventListener("click", async () => {
      await loadServicePaymentQuote();
    });
  }

  if (agreeButton) {
    agreeButton.addEventListener("click", () => {
      if (!state.servicePaymentQuote) {
        showBox("service-payment-status", "Backend service quote is required before agreement.");
        return;
      }
      state.serviceQuoteAccepted = true;
      recordPaymentEvent({
        event: "service-quote-accepted",
        requestId: state.servicePaymentQuote.requestId,
        status: "accepted",
        orderId: state.servicePaymentQuote.quoteId
      });
      showBox(
        "service-payment-status",
        `Agreed to backend quote ${state.servicePaymentQuote.amount.value} ${state.servicePaymentQuote.amount.currency_code}. Service checkout can proceed only through the backend.`
      );
    });
  }
}

async function loadServicePaymentQuote() {
  const requestId = state.pendingRequest?.requestId;
  if (!requestId) {
    showBox("service-payment-status", "Submit a request before checking service payment.");
    return;
  }

  try {
    const response = await apiFetch("/payments/service-quote", {
      method: "POST",
      headers: jsonHeaders(true),
      body: JSON.stringify({ requestId })
    });
    const payload = await response.json();
    if (!response.ok || !payload.quoteId) {
      throw new Error(payload.message || payload.error || "Backend quote was not available.");
    }
    state.servicePaymentQuote = payload;
    state.serviceQuoteAccepted = false;
    recordPaymentEvent({
      event: "service-quote-ready",
      requestId: payload.requestId,
      status: payload.status || "quoted",
      orderId: payload.quoteId
    });
    showBox(
      "service-payment-status",
      `Backend quote ready: ${payload.amount.value} ${payload.amount.currency_code}. Customer agreement is required before service payment.`
    );
  } catch (error) {
    state.servicePaymentQuote = null;
    state.serviceQuoteAccepted = false;
    recordPaymentEvent({
      event: "service-quote-blocked",
      requestId,
      status: "blocked",
      orderId: "hard-eta-required"
    });
    showBox("service-payment-status", error.message);
  }
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

async function hydrateStoredSession() {
  if (!state.auth?.sessionToken) {
    renderProfileState(null);
    return;
  }

  try {
    const profile = await fetchApiJsonWithFallback("/auth/profile", [], {
      headers: jsonHeaders(true)
    });

    state.auth = {
      ...state.auth,
      userId: profile.userId,
      roles: profile.roles || [],
      providerStatus: profile.providerStatus || null,
      subscriberActive: Boolean(profile.subscriberActive),
      profile
    };
    storeAuth(state.auth);
    renderProfileState(profile);
    renderIdentity();
  } catch (error) {
    state.auth = null;
    storeAuth(null);
    renderProfileState(null);
    renderIdentity();
    setText("identity-state", `Session expired: ${error.message}`);
  }
}

function setupAdminPanel() {
  const form = document.getElementById("admin-login-form");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const formData = new FormData(form);
        const response = await adminFetch("/login", {
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
  }

  const adminRefreshButton = document.getElementById("admin-refresh-button");
  if (adminRefreshButton) {
    adminRefreshButton.addEventListener("click", async () => {
      await loadAdminDashboard();
    });
  }

  document.querySelectorAll("#admin-subscriber-list, #admin-provider-list, #admin-service-history-list, #admin-financial-list")
    .forEach((container) => {
      container.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-admin-action]");
        if (!button) {
          return;
        }
        event.preventDefault();
        await handleAdminAction(button);
      });
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
    state.adminDashboard = null;
    renderAdminCollections();
    return;
  }

  try {
    const response = await adminFetch("/dashboard", {
      method: "GET",
      headers: adminAuthHeaders()
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Unable to load admin dashboard.");
    }

    state.adminDashboard = payload;
    setText("admin-email", payload.adminEmail || "Unknown");
    setText("admin-roles", (payload.roles || []).join(", ") || "None");
    setText("admin-request-count", String(payload.requestCount ?? 0));
    setText("admin-payment-configured", payload.paymentConfigured ? "Configured" : "Not Ready");
    setText("admin-active-subscribers", String(payload.stats?.activeSubscribers ?? 0));
    setText("admin-pending-providers", String(payload.stats?.pendingProviders ?? 0));
    setText("admin-overdue-subscribers", String(payload.stats?.overdueSubscriptions ?? 0));
    setText("admin-payouts-pending", String(payload.stats?.payoutsPending ?? 0));
    setText("admin-status-label", "Signed in");
    setText("admin-status-badge", payload.trustedZone || "Active");
    setText("admin-status-text", `Location zone: ${payload.locationZone || "not set"}.`);
    renderAdminCollections();
  } catch (error) {
    showBox("admin-login-status", error.message);
  }
}

async function handleAdminAction(button) {
  if (!state.admin?.token) {
    showBox("admin-action-status", "Admin login is required.");
    return;
  }

  const action = button.getAttribute("data-admin-action");
  const userId = button.getAttribute("data-user-id");
  const requestId = button.getAttribute("data-request-id");
  let path = "";
  let body = {};

  if (action === "set-account-state") {
    path = `/users/${encodeURIComponent(userId)}/account-state`;
    body = {
      accountState: button.getAttribute("data-account-state")
    };
  } else if (action === "approve-provider") {
    path = `/providers/${encodeURIComponent(userId)}/approve`;
    body = {
      note: "Approved from admin dashboard"
    };
  } else if (action === "reset-request") {
    path = `/requests/${encodeURIComponent(requestId)}/reset`;
    body = {
      reason: window.prompt("Reset reason", "Manual admin reset") || "Manual admin reset"
    };
  } else if (action === "refund-request") {
    path = `/requests/${encodeURIComponent(requestId)}/refund`;
    body = {
      reason: window.prompt("Refund reason", "Manual admin refund") || "Manual admin refund"
    };
  } else if (action === "complete-payout") {
    path = `/payouts/${encodeURIComponent(requestId)}/complete`;
    body = {
      reference: window.prompt("Payout reference", "manual-payout") || "manual-payout"
    };
  } else {
    return;
  }

  try {
    const response = await adminFetch(path, {
      method: "POST",
      headers: adminAuthHeaders(),
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Admin action failed.");
    }
    showBox("admin-action-status", payload.message || "Admin action completed.");
    await loadAdminDashboard();
  } catch (error) {
    showBox("admin-action-status", error.message);
  }
}

function renderAdminCollections() {
  renderAdminList(
    "admin-subscriber-list",
    Array.isArray(state.adminDashboard?.subscribers) ? state.adminDashboard.subscribers : [],
    renderSubscriberAdminItem,
    "Admin subscriber data will appear after login."
  );
  renderAdminList(
    "admin-provider-list",
    Array.isArray(state.adminDashboard?.providers) ? state.adminDashboard.providers : [],
    renderProviderAdminItem,
    "Provider approvals will appear after login."
  );
  renderAdminList(
    "admin-service-history-list",
    Array.isArray(state.adminDashboard?.serviceHistory) ? state.adminDashboard.serviceHistory : [],
    renderServiceHistoryItem,
    "Service history will appear after login."
  );
  renderAdminList(
    "admin-financial-list",
    Array.isArray(state.adminDashboard?.financials) ? state.adminDashboard.financials : [],
    renderFinancialAdminItem,
    "Financial records will appear after login."
  );
}

function renderAdminList(id, items, renderer, emptyMessage) {
  const container = document.getElementById(id);
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = `<div class="admin-empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  container.innerHTML = items.map(renderer).join("");
}

function renderSubscriberAdminItem(subscriber) {
  const vehicleSummary = Array.isArray(subscriber.savedVehicles) && subscriber.savedVehicles.length
    ? subscriber.savedVehicles.map(formatVehicleSummary).join(" · ")
    : "No saved vehicles";
  const nextAccountState = subscriber.accountState === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
  const actionLabel = nextAccountState === "SUSPENDED" ? "Suspend User" : "Reactivate User";

  return `
    <article class="admin-item">
      <div class="admin-item-head">
        <div>
          <strong>${escapeHtml(subscriber.fullName || subscriber.email)}</strong>
          <small>${escapeHtml(subscriber.email || "No email")} · ${escapeHtml(subscriber.phoneNumber || "No phone")}</small>
        </div>
        <span class="badge">${escapeHtml(subscriber.subscriptionStatus || "UNKNOWN")}</span>
      </div>
      <div class="admin-item-meta">
        <span>Billing: ${escapeHtml(formatTimestamp(subscriber.nextBillingDate))}</span>
        <span>Signed up: ${escapeHtml(formatTimestamp(subscriber.signUpDate))}</span>
        <span>State: ${escapeHtml(subscriber.accountState || "ACTIVE")}</span>
      </div>
      <p class="muted">${escapeHtml(vehicleSummary)}</p>
      <div class="button-pair">
        <button class="glow-button alt compact" type="button" data-admin-action="set-account-state" data-user-id="${escapeHtml(subscriber.id)}" data-account-state="${escapeHtml(nextAccountState)}">${escapeHtml(actionLabel)}</button>
      </div>
    </article>
  `;
}

function renderProviderAdminItem(provider) {
  const approveButton = provider.providerStatus === "PENDING_APPROVAL"
    ? `<button class="glow-button compact" type="button" data-admin-action="approve-provider" data-user-id="${escapeHtml(provider.id)}">Approve Provider</button>`
    : "";

  return `
    <article class="admin-item">
      <div class="admin-item-head">
        <div>
          <strong>${escapeHtml(provider.fullName || provider.email)}</strong>
          <small>${escapeHtml(provider.email || "No email")} · ${escapeHtml(provider.phoneNumber || "No phone")}</small>
        </div>
        <span class="badge">${escapeHtml(provider.providerStatus || "DRAFT")}</span>
      </div>
      <div class="admin-item-meta">
        <span>State: ${escapeHtml(provider.accountState || "ACTIVE")}</span>
        <span>Services: ${escapeHtml((provider.services || []).join(", ") || "Not set")}</span>
      </div>
      <div class="button-pair">${approveButton}</div>
    </article>
  `;
}

function renderServiceHistoryItem(entry) {
  return `
    <article class="admin-item">
      <div class="admin-item-head">
        <div>
          <strong>${escapeHtml(entry.requestId || "Unknown request")}</strong>
          <small>${escapeHtml(entry.fullName || "Customer")} · ${escapeHtml(entry.phoneNumber || "No phone")}</small>
        </div>
        <span class="badge">${escapeHtml(entry.completionStatus || "OPEN")}</span>
      </div>
      <div class="admin-item-meta">
        <span>${escapeHtml(entry.serviceType || "Service")}</span>
        <span>${escapeHtml(entry.customerType || "UNKNOWN")}</span>
        <span>${escapeHtml(entry.providerAssigned || "Unassigned")}</span>
        <span>${escapeHtml(entry.paymentStatus || "UNKNOWN")}</span>
      </div>
      <p class="muted">Refund flag: ${entry.refundFlag ? "Yes" : "No"} · Dispute flag: ${entry.disputeFlag ? "Yes" : "No"} · Requested: ${escapeHtml(formatTimestamp(entry.requestDate))}</p>
      <div class="button-pair">
        <button class="glow-button alt compact" type="button" data-admin-action="reset-request" data-request-id="${escapeHtml(entry.requestId)}">Reset Request</button>
      </div>
    </article>
  `;
}

function renderFinancialAdminItem(entry) {
  return `
    <article class="admin-item">
      <div class="admin-item-head">
        <div>
          <strong>${escapeHtml(entry.requestId || "Unknown request")}</strong>
          <small>${escapeHtml(entry.fullName || "Customer")} · ${escapeHtml(entry.providerAssigned || "Unassigned")}</small>
        </div>
        <span class="badge">${escapeHtml(entry.providerPayoutStatus || "UNASSIGNED")}</span>
      </div>
      <div class="admin-item-meta">
        <span>Charged: ${escapeHtml(formatUsd(entry.amountCharged || 0))}</span>
        <span>Collected: ${escapeHtml(formatUsd(entry.amountCollected || 0))}</span>
        <span>Payment: ${escapeHtml(entry.paymentStatus || "UNKNOWN")}</span>
      </div>
      <p class="muted">Refund issued: ${entry.refundIssued ? "Yes" : "No"} · Refund flag: ${entry.refundFlag ? "Yes" : "No"} · Dispute flag: ${entry.disputeFlag ? "Yes" : "No"}</p>
      <div class="button-pair">
        <button class="glow-button danger compact" type="button" data-admin-action="refund-request" data-request-id="${escapeHtml(entry.requestId)}">Refund User</button>
        <button class="glow-button compact" type="button" data-admin-action="complete-payout" data-request-id="${escapeHtml(entry.requestId)}">Mark Payout Complete</button>
      </div>
    </article>
  `;
}

function adminAuthHeaders() {
  const headers = {
    Authorization: `Bearer ${state.admin.token}`,
    "Content-Type": "application/json"
  };
  if (state.admin.locationZone) {
    headers["x-location-zone"] = state.admin.locationZone;
  }
  if (state.admin.twoFactorVerified) {
    headers["x-2fa-verified"] = "true";
  }
  return headers;
}

function setupProviderWorkPanel() {
  const refreshButton = document.getElementById("provider-queue-refresh");
  if (refreshButton) {
    refreshButton.addEventListener("click", async () => {
      await loadProviderQueue();
    });
  }

  const workList = document.getElementById("provider-work-list");
  if (workList) {
    workList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-provider-action]");
      if (!button) {
        return;
      }
      event.preventDefault();
      const requestId = button.getAttribute("data-request-id");
      const action = button.getAttribute("data-provider-action");
      if (!requestId || !action) {
        return;
      }
      queueProviderAction(requestId, action).catch((error) => {
        showBox("provider-work-status", error.message);
      });
    });
  }

  renderProviderWorkList();
}

async function loadProviderQueue() {
  if (!state.auth?.sessionToken) {
    showBox("provider-work-status", "Sign in as a provider before loading the work queue.");
    recordProcessingEvent({
      action: "provider-queue",
      route: "/requests",
      status: "blocked",
      message: "Provider queue requires a session token."
    });
    return;
  }

  try {
    const payload = await fetchApiJsonWithFallback("/requests", [], {
      headers: jsonHeaders(true)
    });
    state.providerQueue = Array.isArray(payload.requests) ? payload.requests : [];
    recordProcessingEvent({
      action: "provider-queue",
      route: "/requests",
      status: "accepted",
      message: `${state.providerQueue.length} request(s) loaded.`
    });
    showBox("provider-work-status", `Loaded ${state.providerQueue.length} request(s).`);
    renderProviderWorkList();
  } catch (error) {
    showBox("provider-work-status", error.message);
    recordProcessingEvent({
      action: "provider-queue",
      route: "/requests",
      status: "error",
      message: error.message
    });
  }
}

function renderProviderWorkList() {
  const container = document.getElementById("provider-work-list");
  if (!container) {
    return;
  }

  if (!state.providerQueue.length) {
    container.innerHTML = '<div class="item"><div class="value">No provider queue loaded.</div><div class="muted">Sign in as a provider, then load the queue.</div></div>';
    return;
  }

  container.innerHTML = state.providerQueue
    .map((request) => {
      const requestId = request.requestId || request.id || "unknown";
      return `<div class="provider-work-card">
        <div>
          <div class="value">${escapeHtml(request.serviceType || "Service")} · ${escapeHtml(request.fullName || "Customer")}</div>
          <div class="muted">${escapeHtml(request.location || "Location not provided")}</div>
          <div class="muted">Status: ${escapeHtml(request.status || "UNKNOWN")} · Reference ${escapeHtml(requestId)}</div>
        </div>
        <div class="provider-action-grid">
          ${renderProviderActionButton(requestId, "accept", "Accept")}
          ${renderProviderActionButton(requestId, "eta", "ETA")}
          ${renderProviderActionButton(requestId, "soft-contact", "Soft Contact")}
          ${renderProviderActionButton(requestId, "hard-contact", "Hard Contact")}
          ${renderProviderActionButton(requestId, "arrived", "Arrived")}
          ${renderProviderActionButton(requestId, "completed", "Completed")}
        </div>
      </div>`;
    })
    .join("");
}

function renderProviderActionButton(requestId, action, label) {
  return `<button class="glow-button compact" type="button" data-provider-action="${escapeHtml(action)}" data-request-id="${escapeHtml(requestId)}">${escapeHtml(label)}</button>`;
}

async function queueProviderAction(requestId, action) {
  const entry = {
    id: buildEventId("provider"),
    requestId,
    action,
    status: "queued-frontend",
    timestamp: new Date().toISOString(),
    route: `/api/aw-roadside/requests/${requestId}/${action}`
  };
  state.providerActionQueue = [entry, ...state.providerActionQueue].slice(0, 50);
  storeJson(providerActionQueueKey, state.providerActionQueue);
  recordProcessingEvent({
    action: `provider-${action}`,
    route: entry.route,
    status: "queued-frontend",
    requestId,
    message: "Provider action sent through the backend controller."
  });
  renderProviderActionQueue();
  showBox("provider-work-status", `${labelProviderAction(action)} queued for ${requestId}.`);

  if (!state.auth?.sessionToken) {
    entry.status = "blocked-no-session";
    storeJson(providerActionQueueKey, state.providerActionQueue);
    renderProviderActionQueue();
    return;
  }

  try {
    const response = await apiFetch(`/requests/${encodeURIComponent(requestId)}/${action}`, {
      method: "POST",
      headers: jsonHeaders(true),
      body: JSON.stringify({
        note: `frontend provider action: ${action}`
      })
    });
    const payload = await response.json();
    entry.status = payload.committed === false ? "backend-pending" : "backend-committed";
    entry.committed = payload.committed !== false;
    entry.backendStatus = payload.status || null;
    entry.updatedAt = new Date().toISOString();
    storeJson(providerActionQueueKey, state.providerActionQueue);
    renderProviderActionQueue();
    showBox(
      "provider-work-status",
      payload.committed === false
        ? `${labelProviderAction(action)} accepted by backend as pending for ${requestId}.`
        : `${labelProviderAction(action)} committed by backend for ${requestId}.`
    );
    await loadProviderQueue();
  } catch (error) {
    entry.status = "backend-error";
    entry.error = error.message;
    entry.updatedAt = new Date().toISOString();
    storeJson(providerActionQueueKey, state.providerActionQueue);
    recordProcessingEvent({
      action: `provider-${action}`,
      route: entry.route,
      status: "backend-error",
      requestId,
      message: error.message
    });
    renderProviderActionQueue();
    showBox("provider-work-status", error.message);
  }
}

function labelProviderAction(action) {
  return action
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function recordRequestHistory(entry) {
  const next = {
    id: buildEventId("request"),
    timestamp: new Date().toISOString(),
    ...entry
  };
  state.requestHistory = [next, ...state.requestHistory].slice(0, 30);
  storeJson(requestHistoryKey, state.requestHistory);
  renderProcessingCenter();
}

function recordPaymentEvent(entry) {
  const next = {
    id: buildEventId("payment"),
    timestamp: new Date().toISOString(),
    ...entry
  };
  state.paymentLedger = [next, ...state.paymentLedger].slice(0, 30);
  storeJson(paymentLedgerKey, state.paymentLedger);
  renderProcessingCenter();
}

function recordProcessingEvent(entry) {
  const next = {
    id: buildEventId("route"),
    timestamp: new Date().toISOString(),
    method: "GET",
    ...sanitizeLogEntry(entry)
  };
  state.processingLog = [next, ...state.processingLog].slice(0, 60);
  storeJson(processingLogKey, state.processingLog);
  renderProcessingCenter();
  return next;
}

function renderProcessingCenter() {
  setText("processing-count", String(state.processingLog.length));
  renderList("processing-log-list", state.processingLog, (entry) => {
    const status = entry.httpStatus ? `${entry.status} ${entry.httpStatus}` : entry.status;
    return `<div class="item">
      <div class="value">${escapeHtml(entry.action || entry.method || "route")} · ${escapeHtml(status || "pending")}</div>
      <div class="muted">${escapeHtml(entry.route || "local")} · ${formatTimestamp(entry.timestamp)}</div>
      ${entry.message ? `<div class="muted">${escapeHtml(entry.message)}</div>` : ""}
    </div>`;
  }, "No route events stored yet.");

  renderList("request-history-list", state.requestHistory, (entry) => `<div class="item">
    <div class="value">${escapeHtml(entry.requestId || "pending")} · ${escapeHtml(entry.serviceType || "service")}</div>
    <div class="muted">${escapeHtml(entry.status || "submitted")} · ${escapeHtml(entry.mode || "guest")} · ${formatTimestamp(entry.timestamp)}</div>
  </div>`, "No request history stored yet.");

  renderList("payment-ledger-list", state.paymentLedger, (entry) => `<div class="item">
    <div class="value">${escapeHtml(entry.event || "payment")} · ${escapeHtml(entry.status || "pending")}</div>
    <div class="muted">Order ${escapeHtml(entry.orderId || "not assigned")} · Request ${escapeHtml(entry.requestId || "pending")} · ${formatTimestamp(entry.timestamp)}</div>
  </div>`, "No payment events stored yet.");
}

function renderProviderActionQueue() {
  renderList("provider-action-queue-list", state.providerActionQueue, (entry) => `<div class="item">
    <div class="value">${escapeHtml(labelProviderAction(entry.action || "action"))} · ${escapeHtml(entry.status || "queued")}</div>
    <div class="muted">Request ${escapeHtml(entry.requestId || "unknown")} · ${formatTimestamp(entry.updatedAt || entry.timestamp)}</div>
    ${entry.backendStatus ? `<div class="muted">Backend status: ${escapeHtml(entry.backendStatus)}</div>` : ""}
    ${entry.error ? `<div class="muted">${escapeHtml(entry.error)}</div>` : ""}
  </div>`, "No provider actions queued yet.");
}

function renderList(id, entries, renderEntry, emptyMessage) {
  const container = document.getElementById(id);
  if (!container) {
    return;
  }
  container.innerHTML = entries.length
    ? entries.map(renderEntry).join("")
    : `<div class="item"><div class="muted">${escapeHtml(emptyMessage)}</div></div>`;
}

async function loadSecurityStatus() {
  try {
    const payload = await fetchApiJsonWithFallback("/security/status");

    setText("security-layer-state", payload.watchdog?.integrityOk ? "READY" : "CHECK");
    setText("security-layer-detail", payload.watchdog?.integrityOk ? "System ready" : "System needs review");
    setText("security-layer-name", "Ready");
    setText("watchdog-integrity", payload.watchdog?.integrityOk ? "READY" : "CHECK");
    setText("watchdog-summary", payload.watchdog?.integrityOk ? "System looks ready." : "System needs review.");
    setText("watchdog-scanned-at", formatTimestamp(payload.watchdog?.scannedAt));
    renderWatchdogFiles(payload.watchdog?.suspiciousFiles || []);
  } catch (error) {
    setText("security-layer-state", "OFF");
    setText("security-layer-detail", "Protected watchdog unavailable");
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
  const profile = auth?.profile || null;
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
  setText(
    "customer-identity-state",
    auth?.roles?.includes("SUBSCRIBER") && profile?.subscriberProfile?.vehicle
      ? `${detail} · ${formatVehicleSummary(profile.subscriberProfile.vehicle)}`
      : detail
  );
  setText("provider-identity-role", roleText);
  setText("provider-identity-state", detail);
  setText("provider-admin-status", auth?.providerStatus ? `Provider status: ${auth.providerStatus}.` : "Provider status will appear after sign-in.");
  setText("provider-service-list", formatProviderServices(profile));
  setText("provider-vehicle-summary", formatProviderVehicle(profile));
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
  document.querySelectorAll("[data-nav]").forEach((element) => {
    element.addEventListener("click", (event) => {
      const screen = element.getAttribute("data-nav");
      if (!screen) {
        return;
      }
      event.preventDefault();
      switchScreen(screen);
    });
  });

  window.addEventListener("hashchange", () => {
    switchScreen(readScreenFromHash());
  });
  switchScreen(readScreenFromHash());
}

function readScreenFromHash() {
  const pathname = window.location.pathname.toLowerCase();
  if (pathname.endsWith("/customer.html")) {
    return "customer";
  }
  if (pathname.endsWith("/provider.html")) {
    return "provider";
  }
  if (pathname.endsWith("/admin.html")) {
    return "admin";
  }
  if (pathname.endsWith("/legacy-index.html")) {
    return "home";
  }

  const value = window.location.hash.replace(/^#/, "").trim().toLowerCase();
  if (["home", "customer", "provider", "admin", "security"].includes(value)) {
    return value;
  }
  return "home";
}

function switchScreen(screen) {
  document.querySelectorAll("[data-screen]").forEach((element) => {
    const isActive = element.getAttribute("data-screen") === screen;
    element.hidden = !isActive;
    element.classList.toggle("active-screen", isActive);
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

function readStoredArray(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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

function storeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures in restricted browsers.
  }
}

function apiBaseUrl() {
  return resolveApiBaseUrl(state.frontendConfig?.apiBaseUrl);
}

function adminApiBaseUrl() {
  return resolveAdminApiBaseUrl(state.frontendConfig?.adminApiBaseUrl || runtimeConfig.adminApiBaseUrl);
}

async function apiFetch(path, options = {}) {
  const method = options.method || "GET";
  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, options);
    recordProcessingEvent({
      action: "backend-route",
      route: path,
      method,
      status: response.ok ? "accepted" : "rejected",
      httpStatus: response.status
    });
    return response;
  } catch (error) {
    recordProcessingEvent({
      action: "backend-route",
      route: path,
      method,
      status: "network-error",
      message: error.message
    });
    throw error;
  }
}

async function adminFetch(path, options = {}) {
  return fetch(`${adminApiBaseUrl()}${path}`, options);
}

async function fetchApiJsonWithFallback(primaryPath, fallbackUrls = [], options = {}) {
  const urls = [`${apiBaseUrl()}${primaryPath}`];
  const rawBase = state.frontendConfig?.rawApiBaseUrl;

  if (rawBase) {
    urls.push(`${rawBase}${primaryPath}`);
  }

  for (const url of fallbackUrls) {
    urls.push(url);
  }

  return fetchJsonFromCandidates(urls, options);
}

async function fetchBootstrapJson(urls, options = {}) {
  return fetchJsonFromCandidates(urls, options);
}

async function fetchJsonFromCandidates(urls, options = {}) {
  let lastError = null;
  const method = options.method || "GET";

  for (const url of dedupeUrls(urls)) {
    try {
      const response = await fetch(url, options);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || `Request failed with ${response.status}.`);
      }
      recordProcessingEvent({
        action: "backend-route",
        route: url,
        method,
        status: "accepted",
        httpStatus: response.status
      });
      return payload;
    } catch (error) {
      lastError = error;
      recordProcessingEvent({
        action: "backend-route",
        route: url,
        method,
        status: "rejected",
        message: error.message
      });
    }
  }

  throw lastError || new Error("No API endpoint responded.");
}

function dedupeUrls(urls) {
  return urls.filter((value, index) => value && urls.indexOf(value) === index);
}

function renderProfileState(profile) {
  setText("provider-service-list", formatProviderServices(profile));
  setText("provider-vehicle-summary", formatProviderVehicle(profile));
}

function formatProviderServices(profile) {
  const services = Array.isArray(profile?.services) ? profile.services.filter(Boolean) : [];
  return services.length ? `Services: ${services.join(", ")}` : "Services: not loaded.";
}

function formatProviderVehicle(profile) {
  const vehicle = profile?.providerProfile?.vehicleInfo || profile?.subscriberProfile?.vehicle || null;
  return vehicle ? `Vehicle profile: ${formatVehicleSummary(vehicle)}` : "Vehicle profile: not loaded.";
}

function formatVehicleSummary(vehicle) {
  const parts = [vehicle.year, vehicle.make, vehicle.model, vehicle.color]
    .map((value) => normalizeField(value))
    .filter(Boolean);
  return parts.length ? parts.join(" ") : "Vehicle not available";
}

function resolveApiBaseUrl(value) {
  const fallback = normalizeUrlValue(runtimeConfig.apiBaseUrl) || `${window.location.origin}/api/aw-roadside`;
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
  const fallback = normalizeUrlValue(runtimeConfig.rawApiBaseUrl) || `${window.location.origin}/api`;
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

function resolveAdminApiBaseUrl(value) {
  const fallback = normalizeUrlValue(runtimeConfig.adminApiBaseUrl) || `${window.location.origin}/api/admin`;
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

function readRuntimeConfig() {
  const config = window.AWRoadsideConfig || window.awRoadsideConfig || {};
  return {
    apiBaseUrl: normalizeUrlValue(config.apiBaseUrl),
    rawApiBaseUrl: normalizeUrlValue(config.rawApiBaseUrl),
    adminApiBaseUrl: normalizeUrlValue(config.adminApiBaseUrl),
    uiBaseUrl: normalizeUrlValue(config.uiBaseUrl),
    bootstrapHealthUrl: normalizeUrlValue(config.bootstrapHealthUrl),
    bootstrapFrontendConfigUrl: normalizeUrlValue(config.bootstrapFrontendConfigUrl),
    bootstrapManifestUrl: normalizeUrlValue(config.bootstrapManifestUrl),
    bootstrapAcknowledgeUrl: normalizeUrlValue(config.bootstrapAcknowledgeUrl),
    frontendConfig: config.frontendConfig && typeof config.frontendConfig === "object" ? config.frontendConfig : null
  };
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

function sanitizeLogEntry(entry) {
  const blockedKeys = new Set(["password", "token", "sessionToken", "Authorization", "authorization"]);
  return Object.fromEntries(
    Object.entries(entry || {}).filter(([key]) => !blockedKeys.has(key))
  );
}

function buildEventId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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

function setVariantState(mode, detail) {
  setText("variant-mode", String(mode || "unknown").toUpperCase());
  setText("variant-detail", detail || "Variant state unavailable.");
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
