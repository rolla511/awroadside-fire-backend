# Expected Deprecation Solutions

## Purpose

This repo is the protected backend authority mirror for the `untitled` runtime.

It exists so the live backend does not depend on a structurally mixed or degraded deploy source.

## Source of Truth

- Local authority runtime: `/Users/user/IdeaProjects/untitled`
- Active backend entry: `backend/server.mjs`
- Active web client for this runtime: `web/`

## Expected Failure Modes

- GitHub branch drift
- mixed repo structure
- flattened backend files at repo root
- placeholder `web/index.html` replacing the live web app
- Render watching the wrong branch or wrong repo root
- deploy source diverging from local authority

## Protection Model

- Keep this repo backend-centered and structurally clean.
- Do not mix the Expo mobile app repo into this backend repo.
- Do not flatten backend modules into repo root if the runtime expects `backend/`.
- Do not use placeholder HTML or stub server entries in the live deploy branch.

## Recovery Rule

If Render or GitHub deprecates the live deployment chain:

1. Rebuild from local authority `untitled`
2. Verify `backend/server.mjs` locally
3. Verify `node scripts/healthcheck.mjs`
4. Promote only the verified backend/web runtime tree
5. Reconnect Render only to the clean backend mirror

## Recorded Target Remote

- Intended GitHub repo: `https://github.com/rolla511/awroadside-fire-backend`
