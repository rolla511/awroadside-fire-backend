const firewp1homeConfig = window.FireWp1HomeConfig || {};
const FIREWP1_SESSION_KEY = "firewp1-auth-session";

document.addEventListener("DOMContentLoaded", () => {
  wireLinks();
  loadHomeBootstrap().catch((error) => {
    setText("firewp1home-backend-status", "OFF");
    setText("firewp1home-backend-detail", error.message);
    showBox("firewp1home-signin-status", error.message);
  });
  setupSignin();
});

async function loadHomeBootstrap() {
  const [health, config] = await Promise.all([
    fetchJson(firewp1homeConfig.bootstrapHealthUrl),
    fetchJson(firewp1homeConfig.bootstrapFrontendConfigUrl)
  ]);

  setText("firewp1home-backend-status", String(health.status || "ok").toUpperCase());
  setText("firewp1home-backend-detail", "Service is available");
  setText("firewp1home-priority-price", formatUsd(config?.priorityServicePrice || firewp1homeConfig.frontendConfig?.priorityServicePrice || 25));
}

function setupSignin() {
  const form = document.getElementById("firewp1home-signin-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(form);
      const payload = await fetchJson(`${firewp1homeConfig.authApiBaseUrl}/auth/login`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          identifier: normalizeField(formData.get("identifier")),
          password: normalizeField(formData.get("password"))
        })
      });

      storeSession(payload);
      const roles = Array.isArray(payload.roles) ? payload.roles : [];
      showBox("firewp1home-signin-status", "Signed in.");

      if (roles.includes("PROVIDER")) {
        redirectTo(firewp1homeConfig.providerPageUrl);
        return;
      }

      redirectTo(firewp1homeConfig.customerPageUrl);
    } catch (error) {
      showBox("firewp1home-signin-status", error.message);
    }
  });
}

function wireLinks() {
  setLink("firewp1home-guest-link", firewp1homeConfig.customerPageUrl);
  setLink("firewp1home-subscribe-link", firewp1homeConfig.subscribePageUrl);
  setLink("firewp1home-provider-link", firewp1homeConfig.providerPageUrl);
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

function jsonHeaders() {
  return {
    "Content-Type": "application/json"
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

function redirectTo(url) {
  if (url) {
    window.location.assign(url);
  }
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

function storeSession(payload) {
  const token = normalizeField(payload?.sessionToken || payload?.token);
  if (!token) {
    return;
  }

  window.localStorage.setItem(
    FIREWP1_SESSION_KEY,
    JSON.stringify({
      token,
      userId: payload?.userId || null,
      email: payload?.email || "",
      roles: Array.isArray(payload?.roles) ? payload.roles : [],
      subscriberActive: Boolean(payload?.subscriberActive),
      providerStatus: payload?.providerStatus || null
    })
  );
}
