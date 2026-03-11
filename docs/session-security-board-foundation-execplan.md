# Session Security and Board Foundation Refactor

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI\PLANS.md).

## Purpose / Big Picture

After this change, the game server should stop trusting client-supplied identity for game actions, lobby operations, sockets, and admin access. Guests should still work, but they should be minted and recovered by the server rather than by accepting arbitrary `userId` values from the browser. The browser should also have a cleaner board rendering boundary so the in-game board can move to Canvas later without rewriting menus, overlays, or account flows.

The user-visible proof is straightforward. A guest should still be able to open the site and get a working session. A signed-in player should still be able to queue, start a game, reconnect, and spectate. The admin dashboard should only load for `marcellbabai@gmail.com`. The board should still render the same way, but the render code should now flow through a scene-building boundary instead of constructing the DOM directly from legacy controller state.

## Progress

- [x] (2026-03-10 15:04Z) Read `PLANS.md`, `AGENTS.md`, the auth/session routes, socket server, lobby routes, admin surfaces, and the board rendering path.
- [x] (2026-03-10 15:11Z) Confirmed the main root cause: the current stack mixes server-owned auth cookies with client-owned `localStorage`, client-written cookies, raw `userId` fallbacks, and body-provided player colors.
- [x] (2026-03-10 15:24Z) Added `src/utils/requestSession.js`, `src/utils/adminAccess.js`, `src/utils/gameAccess.js`, and `src/utils/lobbyAccess.js` to centralize session recovery, admin-email authorization, player-color binding, and guest-capable lobby session resolution.
- [x] (2026-03-10 15:39Z) Refactored auth routes, admin routes, game-action routes, lobby routes, and read endpoints to use the shared helpers and stop trusting raw body or handshake identity fields.
- [x] (2026-03-10 15:46Z) Simplified browser auth/bootstrap so fetches rely on cookies, queue requests no longer include fallback `userId`, and the main/game/admin sockets no longer depend on browser-readable JWTs.
- [x] (2026-03-10 15:50Z) Added `public/js/modules/board/scene.js` and updated the DOM board renderer to consume a renderer-neutral scene as the first step toward a future Canvas board.
- [x] (2026-03-10 15:59Z) Updated docs and added focused regression tests for session and route authorization helpers.
- [x] (2026-03-10 15:59Z) Ran focused Jest verification and manual Playwright validation against `http://127.0.0.1:3100`.
- [ ] Resolve the existing Jest/browser-module ESM loader failures in `tests/sharedGameConstants.test.js`, `tests/boardAnnotations.test.js`, and `tests/spectateViewModel.test.js` so the full suite can pass again. This appears pre-existing and was surfaced during the broader verification run.

## Surprises & Discoveries

- Observation: the browser still mirrors `cgToken` into `localStorage` and rewrites identity cookies in multiple places, even though `/api/auth/session` already exists as a server repair point.
  Evidence: `public/index.js`, `public/js/modules/api/game.js`, and `public/js/modules/utils/cookies.js`.

- Observation: the current Socket.IO connection already has access to request cookies through the handshake, so the `handshake.auth.userId` fallback is not required for anonymous guests.
  Evidence: the same-origin browser socket is created from `public/index.js`, and `src/socket.js` already consumes `socket.handshake.auth`.

- Observation: `public/js/modules/components/boardView.js` is already a stable wrapper around the board renderer, which makes it the correct seam for a future Canvas renderer.
  Evidence: both the main player client and spectator controller call `createBoardView(...)`.

- Observation: the full Jest run is currently blocked by browser-module import worker tests that already rely on an ESM execution path Jest is not successfully loading in this environment.
  Evidence: `tests/sharedGameConstants.test.js`, `tests/boardAnnotations.test.js`, and `tests/spectateViewModel.test.js` all fail with `Unexpected token 'export'` or `Cannot use import statement outside a module` while direct backend/security-focused suites pass.

- Observation: the new cookie-first client/session path works end to end in a live browser session without any `cg_token` local storage entry.
  Evidence: Playwright on `http://127.0.0.1:3100` showed `userId` and `username` cookies, `cg_userId` and `cg_username` local storage keys, no `cg_token`, a successful guest socket connection, successful quickplay enter/exit, and a `403` response body from `/admin` as a guest.

## Decision Log

- Decision: make the server authoritative for guest recovery and authenticated session recovery across both HTTP and sockets before doing broader UI refactors.
  Rationale: every later improvement depends on trustworthy identity. Canvas preparation and performance work are lower value if the action and session boundaries are still client-asserted.
  Date/Author: 2026-03-10 / Codex

- Decision: keep the board as a hybrid surface, with menus and overlays in DOM and only the board layer being prepared for a future Canvas renderer.
  Rationale: that matches the product need and avoids replacing browser-native UI behavior with custom drawing for account, menu, and admin flows.
  Date/Author: 2026-03-10 / Codex

## Outcomes & Retrospective

The main targeted outcome is implemented. The server now owns guest recovery, authenticated session recovery, admin-email authorization, and game-player binding across HTTP and Socket.IO. The browser no longer depends on a readable JWT for fetch or socket auth, and the board renderer now has a scene-building seam that can support a future Canvas implementation without rewriting the whole client.

The main remaining gap is not in the refactor itself but in the broader test environment. The full Jest run still trips over pre-existing ESM/browser-worker tests that are outside the security/session changes made here. Focused backend and route-security suites pass, and live browser validation on port `3100` succeeded.

## Context and Orientation

The backend entry point is `src/server.js`. It serves the browser HTML shells, REST API, and Socket.IO namespaces from one process. Authentication currently flows through `src/routes/auth/google.js` and `src/utils/authTokens.js`. Guest creation happens in `src/utils/ensureUser.js`. Live game and lobby behavior is driven by route handlers under `src/routes/v1/` and the Socket.IO server in `src/socket.js`.

The frontend still runs mostly through `public/index.js`, but some rendering has already been peeled into modules under `public/js/modules/`. The important current seam is `public/js/modules/components/boardView.js`, which calls `public/js/modules/render/board.js`. A “scene” in this plan means a plain JavaScript description of what should appear on the board: squares, labels, pieces, overlays, and interaction metadata. A scene is renderer-neutral, which is what makes it useful for a future Canvas implementation.

Admin access in this repository is intentionally tied to one Google account, `marcellbabai@gmail.com`, rather than a generic shared secret. The current code only enforces that partially in the browser. This plan moves that rule onto the server and keeps the browser check as a convenience layer only if still useful.

## Plan of Work

First, create shared server helpers under `src/utils/` that resolve request sessions and admin access in one place. The session helper should read JWTs from cookies or headers, recover guest accounts from the `userId` cookie, optionally create a new guest when a route allows anonymous access, and own the cookie-writing helpers used by auth routes and guest-capable routes. The admin helper should check whether the resolved authenticated user email matches `marcellbabai@gmail.com`.

Second, update the backend trust boundaries. `src/socket.js` should resolve both default and admin namespace identities from the shared session helper and should stop accepting raw `handshake.auth.userId`. The lobby routes should stop trusting `req.body.userId` and instead use the resolved or newly created session. The game-action routes should derive the acting color from `game.players` and the resolved session, then reject mismatches instead of trusting the request body. User, game, match, and lobby read routes should return only the data the caller is allowed to see.

Third, simplify the browser auth/bootstrap flow. The browser should stop mirroring JWTs into `localStorage`, stop reading auth tokens from JavaScript-accessible cookies, and stop sending fallback `userId` values in the socket handshake. Requests should rely on `fetch(..., { credentials: 'include' })` and the server-owned cookie session. Any remaining local storage should be limited to harmless UX state such as the cached username or queue timers.

Fourth, prepare the board for Canvas without implementing Canvas yet. Introduce a pure board scene builder module under `public/js/modules/board/` that translates game state plus layout metrics into a renderer-neutral scene description. Then update the existing DOM renderer to consume that scene. `createBoardView()` remains the public interface so a later Canvas renderer can be swapped in behind it.

Finally, update the docs and verify the system. Add Jest coverage for the new session/admin helpers and the locked-down routes. Run focused server tests. Start the app on a non-3000 port and use Playwright to validate the main login/session shell, queue flow, and board page load.

## Concrete Steps

All commands run from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Inspect the current auth, socket, and board paths:

    Get-Content src/routes/auth/google.js
    Get-Content src/socket.js
    Get-Content src/routes/v1/lobby/enterQuickplay.js
    Get-Content src/routes/v1/gameAction/move.js
    Get-Content public/index.js
    Get-Content public/js/modules/components/boardView.js
    Get-Content public/js/modules/render/board.js

Run focused verification while iterating:

    cmd /c npm test -- tests/googleAuth.session.test.js tests/activeMatches.normalizeId.test.js tests/responseRoutes.pendingValidation.test.js

After the backend refactor lands, expand focused coverage with new auth/session and route tests:

    cmd /c npm test -- tests/googleAuth.session.test.js tests/requestSession.test.js tests/routeAuthorization.test.js

For browser verification, start the server on a non-3000 port and drive it with Playwright:

    $env:PORT=3100
    cmd /c npm start

Then use the Playwright CLI wrapper to open the app, confirm the shell renders, and inspect the admin page behavior for signed-out versus authorized sessions.

## Validation and Acceptance

Acceptance for the backend work is behavioral. Anonymous users should still receive a guest session from the server. Queue endpoints should not let one browser submit another player’s `userId`. Game action routes should reject requests when the resolved session does not match the acting player. Admin HTTP routes, the `/admin` page, and the `/admin` socket namespace should reject non-admin sessions and allow the authorized Google account.

Acceptance for the frontend work is structural and behavioral. The browser should still load, queue, and render games, but the auth flow should no longer depend on a JavaScript-readable JWT. The board should still render the same pieces, labels, and overlays, but those visuals should now come from a renderer-neutral board scene builder. A later contributor should be able to add a Canvas renderer by changing `createBoardView()` internals rather than rewriting `public/index.js`.

## Idempotence and Recovery

These changes are safe to apply incrementally because the plan preserves existing route paths and event names. The session helper should remain backward-compatible with either cookie-based or header-based JWTs during the migration. If a browser still carries old `localStorage['cg_token']`, the client should simply stop using it; leaving the stale key behind must not break the app. The board scene builder is additive because the DOM renderer will continue to produce the current visuals until a future Canvas renderer is introduced.

## Artifacts and Notes

Focused evidence gathered before implementation:

    `src/socket.js` currently falls back to `socket.handshake.auth.userId`.
    `src/routes/v1/lobby/enterQuickplay.js` and exit routes accept body `userId`.
    `src/routes/v1/gameAction/*` accept body `color` and do not bind it to the resolved player.
    `public/index.js` reads `cgToken` from both cookies and `localStorage`.

The primary documentation files that must be updated if this plan changes behavior are:

    src/utils/AGENTS.md
    src/routes/auth/AGENTS.md
    public/AGENTS.md
    README.md

## Interfaces and Dependencies

The shared session helper should expose stable functions with repository-relative names that make the call sites obvious:

    src/utils/requestSession.js
      - resolveSessionFromRequest(req, options)
      - resolveSessionFromSocketHandshake(handshake, options)
      - applyAuthenticatedCookies(req, res, user, token)
      - applyGuestCookies(req, res, guestInfo)

The admin helper should live in:

    src/utils/adminAccess.js
      - ADMIN_EMAIL
      - isAdminSession(session)
      - ensureAdminRequest(req, res)
      - ensureAdminSocketHandshake(handshake)

The board scene builder should live in:

    public/js/modules/board/scene.js
      - buildBoardScene({ sizes, state, fileLetters, labelFont, options })

The existing DOM renderer in `public/js/modules/render/board.js` should be updated to render from the scene rather than re-deriving layout and overlays from controller state.

Revision note: created this ExecPlan before implementation after tracing the current auth/session, lobby, socket, admin, and board-rendering boundaries and deciding to make the server authoritative before preparing the board for Canvas.

Revision note: updated after implementation to record the completed session/auth refactor, queue/game/socket trust-boundary fixes, board scene extraction, focused Jest coverage, live Playwright verification, and the remaining full-suite ESM loader issue.
