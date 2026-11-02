import { readFile, writeFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import vm from "node:vm";
import { spawn } from "node:child_process";

const project = path.resolve(import.meta.dirname, "..");
const sandbox = await mkdtemp(path.join(os.tmpdir(), "aw-frontend-server-"));
const webRoot = path.join(sandbox, "web");
const runtime = path.join(sandbox, "runtime");
const origin = "https://awroadside-fire-frontend.onrender.com";
const local = "http://127.0.0.1:3191";
const results = [];
const network = [];
const password = crypto.randomBytes(24).toString("hex");
const salt = crypto.randomBytes(16).toString("hex");
const passwordHash = `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
await mkdir(webRoot, { recursive: true });
await mkdir(path.join(runtime, "auth"), { recursive: true });
const users = JSON.parse(await readFile(path.join(project, "app/runtime/auth/users.json"), "utf8"));
const vip = users.find(user => user.username === "vipprovider");
vip.passwordHash = passwordHash;
const subscriber = { ...structuredClone(vip), id: Math.max(...users.map(user => Number(user.id))) + 1, username: "qa.local.subscriber", email: "qa.local.subscriber@example.invalid", roles: ["SUBSCRIBER"], subscriberActive: true, subscriberProfile: { membershipStatus: "ACTIVE" }, providerProfile: null, providerStatus: null, available: false, passwordHash };
const provider = { ...structuredClone(vip), id: subscriber.id + 1, username: "qa.local.provider", email: "qa.local.provider@example.invalid", roles: ["PROVIDER"], passwordHash };
users.push(subscriber, provider);
await writeFile(path.join(runtime, "auth/users.json"), JSON.stringify(users));
const files = (await readdir(path.join(project, "web"))).filter(file => /\.(html|js|css)$/.test(file));
for (const file of files) {
  const response = await fetch(`${origin}/${file}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) { results.push({ flow: `Download ${file}`, pass: false, status: response.status }); continue; }
  await writeFile(path.join(webRoot, file), await response.text());
}
const server = spawn(process.execPath, ["server.mjs"], { cwd: project, env: { ...process.env, HOST: "127.0.0.1", PORT: "3191", RUNTIME_ROOT: runtime, WEB_ROOT: webRoot, AW_DB_MODE: "runtime-storage", PUBLIC_BASE_URL: local, ADMIN_EMAIL: "qa.local.admin@example.invalid", ADMIN_PASSWORD: password, ADMIN_2FA_CODE: "731924" }, stdio: ["ignore", "pipe", "pipe"] });
let startup = "";
server.stdout.on("data", data => { startup += data; });
server.stderr.on("data", data => { startup += data; });
function record(role, flow, pass, details = {}) { results.push({ role, flow, pass: Boolean(pass), ...details }); }
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const response = await fetch(`${local}/api/health`); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("server.mjs failed to start locally");
  for (const file of files.filter(file => file.endsWith(".html"))) {
    const response = await fetch(`${local}/${file}`);
    record("All", `Local server delivers deployed ${file}`, response.ok, { status: response.status });
  }
  const values = new Map();
  const storage = { getItem(key) { return values.get(key) || null; }, setItem(key, value) { values.set(key, value); }, removeItem(key) { values.delete(key); } };
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Set, Map, AbortController,
    document: { title: "Local frontend simulation", hidden: false, addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, body: { classList: { remove() {}, add() {} } } },
    window: { location: { origin: local, href: `${local}/home.html`, pathname: "/home.html", search: "", hash: "", assign() {}, replace() {} }, localStorage: storage, sessionStorage: storage, AWRoadsideConfig: { apiBaseUrl: `${local}/api/aw-roadside`, rawApiBaseUrl: `${local}/api`, adminApiBaseUrl: `${local}/api/admin`, uiBaseUrl: local }, addEventListener() {}, setInterval() {}, requestAnimationFrame() {}, history: { replaceState() {} } },
    fetch: async (url, options) => {
      if (new URL(url).origin !== local) throw new Error("Simulation disallows external API requests");
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25000) });
      network.push({ url, method: options?.method || "GET", status: response.status });
      return response;
    }
  });
  const servedApp = await fetch(`${local}/app.js`).then(response => response.text());
  vm.runInContext(servedApp, context);
  const run = source => vm.runInContext(source, context);
  async function call(role, flow, route, method = "GET", body, token, admin = false, expected = [200]) {
    context.callRoute = route;
    context.callOptions = { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) };
    try {
      const response = await run(`${admin ? "adminFetch" : "apiFetch"}(callRoute, callOptions)`);
      const payload = await response.json();
      record(role, flow, expected.includes(response.status), { status: response.status, message: payload.message || payload.error });
      return payload;
    } catch (error) { record(role, flow, false, { message: error.message }); return {}; }
  }
  await call("Guest", "Frontend health through app.js", "/health");
  await call("Guest", "Pricing through app.js", "/payments/config");
  const locationConfig = await call("Guest", "Location configuration through app.js", "/location/config");
  record("Guest", "Local Mapbox configuration", locationConfig.mapbox?.configured === true);
  const geocode = await call("Guest", "Local Mapbox public-city geocoding", "/location/geocode?q=Philadelphia%2C%20PA");
  record("Guest", "Mapbox returns address results", geocode.features?.length > 0);
  await call("Guest", "Invalid request validation", "/requests", "POST", {}, undefined, false, [400, 422]);
  for (const [role, user] of [["Subscriber", subscriber], ["Provider", provider], ["VIP provider", vip]]) {
    const login = await call(role, "Login through deployed app.js and local server.mjs", "/auth/login", "POST", { identifier: user.username, password });
    record(role, "Session and role attributes returned", Boolean(login.sessionToken) && login.roles?.includes(user.roles[0]));
    if (!login.sessionToken) continue;
    await call(role, "Profile hydration", "/auth/profile", "GET", undefined, login.sessionToken);
    if (role === "Subscriber") {
      await call(role, "Provider wallet role isolation", "/provider/wallet", "GET", undefined, login.sessionToken, false, [403]);
    } else {
      for (const route of ["/provider/workflow", "/provider/wallet", "/requests"]) await call(role, `Read ${route}`, route, "GET", undefined, login.sessionToken);
      await call(role, "Task routing with nonexistent request", "/requests/qa-local-nonexistent/accept", "POST", {}, login.sessionToken, false, [400, 404, 409, 422]);
    }
  }
  const admin = await call("Admin", "Login with 2FA through deployed app.js", "/login", "POST", { identifier: "qa.local.admin@example.invalid", password, twoFactorCode: "731924" }, undefined, true);
  record("Admin", "Admin session issued", admin.adminAccess === true && Boolean(admin.token));
  if (admin.token) for (const route of ["/dashboard", "/requests", "/subscribers", "/payments/config"]) await call("Admin", `Read ${route}`, route, "GET", undefined, admin.token, true);
} catch (error) {
  record("Environment", "Simulation execution", false, { message: error.message });
} finally {
  server.kill();
  const summary = { passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length };
  await writeFile(path.join(project, "LOCAL_FRONTEND_SIMULATION.json"), JSON.stringify({ testedAt: new Date().toISOString(), source: origin, localServer: local, entry: "server.mjs", sandbox, summary, results, network, scope: "Deployed HTML/JS served by local server.mjs. Actual app.js API functions execute against local HTTP using simulated DOM/storage. Generated credentials affect isolated runtime copy only. Not a browser rendering test; no successful business task/payment mutations verified." }, null, 2));
  const report = `# Local server frontend simulation\n\n${summary.passed} passed; ${summary.failed} failed.\n\nFrontend downloaded from ${origin}, served by local server.mjs at ${local}. Actual deployed app.js apiFetch/adminFetch functions execute against the local server. DOM/storage are simulated; rendering and full form interaction are not verified. Subscriber and provider fixtures and temporary passwords exist only in an isolated runtime copy. Mapbox uses server.mjs's existing local configuration. No deployed backend API was used by the simulation.\n\n| User | Flow | Result | HTTP / detail |\n|---|---|---|---|\n${results.map(result => `| ${result.role || "All"} | ${result.flow} | ${result.pass ? "Pass" : "Fail"} | ${result.status || ""} ${(result.message || "").replaceAll("|", "/")} |`).join("\n")}\n\nFull evidence: LOCAL_FRONTEND_SIMULATION.json. Successful paid onboarding, actual document uploads and task completion remain unverified.\n`;
  await writeFile(path.join(project, "LOCAL_FRONTEND_SIMULATION.md"), report);
  console.log(report);
  if (!network.length) console.log(startup.slice(-1500));
}
