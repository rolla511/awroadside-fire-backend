# Local Runtime App

## Local run

```bash
node backend/server.mjs
```

Open:

- `http://127.0.0.1:3000/`
- `http://127.0.0.1:3000/api/health`
- `http://127.0.0.1:3000/api/runtime/status`
- `http://127.0.0.1:3000/api/aw-roadside/health`
- `http://127.0.0.1:3000/api/aw-roadside/frontend-config`

The frontend now targets the protected AW Roadside API at `/api/aw-roadside`, which adds:

- signed user sessions for frontend auth flows
- hashed password storage for new and migrated users
- authenticated subscriber/provider setup routes
- guarded request and payment routes
- cached last-known-good fallback for selected frontend config and health reads

## Local watchdog

This project now includes a local watchdog for this Mac scoped to AW Roadside:

- baseline file hashes for critical backend/frontend files
- integrity drift reporting under `app/runtime/security`
- local audit log at `app/runtime/security/watchdog-events.jsonl`
- latest periodic status at `app/runtime/security/latest-status.json`
- protected status endpoint at `/api/aw-roadside/security/status`
- authenticated watchdog scan endpoint at `/api/aw-roadside/security/watchdog`
- automatic periodic scans while the backend is running

Run a local scan:

```bash
npm run watchdog
```

Default periodic scan interval is 5 minutes and can be changed with `AW_WATCHDOG_INTERVAL_MS`.

After intentional code changes, refresh the trusted baseline:

```bash
npm run watchdog:refresh
```

## Build deployable bundle

```bash
node scripts/build.mjs
```

## Google Cloud Run deploy

Prerequisites:

- Google Cloud project with billing enabled
- `gcloud` CLI installed and authenticated
- Cloud Run API enabled

Deploy from project root:

```bash
gcloud run deploy untitled-local-runtime \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

After deploy, Cloud Run will inject `PORT`, and the app is already configured to bind on `0.0.0.0`.

## Notes

- This app currently uses no external runtime dependencies.
- There is no database configured yet.
- For a Google-managed database later, the clean default is Firestore unless you need relational SQL.
