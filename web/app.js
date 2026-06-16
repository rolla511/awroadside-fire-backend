const storageKey = "adub-auth-session";
const processingLogKey = `${storageKey}-processing-log`;
const requestHistoryKey = `${storageKey}-request-history`;
const paymentLedgerKey = `${storageKey}-payment-ledger`;
const providerActionQueueKey = `${storageKey}-provider-action-queue`;
const pendingRequestKey = `${storageKey}-pending-request`;
const servicePaymentQuoteKey = `${storageKey}-service-payment-quote`;
const serviceQuoteAcceptedKey = `${storageKey}-service-quote-accepted`;
const requestDraftKey = `${storageKey}-request-draft`;
const requestLocationResolutionKey = `${storageKey}-request-location-resolution`;
const subscriberSignupDraftKey = `${storageKey}-subscriber-signup-draft`;
const subscriberProfileDraftKey = `${storageKey}-subscriber-profile-draft`;
const subscriberRequestDraftKey = `${storageKey}-subscriber-request-draft`;
const subscriberRequestLocationResolutionKey = `${storageKey}-subscriber-request-location-resolution`;
const providerSignupDraftKey = `${storageKey}-provider-signup-draft`;
const providerLocationResolutionKey = `${storageKey}-provider-location-resolution`;
const providerDocumentsDraftKey = `${storageKey}-provider-documents-draft`;
const defaultPublicBackendOrigin = "https://awroadside-fire-backend.onrender.com";
const defaultDraftRetentionMs = 48 * 60 * 60 * 1000;
const providerUploadDraftRetentionMs = 12 * 60 * 60 * 1000;
const runtimeConfig = readRuntimeConfig();

const state = {
  frontendConfig: null,
  locationConfig: null,
  paymentConfig: null,
  compatibilityManifest: null,
  compatibilityAcknowledgement: null,
  eventSource: null,
  eventStreamConnected: false,
  eventRefreshTimer: null,
  eventBridgeAttached: false,
  pendingRequest: readStoredJson(pendingRequestKey),
  paypalScriptPromise: null,
  processingLog: readStoredArray(processingLogKey),
  requestHistory: readStoredArray(requestHistoryKey),
  paymentLedger: readStoredArray(paymentLedgerKey),
  providerActionQueue: readStoredArray(providerActionQueueKey),
  providerQueue: [],
  providerWorkflow: null,
  providerWallet: null,
  servicePaymentQuote: readStoredJson(servicePaymentQuoteKey),
  serviceQuoteAccepted: readStoredBoolean(serviceQuoteAcceptedKey, false),
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
  // --- PRIORITY 1: SHOW HOME SCREEN IMMEDIATELY ---
  switchScreen("home");

  try {
    applyPreviewVisibility();
    renderPublicPricing();
    setupNavigation();
    renderIdentity();
    renderAdminState();
    setupHomeAuth();
    setupPasswordResetPage();
    setupSubscriberModal();
    setupSubscriberProfilePanels();
    setupProviderSignup();
    setupProviderSignin();
    setupProviderDocumentsPanel();
    setupProviderPayoutTermsPanel();
    setupProviderWorkPanel();
    setupProviderWalletPanel();
    setupProviderPayoutDisputePanel();
    setupPaymentAgreement();
    setupRequestFeedbackPanel();
    setupAdminPanel();
    setupRequestForm();
    setupRequestActionPanels();
    renderProcessingCenter();
    renderCustomerRequestState();
    renderProviderActionQueue();
    renderProviderWallet();
    await loadFrontendConfig();
    await loadLocationConfig();
    startEventStream();
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

function startEventStream() {
  const index = frontendIndexRuntime();
  if (index && typeof index.startEventBridge === "function") {
    if (!state.eventBridgeAttached) {
      window.addEventListener("awroadside:server-event", handleIndexedServerEvent);
      window.addEventListener("awroadside:frontend-index-status", handleIndexedEventStreamStatus);
      state.eventBridgeAttached = true;
    }
    index.startEventBridge();
    return;
  }

  if (typeof window.EventSource !== "function") {
    return;
  }

  const url = eventStreamUrl();
  if (!url) {
    return;
  }

  if (state.eventSource) {
    try {
      state.eventSource.close();
    } catch {
      // Ignore close errors during reconnect.
    }
  }

  const stream = new EventSource(url);
  state.eventSource = stream;
  state.eventStreamConnected = false;

  stream.onopen = () => {
    if (!state.eventStreamConnected) {
      state.eventStreamConnected = true;
      recordProcessingEvent({
        action: "event-stream",
        route: url,
        method: "GET",
        status: "accepted",
        message: "Live update stream connected."
      });
    }
  };

  stream.onerror = () => {
    if (state.eventStreamConnected) {
      state.eventStreamConnected = false;
      recordProcessingEvent({
        action: "event-stream",
        route: url,
        method: "GET",
        status: "network-error",
        message: "Live update stream disconnected. Browser will retry automatically."
      });
    }
  };

  stream.addEventListener("users-updated", (event) => {
    queueEventDrivenRefresh("users-updated", event);
  });
  stream.addEventListener("requests-updated", (event) => {
    queueEventDrivenRefresh("requests-updated", event);
  });
  stream.addEventListener("payments-updated", (event) => {
    queueEventDrivenRefresh("payments-updated", event);
  });
}

function handleIndexedServerEvent(event) {
  const eventName = normalizeField(event?.detail?.event);
  if (!eventName) {
    return;
  }
  queueEventDrivenRefresh(eventName, event?.detail?.payload || null);
}

function handleIndexedEventStreamStatus(event) {
  const detail = event?.detail || {};
  const status = normalizeField(detail.status).toLowerCase();
  if (status === "connected" && !state.eventStreamConnected) {
    state.eventStreamConnected = true;
    recordProcessingEvent({
      action: "event-stream",
      route: detail.url || eventStreamUrl(),
      method: "GET",
      status: "accepted",
      message: "Live update stream connected."
    });
    return;
  }

  if (status === "disconnected" && state.eventStreamConnected) {
    state.eventStreamConnected = false;
    recordProcessingEvent({
      action: "event-stream",
      route: detail.url || eventStreamUrl(),
      method: "GET",
      status: "network-error",
      message: "Live update stream disconnected. Browser will retry automatically."
    });
  }
}

function queueEventDrivenRefresh(eventName, event) {
  if (state.eventRefreshTimer) {
    window.clearTimeout(state.eventRefreshTimer);
  }
  state.eventRefreshTimer = window.setTimeout(() => {
    state.eventRefreshTimer = null;
    void refreshFromServerEvent(eventName, event);
  }, 150);
}

async function refreshFromServerEvent(eventName) {
  recordProcessingEvent({
    action: "event-stream",
    route: eventName,
    method: "GET",
    status: "accepted",
    message: `Live update received for ${eventName}.`
  });

  try {
    await refreshPendingRequestFromServer();

    if (state.auth?.sessionToken) {
      await hydrateStoredSession(true);
      if (Array.isArray(state.auth?.roles) && state.auth.roles.includes("PROVIDER")) {
        await loadProviderQueue(false, true);
        if (state.providerWallet || document.getElementById("provider-wallet-ledger-list")) {
          await loadProviderWallet(false, true);
        }
      }
    }

    if (state.admin?.token) {
      await loadAdminDashboard(true);
    }
  } catch (error) {
    recordProcessingEvent({
      action: "event-stream",
      route: eventName,
      method: "GET",
      status: "error",
      message: error.message
    });
  }
}

async function refreshPendingRequestFromServer() {
  const activeRequestId = state.pendingRequest?.requestId || state.pendingRequest?.id || state.requestHistory[0]?.requestId || null;
  if (!activeRequestId) {
    return;
  }

  let liveRequest = null;
  if (Array.isArray(state.auth?.roles) && (state.auth.roles.includes("PROVIDER") || state.auth.roles.includes("ADMIN"))) {
    const payload = await fetchApiJsonWithFallback("/requests");
    liveRequest = (Array.isArray(payload.requests) ? payload.requests : []).find((entry) => {
      return String(entry.requestId || entry.id) === String(activeRequestId);
    });
  } else {
    const query = new URLSearchParams({
      requestId: String(activeRequestId)
    });
    if (!state.auth?.sessionToken && normalizeField(state.pendingRequest?.phoneNumber)) {
      query.set("phoneNumber", normalizeField(state.pendingRequest.phoneNumber));
    }
    const response = await apiFetch(`/request-status?${query.toString()}`, {
      headers: state.auth?.sessionToken ? jsonHeaders(true) : undefined
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Unable to refresh request status.");
    }
    liveRequest = payload.request || null;
  }

  if (!liveRequest) {
    return;
  }

  state.pendingRequest = {
    ...(state.pendingRequest || {}),
    ...liveRequest
  };
  persistPendingRequestState();
  state.requestHistory = state.requestHistory.map((entry) => {
    if (String(entry.requestId || entry.id) !== String(activeRequestId)) {
      return entry;
    }
    return {
      ...entry,
      status: liveRequest.status || entry.status,
      requestId: liveRequest.requestId || liveRequest.id || entry.requestId,
      serviceType: liveRequest.serviceType || entry.serviceType
    };
  });
  storeJson(requestHistoryKey, state.requestHistory);
  renderCustomerRequestState();
}

function setupHomeAuth() {
  const signInForm = document.getElementById("signin-form");
  if (signInForm) {
    signInForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const formData = new FormData(signInForm);
        const identifier = normalizeField(formData.get("identifier"));
        const password = normalizeField(formData.get("password"));
        const payload = await signInWithUserOrAdmin(identifier, password, "signin-status");
        if (payload?.adminAccess) {
          return;
        }
        navigateToScreen(resolvePostSignInScreen(payload));
        showBox("signin-status", buildPostSignInMessage(payload, "Signed in."));
      } catch (error) {
        showBox("signin-status", error.message);
      }
    });
  }

  wireModal("member-signup-open", "member-signup-close", "member-signup-modal");
  wireModal("provider-signup-open", "provider-signup-close", "provider-signup-modal");
}

function setupPasswordResetPage() {
  const requestForm = document.getElementById("password-reset-request-form");
  const resetForm = document.getElementById("password-reset-form");
  if (!requestForm && !resetForm) {
    return;
  }

  const query = new URLSearchParams(window.location.search);
  const tokenValue = normalizeField(query.get("token"));
  const emailValue = normalizeField(query.get("email"));
  const requestIdentifierInput = requestForm?.querySelector('input[name="identifier"]');
  const resetTokenInput = resetForm?.querySelector('input[name="token"]');
  const resetEmailInput = resetForm?.querySelector('input[name="email"]');

  if (requestIdentifierInput && emailValue && !normalizeField(requestIdentifierInput.value)) {
    requestIdentifierInput.value = emailValue;
  }
  if (resetTokenInput && tokenValue && !normalizeField(resetTokenInput.value)) {
    resetTokenInput.value = tokenValue;
  }
  if (resetEmailInput && emailValue && !normalizeField(resetEmailInput.value)) {
    resetEmailInput.value = emailValue;
  }

  if (requestForm) {
    requestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const formData = new FormData(requestForm);
        const identifier = normalizeField(formData.get("identifier"));
        const response = await apiFetch("/auth/password/forgot", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({
            identifier
          })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.message || payload.error || "Unable to prepare a password reset link.");
        }
        showBox("password-reset-request-status", payload.message || "If the account exists, a reset link has been sent.");
      } catch (error) {
        showBox("password-reset-request-status", error.message);
      }
    });
  }

  if (resetForm) {
    resetForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const formData = new FormData(resetForm);
        const token = normalizeField(formData.get("token"));
        const newPassword = normalizeField(formData.get("newPassword"));
        const confirmPassword = normalizeField(formData.get("confirmPassword"));
        const response = await apiFetch("/auth/password/reset", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({
            token,
            newPassword,
            confirmPassword
          })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.message || payload.error || "Unable to reset the password.");
        }
        resetForm.reset();
        if (resetEmailInput && emailValue) {
          resetEmailInput.value = emailValue;
        }
        showBox("password-reset-status", payload.message || "Password reset complete.");
      } catch (error) {
        showBox("password-reset-status", error.message);
      }
    });
  }
}

function resolvePostSignInScreen(payload) {
  const roles = Array.isArray(payload?.roles) ? payload.roles : [];
  if (roles.includes("PROVIDER")) {
    const providerStatus = normalizeField(payload?.providerStatus || state.auth?.providerStatus).toUpperCase();
    return providerStatus === "APPROVED" || providerStatus === "ACTIVE"
      ? "provider-work"
      : "provider";
  }
  if (roles.includes("SUBSCRIBER")) {
    return "subscriber-access";
  }
  return "customer";
}

function buildPostSignInMessage(payload, fallback = "Signed in.") {
  const roles = Array.isArray(payload?.roles) ? payload.roles : [];
  if (roles.includes("PROVIDER")) {
    const providerStatus = normalizeField(payload?.providerStatus || state.auth?.providerStatus).toUpperCase();
    if (providerStatus !== "APPROVED" && providerStatus !== "ACTIVE") {
      return "Provider sign-in accepted. Application review is still pending. Dispatch access starts after admin approval.";
    }
  }
  return fallback;
}

async function signInWithUserOrAdmin(identifier, password, statusId = "signin-status") {
  const response = await apiFetch("/auth/login", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      identifier,
      password
    })
  });
  const payload = await response.json();
  if (response.ok && payload.userId) {
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
    return payload;
  }

  const loginMessage = payload.message || payload.error || "Unable to sign in.";
  if (!/invalid credentials/i.test(loginMessage)) {
    throw new Error(loginMessage);
  }

  const adminPayload = await tryAdminFallbackLogin(identifier, password, statusId);
  if (adminPayload) {
    return adminPayload;
  }
  throw new Error(loginMessage);
}

async function tryAdminFallbackLogin(identifier, password, statusId) {
  const response = await adminFetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier,
      password
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    return null;
  }
  if (payload.twoFactorRequired) {
    state.admin = {
      token: null,
      locationZone: null,
      pendingTwoFactor: true,
      loginIdentifier: identifier
    };
    storeAdmin(state.admin);
    renderAdminState();
    navigateToScreen("admin");
    showBox(statusId, payload.message || "Admin 2FA is required on the admin access screen.");
    return {
      adminAccess: false,
      twoFactorRequired: true
    };
  }
  if (!payload.token) {
    return null;
  }

  state.admin = {
    token: payload.token,
    roles: payload.roles || [],
    trustedZone: payload.trustedZone || null,
    locationZone: null,
    twoFactorVerified: Boolean(payload.twoFactorVerified),
    pendingTwoFactor: false
  };
  storeAdmin(state.admin);
  renderAdminState();
  await loadAdminDashboard(true);
  navigateToScreen("admin-dashboard");
  showBox(statusId, "Admin access confirmed.");
  return {
    adminAccess: true,
    token: payload.token
  };
}

function setupSubscriberModal() {
  const form = document.getElementById("member-signup-form") || document.getElementById("subscriber-signup-form");
  if (!form) {
    return;
  }

  restoreFormDraft(form, subscriberSignupDraftKey);
  attachFormDraftPersistence(form, subscriberSignupDraftKey);
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
        confirmPassword: normalizeField(formData.get("confirmPassword")),
        paymentMethodMasked: buildSubscriberPaymentValue(formData),
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
          address: {
            line1: normalizeField(formData.get("addressLine")),
            line2: normalizeField(formData.get("addressLineTwo")),
            city: normalizeField(formData.get("city")),
            state: normalizeField(formData.get("stateRegion")),
            postalCode: normalizeField(formData.get("postalCode")),
            crossStreet: normalizeField(formData.get("crossStreet"))
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
      clearDraft(subscriberSignupDraftKey);
      form.reset();
      navigateToScreen("subscriber-access");
      showBox(statusId, `Membership activated. Confirmation details were prepared for ${normalizeField(formData.get("email")) || "the email on file"}.`);
      hideModal("member-signup-modal");
      hideModal("subscriber-modal");
    } catch (error) {
      showBox(statusId, error.message);
    }
  });
}

function setupSubscriberProfilePanels() {
  const profileForm = document.getElementById("subscriber-profile-form");
  if (profileForm) {
    restoreFormDraft(profileForm, subscriberProfileDraftKey);
    attachFormDraftPersistence(profileForm, subscriberProfileDraftKey);
    profileForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.auth?.sessionToken || !Array.isArray(state.auth?.roles) || !state.auth.roles.includes("SUBSCRIBER")) {
        showBox("subscriber-profile-status", "Sign in as a subscriber before updating the profile.");
        return;
      }
      try {
        const formData = new FormData(profileForm);
        const response = await apiFetch("/auth/subscriber/profile", {
          method: "POST",
          headers: jsonHeaders(true),
          body: JSON.stringify({
            fullName: normalizeField(formData.get("fullName")),
            phoneNumber: normalizeField(formData.get("phoneNumber")),
            email: normalizeField(formData.get("email")),
            vehicle: {
              year: normalizeField(formData.get("year")),
              make: normalizeField(formData.get("make")),
              model: normalizeField(formData.get("model")),
              color: normalizeField(formData.get("color"))
            },
            address: {
              line1: normalizeField(formData.get("addressLine")),
              line2: normalizeField(formData.get("addressLineTwo")),
              city: normalizeField(formData.get("city")),
              state: normalizeField(formData.get("stateRegion")),
              postalCode: normalizeField(formData.get("postalCode")),
              crossStreet: normalizeField(formData.get("crossStreet"))
            },
            paymentMethodMasked: normalizeField(formData.get("paymentMethodMasked")),
            paymentProvider: normalizeField(formData.get("paymentProvider")),
            billingZip: normalizeField(formData.get("billingZip"))
          })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.message || payload.error || "Unable to update subscriber profile.");
        }
        clearDraft(subscriberProfileDraftKey);
        await hydrateStoredSession(true);
        showBox("subscriber-profile-status", "Subscriber profile updated.");
      } catch (error) {
        showBox("subscriber-profile-status", error.message);
      }
    });
  }

  const requestForm = document.getElementById("subscriber-request-form");
  if (requestForm) {
    restoreFormDraft(requestForm, subscriberRequestDraftKey);
    attachFormDraftPersistence(requestForm, subscriberRequestDraftKey);
    const subscriberLocationResolver = createLocationResolutionBridge(requestForm, {
      fields: ["addressLine", "city", "stateRegion"],
      statusId: "subscriber-location-status",
      storageKey: subscriberRequestLocationResolutionKey,
      queryBuilder: () => buildLocationQuery([
        requestForm.elements.addressLine?.value,
        requestForm.elements.city?.value,
        requestForm.elements.stateRegion?.value
      ]),
      successPrefix: "Subscriber dispatch location verified",
      unavailableMessage: "Dispatch location lookup is offline. Subscriber request submission can still continue.",
      unresolvedMessage: "Dispatch could not verify this subscriber request location yet. Submission can still continue."
    });
    requestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.auth?.sessionToken || !Array.isArray(state.auth?.roles) || !state.auth.roles.includes("SUBSCRIBER")) {
        showBox("subscriber-request-status", "Sign in as a subscriber before submitting a subscriber request.");
        return;
      }
      try {
        if (!state.auth?.subscriberActive) {
          throw new Error("Subscriber membership must be active before using subscriber dispatch.");
        }
        const profile = state.auth?.profile || null;
        const subscriberProfile = profile?.subscriberProfile || {};
        const primaryAddress = subscriberProfile.primaryAddress || {};
        const vehicle = subscriberProfile.vehicle || {};
        const formData = new FormData(requestForm);
        const addressLine = normalizeField(formData.get("addressLine")) || normalizeField(primaryAddress.line1);
        const city = normalizeField(formData.get("city")) || normalizeField(primaryAddress.city);
        const stateRegion = normalizeField(formData.get("stateRegion")) || normalizeField(primaryAddress.state);
        const payload = {
          userId: state.auth.userId,
          roles: state.auth.roles || [],
          subscriberActive: Boolean(state.auth.subscriberActive),
          fullName: profile?.fullName || "",
          phoneNumber: profile?.phoneNumber || "",
          serviceType: normalizeField(formData.get("serviceType")),
          addressLine,
          city,
          stateRegion,
          location: [addressLine, city, stateRegion].filter(Boolean).join(", "),
          crossStreet: normalizeField(formData.get("crossStreet")) || normalizeField(primaryAddress.crossStreet),
          notes: normalizeField(formData.get("notes")),
          termsAccepted: true,
          noRefundPolicyAccepted: true,
          dispatchOnlyLiabilityAccepted: true,
          vehicleInfo: {
            year: normalizeField(vehicle.year),
            make: normalizeField(vehicle.make),
            model: normalizeField(vehicle.model),
            color: normalizeField(vehicle.color)
          },
          vehicleSummary: formatVehicleSummary(vehicle),
          assignedProviderId: ""
        };
        enforceRequestIdentityRules(payload);
        const resolvedPayload = await enrichRequestPayloadWithLocationResolution(payload, subscriberLocationResolver);
        const response = await apiFetch("/requests", {
          method: "POST",
          headers: jsonHeaders(true),
          body: JSON.stringify(resolvedPayload)
        });
        const result = await response.json();
        const requestId = result.requestId || result.id;
        if (!response.ok || !requestId) {
          throw new Error(result.message || result.error || "Unable to submit subscriber request.");
        }
        state.pendingRequest = { ...resolvedPayload, requestId, status: result.status || "SUBMITTED" };
        persistPendingRequestState();
        rememberRequest({
          requestId,
          serviceType: resolvedPayload.serviceType,
          status: result.status || "SUBMITTED",
          mode: "subscriber"
        });
        clearDraft(subscriberRequestDraftKey);
        showBox("subscriber-request-status", `Subscriber request submitted. Reference ${requestId}.`);
      } catch (error) {
        showBox("subscriber-request-status", error.message);
      }
    });
  }

  const passwordForm = document.getElementById("subscriber-password-form");
  if (passwordForm) {
    passwordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.auth?.sessionToken) {
        showBox("subscriber-password-status", "Sign in before changing the password.");
        return;
      }
      try {
        const formData = new FormData(passwordForm);
        validatePasswordConfirmation(formData.get("newPassword"), formData.get("confirmPassword"));
        const response = await apiFetch("/auth/password/change", {
          method: "POST",
          headers: jsonHeaders(true),
          body: JSON.stringify({
            currentPassword: normalizeField(formData.get("currentPassword")),
            newPassword: normalizeField(formData.get("newPassword")),
            confirmPassword: normalizeField(formData.get("confirmPassword"))
          })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.message || payload.error || "Unable to update the password.");
        }
        passwordForm.reset();
        showBox("subscriber-password-status", payload.message || "Password updated.");
      } catch (error) {
        showBox("subscriber-password-status", error.message);
      }
    });
  }

  const cancelButton = document.getElementById("subscriber-cancel-button");
  if (cancelButton) {
    cancelButton.addEventListener("click", async () => {
      if (!state.auth?.sessionToken || !Array.isArray(state.auth?.roles) || !state.auth.roles.includes("SUBSCRIBER")) {
        showBox("subscriber-cancel-status", "Sign in as a subscriber before cancelling membership.");
        return;
      }
      try {
        const response = await apiFetch("/auth/subscriber/cancel", {
          method: "POST",
          headers: jsonHeaders(true),
          body: JSON.stringify({
            reason: "Cancelled from subscriber profile screen."
          })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.message || payload.error || "Unable to cancel subscriber membership.");
        }
        await hydrateStoredSession(true);
        showBox("subscriber-cancel-status", "Subscriber membership cancelled.");
      } catch (error) {
        showBox("subscriber-cancel-status", error.message);
      }
    });
  }
}

function setupProviderSignup() {
  const form = document.getElementById("provider-signup-form");
  if (!form) {
    return;
  }

  restoreFormDraft(form, providerSignupDraftKey);
  attachFormDraftPersistence(form, providerSignupDraftKey);
  const providerLocationResolver = createLocationResolutionBridge(form, {
    fields: ["currentLocation"],
    statusId: "provider-location-status",
    storageKey: providerLocationResolutionKey,
    queryBuilder: () => buildLocationQuery([form.elements.currentLocation?.value]),
    successPrefix: "Provider base location verified",
    unavailableMessage: "Dispatch location lookup is offline. Provider application can still continue.",
    unresolvedMessage: "Dispatch could not verify the provider base location yet. Application can still continue."
  });
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
      const providerLocationMatch = await providerLocationResolver.resolve(true);

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
            taxIdLast4: normalizeField(formData.get("taxIdLast4")),
            payoutProvider: normalizeField(formData.get("payoutProvider")),
            payoutMethodMasked: normalizeField(formData.get("payoutMethodMasked"))
          },
          vehicleInfo: {
            year: normalizeField(formData.get("year")),
            make: normalizeField(formData.get("make")),
            model: normalizeField(formData.get("model")),
            color: normalizeField(formData.get("color"))
          },
          experience: normalizeField(formData.get("experience")),
          services: selectedServices,
          serviceArea: normalizeField(formData.get("serviceArea")),
          currentLocation: normalizeField(formData.get("currentLocation")),
          currentLocationCoordinates: providerLocationMatch
            ? {
                longitude: providerLocationMatch.longitude,
                latitude: providerLocationMatch.latitude
              }
            : null,
          currentLocationMapboxId: providerLocationMatch?.mapboxId || null,
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
      clearDraft(providerSignupDraftKey);
      form.reset();
      navigateToScreen("provider");
      showBox("provider-signup-status", "Provider account created. Application review is now in progress. Dispatch access starts only after admin approval.");
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
      const payload = await signInWithUserOrAdmin(
        normalizeField(formData.get("identifier")),
        normalizeField(formData.get("password")),
        "provider-signin-status"
      );
      if (payload?.adminAccess) {
        return;
      }
      navigateToScreen(resolvePostSignInScreen(payload));
      showBox("provider-signin-status", buildPostSignInMessage(payload, "Provider signed in."));
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

  restoreFormDraft(form, providerDocumentsDraftKey);
  attachFormDraftPersistence(form, providerDocumentsDraftKey, {
    ttlMs: providerUploadDraftRetentionMs,
    includeFileMetadata: true
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.auth?.sessionToken) {
      showBox("provider-documents-status", "Sign in as a provider before uploading documents.");
      return;
    }

    try {
      const formData = new FormData(form);
      const documents = {
        license: await buildProviderDocumentUpload(formData.get("license"), "license.txt"),
        insurance: await buildProviderDocumentUpload(formData.get("insurance"), "insurance.txt"),
        registration: await buildProviderDocumentUpload(formData.get("registration"), "registration.txt"),
        profilePhoto: await buildProviderDocumentUpload(formData.get("profilePhoto"), "profile-photo.jpeg"),
        proofOfAddress: await buildProviderDocumentUpload(formData.get("proofOfAddress"), "proof-of-address.jpeg"),
        helperId: await buildProviderDocumentUpload(formData.get("helperId"), "helper-id.txt")
      };
      const response = await apiFetch("/auth/provider/documents", {
        method: "POST",
        headers: jsonHeaders(true),
        body: JSON.stringify({
          documents
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.userId) {
        throw new Error(payload.message || payload.error || "Unable to upload provider documents.");
      }

      await hydrateStoredSession();
      clearDraft(providerDocumentsDraftKey);
      form.reset();
      showBox("provider-documents-status", "Provider documents were saved for verification review.");
    } catch (error) {
      showBox("provider-documents-status", error.message);
    }
  });
}

function setupProviderPayoutTermsPanel() {
  const form = document.getElementById("provider-payout-terms-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.auth?.sessionToken || !Array.isArray(state.auth?.roles) || !state.auth.roles.includes("PROVIDER")) {
      showBox("provider-payout-terms-form-status", "Sign in as a provider before accepting payout terms.");
      return;
    }

    try {
      const formData = new FormData(form);
      const response = await apiFetch("/auth/provider/payout-terms", {
        method: "POST",
        headers: jsonHeaders(true),
        body: JSON.stringify({
          providerPayoutTermsAccepted: formData.get("providerPayoutTermsAccepted") === "on",
          providerPayoutDisputeWindowAccepted: formData.get("providerPayoutDisputeWindowAccepted") === "on",
          providerPayoutNoPostReceiptDisputeAccepted: formData.get("providerPayoutNoPostReceiptDisputeAccepted") === "on"
        })
      });
      const payload = await response.json();
      if (!response.ok || payload.payoutTermsAccepted !== true) {
        throw new Error(payload.message || payload.error || "Unable to save provider payout terms.");
      }

      await hydrateStoredSession();
      showBox("provider-payout-terms-form-status", "Provider payout terms recorded. Safe mode payout is removed for eligible releases.");
    } catch (error) {
      showBox("provider-payout-terms-form-status", error.message);
    }
  });
}

function setupRequestForm() {
  const form = document.getElementById("request-form");
  if (!form) {
    return;
  }

  restoreFormDraft(form, requestDraftKey);
  attachFormDraftPersistence(form, requestDraftKey);
  const requestLocationResolver = createLocationResolutionBridge(form, {
    fields: ["addressLine", "city", "stateRegion"],
    statusId: "request-location-status",
    storageKey: requestLocationResolutionKey,
    queryBuilder: () => buildLocationQuery([
      form.elements.addressLine?.value,
      form.elements.city?.value,
      form.elements.stateRegion?.value
    ]),
    successPrefix: "Dispatch location verified",
    unavailableMessage: "Dispatch location lookup is offline. Request submission can still continue.",
    unresolvedMessage: "Dispatch could not verify this request location yet. Submission can still continue."
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      state.pendingRequest = collectRequestFormData(form);
      persistPendingRequestState();
      enforceRequestIdentityRules(state.pendingRequest);
      state.pendingRequest = await enrichRequestPayloadWithLocationResolution(state.pendingRequest, requestLocationResolver);
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
      persistPendingRequestState();
      recordRequestHistory({
        requestId,
        serviceType: state.pendingRequest.serviceType,
        location: state.pendingRequest.location,
        fullName: state.pendingRequest.fullName,
        phoneNumber: state.pendingRequest.phoneNumber,
        mode: state.auth?.userId ? "signed-in" : "guest",
        status: payload.status || "submitted"
      });
      clearDraft(requestDraftKey);
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

function setupRequestActionPanels() {
  ["customer-request-actions", "subscriber-request-actions"].forEach((containerId) => {
    const container = document.getElementById(containerId);
    if (!container) {
      return;
    }
    container.addEventListener("click", (event) => {
      const button = event.target.closest("[data-customer-request-action]");
      if (!button) {
        return;
      }
      event.preventDefault();
      const action = button.getAttribute("data-customer-request-action");
      const surface = button.getAttribute("data-request-surface");
      if (!action || !surface) {
        return;
      }
      handleCustomerRequestAction(surface, action).catch((error) => {
        showBox(`${surface}-request-action-status`, error.message);
      });
    });
  });
}

async function handleCustomerRequestAction(surface, action) {
  const request = state.pendingRequest || state.requestHistory[0] || null;
  const requestId = request?.requestId || request?.id || null;
  if (!requestId) {
    showBox(`${surface}-request-action-status`, "Submit or reopen a request before using request actions.");
    return;
  }
  if (!requestBelongsToSignedInSubscriber(request)) {
    showBox(`${surface}-request-action-status`, "Sign in as the subscriber who placed this request before using request actions.");
    return;
  }

  const payload = {
    userId: state.auth?.userId,
    actorRole: "SUBSCRIBER"
  };

  if (action === "request-service-change") {
    const requestedServiceType = normalizeField(document.getElementById(`${surface}-request-change-service-type`)?.value);
    if (!requestedServiceType) {
      showBox(`${surface}-request-action-status`, "Choose the replacement service type before sending the review request.");
      return;
    }
    payload.serviceType = requestedServiceType;
    payload.note = normalizeField(document.getElementById(`${surface}-request-change-note`)?.value);
  } else if (action === "cancel-service") {
    payload.cancelReason = normalizeField(document.getElementById(`${surface}-request-cancel-reason`)?.value);
    if (isPaymentCaptured(request)) {
      payload.accountPassword = normalizeField(document.getElementById(`${surface}-request-cancel-password`)?.value);
      payload.noRefundAcknowledged = document.getElementById(`${surface}-request-no-refund`)?.checked === true;
    }
  } else {
    return;
  }

  const response = await apiFetch(`/requests/${encodeURIComponent(requestId)}/${action}`, {
    method: "POST",
    headers: jsonHeaders(true),
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || result.error || "Unable to record the request action.");
  }

  const updatedRequest = result.request && typeof result.request === "object" ? result.request : null;
  if (updatedRequest) {
    syncRequestStateFromUpdate(updatedRequest);
  }

  if (action === "cancel-service") {
    const passwordField = document.getElementById(`${surface}-request-cancel-password`);
    const acknowledgeField = document.getElementById(`${surface}-request-no-refund`);
    if (passwordField) {
      passwordField.value = "";
    }
    if (acknowledgeField) {
      acknowledgeField.checked = false;
    }
  }

  showBox(
    `${surface}-request-action-status`,
    result.message ||
      (action === "cancel-service"
        ? `Request ${requestId} was cancelled.`
        : `Service change review sent for request ${requestId}.`)
  );
}

async function loadFrontendConfig() {
  try {
    const configPayload = runtimeConfig.frontendConfig || null;
    const bootstrapOrigins = getBootstrapOrigins();
    const [health, config, manifest] = await Promise.all([
      fetchBootstrapJson(dedupeUrls([
        runtimeConfig.bootstrapHealthUrl,
        `${window.location.origin}/api/aw-roadside/health`,
        `${window.location.origin}/api/health`,
        ...bootstrapOrigins.map((origin) => `${origin}/api/aw-roadside/health`),
        ...bootstrapOrigins.map((origin) => `${origin}/api/health`)
      ])),
      configPayload || fetchBootstrapJson(dedupeUrls([
        runtimeConfig.bootstrapFrontendConfigUrl,
        `${window.location.origin}/api/aw-roadside/frontend-config`,
        `${window.location.origin}/api/frontend-config`,
        ...bootstrapOrigins.map((origin) => `${origin}/api/aw-roadside/frontend-config`),
        ...bootstrapOrigins.map((origin) => `${origin}/api/frontend-config`)
      ])),
      fetchBootstrapJson(dedupeUrls([
        runtimeConfig.bootstrapManifestUrl,
        `${window.location.origin}/api/compat/manifest`,
        ...bootstrapOrigins.map((origin) => `${origin}/api/compat/manifest`)
      ]))
    ]);
    const resolvedConfig = config && typeof config === "object" ? config : {};
    state.frontendConfig = {
      ...resolvedConfig,
      apiBaseUrl: resolveApiBaseUrl(resolvedConfig.apiBaseUrl || runtimeConfig.apiBaseUrl),
      rawApiBaseUrl: resolveRawApiBaseUrl(resolvedConfig.rawApiBaseUrl || runtimeConfig.rawApiBaseUrl),
      uiBaseUrl: resolveUiBaseUrl(resolvedConfig.uiBaseUrl || runtimeConfig.uiBaseUrl),
      adminApiBaseUrl: resolveAdminApiBaseUrl(resolvedConfig.adminApiBaseUrl || runtimeConfig.adminApiBaseUrl),
      eventStreamUrl: resolveEventStreamUrl(resolvedConfig.eventStreamUrl || runtimeConfig.eventStreamUrl)
    };
    const index = frontendIndexRuntime();
    if (index && typeof index.updateConfig === "function") {
      index.updateConfig(state.frontendConfig);
    }
    state.compatibilityManifest = manifest?.manifest || null;
    applyPreviewVisibility();
    renderPublicPricing(resolvedConfig);

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
        projectId: "awroadside-fire",
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
        persistPendingRequestState();
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
      const receiptMessage = normalizeField(payload.paymentReceipt?.message);
      showBox(
        "submit-status",
        `Priority payment captured for request ${state.pendingRequest.requestId || "pending"}.${receiptMessage ? ` ${receiptMessage}` : ""}`
      );
      setText(
        "paypal-status",
        `Captured with status ${payload.status}.${receiptMessage ? ` ${receiptMessage}` : ""}`
      );
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
      persistServiceQuoteState();
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
        persistPendingRequestState();
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
    persistServiceQuoteState();
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
    persistServiceQuoteState();
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

async function hydrateStoredSession(silent = false) {
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
      await loadProviderWallet(false, silent);
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
            identifier: normalizeField(formData.get("identifier") || formData.get("email")),
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

async function loadAdminDashboard(silent = false) {
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
    
    try {
      const auditResponse = await apiFetch("/admin/audit-log", {
        method: "GET",
        headers: jsonHeaders(true)
      });
      const auditPayload = await auditResponse.json();
      if (auditResponse.ok && Array.isArray(auditPayload.auditLog)) {
        state.adminDashboard.paymentEvents = auditPayload.auditLog;
      }
    } catch (auditError) {
      console.warn("Failed to load extended audit log:", auditError.message);
    }

    setText("admin-email", payload.adminEmail || "Unknown");
    setText("admin-roles", (payload.roles || []).join(", ") || "None");
    setText("admin-request-count", String(payload.requestCount ?? 0));
    setText("admin-payment-configured", payload.paymentConfigured ? "Configured" : "Not Ready");
    setText("admin-active-subscribers", String(payload.stats?.activeSubscribers ?? 0));
    setText("admin-pending-providers", String(payload.stats?.pendingProviders ?? 0));
    setText("admin-provider-approval-alerts", String(payload.stats?.providerApprovalAlerts ?? 0));
    setText("admin-overdue-subscribers", String(payload.stats?.overdueSubscriptions ?? 0));
    setText("admin-payouts-pending", String(payload.stats?.payoutsPending ?? 0));
    setText("admin-training-scheduled", String(payload.stats?.trainingScheduled ?? 0));
    setText("admin-status-label", "Signed in");
    setText("admin-status-badge", payload.trustedZone || "Active");
    setText("admin-status-text", `Location zone: ${payload.locationZone || "not set"}.`);
    renderAdminCollections();
    renderAdminDirectory();
  } catch (error) {
    if (!silent) {
      showBox("admin-login-status", error.message);
    }
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
  } else if (action === "reassign-request") {
    const providerUserId = window.prompt("Replacement provider user id", "");
    if (!providerUserId) {
      return;
    }
    const customerFault = window.confirm("Is the customer at fault for the reassignment?");
    const secondChargeRequired = customerFault && window.confirm("Should the customer be charged a second time?");
    const newRequestRequired = customerFault && !secondChargeRequired && window.confirm("Should the customer be required to create a new request?");
    const transferPayoutInternally = !customerFault && window.confirm("Transfer the internal provider payout allocation to the replacement provider?");
    path = `/requests/${encodeURIComponent(requestId)}/reassign`;
    body = {
      providerUserId: Number(providerUserId),
      customerFault,
      secondChargeRequired,
      newRequestRequired,
      transferPayoutInternally,
      reversePaymentInternally: transferPayoutInternally,
      payOrderRequired: transferPayoutInternally,
      reason: window.prompt("Reassignment reason", customerFault ? "Customer fault reassignment" : "Provider reassignment without customer fault") || "Admin reassignment",
      note: window.prompt("Detailed reassignment note", "Manual reassignment detail") || "Manual reassignment detail"
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
  } else if (action === "cancel-service") {
    path = `/requests/${encodeURIComponent(requestId)}/force-action`;
    body = {
      action,
      note: window.prompt("Cancel reason", "Manual admin cancellation") || "Manual admin cancellation"
    };
  } else if (action === "approve-service-change" || action === "deny-service-change") {
    path = `/requests/${encodeURIComponent(requestId)}/force-action`;
    body = {
      action,
      note: window.prompt(
        "Review note",
        action === "approve-service-change" ? "Manual admin approval of service type change" : "Manual admin denial of service type change"
      ) || `Manual ${action}`
    };
  } else if (["force-accept", "force-arrived", "force-complete", "prompt-payment", "note"].includes(action)) {
    path = `/requests/${encodeURIComponent(requestId)}/force-action`;
    body = {
      action,
      note: action === "note"
        ? window.prompt("Support note", "Manual admin note") || "Manual admin note"
        : window.prompt("Admin action note", `Manual ${action}`) || `Manual ${action}`
    };
  } else {
    return;
  }

  try {
    const result = await commitToBackend("admin-action", {
      manualSubmission: true,
      needsPersistence: true,
      kind: "admin-action",
      path,
      method: "POST",
      body
    });
    const payload = result?.payload || {};
    showBox("admin-action-status", payload.message || "Admin action completed.");
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
  const approveButton = provider.providerStatus === "PENDING_APPROVAL" && provider.approvalEligibility?.canApprove
    ? `<button class="glow-button compact" type="button" data-admin-action="approve-provider" data-user-id="${escapeHtml(provider.id)}">Approve Provider</button>`
    : "";
  const trainingStatus = provider.discipline?.training?.status || "NOT_REQUIRED";
  const approvalAlert = provider.approvalAlert || null;
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
      <p class="muted">Review: ${escapeHtml(prettifyToken(provider.profileSubmissionStatus || "pending_approval"))} · Approval ready: ${provider.approvalEligibility?.canApprove ? "Yes" : "No"}</p>
      ${approvalAlert ? `<p class="muted admin-alert-text">Approval alert: ${escapeHtml(approvalAlert.message)} Deadline ${escapeHtml(formatTimestamp(approvalAlert.reviewDeadlineAt))}.</p>` : ""}
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
  const providerApproveButton = provider?.providerStatus === "PENDING_APPROVAL" && provider?.approvalEligibility?.canApprove
    ? `<button class="glow-button compact" type="button" data-admin-action="approve-provider" data-user-id="${escapeHtml(user.id)}">Approve Provider</button>`
    : "";
  const trainingButton = provider?.discipline?.currentSuspension?.indefinite
    ? `<button class="glow-button alt compact" type="button" data-admin-action="schedule-training" data-user-id="${escapeHtml(user.id)}">Schedule Training</button>`
    : provider?.discipline?.training?.status === "SCHEDULED" || provider?.discipline?.training?.status === "ENROLLED"
      ? `<button class="glow-button alt compact" type="button" data-admin-action="complete-training" data-user-id="${escapeHtml(user.id)}">Mark Training Complete</button>`
      : "";
  const supportLinks = buildAdminSupportLinks(profile);

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
      ${subscriber ? `<p class="muted">Primary address: ${escapeHtml(formatSubscriberAddress(subscriber.primaryAddress))} · Payment: ${escapeHtml(subscriber.paymentInfo?.paymentMethodMasked || "Not stored")}</p>` : ""}
      ${provider ? `<p class="muted">Provider status: ${escapeHtml(labelUiStatus("providerStatus", provider.providerStatus || "DRAFT"))} · Service area: ${escapeHtml(provider.serviceArea || "Not set")} · Services: ${escapeHtml((provider.services || []).map(labelServiceType).join(", ") || "Not set")}</p>` : ""}
      ${provider ? `<p class="muted">Review status: ${escapeHtml(prettifyToken(provider.profileSubmissionStatus || "pending_approval"))} · Approval ready: ${provider.approvalEligibility?.canApprove ? "Yes" : "No"} · Missing: ${escapeHtml((provider.approvalEligibility?.missingRequirements || []).map(prettifyToken).join(", ") || "None")}</p>` : ""}
      ${provider?.approvalAlert ? `<p class="muted admin-alert-text">Approval alert: ${escapeHtml(provider.approvalAlert.message)} Deadline ${escapeHtml(formatTimestamp(provider.approvalAlert.reviewDeadlineAt))}.</p>` : ""}
      ${provider ? `<p class="muted">Hours configured: ${provider.hoursOfService?.hasHours ? "Yes" : "No"} · Documents ready: ${provider.documentStatus?.meetsMinimumRequirements ? "Yes" : "No"} · Payout method: ${escapeHtml(provider.providerInfo?.payoutMethodMasked || "Not set")}</p>` : ""}
      ${provider ? `<p class="muted">Rating: ${escapeHtml(formatRating(provider.rating))} · Strikes: ${escapeHtml(String(provider.discipline?.strikeCount || 0))} · Training: ${escapeHtml(prettifyToken(provider.discipline?.training?.status || "NOT_REQUIRED"))} · Suspension: ${escapeHtml(formatSuspensionSummary(provider.discipline?.currentSuspension))}</p>` : ""}
      ${supportLinks}
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
      ${providerRequests.length ? providerRequests.map((entry) => `<div class="muted">${escapeHtml(entry.requestId)} · ${escapeHtml(entry.fullName || "Customer")} · ${escapeHtml(labelUiStatus("requestStatus", entry.status || "UNKNOWN"))} · ${escapeHtml(formatTimestamp(entry.submittedAt))}${entry.lastReassignmentSummary ? ` · ${escapeHtml(entry.lastReassignmentSummary)}` : ""}</div>`).join("") : '<div class="muted">No recent provider assignments.</div>'}
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

function buildAdminSupportLinks(profile) {
  const user = profile.user || {};
  const supportSummary = profile.supportSummary || {};
  const links = [];
  const uiBase = resolveUiBaseUrl(state.frontendConfig?.uiBaseUrl || runtimeConfig.uiBaseUrl);
  if (Array.isArray(user.roles) && user.roles.includes("SUBSCRIBER")) {
    links.push(`<a class="legacy-link" href="${escapeHtml(`${uiBase}/subscriber-access.html?supportUser=${encodeURIComponent(user.id)}`)}">Open Subscriber Profile Route</a>`);
  }
  if (Array.isArray(user.roles) && user.roles.includes("PROVIDER")) {
    links.push(`<a class="legacy-link" href="${escapeHtml(`${uiBase}/provider-info.html?supportUser=${encodeURIComponent(user.id)}`)}">Open Provider Profile Route</a>`);
  }
  if (supportSummary.latestCustomerRequestId) {
    links.push(`<a class="legacy-link" href="${escapeHtml(`${uiBase}/customer.html?supportRequest=${encodeURIComponent(supportSummary.latestCustomerRequestId)}`)}">Open Latest Customer Request Route</a>`);
  }
  if (supportSummary.latestProviderRequestId) {
    links.push(`<a class="legacy-link" href="${escapeHtml(`${uiBase}/provider-work.html?supportRequest=${encodeURIComponent(supportSummary.latestProviderRequestId)}`)}">Open Latest Provider Dispatch Route</a>`);
  }

  const supportCode = [user.id, supportSummary.latestCustomerRequestId || supportSummary.latestProviderRequestId || "route"].filter(Boolean).join("-");
  const shortcode = supportCode ? `<div class="muted">Support shortcode: ${escapeHtml(`AW-${supportCode}`)}</div>` : "";
  return links.length || shortcode ? `<div class="admin-support-links">${links.join("")}${shortcode}</div>` : "";
}

function formatSubscriberAddress(address) {
  if (!address || typeof address !== "object") {
    return "Not stored";
  }
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode
  ].map((value) => normalizeField(value)).filter(Boolean);
  if (address.crossStreet) {
    parts.push(`Cross street ${normalizeField(address.crossStreet)}`);
  }
  return parts.join(", ") || "Not stored";
}

function renderServiceHistoryItem(entry) {
  const closedRequest = isRequestClosed(entry);
  const serviceChangeSummary = buildServiceChangeSummary(entry, { includeReviewedOutcome: true });
  const pendingServiceChange = readPendingServiceTypeChange(entry);
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
        <span>Reassignments: ${escapeHtml(String(entry.reassignmentCount || 0))}</span>
        <span>Rating: ${escapeHtml(entry.customerRating ? `${entry.customerRating}/8` : "None")}</span>
        <span>Notes: ${escapeHtml(String(entry.noteCount || 0))}</span>
      </div>
      <p class="muted">Refund flag: ${entry.refundFlag ? "Yes" : "No"} · Dispute flag: ${entry.disputeFlag ? "Yes" : "No"} · Requested: ${escapeHtml(formatTimestamp(entry.requestDate))}</p>
      ${entry.lastReassignmentSummary ? `<p class="muted">${escapeHtml(entry.lastReassignmentSummary)}</p>` : ""}
      ${serviceChangeSummary ? `<p class="muted">${escapeHtml(serviceChangeSummary)}</p>` : ""}
      <div class="button-pair">
        <button class="glow-button alt compact" type="button" data-admin-action="reset-request" data-request-id="${escapeHtml(entry.requestId)}">Reset Request</button>
        <button class="glow-button compact" type="button" data-admin-action="reassign-request" data-request-id="${escapeHtml(entry.requestId)}">Reassign Provider</button>
        <button class="glow-button compact" type="button" data-admin-action="force-accept" data-request-id="${escapeHtml(entry.requestId)}">Force Accept</button>
        <button class="glow-button compact" type="button" data-admin-action="force-arrived" data-request-id="${escapeHtml(entry.requestId)}">Force Arrived</button>
        <button class="glow-button compact" type="button" data-admin-action="force-complete" data-request-id="${escapeHtml(entry.requestId)}">Force Complete</button>
        <button class="glow-button alt compact" type="button" data-admin-action="prompt-payment" data-request-id="${escapeHtml(entry.requestId)}">Prompt Payment</button>
        ${closedRequest ? "" : `<button class="glow-button danger compact" type="button" data-admin-action="cancel-service" data-request-id="${escapeHtml(entry.requestId)}">Cancel Service</button>`}
        ${pendingServiceChange ? `<button class="glow-button compact" type="button" data-admin-action="approve-service-change" data-request-id="${escapeHtml(entry.requestId)}">Approve Service Change</button>` : ""}
        ${pendingServiceChange ? `<button class="glow-button alt compact" type="button" data-admin-action="deny-service-change" data-request-id="${escapeHtml(entry.requestId)}">Deny Service Change</button>` : ""}
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
      await loadProviderQueue(true);
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
  if (refreshButton) {
    refreshButton.addEventListener("click", async () => {
      await loadProviderWallet(true);
    });
  }

  const connectButton = document.getElementById("provider-wallet-paypal-connect");
  if (connectButton) {
    connectButton.addEventListener("click", async () => {
      const email = prompt("Enter your PayPal email address for payouts:");
      if (!email) return;
      
      try {
        const response = await apiFetch("/providers/paypal-connect", {
          method: "POST",
          headers: jsonHeaders(true),
          body: JSON.stringify({
            providerId: state.auth.id,
            paypalEmail: email
          })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "Failed to connect PayPal.");
        
        showBox("provider-wallet-status", "PayPal account linked successfully.");
        await loadProviderWallet(true, true);
      } catch (error) {
        showBox("provider-wallet-status", error.message);
      }
    });
  }
}

function setupProviderPayoutDisputePanel() {
  const form = document.getElementById("provider-payout-dispute-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.auth?.sessionToken || !Array.isArray(state.auth?.roles) || !state.auth.roles.includes("PROVIDER")) {
      showBox("provider-payout-dispute-status", "Sign in as a provider before submitting a payout dispute.");
      return;
    }

    try {
      const formData = new FormData(form);
      const response = await apiFetch("/provider/payout-dispute", {
        method: "POST",
        headers: jsonHeaders(true),
        body: JSON.stringify({
          requestId: normalizeField(formData.get("requestId")),
          reason: normalizeField(formData.get("reason"))
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.requestId) {
        throw new Error(payload.message || payload.error || "Unable to submit payout dispute.");
      }

      showBox("provider-payout-dispute-status", `Payout dispute recorded for ${payload.requestId}. Payout is now on hold.`);
      form.reset();
      await loadProviderWallet(false, true);
      await loadProviderQueue(false, true);
    } catch (error) {
      showBox("provider-payout-dispute-status", error.message);
    }
  });
}

async function loadProviderQueue(manualRefresh = false, silent = false) {
  if (!state.auth?.sessionToken) {
    if (manualRefresh && !silent) {
      showBox("provider-work-status", "Sign in as a provider before loading the work queue.");
    }
    state.providerWorkflow = null;
    recordProcessingEvent({
      action: "provider-queue",
      route: "/requests",
      status: "blocked",
      message: "Provider queue requires a session token."
    });
    return;
  }

  try {
    let route = "/provider/workflow";
    let payload = null;
    try {
      const workflowResponse = await apiFetch("/provider/workflow", {
        method: "GET",
        headers: jsonHeaders(true)
      });
      const workflowPayload = await workflowResponse.json();
      if (!workflowResponse.ok) {
        throw new Error(workflowPayload.message || workflowPayload.error || "Unable to load provider workflow.");
      }
      payload = workflowPayload;
      state.providerWorkflow = payload;
      state.providerQueue = Array.isArray(payload.queue?.all) ? payload.queue.all : [];
    } catch {
      route = "/requests";
      payload = await fetchApiJsonWithFallback("/requests", [], {
        headers: jsonHeaders(true)
      });
      state.providerWorkflow = null;
      state.providerQueue = Array.isArray(payload.requests) ? payload.requests : [];
    }
    recordProcessingEvent({
      action: "provider-queue",
      route,
      status: "accepted",
      message: `${state.providerQueue.length} request(s) loaded.`
    });
    if (!silent) {
      showBox("provider-work-status", `Loaded ${state.providerQueue.length} request(s).`);
    }
    renderProviderWorkList();
  } catch (error) {
    if (!silent) {
      showBox("provider-work-status", error.message);
    }
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

  renderProviderWorkflowSummary();

  if (!state.providerQueue.length) {
    container.innerHTML = '<div class="item"><div class="value">No provider queue loaded.</div><div class="muted">Sign in as a provider, then load the queue.</div></div>';
    renderProviderWorkLog();
    return;
  }

  container.innerHTML = state.providerQueue
    .map((request) => {
      const requestId = request.requestId || request.id || "unknown";
      const etaSeed = Number.isFinite(Number(request.softEtaMinutes))
        ? Number(request.softEtaMinutes)
        : Number.isFinite(Number(request.hardEtaMinutes))
          ? Number(request.hardEtaMinutes)
          : "";
      const vehicleSummary = request.vehicleSummary || formatVehicleSummary(request.vehicleInfo || {});
      const gpsSummary = formatRequestGpsSummary(request);
      const serviceChangeSummary = buildServiceChangeSummary(request, { includeReviewedOutcome: true });
      return `<div class="provider-work-card">
        <div>
          <div class="value">${escapeHtml(labelServiceType(request.serviceType || "Service"))} · ${escapeHtml(request.fullName || "Customer")}</div>
          <div class="muted">${escapeHtml(request.location || "Location not provided")}</div>
          <div class="muted">Vehicle: ${escapeHtml(vehicleSummary)}</div>
          <div class="muted">${escapeHtml(gpsSummary)}</div>
          <div class="muted">Status: ${escapeHtml(labelUiStatus("requestStatus", request.status || "UNKNOWN"))} · Reference ${escapeHtml(requestId)}</div>
          ${serviceChangeSummary ? `<div class="muted">${escapeHtml(serviceChangeSummary)}</div>` : ""}
          <div class="muted">ETA stage: ${escapeHtml(prettifyToken(request.etaStage || "pending"))} · Soft ETA: ${escapeHtml(String(request.softEtaMinutes ?? "Not set"))} · Hard ETA: ${escapeHtml(String(request.hardEtaMinutes ?? "Locked"))}</div>
          <div class="muted">Location access: ${escapeHtml(prettifyToken(request.locationDisclosureLevel || "masked"))} · Contact access: ${escapeHtml(prettifyToken(request.contactDisclosureLevel || "locked"))}</div>
          <div class="muted">Customer callback: ${escapeHtml(request.customerCallbackNumber || "Locked until payment and provider activation")}</div>
          <div class="provider-work-meta-grid">
            <div class="item"><div class="value">Payment</div><div class="muted">${escapeHtml(labelUiStatus("paymentStatus", request.paymentStatus || "NOT_PAID"))}</div></div>
            <div class="item"><div class="value">Release</div><div class="muted">${escapeHtml(request.directCommunicationEnabled ? "Hard ETA / contact unlocked" : "Soft ETA only")}</div></div>
            <div class="item"><div class="value">Provider payout</div><div class="muted">${escapeHtml(prettifyToken(request.providerPayoutStatus || "unassigned"))}</div></div>
          </div>
          <label class="provider-eta-field">
            <span class="muted">ETA minutes</span>
            <input class="field" id="provider-eta-${escapeHtml(requestId)}" type="number" min="1" step="1" value="${escapeHtml(String(etaSeed))}" placeholder="18"/>
          </label>
          <div class="muted">Do not request direct payment. Payment stays platform-controlled until dispatch releases the approved service payment step.</div>
          <label class="provider-note-field">
            <span class="muted">Dispatch note</span>
            <textarea class="field area" id="provider-note-${escapeHtml(requestId)}" placeholder="Short dispatch-safe note for this request">${escapeHtml(readProviderDraftNote(requestId))}</textarea>
          </label>
          ${renderProviderNoteExchange(request.noteExchange)}
        </div>
        <div class="provider-action-grid">
          ${renderProviderActionButtons(request)}
        </div>
      </div>`;
    })
    .join("");

  renderProviderWorkLog();
}

function renderProviderActionButton(requestId, action, label) {
  return `<button class="glow-button compact" type="button" data-provider-action="${escapeHtml(action)}" data-request-id="${escapeHtml(requestId)}">${escapeHtml(label)}</button>`;
}

function renderProviderActionButtons(request) {
  const requestId = request.requestId || request.id || "unknown";
  const status = normalizeField(request.status).toUpperCase();
  const buttons = [];
  const pendingServiceChange = readPendingServiceTypeChange(request);

  if (status === "SUBMITTED") {
    buttons.push(renderProviderActionButton(requestId, "accept", "Accept"));
    buttons.push(renderProviderActionButton(requestId, "note", "Log Note"));
    return buttons.join("");
  }
  if (["ASSIGNED", "EN_ROUTE", "PAUSED"].includes(status)) {
    buttons.push(renderProviderActionButton(requestId, "soft-eta", "Soft ETA"));
    buttons.push(renderProviderActionButton(requestId, "hard-eta", "Hard ETA"));
    buttons.push(renderProviderActionButton(requestId, "enroute", "En Route"));
    buttons.push(renderProviderActionButton(requestId, "paused", "Pause"));
    buttons.push(renderProviderActionButton(requestId, "extend-eta", "Extend ETA"));
  }
  if (["ASSIGNED", "EN_ROUTE", "PAUSED", "ARRIVED"].includes(status)) {
    buttons.push(renderProviderActionButton(requestId, "arrived", "Arrived"));
    buttons.push(renderProviderActionButton(requestId, "completed", "Complete"));
  }
  if (pendingServiceChange && ["ASSIGNED", "EN_ROUTE", "PAUSED", "ARRIVED"].includes(status)) {
    buttons.push(renderProviderActionButton(requestId, "approve-service-change", "Approve Service Change"));
    buttons.push(renderProviderActionButton(requestId, "deny-service-change", "Deny Service Change"));
  }
  buttons.push(renderProviderActionButton(requestId, "note", "Log Note"));
  return buttons.join("");
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
    await loadProviderQueue(false, true);
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

function rememberRequest(entry) {
  if (entry) {
    recordRequestHistory(entry);
  }
  persistPendingRequestState();
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

function persistPendingRequestState() {
  storeJson(pendingRequestKey, state.pendingRequest || null);
}

function persistServiceQuoteState() {
  storeJson(servicePaymentQuoteKey, state.servicePaymentQuote || null);
  storeJson(serviceQuoteAcceptedKey, Boolean(state.serviceQuoteAccepted));
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

function syncRequestStateFromUpdate(request) {
  if (!request || typeof request !== "object") {
    return;
  }

  const requestId = request.requestId || request.id || null;
  state.pendingRequest = {
    ...(state.pendingRequest || {}),
    ...request
  };
  persistPendingRequestState();

  if (requestId) {
    let matched = false;
    state.requestHistory = state.requestHistory.map((entry) => {
      if (String(entry.requestId || entry.id) !== String(requestId)) {
        return entry;
      }
      matched = true;
      return {
        ...entry,
        requestId,
        serviceType: request.serviceType || entry.serviceType,
        status: request.status || entry.status,
        timestamp: new Date().toISOString()
      };
    });
    if (!matched) {
      state.requestHistory = [{
        requestId,
        serviceType: request.serviceType || "",
        status: request.status || "",
        mode: Array.isArray(state.auth?.roles) && state.auth.roles.includes("SUBSCRIBER") ? "subscriber" : "signed-in",
        timestamp: new Date().toISOString()
      }, ...state.requestHistory].slice(0, 30);
    }
    storeJson(requestHistoryKey, state.requestHistory);
  }

  renderProcessingCenter();
}

function renderProviderActionQueue() {
  renderList("provider-action-queue-list", state.providerActionQueue, (entry) => `<div class="item">
    <div class="value">${escapeHtml(labelProviderAction(entry.action || "action"))} · ${escapeHtml(labelProcessingStatus(entry.status || "queued"))}</div>
    <div class="muted">Request ${escapeHtml(entry.requestId || "unknown")} · ${formatTimestamp(entry.updatedAt || entry.timestamp)}</div>
    ${entry.backendStatus ? `<div class="muted">Current step: ${escapeHtml(labelUiStatus("requestStatus", entry.backendStatus))}</div>` : ""}
    ${entry.error ? `<div class="muted">${escapeHtml(entry.error)}</div>` : ""}
  </div>`, "No provider actions queued yet.");
}

async function loadProviderWallet(manualRefresh = false, silent = false) {
  if (!state.auth?.sessionToken) {
    state.providerWallet = null;
    renderProviderWallet();
    if (manualRefresh && !silent) {
      showBox("provider-wallet-status", "Sign in as a provider before loading wallet records.");
    }
    return;
  }

  if (!Array.isArray(state.auth?.roles) || !state.auth.roles.includes("PROVIDER")) {
    state.providerWallet = null;
    renderProviderWallet();
    if (manualRefresh && !silent) {
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
    if (manualRefresh && !silent) {
      showBox("provider-wallet-status", "Provider wallet records are up to date.");
    }
    recordProcessingEvent({
      action: "provider-wallet",
      route: "/provider/wallet",
      status: "accepted",
      message: `${Array.isArray(payload.ledger) ? payload.ledger.length : 0} payout record(s) loaded.`
    });
  } catch (error) {
    state.providerWallet = null;
    renderProviderWallet();
    if (!silent) {
      showBox("provider-wallet-status", error.message);
    }
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
  const payoutTerms = readProviderPayoutTerms(state.auth?.profile || null);
  const payoutTermsAccepted = wallet?.provider?.payoutTermsAccepted === true || payoutTerms?.accepted === true;
  const payoutSafeModeActive = wallet?.provider?.payoutSafeModeActive !== false && payoutTerms?.safeModeActive !== false;
  const queuedLedger = ledger.filter((entry) => normalizeField(entry.status).toUpperCase() === "SUBMITTED");
  const inProgressLedger = ledger.filter((entry) => ["ASSIGNED", "EN_ROUTE", "ARRIVED", "PAUSED"].includes(normalizeField(entry.status).toUpperCase()));
  const completedLedger = ledger.filter((entry) => normalizeField(entry.status).toUpperCase() === "COMPLETED" || normalizeField(entry.completionStatus).toUpperCase() === "COMPLETED");

  setText(
    "provider-wallet-summary-copy",
    wallet
      ? `Current payout totals for ${wallet.provider?.fullName || "your provider account"} are shown below. Wallet total is ${formatUsd(summary.currentWalletBalance || 0)} from ${summary.completedPaymentCount || 0} completed customer payment(s).`
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
    payoutTermsAccepted
      ? `${terms?.summary || "Wallet display terms are active."} ${terms?.payoutAcceptanceStatement || ""}`.trim()
      : `${terms?.safeModeStatement || "Provider payouts remain in safe mode until payout terms are accepted on the provider account."}`
  );
  setText(
    "provider-wallet-terms-detail",
    terms
      ? `${terms.thirdPartyResponsibility} ${terms.expectedParity} ${terms.discrepancyProcess}`
      : "Payout timing and discrepancy guidance will appear after the wallet is loaded."
  );
  setText(
    "provider-wallet-safe-mode",
    payoutSafeModeActive
      ? "Safe mode payout is active. Accept provider payout terms on the provider profile before payout can be released."
      : "Safe mode payout is removed. Payout can proceed only after customer payment capture and without an active dispute."
  );
  setText(
    "provider-wallet-dispute-policy",
    terms?.payoutDisputeWindow || "Payout disputes must be filed before payout is received. Completed payouts cannot be disputed through the platform record."
  );
  setText(
    "provider-wallet-work-summary",
    wallet
      ? `Work log currently tracks ${ledger.length} provider-linked job(s): ${queuedLedger.length} queued, ${inProgressLedger.length} in progress, and ${completedLedger.length} completed.`
      : "Provider work history will appear after wallet data is loaded."
  );

  setText("provider-wallet-funds-available", formatUsd(summary.fundsAvailable || 0));
  setText("provider-wallet-current-balance", formatUsd(summary.currentWalletBalance || 0));
  setText("provider-wallet-total-collected", formatUsd(summary.totalPaymentsCollected || 0));
  setText("provider-wallet-funds-pending", formatUsd(summary.fundsPending || 0));
  setText("provider-wallet-funds-on-hold", formatUsd(summary.fundsOnHold || 0));
  setText("provider-wallet-funds-dispute", formatUsd(summary.fundsDispute || 0));
  setText("provider-wallet-funds-paid-out", formatUsd(summary.fundsPaidOut || 0));

  setText(
    "provider-wallet-current-balance-count",
    wallet
      ? `${formatUsd(summary.totalEstimated || 0)} total provider payout value tracked across this wallet.`
      : "Current provider payout balance."
  );
  setText(
    "provider-wallet-total-collected-count",
    wallet
      ? `${summary.completedPaymentCount || 0} completed customer payment(s) across assigned services.`
      : "Completed customer payments for assigned services."
  );
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
  setText("provider-wallet-work-queued", String(queuedLedger.length));
  setText("provider-wallet-work-progress", String(inProgressLedger.length));
  setText("provider-wallet-work-completed", String(completedLedger.length));

  renderList(
    "provider-wallet-ledger-list",
    ledger,
    (entry) => `<div class="item">
      <div class="value">${escapeHtml(entry.requestId || "Pending request")} · ${escapeHtml(labelServiceType(entry.serviceType || "Service"))}</div>
      <div class="muted">${escapeHtml(entry.customerName || "Customer")} · ${escapeHtml(prettifyToken(entry.customerTier || "guest"))} · ${escapeHtml(formatTimestamp(entry.updatedAt))}</div>
      <div class="muted">Requested service payment: ${escapeHtml(formatUsd(entry.servicePaymentAmount || 0))} · Collected: ${escapeHtml(formatUsd(entry.paymentCollectedAmount || 0))}</div>
      <div class="muted">Provider net after payment: ${escapeHtml(formatUsd(entry.providerNetAmount || 0))} · Current wallet balance effect: ${escapeHtml(formatUsd(entry.currentWalletImpactAmount || 0))}</div>
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
  renderList(
    "provider-wallet-work-log-list",
    ledger.slice(0, 12),
    (entry) => `<div class="item">
      <div class="value">${escapeHtml(labelServiceType(entry.serviceType || "Service"))} · ${escapeHtml(entry.requestId || "Pending request")}</div>
      <div class="muted">${escapeHtml(entry.customerName || "Customer")} · ${escapeHtml(labelUiStatus("requestStatus", entry.status || entry.completionStatus || "UNKNOWN"))}</div>
      <div class="muted">Service payment: ${escapeHtml(formatUsd(entry.servicePaymentAmount || 0))} · Collected: ${escapeHtml(formatUsd(entry.paymentCollectedAmount || 0))}</div>
      <div class="muted">Payment: ${escapeHtml(labelUiStatus("paymentStatus", entry.paymentStatus || "UNKNOWN"))} · Payout: ${escapeHtml(labelUiStatus("payoutStatus", entry.providerPayoutStatus || "UNASSIGNED"))} · Provider net: ${escapeHtml(formatUsd(entry.providerNetAmount || 0))}</div>
      <div class="muted">Updated ${escapeHtml(formatTimestamp(entry.updatedAt))}</div>
    </div>`,
    wallet
      ? "No provider work log entries are available yet."
      : "Sign in as a provider to load work log history."
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

function renderListTargets(ids, entries, renderEntry, emptyMessage) {
  (Array.isArray(ids) ? ids : []).forEach((id) => {
    renderList(id, entries, renderEntry, emptyMessage);
  });
}

function setTextTargets(ids, value) {
  (Array.isArray(ids) ? ids : []).forEach((id) => {
    setText(id, value);
  });
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

async function loadLocationConfig() {
  try {
    state.locationConfig = await fetchApiJsonWithFallback("/location/config");
  } catch (error) {
    state.locationConfig = {
      mapbox: {
        configured: false
      },
      error: error.message
    };
  }
}

function buildLocationQuery(parts = []) {
  return parts.map((value) => normalizeField(value)).filter(Boolean).join(", ");
}

function formatLocationResolutionMessage(prefix, match) {
  const resolvedAddress = normalizeField(match?.fullAddress || match?.name || match?.placeFormatted || "");
  const accuracy = normalizeField(match?.accuracy);
  return `${prefix}: ${resolvedAddress || "dispatch location verified"}${accuracy ? ` · accuracy ${accuracy}` : ""}.`;
}

async function forwardGeocodeLocation(query) {
  const normalizedQuery = normalizeField(query);
  if (!normalizedQuery) {
    return null;
  }
  const payload = await fetchApiJsonWithFallback(`/location/geocode?q=${encodeURIComponent(normalizedQuery)}`);
  const match = Array.isArray(payload?.features) ? payload.features[0] : null;
  if (!match) {
    return null;
  }
  return {
    query: normalizedQuery,
    name: normalizeField(match.name),
    fullAddress: normalizeField(match.fullAddress || match.placeFormatted || match.name || normalizedQuery),
    longitude: Number(match.routableLongitude ?? match.longitude),
    latitude: Number(match.routableLatitude ?? match.latitude),
    accuracy: normalizeField(match.accuracy),
    mapboxId: normalizeField(match.mapboxId),
    resolvedAt: new Date().toISOString()
  };
}

function createLocationResolutionBridge(form, config = {}) {
  if (!form) {
    return {
      resolve: async () => null
    };
  }

  const watchedFields = Array.isArray(config.fields) ? config.fields : [];
  const statusId = config.statusId || "";
  const storageKey = config.storageKey || "";
  const queryBuilder = typeof config.queryBuilder === "function"
    ? config.queryBuilder
    : () => "";
  const successPrefix = normalizeField(config.successPrefix) || "Dispatch location verified";
  const unavailableMessage = normalizeField(config.unavailableMessage) || "Dispatch will verify the location after submission.";
  const unresolvedMessage = normalizeField(config.unresolvedMessage) || "Dispatch could not verify this location yet. Submission can still continue.";
  let pendingTimer = null;
  let requestVersion = 0;

  const cached = storageKey ? readStoredJson(storageKey, null) : null;
  if (cached?.message) {
    showBox(statusId, cached.message);
  }

  const resolve = async (force = false) => {
    const query = normalizeField(queryBuilder(form));
    if (!query) {
      if (storageKey) {
        clearDraft(storageKey);
      }
      hideBox(statusId);
      return null;
    }

    const cachedResolution = storageKey ? readStoredJson(storageKey, null) : null;
    if (!force && cachedResolution?.query === query && cachedResolution?.match) {
      showBox(statusId, cachedResolution.message || formatLocationResolutionMessage(successPrefix, cachedResolution.match));
      return cachedResolution.match;
    }

    if (state.locationConfig?.mapbox && state.locationConfig.mapbox.configured === false) {
      const fallbackResolution = {
        query,
        match: null,
        message: unavailableMessage,
        resolvedAt: new Date().toISOString()
      };
      if (storageKey) {
        storeJson(storageKey, fallbackResolution);
      }
      showBox(statusId, fallbackResolution.message);
      return null;
    }

    const currentVersion = ++requestVersion;
    showBox(statusId, "Checking dispatch location...");

    try {
      const match = await forwardGeocodeLocation(query);
      if (currentVersion !== requestVersion) {
        return null;
      }
      if (!match || !Number.isFinite(match.longitude) || !Number.isFinite(match.latitude)) {
        const noMatchResolution = {
          query,
          match: null,
          message: unresolvedMessage,
          resolvedAt: new Date().toISOString()
        };
        if (storageKey) {
          storeJson(storageKey, noMatchResolution);
        }
        showBox(statusId, noMatchResolution.message);
        return null;
      }

      const resolved = {
        query,
        match,
        message: formatLocationResolutionMessage(successPrefix, match),
        resolvedAt: new Date().toISOString()
      };
      if (storageKey) {
        storeJson(storageKey, resolved);
      }
      showBox(statusId, resolved.message);
      return match;
    } catch {
      if (currentVersion !== requestVersion) {
        return null;
      }
      const failedResolution = {
        query,
        match: null,
        message: unresolvedMessage,
        resolvedAt: new Date().toISOString()
      };
      if (storageKey) {
        storeJson(storageKey, failedResolution);
      }
      showBox(statusId, failedResolution.message);
      return null;
    }
  };

  const scheduleResolve = () => {
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
    }
    pendingTimer = window.setTimeout(() => {
      pendingTimer = null;
      void resolve(false);
    }, 450);
  };

  watchedFields.forEach((fieldName) => {
    const element = form.querySelector(`[name="${fieldName}"]`);
    if (!element) {
      return;
    }
    element.addEventListener("input", scheduleResolve);
    element.addEventListener("change", scheduleResolve);
    element.addEventListener("blur", () => {
      void resolve(true);
    });
  });

  return {
    resolve
  };
}

async function enrichRequestPayloadWithLocationResolution(payload, resolver) {
  if (!payload || typeof payload !== "object" || !resolver || typeof resolver.resolve !== "function") {
    return payload;
  }
  const match = await resolver.resolve(true);
  if (!match || !Number.isFinite(match.longitude) || !Number.isFinite(match.latitude)) {
    return payload;
  }
  return {
    ...payload,
    locationCoordinates: {
      longitude: match.longitude,
      latitude: match.latitude
    },
    locationMapboxId: match.mapboxId || null,
    locationFullAddress: match.fullAddress || payload.location,
    locationAccuracy: match.accuracy || null
  };
}

function collectRequestFormData(form) {
  const formData = new FormData(form);
  const vehicleInfo = {
    year: normalizeField(formData.get("year")),
    make: normalizeField(formData.get("make")),
    model: normalizeField(formData.get("model")),
    color: normalizeField(formData.get("color"))
  };
  const addressLine = normalizeField(formData.get("addressLine"));
  const city = normalizeField(formData.get("city"));
  const stateRegion = normalizeField(formData.get("stateRegion"));
  const crossStreet = normalizeField(formData.get("crossStreet"));
  const locationParts = [addressLine, city, stateRegion].filter(Boolean);
  return {
    userId: state.auth?.userId || null,
    roles: state.auth?.roles || [],
    fullName: normalizeField(formData.get("fullName")),
    phoneNumber: normalizeField(formData.get("phoneNumber")),
    serviceType: normalizeField(formData.get("serviceType")),
    addressLine,
    city,
    stateRegion,
    location: locationParts.join(", "),
    crossStreet,
    notes: normalizeField(formData.get("notes")),
    guestTermsAccepted: formData.get("guestTermsAccepted") === "on",
    vehicleInfo,
    vehicleSummary: [vehicleInfo.year, vehicleInfo.make, vehicleInfo.model, vehicleInfo.color].filter(Boolean).join(" ").trim(),
    assignedProviderId: ""
  };
}

function enforceRequestIdentityRules(payload) {
  if (!payload.fullName || !payload.phoneNumber || !payload.serviceType || !payload.addressLine || !payload.city || !payload.stateRegion) {
    throw new Error("Full name, phone number, service type, address, city, and state are required.");
  }
  if (!payload.vehicleInfo?.year || !payload.vehicleInfo?.make || !payload.vehicleInfo?.model || !payload.vehicleInfo?.color) {
    throw new Error("Vehicle year, make, model, and color are required.");
  }
  if (!payload.guestTermsAccepted) {
    throw new Error("Guest service terms must be accepted before submitting a request.");
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
  setText("provider-admin-status", auth ? formatProviderApprovalReview(profile) : "Provider status will appear after sign-in.");
  setText("provider-service-list", formatProviderServices(profile));
  setText("provider-vehicle-summary", formatProviderVehicle(profile));
  setText("provider-hours-summary", formatProviderHours(profile));
  setText("provider-document-policy", formatProviderDocumentPolicy(profile));
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
  if (["home", "customer", "subscriber-access", "provider", "provider-info", "provider-work", "provider-wallet", "admin", "admin-dashboard", "admin-accounts", "admin-financials", "security"].includes(value)) {
    return value;
  }
  return "home";
}

function navigateToScreen(screen) {
  const targetScreen = normalizeField(screen).toLowerCase() || "home";
  const page = screenToPage(targetScreen);
  const currentPage = normalizeField(window.location.pathname.split("/").pop()) || "index.html";
  const matchingShellScreen = document.querySelector(`[data-screen="${targetScreen}"]`);

  if (page && !matchingShellScreen) {
    const [pagePath, pageHash] = page.split("#");
    if (pagePath && pagePath !== currentPage) {
      window.location.href = page;
      return;
    }
    if (pageHash) {
      window.location.hash = pageHash;
      return;
    }
  }

  switchScreen(targetScreen);
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
  
  if (data.needsPersistence && data.manualSubmission === true) {
    commitToBackend(screen, data);
  }
}

function frontendIndexRuntime() {
  return window.AWRoadsideFrontendIndex && typeof window.AWRoadsideFrontendIndex === "object"
    ? window.AWRoadsideFrontendIndex
    : null;
}

function clearDraft(key) {
  const index = frontendIndexRuntime();
  if (index && typeof index.removeValue === "function") {
    index.removeValue(key);
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore restricted-browser storage failures.
  }
}

function restoreFormDraft(form, key) {
  const draft = readStoredJson(key, null);
  if (!draft || typeof draft !== "object") {
    return;
  }

  Array.from(form.elements).forEach((element) => {
    if (!element || !element.name || !Object.prototype.hasOwnProperty.call(draft, element.name)) {
      return;
    }
    const draftValue = draft[element.name];
    if (element.type === "checkbox") {
      if (typeof draftValue === "boolean") {
        element.checked = draftValue;
      }
      return;
    }
    if (element.type === "file") {
      if (draftValue && typeof draftValue.fileName === "string") {
        element.dataset.cachedFileName = draftValue.fileName;
      }
      return;
    }
    if (typeof draftValue === "string") {
      element.value = draftValue;
    }
  });
}

function attachFormDraftPersistence(form, key, options = {}) {
  const handler = () => {
    const snapshot = snapshotFormDraft(form, options);
    const ttlMs = Number(options.ttlMs || defaultDraftRetentionMs);
    const index = frontendIndexRuntime();
    if (index && typeof index.writeValue === "function") {
      index.writeValue(key, snapshot, ttlMs);
      return;
    }
    storeJson(key, snapshot);
  };

  form.addEventListener("input", handler);
  form.addEventListener("change", handler);
}

function snapshotFormDraft(form, options = {}) {
  const snapshot = {};
  Array.from(form.elements).forEach((element) => {
    if (!element || !element.name || element.disabled) {
      return;
    }
    if (element.type === "checkbox") {
      snapshot[element.name] = Boolean(element.checked);
      return;
    }
    if (element.type === "file") {
      if (!options.includeFileMetadata) {
        return;
      }
      const file = element.files && element.files[0] ? element.files[0] : null;
      snapshot[element.name] = file ? { fileName: file.name } : null;
      return;
    }
    snapshot[element.name] = element.value;
  });
  return snapshot;
}

function readStoredJson(key, fallback = null) {
  const index = frontendIndexRuntime();
  if (index && typeof index.readValue === "function") {
    return index.readValue(key, fallback);
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function readStoredBoolean(key, fallback = false) {
  const value = readStoredJson(key, fallback);
  return typeof value === "boolean" ? value : fallback;
}

async function commitToBackend(screen, data) {
  console.log(`[SHELL_COMMIT] Committing ${screen} data to backend relay...`);
  shellState.pendingCommit = false;
  storeJson(shellStateKey, shellState);

  if (!data || data.manualSubmission !== true) {
    return {
      ok: false,
      skipped: true,
      reason: "manual-submission-required"
    };
  }

  if (data.kind === "connection-check") {
    const payload = await fetchApiJsonWithFallback("/health", [
      `${window.location.origin}/api/health`
    ]);
    setText("api-status", "Dispatch connection confirmed.");
    return {
      ok: true,
      kind: "connection-check",
      payload
    };
  }

  if (data.kind === "admin-action") {
    if (!data.path) {
      throw new Error("Admin fallback submission requires a backend path.");
    }
    const response = await adminFetch(data.path, {
      method: data.method || "POST",
      headers: adminAuthHeaders(),
      body: typeof data.body === "undefined" ? undefined : JSON.stringify(data.body)
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Admin action failed.");
    }
    await loadAdminDashboard();
    return {
      ok: true,
      kind: "admin-action",
      payload
    };
  }

  return {
    ok: false,
    skipped: true,
    reason: "unsupported-manual-commit-kind"
  };
}

function switchScreen(screen) {
  const targetScreen = screen || "home";
  let found = false;
  
  // Close all modals whenever we switch screens to prevent "dimmed" overlays
  document.querySelectorAll(".modal-shell").forEach((m) => {
    m.hidden = true;
    m.style.display = "none";
  });
  document.body.classList.remove("modal-open");

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
    "subscriber-access": "subscriber-access.html",
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
      showModal(modalId);
    });
  }

  if (closeButton && modal) {
    closeButton.addEventListener("click", () => {
      hideModal(modalId);
    });
  }
}

function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.hidden = false;
    modal.style.display = "flex";
    document.body.classList.add("modal-open");
  }
}

function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.hidden = true;
    modal.style.display = "none";
    
    // Only remove modal-open if no other modals are visible
    const anyVisible = Array.from(document.querySelectorAll(".modal-shell")).some(m => !m.hidden);
    if (!anyVisible) {
      document.body.classList.remove("modal-open");
    }
  }
}

function readStoredAuth() {
  return readStoredJson(storageKey, null);
}

function readStoredAdmin() {
  return readStoredJson(`${storageKey}-admin`, null);
}

function readStoredArray(key) {
  const parsed = readStoredJson(key, []);
  return Array.isArray(parsed) ? parsed : [];
}

function storeAuth(auth) {
  storeJson(storageKey, auth);
}

function storeAdmin(admin) {
  storeJson(`${storageKey}-admin`, admin);
}

function storeJson(key, value) {
  const index = frontendIndexRuntime();
  if (index && typeof index.writeValue === "function") {
    index.writeValue(key, value);
    return;
  }

  try {
    if (value === null || typeof value === "undefined") {
      window.localStorage.removeItem(key);
      return;
    }
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

function eventStreamUrl() {
  return resolveEventStreamUrl(state.frontendConfig?.eventStreamUrl || runtimeConfig.eventStreamUrl);
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

function getBootstrapOrigins() {
  const configuredApiBase = normalizeUrlValue(runtimeConfig.apiBaseUrl);
  const configuredRawBase = normalizeUrlValue(runtimeConfig.rawApiBaseUrl);
  const bootstrapOrigins = [];

  for (const baseUrl of [configuredApiBase, configuredRawBase]) {
    if (!baseUrl) {
      continue;
    }
    try {
      bootstrapOrigins.push(new URL(baseUrl, window.location.origin).origin);
    } catch {
      // Ignore malformed configured origins and continue with fallbacks.
    }
  }

  bootstrapOrigins.push(getDefaultBackendOrigin());
  return dedupeUrls(bootstrapOrigins);
}

function renderProfileState(profile) {
  toggleProviderDocumentsPanel(profile);
  setText("provider-service-list", formatProviderServices(profile));
  setText("provider-vehicle-summary", formatProviderVehicle(profile));
  setText("provider-hours-summary", formatProviderHours(profile));
  setText("provider-document-policy", formatProviderDocumentPolicy(profile));
  renderProviderPayoutTermsState(profile);
  renderSubscriberProfile(profile);
  syncRequestFormWithProfile(profile);
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

async function buildProviderDocumentUpload(value, fallbackFileName) {
  if (value instanceof File) {
    if (!value.name || value.size === 0) {
      return false;
    }
    return {
      dataUrl: await readFileAsDataUrl(value),
      fileName: value.name || fallbackFileName,
      contentType: value.type || inferProviderDocumentContentType(value.name)
    };
  }
  return buildProviderDocumentPayload(value, fallbackFileName);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error(`Unable to read ${file.name || "document"} from this device.`));
    reader.readAsDataURL(file);
  });
}

function inferProviderDocumentContentType(fileName) {
  const normalized = normalizeField(fileName).toLowerCase();
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".png")) {
    return "image/png";
  }
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalized.endsWith(".heic")) {
    return "image/heic";
  }
  if (normalized.endsWith(".heif")) {
    return "image/heif";
  }
  if (normalized.endsWith(".pdf")) {
    return "application/pdf";
  }
  return "text/plain";
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

function formatProviderHours(profile) {
  const hours = profile?.providerProfile?.hoursOfService || null;
  if (!hours?.hasHours) {
    return "Hours of service will appear after provider account details are loaded.";
  }
  return `Hours of service: ${hours.timezone || "Local"} · Weekdays ${hours.monday || "not set"} · Weekends ${hours.saturday || "not set"}.`;
}

function formatProviderDocumentPolicy(profile) {
  const documentStatus = profile?.providerProfile?.documentStatus || null;
  if (!documentStatus) {
    return "License, registration, insurance, profile photo, and proof of address are required. Helper ID stays optional and temporary.";
  }
  return `Verification ready: ${documentStatus.meetsMinimumRequirements ? "required documents on file" : "documents still needed"} · Required documents: ${(documentStatus.required || []).map(prettifyToken).join(", ")} · Helper ID remains optional for active helper coverage only.`;
}

function formatProviderApprovalReview(profile) {
  const providerStatus = normalizeField(profile?.providerStatus).toUpperCase();
  const profileSubmissionStatus = normalizeField(profile?.providerProfile?.profileSubmissionStatus).toUpperCase();
  const approvalEligibility = profile?.providerProfile?.approvalEligibility || null;
  if (providerStatus === "APPROVED" || providerStatus === "ACTIVE") {
    return "Provider status: Approved for dispatch.";
  }
  if (!providerStatus) {
    return "Provider status will appear after sign-in.";
  }
  if (providerStatus !== "PENDING_APPROVAL") {
    return `Provider status: ${labelUiStatus("providerStatus", providerStatus)}.`;
  }
  const reviewLabel = profileSubmissionStatus ? prettifyToken(profileSubmissionStatus) : "Pending provider review";
  if (!approvalEligibility) {
    return `Provider status: Pending Approval · ${reviewLabel}.`;
  }
  if (approvalEligibility.canApprove) {
    return `Provider status: Pending Approval · ${reviewLabel}. Ready for admin approval.`;
  }
  const missing = Array.isArray(approvalEligibility.missingRequirements) && approvalEligibility.missingRequirements.length
    ? approvalEligibility.missingRequirements.map(prettifyToken).join(", ")
    : "review pending";
  return `Provider status: Pending Approval · ${reviewLabel}. Review items: ${missing}.`;
}

function readProviderPayoutTerms(profile) {
  return profile?.providerProfile?.payoutTerms || profile?.terms?.providerPayout || null;
}

function renderProviderPayoutTermsState(profile) {
  const payoutTerms = readProviderPayoutTerms(profile);
  const accepted = payoutTerms?.accepted === true;
  const acceptedAt = payoutTerms?.acceptedAt || null;
  setText(
    "provider-payout-terms-status",
    accepted
      ? `Provider payout terms accepted${acceptedAt ? ` at ${formatTimestamp(acceptedAt)}` : ""}. Safe mode payout is removed for eligible releases.`
      : "Provider payout terms are not accepted yet. Safe mode payout remains active."
  );
  setText(
    "provider-payout-terms-summary",
    accepted
      ? "Payout release is eligible once customer payment is captured and no dispute is active."
      : "Accept payout terms before any payout can be released from safe mode."
  );
  setText(
    "provider-payout-dispute-policy",
    "Payout disputes must be filed before payout is received. Completed payouts cannot be disputed through the platform record."
  );

  const termsAcceptedInput = document.getElementById("provider-payout-terms-accepted");
  const disputeWindowInput = document.getElementById("provider-payout-dispute-window-accepted");
  const noPostReceiptInput = document.getElementById("provider-payout-no-post-receipt-dispute-accepted");
  const submitButton = document.getElementById("provider-payout-terms-submit");
  for (const input of [termsAcceptedInput, disputeWindowInput, noPostReceiptInput]) {
    if (!input) {
      continue;
    }
    input.checked = accepted || input.checked;
    input.disabled = accepted;
  }
  if (submitButton) {
    submitButton.disabled = accepted;
  }
}

function formatProviderVehicle(profile) {
  const vehicle = profile?.providerProfile?.vehicleInfo || profile?.subscriberProfile?.vehicle || null;
  return vehicle ? `Vehicle profile: ${formatVehicleSummary(vehicle)}` : "Vehicle profile will appear after account details are loaded.";
}

function renderSubscriberProfile(profile) {
  const subscriber = profile?.subscriberProfile || null;
  const paymentInfo = subscriber?.paymentInfo || null;
  const primaryAddress = subscriber?.primaryAddress || null;
  const roles = Array.isArray(profile?.roles) ? profile.roles : [];
  const isSubscriber = roles.includes("SUBSCRIBER");

  setText(
    "subscriber-profile-summary",
    isSubscriber
      ? `${profile.fullName || "Subscriber"} is signed in${profile.subscriberActive ? " with active membership." : "."}`
      : "Sign in or create a subscriber account to keep vehicle and billing details ready."
  );
  setText(
    "subscriber-profile-vehicle",
    subscriber?.vehicle
      ? formatVehicleSummary(subscriber.vehicle)
      : "Vehicle details will appear here after subscriber setup is completed."
  );
  setText(
    "subscriber-profile-payment",
    paymentInfo?.paymentMethodMasked || "Payment record will appear here after subscriber setup."
  );
  setText(
    "subscriber-profile-membership",
    isSubscriber
      ? profile.subscriberActive
        ? "Membership active. Request service using the saved account details or update them before the next call."
        : "Subscriber account is present. Membership status will refresh from dispatch."
      : "Subscriber profile is not active on this device yet."
  );
  setText(
    "subscriber-profile-address",
    formatSubscriberAddress(primaryAddress)
  );
  setText(
    "subscriber-request-terms",
    "Subscriber request terms follow the dispatch liability and non-refundable service payment rules once the service payment step is accepted."
  );
  syncSubscriberProfileForms(profile);
}

function syncRequestFormWithProfile(profile) {
  const form = document.getElementById("request-form");
  if (!form || !profile) {
    return;
  }

  const vehicle = profile?.subscriberProfile?.vehicle || null;
  const primaryAddress = profile?.subscriberProfile?.primaryAddress || null;
  const fields = {
    fullName: profile.fullName || "",
    phoneNumber: profile.phoneNumber || "",
    year: vehicle?.year || "",
    make: vehicle?.make || "",
    model: vehicle?.model || "",
    color: vehicle?.color || "",
    addressLine: primaryAddress?.line1 || "",
    city: primaryAddress?.city || "",
    stateRegion: primaryAddress?.state || "",
    crossStreet: primaryAddress?.crossStreet || ""
  };

  Object.entries(fields).forEach(([name, value]) => {
    const input = form.elements.namedItem(name);
    if (!input || normalizeField(input.value)) {
      return;
    }
    input.value = value;
  });
}

function syncSubscriberProfileForms(profile) {
  const subscriber = profile?.subscriberProfile || null;
  const primaryAddress = subscriber?.primaryAddress || {};
  const vehicle = subscriber?.vehicle || {};
  syncNamedFormFields("subscriber-profile-form", {
    fullName: profile?.fullName || "",
    phoneNumber: profile?.phoneNumber || "",
    email: profile?.email || "",
    year: vehicle.year || "",
    make: vehicle.make || "",
    model: vehicle.model || "",
    color: vehicle.color || "",
    addressLine: primaryAddress.line1 || "",
    addressLineTwo: primaryAddress.line2 || "",
    city: primaryAddress.city || "",
    stateRegion: primaryAddress.state || "",
    postalCode: primaryAddress.postalCode || "",
    crossStreet: primaryAddress.crossStreet || "",
    paymentMethodMasked: subscriber?.paymentMethodMasked || subscriber?.paymentInfo?.paymentMethodMasked || "",
    paymentProvider: subscriber?.paymentInfo?.paymentProvider || "",
    billingZip: subscriber?.paymentInfo?.billingZip || primaryAddress.postalCode || ""
  });
  syncNamedFormFields("subscriber-request-form", {
    addressLine: primaryAddress.line1 || "",
    city: primaryAddress.city || "",
    stateRegion: primaryAddress.state || "",
    crossStreet: primaryAddress.crossStreet || ""
  });
}

function syncNamedFormFields(formId, values) {
  const form = document.getElementById(formId);
  if (!form) {
    return;
  }
  Object.entries(values || {}).forEach(([name, value]) => {
    const input = form.elements.namedItem(name);
    if (!input || normalizeField(input.value)) {
      return;
    }
    input.value = value;
  });
}

function formatVehicleSummary(vehicle) {
  const parts = [vehicle.year, vehicle.make, vehicle.model, vehicle.color]
    .map((value) => normalizeField(value))
    .filter(Boolean);
  return parts.length ? parts.join(" ") : "Vehicle not available";
}

function resolveApiBaseUrl(value) {
  const fallback = normalizeUrlValue(runtimeConfig.apiBaseUrl) || `${getDefaultBackendOrigin()}/api/aw-roadside`;
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
  const fallback = normalizeUrlValue(runtimeConfig.rawApiBaseUrl) || `${getDefaultBackendOrigin()}/api`;
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
  const fallback = normalizeUrlValue(runtimeConfig.adminApiBaseUrl) || `${getDefaultBackendOrigin()}/admin-controller.mjs`;
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

function resolveEventStreamUrl(value) {
  const fallbackOrigin = resolveEventStreamOrigin(
    state.frontendConfig?.rawApiBaseUrl ||
      state.frontendConfig?.apiBaseUrl ||
      runtimeConfig.rawApiBaseUrl ||
      runtimeConfig.apiBaseUrl ||
      runtimeConfig.uiBaseUrl
  );
  const fallback = `${fallbackOrigin}/events.mjs`;
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

function resolveEventStreamOrigin(value) {
  const fallback = getDefaultBackendOrigin();
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
    eventStreamUrl: normalizeUrlValue(config.eventStreamUrl),
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

function hideBox(id) {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }
  element.textContent = "";
  element.style.display = "none";
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
  const noRefundPolicyEnabled = source.noRefundPolicy === true;
  if (shouldShowPublicPricing()) {
    setText(
      "priority-price",
      hasDisplayPrice(source.priorityServicePrice) ? formatUsd(source.priorityServicePrice) : "Available after request"
    );
    setText(
      "priority-price-badge",
      hasDisplayPrice(source.priorityServicePrice) ? formatUsd(source.priorityServicePrice) : "Available after request"
    );
    setText(
      "guest-service-price",
      hasDisplayPrice(source.guestServicePrice) ? formatUsd(source.guestServicePrice) : "Pricing available on request"
    );
    setText(
      "service-base-price",
      hasDisplayPrice(source.serviceBasePrice) ? formatUsd(source.serviceBasePrice) : "Pricing available on request"
    );
    setText(
      "guest-dispatch-fee",
      hasDisplayPrice(source.guestDispatchFee) ? formatUsd(source.guestDispatchFee) : "Included in request review"
    );
    setText(
      "subscriber-monthly-price",
      hasDisplayPrice(source.subscriberMonthlyFee) ? formatMonthlyUsd(source.subscriberMonthlyFee) : "pricing available on request"
    );
    setText(
      "subscriber-service-price",
      hasDisplayPrice(source.subscriberServicePrice) ? formatUsd(source.subscriberServicePrice) : "Pricing available on request"
    );
    setText(
      "provider-monthly-price",
      hasDisplayPrice(source.providerMonthlyFee) ? formatMonthlyUsd(source.providerMonthlyFee) : "approval-based pricing"
    );
    setText(
      "guest-terms-policy",
      noRefundPolicyEnabled
        ? "Guest roadside payments follow the dispatch no-refund policy once paid service begins."
        : "Guest customers review dispatch pricing and service terms before any paid roadside work begins."
    );
    return;
  }

  setText("priority-price", "Available after request");
  setText("priority-price-badge", "Available after request");
  setText("guest-service-price", "Pricing available on request");
  setText("service-base-price", "Pricing available on request");
  setText("guest-dispatch-fee", "Included in request review");
  setText("subscriber-monthly-price", "pricing available on request");
  setText("subscriber-service-price", "Pricing available on request");
  setText("provider-monthly-price", "approval-based pricing");
  setText("guest-terms-policy", "Guest customers review dispatch pricing and service terms before any paid roadside work begins.");
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
  if (activeRequest && (activeRequest.status === "SUBMITTED" || activeRequest.status === "ASSIGNED")) {
    if (!state.eventRefreshTimer) {
      state.eventRefreshTimer = setInterval(async () => {
        try {
          const requestId = activeRequest.requestId || activeRequest.id;
          const response = await apiFetch(`/requests/${encodeURIComponent(requestId)}`, {
            method: "GET",
            headers: jsonHeaders()
          });
          const payload = await response.json();
          if (response.ok && payload.request) {
             if (state.pendingRequest && String(state.pendingRequest.id || state.pendingRequest.requestId) === String(requestId)) {
               state.pendingRequest = payload.request;
               renderCustomerRequestState();
             }
          }
        } catch (error) {
          console.error("Customer status poll failed:", error);
        }
      }, 30000);
    }
  } else if (state.eventRefreshTimer) {
    clearInterval(state.eventRefreshTimer);
    state.eventRefreshTimer = null;
  }

  const vehicleSummary =
    activeRequest?.vehicleSummary ||
    formatVehicleSummary(activeRequest?.vehicleInfo || {});
  const areaSummary = [activeRequest?.city, activeRequest?.stateRegion].filter(Boolean).join(", ");
  const vehicleCopy = vehicleSummary && vehicleSummary !== "Vehicle not available" ? ` for ${vehicleSummary}` : "";
  const areaCopy = areaSummary ? ` near ${areaSummary}` : "";
  const serviceChangeSummary = buildServiceChangeSummary(activeRequest, { includeReviewedOutcome: true });
  const summary = activeRequest
    ? `${labelServiceType(activeRequest.serviceType || "Service")} request ${activeRequest.requestId || "pending"}${vehicleCopy}${areaCopy} is ${labelUiStatus("requestStatus", activeRequest.status || "SUBMITTED")}.${serviceChangeSummary ? ` ${serviceChangeSummary}` : ""}`
    : "Submit a request to create a reference and unlock live request updates on this page.";
  setText("customer-request-summary", summary);
  renderServiceStatusPanels(activeRequest);
}

function renderServiceStatusPanels(request) {
  if (!request) {
    setTextTargets(
      ["service-status-headline", "subscriber-service-status-headline"],
      "Submit or reopen a request to see ETA release, payment safety, and dispatch progression."
    );
    setTextTargets(
      ["service-status-disclosure", "subscriber-service-status-disclosure"],
      "Location and callback release stay staged until dispatch reaches the correct ETA and payment state."
    );
    setTextTargets(
      ["service-status-payment", "subscriber-service-status-payment"],
      "Service payment stays locked until the backend releases the approved payment prompt."
    );
    setTextTargets(
      ["service-status-safety", "subscriber-service-status-safety"],
      "Ignore unknown calls, links, or aggressive payment requests outside the approved platform payment path."
    );
    renderListTargets(
      ["service-status-timeline", "subscriber-service-status-timeline"],
      [],
      () => "",
      "No service status is available yet."
    );
    renderRequestActionPanels(null);
    setServicePaymentControlsState(null);
    renderAssignedProviderStatus(null);
    return;
  }

  const cancelled = normalizeField(request.status).toUpperCase() === "CANCELLED";
  const etaParts = [];
  if (Number.isFinite(Number(request.softEtaMinutes))) {
    etaParts.push(`soft ETA ${Number(request.softEtaMinutes)} min`);
  }
  if (Number.isFinite(Number(request.hardEtaMinutes))) {
    etaParts.push(`hard ETA ${Number(request.hardEtaMinutes)} min`);
  }
  const etaCopy = etaParts.length ? etaParts.join(" · ") : "ETA pending";
  const serviceChangeSummary = buildServiceChangeSummary(request, { includeReviewedOutcome: true });
  const paymentReleased = Boolean(request.paymentPromptedAt) || normalizeField(request.paymentStatus).toUpperCase() !== "NOT_PAID";
  const disclosureCopy = cancelled
    ? `This request was cancelled${request.cancelReason ? ` with note: ${request.cancelReason}.` : "."}`
    : `Location release is ${prettifyToken(request.locationDisclosureLevel || "masked")} and contact release is ${prettifyToken(request.contactDisclosureLevel || "locked")}.` +
      (request.directCommunicationEnabled
        ? " Provider communication is unlocked for the current dispatch stage."
        : " Direct provider communication remains locked until the hard ETA/contact stage is confirmed.");
  const paymentCopy = cancelled
    ? isPaymentCaptured(request)
      ? "Payment was already captured before cancellation. Cancellation does not imply a refund."
      : `Payment status is ${labelUiStatus("paymentStatus", request.paymentStatus || "NOT_PAID")}.`
    : paymentReleased
      ? `Payment status is ${labelUiStatus("paymentStatus", request.paymentStatus || "PENDING")}. Use only the approved platform quote or payment prompt tied to request ${request.requestId || "pending"}.`
      : "Payment is still locked. Final service payment should not be accepted until the approved platform prompt is released.";
  const safetyCopy = cancelled
    ? "This request is closed. Further dispatch work requires a new request unless support reopens it."
    : paymentReleased
      ? "If anyone asks for payment outside the approved platform prompt, treat it as untrusted and stop the payment flow."
      : "Do not pay unknown callers, text links, or providers directly while the request is still in intake or soft ETA stage.";
  const headline = cancelled
    ? `${labelServiceType(request.serviceType || "Service")} · Cancelled`
    : `${labelServiceType(request.serviceType || "Service")} · ${labelUiStatus("requestStatus", request.status || "SUBMITTED")} · ${etaCopy}`;

  setTextTargets(["service-status-headline", "subscriber-service-status-headline"], headline);
  setTextTargets(
    ["service-status-disclosure", "subscriber-service-status-disclosure"],
    serviceChangeSummary && !cancelled ? `${disclosureCopy} ${serviceChangeSummary}` : disclosureCopy
  );
  setTextTargets(["service-status-payment", "subscriber-service-status-payment"], paymentCopy);
  setTextTargets(["service-status-safety", "subscriber-service-status-safety"], safetyCopy);
  renderRequestActionPanels(request);
  setServicePaymentControlsState(request);
  renderAssignedProviderStatus(request);

  renderListTargets(
    ["service-status-timeline", "subscriber-service-status-timeline"],
    buildServiceStatusTimeline(request),
    (entry) => `<div class="item">
      <div class="value">${escapeHtml(entry.label)}</div>
      <div class="muted">${escapeHtml(entry.detail)}</div>
    </div>`,
    "No service status is available yet."
  );
}

function renderAssignedProviderStatus(request) {
  const display = request?.assignedProviderDisplay || null;
  const hasDisplay = Boolean(display?.fullName);
  const providerNote = hasDisplay
    ? "Assigned provider details are now released for the current service stage."
    : "Assigned provider details will appear after hard ETA is confirmed and payment is received.";
  setTextTargets(["service-provider-name", "subscriber-service-provider-name"], hasDisplay ? display.fullName : "Provider details locked");
  setTextTargets(["service-provider-note", "subscriber-service-provider-note"], providerNote);
  const targets = [
    ["service-provider-photo", "service-provider-photo-card"],
    ["subscriber-service-provider-photo", "subscriber-service-provider-photo-card"]
  ];
  for (const [imageId, cardId] of targets) {
    const image = document.getElementById(imageId);
    const card = document.getElementById(cardId);
    if (!image || !card) {
      continue;
    }
    if (display?.profilePhotoDataUrl) {
      image.src = display.profilePhotoDataUrl;
      image.alt = `${display.fullName || "Assigned provider"} profile photo`;
      card.hidden = false;
    } else {
      image.removeAttribute("src");
      image.alt = "Assigned provider profile photo unavailable";
      card.hidden = !hasDisplay;
    }
  }
}

function buildServiceStatusTimeline(request) {
  if (normalizeField(request?.status).toUpperCase() === "CANCELLED") {
    const timeline = [
      {
        label: "Request submitted",
        detail: `Reference ${request.requestId || "pending"} was created for ${labelServiceType(request.serviceType || "service")}.`
      }
    ];
    if (Boolean(request.acceptedAt || request.assignedProviderId)) {
      timeline.push({
        label: "Provider accepted",
        detail: request.acceptedAt ? `Provider accepted the call at ${formatTimestamp(request.acceptedAt)}.` : "A provider had already been assigned to this request."
      });
    }
    const serviceChangeSummary = buildServiceChangeSummary(request, { includeReviewedOutcome: true });
    if (serviceChangeSummary) {
      timeline.push({
        label: "Service type review",
        detail: serviceChangeSummary
      });
    }
    timeline.push({
      label: "Service cancelled",
      detail: `${request.cancelledAt ? `Cancelled at ${formatTimestamp(request.cancelledAt)}.` : "This request was cancelled."}${isPaymentCaptured(request) ? " Payment remained non-refundable after capture." : ""}`
    });
    return timeline;
  }

  const serviceChangeSummary = buildServiceChangeSummary(request, { includeReviewedOutcome: true });
  const steps = [
    {
      label: "Request submitted",
      reached: Boolean(request.submittedAt || request.createdAt),
      reachedDetail: `Reference ${request.requestId || "pending"} was created for ${labelServiceType(request.serviceType || "service")}.`,
      pendingDetail: "Dispatch has not recorded the request yet."
    },
    ...(serviceChangeSummary
      ? [{
          label: "Service type review",
          reached: true,
          reachedDetail: serviceChangeSummary,
          pendingDetail: "No service type review is attached to this request."
        }]
      : []),
    {
      label: "Provider accepted",
      reached: Boolean(request.acceptedAt || request.assignedProviderId),
      reachedDetail: request.acceptedAt ? `Provider accepted the call at ${formatTimestamp(request.acceptedAt)}.` : "A provider assignment is in progress.",
      pendingDetail: "Waiting for an eligible provider to accept the request."
    },
    {
      label: "ETA shared",
      reached: Boolean(request.etaUpdatedAt || request.softEtaMinutes || request.hardEtaMinutes),
      reachedDetail: `Dispatch has ${Number.isFinite(Number(request.hardEtaMinutes)) ? `hard ETA ${Number(request.hardEtaMinutes)} min` : Number.isFinite(Number(request.softEtaMinutes)) ? `soft ETA ${Number(request.softEtaMinutes)} min` : "an ETA in progress"}.`,
      pendingDetail: "ETA has not been recorded yet."
    },
    {
      label: "Contact and location release",
      reached: Boolean(request.directCommunicationEnabled || request.contactUnlockedAt || request.exactLocationUnlockedAt || request.hardContactedAt),
      reachedDetail: "Direct provider communication and detailed location release are active for this request.",
      pendingDetail: "Location and contact stay staged until the hard ETA or payment stage is confirmed."
    },
    {
      label: "Payment prompt released",
      reached: Boolean(request.paymentPromptedAt) || normalizeField(request.paymentStatus).toUpperCase() !== "NOT_PAID",
      reachedDetail: `Approved payment path is open with status ${labelUiStatus("paymentStatus", request.paymentStatus || "PENDING")}.`,
      pendingDetail: "Final service payment is still locked."
    },
    {
      label: "Arrival confirmed",
      reached: Boolean(request.arrivalConfirmedAt || request.arrivedAt),
      reachedDetail: `Arrival was confirmed${request.arrivalConfirmedAt || request.arrivedAt ? ` at ${formatTimestamp(request.arrivalConfirmedAt || request.arrivedAt)}` : ""}.`,
      pendingDetail: "Provider arrival has not been confirmed yet."
    },
    {
      label: "Service completed",
      reached: Boolean(request.completionConfirmedAt || request.completedAt || normalizeField(request.completionStatus).toUpperCase() === "COMPLETED"),
      reachedDetail: `Service is marked ${labelUiStatus("requestStatus", request.completionStatus || request.status || "COMPLETED")}.`,
      pendingDetail: "Service completion is not confirmed yet."
    }
  ];

  return steps.map((step) => ({
    label: step.label,
    detail: step.reached ? step.reachedDetail : step.pendingDetail
  }));
}

function renderProviderWorkflowSummary() {
  const requests = Array.isArray(state.providerQueue) ? state.providerQueue : [];
  const queuedRequests = Array.isArray(state.providerWorkflow?.queue?.queued)
    ? state.providerWorkflow.queue.queued
    : requests.filter((request) => normalizeField(request.status).toUpperCase() === "SUBMITTED");
  const inProgressRequests = Array.isArray(state.providerWorkflow?.queue?.inProgress)
    ? state.providerWorkflow.queue.inProgress
    : requests.filter((request) => ["ASSIGNED", "EN_ROUTE", "ARRIVED", "PAUSED"].includes(normalizeField(request.status).toUpperCase()));
  const completedRequests = buildClosedProviderRequests(
    Array.isArray(state.providerWorkflow?.queue?.completed) ? state.providerWorkflow.queue.completed : [],
    requests
  );
  const openCount = queuedRequests.length;
  const engagedCount = inProgressRequests.length;
  const activeRequest = inProgressRequests[0] || queuedRequests[0] || completedRequests[0] || null;
  const hoursSummary = formatProviderHours(state.auth?.profile || { providerProfile: { hoursOfService: state.providerWorkflow?.provider?.hoursOfService || null } });
  const overview = requests.length
    ? `Queue has ${requests.length} eligible request(s): ${openCount} open and ${engagedCount} already moving through dispatch.`
    : "Sign in as an approved provider and load the queue to see open dispatch work.";
  const queueSummary = activeRequest
    ? `${labelServiceType(activeRequest.serviceType || "Service")} for ${activeRequest.fullName || "customer"} is the next workflow item.`
    : "No active dispatch is selected yet.";
  const guidance = activeRequest
    ? buildProviderWorkflowGuidance(activeRequest)
    : "Accept the request first, then send a soft ETA. Do not ask for direct payment or direct contact outside the staged dispatch flow.";
  const activeSummary = activeRequest
    ? `${labelUiStatus("requestStatus", activeRequest.status || "SUBMITTED")} · ${activeRequest.location || "Location pending"} · ${Number.isFinite(Number(activeRequest.softEtaMinutes)) ? `soft ETA ${Number(activeRequest.softEtaMinutes)} min` : "soft ETA not sent yet"}.`
    : "No provider request is active yet.";
  const disclosure = activeRequest
    ? `Location access is ${prettifyToken(activeRequest.locationDisclosureLevel || "masked")} and contact access is ${prettifyToken(activeRequest.contactDisclosureLevel || "locked")}.`
    : "Customer callback and detailed location remain staged until dispatch opens them.";

  setText("provider-work-overview", overview);
  setText("provider-work-queue-summary", queueSummary);
  setText("provider-work-guidance", guidance);
  setText("provider-active-request-summary", activeSummary);
  setText("provider-active-request-disclosure", disclosure);
  setText("provider-work-hours-summary", hoursSummary);
  setText("provider-open-queue-count", String(openCount));
  setText("provider-engaged-queue-count", String(engagedCount));
  setText("provider-total-queue-count", String(requests.length));

  renderList(
    "provider-work-timeline",
    activeRequest ? buildServiceStatusTimeline(activeRequest) : [],
    (entry) => `<div class="item">
      <div class="value">${escapeHtml(entry.label)}</div>
      <div class="muted">${escapeHtml(entry.detail)}</div>
    </div>`,
    "No active provider dispatch is available yet."
  );
}

function renderProviderWorkLog() {
  const queuedRequests = Array.isArray(state.providerWorkflow?.queue?.queued)
    ? state.providerWorkflow.queue.queued
    : state.providerQueue.filter((request) => normalizeField(request.status).toUpperCase() === "SUBMITTED");
  const inProgressRequests = Array.isArray(state.providerWorkflow?.queue?.inProgress)
    ? state.providerWorkflow.queue.inProgress
    : state.providerQueue.filter((request) => ["ASSIGNED", "EN_ROUTE", "ARRIVED", "PAUSED"].includes(normalizeField(request.status).toUpperCase()));
  const completedRequests = buildClosedProviderRequests(
    Array.isArray(state.providerWorkflow?.queue?.completed) ? state.providerWorkflow.queue.completed : [],
    state.providerQueue
  );

  const renderRequestLogItem = (request) => `<div class="item">
    <div class="value">${escapeHtml(labelServiceType(request.serviceType || "Service"))} · ${escapeHtml(request.requestId || request.id || "pending")}</div>
    <div class="muted">${escapeHtml(request.fullName || "Customer")} · ${escapeHtml(labelUiStatus("requestStatus", request.status || "UNKNOWN"))}</div>
    <div class="muted">${escapeHtml(request.location || "Location pending")} · ${escapeHtml(request.vehicleSummary || formatVehicleSummary(request.vehicleInfo || {}))}</div>
    <div class="muted">Payment: ${escapeHtml(labelUiStatus("paymentStatus", request.paymentStatus || "UNKNOWN"))} · Payout: ${escapeHtml(labelUiStatus("payoutStatus", request.providerPayoutStatus || "UNASSIGNED"))}</div>
  </div>`;

  renderList("provider-work-queue-list", queuedRequests, renderRequestLogItem, "No queued jobs.");
  renderList("provider-work-progress-list", inProgressRequests, renderRequestLogItem, "No jobs are in progress.");
  renderList("provider-work-completed-list", completedRequests, renderRequestLogItem, "No closed jobs are recorded yet.");
}

function buildClosedProviderRequests(primaryRequests, allRequests) {
  const closedById = new Map();
  const append = (entries) => {
    (Array.isArray(entries) ? entries : []).forEach((request) => {
      const status = normalizeField(request?.status).toUpperCase();
      if (!["COMPLETED", "CANCELLED"].includes(status)) {
        return;
      }
      const key = String(request.requestId || request.id || Math.random());
      if (!closedById.has(key)) {
        closedById.set(key, request);
      }
    });
  };
  append(primaryRequests);
  append(allRequests);
  return [...closedById.values()];
}

function buildProviderWorkflowGuidance(request) {
  const status = normalizeField(request?.status).toUpperCase();
  const pendingServiceChange = readPendingServiceTypeChange(request);
  if (pendingServiceChange) {
    return `Customer requested a change to ${labelServiceType(pendingServiceChange.requestedServiceType || "Service")}. Approve it only if you can safely perform that service, or deny it so dispatch can reassess.`;
  }
  if (status === "SUBMITTED") {
    return "Accept the request, record a realistic soft ETA, and keep communication inside dispatch-safe notes until the next stage unlocks.";
  }
  if (status === "ASSIGNED") {
    return "Send the soft ETA now. Do not request direct payment or full contact release until dispatch opens the next stage.";
  }
  if (status === "EN_ROUTE" && !request.directCommunicationEnabled) {
    return "Continue en route on the soft ETA stage. Customer callback and exact location remain restricted until dispatch unlocks them.";
  }
  if (status === "EN_ROUTE" && request.directCommunicationEnabled) {
    return "Hard ETA and direct contact are unlocked. Keep payment inside the approved platform flow and continue toward arrival confirmation.";
  }
  if (status === "ARRIVED") {
    return "Confirm arrival, complete the work, and record only customer-safe notes in the dispatch log.";
  }
  return "Dispatch workflow is active. Keep ETA, contact, and payment inside the approved staged process.";
}

function formatRequestGpsSummary(request) {
  const coordinates = request?.locationCoordinates;
  if (!coordinates || !Number.isFinite(Number(coordinates.longitude)) || !Number.isFinite(Number(coordinates.latitude))) {
    return request?.locationDisclosureLevel === "EXACT"
      ? "GPS coordinates are not available for this request."
      : "GPS remains masked until the hard ETA release stage.";
  }
  const accuracy = normalizeField(request?.locationAccuracy);
  return `GPS ${Number(coordinates.latitude).toFixed(5)}, ${Number(coordinates.longitude).toFixed(5)}${accuracy ? ` · ${accuracy}` : ""}`;
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
  const etaField = document.getElementById(`provider-eta-${requestId}`);
  const noteValue = normalizeField(noteField?.value);
  const etaValue = normalizeField(etaField?.value);
  if (["eta", "soft-eta", "hard-eta", "extend-eta"].includes(action)) {
    const etaMinutes = Number.parseInt(etaValue, 10);
    if (!Number.isFinite(etaMinutes) || etaMinutes <= 0) {
      throw new Error("Enter a valid ETA in minutes before sending the ETA update.");
    }
    payload.etaMinutes = etaMinutes;
  }
  if (action === "paused" && noteValue) {
    payload.pauseReason = noteValue;
  }
  if (action === "note") {
    payload.note = noteValue || "Frontend provider note";
  } else if (noteValue) {
    payload.note = noteValue;
  } else {
    payload.note = `frontend provider action: ${action}`;
  }
  return payload;
}

function renderRequestActionPanels(request) {
  renderRequestActionPanel("customer", request);
  renderRequestActionPanel("subscriber", request);
}

function renderRequestActionPanel(surface, request) {
  const container = document.getElementById(`${surface}-request-actions`);
  if (!container) {
    return;
  }

  const statusId = `${surface}-request-action-status`;
  if (!request) {
    container.innerHTML = '<div class="muted">Sign in as the subscriber who placed the request to request a service type change or cancel the request.</div>';
    hideBox(statusId);
    return;
  }

  const requestId = request.requestId || request.id || "pending";
  const pendingServiceChange = readPendingServiceTypeChange(request);
  const serviceChangeSummary = buildServiceChangeSummary(request, { includeReviewedOutcome: true });
  const canManageRequest = requestBelongsToSignedInSubscriber(request);
  const closedRequest = isRequestClosed(request);
  const paidRequest = isPaymentCaptured(request);

  if (!canManageRequest) {
    container.innerHTML = `<div class="muted">Request ${escapeHtml(requestId)} is active. Sign in as the subscriber who placed it to request a service type change or cancel the service.</div>`;
    hideBox(statusId);
    return;
  }

  if (closedRequest) {
    container.innerHTML = `<div class="muted">Request ${escapeHtml(requestId)} is closed.${serviceChangeSummary ? ` ${escapeHtml(serviceChangeSummary)}` : ""}</div>`;
    hideBox(statusId);
    return;
  }

  const currentServiceType = normalizeField(request.serviceType);
  const serviceOptions = readAvailableServiceTypes()
    .filter((value) => normalizeField(value).toUpperCase() !== currentServiceType.toUpperCase())
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labelServiceType(value))}</option>`)
    .join("");

  container.innerHTML = `
    <div class="muted">Service changes require provider or admin approval. Cancelling after payment does not create a refund.</div>
    ${serviceChangeSummary ? `<div class="muted">${escapeHtml(serviceChangeSummary)}</div>` : ""}
    <label>
      <span>Request different service type</span>
      <select class="field" id="${surface}-request-change-service-type">
        <option value="">Select updated service type</option>
        ${serviceOptions}
      </select>
    </label>
    <label>
      <span>Service change note</span>
      <textarea class="field area" id="${surface}-request-change-note" placeholder="Why should dispatch change this service type?"></textarea>
    </label>
    <div class="button-pair">
      <button class="glow-button compact" type="button" data-customer-request-action="request-service-change" data-request-surface="${surface}" ${pendingServiceChange ? "disabled" : ""}>Request Service Change</button>
      <button class="glow-button danger compact" type="button" data-customer-request-action="cancel-service" data-request-surface="${surface}">Cancel Service</button>
    </div>
    <label>
      <span>Cancellation note</span>
      <textarea class="field area" id="${surface}-request-cancel-reason" placeholder="Optional reason for cancellation"></textarea>
    </label>
    ${paidRequest ? `
      <label>
        <span>Account password</span>
        <input class="field" id="${surface}-request-cancel-password" type="password" placeholder="Confirm account password"/>
      </label>
      <label class="toggle">
        <input type="checkbox" id="${surface}-request-no-refund"/>
        <span>I understand this paid service cancellation does not issue a refund.</span>
      </label>
    ` : `<div class="muted">If payment has already been captured, password confirmation and no-refund acknowledgement are required before cancellation.</div>`}
  `;
  hideBox(statusId);
}

function readAvailableServiceTypes() {
  const values = new Set();
  document.querySelectorAll('#service-type option, #subscriber-request-form select[name="serviceType"] option').forEach((option) => {
    const value = normalizeField(option.value || option.textContent);
    if (value) {
      values.add(value);
    }
  });
  if (!values.size) {
    ["Jump Start", "Lockout", "Tire Change", "Gas Delivery", "Battery Install"].forEach((value) => values.add(value));
  }
  return [...values];
}

function setServicePaymentControlsState(request) {
  const disabled = !request || isRequestClosed(request);
  const quoteButton = document.getElementById("service-payment-quote-button");
  const agreeButton = document.getElementById("service-payment-agree-button");
  if (quoteButton) {
    quoteButton.disabled = disabled;
  }
  if (agreeButton) {
    agreeButton.disabled = disabled;
  }
}

function readPendingServiceTypeChange(request) {
  const pendingChange = request?.pendingServiceTypeChange;
  if (!pendingChange || typeof pendingChange !== "object") {
    return null;
  }
  return normalizeField(pendingChange.approvalStatus).toUpperCase() === "PENDING" ? pendingChange : null;
}

function readReviewedServiceTypeChange(request) {
  const reviewedChange = request?.lastServiceTypeChange;
  return reviewedChange && typeof reviewedChange === "object" ? reviewedChange : null;
}

function buildServiceChangeSummary(request, { includeReviewedOutcome = false } = {}) {
  const pendingChange = readPendingServiceTypeChange(request);
  if (pendingChange) {
    return `Service change to ${labelServiceType(pendingChange.requestedServiceType || "Service")} is pending provider or admin approval.`;
  }
  if (!includeReviewedOutcome) {
    return "";
  }
  const reviewedChange = readReviewedServiceTypeChange(request);
  if (!reviewedChange) {
    return "";
  }
  const reviewStatus = normalizeField(reviewedChange.approvalStatus).toUpperCase();
  if (reviewStatus === "APPROVED") {
    return `Last service change to ${labelServiceType(reviewedChange.requestedServiceType || request?.serviceType || "Service")} was approved${reviewedChange.reviewedAt ? ` at ${formatTimestamp(reviewedChange.reviewedAt)}` : ""}.`;
  }
  if (reviewStatus === "DENIED") {
    return `Last service change to ${labelServiceType(reviewedChange.requestedServiceType || "Service")} was denied${reviewedChange.reviewedAt ? ` at ${formatTimestamp(reviewedChange.reviewedAt)}` : ""}.`;
  }
  return "";
}

function isPaymentCaptured(request) {
  return normalizeField(request?.paymentStatus).toUpperCase() === "CAPTURED";
}

function isRequestClosed(request) {
  const status = normalizeField(request?.status).toUpperCase();
  const completionStatus = normalizeField(request?.completionStatus).toUpperCase();
  return ["COMPLETED", "CANCELLED", "EXPIRED"].includes(status) ||
    ["COMPLETED", "CONFIRMED_BY_CUSTOMER", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_ADMIN"].includes(completionStatus);
}

function requestBelongsToSignedInSubscriber(request) {
  if (!state.auth?.sessionToken || !Array.isArray(state.auth?.roles) || !state.auth.roles.includes("SUBSCRIBER")) {
    return false;
  }
  const requestUserId = Number(request?.userId);
  const authUserId = Number(state.auth?.userId);
  return Number.isInteger(requestUserId) && Number.isInteger(authUserId) && requestUserId === authUserId;
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
    return "Service payment will unlock once dispatch confirms the next ETA stage.";
  }
  if (normalized.includes("soft eta")) {
    return "Service payment will unlock once dispatch records the working ETA and the customer accepts it.";
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
  if (normalized.includes("no refund will be issued")) {
    return "Paid cancellation requires confirming that no refund will be issued.";
  }
  if (normalized.includes("account password verification is required to cancel a paid service")) {
    return "Enter the account password to confirm cancellation of this paid service. No refund will be issued.";
  }
  if (normalized.includes("service type change is already pending review")) {
    return "A service change request is already waiting for provider or admin review.";
  }
  if (normalized.includes("no pending service type change is available for review")) {
    return "There is no pending service change left to review on this request.";
  }
  if (normalized.includes("assigned provider is not enabled for the requested service type")) {
    return "The assigned provider cannot approve the requested service type.";
  }
  if (normalized.includes("requested service type already matches the active request")) {
    return "Choose a different service type before sending a change request.";
  }
  if (normalized.includes("only the subscriber who placed the request can cancel this paid service")) {
    return "Only the subscriber who placed this request can cancel the paid service.";
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
