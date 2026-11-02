# AW Roadside Fire - JetBrains Multi-Module Structure

This project has been converted to a JetBrains-compatible multi-module structure to improve compatibility with IDEs and remote deployment environments (Render/GitHub).

## Project Structure

- **`backend/`**: Node.js ESM backend authority (`server.mjs`).
- **`web/`**: Static frontend authority (HTML/JS/CSS/assets).
- **`app/runtime/`**: Runtime persistence, logs, and security artifacts (ignored by git).
- **`dist/`**: Generated deployment bundle from `node scripts/build.mjs`.
- **`.idea/`**: JetBrains IDE configuration and shared run configurations.

## Local Execution

### Start Backend

Using JetBrains: Run the **"Start Backend"** configuration.

Using Terminal:
```bash
node backend/server.mjs
```

The server will be available at `http://127.0.0.1:3000` (default).

### Health Check

Using JetBrains: Run the **"Healthcheck"** configuration.

Using Terminal:
```bash
node scripts/healthcheck.mjs
```

## Deployment (`awroadside-fire-backend`)

### Provider screens

The static frontend in `web/` uses separate provider pages:

- `provider.html`: login; approved providers continue to work and pending providers to their profile.
- `provider-signup.html`: application and account registration.
- `provider-info.html`: verification documents and provider terms.
- `provider-work.html`: accepted jobs, ETA updates, arrival, completion, and work history.
- `provider-wallet.html`: financial balances, payouts, ledger, and disputes.
- `provider-requests.html`: incoming requests and acceptance.

Provider work and financial screens check for new eligible requests through live events and a 15-second polling fallback while the page is visible. A new request opens the request screen automatically. Successful, committed acceptance returns to the previous screen, including its query, hash, and scroll position. Rejected or pending acceptance stays on the request screen. Requests already presented do not interrupt the provider again; the Service Requests link opens them manually. Return history is scoped to the provider and browser tab. Browser session storage must be available for automatic navigation and return history. Profile uploads are not interrupted automatically.

Work input drafts and financial dispute drafts survive request interruptions. Work inputs are retained in session storage; financial dispute drafts use the existing frontend draft storage. The request screen also provides a Back to Previous Screen button. Direct entry without a prior screen returns to Provider Work.

Run navigation and queue eligibility regression checks with `node scripts/test-provider-navigation.mjs`. Rebuild static output with `node scripts/build-static-frontend.mjs`.

This structure is optimized for deployment on Render under the service name `awroadside-fire-backend`.

### Render Configuration

PayPal mode is managed in the Render service environment; deployment blueprints do not pin it to live. For sandbox testing, set `PAYPAL_ENV=sandbox`, `paypal_client_sandbox_id`, `paypal_client_secret_sandbox_id`, and `paypal_sandbox_webhooks_id=4RN22635Y61567938`, then redeploy. Confirm `/api/payments/config` reports `mode: sandbox` and the sandbox credential sources before testing. Sandbox credentials alone do not select sandbox mode.

- **Runtime**: Node
- **Build Command**: `npm install && node scripts/build.mjs`
- **Start Command**: `node dist/backend/server.mjs`
- **Health Check Path**: `/api/health`

## Features & Security

- **Multi-Module Support**: Clear separation between backend, source web assets, and generated deployment output.
- **Environment Neutrality**: All internal paths are reported relative to the project root.
- **Password Validation**: Enforced "Confirm Password" validation on all signup forms.
- **Payment Requirement**: Subscriber signup requires a valid payment method context to ensure profile persistence.
- **Local Watchdog**: Integrated file integrity monitoring under `app/runtime/security`.

## Local Watchdog

Run a local scan:
```bash
npm run watchdog
```

After intentional code changes, refresh the trusted baseline:
```bash
npm run watchdog:refresh
```
