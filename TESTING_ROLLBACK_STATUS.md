## Testing Rollback Status
Date: 2026-04-25
Timezone: America/New_York

### Scope

This file is a handoff marker for future repo scans. It records the active backend/app testing state and the intended rollback context for Android and backend deployment review.

### Active App Source

- Expo / Android work is based on `awroadside-fire-work/`
- Root `dist/` is the Node/web deployment bundle and is not the Android app source

### Backend Deploy Note

- Backend deploy credentials and public runtime values are env-driven at deploy time
- `PUBLIC_BASE_URL`, PayPal credentials, webhook values, and related deploy settings are expected to come from the backend deploy environment
- No production credentials should be treated as Android hard-coded authority

### Android Testing Prep State

- Android app default backend URL was set to `https://awraodside-backend-fire.onrender.com`
- Active mobile pricing/text was aligned to `backend/server.mjs`
- Guest-facing service copy was updated for stronger testing/review presentation
- Production-readiness review was started but not completed to release-artifact signoff

### Backend Source Notes

- `backend/server.mjs` remains pricing authority
- Provider rating scale is intentionally `1 to 8`
- Provider approval score in provider selection is a ranking weight, not pricing
- Hard-coded PayPal webhook ID fallback was removed
- Provider PayPal model was shifted toward `providerAccountId`
- Legacy `merchantId` is still read for compatibility where needed

### Known Open Items

- Android release signing still needs production-safe signing config
- Full Android release artifact (`.aab`) was not completed and verified in-session
- Full device flow validation still pending:
  - guest request
  - subscriber signup/request
  - provider sign-in/work
  - admin sign-in/dashboard
  - service quote/order/capture flow
- Some stale/internal repo files may still contain older wording outside the active build path

### Time Note

- Approximate preparation time spent on Thursday, April 23, 2026: `3.25 hours`
- Approximate activity window: `4:15 PM ET` to `7:32 PM ET`

### Rescan Guidance

On next activation, scan these first:

1. `TESTING_ROLLBACK_STATUS.md`
2. `backend/server.mjs`
3. `awroadside-fire-work/App.js`
4. `awroadside-fire-work/lib/api.js`
5. `awroadside-fire-work/android/app/build.gradle`
6. `render.yaml`

### Continuation Note

Date: 2026-04-24
Timezone: America/New_York

#### Current Stop Point

- Local backend and web/provider/admin support work were advanced beyond the earlier rollback scan
- Provider wallet route and provider wallet controller now exist
- Provider document upload is now wired from `web/provider-info.html` through `web/app.js`
- Mapbox backend foundation now exists:
  - `backend/location-service.mjs`
  - `GET /api/aw-roadside/location/config`
  - `GET /api/aw-roadside/location/geocode`
  - `GET /api/aw-roadside/location/isochrone`
- Request creation now stores:
  - `locationCoordinates`
  - `locationGeocodeSource`
  - `requestAcceptanceWindowMinutes`
  - `requestAcceptanceExpiresAt`
- Provider profile setup now stores location metadata and default radius context
- Provider queue visibility is now filtered by:
  - provider approval/availability
  - provider service type match
  - `20` mile radius when coordinates exist
  - request acceptance expiration
- Location and contact disclosure controls remain staged:
  - masked location before payment
  - soft ETA before payment
  - direct communication and full location only after payment and provider activation

#### Confirmed Render Concern

- `https://awraodside-backend-fire.onrender.com/api/payments/config` reported a webhook URL using `http://127.0.0.1:10000/api/paypal/webhook`
- This indicates Render deploy/runtime config needs to be brought into line with current local backend before webhook validation is meaningful

#### Webhook Test State

- Webhook fallback ID was temporarily restored in local `backend/server.mjs` for one test and then removed again
- Current local source is back to env-only `PAYPAL_WEBHOOK_ID`
- Sandbox webhook simulation harness now exists at `scripts/test-paypal-webhook-sim.mjs`
- Prior auth failure should not be treated as authoritative Render proof because the test used local credential context to call PayPal while targeting the Render URL as receiver

#### Tomorrow Focus

- Finish provider-selection enforcement beyond queue filtering:
  - assignment authority
  - reassignment after expiry
  - request timeout handling
- Bring backend and Render env fully in line for Mapbox-backed location logic
- Complete testing from the current forward state instead of rewriting rollback assumptions
- Continue HTML-first website path with backend-driven live logic

#### Live Capacity Priorities

- Do not treat location as static text anymore
- Enforce provider-to-request geography before real dispatch
- Prevent out-of-area provider visibility and assignment
- Prevent long stale wait times before provider acceptance
- Keep guest/subscriber/provider/admin flows aligned to backend authority
- Finish the checklist until live-event capacity is trustworthy

#### Backend Checklist Priorities

- Add assignment authority module for provider selection
- Enforce `20` mile radius at assignment, not only queue filtering
- Enforce `5` minute acceptance expiry with requeue/reassignment logic
- Add provider note UI for the existing backend action
- Add provider PayPal connect/status/refresh path for wallet competency
- Verify document upload, wallet, queue, and admin mutation flows against real authenticated sessions

#### Quick Start Tomorrow

- Confirm deployed Render runtime matches current local `backend/server.mjs`
- Confirm Render has `MAPBOX_ACCESS_TOKEN`
- Check `/api/aw-roadside/location/config`
- Check `api/payments/config` before any PayPal test
- Treat the public backend URL as the transport contract
- Continue from provider eligibility and request-assignment enforcement, not from old rollback assumptions

#### HTML-Only Website Direction

- Direction under consideration: static HTML pages as the only page anchors
- Expected requirement:
  - gateway and universal control logic must anchor page behavior
  - backend/API calls must be made directly from HTML-loaded JavaScript to the deployed URL
  - PayPal buttons may need to be mounted separately inside page-specific HTML unless a shared script wrapper is used
