# GitHub Remote Diff Report

## 2026-04-18

Compared:

- Local authority: `/Users/user/IdeaProjects/untitled`
- Remote GitHub branch: `rolla511/awroadside-fire-backend:main`

## Verified Remote State

- Repo: `https://github.com/rolla511/awroadside-fire-backend`
- Latest remote commit: `84cf17b0c97830d4ba22321160c2bee8d4c6eb29`
- Latest remote commit title: `Merge pull request #1 from rolla511/repo-structure-fix`
- Commit URL: `https://github.com/rolla511/awroadside-fire-backend/commit/84cf17b0c97830d4ba22321160c2bee8d4c6eb29`

## Main Finding

Remote `main` is structurally mixed:

- It contains a minimal deploy pair at:
  - `backend/server.mjs`
  - `web/index.html`
- It also contains a second backend module set flattened at repo root:
  - `server.mjs`
  - `admin-controller.mjs`
  - `aw-roadside-security.mjs`
  - `compatibility-gateway.mjs`
  - `local-watchdog.mjs`
  - `mock-request-service.mjs`
  - `request-service-controller.mjs`
  - `runtime-repository.mjs`
  - `subscription-controller.mjs`
  - `universal-bridge-controller.mjs`

That means GitHub `main` does not mirror the current local backend layout in `untitled`.

## Critical Content Mismatch

- Local [backend/server.mjs](/Users/user/IdeaProjects/untitled/backend/server.mjs:1) is the full AW Roadside runtime.
- Remote `backend/server.mjs` is a minimal Express/Mongoose stub added by the merge commit.
- Remote `web/index.html` is only a placeholder page.
- Remote `render.yaml` still points Render at `npm start`, which resolves to `node backend/server.mjs`.

This creates a direct failure mode:

- Render can be pointed at a branch where `backend/server.mjs` is not the real runtime entry anymore.
- If that branch is deployed, the live service can boot the wrong backend and also lack the real web bundle.

## Files Present Locally But Missing On Remote

- `backend/admin-controller.mjs`
- `backend/aw-roadside-security.mjs`
- `backend/compatibility-gateway.mjs`
- `backend/local-watchdog.mjs`
- `backend/mock-request-service.mjs`
- `backend/request-service-controller.mjs`
- `backend/runtime-repository.mjs`
- `backend/subscription-controller.mjs`
- `backend/universal-bridge-controller.mjs`
- `web/admin.html`
- `web/app.js`
- `web/assets/roadside-home.png`
- `web/assets/roadside-subscriber.png`
- `web/customer.html`
- `web/fire-screen.html`
- `web/firedouble.js`
- `web/legacy-app.js`
- `web/legacy-index.html`
- `web/legacy-styles.css`
- `web/provider.html`
- `web/styles.css`

## Files Present Only On Remote Root

- `admin-controller.mjs`
- `aw-roadside-security.mjs`
- `compatibility-gateway.mjs`
- `db-config.mjs`
- `local-watchdog.mjs`
- `mock-request-service.mjs`
- `paypal-client.mjs`
- `request-service-controller.mjs`
- `runtime-repository.mjs`
- `server.mjs`
- `subscription-controller.mjs`
- `universal-bridge-controller.mjs`

## Duplicated By Root Flattening

These exist at remote repo root while the local authority expects them under `backend/`:

- `admin-controller.mjs`
- `aw-roadside-security.mjs`
- `compatibility-gateway.mjs`
- `local-watchdog.mjs`
- `mock-request-service.mjs`
- `request-service-controller.mjs`
- `runtime-repository.mjs`
- `server.mjs`
- `subscription-controller.mjs`
- `universal-bridge-controller.mjs`

## Conclusion

The current GitHub remote branch is not a clean mirror of local `untitled`.

The strongest evidence is:

- the merge commit added a reduced `backend/server.mjs`
- the merge commit added a placeholder `web/index.html`
- the rest of the backend module set is flattened at repo root instead of living under `backend/`
- most of the live web app files are absent from remote `main`

This is consistent with Render being able to deploy a structurally broken backend/web tree even while the local authority copy remains complete.
