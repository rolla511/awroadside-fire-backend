## Platform Accuracy Audit
Date: 2026-04-27
Timezone: America/New_York

### Scope

This audit measures the current compatibility level between:

- root backend routes in `backend/`
- web UI pages in `web/`
- mobile UI in `awroadside-fire-work/`
- admin controls and processing/event surfaces

Scoring uses a `0` to `100` scale:

- `100`: UI surface exists, matching backend route exists, and runtime behavior was directly verified in this session
- `75-99`: UI surface exists and route contract matches, but full authenticated/device flow was not executed in this session
- `50-74`: partial UI coverage or older shell overlap
- `0-49`: stale, deprecated, or not authoritative for the active platform path

### Guest Entry Clarification

- `web/home.html` is the current split-page guest landing page and shared sign-in screen.
- `web/customer.html` is the request-entry page for guest/subscriber service submission.
- `web/index.html` is not abandoned. It is a currently repurposed composite shell that still contains customer, provider, and admin collection forms and status surfaces.
- The repo currently carries two web patterns in parallel:
  - split-page path led by `home.html`
  - composite shell path in `index.html`

### Runtime Checks Performed

- `node --check backend/server.mjs`
- `node --check web/app.js`
- `node --check awroadside-fire-work/lib/api.js`
- `node backend/server.mjs`
- `node scripts/healthcheck.mjs`
- `GET /api/aw-roadside/health`
- `GET /api/aw-roadside/frontend-config`
- `GET /api/compat/manifest`

Direct runtime verification in this session confirmed:

- backend runtime boots
- protected AW roadside health endpoint responds
- frontend config responds
- compatibility manifest responds

### Backend Endpoint Accuracy

- Protected roadside API core: `92`
  - health, frontend-config, auth signup/login/profile, subscriber setup, provider apply/documents, requests, request actions, provider wallet, payment config, create-order, service-quote, capture-order are all present
- Admin API core: `91`
  - login, dashboard, payments config, requests, subscribers, search, user profile, account-state, provider approve, provider training, refund, payout, reset, force-action are present
- Compatibility/runtime API: `94`
  - compat status/manifest/repository/acknowledge plus runtime health chain are present
- Location API: `82`
  - route surface exists, but live Mapbox-backed verification was not completed in this pass

### Web Accuracy

Authoritative split-page web path:

- `web/home.html`: `93`
  - guest entry, sign-in, dispatch status, clear role navigation
- `web/customer.html`: `84`
  - request submit, service quote/agreement, payment ledger, feedback, local request replay
  - still lacks true server-polled request-status view
- `web/subscriber-access.html`: `81`
  - sign-in and signup are aligned, but dedicated subscriber history/status view is still thin
- `web/provider.html`: `87`
  - provider sign-in and application entry are aligned
- `web/provider-info.html`: `84`
  - provider profile/documents aligned
- `web/provider-work.html`: `86`
  - queue/actions/note flow aligned to backend action model
- `web/provider-wallet.html`: `83`
  - wallet ledger and payout states aligned
  - PayPal connect/status/refresh UI still incomplete
- `web/admin.html`: `90`
  - admin login/trusted-zone entry aligned
- `web/admin-dashboard.html`: `88`
  - dashboard, approvals, refunds, payouts, training, backend event stream aligned
- `web/admin-accounts.html`: `89`
  - account search/profile/account-state flow aligned
- `web/admin-financials.html`: `86`
  - refund/payout controls aligned

Overall authoritative web score: `86`

Mixed web surfaces:

- `web/index.html`: `76`
  - active composite shell, but still mixes internal preview/runtime logic with multi-role form flow
- `web/legacy-index.html`: `32`
- `web/fire-screen.html`: `35`
- `web/firedouble.js` / `web/legacy-app.js`: not part of the current authority path

### Mobile Accuracy

Active mobile authority path: `awroadside-fire-work/`

- bootstrap/config/runtime handshake: `91`
- guest request flow: `86`
- guest request status/payment flow: `84`
- subscriber access/signup: `88`
- subscriber profile/request/status flow: `85`
- provider access/info/profile: `87`
- provider work and note flow: `88`
- provider wallet/history: `84`
- admin access/work: `87`
- admin directory/accounts: `89`
- admin providers/training controls: `86`
- admin subscribers: `85`
- security/runtime panel: `90`

Overall mobile score: `87`

### Processing And Event Accuracy

- request lifecycle labeling: `89`
  - `SUBMITTED` through `COMPLETED` mappings are present
- payment lifecycle labeling: `90`
  - `NOT_PAID`, `ORDER_CREATED`, `PENDING_CAPTURE`, `CAPTURED`, `DECLINED`, `REFUNDED`, `CANCELLED` mappings are present
- provider lifecycle labeling: `88`
- payout lifecycle labeling: `88`
- local processing/event replay in web: `83`
  - strong local visibility, but still not a full authoritative audit feed
- admin backend event visibility: `80`
  - recent payment events are surfaced, but there is not yet a distinct admin audit-history collection in UI

Overall processing/event score: `86`

### Admin Accuracy

- admin auth and trusted-zone handling: `90`
- admin dashboard data coverage: `88`
- admin provider governance: `87`
- admin financial controls: `86`
- admin directory/search/profile support: `89`
- provider discipline/training controls: `86`

Overall admin score: `88`

### Directory Accuracy

- `backend/`: `90`
- `web/` authoritative split pages: `86`
- `awroadside-fire-work/`: `87`
- `app/runtime/`: `84`
  - runtime files are active and readable, but still file-backed rather than fully migrated to DB authority

### Main Mismatches Still Open

1. `web/customer.html` still depends on local mirrored request state instead of a dedicated server-polled request status view.
2. `web/subscriber-access.html` does not yet expose the richer subscriber request confirmation/status flow that exists in the mobile app.
3. `web/provider-wallet.html` still lacks dedicated PayPal connect/status/refresh controls.
4. `web/index.html` is active, but it still overlaps the split-page web path and mixes internal preview/runtime concerns with live role flows.
5. Admin event visibility is better now, but still not a full audit-history UI.

### Final Scores

- backend routes: `91`
- web authoritative pages: `86`
- mobile app authority path: `87`
- admin operations: `88`
- processing/event coverage: `86`
- whole active platform stack: `87`

### Recommendation

Treat the current active authority set as:

1. `backend/server.mjs`
2. split web pages led by `web/home.html`, not `web/index.html`
3. mobile app at `awroadside-fire-work/`

Next correction pass should target:

1. server-backed customer/subscriber status refresh on web
2. provider PayPal connect/status/refresh UI
3. explicit admin audit-history feed
