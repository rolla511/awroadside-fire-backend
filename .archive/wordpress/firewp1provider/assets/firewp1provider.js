const firewp1providerConfig = window.FireWp1ProviderConfig || {};
const FIREWP1_SESSION_KEY = "firewp1-auth-session";

document.addEventListener("DOMContentLoaded", () => {
  wireLinks();
  restoreSession();
  loadBootstrap().catch((error) => {
    setText("firewp1provider-backend-status", "OFF");
    setText("firewp1provider-backend-detail", error.message);
    showBox("firewp1provider-signin-status", error.message);
  });
  setupSignin();
  setupRefresh();
});

async function loadBootstrap() {
  const [health, config] = await Promise.all([
    fetchJson(firewp1providerConfig.bootstrapHealthUrl),
    fetchJson(firewp1providerConfig.bootstrapFrontendConfigUrl)
  ]);

  setText("firewp1provider-backend-status", String(health.status || "ok").toUpperCase());
  setText("firewp1provider-backend-detail", "Service is available");
  setText(
    "firewp1provider-guest-payout",
    `${formatUsd(
      resolveGuestProviderPayout(config)
    )} target payout. Guest service ${formatUsd(config?.guestServicePrice || firewp1providerConfig.frontendConfig?.guestServicePrice || 55)} less dispatch and assignment fees.`
  );
  setText(
    "firewp1provider-subscriber-payout",
    `${formatUsd(
      resolveSubscriberProviderPayout(config)
    )} target payout. Subscriber service ${formatUsd(config?.subscriberServicePrice || firewp1providerConfig.frontendConfig?.subscriberServicePrice || 40)} less assignment fee.`
  );
}

function setupSignin() {
  const form = document.getElementById("firewp1provider-signin-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(form);
      const payload = await fetchJson(firewp1providerConfig.providerLoginUrl, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          identifier: normalizeField(formData.get("identifier")),
          password: normalizeField(formData.get("password"))
        })
      });
      storeSession(payload);
      renderSession(readSession());
      await refreshJobs();
      showBox("firewp1provider-signin-status", "Provider signed in.");
    } catch (error) {
      showBox("firewp1provider-signin-status", error.message);
    }
  });
}

function setupRefresh() {
  const button = document.getElementById("firewp1provider-refresh");
  if (!button) {
    return;
  }
  button.addEventListener("click", () => {
    void refreshJobs();
  });
}

function wireLinks() {
  setLink("firewp1provider-home-link", firewp1providerConfig.homePageUrl);
  setLink("firewp1provider-customer-link", firewp1providerConfig.customerPageUrl);
}

function restoreSession() {
  renderSession(readSession());
  void refreshJobs();
}

async function refreshJobs() {
  const list = document.getElementById("firewp1provider-jobs");
  if (!list) {
    return;
  }

  const session = readSession();
  if (!session?.token || !Array.isArray(session.roles) || !session.roles.includes("PROVIDER")) {
    setText("firewp1provider-job-count", "0");
    setText("firewp1provider-job-summary", "Provider sign-in required");
    list.innerHTML = '<p class="firewp1provider-empty">Sign in as a provider to load work.</p>';
    return;
  }

  try {
    const payload = await fetchJson(firewp1providerConfig.providerJobsUrl, {
      headers: jsonHeaders(session.token)
    });
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    setText("firewp1provider-job-count", String(jobs.length));
    setText(
      "firewp1provider-job-summary",
      jobs.length > 0 ? "Jobs loaded from the backend queue." : "No open or assigned jobs right now."
    );

    if (jobs.length === 0) {
      list.innerHTML = '<p class="firewp1provider-empty">No provider jobs available right now.</p>';
      return;
    }

    list.innerHTML = jobs.map((job) => renderJobCard(job, session)).join("");
    wireJobActions();
  } catch (error) {
    setText("firewp1provider-job-count", "0");
    setText("firewp1provider-job-summary", "Jobs unavailable");
    list.innerHTML = `<p class="firewp1provider-empty">${escapeHtml(error.message)}</p>`;
  }
}

function renderJobCard(job, session) {
  const requestId = escapeHtml(job.requestId || job.id || "pending");
  const status = escapeHtml(job.status || "SUBMITTED");
  const serviceType = escapeHtml(job.serviceType || "Roadside");
  const location = escapeHtml(job.location || "Unknown location");
  const customerName = escapeHtml(job.fullName || "Customer");
  const payout = Number(job.providerPayoutAmount || job.pricing?.providerPayout || 0);
  const tier = escapeHtml(job.customerTier || job.customerType || job.pricing?.customerTier || "GUEST");
  const assignedToMe = Number(job.assignedProviderId) === Number(session.userId);
  const canAccept = !job.assignedProviderId || assignedToMe;
  const canComplete = assignedToMe && String(job.status || "").toUpperCase() !== "COMPLETED";

  return `
    <article class="firewp1provider-job-card">
      <div class="firewp1provider-job-head">
        <div>
          <strong>${serviceType}</strong>
          <span>${requestId}</span>
        </div>
        <span class="firewp1provider-pill">${status}</span>
      </div>
      <div class="firewp1provider-job-meta">
        <span>${customerName}</span>
        <small>${location}</small>
        <small>${tier} payout target: ${escapeHtml(formatUsd(payout))}</small>
      </div>
      <div class="firewp1provider-job-actions">
        ${canAccept ? `<button type="button" data-action="accept" data-request-id="${requestId}">Accept Job</button>` : ""}
        ${canComplete ? `<button type="button" data-action="finish" data-request-id="${requestId}">Mark Complete</button>` : ""}
      </div>
    </article>
  `;
}

function wireJobActions() {
  document.querySelectorAll("[data-action][data-request-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-action");
      const requestId = button.getAttribute("data-request-id");
      if (!action || !requestId) {
        return;
      }
      button.disabled = true;
      try {
        await submitJobAction(action, requestId);
        await refreshJobs();
      } catch (error) {
        showBox("firewp1provider-work-status", error.message);
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function submitJobAction(action, requestId) {
  const session = readSession();
  if (!session?.token) {
    throw new Error("Provider session required.");
  }

  const url = action === "accept" ? firewp1providerConfig.providerAcceptUrl : firewp1providerConfig.providerFinishUrl;
  const payload = await fetchJson(url, {
    method: "POST",
    headers: jsonHeaders(session.token),
    body: JSON.stringify({ requestId })
  });
  showBox(
    "firewp1provider-work-status",
    `${payload.requestId || requestId} updated: ${payload.status || payload.action || "ok"}.`
  );
}

function renderSession(session) {
  const roles = Array.isArray(session?.roles) ? session.roles : [];
  setText("firewp1provider-session-role", roles.length > 0 ? roles.join(", ") : "Guest");
  setText(
    "firewp1provider-session-detail",
    session?.token
      ? `Provider session restored${session.email ? ` for ${session.email}` : ""}.`
      : "No provider session restored yet"
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

function resolveGuestProviderPayout(config) {
  const source = config || firewp1providerConfig.frontendConfig || {};
  return Number(source.guestServicePrice || 55) - Number(source.guestDispatchFee || 10) - Number(source.assignmentFee || 2);
}

function resolveSubscriberProviderPayout(config) {
  const source = config || firewp1providerConfig.frontendConfig || {};
  return Number(source.subscriberServicePrice || 40) - Number(source.subscriberDispatchFee || 0) - Number(source.assignmentFee || 2);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
