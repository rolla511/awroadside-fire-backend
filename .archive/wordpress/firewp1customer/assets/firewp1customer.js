const firewp1customerConfig = window.FireWp1CustomerConfig || {};
const FIREWP1_SESSION_KEY = "firewp1-auth-session";

document.addEventListener("DOMContentLoaded", () => {
  wireLinks();
  restoreSession();
  loadBootstrap().catch((error) => {
    setText("firewp1customer-backend-status", "OFF");
    setText("firewp1customer-backend-detail", error.message);
    showBox("firewp1customer-request-status", error.message);
  });
  setupSignin();
  setupRequestForm();
  setupSubscriberForm();
  maybeHighlightSubscription();
});

async function loadBootstrap() {
  const [health, config] = await Promise.all([
    fetchJson(firewp1customerConfig.bootstrapHealthUrl),
    fetchJson(firewp1customerConfig.bootstrapFrontendConfigUrl)
  ]);

  setText("firewp1customer-backend-status", String(health.status || "ok").toUpperCase());
  setText("firewp1customer-backend-detail", "Service is available");
  setText(
    "firewp1customer-priority-price",
    formatUsd(config?.priorityServicePrice || firewp1customerConfig.frontendConfig?.priorityServicePrice || 25)
  );
}

function setupSignin() {
  const form = document.getElementById("firewp1customer-signin-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(form);
      const payload = await fetchJson(`${firewp1customerConfig.authApiBaseUrl}/auth/login`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          identifier: normalizeField(formData.get("identifier")),
          password: normalizeField(formData.get("password"))
        })
      });
      storeSession(payload);
      renderSession(payload);
      await refreshSubscriberState();
      await refreshRequestHistory();
      showBox("firewp1customer-signin-status", "Signed in.");
    } catch (error) {
      showBox("firewp1customer-signin-status", error.message);
    }
  });
}

function setupRequestForm() {
  const form = document.getElementById("firewp1customer-request-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(form);
      const session = readSession();
      const url = session?.token ? firewp1customerConfig.requestMemberUrl : firewp1customerConfig.requestGuestUrl;
      const payload = await fetchJson(url, {
        method: "POST",
        headers: jsonHeaders(session?.token),
        body: JSON.stringify({
          subscriberActive: Boolean(session?.subscriberActive),
          fullName: normalizeField(formData.get("fullName")),
          phoneNumber: normalizeField(formData.get("phoneNumber")),
          serviceType: normalizeField(formData.get("serviceType")),
          location: normalizeField(formData.get("location")),
          notes: normalizeField(formData.get("notes"))
        })
      });

      const requestId = payload.requestId || payload.id || "created";
      showBox("firewp1customer-request-status", `Request submitted. Reference ${requestId}.`);
      await refreshRequestHistory();
    } catch (error) {
      showBox("firewp1customer-request-status", error.message);
    }
  });
}

function setupSubscriberForm() {
  const form = document.getElementById("firewp1customer-subscribe-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const session = readSession();
      if (!session?.token) {
        throw new Error("Sign in first to activate subscriber status.");
      }

      const formData = new FormData(form);
      const payload = await fetchJson(firewp1customerConfig.subscriptionStartUrl, {
        method: "POST",
        headers: jsonHeaders(session.token),
        body: JSON.stringify({
          year: normalizeField(formData.get("year")),
          make: normalizeField(formData.get("make")),
          model: normalizeField(formData.get("model")),
          color: normalizeField(formData.get("color")),
          paymentMethodMasked: normalizeField(formData.get("paymentMethodMasked"))
        })
      });

      showBox("firewp1customer-subscribe-status", "Subscriber profile activated.");
      storeSession({
        ...session,
        subscriberActive: Boolean(payload?.subscriberActive)
      });
      await refreshSubscriberState();
    } catch (error) {
      showBox("firewp1customer-subscribe-status", error.message);
    }
  });
}

function wireLinks() {
  setLink("firewp1customer-home-link", firewp1customerConfig.homePageUrl);
  setLink("firewp1customer-provider-link", firewp1customerConfig.providerPageUrl);
}

function restoreSession() {
  const session = readSession();
  renderSession(session);
  if (session?.token) {
    void refreshSubscriberState();
    void refreshRequestHistory();
  }
}

async function refreshSubscriberState() {
  const session = readSession();
  if (!session?.token) {
    setText("firewp1customer-subscriber-state", "Subscriber inactive");
    setText("firewp1customer-subscriber-detail", "Sign in to load subscriber status and saved vehicle information.");
    return;
  }

  try {
    const payload = await fetchJson(firewp1customerConfig.subscriptionStatusUrl, {
      headers: jsonHeaders(session.token)
    });
    const active = Boolean(payload.subscriberActive);
    setText("firewp1customer-subscriber-state", active ? "Subscriber active" : "Subscriber inactive");
    setText(
      "firewp1customer-subscriber-detail",
      payload?.subscriberProfile?.vehicle
        ? `Vehicle on file: ${payload.subscriberProfile.vehicle.year} ${payload.subscriberProfile.vehicle.make} ${payload.subscriberProfile.vehicle.model} (${payload.subscriberProfile.vehicle.color})`
        : "No saved vehicle loaded yet."
    );
  } catch (error) {
    setText("firewp1customer-subscriber-state", "Subscriber status unavailable");
    setText("firewp1customer-subscriber-detail", error.message);
  }
}

async function refreshRequestHistory() {
  const list = document.getElementById("firewp1customer-history-list");
  if (!list) {
    return;
  }

  const session = readSession();
  if (!session?.token) {
    list.innerHTML = '<p class="firewp1customer-empty">Guest requests are not stored in a member history list.</p>';
    return;
  }

  try {
    const payload = await fetchJson(firewp1customerConfig.requestHistoryUrl, {
      headers: jsonHeaders(session.token)
    });
    const requests = Array.isArray(payload.requests) ? payload.requests : [];
    if (requests.length === 0) {
      list.innerHTML = '<p class="firewp1customer-empty">No member requests recorded yet.</p>';
      return;
    }

    list.innerHTML = requests
      .map((request) => {
        const requestId = escapeHtml(request.requestId || request.id || "pending");
        const serviceType = escapeHtml(request.serviceType || "Roadside");
        const status = escapeHtml(request.status || request.completionStatus || "SUBMITTED");
        const location = escapeHtml(request.location || "Unknown location");
        return `<article class="firewp1customer-list-item"><strong>${serviceType}</strong><span>${requestId}</span><small>${status} · ${location}</small></article>`;
      })
      .join("");
  } catch (error) {
    list.innerHTML = `<p class="firewp1customer-empty">${escapeHtml(error.message)}</p>`;
  }
}

function renderSession(session) {
  const roles = Array.isArray(session?.roles) ? session.roles : [];
  const roleLabel = roles.length > 0 ? roles.join(", ") : "Guest";
  setText("firewp1customer-session-role", roleLabel);
  setText(
    "firewp1customer-session-detail",
    session?.token
      ? `Backend session restored${session.email ? ` for ${session.email}` : ""}.`
      : "No backend session restored yet"
  );
}

function readSession() {
  try {
    const raw = window.localStorage.getItem(FIREWP1_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function storeSession(payload) {
  const existing = readSession() || {};
  const token = normalizeField(payload?.sessionToken || payload?.token || existing.token);
  if (!token) {
    return;
  }

  window.localStorage.setItem(
    FIREWP1_SESSION_KEY,
    JSON.stringify({
      token,
      userId: payload?.userId || existing.userId || null,
      email: payload?.email || existing.email || "",
      roles: Array.isArray(payload?.roles) ? payload.roles : existing.roles || [],
      subscriberActive:
        typeof payload?.subscriberActive === "boolean" ? payload.subscriberActive : Boolean(existing.subscriberActive),
      providerStatus: payload?.providerStatus || existing.providerStatus || null
    })
  );
}

function maybeHighlightSubscription() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("intent") !== "subscribe") {
    return;
  }
  const panel = document.getElementById("firewp1customer-subscribe-panel");
  if (panel) {
    panel.classList.add("firewp1customer-emphasis");
    panel.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

function setLink(id, url) {
  const element = document.getElementById(id);
  if (element && url) {
    element.href = url;
  }
}

async function fetchJson(url, options = {}) {
  if (!url) {
    throw new Error("Missing API URL.");
  }

  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Request failed with ${response.status}.`);
  }
  return payload;
}

function jsonHeaders(token = "") {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function showBox(id, message) {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }
  element.hidden = false;
  element.textContent = message;
}

function normalizeField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatUsd(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(amount) || 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
