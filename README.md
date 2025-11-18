# Vite JSON Builder Service

This project is a Dockerized Node/Express service that accepts a JSON representation of a Vite project (files with paths and contents) and returns the built `dist` output (HTML/CSS/JS) as a zip file.

## How it works
- POST /build with JSON payload `{ files: [ { "path": "index.html", "content": "..." }, ... ] }`.
- The server writes files into a temporary directory, installs dependencies (unless requested not to), runs `npm run build`, and streams back the zip of the `dist` folder.

## Run locally

1. Build and run with Docker Compose:

```bash
# Build and run
docker compose build
docker compose up
```

2. Send a sample Vite JSON:

```bash
cd client
npm install
npm run send
```

`client/send_build.js` will POST `client/sample_vite_project.json` to `http://localhost:3000/build` and save `client/build.zip`.

## API
  - POST /build
  - Body: JSON with `{ files: [ { path: string, content: string } ], installDependencies?: boolean }
    - Additional optional fields:
      - `buildCommand` (string): custom build command to run (default `npm run build`)
      - Files can include `contentBase64` (string) for binary files instead of `content`.
  - Response: Zip file (application/zip) of `dist` folder

  Behavior changes
  - `/build` now enqueues a build job into a Redis-backed queue and returns 202 with an ID by default.
  - To wait for the build to finish and get the artifact directly, set `waitForCompletion: true` in the payload or use the `WAIT=true` env var in the sample client.
  - You must include an `x-api-key` header with a valid API key created by admin to call the build endpoint.

## Admin
The service exposes a small admin UI at `/admin` that lists recent builds, allows you to inspect logs, download artifacts and manage the dependency cache.

API endpoints for admin:
- GET `/admin/builds` — lists builds metadata
- GET `/admin/builds/:id` — build metadata and logs
- GET `/builds/:id.zip` — download build artifact
- GET `/admin/cache` — list cache entries
- POST `/admin/cache/clear` — clear the dependency cache
- POST `/admin/cache/remove/:hash` — remove a specific cache entry
- POST `/admin/cache/settings` — set `maxEntries` and `maxBytes` for cache control

Visit http://localhost:3000/admin to view the admin UI once the service is running.

Security and API Keys
- Admin key: set environment variable `ADMIN_KEY` when starting the service, or the server will create one in `data/admin.json` at startup. The admin key is used to protect admin endpoints and the admin UI.
- API keys: Admins can create API keys via `POST /admin/api/keys` and provide those `x-api-key` headers to clients (or include in calls via `?apiKey=`).
 - API keys: Admins can create API keys via `POST /admin/api/keys` and provide those `x-api-key` headers to clients (or include in calls via `?apiKey=`). The client `client/send_build.js` supports passing API key via `API_KEY` environment variable.

Caching behavior
- The service computes a hash for dependencies (using package-lock.json if present, or dependencies+devDependencies from package.json).
- If a cache entry for that hash exists, the server will copy the cached `node_modules` into the build project to avoid network installs.
- If no cache is found after a build completes, the server caches the `node_modules` for reuse.
- The cache is kept limited (default 5 entries, 2GB total) and evicts least-recently-used entries.

## Notes
- The server will try to use `package.json` provided in your files. If none is provided, a fallback `package.json` will be created with Vite as a dev dependency.
- `installDependencies` (default true) controls whether the server runs `npm install/ci`. Set to false if you provide a `node_modules` bundle or pre-built `dist`.
- This is intended for secure/test environments only; building arbitrary code can be a security risk.

## Implementation Caveats
- Timeouts and resource bounds are simple, not production-grade.
- You may want to run the service in a sandboxed environment for security.

## Development

- Server is in `server/index.js`.
- Client sample is in `client/send_build.js` and uses `axios` to download the built zip.

