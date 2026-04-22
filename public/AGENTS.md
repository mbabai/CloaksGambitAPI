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
  - `tournaments/` for the persistent tournament panel, bracket, and tournament-specific client helpers
  - `ui/` for overlay/button/icon/toast helpers
  - `utils/` for cookies, clocks, time control, and asset preloading

## Session and Token Behavior
- The browser refreshes identity through `/api/auth/session`.
- Auth is cookie-first now. `authFetch()` should send `credentials: 'include'`, and the browser should not depend on reading `cgToken` from JavaScript.
- The socket handshake relies on the server-owned cookie session; do not reintroduce raw `userId` fallback auth.
- `localStorage` may still cache harmless UX state such as queue timers or the last known username, but not the auth token.

## Board and Spectator Notes
- `public/js/modules/gameView/view.js` is now the shared single-board surface for live play, spectate, and replay/admin uses. It composes the board, bars, overlays, and visibility mode.
- `public/js/modules/components/boardView.js` is the board-only wrapper used underneath `gameView`. It now renders through Canvas, keeps a lightweight hit layer for interactions, and exposes geometry plus bubble-overlay helpers.
- `public/js/modules/board/scene.js` remains the renderer-neutral board scene builder. `public/js/modules/render/board.js` now paints that scene onto Canvas instead of rebuilding visible DOM squares.
- `public/js/modules/ui/toasts.js` owns the non-blocking game-area toast host plus the timed pulse state for dagger and captured-piece highlights. Keep the queueing/timing logic there instead of re-implementing timers in `public/index.js` or the spectate controller.
- `public/js/modules/ui/gameToastEvents.js` is the pure snapshot-diff helper that decides which toasts and pulse triggers a game update should produce. If you change when bombs, challenges, turn switches, dagger gains, or captured-piece pulses surface, update that helper and its focused Jest coverage together.
- Visibility rules live in `public/js/modules/gameView/modes.js`. Use explicit `player`, `spectator`, and `god` modes rather than ad hoc masking in individual screens.
- Board annotations still attach to the board container, so keep the board surface positioned and sized through the shared wrappers instead of bypassing them.
- The board Canvas must paint in the same order as the old DOM board: squares first, marble texture over the board, then borders/labels/pieces. Drawing the texture underneath opaque squares makes the board look flatter and loses the original grey marble feel.
- Keep the board container below overlay buttons in stacking order. The board hit layer is intentionally interactive, so `gameView` should own z-index ordering for board vs. bars vs. setup/action buttons.
- `public/js/modules/utils/clockState.js` should be used to animate from the server clock snapshot, not to replace server clock authority.
- `public/js/modules/tournaments/ui.js` owns the tournament browser/panel/bracket and publishes tournament accept-needed state, but it does not own the purple accept banner itself.
- `public/js/modules/tournaments/acceptScheduler.js` owns the client-side grace period between a completed tournament match and the next accept banner. Keep accept countdown/grace math there instead of duplicating it in `public/index.js`.

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
- Tournament game exits should go through `tournamentUiController.exitTournamentGameToPanel()` so the panel refreshes immediately and the next accept decision comes from fresh server state.
- Do not reintroduce the generic non-tournament `Match Complete` summary for the last game of a tournament match. Tournament players should return to the panel first and only then see any next-match accept flow.
- If you change auth or socket payloads, verify both the live board and the spectate flow.
- If you change browser-side rule presentation, cross-check `rules.md` and the server routes so the UI text still matches the backend.
- The player history overlay uses `.player-history-sections` as the desktop scroll container. Do not bind wheel handling to individual game-square rows or turn the match list into a separate nested desktop scroll pane unless the layout is being redesigned on purpose.
