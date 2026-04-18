import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const pluginPath = path.join(projectRoot, "wordpress", "awroadside-fire", "awroadside-fire.php");
const webIndexPath = path.join(projectRoot, "web", "index.html");
const webAppPath = path.join(projectRoot, "web", "app.js");
const customerPath = path.join(projectRoot, "web", "customer.html");
const providerPath = path.join(projectRoot, "web", "provider.html");
const adminPath = path.join(projectRoot, "web", "admin.html");

const [pluginPhp, webIndex, webApp, customerHtml, providerHtml, adminHtml] = await Promise.all([
  readFile(pluginPath, "utf8"),
  readFile(webIndexPath, "utf8"),
  readFile(webAppPath, "utf8"),
  readFile(customerPath, "utf8"),
  readFile(providerPath, "utf8"),
  readFile(adminPath, "utf8")
]);

const requiredWordPressKeywords = [
  "add_shortcode('awroadside_fire'",
  "register_rest_route('awroadside-fire/v1'",
  "wp_enqueue_script(",
  "wp_enqueue_style(",
  "wp_add_inline_script(",
  "awroadside_fire_frontend_config"
];

const requiredRuntimeConfigKeys = [
  "apiBaseUrl",
  "rawApiBaseUrl",
  "adminApiBaseUrl",
  "uiBaseUrl",
  "bootstrapHealthUrl",
  "bootstrapFrontendConfigUrl",
  "bootstrapManifestUrl",
  "bootstrapAcknowledgeUrl"
];

const requiredIndexHooks = [
  "signin-form",
  "member-signup-open",
  "provider-signup-open",
  "member-signup-form",
  "provider-signup-form",
  "provider-signin-form",
  "request-form",
  "admin-login-form",
  "provider-queue-refresh",
  "service-payment-quote-button",
  "service-payment-agree-button",
  "paypal-button-container",
  "processing-log-list",
  "request-history-list",
  "provider-action-queue-list",
  "provider-work-list",
  "variant-mode",
  "variant-detail"
];

const requiredScreenNames = ["home", "customer", "provider", "admin", "security"];
const failures = [];
const warnings = [];

for (const keyword of requiredWordPressKeywords) {
  if (!pluginPhp.includes(keyword)) {
    failures.push(`Missing WordPress integration keyword: ${keyword}`);
  }
}

for (const key of requiredRuntimeConfigKeys) {
  if (!pluginPhp.includes(`'${key}'`) && !pluginPhp.includes(`"${key}"`)) {
    failures.push(`Missing frontend config key in plugin PHP: ${key}`);
  }
}

for (const hook of requiredIndexHooks) {
  if (!webIndex.includes(`id="${hook}"`)) {
    failures.push(`Missing required index.html hook for app.js: ${hook}`);
  }
}

for (const screen of requiredScreenNames) {
  if (!webIndex.includes(`data-screen="${screen}"`)) {
    failures.push(`Missing required screen section in index.html: ${screen}`);
  }
}

const screenReadMatches = [...webApp.matchAll(/switchScreen\("([^"]+)"\)/g)].map((match) => match[1]);
for (const screen of new Set(screenReadMatches)) {
  if (!requiredScreenNames.includes(screen)) {
    warnings.push(`switchScreen references non-core screen: ${screen}`);
  }
}

if (!customerHtml.includes("url=index.html#customer")) {
  failures.push("customer.html does not redirect to index.html#customer");
}

if (!providerHtml.includes("url=index.html#provider")) {
  failures.push("provider.html does not redirect to index.html#provider");
}

if (!adminHtml.includes("url=index.html#admin")) {
  failures.push("admin.html does not redirect to index.html#admin");
}

if (webIndex.includes('data-nav="admin"')) {
  warnings.push("Admin navigation is publicly present in index.html");
}

if (webIndex.includes('data-nav="provider"')) {
  warnings.push("Provider navigation is publicly present in index.html");
}

if (webApp.includes('switchScreen("provider")') && webIndex.includes('data-screen="provider"')) {
  warnings.push("Provider screen can be activated directly by frontend routing");
}

const report = {
  status: failures.length ? "fail" : "pass",
  summary: {
    failures: failures.length,
    warnings: warnings.length
  },
  failures,
  warnings
};

console.log(JSON.stringify(report, null, 2));

if (failures.length) {
  process.exitCode = 1;
}
