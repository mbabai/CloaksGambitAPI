# Canvas Game View Refactor

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI\PLANS.md).

## Purpose / Big Picture

After this change, the in-game board should render through one reusable Canvas-based game surface instead of being rebuilt out of per-cell DOM. A player should still be able to play a game, drag and click pieces, see clocks and bars, and get the same move/challenge overlays. A spectator should use the same surface with a different visibility mode, and future admin or replay tooling should be able to reuse the same view in a future "god view" mode without inventing a second board stack.

The user-visible proof is concrete. Starting the app and entering a live game should show the board on a Canvas surface while preserving normal move input and overlays. Opening a spectate view should render through the same `game view` module, not a separate board assembly path. The code should expose one surface API that can later host multiple simultaneous boards for tournament watching.

## Progress

- [x] (2026-03-11 03:14Z) Read `PLANS.md`, `public/AGENTS.md`, the current board scene, board renderer, spectator controller, play-area layout path, and the input/drag code in `public/index.js`.
- [x] (2026-03-11 03:19Z) Confirmed the key migration seam: `public/js/modules/board/scene.js` already builds renderer-neutral cell data, but player and spectator still assemble separate board/bars/layout paths and the main client still depends on per-cell DOM refs for hit-testing and overlays.
- [x] (2026-03-11 11:30Z) Added `public/js/modules/gameView/modes.js` and `public/js/modules/gameView/view.js`, documenting explicit `player`, `spectator`, and `god` visibility modes in code and wiring a single surface API around the board, bars, and overlay layer.
- [x] (2026-03-11 11:41Z) Replaced the visible board DOM renderer with a Canvas renderer in `public/js/modules/render/board.js` and moved `createBoardView()` to a Canvas stage with bubble overlays, geometry helpers, and a lightweight hit layer so replay/admin tooling stayed functional.
- [x] (2026-03-11 11:58Z) Migrated the main play surface in `public/index.js` to `createGameView()`, switched board overlays onto the shared bubble API, and moved drag hit-testing onto the board geometry helpers.
- [x] (2026-03-11 12:07Z) Migrated `public/js/modules/spectate/controller.js` onto the shared game-view stack so spectator masking and shared board rendering now use one client abstraction.
- [x] (2026-03-11 12:23Z) Added focused view-mode regression coverage in `tests/gameViewModes.test.js`, ran `npm test`, and verified the live player surface with Playwright on `3101` after `3100` was already occupied by another app process.

## Surprises & Discoveries

- Observation: the repository already has the right data boundary for a renderer swap because `buildBoardScene()` emits plain cell models rather than mutating DOM directly.
  Evidence: `public/js/modules/board/scene.js`.

- Observation: the hardest part of the migration is not drawing the board; it is replacing all of the board-related hit-testing and overlay behavior that currently assumes each square is a DOM element.
  Evidence: `public/index.js` uses `refs.boardCells` for move-choice bubbles, drag previews, drop hit-testing, and post-move overlays.

- Observation: `createBoardView()` remained a shared low-level dependency during the migration, so the board-layer API needed to stay stable while player and spectator flows moved to a higher-level `game view`.
  Evidence: `public/index.js` and `public/js/modules/spectate/controller.js` both instantiate `createBoardView()`.

- Observation: once the board became a positioned Canvas surface with its own hit layer, sibling setup buttons could be blocked unless the board container itself stayed in a lower stacking context than the action overlays.
  Evidence: Playwright caught `Random Setup` clicks being intercepted by `.cg-board-hit-cell` until `public/js/modules/gameView/view.js` assigned explicit z-index ordering for board and bar layers.

## Decision Log

- Decision: introduce a higher-level `game view` module instead of teaching `public/index.js` and the spectator controller to assemble Canvas boards independently.
  Rationale: the user explicitly wants one replicable surface that can support player view, spectator view, god view, and eventually multiple boards at once. A shared module is the only path that keeps those concerns from splitting again.
  Date/Author: 2026-03-11 / Codex

- Decision: keep stash controls, move buttons, menus, and account overlays in DOM for now while moving the board surface itself to Canvas.
  Rationale: the board is the spatial, animation-prone surface. The surrounding controls do not benefit from Canvas and would add unnecessary migration risk.
  Date/Author: 2026-03-11 / Codex

## Outcomes & Retrospective

The reusable surface is now in place. `createGameView()` owns the single-board client surface for play, spectate, and replay, while `createBoardView()` has been reduced to the board-specific Canvas stage underneath it. Player and spectator flows no longer assemble separate board and bar stacks, and replay/admin rendering now uses `god` view mode instead of relying on a separate board path.

The migration was intentionally not "Canvas everywhere." Menus, stash controls, overlays, and bars remain DOM. The board itself now renders through Canvas, but a lightweight hit layer remains on top for input compatibility and accessibility. That compromise kept the interaction refactor tractable while still moving visual rendering, visibility modes, and future animation seams onto the new shared surface.

Validation landed on two levels. `npm test` passed with 27 suites / 79 tests, including the new `tests/gameViewModes.test.js`. Playwright verification on `http://127.0.0.1:3101/` confirmed that the live player surface mounted a real Canvas board, no console warnings appeared, and setup overlays such as `Random Setup` remained clickable after the board-layer stacking fix.

## Context and Orientation

The browser still boots through `public/index.js`, and most live-game behavior still lives there. The current board is built in `renderBoardAndBars()` inside `public/index.js`. That function computes layout, calls `createBoardView()` to rebuild the board DOM, calls `renderBars()` to rebuild the top and bottom info bars, calls `renderStash()` for the stash and on-deck rows, and then manually places action buttons and post-move overlay bubbles.

`public/js/modules/components/boardView.js` is currently a wrapper around `public/js/modules/render/board.js`. Today that renderer creates one DOM square per board cell. The new plan keeps `createBoardView()` as the board-layer abstraction, but changes its internals so it draws onto a Canvas and exposes geometry helpers such as "which square is under this pointer" and "where is square row X / col Y on screen".

The term "game view" in this plan means the entire reusable game surface for a single board: board, bars, overlay layer, hit-testing, and visibility rules. The term "view mode" means what the viewer is allowed to see. `player` mode shows the player's own identities and hides enemy identities. `spectator` mode hides all identities. `god` mode shows all identities. The backend already supports equivalent masked and unmasked game payloads through `src/utils/gameView.js`; this client refactor makes the rendering surface understand those modes explicitly instead of assuming one board representation.

The spectator flow currently lives in `public/js/modules/spectate/controller.js`. It already renders the same board state through the same board wrapper, but it still assembles its own board, bar, and overlay path. This plan replaces that duplicated assembly with the new `game view` surface.

## Plan of Work

First, add the new `public/js/modules/gameView/` subtree. It should contain a small set of modules with stable names:

`public/js/modules/gameView/modes.js` should define and normalize the client-side view modes and expose a piece-visibility transform that can mask a piece to the `UNKNOWN` identity when the current mode is not allowed to see that identity.

`public/js/modules/gameView/view.js` should define `createGameView({ container, identityMap, annotationsEnabled })`. That constructor should create the DOM scaffold for a single game surface: a board stage, a Canvas element, a bubble overlay layer, and DOM containers for the top and bottom bars. It should expose methods to render the board and bars together, update bubble overlays, hit-test board coordinates from client pointer coordinates, and destroy the surface cleanly.

Second, update the board scene and board renderer. `public/js/modules/board/scene.js` should accept a piece transform in its options so the same board state can be displayed as player, spectator, or god view without mutating the original game state. `public/js/modules/components/boardView.js` should stop calling the DOM board renderer and should instead own a Canvas renderer plus an overlay layer. It should continue to expose `render()`, `setReadOnly()`, `destroy()`, `getState()`, and `getSizes()`, and it should gain geometry helpers used by the new game view and the player input code.

Third, migrate the main live play path in `public/index.js`. Replace the manual `boardRoot`, `topBar`, and `bottomBar` setup with one `gameView` instance mounted inside the play area. Update `renderBoardAndBars()` so it delegates board and bars rendering to the new game view. Replace direct `refs.boardCells` hit-testing and bubble attachment with the new geometry and overlay APIs. The move rules, server payloads, stash rendering, and action buttons should remain functionally the same.

Fourth, migrate the spectator controller. Replace its `boardView` plus `renderBars()` assembly with `createGameView()`, pass it the spectator mode, and move overlay bubbles to the new surface API. The socket protocol and status/meta UI should remain the same.

Finally, add tests and validation. Add focused tests for view-mode masking and board-scene transformations. Start the app on port `3100`, run a live game flow, and open a spectate flow with Playwright so the Canvas board, bars, and overlays are verified in the browser.

## Concrete Steps

All commands run from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Inspect the current board and spectator stack:

    Get-Content public/js/modules/board/scene.js
    Get-Content public/js/modules/components/boardView.js
    Get-Content public/js/modules/render/board.js
    Get-Content public/js/modules/spectate/controller.js
    Get-Content public/index.js

Run focused Jest validation while iterating:

    cmd /c npm test -- tests/spectateViewModel.test.js tests/uiClassNames.test.js

Run the full suite before closing the work:

    cmd /c npm test

For browser verification, start the app on a non-3000 port:

    set PORT=3100&& node src/server.js

Then drive the app with Playwright CLI against `http://127.0.0.1:3100/`, checking both the normal play surface and the spectate surface.

## Validation and Acceptance

Acceptance is behavioral. In a live game, the board should render on a Canvas surface and still support normal click and drag interactions for setup, on-deck, and in-game moves. The top and bottom bars should still show names, clocks, wins, challenge bubbles, captured pieces, and daggers in the same positions they do now. Spectating a live match should use the same game-view module but render spectator masking and no player input.

The structural acceptance is just as important. `public/index.js` and `public/js/modules/spectate/controller.js` should no longer assemble their own board and bar stacks. They should both use the same `createGameView()` surface API, and that API should accept a view mode that can later be reused for admin or replay tooling. The board-layer code should no longer require one DOM element per square to function.

The test acceptance is to run `npm test` and keep the full suite green. Add new focused tests so the mode-masking and scene-transform logic are locked down by code, not only by manual inspection.

## Idempotence and Recovery

The migration should stay additive until both the player and spectator flows are working on the new surface. `createBoardView()` remains available during the transition so other replay tooling does not break halfway through. If a milestone fails partway, revert only the in-progress module wiring and keep the existing server contracts untouched. No destructive data migration is involved.

## Artifacts and Notes

The important artifacts for this refactor are the Playwright screenshots of the new Canvas board in both play and spectate contexts, plus the new focused tests for view modes and board-scene behavior.

## Interfaces and Dependencies

The new client surface layer should expose these stable interfaces by the end of the work:

In `public/js/modules/gameView/modes.js`, define:

    export const GAME_VIEW_MODES
    export function normalizeGameViewMode(mode)
    export function createPieceVisibilityTransform({ mode, viewerColor, unknownIdentity })

In `public/js/modules/gameView/view.js`, define:

    export function createGameView({
      container,
      identityMap,
      annotationsEnabled,
    })

That constructor must return an object with methods equivalent to:

    {
      render({ sizes, boardState, barsState, viewMode, viewerColor, fileLetters, labelFont, readOnly, deploymentLines, onNameClick, shouldAllowPlayerClick }),
      setBubbleOverlays(overlays),
      clearBubbleOverlays(),
      hitTestBoard(clientX, clientY),
      getCellClientRect(uiRow, uiCol),
      getBoardClientRect(),
      setBoardTransientState(patch),
      clearBoardTransientState(),
      destroy(),
    }

The existing `public/js/modules/components/boardView.js` must remain a valid board-layer abstraction, even if its internals move to Canvas and its geometry helpers expand.

Revision note: created this ExecPlan after tracing the current player board, spectator board, board scene, and drag/hit-test paths. The chosen approach is a shared Canvas game surface with explicit view modes rather than separate player and spectator assembly code.
