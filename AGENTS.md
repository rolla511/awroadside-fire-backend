# Workspace Rules

## Purpose
- This file defines how coding agents should operate in this repository.
- Follow these rules before making code changes, running verification, or updating generated output.

## Project Shape
- Runtime entrypoint: `backend/server.mjs`
- Frontend/static app: `web/`
- Java source snapshot: `src/`
- Build and utility scripts: `scripts/`
- Generated output: `dist/`, `out/`
- Runtime security artifacts: `app/runtime/security/`

## Operating Rules
- Prefer the smallest change that fixes the actual problem. Do not refactor unrelated areas while debugging.
- Read the relevant files first and state the intended change before editing.
- Edit source files, not generated output. Do not hand-edit `dist/` or `out/` unless the user explicitly asks for that.
- Preserve the existing stack and conventions. This repo is Node-first and uses native ESM `.mjs` files.
- Do not introduce new dependencies unless the user explicitly approves them.
- Keep paths and local URLs stable unless the task requires changing them.

## Verification Rules
- After backend or integration changes, run the narrowest relevant check first:
  - `node backend/server.mjs` for runtime validation
  - `node scripts/healthcheck.mjs` for health verification when applicable
- After build-related changes, run `node scripts/build.mjs`.
- Report what was verified and what was not verified. Do not claim a fix without a check.

## Watchdog Rules
- Be aware that this repo tracks integrity drift under `app/runtime/security/`.
- If intentional changes affect files monitored by the watchdog, note that the baseline may need to be refreshed with `npm run watchdog:refresh`.
- Do not silently rewrite watchdog artifacts unless the task requires it.

## Frontend Rules
- For UI changes, preserve the current app flow and existing page structure in `web/`.
- Fix functional issues before visual cleanup.
- Avoid replacing working legacy files unless the task explicitly targets them.

## Backend Rules
- Keep route behavior explicit and local to the relevant controller/module.
- Prefer small, readable request handling over broad abstractions.
- Do not weaken auth, security, or watchdog logic to make tests pass.

## Output Rules
- In progress updates should be short and concrete.
- Final responses should include:
  - what changed
  - how it was verified
  - any remaining risk or follow-up needed
