# Bot Turn Failsafe Recovery

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI\PLANS.md).

## Purpose / Big Picture

After this change, a live game against a bot should not sit indefinitely when the bot is the side that must act. If the server sees that a bot-owned game state has gone unchanged for five seconds, it should reawaken the bot by making sure an internal bot client exists and by replaying the current masked game snapshot through the normal socket path. A developer should be able to prove the behavior with focused Jest coverage and by reading the local debug logs for the new watchdog events.

## Progress

- [x] (2026-04-08 23:31Z) Traced the current bot lifecycle through `src/socket.js`, `src/services/bots/internalBots.js`, `src/routes/v1/lobby/enterBot.js`, `src/services/tournaments/liveTournaments.js`, and `shared/bots/client.js`.
- [x] (2026-04-08 23:35Z) Confirmed that the safest recovery path is to reuse the existing bot socket client and `gameChanged` broadcast rather than trying to execute bot moves directly on the server.
- [x] (2026-04-08 23:45Z) Added `src/services/bots/turnFailsafe.js` with scheduling, bot-target resolution, bootstrapping, and recovery helpers.
- [x] (2026-04-08 23:49Z) Wired the failsafe into `src/socket.js`, including startup bootstrap for already-active games and shutdown cleanup.
- [x] (2026-04-08 23:53Z) Added focused Jest coverage in `tests/botTurnFailsafe.service.test.js` for scheduling, stale-game recovery, cancellation when the state progresses, and bootstrap of overdue games.
- [x] (2026-04-08 23:57Z) Updated the owning markdown docs in `src/AGENTS.md`, `src/services/AGENTS.md`, `tests/AGENTS.md`, and `docs/AGENTS.md`, then ran the targeted regression slices successfully.
- [x] (2026-04-09 00:07Z) Tightened `src/services/bots/internalBots.js` so the failsafe reuses and reconnects the shared built-in bot client instead of spawning a duplicate, and added `tests/internalBots.runtime.test.js`.

## Surprises & Discoveries

- Observation: a replayed `gameChanged` event is enough to wake a healthy bot controller because `shared/bots/baseBot.js` recalculates setup, ready, pending-move responses, on-deck actions, and ordinary moves from each incoming payload.
  Evidence: `BaseBotController.handleUpdate()` always runs `ensureSetup()`, `ensureReady()`, and then `processStateEvaluation()` from the latest snapshot.

- Observation: a bot recovery path must avoid spawning duplicate built-in difficulty clients.
  Evidence: `src/services/bots/internalBots.js` keeps difficulty-scoped clients for the built-in bots, while `ensureInternalBotClient()` creates per-user clients. The failsafe therefore needs to check whether the bot user is already socket-connected before forcing a new internal client.

- Observation: retry timing cannot be derived only from the most recent game action.
  Evidence: on a watchdog-triggered rebroadcast the underlying game state is intentionally unchanged, so rescheduling from the same last action timestamp would cause an immediate retry loop instead of a fresh five-second grace period.

- Observation: the fail-safe can stay completely outside the gameplay routes.
  Evidence: the new tests only mock `Game`, `User`, timers, and `eventBus.emit('gameChanged', ...)`; no route handlers needed to change for the recovery path to work.

- Observation: the built-in bot runtime needed one extra guard once the failsafe started reviving disconnected bots.
  Evidence: `ensureInternalBotClient()` originally short-circuited only on per-user instance clients, so a disconnected shared difficulty client could have been replaced by a duplicate client. `tests/internalBots.runtime.test.js` now proves the shared client is reused and its socket is told to reconnect.

## Decision Log

- Decision: implement the watchdog as a dedicated bot service instead of embedding the timer map directly in `src/socket.js`.
  Rationale: the behavior is logically bot-runtime work, and extracting it keeps the timer logic testable without constructing a full Socket.IO server in Jest.
  Date/Author: 2026-04-08 / Codex

- Decision: recover stalled bot states by replaying the existing `gameChanged` broadcast and only starting an internal bot client when that bot currently has no connected socket.
  Rationale: this reuses the normal mask, spectator, and bot-controller path and avoids creating a second server-side move engine.
  Date/Author: 2026-04-08 / Codex

- Decision: bootstrap the watchdog from already-active games when sockets start.
  Rationale: the user-visible failure mode includes refreshes and reconnects, so the recovery path must also work after a process restart or when no new route mutation occurs.
  Date/Author: 2026-04-08 / Codex

## Outcomes & Retrospective

The five-second bot-turn failsafe is implemented. `src/services/bots/turnFailsafe.js` now owns the watchdog logic, `src/socket.js` schedules it from live game broadcasts and bootstraps already-active games on startup, and the focused Jest coverage proves that the watchdog schedules only for actionable bot states, triggers recovery after five seconds, skips already-progressed states, and schedules overdue active games immediately after startup. `src/services/bots/internalBots.js` now also reuses and reconnects the shared built-in difficulty client when the watchdog targets that same bot user. The remaining gap is only manual browser reproduction if the user wants to watch the recovery happen live.

## Context and Orientation

The live real-time hub is `src/socket.js`. It already owns one periodic watchdog for clock timeouts and is also the place where `eventBus.emit('gameChanged', ...)` becomes `game:update` payloads for players and spectators. Bot clients are long-lived socket consumers created by `src/services/bots/internalBots.js` and implemented in `shared/bots/client.js` plus `shared/bots/baseBot.js`.

Bot action logic already lives entirely in the shared bot client. `BaseBotController` decides what to do from the incoming game snapshot: unfinished setup causes a setup POST, a missing ready state causes a ready POST, a pending move can cause challenge/pass/bomb behavior, an on-deck phase can cause an on-deck POST, and `playerTurn === color` causes a move selection. That means the server-side fail-safe does not need to know how to play Cloaks' Gambit; it only needs to identify when a bot is the side that should currently act and then re-deliver the current snapshot.

The new service belongs under `src/services/bots/` because it is part of bot runtime orchestration rather than route rules. The service should be used by `src/socket.js`, because sockets are the canonical broadcast path and already know whether a bot user currently has a live connection.

## Plan of Work

Create `src/services/bots/turnFailsafe.js` as a small scheduler. It should inspect a game snapshot, derive the player colors that can legally act right now, and then filter those colors down to players whose `User` documents have `isBot: true`. The service should track one timer per game id. When a game changes, it should clear any previous timer for that game and either schedule a new recovery attempt or decide that no bot currently needs a timer.

The scheduled recovery should reload the game from `Game`, confirm that it is still active and still in the same stalled bot-owned state, ensure that disconnected bot players have internal clients, and then emit a normal `gameChanged` event with `initiator.action = 'bot-turn-failsafe'`. `src/socket.js` should feed every `gameChanged` payload through the service and pass an explicit “retry from now” anchor when the initiator is the fail-safe itself so that repeated recovery attempts happen every five seconds instead of immediately.

Finally, add Jest coverage that proves the service schedules only when a bot can act, triggers recovery after five seconds of inactivity, skips recovery when the game has progressed, and can bootstrap already-overdue games without waiting another five seconds. Update the closest AGENTS docs so future edits know where the watchdog lives and which tests protect it.

## Concrete Steps

All commands run from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Inspect the current bot and socket flow:

    Get-Content src/socket.js
    Get-Content src/services/bots/internalBots.js
    Get-Content shared/bots/baseBot.js

Run the focused regression suites while iterating:

    cmd /c npm test -- tests/botTurnFailsafe.service.test.js tests/botClient.continuation.test.js tests/socket.timeoutSweep.test.js

If the local debug logs are useful during manual verification, inspect them with:

    rg -n "bot-turn-failsafe" "$env:TEMP\\cloaks-gambit-debug"

## Validation and Acceptance

Acceptance is behavioral. In an active bot game, if the game state stops changing for five seconds while a bot still owes setup, ready, on-deck, or turn/response work, the server must attempt recovery by re-establishing the bot runtime if necessary and rebroadcasting the current game state. The recovery must not fire again immediately in a tight loop; if the state stays unchanged, the next retry should wait another five seconds. If the game progresses before the timer expires, the stale timer must not emit a redundant recovery.

Focused test acceptance is to run `npm test -- tests/botTurnFailsafe.service.test.js tests/botClient.continuation.test.js tests/socket.timeoutSweep.test.js` and see all suites pass.

## Idempotence and Recovery

The scheduler must be safe to call repeatedly from every `gameChanged` event. Each call should replace only that game’s previous timer. If the process shuts down, all pending timers should be cleared. If the watchdog rebroadcasts a game state and the bot still does not act, another retry should happen after a fresh five-second grace period rather than immediately.

## Artifacts and Notes

The main observable artifacts after implementation should be:

    PASS tests/botTurnFailsafe.service.test.js
    PASS tests/internalBots.runtime.test.js
    PASS tests/botClient.continuation.test.js
    PASS tests/socket.timeoutSweep.test.js

Expected debug-log markers:

    bot-turn-failsafe-scheduled
    bot-turn-failsafe-triggered
    bot-turn-failsafe-cleared

## Interfaces and Dependencies

`src/services/bots/turnFailsafe.js` should export a stable `createBotTurnFailsafe()` factory plus the five-second constant so tests and `src/socket.js` share the same behavior. The factory should accept injectable `GameModel`, `UserModel`, `eventBusRef`, `ensureBotClient`, `hasConnectedUser`, clock functions, and timer functions so Jest can test it without a real socket server.

`src/socket.js` should construct one failsafe instance per socket server, call it from the `gameChanged` listener, bootstrap it for already-active games after startup, and dispose it when the HTTP server closes.

Revision note: created this ExecPlan before implementation after tracing the current bot, socket, and reconnect paths and deciding to recover stalled bots by replaying the existing game snapshot instead of inventing server-side move execution.

Revision note: updated after implementation to record the new `src/services/bots/turnFailsafe.js` service, the socket bootstrap/wiring, the documentation updates, and the passing targeted Jest command `npm test -- tests/botTurnFailsafe.service.test.js tests/botClient.continuation.test.js tests/socket.timeoutSweep.test.js`.
