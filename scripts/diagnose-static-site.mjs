import { readdir, writeFile } from "node:fs/promises";

const origin = "https://awroadside-fire-frontend.onrender.com";
const backend = "https://awroadside-fire-backend.onrender.com";
const results = [];
const pages = new Map();
const assets = new Set();
const apiRoutes = new Map();
const forms = [];
async function fetchResource(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25000) });
    return { status: response.status, type: response.headers.get("content-type") || "", text: await response.text(), cors: response.headers.get("access-control-allow-origin") };
  } catch (error) { return { status: 0, type: "", text: "", error: error.message }; }
}
function check(name, url, pass, response, details = {}) {
  results.push({ name, url, pass: Boolean(pass), status: response?.status, error: response?.error, ...details });
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1].toLowerCase(), match[2]]));
}
const filenames = (await readdir(new URL("../web/", import.meta.url))).filter(name => name.endsWith(".html"));
for (const route of ["/home", ...filenames.map(name => `/${name}`)]) {
  const url = origin + route;
  const response = await fetchResource(url);
  check("HTML page delivery", url, response.status === 200 && response.type.includes("text/html"), response);
  if (response.status !== 200) continue;
  pages.set(url, response.text);
  for (const match of response.text.matchAll(/<(?:script|img|link|a)\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const reference = attrs.src || attrs.href;
    if (!reference || /^(#|mailto:|tel:|javascript:|data:)/i.test(reference)) continue;
    const target = new URL(reference, url);
    if (target.origin === origin) { target.hash = ""; assets.add(target.href); }
  }
  for (const match of response.text.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)) {
    const form = attributes(match[0].slice(0, match[0].indexOf(">") + 1));
    const controls = [...match[0].matchAll(/<(?:input|select|textarea|button)\b[^>]*>/gi)].map(control => attributes(control[0]));
    forms.push({ page: url, id: form.id, action: form.action, controls });
    for (const control of controls.filter(control => /email/i.test(control.name || "") && control.type !== "hidden")) {
      check("Email input uses native email validation", url, control.type === "email", undefined, { form: form.id, control: control.name });
    }
  }
}
for (const url of assets) {
  const response = await fetchResource(url);
  const pathname = new URL(url).pathname;
  const expectedType = /\.m?js$/.test(pathname) ? /javascript/ : /\.css$/.test(pathname) ? /text\/css/ : /\.(png|jpg|jpeg|svg|webp|ico)$/.test(pathname) ? /image\// : null;
  check("Referenced link or asset delivery", url, response.status === 200 && (!expectedType || expectedType.test(response.type)), response);
  if (/\.m?js$/.test(pathname) && response.status === 200) {
    pages.set(url, response.text);
    for (const match of response.text.matchAll(/(?:apiFetch|adminFetch)\(\s*["'`]([^"'`$]+)["'`]/g)) {
      const admin = match[0].startsWith("adminFetch");
      const route = `${admin ? "/api/admin" : "/api/aw-roadside"}${match[1]}`;
      const key = backend + route;
      if (!apiRoutes.has(key)) apiRoutes.set(key, { admin, source: url });
    }
  }
}
for (const route of ["/api/aw-roadside/health", "/api/aw-roadside/frontend-config", "/api/aw-roadside/auth/profile", "/api/aw-roadside/provider/workflow", "/api/aw-roadside/provider/wallet", "/api/aw-roadside/requests", "/api/admin/dashboard", "/api/admin/requests", "/api/admin/subscribers", "/api/admin/payments/config"]) apiRoutes.set(backend + route, {});
for (const [url, metadata] of apiRoutes) {
  const response = await fetchResource(url, { headers: { Origin: origin } });
  const publicRoute = /\/(health|frontend-config|payments\/config|location\/config)$/.test(new URL(url).pathname) && !url.includes("/api/admin/");
  const acceptable = publicRoute ? [200] : [200, 400, 401, 403, 405, 422];
  check("Frontend API availability (GET probe)", url, acceptable.includes(response.status) && response.type.includes("application/json"), response, { ...metadata, meaning: "Availability only; 200 does not prove authorization or successful mutation" });
  check("API CORS permits static frontend", url, [origin, "*"].includes(response.cors), response);
}
const summary = { passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length, pages: pages.size, referencedResources: assets.size, forms: forms.length, apiRoutes: apiRoutes.size };
await writeFile("STATIC_SITE_DIAGNOSIS.json", JSON.stringify({ testedAt: new Date().toISOString(), origin, backend, summary, results, forms, limits: ["HTTP and source inspection; no real browser execution", "GET probes cannot establish successful POST workflows", "No real credentials transmitted; deployed subscriber/provider/VIP/admin sessions unverified", "No payments, dispatches, uploads, emails, account changes or permission changes performed"] }, null, 2));
const report = `# Static site completeness diagnosis\n\nTarget: ${origin}/home\nTested: ${new Date().toISOString()}\n\n${summary.passed} checks passed; ${summary.failed} failed. ${filenames.length + 1} page routes checked, ${assets.size} referenced resources, ${forms.length} forms inventoried, ${apiRoutes.size} API routes probed.\n\n## Scope and limits\n\nCovers guest pages and subscriber, provider, VIP and admin UI/API entry points. API tests use GET with the frontend Origin header. Expected login-only routes may return 405. A passing availability probe does not prove login, authorization correctness, successful mutation, or end-to-end task completion. Dynamic API paths are excluded from automatic extraction. Browser interactions, paid onboarding, authenticated live sessions, task lifecycle and uploads remain unverified. No real credentials or production mutations were sent.\n\n## Failures\n\n${results.filter(result => !result.pass).map(result => `- ${result.name}: ${result.url}${result.control ? ` (${result.control})` : ""}: ${result.status || result.error || "attribute mismatch"}`).join("\n")}\n\nFull per-check evidence and form inventory: STATIC_SITE_DIAGNOSIS.json.\n`;
await writeFile("STATIC_SITE_DIAGNOSIS.md", report);
console.log(report);
