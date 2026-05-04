# Repo Structure Log

## 2026-04-18

- `untitled` was not a standalone git repository.
- Before repair, `git -C /Users/user/IdeaProjects/untitled rev-parse --show-toplevel` resolved to `/Users/user`.
- The parent repository at `/Users/user` had no commits and no remotes, which made backend pull/merge behavior unreliable for GitHub/Render workflows.
- `awroadside-fire` is a separate real repository at `/Users/user/awroadside-fire/.git`.
- `awroadside-fire` currently points to GitHub remote `https://github.com/rolla511/awroadside-fire-backend.git`.
- That means the mobile app repo is currently tied to a remote named like the backend, while the actual backend folder was not isolated in its own repo.

## Local Repair Applied

- Initialized a standalone git repository at `/Users/user/IdeaProjects/untitled/.git`.
- After repair, `git -C /Users/user/IdeaProjects/untitled rev-parse --show-toplevel` resolves to `/Users/user/IdeaProjects/untitled`.

## Remaining Follow-Up

- Add the correct backend GitHub remote to `/Users/user/IdeaProjects/untitled`.
- Make the initial backend commit in `/Users/user/IdeaProjects/untitled`.
- Confirm Render is connected to the backend repo/root, not only to the Expo/mobile repo.
- Confirm whether `https://github.com/rolla511/awroadside-fire-backend.git` is supposed to be:
  - the backend repo,
  - the mobile repo,
  - or a mixed repo that needs to be split.

## Deployment Surface Findings

- No `.renderignore`, `.dockerignore`, `.gitmodules`, or sparse checkout file was found in `untitled`.
- The local backend source tree contains the full backend module set, not only `backend/server.mjs`.
- The local web tree contains the full current web set, not only `web/index.html`.
- The generated Render source snapshot under `out/render/awroadside-fire-backend-source/` also contains the full backend and web trees.
- That means the current evidence does not support a local packaging rule that intentionally reduced deployment to one `server.mjs` file and one `index.html` file.
- The stronger explanation is that GitHub/Render was wired to the wrong repo/root or to an incomplete repo history, because `untitled` was not a standalone git repository before repair.
