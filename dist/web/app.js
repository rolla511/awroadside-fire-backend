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
  providerWallet: null,
  servicePaymentQuote: null,
  serviceQuoteAccepted: false,
  auth: readStoredAuth(),
  admin: readStoredAdmin(),
  adminDashboard: null,
  adminSearchResults: [],
  adminSearchRole: "ALL",
  adminSearchQuery: "",
  adminSelectedUserProfile: null
};

document.addEventListener("DOMContentLoaded", () => {
  initializeApp().catch((error) => {
    setText("api-status", `Dispatch connection is not ready yet: ${formatUserFacingMessage(error.message)}`);
  });
});

async function initializeApp() {
  try {
    applyPreviewVisibility();
    renderPublicPricing();
    setupNavigation();
    renderIdentity();
    renderAdminState();
    setupHomeAuth();
    setupSubscriberModal();
    setupProviderSignup();
    setupProviderSignin();
    setupProviderDocumentsPanel();
    setupProviderWorkPanel();
    setupProviderWalletPanel();
    setupPaymentAgreement();
    setupRequestFeedbackPanel();
    setupAdminPanel();
    setupRequestForm();
    renderProcessingCenter();
    renderCustomerRequestState();
    renderProviderActionQueue();
    renderProviderWallet();
    await loadFrontendConfig();
    await acknowledgeRuntimeVariant();
    await hydrateStoredSession();
    await loadPaymentConfig();
    await loadSecurityStatus();
    await loadAdminDashboard();
  } catch (error) {
    console.error("[PANIC] Initialization failure:", error);
    // Panic Recovery: Ensure Home screen is visible even if data fails to load
    switchScreen("home");
  }
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
        navigateToScreen("customer");
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
      validatePasswordConfirmation(formData.get("password"), formData.get("confirmPassword"));
      const signup = await createAccount({
        fullName: normalizeField(formData.get("fullName")),
        phoneNumber: normalizeField(formData.get("phoneNumber")),
        username: normalizeField(formData.get("username")),
        email: normalizeField(formData.get("email")),
        password: normalizeField(formData.get("password")),
        role: "SUBSCRIBER",
        subscriberTermsAccepted: formData.get("subscriberTermsAccepted") === "on",
        dispatchOnlyLiabilityAccepted: formData.get("dispatchOnlyLiabilityAccepted") === "on",
        noRefundPolicyAccepted: formData.get("noRefundPolicyAccepted") === "on"
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
          paymentMethodMasked: buildSubscriberPaymentValue(formData),
          subscriberTermsAccepted: formData.get("subscriberTermsAccepted") === "on",
          dispatchOnlyLiabilityAccepted: formData.get("dispatchOnlyLiabilityAccepted") === "on",
          noRefundPolicyAccepted: formData.get("noRefundPolicyAccepted") === "on"
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
      navigateToScreen("customer");
      showBox(statusId, `Membership activated. Confirmation details were prepared for ${normalizeField(formData.get("email")) || "the email on file"}.`);
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
      validatePasswordConfirmation(formData.get("password"), formData.get("confirmPassword"));
      const signup = await createAccount({
        fullName: normalizeField(formData.get("fullName")),
        phoneNumber: normalizeField(formData.get("phoneNumber")),
        username: normalizeField(formData.get("username")),
        email: normalizeField(formData.get("email")),
        password: normalizeField(formData.get("password")),
        role: "PROVIDER",
        providerTermsAccepted: formData.get("providerTermsAccepted") === "on",
        providerLiabilityAccepted: formData.get("providerLiabilityAccepted") === "on",
        providerHoldHarmlessAccepted: formData.get("providerHoldHarmlessAccepted") === "on"
      });
      const selectedServices = collectCheckedValues(form, "services");
      if (selectedServices.length === 0) {
        throw new Error("Select at least one provider service.");
      }

      const response = await apiFetch("/auth/provider/apply", {
        method: "POST",
        headers: jsonHeaders(signup.sessionToken),
        body: JSON.stringify({
          providerInfo: {
            legalName: normalizeField(formData.get("legalName")) || normalizeField(formData.get("fullName")),
            phoneNumber: normalizeField(formData.get("phoneNumber")),
            email: normalizeField(formData.get("email")),
            companyName: normalizeField(formData.get("companyName")),
            w9Name: normalizeField(formData.get("w9Name")),
            taxIdLast4: normalizeField(formData.get("taxIdLast4"))
          },
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
          services: selectedServices,
          serviceArea: normalizeField(formData.get("serviceArea")),
          currentLocation: normalizeField(formData.get("currentLocation")),
          hoursOfService: buildProviderHoursOfService(formData),
          assessmentAnswers: buildProviderAssessmentAnswers(formData),
          providerTermsAccepted: formData.get("providerTermsAccepted") === "on",
          providerLiabilityAccepted: formData.get("providerLiabilityAccepted") === "on",
          providerHoldHarmlessAccepted: formData.get("providerHoldHarmlessAccepted") === "on"
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
      navigateToScreen("provider-info");
      showBox("provider-signup-status", "Provider account created. Profile review is now in progress.");
      hideModal("provider-signup-modal");
    } catch (error) {
      showBox("provider-signup-status", error.message);
    }
  });
}

function validatePasswordConfirmation(password, confirmation) {
  const normalizedPassword = normalizeField(password);
  const normalizedConfirmation = normalizeField(confirmation);
  if (!normalizedPassword || normalizedPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  if (normalizedPassword !== normalizedConfirmation) {
    throw new Error("Password confirmation does not match.");
  }
}

function buildProviderHoursOfService(formData) {
  return {
    timezone: normalizeField(formData.get("serviceTimezone")) || "America/New_York",
    monday: normalizeField(formData.get("weekdayHours")),
    tuesday: normalizeField(formData.get("weekdayHours")),
    wednesday: normalizeField(formData.get("weekdayHours")),
    thursday: normalizeField(formData.get("weekdayHours")),
    friday: normalizeField(formData.get("weekdayHours")),
    saturday: normalizeField(formData.get("weekendHours")),
    sunday: normalizeField(formData.get("weekendHours"))
  };
}

function buildProviderAssessmentAnswers(formData) {
  return {
    jumpstartProcedure: normalizeField(formData.get("jumpstartProcedure")),
    jackPlacement: normalizeField(formData.get("jackPlacement")),
    specialtyVehicleJack: normalizeField(formData.get("specialtyVehicleJack")),
    spoolDefinition: normalizeField(formData.get("spoolDefinition")),
    frozenLugNut: normalizeField(formData.get("frozenLugNut")),
    lockoutTools: normalizeField(formData.get("lockoutTools")),
    lockoutDamagePrevention: normalizeField(formData.get("lockoutDamagePrevention")),
    incorrectLockoutDamage: normalizeField(formData.get("incorrectLockoutDamage")),
    tirePlugKnowledge: normalizeField(formData.get("tirePlugKnowledge")),
    severeDamageDecision: normalizeField(formData.get("severeDamageDecision"))
  };
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
      navigateToScreen("provider-info");
      showBox("provider-signin-status", "Provider signed in.");
    } catch (error) {
      showBox("provider-signin-status", error.message);
    }
  });
}

function setupProviderDocumentsPanel() {
  const form = document.getElementById("provider-documents-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.auth?.sessionToken) {
      showBox("provider-documents-status", "Sign in as a provider before uploading documents.");
      return;
    }

    try {
      const formData = new FormData(form);
      const response = await apiFetch("/auth/provider/documents", {
        method: "POST",
        headers: jsonHeaders(true),
        body: JSON.stringify({
          documents: {
            license: buildProviderDocumentPayload(formData.get("license"), "license.txt"),
            insurance: buildProviderDocumentPayload(formData.get("insurance"), "insurance.txt"),
            registration: buildProviderDocumentPayload(formData.get("registration"), "registration.txt"),
            helperId: buildProviderDocumentPayload(formData.get("helperId"), "helper-id.txt")
          }
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.userId) {
        throw new Error(payload.message || payload.error || "Unable to upload provider documents.");
      }

      await hydrateStoredSession();
      showBox("provider-documents-status", "Provider documents were saved for verification review.");
    } catch (error) {
      showBox("provider-documents-status", error.message);
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
        fullName: state.pendingRequest.fullName,
        phoneNumber: state.pendingRequest.phoneNumber,
        mode: state.auth?.userId ? "signed-in" : "guest",
        status: payload.status || "submitted"
      });
      showBox("submit-status", `Request submitted. Reference ${requestId}.`);
      if (state.paymentConfig?.enabled) {
        setText("paypal-status", "Optional skip-the-line priority service is available. Service payment unlocks after the arrival estimate is confirmed.");
        togglePaypalContainer(true);
      } else {
        setText("paypal-status", "Request submitted. Optional priority service is not configured yet. Service payment unlocks after the arrival estimate is confirmed.");
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
    applyPreviewVisibility();
    renderPublicPricing(config);

    setText("backend-status", health.status.toUpperCase());
    setText("backend-service", "Service is available");
    setText("api-port", "24/7");
    setText("api-url", "Dispatch online");
    setText("api-status", "Service is available.");
    setText("security-layer-name", "Ready");
    setVariantState(
      state.compatibilityManifest?.mode || "ready",
      state.compatibilityManifest
        ? `${state.compatibilityManifest.projectId} · ${state.compatibilityManifest.activeVariantId}`
        : "Manifest loaded"
    );
  } catch (error) {
    applyPreviewVisibility();
    renderPublicPricing();
    setText("backend-status", "OFF");
    setText("backend-service", "Dispatch offline");
    setText("api-status", `Unable to reach dispatch right now: ${formatUserFacingMessage(error.message)}`);
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
      setText("paypal-status", "Optional priority payment is not configured.");
      togglePaypalContainer(false);
      return;
    }

    setText("paypal-status", "Optional priority payment is available after request submission.");
    renderPublicPricing(config);
    await ensurePaypalSdk(config.clientId, config.currency || "USD");
    renderPaypalButtons();
  } catch (error) {
    setText("paypal-status", `Payment availability is being refreshed: ${formatUserFacingMessage(error.message)}`);
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

      if (payload.request) {
        state.pendingRequest = { ...state.pendingRequest, ...payload.request };
        rememberRequest({
          requestId: payload.request.requestId || payload.request.id || state.pendingRequest?.requestId || null,
          serviceType: payload.request.serviceType || state.pendingRequest?.serviceType || "",
          status: payload.request.status || state.pendingRequest?.status || "SUBMITTED",
          mode: state.auth?.subscriberActive ? "subscriber" : "guest"
        });
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
        showBox("service-payment-status", "The current service price is required before agreement.");
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
        `Agreed to the current service price of ${state.servicePaymentQuote.amount.value} ${state.servicePaymentQuote.amount.currency_code}.`
      );
    });
  }
}

function setupRequestFeedbackPanel() {
  const form = document.getElementById("request-feedback-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const activeRequest = state.pendingRequest || state.requestHistory[0] || null;
    const requestId = activeRequest?.requestId || activeRequest?.id || null;
    if (!requestId) {
      showBox("request-feedback-status", "Submit a request first so feedback can be matched.");
      return;
    }

    try {
      const formData = new FormData(form);
      const response = await apiFetch(`/requests/${encodeURIComponent(requestId)}/feedback`, {
        method: "POST",
        headers: jsonHeaders(Boolean(state.auth?.sessionToken)),
        body: JSON.stringify({
          rating: Number.parseInt(normalizeField(formData.get("rating")), 10),
          notes: normalizeField(formData.get("notes")),
          phoneNumber: activeRequest.phoneNumber || document.getElementById("phone-number")?.value || "",
          fullName: activeRequest.fullName || document.getElementById("full-name")?.value || ""
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Unable to submit provider feedback.");
      }
      if (payload.request) {
        state.pendingRequest = { ...(state.pendingRequest || {}), ...payload.request };
        renderCustomerRequestState();
      }
      showBox("request-feedback-status", payload.message || "Provider rating recorded.");
      form.reset();
    } catch (error) {
      showBox("request-feedback-status", error.message);
    }
  });
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
      throw new Error(payload.message || payload.error || "The current service price is not available yet.");
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
      `Service price ready: ${payload.amount.value} ${payload.amount.currency_code}. Please agree before continuing.`
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
      termsAccepted: true,
      ...payload
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
    state.providerWallet = null;
    renderProviderWallet();
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
    if (Array.isArray(profile.roles) && profile.roles.includes("PROVIDER")) {
      await loadProviderWallet();
    } else {
      state.providerWallet = null;
      renderProviderWallet();
    }
  } catch (error) {
    state.auth = null;
    storeAuth(null);
    renderProfileState(null);
    state.providerWallet = null;
    renderProviderWallet();
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
          throw new Error("Admin token missing from service response.");
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
        showBox("admin-login-status", "Admin access confirmed.");
        navigateToScreen("admin-dashboard");
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

  document.querySelectorAll("#admin-subscriber-list, #admin-provider-list, #admin-service-history-list, #admin-financial-list, #admin-training-calendar-list")
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

  const adminDirectory = document.querySelectorAll("#admin-search-results, #admin-user-profile");
  adminDirectory.forEach((container) => {
    container.addEventListener("click", async (event) => {
      const viewButton = event.target.closest("[data-admin-view-user]");
      if (viewButton) {
        event.preventDefault();
        await loadAdminUserProfile(viewButton.getAttribute("data-admin-view-user"));
        return;
      }

      const button = event.target.closest("[data-admin-action]");
      if (!button) {
        return;
      }
      event.preventDefault();
      await handleAdminAction(button);
      const selectedUserId = button.getAttribute("data-user-id");
      if (selectedUserId) {
        await loadAdminUserProfile(selectedUserId);
      }
    });
  });

  const adminSearchForm = document.getElementById("admin-search-form");
  if (adminSearchForm) {
    adminSearchForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(adminSearchForm);
      state.adminSearchQuery = normalizeField(formData.get("query"));
      state.adminSearchRole = normalizeField(formData.get("role")).toUpperCase() || "ALL";
      await loadAdminSearch();
    });
  }

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
    setText("admin-training-scheduled", String(payload.stats?.trainingScheduled ?? 0));
    setText("admin-status-label", "Signed in");
    setText("admin-status-badge", payload.trustedZone || "Active");
    setText("admin-status-text", `Location zone: ${payload.locationZone || "not set"}.`);
    renderAdminCollections();
    renderAdminDirectory();
  } catch (error) {
    showBox("admin-login-status", error.message);
  }
}

async function loadAdminSearch() {
  if (!state.admin?.token) {
    showBox("admin-search-status", "Admin login is required.");
    return;
  }

  const query = normalizeField(state.adminSearchQuery);
  const role = normalizeField(state.adminSearchRole).toUpperCase() || "ALL";
  if (!query) {
    state.adminSearchResults = [];
    state.adminSelectedUserProfile = null;
    renderAdminDirectory();
    showBox("admin-search-status", "Enter a name, email, phone number, service area, or account id.");
    return;
  }

  try {
    const searchParams = new URLSearchParams({ q: query, role });
    const response = await adminFetch(`/search?${searchParams.toString()}`, {
      method: "GET",
      headers: adminAuthHeaders()
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Unable to search admin accounts.");
    }
    state.adminSearchResults = Array.isArray(payload.users) ? payload.users : [];
    renderAdminDirectory();
    showBox("admin-search-status", `${state.adminSearchResults.length} account(s) matched.`);
  } catch (error) {
    showBox("admin-search-status", error.message);
  }
}

async function loadAdminUserProfile(userId) {
  if (!state.admin?.token) {
    showBox("admin-search-status", "Admin login is required.");
    return;
  }
  if (!userId) {
    return;
  }

  try {
    const response = await adminFetch(`/users/${encodeURIComponent(userId)}/profile`, {
      method: "GET",
      headers: adminAuthHeaders()
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Unable to load account profile.");
    }
    state.adminSelectedUserProfile = payload;
    renderAdminDirectory();
  } catch (error) {
    showBox("admin-search-status", error.message);
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
  } else if (action === "schedule-training" || action === "complete-training") {
    path = `/providers/${encodeURIComponent(userId)}/training`;
    body = action === "schedule-training"
      ? {
          status: "SCHEDULED",
          scheduledFor: window.prompt("Training ISO date/time", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()) || "",
          note: window.prompt("Training note", "Manual roadside retraining") || "Manual roadside retraining"
        }
      : {
          status: "COMPLETED",
          note: window.prompt("Completion note", "Training completed") || "Training completed"
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
  const walletTerms = state.adminDashboard?.policy?.financial?.walletDisplayTerms || null;
  setText(
    "admin-financial-policy",
    walletTerms
      ? `${walletTerms.summary} ${walletTerms.thirdPartyResponsibility} ${walletTerms.expectedParity} ${walletTerms.discrepancyProcess}`
      : "Financial record terms will appear after login."
  );
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
  renderAdminList(
    "admin-training-calendar-list",
    Array.isArray(state.adminDashboard?.trainingCalendar) ? state.adminDashboard.trainingCalendar : [],
    renderTrainingCalendarItem,
    "Training schedule will appear after login."
  );
  renderAdminList(
    "admin-event-stream-list",
    Array.isArray(state.adminDashboard?.paymentEvents) ? state.adminDashboard.paymentEvents : [],
    renderAdminEventStreamItem,
    "Backend event history will appear after login."
  );
}

function renderAdminDirectory() {
  renderAdminList(
    "admin-search-results",
    Array.isArray(state.adminSearchResults) ? state.adminSearchResults : [],
    renderAdminSearchResult,
    state.admin?.token
      ? "Search by name, email, phone, service area, or account id."
      : "Search results will appear here after admin login."
  );

  const container = document.getElementById("admin-user-profile");
  if (!container) {
    return;
  }

  if (!state.adminSelectedUserProfile?.user) {
    container.innerHTML = '<div class="admin-empty">Choose a search result to inspect account status, support context, and recent request history.</div>';
    return;
  }

  container.innerHTML = renderAdminUserProfile(state.adminSelectedUserProfile);
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
        <span class="badge">${escapeHtml(prettifyToken(subscriber.subscriptionStatus || "UNKNOWN"))}</span>
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
  const trainingStatus = provider.discipline?.training?.status || "NOT_REQUIRED";
  const scheduleButton = provider.discipline?.currentSuspension?.indefinite
    ? `<button class="glow-button alt compact" type="button" data-admin-action="schedule-training" data-user-id="${escapeHtml(provider.id)}">Schedule Training</button>`
    : "";

  return `
    <article class="admin-item">
      <div class="admin-item-head">
        <div>
          <strong>${escapeHtml(provider.fullName || provider.email)}</strong>
          <small>${escapeHtml(provider.email || "No email")} · ${escapeHtml(provider.phoneNumber || "No phone")}</small>
        </div>
        <span class="badge">${escapeHtml(labelUiStatus("providerStatus", provider.providerStatus || "DRAFT"))}</span>
      </div>
      <div class="admin-item-meta">
        <span>State: ${escapeHtml(prettifyToken(provider.accountState || "ACTIVE"))}</span>
        <span>Services: ${escapeHtml((provider.services || []).map(labelServiceType).join(", ") || "Not set")}</span>
        <span>Strikes: ${escapeHtml(String(provider.discipline?.strikeCount || 0))}</span>
        <span>Training: ${escapeHtml(prettifyToken(trainingStatus))}</span>
      </div>
      <p class="muted">Rating: ${escapeHtml(formatRating(provider.rating))} · Suspension: ${escapeHtml(formatSuspensionSummary(provider.discipline?.currentSuspension))}</p>
      <div class="button-pair">${approveButton}${scheduleButton}</div>
    </article>
  `;
}

function renderAdminSearchResult(user) {
  const roles = Array.isArray(user.roles) ? user.roles.join(", ") : "Unknown";
  return `
    <article class="admin-item">
      <div class="admin-item-head">
        <div>
          <strong>${escapeHtml(user.fullName || user.email || `User ${user.id}`)}</strong>
          <small>#${escapeHtml(user.id)} · ${escapeHtml(user.email || "No email")} · ${escapeHtml(user.phoneNumber || "No phone")}</small>
        </div>
        <span class="badge">${escapeHtml(prettifyToken(roles))}</span>
      </div>
      <div class="admin-item-meta">
        <span>State: ${escapeHtml(prettifyToken(user.accountState || "ACTIVE"))}</span>
        <span>Provider: ${escapeHtml(prettifyToken(user.providerStatus || "n/a"))}</span>
        <span>Requests: ${escapeHtml(String(user.requestCount || 0))}</span>
        <span>Active: ${escapeHtml(String(user.activeRequestCount || 0))}</span>
      </div>
      <p class="muted">${escapeHtml(user.serviceArea || user.currentLocation || "No service-area or location note available.")}</p>
      <div class="button-pair">
        <button class="glow-button compact" type="button" data-admin-view-user="${escapeHtml(user.id)}">Open Profile</button>
      </div>
    </article>
  `;
}

function renderAdminUserProfile(profile) {
  const user = profile.user || {};
  const subscriber = profile.subscriber || null;
  const provider = profile.provider || null;
  const supportSummary = profile.supportSummary || {};
  const nextAccountState = user.accountState === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
  const customerRequests = Array.isArray(profile.recentCustomerRequests) ? profile.recentCustomerRequests : [];
  const providerRequests = Array.isArray(profile.recentProviderRequests) ? profile.recentProviderRequests : [];
  const providerApproveButton = provider?.providerStatus === "PENDING_APPROVAL"
    ? `<button class="glow-button compact" type="button" data-admin-action="approve-provider" data-user-id="${escapeHtml(user.id)}">Approve Provider</button>`
    : "";
  const trainingButton = provider?.discipline?.currentSuspension?.indefinite
    ? `<button class="glow-button alt compact" type="button" data-admin-action="schedule-training" data-user-id="${escapeHtml(user.id)}">Schedule Training</button>`
    : provider?.discipline?.training?.status === "SCHEDULED" || provider?.discipline?.training?.status === "ENROLLED"
      ? `<button class="glow-button alt compact" type="button" data-admin-action="complete-training" data-user-id="${escapeHtml(user.id)}">Mark Training Complete</button>`
      : "";

  return `
    <article class="admin-item">
      <div class="admin-item-head">
        <div>
          <strong>${escapeHtml(user.fullName || user.email || `User ${user.id}`)}</strong>
          <small>#${escapeHtml(user.id)} · ${escapeHtml((user.roles || []).join(", ") || "No roles")}</small>
        </div>
        <span class="badge">${escapeHtml(prettifyToken(user.accountState || "ACTIVE"))}</span>
      </div>
      <div class="admin-item-meta">
        <span>Email: ${escapeHtml(user.email || "Not set")}</span>
        <span>Phone: ${escapeHtml(user.phoneNumber || "Not set")}</span>
        <span>Signed up: ${escapeHtml(formatTimestamp(user.signUpDate))}</span>
      </div>
      <div class="admin-item-meta">
        <span>Customer requests: ${escapeHtml(String(supportSummary.customerRequestCount || 0))}</span>
        <span>Provider requests: ${escapeHtml(String(supportSummary.providerRequestCount || 0))}</span>
        <span>Customer live: ${escapeHtml(String(supportSummary.activeCustomerRequests || 0))}</span>
        <span>Provider live: ${escapeHtml(String(supportSummary.activeProviderRequests || 0))}</span>
      </div>
      ${subscriber ? `<p class="muted">Subscriber status: ${escapeHtml(prettifyToken(subscriber.subscriptionStatus || "inactive"))} · Vehicles: ${escapeHtml((subscriber.savedVehicles || []).map(formatVehicleSummary).join(" | ") || "None")} · Billing: ${escapeHtml(formatTimestamp(subscriber.nextBillingDate))}</p>` : ""}
      ${provider ? `<p class="muted">Provider status: ${escapeHtml(labelUiStatus("providerStatus", provider.providerStatus || "DRAFT"))} · Service area: ${escapeHtml(provider.serviceArea || "Not set")} · Services: ${escapeHtml((provider.services || []).map(labelServiceType).join(", ") || "Not set")}</p>` : ""}
      ${provider ? `<p class="muted">Hours configured: ${provider.hoursOfService?.hasHours ? "Yes" : "No"} · Documents ready: ${provider.documentStatus?.meetsMinimumRequirements ? "Yes" : "No"} · PayPal email: ${escapeHtml(provider.paypal?.email || "Not linked")}</p>` : ""}
      ${provider ? `<p class="muted">Rating: ${escapeHtml(formatRating(provider.rating))} · Strikes: ${escapeHtml(String(provider.discipline?.strikeCount || 0))} · Training: ${escapeHtml(prettifyToken(provider.discipline?.training?.status || "NOT_REQUIRED"))} · Suspension: ${escapeHtml(formatSuspensionSummary(provider.discipline?.currentSuspension))}</p>` : ""}
      <div class="button-pair">
        <button class="glow-button alt compact" type="button" data-admin-action="set-account-state" data-user-id="${escapeHtml(user.id)}" data-account-state="${escapeHtml(nextAccountState)}">${escapeHtml(nextAccountState === "SUSPENDED" ? "Suspend User" : "Reactivate User")}</button>
        ${providerApproveButton}
        ${trainingButton}
      </div>
      <div class="admin-item-meta">
        <span>Recent customer requests: ${escapeHtml(String(customerRequests.length))}</span>
        <span>Recent provider requests: ${escapeHtml(String(providerRequests.length))}</span>
      </div>
      ${customerRequests.length ? customerRequests.map((entry) => `<div class="muted">${escapeHtml(entry.requestId)} · ${escapeHtml(labelServiceType(entry.serviceType))} · ${escapeHtml(labelUiStatus("requestStatus", entry.status || "UNKNOWN"))} · ${escapeHtml(formatTimestamp(entry.submittedAt))}</div>`).join("") : '<div class="muted">No recent customer requests.</div>'}
      ${providerRequests.length ? providerRequests.map((entry) => `<div class="muted">${escapeHtml(entry.requestId)} · ${escapeHtml(entry.fullName || "Customer")} · ${escapeHtml(labelUiStatus("requestStatus", entry.status || "UNKNOWN"))} · ${escapeHtml(formatTimestamp(entry.submittedAt))}</div>`).join("") : '<div class="muted">No recent provider assignments.</div>'}
    </article>
  `;
}

function renderTrainingCalendarItem(entry) {
  return `
    <article class="admin-item">
      <div class="admin-item-head">
        <div>
          <strong>${escapeHtml(entry.fullName || `Provider ${entry.providerId}`)}</strong>
          <small>#${escapeHtml(String(entry.providerId))} · ${escapeHtml(prettifyToken(entry.status || "SCHEDULED"))}</small>
        </div>
        <span class="badge">${escapeHtml(formatTimestamp(entry.scheduledFor))}</span>
      </div>
      <p class="muted">${escapeHtml(entry.note || "Manual roadside retraining scheduled.")}</p>
      <div class="button-pair">
        <button class="glow-button compact" type="button" data-admin-action="complete-training" data-user-id="${escapeHtml(entry.providerId)}">Mark Training Complete</button>
      </div>
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
        <span class="badge">${escapeHtml(labelUiStatus("requestStatus", entry.completionStatus || "OPEN"))}</span>
      </div>
      <div class="admin-item-meta">
        <span>${escapeHtml(labelServiceType(entry.serviceType || "Service"))}</span>
        <span>${escapeHtml(prettifyToken(entry.customerType || "UNKNOWN"))}</span>
        <span>${escapeHtml(entry.providerAssigned || "Unassigned")}</span>
        <span>${escapeHtml(labelUiStatus("paymentStatus", entry.paymentStatus || "UNKNOWN"))}</span>
        <span>Rating: ${escapeHtml(entry.customerRating ? `${entry.customerRating}/8` : "None")}</span>
        <span>Notes: ${escapeHtml(String(entry.noteCount || 0))}</span>
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
        <span class="badge">${escapeHtml(labelUiStatus("payoutStatus", entry.providerPayoutStatus || "UNASSIGNED"))}</span>
      </div>
      <div class="admin-item-meta">
        <span>Charged: ${escapeHtml(formatUsd(entry.amountCharged || 0))}</span>
        <span>Collected: ${escapeHtml(formatUsd(entry.amountCollected || 0))}</span>
        <span>Payment: ${escapeHtml(labelUiStatus("paymentStatus", entry.paymentStatus || "UNKNOWN"))}</span>
      </div>
      <p class="muted">Refund issued: ${entry.refundIssued ? "Yes" : "No"} · Refund flag: ${entry.refundFlag ? "Yes" : "No"} · Dispute flag: ${entry.disputeFlag ? "Yes" : "No"}</p>
      <div class="button-pair">
        <button class="glow-button danger compact" type="button" data-admin-action="refund-request" data-request-id="${escapeHtml(entry.requestId)}">Refund User</button>
        <button class="glow-button compact" type="button" data-admin-action="complete-payout" data-request-id="${escapeHtml(entry.requestId)}">Mark Payout Complete</button>
      </div>
    </article>
  `;
}

function renderAdminEventStreamItem(entry) {
  return `
    <article class="admin-item">
      <div class="admin-item-head">
        <div>
          <strong>${escapeHtml(labelPaymentEvent(entry.event || "backend-event"))}</strong>
          <small>${escapeHtml(formatTimestamp(entry.capturedAt || entry.createdAt || entry.timestamp))}</small>
        </div>
        <span class="badge">${escapeHtml(labelUiStatus("paymentStatus", entry.status || "UNKNOWN"))}</span>
      </div>
      <div class="admin-item-meta">
        <span>Order: ${escapeHtml(entry.paypalOrderId || "Not set")}</span>
        <span>Request: ${escapeHtml(entry.request?.requestId || entry.requestId || "Not set")}</span>
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

function setupProviderWalletPanel() {
  const refreshButton = document.getElementById("provider-wallet-refresh");
  if (!refreshButton) {
    return;
  }

  refreshButton.addEventListener("click", async () => {
    await loadProviderWallet(true);
  });
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
          <div class="value">${escapeHtml(labelServiceType(request.serviceType || "Service"))} · ${escapeHtml(request.fullName || "Customer")}</div>
          <div class="muted">${escapeHtml(request.location || "Location not provided")}</div>
          <div class="muted">Status: ${escapeHtml(labelUiStatus("requestStatus", request.status || "UNKNOWN"))} · Reference ${escapeHtml(requestId)}</div>
          <div class="muted">ETA stage: ${escapeHtml(prettifyToken(request.etaStage || "pending"))} · Soft ETA: ${escapeHtml(String(request.softEtaMinutes ?? "Not set"))} · Hard ETA: ${escapeHtml(String(request.hardEtaMinutes ?? "Locked"))}</div>
          <div class="muted">Location access: ${escapeHtml(prettifyToken(request.locationDisclosureLevel || "masked"))} · Contact access: ${escapeHtml(prettifyToken(request.contactDisclosureLevel || "locked"))}</div>
          <div class="muted">Customer callback: ${escapeHtml(request.customerCallbackNumber || "Locked until payment and provider activation")}</div>
          <label class="provider-note-field">
            <span class="muted">Dispatch note</span>
            <textarea class="field area" id="provider-note-${escapeHtml(requestId)}" placeholder="Short dispatch-safe note for this request">${escapeHtml(readProviderDraftNote(requestId))}</textarea>
          </label>
          ${renderProviderNoteExchange(request.noteExchange)}
        </div>
        <div class="provider-action-grid">
          ${renderProviderActionButton(requestId, "accept", "Accept")}
          ${renderProviderActionButton(requestId, "eta", "ETA")}
          ${renderProviderActionButton(requestId, "soft-contact", "Soft Contact")}
          ${renderProviderActionButton(requestId, "hard-contact", "Hard Contact")}
          ${renderProviderActionButton(requestId, "arrived", "Arrived")}
          ${renderProviderActionButton(requestId, "completed", "Completed")}
          ${renderProviderActionButton(requestId, "note", "Log Note")}
        </div>
      </div>`;
    })
    .join("");
}

function renderProviderActionButton(requestId, action, label) {
  return `<button class="glow-button compact" type="button" data-provider-action="${escapeHtml(action)}" data-request-id="${escapeHtml(requestId)}">${escapeHtml(label)}</button>`;
}

async function queueProviderAction(requestId, action) {
  const providerPayload = readProviderActionPayload(requestId, action);
  const entry = {
    id: buildEventId("provider"),
    requestId,
    action,
    status: "queued-frontend",
    timestamp: new Date().toISOString(),
    route: `/api/aw-roadside/requests/${requestId}/${action}`,
    note: providerPayload.note || ""
  };
  state.providerActionQueue = [entry, ...state.providerActionQueue].slice(0, 50);
  storeJson(providerActionQueueKey, state.providerActionQueue);
  recordProcessingEvent({
    action: `provider-${action}`,
    route: entry.route,
    status: "queued-frontend",
    requestId,
      message: "Provider action sent to dispatch."
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
      body: JSON.stringify(providerPayload)
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
        ? `${labelProviderAction(action)} saved for dispatch review for ${requestId}.`
        : `${labelProviderAction(action)} recorded for ${requestId}.`
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
      <div class="value">${escapeHtml(labelProcessingEntry(entry.action || entry.method || "route"))} · ${escapeHtml(labelProcessingStatus(status || "pending"))}</div>
      <div class="muted">${escapeHtml(formatTimestamp(entry.timestamp))}</div>
      ${entry.message ? `<div class="muted">${escapeHtml(entry.message)}</div>` : ""}
    </div>`;
  }, "No route events stored yet.");

  renderList("request-history-list", state.requestHistory, (entry) => `<div class="item">
    <div class="value">${escapeHtml(entry.requestId || "pending")} · ${escapeHtml(labelServiceType(entry.serviceType || "service"))}</div>
    <div class="muted">${escapeHtml(labelUiStatus("requestStatus", entry.status || "submitted"))} · ${escapeHtml(entry.mode || "guest")} · ${formatTimestamp(entry.timestamp)}</div>
  </div>`, "No request history stored yet.");

  renderList("payment-ledger-list", state.paymentLedger, (entry) => `<div class="item">
    <div class="value">${escapeHtml(labelPaymentEvent(entry.event || "payment"))} · ${escapeHtml(labelUiStatus("paymentStatus", entry.status || "pending"))}</div>
    <div class="muted">Order ${escapeHtml(entry.orderId || "not assigned")} · Request ${escapeHtml(entry.requestId || "pending")} · ${formatTimestamp(entry.timestamp)}</div>
  </div>`, "No payment events stored yet.");

  renderCustomerRequestState();
}

function renderProviderActionQueue() {
  renderList("provider-action-queue-list", state.providerActionQueue, (entry) => `<div class="item">
    <div class="value">${escapeHtml(labelProviderAction(entry.action || "action"))} · ${escapeHtml(labelProcessingStatus(entry.status || "queued"))}</div>
    <div class="muted">Request ${escapeHtml(entry.requestId || "unknown")} · ${formatTimestamp(entry.updatedAt || entry.timestamp)}</div>
    ${entry.backendStatus ? `<div class="muted">Current step: ${escapeHtml(labelUiStatus("requestStatus", entry.backendStatus))}</div>` : ""}
    ${entry.error ? `<div class="muted">${escapeHtml(entry.error)}</div>` : ""}
  </div>`, "No provider actions queued yet.");
}

async function loadProviderWallet(manualRefresh = false) {
  if (!state.auth?.sessionToken) {
    state.providerWallet = null;
    renderProviderWallet();
    if (manualRefresh) {
      showBox("provider-wallet-status", "Sign in as a provider before loading wallet records.");
    }
    return;
  }

  if (!Array.isArray(state.auth?.roles) || !state.auth.roles.includes("PROVIDER")) {
    state.providerWallet = null;
    renderProviderWallet();
    if (manualRefresh) {
      showBox("provider-wallet-status", "Provider wallet records are available only for provider accounts.");
    }
    return;
  }

  try {
    const payload = await fetchApiJsonWithFallback("/provider/wallet", [], {
      headers: jsonHeaders(true)
    });
    state.providerWallet = payload;
    renderProviderWallet();
    showBox("provider-wallet-status", "Provider wallet records are up to date.");
    recordProcessingEvent({
      action: "provider-wallet",
      route: "/provider/wallet",
      status: "accepted",
      message: `${Array.isArray(payload.ledger) ? payload.ledger.length : 0} payout record(s) loaded.`
    });
  } catch (error) {
    state.providerWallet = null;
    renderProviderWallet();
    showBox("provider-wallet-status", error.message);
    recordProcessingEvent({
      action: "provider-wallet",
      route: "/provider/wallet",
      status: "error",
      message: error.message
    });
  }
}

function renderProviderWallet() {
  const wallet = state.providerWallet || null;
  const summary = wallet?.summary || {};
  const payoutTelemetry = wallet?.payoutTelemetry || {};
  const paypalState = wallet?.paypalState || {};
  const terms = wallet?.walletDisplayTerms || null;
  const ledger = Array.isArray(wallet?.ledger) ? wallet.ledger : [];

  setText(
    "provider-wallet-summary-copy",
    wallet
      ? `Current payout totals for ${wallet.provider?.fullName || "your provider account"} are shown below.`
      : "Wallet records will appear after provider wallet data is loaded."
  );
  setText(
    "provider-wallet-paypal-email",
    wallet
      ? `Payout destination: ${paypalState.email || wallet.provider?.paypalEmail || "Provider payout destination not yet linked."}`
      : "Payout destination will appear after provider wallet data is loaded."
  );
  setText(
    "provider-wallet-telemetry",
    wallet
      ? `Latest payout status: ${labelUiStatus("payoutStatus", payoutTelemetry.lastStatus || "pending")} · Last event: ${prettifyToken(payoutTelemetry.lastEventType || "pending")} · Updated ${formatTimestamp(payoutTelemetry.lastEventAt || paypalState.lastWebhookAt)}.`
      : "Provider payout activity will appear after wallet data is loaded."
  );
  setText(
    "provider-wallet-terms-summary",
    terms?.summary || "Wallet display terms will appear here after sign-in."
  );
  setText(
    "provider-wallet-terms-detail",
    terms
      ? `${terms.thirdPartyResponsibility} ${terms.expectedParity} ${terms.discrepancyProcess}`
      : "Payout timing and discrepancy guidance will appear after the wallet is loaded."
  );

  setText("provider-wallet-funds-available", formatUsd(summary.fundsAvailable || 0));
  setText("provider-wallet-funds-pending", formatUsd(summary.fundsPending || 0));
  setText("provider-wallet-funds-on-hold", formatUsd(summary.fundsOnHold || 0));
  setText("provider-wallet-funds-dispute", formatUsd(summary.fundsDispute || 0));
  setText("provider-wallet-funds-paid-out", formatUsd(summary.fundsPaidOut || 0));

  setText(
    "provider-wallet-funds-available-count",
    wallet ? `${summary.completedPayoutCount || 0} completed payout(s) recorded.` : "Waiting for provider payout data."
  );
  setText(
    "provider-wallet-funds-pending-count",
    wallet ? `${summary.pendingPayoutCount || 0} payout(s) pending or in motion.` : "Waiting for provider payout data."
  );
  setText(
    "provider-wallet-funds-on-hold-count",
    wallet ? `${summary.onHoldCount || 0} payout(s) currently on hold.` : "Waiting for provider payout data."
  );
  setText(
    "provider-wallet-funds-dispute-count",
    wallet ? `${summary.disputeCount || 0} payout dispute record(s).` : "Waiting for provider payout data."
  );
  setText(
    "provider-wallet-funds-paid-out-count",
    wallet ? `${formatUsd(summary.totalEstimated || 0)} tracked across all provider payout records.` : "Waiting for provider payout data."
  );

  renderList(
    "provider-wallet-ledger-list",
    ledger,
    (entry) => `<div class="item">
      <div class="value">${escapeHtml(entry.requestId || "Pending request")} · ${escapeHtml(labelServiceType(entry.serviceType || "Service"))}</div>
      <div class="muted">${escapeHtml(entry.customerName || "Customer")} · ${escapeHtml(prettifyToken(entry.customerTier || "guest"))} · ${escapeHtml(formatTimestamp(entry.updatedAt))}</div>
      <div class="muted">Estimated payout: ${escapeHtml(formatUsd(entry.estimatedPayoutAmount || 0))} · Actual payout: ${escapeHtml(entry.actualPayoutAmount === null ? "Awaiting payout completion" : formatUsd(entry.actualPayoutAmount))}</div>
      <div class="muted">Payout: ${escapeHtml(labelUiStatus("payoutStatus", entry.providerPayoutStatus || "UNASSIGNED"))} · Payment: ${escapeHtml(labelUiStatus("paymentStatus", entry.paymentStatus || "UNKNOWN"))}</div>
      <div class="muted">Flags: Hold ${entry.holdFlag ? "Yes" : "No"} · Dispute ${entry.disputeFlag ? "Yes" : "No"} · Refund ${entry.refundFlag ? "Yes" : "No"}</div>
      ${entry.payoutCompletedAt ? `<div class="muted">Paid out ${escapeHtml(formatTimestamp(entry.payoutCompletedAt))}</div>` : ""}
      ${entry.payoutLastEventType ? `<div class="muted">Latest event: ${escapeHtml(prettifyToken(entry.payoutLastEventType))} · ${escapeHtml(formatTimestamp(entry.payoutLastEventAt))}</div>` : ""}
    </div>`,
    wallet
      ? "No provider payout records are available yet."
      : "Sign in as a provider to load payout records."
  );
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
      ? `Provider signed in${auth.providerStatus ? ` · ${labelUiStatus("providerStatus", auth.providerStatus)}` : ""}`
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
  setText("provider-admin-status", auth?.providerStatus ? `Provider status: ${labelUiStatus("providerStatus", auth.providerStatus)}.` : "Provider status will appear after sign-in.");
  setText("provider-service-list", formatProviderServices(profile));
  setText("provider-vehicle-summary", formatProviderVehicle(profile));
  renderCustomerRequestState();
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
      navigateToScreen(screen);
    });
  });

  window.addEventListener("hashchange", () => {
    switchScreen(readScreenFromHash());
  });

  // Check for persisted screen to survive Expo Go / Mobile resets
  const persistedScreen = shellState.lastActiveScreen;
  const initialScreen = state.auth?.userId ? (readScreenFromHash() || persistedScreen) : "home";
  
  switchScreen(initialScreen);
}

function readScreenFromHash() {
  const value = window.location.hash.replace(/^#/, "").trim().toLowerCase();
  if (["home", "customer", "provider", "admin", "security"].includes(value)) {
    return value;
  }
  return "home";
}

function navigateToScreen(screen) {
  switchScreen(screen);
}

// --- SHELL REPORTING & STATE COMMIT ---
const shellStateKey = `${storageKey}-shell-state`;
const shellState = readStoredJson(shellStateKey) || {
  lastReportedBy: "init",
  lastActiveScreen: "home",
  pendingCommit: false,
  authorityState: "active"
};

function reportToShell(screen, data = {}) {
  console.log(`[SHELL_REPORT] ${screen} is reporting state...`);
  shellState.lastReportedBy = screen;
  shellState.lastActiveScreen = screen;
  shellState.pendingCommit = true;
  storeJson(shellStateKey, shellState);
  
  if (data.needsPersistence) {
    commitToBackend(screen, data);
  }
}

function readStoredJson(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function commitToBackend(screen, data) {
  console.log(`[SHELL_COMMIT] Committing ${screen} data to backend relay...`);
  shellState.pendingCommit = false;
  // Trigger API calls here as the final authority
}

function switchScreen(screen) {
  const targetScreen = screen || "home";
  let found = false;
  
  document.querySelectorAll("[data-screen]").forEach((element) => {
    const isActive = element.getAttribute("data-screen") === targetScreen;
    element.hidden = !isActive;
    element.classList.toggle("active-screen", isActive);
    if (isActive) {
      found = true;
    }
  });

  // Fallback to home if screen doesn't exist
  if (!found && targetScreen !== "home") {
    switchScreen("home");
    return;
  }

  document.querySelectorAll("[data-nav]").forEach((element) => {
    element.classList.toggle("active", element.getAttribute("data-nav") === targetScreen);
  });

  if (window.location.hash !== `#${targetScreen}`) {
    window.history.replaceState(null, "", `#${targetScreen}`);
  }

  // Each screen reports to the shell upon entry
  reportToShell(targetScreen, { event: "screen_entry" });
}

function screenToPage(screen) {
  return {
    home: "home.html",
    customer: "customer.html",
    provider: "provider.html",
    "provider-info": "provider-info.html",
    "provider-work": "provider-work.html",
    "provider-wallet": "provider-wallet.html",
    admin: "admin.html",
    "admin-dashboard": "admin-dashboard.html",
    "admin-accounts": "admin-accounts.html",
    "admin-financials": "admin-financials.html",
    security: "index.html#security"
  }[screen] || "";
}

function renderWatchdogFiles(files) {
  const container = document.getElementById("watchdog-file-list");
  if (!container) {
    return;
  }

  if (!files.length) {
    container.innerHTML = '<div class="item"><div class="value">No integrity issues detected.</div><div class="muted">Protected records match the trusted baseline.</div></div>';
    return;
  }

  container.innerHTML = files
    .map((file) => {
      const detail = file.status === "modified"
        ? "A protected record changed and should be reviewed."
        : "A protected record needs attention.";
      return `<div class="item"><div class="value">${escapeHtml(prettifyToken(file.status || "review"))}</div><div class="muted">${escapeHtml(detail)}</div></div>`;
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
        throw new Error(formatUserFacingMessage(payload.message || payload.error || `Request failed with ${response.status}.`));
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
  toggleProviderDocumentsPanel(profile);
  setText("provider-service-list", formatProviderServices(profile));
  setText("provider-vehicle-summary", formatProviderVehicle(profile));
}

function toggleProviderDocumentsPanel(profile) {
  const panel = document.getElementById("provider-documents-panel");
  if (!panel) {
    return;
  }

  const isProvider = Array.isArray(profile?.roles) && profile.roles.includes("PROVIDER");
  panel.hidden = !isProvider;
}

function buildProviderDocumentPayload(value, fallbackFileName) {
  const raw = normalizeField(value);
  if (!raw) {
    return false;
  }

  const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      dataUrl: raw,
      fileName: fallbackFileName,
      contentType: dataUrlMatch[1]
    };
  }

  return {
    dataBase64: base64EncodeUtf8(raw),
    fileName: fallbackFileName,
    contentType: "text/plain",
    note: "Uploaded from provider info screen."
  };
}

function base64EncodeUtf8(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function formatProviderServices(profile) {
  const services = Array.isArray(profile?.services) ? profile.services.filter(Boolean) : [];
  return services.length ? `Services: ${services.map(labelServiceType).join(", ")}` : "Services will appear after provider access is confirmed.";
}

function formatProviderVehicle(profile) {
  const vehicle = profile?.providerProfile?.vehicleInfo || profile?.subscriberProfile?.vehicle || null;
  return vehicle ? `Vehicle profile: ${formatVehicleSummary(vehicle)}` : "Vehicle profile will appear after account details are loaded.";
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

function parseBooleanFlag(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
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
    frontendConfig: config.frontendConfig && typeof config.frontendConfig === "object" ? config.frontendConfig : null,
    publicPricingVisible: parseBooleanFlag(config.publicPricingVisible, false),
    showInternalPreviewData: parseBooleanFlag(config.showInternalPreviewData, false)
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
  element.textContent = formatUserFacingMessage(message);
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

function shouldShowInternalPreviewData() {
  return parseBooleanFlag(state.frontendConfig?.showInternalPreviewData, runtimeConfig.showInternalPreviewData);
}

function shouldShowPublicPricing() {
  return parseBooleanFlag(state.frontendConfig?.publicPricingVisible, runtimeConfig.publicPricingVisible);
}

function applyPreviewVisibility() {
  const showInternalPreviewData = shouldShowInternalPreviewData();
  document.querySelectorAll("[data-internal-preview]").forEach((element) => {
    element.hidden = !showInternalPreviewData;
  });
}

function formatMonthlyUsd(amount) {
  return `${formatUsd(amount)}/mo`;
}

function hasDisplayPrice(value) {
  return Number.isFinite(Number(value));
}

function renderPublicPricing(config = null) {
  const source = config || state.paymentConfig || state.frontendConfig || {};
  if (shouldShowPublicPricing()) {
    setText(
      "priority-price",
      hasDisplayPrice(source.priorityServicePrice) ? formatUsd(source.priorityServicePrice) : "Available after request"
    );
    setText(
      "subscriber-monthly-price",
      hasDisplayPrice(source.subscriberMonthlyFee) ? formatMonthlyUsd(source.subscriberMonthlyFee) : "pricing available on request"
    );
    setText(
      "provider-monthly-price",
      hasDisplayPrice(source.providerMonthlyFee) ? formatMonthlyUsd(source.providerMonthlyFee) : "approval-based pricing"
    );
    return;
  }

  setText("priority-price", "Available after request");
  setText("subscriber-monthly-price", "pricing available on request");
  setText("provider-monthly-price", "approval-based pricing");
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

function formatRating(value) {
  if (!value || typeof value !== "object") {
    return "No ratings yet";
  }
  const average = Number(value.averageRating || 0);
  const count = Number(value.ratingCount || 0);
  return count > 0 ? `${average.toFixed(2)} / 8 (${count})` : "No ratings yet";
}

function formatSuspensionSummary(value) {
  if (!value || !value.active) {
    return "None active";
  }
  if (value.indefinite) {
    return "Indefinite until admin training action";
  }
  return value.endsAt ? `Active until ${formatTimestamp(value.endsAt)}` : "Active";
}

function renderCustomerRequestState() {
  const activeRequest = state.pendingRequest || state.requestHistory[0] || null;
  const summary = activeRequest
    ? `${labelServiceType(activeRequest.serviceType || "Service")} request ${activeRequest.requestId || "pending"} is ${labelUiStatus("requestStatus", activeRequest.status || "SUBMITTED")}.`
    : "Submit a request to create a reference and unlock live request updates on this page.";
  setText("customer-request-summary", summary);
}

function readProviderDraftNote(requestId) {
  const entry = state.providerActionQueue.find((item) => String(item.requestId) === String(requestId) && item.action === "note" && typeof item.note === "string" && item.note.trim());
  return entry?.note || "";
}

function renderProviderNoteExchange(noteExchange) {
  const notes = Array.isArray(noteExchange) ? noteExchange.slice(0, 4) : [];
  if (!notes.length) {
    return '<div class="muted">No dispatch notes have been recorded on this request yet.</div>';
  }
  return `<div class="provider-note-history">${notes.map((entry) => `
    <div class="muted">${escapeHtml(prettifyToken(entry.actorRole || "user"))}: ${escapeHtml(entry.message || "No note message.")} · ${escapeHtml(formatTimestamp(entry.createdAt))}</div>
  `).join("")}</div>`;
}

function readProviderActionPayload(requestId, action) {
  const payload = {};
  const noteField = document.getElementById(`provider-note-${requestId}`);
  const noteValue = normalizeField(noteField?.value);
  if (action === "note") {
    payload.note = noteValue || "Frontend provider note";
  } else if (noteValue) {
    payload.note = noteValue;
  } else {
    payload.note = `frontend provider action: ${action}`;
  }
  return payload;
}

function uiEventMap() {
  return state.adminDashboard?.policy?.uiEventMap || state.frontendConfig?.uiEventMap || state.paymentConfig?.uiEventMap || {};
}

function labelUiStatus(group, value) {
  const normalized = normalizeField(String(value || "")).toUpperCase();
  const map = uiEventMap()?.[group] || {};
  return map[normalized] || map[value] || prettifyToken(value || "Unknown");
}

function labelServiceType(value) {
  const map = uiEventMap()?.serviceTypes || {};
  return map[value] || map[normalizeField(String(value || "")).toUpperCase()] || prettifyToken(value || "Service");
}

function labelProviderAction(action) {
  const map = uiEventMap()?.providerActions || {};
  return map[action] || prettifyToken(action || "action");
}

function labelPaymentEvent(value) {
  return prettifyToken(String(value || "payment").replace(/^order-/, "payment-"));
}

function labelProcessingEntry(value) {
  return value === "backend-route" ? "Service event" : prettifyToken(value || "route");
}

function labelProcessingStatus(value) {
  const normalized = normalizeField(String(value || "")).toLowerCase();
  return {
    accepted: "Accepted",
    rejected: "Needs review",
    "network-error": "Connection issue",
    blocked: "Blocked",
    queued: "Queued",
    "queued-frontend": "Queued",
    "backend-pending": "Pending",
    "backend-committed": "Recorded",
    "backend-error": "Action failed",
    error: "Action failed",
  }[normalized] || prettifyToken(value || "pending");
}

function formatUserFacingMessage(message) {
  const text = normalizeField(message);
  if (!text) {
    return "";
  }

  const normalized = text.toLowerCase();
  if (normalized.includes("hard eta")) {
    return "Service payment will unlock once the provider records a soft ETA.";
  }
  if (normalized.includes("payment must be captured before live communication is unlocked")) {
    return "Direct provider-to-customer communication unlocks only after payment is captured.";
  }
  if (normalized.includes("backend service quote")) {
    return "The current service price is required before continuing.";
  }
  if (normalized.includes("backend quote")) {
    return text.replace(/backend quote/gi, "service price");
  }
  if (normalized.includes("protected backend")) {
    return text.replace(/protected backend/gi, "dispatch service");
  }
  if (normalized.includes("backend response")) {
    return text.replace(/backend response/gi, "service response");
  }
  if (normalized.includes("backend admin routes")) {
    return text.replace(/backend admin routes/gi, "admin service routes");
  }
  if (normalized.includes("backend")) {
    return text.replace(/backend/gi, "service");
  }
  if (normalized.includes("terms of agreement are required")) {
    return "Please accept the account terms before continuing.";
  }
  if (normalized.includes("subscriber terms must be accepted")) {
    return "Please accept the membership terms before continuing.";
  }
  if (normalized.includes("dispatch-only liability terms must be accepted")) {
    return "Please accept the dispatch responsibility notice before continuing.";
  }
  if (normalized.includes("no-refund policy must be accepted")) {
    return "Please accept the payment policy before continuing.";
  }
  if (normalized.includes("provider liability acknowledgement is required")) {
    return "Please accept the provider responsibility notice before continuing.";
  }
  if (normalized.includes("provider service area is required")) {
    return "Enter the area where you are available to take calls.";
  }
  if (normalized.includes("provider hours of service are required")) {
    return "Enter your available hours before submitting your provider profile.";
  }
  if (normalized.includes("provider assessment incomplete")) {
    return "Complete each provider readiness answer before submitting your application.";
  }
  if (normalized.includes("provider assessment did not meet safety requirements")) {
    return "Review the provider readiness answers and resubmit with a safe service decision.";
  }
  if (normalized.includes("request failed with 5")) {
    return "Something went wrong on the service side. Please try again.";
  }
  return text;
}

function prettifyToken(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim() || "Unknown";
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
