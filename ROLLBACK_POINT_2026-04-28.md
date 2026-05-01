## Rollback Point
Date: 2026-04-28
Timezone: America/New_York

This is a deliberate rollback marker for the current state, including non-working conditions.

### Authority

- `backend/server.mjs` is the authority.
- iOS, Android, and web are expected to run from that authority.
- Do not treat wrapper `index.mjs` paths outside this variant as authority.

### Current Broken Point

- The public backend URL is not honoring this variant's backend authority.
- The public Render URL is serving Expo/HTML behavior on `/api/*` instead of backend JSON.
- This is a valid rollback point even though it is not working.

### Current Local State

- Local `backend/server.mjs` boots successfully.
- Local health, runtime, compatibility, and payments config routes return JSON as expected.
- Local PayPal sandbox simulation is accepted upstream.

### Persistence State

- Runtime is still effectively writing operational state to files under `app/runtime/`.
- Database support exists in code, but the active runtime behavior observed in this session is still file-runtime oriented.

### Pricing Context

- The pricing change was intentional due to excess fees from Mapbox and PayPal.
- Providers and subscribers accept updated terms through continued use.
- Do not treat the pricing change itself as the product bug.

### What Not To Do Next

- Do not treat stale variants as the authority.
- Do not treat separate wrapper runtimes as part of this variant.
- Do not weaken `backend/server.mjs` as sole authority.
- Do not assume a non-working point is useless for rollback.

### Resume Point

- Start from this marker.
- Re-establish public URL authority for this variant.
- Keep analysis centered on why the deployed backend URL is not serving this backend runtime.
