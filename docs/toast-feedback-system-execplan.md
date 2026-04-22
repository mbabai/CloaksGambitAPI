# Add Non-Blocking Game Toast Feedback

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`PLANS.md` is checked into the repository root and this document must be maintained in accordance with `PLANS.md`.

## Purpose / Big Picture

After this change, the live board shows short, non-blocking toast notifications in the upper-left corner of the game area and timed pulse highlights on dagger tokens and newly captured pieces. The toasts never intercept clicks, so the player can keep interacting with the board and controls while they are visible. Turn changes show `Your turn!` or `Opponent's turn`, spectate turn changes show `White's turn` or `Black's turn`, invalid destinations show `Illegal move!`, opponent bomb declarations show `Bomb!`, and challenge resolutions show `Challenge Successful!` or `Challenge Failed`.

The user-visible proof is simple: play through a move, bomb, challenge, dagger gain, and capture sequence and watch the feedback appear in the game area without changing any gameplay rules or blocking input.

## Progress

- [x] (2026-04-22 11:27-07:00) Read `PLANS.md`, `public/AGENTS.md`, `docs/AGENTS.md`, `tests/AGENTS.md`, the player client in `public/index.js`, the shared board and bar renderers, and the spectate controller to map where live state updates and HUD rendering already meet.
- [x] (2026-04-22 11:31-07:00) Drafted this ExecPlan with the chosen shared-module approach before implementation.
- [x] (2026-04-22 11:40-07:00) Added `public/js/modules/ui/toasts.js` and `public/js/modules/ui/gameToastEvents.js` for the shared runtime and the pure snapshot-diff rules.
- [x] (2026-04-22 11:48-07:00) Wired `public/index.js`, `public/js/modules/render/bars.js`, `public/js/modules/spectate/controller.js`, `public/ui.css`, and `public/AGENTS.md` to the new toast and pulse system.
- [x] (2026-04-22 11:51-07:00) Added focused Jest coverage in `tests/gameToastEvents.test.js` and ran `npm.cmd test -- tests/gameToastEvents.test.js`.

## Surprises & Discoveries

- Observation: The working tree already contains unrelated in-progress UI and gameplay edits, including modifications to `public/index.js`, `public/ui.css`, and several server route files.
  Evidence: `git status --short` showed existing modified and untracked files before this feature work started.

- Observation: Direct Node module-loading is not a reliable validation path for every browser-facing shared UI module in this repo because some import chains still use browser-root absolute paths such as `/js/shared/assetManifest.js`.
  Evidence: A post-test `node --input-type=module` import check for `public/js/modules/spectate/controller.js` failed with `ERR_MODULE_NOT_FOUND` for `file:///C:/js/shared/assetManifest.js`.

## Decision Log

- Decision: Build the feature as two shared modules instead of embedding more event-specific state into `public/index.js`.
  Rationale: The player client and spectate controller both already render through the shared `gameView` and `renderBars()` path, so a pure snapshot-diff helper plus a small toast/pulse runtime keeps the new feedback behavior consistent across both surfaces and gives Jest something deterministic to test.
  Date/Author: 2026-04-22 / Codex

- Decision: Keep the textual notifications sequential and non-interactive.
  Rationale: The user explicitly wants the toasts not to impact gameplay and wants bomb/challenge notices to delay the turn-switch toast. A single queue with `pointer-events: none` satisfies both requirements without introducing modal behavior.
  Date/Author: 2026-04-22 / Codex

- Decision: Limit spectator text to the requested color-based turn labels while still allowing shared dagger/captured pulses through the common HUD renderer.
  Rationale: The request explicitly defines spectator wording only for turn switches, but the dagger/captured pulse effects are visual HUD feedback rather than player-opponent messaging and fit naturally in both live and spectate views.
  Date/Author: 2026-04-22 / Codex

## Outcomes & Retrospective

The feature is implemented. Live play now mounts a non-blocking toast host in the upper-left of the game area, queues bomb/challenge/turn notifications in order, emits the one-second red illegal-move toast for actual invalid destinations, and drives dagger/captured pulses through the shared bar renderer. Spectate reuses the same runtime and diff helper, but only emits the requested `White's turn` and `Black's turn` text while still showing the shared pulse effects.

The focused Jest coverage passed, which proves the shared diff helper produces the intended bomb, challenge, turn-switch, dagger, captured-piece, and new-game-reset signals. I did not complete a browser-level manual verification pass in this session, so the remaining validation gap is visual tuning and interaction confirmation in a real live match.

## Context and Orientation

`public/index.js` is still the main live-player controller. It owns the mutable board state, receives `initialState` and `game:update` socket payloads, and calls `renderBoardAndBars()` after each accepted server snapshot. `renderBoardAndBars()` composes the shared board surface from `public/js/modules/gameView/view.js`, the HUD bars from `public/js/modules/render/bars.js`, and the stash/buttons overlay inside the same play-area root.

`public/js/modules/spectate/controller.js` is the spectator equivalent. It receives spectator snapshots from the socket layer, derives a displayable board snapshot, and renders the same shared `gameView` plus the same bar renderer in read-only mode.

`public/js/modules/render/bars.js` already owns the dagger-token row and the captured-piece row for both player and spectator views. That makes it the correct place to add pulse classes for newly earned daggers and newly added captured pieces.

`public/ui.css` already contains the shared HUD, board bubble, and token styling. It is the correct place to define toast layout plus the pulse animation classes.

`tests/spectateViewModel.test.js` demonstrates the current pattern for testing ESM browser modules from Jest in this repository: a Node `--input-type=module` subprocess imports the browser module and prints JSON back to the test.

## Plan of Work

First, add a new UI runtime module that mounts a toast host into a game-area container, queues toasts sequentially, and tracks timed pulse state for dagger groups and captured pieces. The runtime must expose enough state for the render path to ask which dagger colors and captured-piece indexes are currently pulsing.

Second, add a pure helper module that turns two consecutive game snapshots into a list of textual toasts and pulse triggers. The helper should ignore the first snapshot of a game, ignore game-id changes, detect new bomb and challenge actions from the appended `actions` list, detect turn switches from `playerTurn`, detect dagger gains from `daggers`, and detect newly appended captured pieces from the grouped captured arrays.

Third, wire the player client in `public/index.js`. The player update path should create and reuse the shared toast runtime, feed each accepted server snapshot through the diff helper, queue the resulting feedback, and pass the active pulse state into `renderBars()`. The local move-attempt path should also enqueue the one-second red `Illegal move!` toast when the player actually targets an illegal destination square.

Fourth, wire the spectate controller to the same modules. Spectate should use the shared runtime mounted in `#spectatePlayArea`, feed spectator snapshots through the same diff helper in spectator mode, and pass active pulse state into the shared bar renderer. Spectator text feedback should only use the color-based turn labels requested by the user.

Fifth, add focused Jest coverage for the pure diff helper so the bomb, challenge, turn-switch, dagger, and captured-piece signals are locked down without requiring DOM-heavy end-to-end browser tests.

Finally, update the relevant docs so the next contributor can find the new feedback ownership quickly.

## Concrete Steps

From `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`:

1. Keep this ExecPlan updated as implementation progresses.
2. Add `public/js/modules/ui/toasts.js` for the toast queue and pulse tracker.
3. Add `public/js/modules/ui/gameToastEvents.js` for pure snapshot-diff event derivation.
4. Edit `public/index.js`, `public/js/modules/render/bars.js`, `public/js/modules/spectate/controller.js`, and `public/ui.css` to use the new system.
5. Add `tests/gameToastEvents.test.js`.
6. Run:

      npm.cmd test -- tests/gameToastEvents.test.js

If the focused test passes cleanly, optionally run `npm.cmd test` for broader confidence.

## Validation and Acceptance

Acceptance is behavioral:

1. Start the app locally with `npm run dev`.
2. Enter a live game and confirm the toast host appears in the upper-left of the game area, not elsewhere on the page.
3. Wait for the turn to pass between players and confirm a white turn toast appears for two seconds.
4. Attempt an illegal destination square and confirm a red `Illegal move!` toast appears for one second without blocking further input.
5. Have the opponent bomb and confirm the gold `Bomb!` toast appears before the next turn-switch toast.
6. Resolve a challenge and confirm the challenge-result toast appears before any turn-switch toast from that same resolution.
7. Gain a dagger token and confirm the owner’s dagger icons pulse for about 1.5 seconds.
8. Resolve any capture and confirm only the newly added captured piece pulses for about 1.5 seconds.
9. Open spectate mode and confirm turn switches use `White's turn` and `Black's turn`.
10. Run `npm.cmd test -- tests/gameToastEvents.test.js` and expect the new assertions to pass.

## Idempotence and Recovery

The planned edits are additive and safe to repeat. Re-running the focused Jest file is harmless. If a partial patch leaves the feedback UI broken, revert only the toast-system changes in the new UI modules, the touched client renderers, and the new test file, then reapply the steps in order. Do not revert unrelated dirty files already present in the worktree.

## Artifacts and Notes

Pre-change working-tree evidence:

    git status --short
      M public/index.js
      M public/js/modules/board/scene.js
      M public/js/modules/components/boardView.js
      M public/js/modules/render/bars.js
      M public/js/modules/render/stash.js
      M public/js/modules/spectate/controller.js
      M public/js/modules/state/moves.js
      M public/js/modules/ui/banners.js
      M public/ui.css
      M rules.md
      M src/routes/v1/gameAction/AGENTS.md
      M src/routes/v1/gameAction/onDeck.js
      M src/routes/v1/gameAction/setup.js
     ?? docs/valid-move-highlighter-execplan.md
     ?? public/js/modules/interactions/legalSourceHighlights.js
     ?? tests/legalSourceHighlights.test.js
     ?? tests/setupOnDeck.kingRestriction.test.js

This matters because the toast work must layer on top of existing uncommitted refactors rather than resetting the tree.

## Interfaces and Dependencies

`public/js/modules/ui/toasts.js` should expose a stable runtime factory that the player client and spectator controller can both reuse:

    createToastSystem({
      container,
      onPulseChange,
    }) => {
      attach(container),
      enqueue(toast),
      enqueueAll(toasts),
      triggerPulse(channel, key, { durationMs }),
      triggerPulses(items),
      getPulseState(),
      clear(),
      destroy(),
    }

`public/js/modules/ui/gameToastEvents.js` should expose pure helpers that accept plain objects and return plain objects:

    createGameToastSnapshot(gameLike) => {
      gameId,
      playerTurn,
      actions,
      daggers,
      capturedByColor,
    }

    deriveGameToastFeedback({
      previous,
      current,
      viewerColor,
      viewMode,
    }) => {
      toasts: Array<{ text, tone, durationMs }>,
      pulses: {
        daggerColors: Array<{ color, durationMs }>,
        captured: Array<{ color, index, durationMs }>,
      },
    }

`public/js/modules/render/bars.js` should remain the only shared place that knows how to visually pulse dagger groups and captured pieces for both player and spectator surfaces.

Revision note: created this ExecPlan before implementation after tracing the current player and spectate board flows and deciding to keep the new feedback behavior in shared UI modules instead of embedding another round of special cases in `public/index.js`.

Revision note: updated this ExecPlan after implementation to record the completed shared-module, player/spectate wiring, and focused Jest validation, plus the browser-absolute-import limitation discovered during a Node module-load smoke check.
