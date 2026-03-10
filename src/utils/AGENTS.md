# Utility Notes

## Key Utilities
- `getServerConfig.js`: cached server config loader layered on top of `shared/constants`.
- `authTokens.js`: JWT creation, parsing, header/cookie extraction, and request user resolution.
- `authCookies.js`: cookie option builder driven by environment variables.
- `ensureUser.js`: guest creation and legacy-user normalization.
- `gameClock.js`: server-authoritative live clock state, transitions, and socket payload helpers.
- `gameView.js` and `spectatorSnapshot.js`: hidden-information masking for players and spectators.
- `localDebugLogger.js`: optional local JSONL logging for clock and route debugging.

## Recent Auth Refactor
- `ensureUser()` now distinguishes real accounts from guest accounts by email and bot flags.
- Real users with an incorrect `isGuest` flag are repaired instead of being normalized into guest data.
- `authTokens.extractTokenFromRequest()` accepts:
  - `Authorization: Bearer ...`
  - raw `Authorization` tokens
  - the `cgToken` cookie

## Cookie Behavior
- `buildAuthCookieOptions()` is environment-driven:
  - production defaults to `SameSite=None`
  - local development defaults to `SameSite=Lax`
  - `SameSite=None` forces `secure: true`
- If you change cookie names or scope, update the browser token sync code too.

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
  - queue routes that use `resolveUserFromRequest()`
  - `src/socket.js`
  - `public/index.js`
  - `public/js/modules/api/game.js`
- If you change masking or clock helpers, inspect both player and spectator clients.
