import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sessionValues = new Map();
const navigations = [];
const location = {
  origin: "http://127.0.0.1:3100",
  href: "http://127.0.0.1:3100/provider-wallet.html?period=month#ledger",
  pathname: "/provider-wallet.html",
  search: "?period=month",
  hash: "#ledger",
  assign(value) { navigations.push(value); },
  replace(value) { navigations.push(value); }
};
const storage = {
  getItem(key) { return sessionValues.get(key) || null; },
  setItem(key, value) { sessionValues.set(key, value); },
  removeItem(key) { sessionValues.delete(key); }
};
const context = vm.createContext({
  console, URL, URLSearchParams, Date, Math, Set, Map,
  document: {
    title: "Provider Financials",
    hidden: false,
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: { classList: { remove() {} } }
  },
  window: {
    location, sessionStorage: storage, localStorage: storage, scrollY: 420,
    addEventListener() {}, setInterval() {}, requestAnimationFrame(callback) { callback(); },
    scrollTo() {}, history: { replaceState() {} }
  }
});
vm.runInContext(await readFile(new URL("../web/app.js", import.meta.url), "utf8"), context);
const run = (source) => vm.runInContext(source, context);
run('state.auth = {userId: 11, sessionToken: "test", roles: ["PROVIDER"]}; state.providerQueue = [{requestId: "job-1", status: "SUBMITTED"}];');
assert.equal(run('screenToPage("provider")'), "provider.html");
assert.equal(run('screenFromPathname("/provider-requests.html")'), "provider-requests");
assert.equal(run('providerReturnUrl("https://untrusted.example/provider-wallet.html")'), "provider-work.html");
assert.equal(run('providerReturnUrl("/customer.html")'), "provider-work.html");
run("reconcileProviderDispatchNavigation()");
assert.equal(navigations.pop(), "provider-requests.html?requestId=job-1");
assert.equal(run("readProviderDispatchNavigation().returnUrl"), "/provider-wallet.html?period=month#ledger");
assert.equal(run("readProviderDispatchNavigation().scrollY"), 420);
location.pathname = "/provider-requests.html";
location.href = location.origin + "/provider-requests.html?requestId=job-1";
run("reconcileProviderDispatchNavigation(); returnFromProviderRequest()");
assert.equal(navigations.pop(), "/provider-wallet.html?period=month#ledger");
location.pathname = "/provider-wallet.html";
run("reconcileProviderDispatchNavigation()");
assert.equal(navigations.length, 0, "Returning must not reopen an already presented request");
run('state.providerQueue.push({requestId: "job-2", status: "SUBMITTED"}); reconcileProviderDispatchNavigation();');
assert.equal(navigations.pop(), "provider-requests.html?requestId=job-2");
location.pathname = "/provider-work.html";
location.href = location.origin + "/provider-work.html";
run('state.providerQueue.push({requestId: "job-3", status: "SUBMITTED"}); reconcileProviderDispatchNavigation();');
assert.equal(navigations.pop(), "provider-requests.html?requestId=job-3");
assert.equal(run("readProviderDispatchNavigation().returnUrl"), "/provider-work.html");
run('state.auth.roles = ["SUBSCRIBER"]; state.providerQueue.push({requestId: "job-4", status: "SUBMITTED"}); reconcileProviderDispatchNavigation();');
assert.equal(navigations.length, 0, "Subscribers must not receive provider redirects");
run('state.auth.roles = ["PROVIDER"]; state.auth.userId = 12;');
assert.equal(run("readProviderDispatchNavigation().returnUrl"), undefined, "Navigation history must be scoped to each provider");
location.pathname = "/provider-requests.html";
run(`
  readProviderActionPayload = () => ({});
  recordProcessingEvent = () => {};
  renderProviderActionQueue = () => {};
  showBox = () => {};
  loadProviderQueue = async () => {};
  storeJson = () => {};
  apiFetch = async () => ({ok: false, json: async () => ({message: "Already accepted"})});
`);
await run('queueProviderAction("job-1", "accept")');
assert.equal(navigations.length, 0, "Rejected acceptance must keep the provider on the request screen");
assert.equal(run("state.providerActionQueue[0].status"), "backend-error");
run('apiFetch = async () => ({ok: true, json: async () => ({committed: false})});');
await run('queueProviderAction("job-1", "accept")');
assert.equal(navigations.length, 0, "Pending acceptance must not return early");
run('apiFetch = async () => ({ok: true, json: async () => ({committed: true})});');
await run('queueProviderAction("job-1", "accept")');
assert.equal(navigations.pop(), "provider-work.html", "Confirmed acceptance returns to the previous screen or safe default");
console.log("Provider navigation checks passed: interruptions, return destinations, deduplication, role isolation, and acceptance outcomes.");

const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const eligibilitySource = serverSource.slice(serverSource.indexOf("function isRequestEligibleForProvider("), serverSource.indexOf("function isSubscriberPriorityRequest("));
const numericSource = serverSource.match(/function readNumericValue\([^]*?\n\}/)?.[0];
assert.ok(numericSource);
const eligibilityContext = vm.createContext({
  readOptionalString: (value) => typeof value === "string" ? value : "",
  isProviderEligibleForPendingRequest: () => true
});
vm.runInContext(numericSource + "\n" + eligibilitySource, eligibilityContext);
assert.equal(vm.runInContext('isRequestEligibleForProvider({status: "SUBMITTED", assignedProviderId: null}, {id: 11})', eligibilityContext), true);
assert.equal(vm.runInContext('isRequestEligibleForProvider({status: "SUBMITTED", assignedProviderId: ""}, {id: 11})', eligibilityContext), true);
assert.equal(vm.runInContext('isRequestEligibleForProvider({status: "ASSIGNED", assignedProviderId: 12}, {id: 11})', eligibilityContext), false);
assert.equal(vm.runInContext('isRequestEligibleForProvider({status: "ASSIGNED", assignedProviderId: 11}, {id: 11})', eligibilityContext), true);
console.log("Provider queue eligibility checks passed for unassigned and assigned requests.");
