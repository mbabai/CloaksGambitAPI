# Board Annotations, Clock Authority, and Rules Cleanup

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI\PLANS.md).

## Purpose / Big Picture

After this change, both players and spectators can draw private right-click board annotations (circles and snapped arrows) without affecting gameplay, the visible clock state is driven from one authoritative server snapshot instead of each client inferring it independently, and the live game routes are cleaned up to better match the written Cloaks' Gambit rules. A user should be able to open a live game or spectate view, draw on the board with right-click, left-click anywhere to clear all drawings, and watch each side's clock advance independently with the same values across both clients and spectator mode.

## Progress

- [x] (2026-03-09 22:13Z) Read `PLANS.md`, mapped the board renderer, player client, spectate controller, socket emissions, and route-level rules flow.
- [x] (2026-03-09 22:21Z) Identified existing duplication and cleanup targets: duplicated clock computation on server/client/spectate, route-level pending-move logic spread across endpoints, and `boardView` read-only mode blocking any future spectator board interaction by disabling pointer events on the entire container.
- [x] (2026-03-09 22:27Z) Ran focused Jest suites covering shared constants, pending-move move route safety, spectate view derivation, clock helpers, class names, and bot declaration legality. These currently pass. The full suite currently times out because `tests/mlRuntime.test.js` is significantly slower than the rest and needs separate handling.
- [x] (2026-03-09 23:02Z) Added a shared board-annotation controller in `public/js/modules/components/boardAnnotations.js`, wired it through `createBoardView()`, enabled it for the live board and spectate board, and restricted legacy board interactions to left-click so right-click drawing does not leak into move selection.
- [x] (2026-03-09 23:15Z) Refactored live clock delivery so `src/utils/gameClock.js` builds authoritative `clocks` payloads, `src/socket.js` and `src/utils/spectatorSnapshot.js` emit them, and both player/spectate clients tick from the server snapshot with browser-side fallback only when no snapshot is present.
- [x] (2026-03-09 23:22Z) Added `src/services/game/liveGameRules.js` for shared pending-move helpers, tightened `bomb`/`pass` to require a real pending move window, and removed the fake setup stash placeholder while validating `onDeck.color`.
- [x] (2026-03-09 23:31Z) Updated `README.md` and `docs/ui-components.md` to document board annotations and the new socket `clocks` payload, then reran focused Jest suites plus representative ML runtime tests.
- [x] (2026-03-10 07:34Z) Ran the full `npm test` command to capture the real end-state. The gameplay-focused suites still pass, while `tests/mlRuntime.test.js` remains the blocking outlier with long-running simulation timeouts under full load and one suite-interaction-only progress-event assertion failure that does not reproduce in isolation.
- [ ] Manual browser verification of right-click drawing and cross-client clock behavior in a live running app.

## Surprises & Discoveries

- Observation: spectator mode currently sets `boardView` to read-only by setting `pointer-events: none` on the whole board container, which prevents any board-local interaction at all, including the requested right-click drawings.
  Evidence: `public/js/modules/components/boardView.js` sets `container.style.pointerEvents = 'none'` in `updateInteractivity()`, and `public/js/modules/spectate/controller.js` calls `boardView.setReadOnly(true)`.

- Observation: clock math exists in three places with effectively the same algorithm, which makes player/spectator drift bugs likely and increases the chance of future rule skew.
  Evidence: `src/utils/gameClock.js`, `public/js/modules/utils/clockState.js`, and `src/utils/spectatorSnapshot.js` each compute active color and elapsed clock time from actions.

- Observation: the live routes already have a second rules reference implementation inside the ML engine, but the HTTP routes still hand-roll the same move, bomb, challenge, and on-deck state machine.
  Evidence: `src/services/ml/engine.js` exports `applyAction`, `getLegalActions`, `resolveMove`, `applyChallengeAction`, `applyBombAction`, and `applyOnDeckAction`, while `src/routes/v1/gameAction/*.js` duplicate those transitions directly.

- Observation: the setup route inserts a fake `UNKNOWN` piece into an empty stash, which is not part of the real rules and should never be necessary for a legal 8-piece setup.
  Evidence: `src/routes/v1/gameAction/setup.js` pushes `{ color: normalizedColor, identity: 0 }` when `newStash.length === 0`.

- Observation: the heavyweight ML runtime suite is not a good single-command smoke test in this environment. Targeted test-name slices complete normally, but the full suite still hits runtime pressure: some simulations exceed per-test limits, and the progress-event count assertion only fails when the whole suite runs together.
  Evidence: `tests/mlRuntime.test.js` passed for isolated slices such as `bootstraps snapshots and stores replayed simulations` and `simulation run emits start/game/complete progress events`, while the full `npm test` run failed in `tests/mlRuntime.test.js` after about 5 minutes with timeouts in `simulations support medium bot participants and alternating colors`, `medium bot self-play no longer collapses to 8-9 ply races`, and `supports game counts above previous 64 cap`, plus a `phase === 'game'` count mismatch that did not reproduce in isolation.

## Decision Log

- Decision: implement board drawings as a board-level overlay attached through `createBoardView`, not by adding one-off listeners in `public/index.js` and another copy in the spectate controller.
  Rationale: the user explicitly asked for the feature in both player and spectator modes and asked to refactor if those modes are out of sync. `createBoardView` is already the shared abstraction for both surfaces.
  Date/Author: 2026-03-09 / Codex

- Decision: move clocks toward server-authored snapshots and use client-side ticking only as a short-lived display animation on top of the last server snapshot.
  Rationale: this directly addresses cross-client drift. Spectator mode already behaves like this conceptually; player mode should use the same model instead of recomputing from raw actions locally and also applying optimistic local flips.
  Date/Author: 2026-03-09 / Codex

- Decision: prefer targeted live-route cleanup plus shared helpers over a full live migration onto the ML engine state object in this pass.
  Rationale: the ML engine is a strong rules reference, but the conversion layer between persisted `Game` documents and engine state is not yet a drop-in persistence boundary. A smaller shared-helper refactor can improve correctness now without risking a broad migration across already-dirty files.
  Date/Author: 2026-03-09 / Codex

## Outcomes & Retrospective

The shared board-annotation layer, server-authored clock snapshots, and targeted live-route cleanup are implemented. Focused Jest coverage now includes annotation snapping logic, socket clock payloads, and pending-response route validation, and representative ML runtime slices still pass after the rules cleanup. The main remaining gaps are end-to-end browser verification of the right-click UI and live clock behavior in a running local app, plus separate follow-up work on the heavy ML simulation suite if `npm test` must be fully green in one command.

## Context and Orientation

The browser client still lives primarily in `public/index.js`, but the board itself has already been partially modularized. `public/js/modules/components/boardView.js` is the shared wrapper around `public/js/modules/render/board.js`, and both the main player board and the spectate modal use it. The spectate surface is controlled by `public/js/modules/spectate/controller.js`; the player surface still keeps most of its input state, clocks, and move UI inside `public/index.js`.

The server sends board state through Socket.IO in `src/socket.js`. Each game update currently sends masked board data, actions, moves, and other state, but not a precomputed clock snapshot for players. Spectator snapshots are built in `src/utils/spectatorSnapshot.js`, which currently recomputes clocks independently.

The live rules endpoints live under `src/routes/v1/gameAction/`. The relevant files for this task are `move.js`, `challenge.js`, `bomb.js`, `pass.js`, `onDeck.js`, `setup.js`, `ready.js`, and `checkTimeControl.js`. The code already has a reusable clock helper in `src/utils/gameClock.js`, and a broader rules engine in `src/services/ml/engine.js` that is useful as a behavioral reference even though the live routes do not yet use it directly.

The main tests that already cover this work are `tests/checkTimeControl.util.test.js`, `tests/spectateViewModel.test.js`, `tests/moveRoute.pendingResolution.test.js`, `tests/sharedGameConstants.test.js`, `tests/serverConfig.constants.test.js`, `tests/baseBot.moveDeclarations.test.js`, and `tests/uiClassNames.test.js`. `tests/mlRuntime.test.js` exercises the heavier simulation engine and takes longer than the other suites.

## Plan of Work

First, add a shared board-annotation module under `public/js/modules/components/` that can attach to a board container after each render. It must track cell geometry, prevent the browser context menu on the board, create circles on right-click press/release without drag, create arrows on right-drag, snap arrow endpoints to the nearest legal rook-line, bishop-line, or knight destination square, and clear all stored annotations on any document-level left-click. `createBoardView()` will own this module so both the live player board and the spectate board get the same behavior. The board renderer will also mark each cell with stable UI coordinate dataset attributes so the annotation controller can resolve targets from nested piece/image clicks.

Second, refactor clock handling so the server builds a clock payload using `src/utils/gameClock.js` and includes that payload in player socket updates, finished-game payloads, initial state, and spectator snapshots. On the browser side, move the short-term ticking math into a small shared helper so the player client and spectate controller both advance from the exact same server-provided baseline. Remove optimistic local clock flips from user action handlers so the displayed turn and remaining time come from one source.

Third, clean up the live rules routes with targeted shared helpers. At minimum, remove the fake stash placeholder from setup, tighten pending-move requirements for bomb/pass responses, keep setup/on-deck validation closer to the written rules, and reuse small helper functions instead of duplicating pending-move resolution logic. Where route behavior intentionally follows the current engine behavior, note that in comments or tests so future changes have a clear reference.

Finally, update the relevant docs. The change should be described in a UI-facing document for the board interaction behavior and in this ExecPlan's progress/decision sections. If a rules cleanup changes any user-visible or developer-visible behavior, add a short note to `README.md` or a doc under `docs/` so the next contributor does not have to rediscover the same invariants.

## Concrete Steps

All commands run from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Read the shared board and clock code:

    Get-Content public/js/modules/components/boardView.js
    Get-Content public/js/modules/render/board.js
    Get-Content public/js/modules/spectate/controller.js
    Get-Content public/js/modules/utils/clockState.js
    Get-Content src/utils/gameClock.js

Run the focused tests before and after edits:

    cmd /c npm run build:shared
    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/checkTimeControl.util.test.js --runInBand
    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/spectateViewModel.test.js --runInBand
    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/moveRoute.pendingResolution.test.js --runInBand
    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/baseBot.moveDeclarations.test.js tests/serverConfig.constants.test.js tests/uiClassNames.test.js --runInBand

Run the slower suite separately after the main work if time permits:

    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand

When the UI work is complete, manually verify in a browser that:

1. Opening a live player board allows right-click circles and right-drag arrows.
2. Opening the spectate modal allows the same board drawings.
3. Left-click anywhere clears existing drawings.
4. Clocks continue from the same values on both clients after moves, bombs, challenges, and on-deck phases.

## Validation and Acceptance

Acceptance for the drawing feature is behavior-driven. A right-click press and release on a square must add a translucent purple circle centered on that square. A right-click drag must add a translucent purple arrow whose endpoint snaps to a legal rook-line, bishop-line, or knight destination relative to the drag origin and is centered exactly on the chosen square. Multiple drawings may coexist. Any left-click anywhere on the page must clear all drawings without breaking ordinary move input.

Acceptance for the clock fix is that the same game state produces the same remaining white and black clock values for both players and spectators, and only the actually active side's clock ticks. The display may keep ticking locally between socket updates, but it must start from the server-provided baseline instead of a client-only inferred state.

Acceptance for the rules cleanup is that the focused Jest suites above pass, new regression tests cover any new validation or route behavior added during this work, and no route keeps impossible placeholder pieces or stale pending-response windows alive after a move has already resolved.

## Idempotence and Recovery

The code edits are ordinary source changes and can be rerun safely. The board-annotation controller must tolerate repeated board renders because both the player and spectate boards rerender frequently. Any document-level event listeners added by the new module must be cleaned up when the board view is destroyed so reopening spectate does not stack duplicate handlers. Clock payload generation must remain additive: if an older client does not use the new `clocks` payload, the rest of the socket message should still be valid.

## Artifacts and Notes

Focused Jest results after implementation:

    PASS tests/boardAnnotations.test.js
    PASS tests/gameClockPayload.test.js
    PASS tests/responseRoutes.pendingValidation.test.js
    PASS tests/checkTimeControl.util.test.js
    PASS tests/spectateViewModel.test.js
    PASS tests/moveRoute.pendingResolution.test.js
    PASS tests/sharedGameConstants.test.js
    PASS tests/serverConfig.constants.test.js
    PASS tests/uiClassNames.test.js
    PASS tests/baseBot.moveDeclarations.test.js

Representative ML runtime coverage was also rechecked with targeted slices:

    PASS tests/mlRuntime.test.js with "bootstraps snapshots and stores replayed simulations"
    PASS tests/mlRuntime.test.js with "mcts supports on-deck action phases|builtin medium takes immediate king-throne wins when available|builtin medium stays in response actions during pending move phases"

The full `npm test` command still fails in this environment because the heavy ML runtime suite needs separate follow-up:

    FAIL tests/mlRuntime.test.js
      - "simulations support medium bot participants and alternating colors" exceeded 60000 ms
      - "medium bot self-play no longer collapses to 8-9 ply races" exceeded 20000 ms
      - "supports game counts above previous 64 cap" exceeded 20000 ms during the Jest run
      - "simulation run emits start/game/complete progress events" observed 4 `game` events instead of 2 only under the full-suite run; the same test passes in isolation

## Interfaces and Dependencies

`public/js/modules/components/boardView.js` should expose the same public API (`render`, `setReadOnly`, `getState`, `getSizes`, `destroy`) after the refactor, but internally it should also own the lifetime of a board-annotation controller.

`public/js/modules/render/board.js` should continue to render the same board visuals, but each cell needs stable dataset markers for UI row and column so higher-level interaction code can recover a cell from nested event targets.

`src/utils/gameClock.js` should remain the single server-side source of truth for clock math. If new helpers are added for serializing socket payloads, they should live next to the existing clock math rather than in `src/socket.js`.

`src/socket.js` and `src/utils/spectatorSnapshot.js` should include a `clocks` payload with at least `whiteMs`, `blackMs`, `activeColor`, `tickingWhite`, `tickingBlack`, and a human-readable `label`.

Revision note: updated the ExecPlan after implementation to record the completed annotation, clock, rules, and documentation work, plus the remaining manual browser verification step and the ML suite timeout caveat.
