# Stored Clock Authority and Local Debug Logs

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI\PLANS.md).

## Purpose / Big Picture

After this change, a live Cloaks' Gambit game should behave like a real chess clock: the side whose decision is currently pending loses time, the other side does not, and after an action is completed the turn handoff should never swap the displayed white and black totals. A local developer should also be able to reproduce a clock bug and inspect highly verbose, searchable per-game logs written to temporary files by both the server and the browser-facing client path.

## Progress

- [x] (2026-03-10 08:21Z) Traced the current clock pipeline through `src/utils/gameClock.js`, `src/socket.js`, `public/index.js`, and the live game routes.
- [x] (2026-03-10 08:29Z) Confirmed that the current clock payload is still reconstructed from the full action log on every emit, which is brittle for multi-step turn flow (`MOVE`, `BOMB`, `PASS`, `CHALLENGE`, `ON_DECK`).
- [x] (2026-03-10 08:34Z) Identified the target fix direction: store authoritative per-game clock state on the game document, update it at each turn handoff, and keep `buildClockPayload()` as a serializer over stored state with a compatibility fallback for older games.
- [x] (2026-03-10 09:02Z) Added local-only temp-file debug logging in `src/utils/localDebugLogger.js`, a non-production client log endpoint at `src/routes/v1/debug/localLog.js`, and browser-side event posting from `public/index.js`.
- [x] (2026-03-10 09:16Z) Added persisted `clockState` to `src/models/Game.js`, moved `src/utils/gameClock.js` to stored-state serialization with compatibility fallback, and updated `move`, `setup`, `bomb`, `pass`, `challenge`, `onDeck`, and `endGame` flows to commit authoritative clock transitions.
- [x] (2026-03-10 09:24Z) Added focused regression coverage in `tests/liveClockState.test.js`, `tests/moveRoute.clockState.test.js`, and `tests/localDebugLogger.test.js`.
- [x] (2026-03-10 09:28Z) Ran focused verification: `build:shared`, clock/route/spectate/shared-constant Jest slices all passed, and the temp JSONL log file is searchable with `rg`.
- [ ] Manual local browser reproduction with two live clients using the new temp logs.

## Surprises & Discoveries

- Observation: the current clock math gives increment to the actor of every non-setup action while replaying the entire action history.
  Evidence: `src/utils/gameClock.js` and `public/js/modules/utils/clockState.js` both execute `white += inc` or `black += inc` for every replayed action whose `player` is white or black, regardless of whether the action merely continues a compound response sequence.

- Observation: the live routes already define the real turn handoff semantics directly by mutating `game.playerTurn`, which is the correct place to decide which clock should tick next.
  Evidence: `src/routes/v1/gameAction/move.js`, `bomb.js`, `pass.js`, `challenge.js`, and `onDeck.js` all explicitly set `game.playerTurn` after each action or resolution branch.

- Observation: the client already accepts a server clock snapshot and only animates it locally between updates, so most of the bug surface is server authority rather than browser rendering.
  Evidence: `public/index.js` calls `normalizeClockSnapshot()` and `advanceClockSnapshot()` inside `recomputeClocksFromServer()` and `tickClock()`.

- Observation: route-level clock transitions only remain correct if the stored state is bootstrapped before each action mutates `game.playerTurn`.
  Evidence: when `ensureStoredClockState()` is called at route entry and `transitionStoredClockState()` is called after the route chooses the next `playerTurn`, the stored snapshot keeps white and black totals on the correct colors in `tests/liveClockState.test.js` and `tests/moveRoute.clockState.test.js`.

## Decision Log

- Decision: replace replay-based live clock authority with stored per-game clock state rather than trying to patch more edge cases into action replay.
  Rationale: a chess clock is stateful by nature. Persisting the remaining milliseconds and the active side at each turn handoff is less error-prone than re-deriving the totals from every historical action, especially with challenge, bomb, and on-deck subphases.
  Date/Author: 2026-03-10 / Codex

- Decision: add local debug logs as newline-delimited JSON records in the operating system temp directory, and keep them local-only.
  Rationale: the user explicitly asked for temporary files that can be tailed and searched while reproducing the bug. JSON lines are easy to append, grep with `rg`, and inspect without inventing a custom format.
  Date/Author: 2026-03-10 / Codex

## Outcomes & Retrospective

The stored clock authority path and local temp-file logging are implemented. The focused Jest coverage now exercises the new transition helper, a real accepted move route, and temp debug file creation. The main remaining gap is a manual two-client local reproduction to confirm the user-visible clock bug is gone in a real browser session.

## Context and Orientation

The live game clock currently flows through three main places. `src/utils/gameClock.js` computes remaining milliseconds from historical actions. `src/socket.js` calls `buildClockPayload()` and emits that payload in `game:update`, `game:finished`, and spectator snapshots. `public/index.js` receives that payload and animates it locally between socket updates. The live routes under `src/routes/v1/gameAction/` mutate `game.playerTurn`, `game.setupComplete`, and `game.onDeckingPlayer`, which together define whose decision is active.

The `Game` model lives in `src/models/Game.js`. This repository uses both Mongoose-backed persistence and an in-memory active-game compatibility layer in the same file, so any new game field must be added to both the schema section and the `GameDocument` in-memory document constructor/serializer path.

The new debug logging must stay local. The server entry point is `src/server.js`, the API router root is `src/routes/v1/index.js`, and browser code already imports `public/js/shared/debugLog.js`. A safe design is to write server-side logs into a folder under the operating system temp directory such as `%TEMP%\\cloaks-gambit-debug`, then expose a tiny non-production endpoint for the browser to post client-observed clock snapshots to the same log stream.

## Plan of Work

First, add a small clock authority module under `src/services/game/` that owns the stored clock state. It should be able to initialize clock state for an old or new game, advance the currently ticking side up to `now`, apply increment to the actor who just completed a decision, and then switch ticking to the next active side based on the already-mutated `game.playerTurn`, `game.setupComplete`, `game.onDeckingPlayer`, and `game.isActive`. The public interface should be simple enough for route handlers to call immediately before saving.

Second, extend `src/models/Game.js` with a persisted `clockState` object and mirror that field in the in-memory `GameDocument`. `src/utils/gameClock.js` should then prefer serializing from `game.clockState` and fall back to the old replay logic only when the field is absent, so existing unfinished games remain readable during migration.

Third, update the live routes. `setup.js` should advance the shared clock state before and after a setup completion changes `setupComplete`. `move.js`, `bomb.js`, `pass.js`, `challenge.js`, and `onDeck.js` should each update the stored clock with the exact acting side and resulting `playerTurn` after their route logic has determined who acts next. `checkTimeControl.js` should use the stored snapshot path so timeout enforcement matches the live display exactly.

Fourth, add local debug logging. The server now writes verbose JSON lines for route entry, post-transition clock state, emitted socket payloads, and timeout checks. The browser posts client-side clock observations after socket state adoption, clock-base sync, action submission, and final game receipt so a reproduction can be correlated server-to-client by `gameId`, event name, and timestamp.

Finally, add regression tests and update docs with exact temp log locations and example `rg` commands so the next reproduction is fast.

## Concrete Steps

All commands run from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Inspect the current clock and route flow:

    Get-Content src/utils/gameClock.js
    Get-Content src/routes/v1/gameAction/move.js
    Get-Content src/routes/v1/gameAction/challenge.js
    Get-Content public/index.js

Run focused tests while iterating:

    cmd /c npm run build:shared
    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/gameClockPayload.test.js tests/checkTimeControl.util.test.js tests/responseRoutes.pendingValidation.test.js tests/moveRoute.pendingResolution.test.js --runInBand

After the logging path exists, a local reproduction should leave temporary files under the operating system temp folder. Example search commands:

    rg -n "clock-transition|socket-payload|client-clock" "$env:TEMP\\cloaks-gambit-debug"
    Get-Content "$env:TEMP\\cloaks-gambit-debug\\clock-events.jsonl" -Tail 80

## Validation and Acceptance

Acceptance for the bug fix is behavioral. In a live game, when white moves, only white's remaining time should stop decreasing and only black's time should begin decreasing; the displayed white and black totals must not swap or jump onto the wrong panel. The same invariant must hold across `MOVE`, `BOMB`, `PASS`, `CHALLENGE`, and `ON_DECK` transitions, and the player view and spectator view must show the same white and black totals for the same game state.

Acceptance for the logging path is operational. When local debug logging is enabled and a game action occurs, a temp log file must receive new searchable JSON lines that include the `gameId`, event name, acting color, before/after clock totals, active side, and the route or socket source of the record. A developer should be able to run `rg` against the temp directory and isolate all clock events for one game.

## Idempotence and Recovery

The stored clock state must be additive. If a game document does not yet have `clockState`, the serializer and timeout checker must synthesize one from the existing historical data so unfinished games do not break. The temp logger must create its directory on demand and append records safely; deleting the temp directory should only remove debug artifacts, not affect gameplay.

## Artifacts and Notes

Current focused evidence before the fix:

    `public/index.js` already prefers `u.clocks` from the socket payload.
    `src/socket.js` already emits one server-authored clock payload to both players.
    `src/utils/gameClock.js` still reconstructs those totals from the entire action history.

Focused evidence after the fix:

    PASS tests/gameClockPayload.test.js
    PASS tests/checkTimeControl.util.test.js
    PASS tests/responseRoutes.pendingValidation.test.js
    PASS tests/moveRoute.pendingResolution.test.js
    PASS tests/liveClockState.test.js
    PASS tests/localDebugLogger.test.js
    PASS tests/moveRoute.clockState.test.js
    PASS tests/spectateViewModel.test.js
    PASS tests/sharedGameConstants.test.js

The temp log file produced a searchable JSONL record during the logger test:

    rg -n "clock-transition|game-debug-1" "$env:TEMP\cloaks-gambit-debug\clock-events.jsonl"
    1:{"ts":"...","pid":...,"event":"clock-transition","payload":{"gameId":"game-debug-1","marker":"clock-marker-123"}}

## Interfaces and Dependencies

`src/services/game/liveClock.js` should export stable helpers for initializing, advancing, transitioning, and serializing stored clock state. The helpers must accept plain `game` objects so they work with both Mongoose documents and the in-memory compatibility model.

`src/models/Game.js` must gain a `clockState` field that survives both normal Mongoose persistence and the in-memory active game path.

`src/utils/gameClock.js` must keep `buildClockPayload()` as the single server-side serializer used by sockets and spectator snapshots.

Revision note: created this ExecPlan after tracing the remaining clock bug and deciding to replace replay-based live clock authority with stored per-game state plus local temp-file debug logging.

Revision note: updated after implementation to record the stored clock-state rollout, the new client/server temp logging path, the passing focused verification, and the remaining manual browser reproduction step.
