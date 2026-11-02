import { writeFile } from "node:fs/promises";

const site = "https://awroadside-fire-frontend.onrender.com";
const home = await fetch(`${site}/home`).then(response => response.text());
const backend = home.match(/const backendOrigin =[^;]*:\s*"(https:[^"]+)"/)?.[1];
if (!backend) throw new Error("Cannot identify the frontend's configured backend");
const tests = [
  ["Guest", "Service availability", "GET", "/health", true],
  ["Guest", "Frontend configuration", "GET", "/frontend-config", true],
  ["Guest", "Pricing configuration", "GET", "/payments/config", true],
  ["Guest", "Empty request validation", "POST", "/requests"],
  ["Subscriber", "Empty signup validation", "POST", "/auth/signup"],
  ["Subscriber", "Invalid login rejection", "POST", "/auth/login", false, { identifier: "qa-nonexistent-flow@example.invalid", password: "invalid" }],
  ["Subscriber", "Profile access protection", "GET", "/auth/profile"],
  ["Subscriber", "Membership setup protection", "POST", "/auth/subscriber/setup"],
  ["Subscriber", "Profile update protection", "POST", "/auth/subscriber/profile"],
  ["Subscriber", "Password change protection", "POST", "/auth/password/change"],
  ["Subscriber", "Cancellation protection", "POST", "/auth/subscriber/cancel"],
  ["Subscriber", "Forgot password empty validation", "POST", "/auth/password/forgot"],
  ["Subscriber", "Reset password empty validation", "POST", "/auth/password/reset"],
  ["Provider / VIP", "Application access protection", "POST", "/auth/provider/apply"],
  ["Provider / VIP", "Document upload access protection", "POST", "/auth/provider/documents"],
  ["Provider / VIP", "Payout terms access protection", "POST", "/auth/provider/payout-terms"],
  ["Provider / VIP", "Work screen access protection", "GET", "/provider/workflow"],
  ["Provider / VIP", "Wallet access protection", "GET", "/provider/wallet"],
  ["Provider / VIP", "Request queue access protection", "GET", "/requests"],
  ["Provider / VIP", "PayPal connection access protection", "POST", "/providers/paypal-connect"],
  ...["accept", "soft-eta", "hard-eta", "enroute", "arrived", "completed", "note"].map(action => ["Provider / VIP", `Task ${action} access protection`, "POST", `/requests/qa-nonexistent-flow/${action}`]),
  ["Admin", "Missing login credentials", "POST", "/login"],
  ["Admin", "Dashboard access protection", "GET", "/dashboard"],
  ["Admin", "Account search access protection", "GET", "/search?q=qa-nonexistent-flow"],
  ["Admin", "Financial settings access protection", "GET", "/payments/config"],
  ["Admin", "Audit log access protection", "GET", "/admin/audit-log"]
];
const results = [];
for (const [role, flow, method, route, publicRead = false, body = {}] of tests) {
  const prefix = role === "Admin" && route !== "/admin/audit-log" ? "/api/admin" : "/api/aw-roadside";
  try {
    const response = await fetch(backend + prefix + route, { method, headers: { Origin: site, "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const text = await response.text();
    let payload; try { payload = JSON.parse(text); } catch { payload = {}; }
    results.push({ role, flow, method, route: prefix + route, status: response.status, pass: (publicRead ? response.status === 200 : [400, 401, 403, 422].includes(response.status)) && response.headers.get("content-type")?.includes("application/json"), message: payload.message || payload.error, cors: response.headers.get("access-control-allow-origin") });
  } catch (error) { results.push({ role, flow, method, route, pass: false, message: error.message }); }
}
await writeFile("SITE_USER_FLOW_RESULTS.json", JSON.stringify({ testedAt: new Date().toISOString(), site, backend, scope: "Public reads, empty invalid input and unauthenticated protection checks. No real credentials or successful business mutations sent.", results }, null, 2));
const report = `# Site user flow API checks\n\nSite: ${site}/home\nBackend derived from site configuration: ${backend}\n\n${results.filter(result => result.pass).length} checks passed; ${results.filter(result => !result.pass).length} failed.\n\nThese are HTTP/API contract checks using the site's actual methods and configured routes, not successful authenticated workflows or browser interactions. Passing access protection means the unauthenticated probe was rejected with an expected client error; it does not establish successful login or role correctness. No live credentials, purchases, real dispatches, documents or emails were submitted.\n\n| User | Flow | Method | HTTP | Result | Message |\n|---|---|---|---|---|---|\n${results.map(result => `| ${result.role} | ${result.flow} | ${result.method} | ${result.status || "network error"} | ${result.pass ? "Pass" : "Fail"} | ${(result.message || "").replaceAll("|", "/").replaceAll("\n", " ")} |`).join("\n")}\n\nAuthenticated deployed flows, paid onboarding and successful task lifecycle remain unverified. VIP is a provider variant in this four-user-type breakdown. Static pages, assets and forms are documented separately in STATIC_SITE_DIAGNOSIS.md.\n`;
await writeFile("SITE_USER_FLOW_REPORT.md", report);
console.log(report);
