# Render Backend URL Log

## 2026-04-18

- Current public backend URL: `https://awroadside-fire-backend-1.onrender.com`
- Render service name in [render.yaml](/Users/user/IdeaProjects/untitled/render.yaml:1): `awroadside-fire-backend`
- Configured start command in [render.yaml](/Users/user/IdeaProjects/untitled/render.yaml:1): `npm start`
- Runtime start script in [package.json](/Users/user/IdeaProjects/untitled/package.json:1): `NODE_ENV=production node backend/server.mjs`
- Active backend entrypoint in source: [backend/server.mjs](/Users/user/IdeaProjects/untitled/backend/server.mjs:1)
- Generated `.mjs` copies also exist under `dist/` and `out/render/`, but they are build output and are not the configured Render entrypoint.
- Observed remote status at this URL on 2026-04-18: `GET /api/health` returned HTTP `502` with Render header `x-render-routing: no-deploy`, which indicates there is no healthy active deploy behind the public route at the moment.
