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
- Socket auth accepts a JWT token first and falls back to `ensureUser()` guest creation when no real session is available.
- The browser depends on a readable `cgToken` cookie plus `localStorage['cg_token']`. Any move toward httpOnly-only tokens would require a coordinated browser and socket handshake redesign.

## Recent Refactors Worth Knowing
- Clock authority now lives on `game.clockState`, not only on action replay. Read `src/utils/gameClock.js` and `docs/clock-authority-debug-execplan.md` before changing live clock behavior.
- The auth/session path now repairs real-user cookies in development and keeps `ensureUser()` from turning real accounts back into guests.
- Startup Mongo behavior changed in March 2026 to stop mutating Atlas URIs and instead retry with explicit `dbName` plus optional `authSource=admin`.

## Editing Guidance
- If you add a new startup dependency, make sure it behaves sensibly when Mongo is unavailable locally. Production exits on startup failure; development generally logs and keeps the server alive.
- If you add a new live game field, remember the active in-memory model path in `src/models/Game.js`, not just the Mongoose schema.
- If you change any socket payload shape, update the browser client, spectator code, and the docs that mention the payload.
