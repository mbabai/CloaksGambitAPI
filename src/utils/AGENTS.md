# Utility Notes

## Key Utilities
- `getServerConfig.js`: cached server config loader layered on top of `shared/constants`.
- `authTokens.js`: JWT creation, parsing, header/cookie extraction, and request user resolution.
- `authCookies.js`: cookie option builder driven by environment variables.
- `requestSession.js`: shared request/socket session resolution plus auth/guest cookie application.
- `adminAccess.js`: server-side admin email checks for HTTP and Socket.IO.
- `ensureUser.js`: guest creation and legacy-user normalization.
- `gameClock.js`: server-authoritative live clock state, transitions, and socket payload helpers.
- `gameView.js` and `spectatorSnapshot.js`: hidden-information masking for players and spectators.
- `localDebugLogger.js`: optional local JSONL logging for clock and route debugging.

## Recent Auth Refactor
- `ensureUser()` now distinguishes real accounts from guest accounts by email and bot flags.
- Real users with an incorrect `isGuest` flag are repaired instead of being normalized into guest data.
- `requestSession.resolveSessionFromRequest()` and `resolveSessionFromSocketHandshake()` are now the canonical trust boundary for guests, authenticated users, and socket handshakes.
- `authTokens.extractTokenFromRequest()` accepts:
  - `Authorization: Bearer ...`
  - raw `Authorization` tokens
  - the `cgToken` cookie

## Cookie Behavior
- `buildAuthCookieOptions()` is environment-driven:
  - production defaults to `SameSite=None`
  - local development defaults to `SameSite=Lax`
  - `SameSite=None` forces `secure: true`
- Auth cookies are now server-owned. `cgToken` is `httpOnly`, guest/auth cookies are written by the server, and the browser should not mirror the token into local storage anymore.
- If you change cookie names or scope, inspect the session bootstrap in `public/index.js` and the guest/session helpers in `src/utils/requestSession.js`.

## Clock Authority
- `gameClock.js` is now the server clock source of truth.
- Stored `game.clockState` is preferred over replaying `actions`.
- The fallback replay path still exists so older or partially migrated game data can be serialized safely.
- Route handlers and sockets should consume helpers from here rather than open-coding timestamps.

## Server Config Cache
- `getServerConfig.js` backfills and normalizes legacy ranked settings from MongoDB into the current constants shape.
- Callers expect map-like access (`config.actions.get('MOVE')`) and plain-object access for some nested settings. Preserve both.

## Change Discipline
- If you change auth helpers, inspect:
  - `src/routes/auth/google.js`
  - queue routes that use `resolveLobbySession()`
  - `src/socket.js`
  - `public/index.js`
  - `public/js/modules/api/game.js`
- If you change masking or clock helpers, inspect both player and spectator clients.
