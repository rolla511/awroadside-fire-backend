import { writeFile } from "node:fs/promises";

const origin = "https://awroadside-fire-frontend.onrender.com";
const backend = "https://awroadside-fire-backend.onrender.com";
const results = [];
async function probe(name, url, expected, options = {}) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
    const text = await response.text();
    const pass = expected.includes(response.status);
    results.push({ name, url, status: response.status, pass, contentType: response.headers.get("content-type") });
    return { response, text };
  } catch (error) { results.push({ name, url, pass: false, error: error.message }); return {}; }
}
const home = await probe("Supplied home URL", `${origin}/home`, [200]);
const pages = ["home.html", "provider.html", "provider-signup.html", "provider-info.html", "provider-work.html", "provider-requests.html", "provider-wallet.html", "admin.html", "admin-dashboard.html", "frontend-index.js", "app.js", "awroadside-fire-style.css"];
for (const page of pages) {
  const result = await probe(`Static ${page}`, `${origin}/${page}`, [200]);
  if (page === "app.js" && result.text) {
    for (const [name, needle] of [["VIP identity handler", 'username === "vipprovider"'], ["Admin fallback login", "tryAdminFallbackLogin"], ["Provider request navigation", "setupProviderDispatchNavigation"]]) results.push({ name, pass: result.text.includes(needle) });
  }
}
results.push({ name: "Frontend points to expected backend", pass: home.text?.includes(backend) === true });
for (const [route, expected] of [["/api/aw-roadside/health", [200]], ["/api/aw-roadside/frontend-config", [200]], ["/api/admin/dashboard", [401, 403]], ["/api/aw-roadside/auth/profile", [401, 403]], ["/api/aw-roadside/provider/workflow", [401, 403]], ["/api/aw-roadside/provider/wallet", [401, 403]], ["/api/aw-roadside/requests", [401, 403]]]) {
  const result = await probe(`Frontend API route ${route}`, backend + route, expected, { headers: { Origin: origin } });
  if (result.response) results.push({ name: `CORS allows frontend ${route}`, pass: [origin, "*"].includes(result.response.headers.get("access-control-allow-origin")) });
}
for (const route of ["/api/admin/login", "/api/aw-roadside/auth/login"]) {
  const result = await probe(`Login CORS preflight ${route}`, backend + route, [200, 204], { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization" } });
  if (result.response) results.push({ name: `Login preflight permits origin ${route}`, pass: [origin, "*"].includes(result.response.headers.get("access-control-allow-origin")) });
}
const passed = results.filter(result => result.pass).length;
await writeFile("STATIC_ACCESS_TEST_RESULTS.json", JSON.stringify({ testedAt: new Date().toISOString(), origin, backend, results }, null, 2));
const report = `# Static frontend access test\n\n${passed} passed; ${results.length - passed} failed.\n\nTarget: ${origin}/home\n\nHTTP static delivery, frontend source features, actual configured API aliases, and cross-origin headers were checked. No real credentials were sent. Authenticated deployed login, user attributes, and successful task lifecycle remain unverified. These checks are not browser interaction tests. Prior local authenticated results are in ADMIN_VIP_TEST_REPORT.md.\n\n## Failures\n\n${results.filter(result => !result.pass).map(result => `- ${result.name}: ${result.status || result.error || "assertion failed"}`).join("\n")}\n`;
await writeFile("STATIC_ACCESS_TEST_REPORT.md", report);
console.log(report);
