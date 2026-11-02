import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const mode of ["sandbox", "live"]) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    const { paypalConfig, getAccessToken, resolvePaypalWebhookId } = await import("./paypal-client.mjs");
    assert.equal(paypalConfig.mode, "${mode}");
    assert.equal(paypalConfig.clientId, "${mode}-client");
    assert.equal(paypalConfig.clientSecret, "${mode}-secret");
    assert.equal(paypalConfig.webhookId, "${mode}-webhook");
    assert.equal(resolvePaypalWebhookId(), paypalConfig.webhookId);
    assert.equal(paypalConfig.clientIdSource, "${mode === "sandbox" ? "paypal_client_sandbox_id" : "PAYPAL_CLIENT_ID"}");
    assert.equal(paypalConfig.clientSecretSource, "${mode === "sandbox" ? "paypal_client_secret_sandbox_id" : "PAYPAL_CLIENT_SECRET"}");
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api-m${mode === "sandbox" ? ".sandbox" : ""}.paypal.com/v1/oauth2/token");
      assert.equal(options.headers.Authorization, "Basic " + Buffer.from("${mode}-client:${mode}-secret").toString("base64"));
      return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }));
    };
    assert.equal(await getAccessToken(), "test-token");
  `], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      PAYPAL_ENV: ` ${mode.toUpperCase()} `,
      paypal_client_sandbox_id: "sandbox-client",
      paypal_client_secret_sandbox_id: "sandbox-secret",
      paypal_sandbox_webhooks_id: "sandbox-webhook",
      PAYPAL_CLIENT_ID: "live-client",
      PAYPAL_CLIENT_SECRET: "live-secret",
      PAYPAL_WEBHOOK_ID: "live-webhook"
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  console.log(`PASS: ${mode} selects matching credentials, API endpoint, and webhook ID.`);
}

const invalidMode = spawnSync(process.execPath, ["--input-type=module", "-e", 'await import("./paypal-client.mjs")'], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
  env: { ...process.env, PAYPAL_ENV: "sandbx" }
});
assert.notEqual(invalidMode.status, 0);
assert.match(invalidMode.stderr, /PAYPAL_ENV must be sandbox or live/);
console.log("PASS: invalid mode fails instead of silently selecting live.");
