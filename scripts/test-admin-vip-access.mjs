import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const results = [];
const root = path.resolve(import.meta.dirname, "..");
const runtime = await mkdtemp(path.join(tmpdir(), "aw-access-"));
const password = crypto.randomBytes(24).toString("hex");
const salt = crypto.randomBytes(16).toString("hex");
const users = JSON.parse(await readFile(path.join(root, "app/runtime/auth/users.json"), "utf8"));
const vip = users.find(user => user.username === "vipprovider");
vip.passwordHash = `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
await mkdir(path.join(runtime, "auth"));
await writeFile(path.join(runtime, "auth/users.json"), JSON.stringify(users));
const local = "http://127.0.0.1:3187";
const server = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, RUNTIME_ROOT: runtime, WEB_ROOT: path.join(root, "web"), PORT: "3187", HOST: "127.0.0.1", AW_DB_MODE: "runtime-storage", PUBLIC_BASE_URL: local, PAYPAL_ENV: "sandbox", MAIL_HOST: "disabled.invalid", REQUEST_SERVICE_API_BASE_URL: local, ADMIN_EMAIL: "qa-admin@example.invalid", ADMIN_PASSWORD: password, ADMIN_2FA_CODE: "731924" }, stdio: ["ignore", "pipe", "pipe"] });
let startup = "";
server.stdout.on("data", data => { startup += data; });
server.stderr.on("data", data => { startup += data; });
function record(target, name, pass, details = {}) { results.push({ target, name, pass: Boolean(pass), ...details }); }
async function request(base, route, method = "GET", body, token, headers = {}) {
  const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = {}; }
  return { status: response.status, data, text, headers: response.headers };
}
async function check(base, name, route, expected, method = "GET", body, token, headers) {
  try {
    const response = await request(base, route, method, body, token, headers);
    record(base, name, expected.includes(response.status), { status: response.status, expected, error: response.data.error, message: response.data.message });
    return response;
  } catch (error) { record(base, name, false, { error: error.message }); return { data: {} }; }
}
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await request(local, "/api/health"); break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  const targets = process.env.AW_TEST_LOCAL_ONLY === "true" ? [local] : [local, process.env.TEST_FRONTEND_URL || "https://awroadside-fire-backend.onrender.com"];
  for (const base of targets) {
    for (const page of ["/", "/provider.html", "/provider-info.html", "/provider-work.html", "/provider-wallet.html", "/provider-requests.html", "/provider-signup.html", "/admin.html", "/admin-dashboard.html", "/app.js"]) {
      const response = await check(base, `Static delivery ${page}`, page, [200]);
      if (page === "/app.js" && response.text) {
        record(base, "Frontend includes VIP identity handling", response.text.includes('username === "vipprovider"'));
        record(base, "Frontend includes provider dispatch navigation", response.text.includes("setupProviderDispatchNavigation"));
        record(base, "Frontend includes admin fallback login", response.text.includes("tryAdminFallbackLogin"));
      }
    }
    await check(base, "Admin missing credentials", "/admin-controller.mjs/login", [400], "POST", {});
    await check(base, "Admin invalid credentials", "/admin-controller.mjs/login", [401], "POST", { identifier: "qa-invalid@example.invalid", password: "invalid" });
    await check(base, "Provider invalid credentials", "/aw-roadside-security.mjs/auth/login", [401], "POST", { identifier: "qa-invalid@example.invalid", password: "invalid" });
    for (const route of ["/admin-controller.mjs/dashboard", "/admin-controller.mjs/requests", "/admin-controller.mjs/subscribers", "/admin-controller.mjs/search?q=vipprovider", "/aw-roadside-security.mjs/auth/profile", "/aw-roadside-security.mjs/provider/workflow", "/aw-roadside-security.mjs/provider/wallet", "/aw-roadside-security.mjs/requests"]) {
      await check(base, `Guest denied ${route}`, route, [401, 403]);
      await check(base, `Forged token denied ${route}`, route, [401, 403], "GET", undefined, "qa-invalid-token");
    }
    if (base !== local) {
      results.push({ target: base, name: "Authenticated deployed admin and VIP tests", pass: null, error: "Credential transmission requires explicit destination approval after automatic review rejection" });
      continue;
    }
    const adminCredentials = { identifier: "qa-admin@example.invalid", password, twoFactorCode: "731924" };
    const challenge = await check(base, "Admin requires 2FA outside trusted zone", "/admin-controller.mjs/login", [200], "POST", { ...adminCredentials, twoFactorCode: "" });
    record(base, "Admin challenge grants no token", challenge.data.twoFactorRequired === true && !challenge.data.token);
    const admin = await check(base, "Admin login with 2FA", "/admin-controller.mjs/login", [200], "POST", adminCredentials);
    const adminToken = admin.data.token;
    record(base, "Admin login grants ADMIN attributes", Boolean(adminToken) && admin.data.adminAccess === true && admin.data.roles?.includes("ADMIN"));
    if (adminToken) {
      for (const route of ["/dashboard", "/requests", "/subscribers", "/payments/config", "/search?q=vipprovider", `/users/${vip.id}/profile`]) await check(base, `Admin task read ${route}`, `/admin-controller.mjs${route}`, [200], "GET", undefined, adminToken);
    }
    const vipPassword = password;
    if (!vipPassword) { results.push({ target: base, name: "Authenticated VIP tests", pass: null, error: "VIP_TEST_PASSWORD unavailable; no password guessing performed" }); continue; }
    for (const identifier of ["vipprovider", "vipprovider@example.com"]) {
      const login = await check(base, `VIP login via ${identifier.includes("@") ? "email" : "username"}`, "/aw-roadside-security.mjs/auth/login", [200], "POST", { identifier, password: vipPassword });
      record(base, "VIP login attributes", login.data.roles?.includes("PROVIDER") && login.data.providerStatus === "APPROVED" && login.data.accountState === "ACTIVE");
      record(base, "Login excludes password material", !/passwordHash|scrypt\$/.test(login.text || ""));
      const token = login.data.sessionToken;
      if (!token) continue;
      for (const route of ["/auth/profile", "/provider/workflow", "/provider/wallet", "/requests"]) await check(base, `VIP task read ${route}`, `/aw-roadside-security.mjs${route}`, [200], "GET", undefined, token);
      await check(base, "VIP user token cannot impersonate admin session", "/admin-controller.mjs/dashboard", [401, 403], "GET", undefined, token);
      for (const action of ["accept", "soft-eta", "hard-eta", "enroute", "arrived", "completed", "note"]) await check(base, `Task handler ${action} rejects nonexistent request`, `/aw-roadside-security.mjs/requests/qa-nonexistent-access-test/${action}`, [400, 404, 409, 422], "POST", { etaMinutes: 15, message: "QA nonexistent resource probe" }, token);
    }
  }
} finally {
  server.kill();
  await writeFile(path.join(root, "ADMIN_VIP_TEST_RESULTS.json"), JSON.stringify({ testedAt: new Date().toISOString(), browser: "Unavailable: Cannot redefine property: process", localRuntime: runtime, results }, null, 2));
  const failed = results.filter(result => result.pass === false);
  const report = `# Admin and VIP access tests\n\nTested ${new Date().toISOString()}.\n\n${results.filter(result => result.pass === true).length} passed; ${failed.length} failed; ${results.filter(result => result.pass === null).length} blocked.\n\nLocal server uses an isolated copy of runtime users with a temporary VIP password. Existing local and production passwords are unchanged. Deployed checks send no configured credentials and do not create dispatches, capture payments, or modify accounts. Task probes reference a nonexistent request; these do not verify successful task completion. Browser automation failed during connection. No separate static hosting URL was supplied; HTTP static checks use the deployed frontend and locally served web files.\n\n## Failures\n\n${failed.map(result => `- ${result.target}: ${result.name}: ${result.status || result.error}${result.message ? ` (${result.message})` : ""}`).join("\n")}\n\nSee ADMIN_VIP_TEST_RESULTS.json for every assertion.\n`;
  const finalReport = report.replace("No separate static hosting URL was supplied; HTTP static checks use the deployed frontend and locally served web files.", process.env.AW_TEST_LOCAL_ONLY === "true" ? "This run targets local server.mjs only. The separate static frontend diagnosis is in STATIC_SITE_DIAGNOSIS.md." : "Static frontend URL: https://awroadside-fire-frontend.onrender.com/home; its separate diagnosis is in STATIC_SITE_DIAGNOSIS.md.");
  await writeFile(path.join(root, "ADMIN_VIP_TEST_REPORT.md"), finalReport);
  console.log(finalReport);
  if (!results.length) console.log(startup.slice(-3000));
}
