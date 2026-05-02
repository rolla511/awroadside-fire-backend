const firewp1adminConfig = window.FireWp1AdminConfig || {};
const FIREWP1_ADMIN_SESSION_KEY = "firewp1-admin-session";

document.addEventListener("DOMContentLoaded", () => {
  wireLinks();
  restoreSession();
  loadBootstrap().catch((error) => {
    setText("firewp1admin-backend-status", "OFF");
    setText("firewp1admin-backend-detail", error.message);
    showBox("firewp1admin-signin-status", error.message);
  });
  setupSignin();
  setupRefresh();
});

async function loadBootstrap() {
  const health = await fetchJson(firewp1adminConfig.bootstrapHealthUrl);
  setText("firewp1admin-backend-status", String(health.status || "ok").toUpperCase());
  setText("firewp1admin-backend-detail", "Service is available");
}

function setupSignin() {
  const form = document.getElementById("firewp1admin-signin-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(form);
      const payload = await fetchJson(firewp1adminConfig.adminLoginUrl, {
        method: "POST",
        headers: jsonHeaders("", {
          "x-location-zone": normalizeField(formData.get("locationZone")) || "HOME_BASE",
          "x-2fa-verified": "true"
        }),
        body: JSON.stringify({
          email: normalizeField(formData.get("email")),
          password: normalizeField(formData.get("password")),
          twoFactorCode: normalizeField(formData.get("twoFactorCode")),
          locationZone: normalizeField(formData.get("locationZone")) || "HOME_BASE"
        })
      });
      storeSession(payload, normalizeField(formData.get("locationZone")) || "HOME_BASE");
      renderSession(readSession());
      await refreshAdminData();
      showBox("firewp1admin-signin-status", "Admin signed in.");
    } catch (error) {
      showBox("firewp1admin-signin-status", error.message);
    }
  });
}

function setupRefresh() {
  const button = document.getElementById("firewp1admin-refresh");
  if (!button) {
    return;
  }
  button.addEventListener("click", () => {
    void refreshAdminData();
  });
}

function wireLinks() {
  setLink("firewp1admin-home-link", firewp1adminConfig.homePageUrl);
  setLink("firewp1admin-provider-link", firewp1adminConfig.providerPageUrl);
  setLink("firewp1admin-subscriber-link", firewp1adminConfig.subscriberPageUrl);
}

function restoreSession() {
  renderSession(readSession());
  void refreshAdminData();
}

async function refreshAdminData() {
  const session = readSession();
  if (!session?.token) {
    setText("firewp1admin-request-count", "0");
    setText("firewp1admin-request-summary", "Admin sign-in required");
    setText("firewp1admin-dashboard-status", "Admin sign-in required");
    setText("firewp1admin-dashboard-detail", "Dashboard metrics will load after a valid admin session is established.");
    renderFinancials([]);
    renderSubscribers([]);
    return;
  }

  try {
    const [dashboard, requestsPayload, subscribersPayload] = await Promise.all([
      fetchJson(firewp1adminConfig.adminDashboardUrl, {
        headers: adminHeaders(session)
      }),
      fetchJson(firewp1adminConfig.adminRequestsUrl, {
        headers: adminHeaders(session)
      }),
      fetchJson(firewp1adminConfig.adminSubscribersUrl, {
        headers: adminHeaders(session)
      })
    ]);

    const financials = Array.isArray(requestsPayload.financials) ? requestsPayload.financials : [];
    const subscribers = Array.isArray(subscribersPayload.subscribers) ? subscribersPayload.subscribers : [];

    setText("firewp1admin-request-count", String(financials.length));
    setText("firewp1admin-request-summary", financials.length > 0 ? "Financial records loaded." : "No financial records available.");
    setText("firewp1admin-dashboard-status", "Dashboard connected");
    setText(
      "firewp1admin-dashboard-detail",
      dashboard?.startedAt ? `Runtime active since ${dashboard.startedAt}.` : "Runtime dashboard loaded."
    );
    setText("firewp1admin-payouts-pending", String(dashboard?.overview?.payoutsPending || 0));
    setText("firewp1admin-subscriber-count", String(subscribers.length));
    setText("firewp1admin-watchdog-state", dashboard?.watchdog?.active ? "Active" : "Unknown");

    renderFinancials(financials);
    renderSubscribers(subscribers);
  } catch (error) {
    showBox("firewp1admin-work-status", error.message);
  }
}

function renderFinancials(financials) {
  const list = document.getElementById("firewp1admin-financials");
  if (!list) {
    return;
  }
  if (!Array.isArray(financials) || financials.length === 0) {
    list.innerHTML = '<p class="firewp1admin-empty">No financial records available yet.</p>';
    return;
  }

  list.innerHTML = financials.map((entry) => {
    const requestId = escapeHtml(entry.requestId || "pending");
    const fullName = escapeHtml(entry.fullName || "Customer");
    const tier = escapeHtml(entry.customerTier || "GUEST");
    const payout = formatUsd(entry.providerPayoutAmount || 0);
    const platform = formatUsd(entry.platformShareAmount || 0);
    const charged = formatUsd(entry.amountCharged || 0);
    const payoutStatus = escapeHtml(entry.providerPayoutStatus || "UNASSIGNED");
    return `<article class="firewp1admin-list-item"><strong>${requestId} · ${fullName}</strong><span>${tier} · Charged ${escapeHtml(charged)}</span><small>Provider payout ${escapeHtml(payout)} · Platform ${escapeHtml(platform)} · ${payoutStatus}</small></article>`;
  }).join("");
}

function renderSubscribers(subscribers) {
  const list = document.getElementById("firewp1admin-subscribers");
  if (!list) {
    return;
  }
  if (!Array.isArray(subscribers) || subscribers.length === 0) {
    list.innerHTML = '<p class="firewp1admin-empty">No subscriber records available yet.</p>';
    return;
  }

  list.innerHTML = subscribers.map((entry) => {
    const name = escapeHtml(entry.fullName || entry.email || "Subscriber");
    const userId = escapeHtml(String(entry.userId || entry.id || "pending"));
    const requests = escapeHtml(String(entry.requestCount || 0));
    const state = escapeHtml(entry.accountState || "ACTIVE");
    return `<article class="firewp1admin-list-item"><strong>${name}</strong><span>User ${userId}</span><small>${requests} requests · ${state}</small></article>`;
  }).join("");
}

function renderSession(session) {
  setText("firewp1admin-session-role", session?.token ? "Admin" : "Offline");
  setText(
    "firewp1admin-session-detail",
    session?.token ? `Admin session restored${session.email ? ` for ${session.email}` : ""}.` : "No admin session restored yet"
  );
}

function readSession() {
  try {
    const raw = window.localStorage.getItem(FIREWP1_ADMIN_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function storeSession(payload, locationZone) {
  const token = normalizeField(payload?.token || payload?.sessionToken);
  if (!token) {
    return;
  }
  window.localStorage.setItem(
    FIREWP1_ADMIN_SESSION_KEY,
    JSON.stringify({
      token,
      email: payload?.email || "",
      locationZone,
      trustedZone: payload?.trustedZone || locationZone || "HOME_BASE"
    })
  );
}

function adminHeaders(session) {
  return jsonHeaders(session.token, {
    "x-location-zone": session.locationZone || session.trustedZone || "HOME_BASE",
    "x-2fa-verified": "true"
  });
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

function jsonHeaders(token = "", extra = {}) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra
  };
}

function setLink(id, url) {
  const element = document.getElementById(id);
  if (element && url) {
    element.href = url;
  }
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
