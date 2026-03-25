# Route Notes

## Layout
- `src/routes/index.js` mounts:
  - `/api/v1/*` from `src/routes/v1/`
  - `/api/auth/*` from `src/routes/auth/google.js`
- `src/routes/v1/index.js` registers each route module explicitly instead of auto-loading directories. If you add a route file, you must mount it there.

## Common Patterns
- Most mutating routes follow this order:
  1. Resolve or normalize the acting user/color.
  2. Load the `Game`, `Match`, or `User`.
  3. Validate state transitions using current config from `getServerConfig()`.
  4. Mutate the document.
  5. Save or end the document.
  6. Emit `eventBus` notifications so sockets and admin views update.
- Live game routes should rely on `src/utils/gameClock.js` for time transitions and `src/services/game/liveGameRules.js` for shared pending-move helpers where available.

## Auth Expectations
- Quickplay and bot-entry flows can fall back to `ensureUser()` guest creation.
- Ranked queue is stricter:
  - production rejects guests and unauthenticated users.
  - local development still allows guest fallback for easier testing.
- Auth-specific behavior is documented in `src/routes/auth/AGENTS.md`.

## Queue and Matchmaking Behavior
- Lobby routes mutate the in-memory `src/state/lobby.js` store, then call into `src/routes/v1/lobby/matchmaking.js`.
- The lobby store is process-local and intentionally cleared on server startup.
- Matchmaking serializes itself through a promise queue so two concurrent queue joins do not create duplicate matches.

## Game Rules Ownership
- `src/routes/v1/gameAction/` is the live HTTP state machine for the board game.
- `rules.md` is the long-form rule reference.
- `shared/constants/game.json` is the machine-readable constants source.
