# Server Notes

## Boot Flow
1. `src/config/loadEnv.js` loads `.env` only outside production and memoizes the environment state on `global.__APP_ENV__`.
2. `src/server.js` validates required production secrets, enables `trust proxy`, mounts API routes and static HTML/assets, and initializes Socket.IO.
3. `connectToDatabase()` runs before the server starts accepting traffic.
4. After a successful DB connection, startup initializes `ServerConfig`, clears lobby queue state from the previous process, and starts the hourly guest cleanup task.
5. The HTTP server then listens and starts the internal bot clients.

## MongoDB Connection Behavior
- Development uses `process.env.MONGODB_URI` or falls back to `mongodb://localhost:27017/cloaks-gambit`.
- Production uses the raw `MONGODB_ATLAS_CONNECTION_STRING` and does not rewrite the URI path anymore.
- The production connection attempt always passes `dbName: 'cloaksgambit'` and `serverSelectionTimeoutMS: 10000`.
- If the supplied Atlas URI does not already include `authSource`, startup retries once with `authSource=admin`.
- Do not reintroduce URI surgery that rewrites the database path. The current fix relies on leaving the URI intact and setting `dbName` in the connection options.

## Runtime Architecture
- `src/server.js` is still the top-level composition root. It owns:
  - HTML shell delivery with asset-version token replacement.
  - favicon selection for local vs hosted environments.
  - API route mounting under `/api`.
  - static asset serving from `public/`.
  - Socket.IO setup through `src/socket.js`.
- `src/socket.js` is the real-time hub for:
  - initial masked game state and queue status.
  - live game updates and finished-game broadcasts.
  - spectator rooms and admin metrics.
  - user presence, disconnect timers, and custom invite flow.

## Auth and Identity
- HTTP auth routes live in `src/routes/auth/google.js`.
- `src/utils/requestSession.js` is now the shared identity resolver for HTTP routes and Socket.IO handshakes.
- Guest creation is server-owned. The browser should establish a session through `/api/auth/session`, then reuse the resulting cookies; sockets no longer accept a raw fallback `userId`.
- Admin access is server-enforced through the authenticated Google account email `marcellbabai@gmail.com`, including `/admin`, `/ml-admin`, admin APIs, and the `/admin` Socket.IO namespace.

## Recent Refactors Worth Knowing
- Clock authority now lives on `game.clockState`, not only on action replay. Read `src/utils/gameClock.js` and `docs/clock-authority-debug-execplan.md` before changing live clock behavior.
- The auth/session path now repairs real-user cookies in development and keeps `ensureUser()` from turning real accounts back into guests.
- The browser no longer mirrors JWT auth into `localStorage` for fetch or socket auth. Requests and sockets now rely on server-owned cookies, while harmless UX state such as queue timers can still live in local storage.
- Startup Mongo behavior changed in March 2026 to stop mutating Atlas URIs and instead retry with explicit `dbName` plus optional `authSource=admin`.

## Editing Guidance
- If you add a new startup dependency, make sure it behaves sensibly when Mongo is unavailable locally. Production exits on startup failure; development generally logs and keeps the server alive.
- If you add a new live game field, remember the active in-memory model path in `src/models/Game.js`, not just the Mongoose schema.
- If you change any socket payload shape, update the browser client, spectator code, and the docs that mention the payload.
