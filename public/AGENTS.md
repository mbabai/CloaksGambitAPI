# Client Notes

## Boot Path
- `public/index.html` loads `public/js/main.js`.
- `public/js/main.js` is a version-aware bootstrap that imports `public/js/modules/app.js`.
- `public/js/modules/app.js` currently just hands off to the legacy `public/index.js`.
- Most real client behavior still lives in `public/index.js`.

## Current Client Architecture
- `public/index.js` is still the central live-game controller.
- Newer logic is being peeled into modules under `public/js/modules/`:
  - `api/` for request wrappers
  - `components/` for shared UI primitives like `boardView`
  - `render/` for board/bars/stash visuals
  - `spectate/` for spectator state and view modeling
  - `ui/` for overlay/button/icon helpers
  - `utils/` for cookies, clocks, time control, and asset preloading

## Session and Token Behavior
- The browser refreshes identity through `/api/auth/session`.
- `cgToken` is mirrored from cookie to `localStorage['cg_token']`.
- `authFetch()` adds the bearer token when present and always sends cookies with `credentials: 'include'`.
- The socket handshake sends the JWT token when available and otherwise falls back to the stored `userId`.

## Board and Spectator Notes
- `public/js/modules/components/boardView.js` is the shared board wrapper for player and spectator surfaces.
- Board annotations and spectator overlays already rely on the partially modularized board stack.
- `public/js/modules/utils/clockState.js` should be used to animate from the server clock snapshot, not to replace server clock authority.

## Server Contract Notes
- Live updates come from Socket.IO:
  - `initialState`
  - `queue:update`
  - `game:update`
  - `game:finished`
  - spectate and admin events
- The `clocks` payload sent by the server is the preferred source for displayed time.
- HTML shells contain `__ASSET_VERSION__`, which the server replaces at request time. Keep that token intact if you edit the HTML templates.

## Editing Guidance
- If you split more code out of `public/index.js`, keep the public behavior unchanged first and move logic second.
- If you change auth or socket payloads, verify both the live board and the spectate flow.
- If you change browser-side rule presentation, cross-check `rules.md` and the server routes so the UI text still matches the backend.
