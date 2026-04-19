# Clock Sync Across All Match Modes

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/PLANS.md).

## Purpose / Big Picture

After this change, every match-creation path in Cloaks' Gambit should agree on the same time control and increment for its mode, and every player or spectator clock should reflect that server-authored choice consistently. A human should be able to start an AI match, quickplay match, ranked match, custom match, or tournament game and see the correct clock label and ticking behavior without one mode silently drifting to a different base time or increment.

## Progress

- [x] (2026-04-04 19:05Z) Traced the live clock authority path through `src/utils/gameClock.js`, the game-action routes, `src/socket.js`, `public/index.js`, and spectator rendering to confirm the stored `clockState` handoff logic was already intact.
- [x] (2026-04-04 19:14Z) Audited every game-creation path in `src/routes/v1/lobby/enterBot.js`, `src/routes/v1/lobby/matchmaking.js`, `src/socket.js`, and `src/services/tournaments/liveTournaments.js` and identified duplicated mode-to-time-control parsing.
- [x] (2026-04-04 19:18Z) Identified the concrete drift risks: the browser did not classify `AI` matches as quickplay for expected clocks, server creation paths normalized time settings independently, and `src/models/Game.js` only validated ranked or quickplay base times.
- [x] (2026-04-04 19:30Z) Added `src/utils/gameModeClock.js` as the single server-side source of truth for per-mode clock settings, normalized milliseconds, public time settings, and allowed base clocks.
- [x] (2026-04-04 19:33Z) Rewired bot, quickplay, ranked, custom, tournament, config-route, and game-model validation paths to use the shared clock-settings helper.
- [x] (2026-04-04 19:35Z) Updated the browser match-type clock expectation path so `AI` matches inherit quickplay clock expectations like the server.
- [x] (2026-04-04 19:42Z) Added focused regressions in `tests/gameModeClock.test.js`, `tests/matchmaking.clockSettings.test.js`, and `tests/enterBot.route.test.js`.
- [x] (2026-04-04 19:46Z) Ran full verification with `npm test`; all 42 suites and 119 tests passed.

## Surprises & Discoveries

- Observation: the stored clock transition code for setup, ready, move, bomb, challenge, pass, on-deck, socket payloads, and timeout sweeps was already consistent.
  Evidence: existing suites `tests/liveClockState.test.js`, `tests/moveRoute.clockState.test.js`, `tests/readyRoute.clockState.test.js`, `tests/socket.timeoutSweep.test.js`, and `tests/gameClockPayload.test.js` all passed before the new mode audit changes.

- Observation: the real drift risk was not the per-move clock transition logic but the duplicated mode-specific time-setting lookup spread across the codebase.
  Evidence: `src/routes/v1/lobby/enterBot.js`, `src/routes/v1/lobby/matchmaking.js`, `src/socket.js`, `src/services/tournaments/liveTournaments.js`, and `src/routes/v1/config/getTimeSettings.js` each parsed game-mode settings independently before this change.

- Observation: the player client treated `AI` as an unknown type for expected time-control display even though the server creates AI games with quickplay clocks.
  Evidence: `public/index.js` handled `QUICKPLAY`, `RANKED`, `CUSTOM`, and tournament match types in `applyExpectedTimeSettingsForMatch()` but excluded `AI`.

- Observation: `src/models/Game.js` still validated `timeControlStart` against only ranked or quickplay values, which left custom-mode clock validation structurally behind the rest of the codebase.
  Evidence: the pre-change validator compared only `RANKED.TIME_CONTROL` and `QUICKPLAY.TIME_CONTROL`.

## Decision Log

- Decision: centralize match-type-to-clock resolution in a dedicated server utility instead of patching each creation path separately.
  Rationale: the user asked for a deep dive across all game modes, and a shared utility is the only defensible way to prevent future drift between AI, quickplay, ranked, custom, and tournament clocks.
  Date/Author: 2026-04-04 / Codex

- Decision: treat `AI` as a quickplay clock mode everywhere.
  Rationale: bot matches are normal non-ranked games in this repository, and the existing bot-entry route already selected quickplay settings on the server.
  Date/Author: 2026-04-04 / Codex

- Decision: keep tournament games on ranked clocks and custom games on custom clocks with a quickplay fallback.
  Rationale: tournament service tests already assert ranked clocks for tournament games, while the socket custom-match flow already intended to prefer custom settings and fall back to quickplay when missing.
  Date/Author: 2026-04-04 / Codex

- Decision: extend `Game.timeControlStart` validation to all configured base times instead of only ranked or quickplay.
  Rationale: validation should reflect the actual supported creation paths, especially now that custom-mode clock settings are part of the same shared mapping.
  Date/Author: 2026-04-04 / Codex

## Outcomes & Retrospective

This work did not replace the existing stored clock authority implementation because that logic already held. The real fix was eliminating mode-setting drift: AI now resolves as quickplay on both server and client, all creation paths use the same normalized clock-setting helper, custom-mode base times are accepted by game validation, and the new tests lock those expectations down. The outcome matches the original purpose: mode-specific clocks are now defined once and consumed consistently.

## Context and Orientation

Live clock authority in this repository is stateful. `src/utils/gameClock.js` owns the per-game ticking snapshot and sockets serialize that state into the `clocks` payload. The files touched by this audit sit one layer above that: they decide which `timeControlStart` and `increment` a newly created game should receive. Those files are `src/routes/v1/lobby/enterBot.js` for AI matches, `src/routes/v1/lobby/matchmaking.js` for quickplay and ranked queue matches, `src/socket.js` for custom head-to-head matches, and `src/services/tournaments/liveTournaments.js` for round-robin and elimination tournament games. The browser uses `public/index.js` to choose an expected label and fallback display before or between full server snapshots.

The term “time control” here means the starting milliseconds each side receives for a game. The term “increment” means the extra milliseconds added after a player completes a decision. A “mode drift” bug means one code path chooses different clock settings for the same logical match type than another code path would choose.

## Plan of Work

First, add one shared helper in `src/utils/gameModeClock.js` that accepts the normalized server config and a match type, then returns the correct base time and increment for that mode in milliseconds. The helper must also expose normalized public time settings for `/api/v1/config/getTimeSettings` and a set of allowed base times for the `Game` model validator.

Second, replace the duplicated time-setting parsing in `src/routes/v1/lobby/enterBot.js`, `src/routes/v1/lobby/matchmaking.js`, `src/socket.js`, and `src/services/tournaments/liveTournaments.js` so those paths all call the new helper instead of manually reading `config.gameModeSettings`.

Third, update `public/index.js` so the player client classifies `AI` matches the same way the server does when it chooses expected clock settings for display.

Fourth, update `src/models/Game.js` validation to accept all configured base times instead of only ranked and quickplay values.

Finally, add targeted Jest coverage for the new helper and for the live routes that create AI, quickplay, and ranked games, then run the full test suite.

## Concrete Steps

All commands run from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Inspect the mode-setting entry points:

    Get-Content src\routes\v1\lobby\enterBot.js
    Get-Content src\routes\v1\lobby\matchmaking.js
    Get-Content src\socket.js
    Get-Content src\services\tournaments\liveTournaments.js
    Get-Content public\index.js
    Get-Content src\models\Game.js

Run the focused mode and clock suites while iterating:

    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/gameModeClock.test.js tests/matchmaking.clockSettings.test.js tests/enterBot.route.test.js tests/liveClockState.test.js tests/moveRoute.clockState.test.js tests/readyRoute.clockState.test.js tests/gameClockPayload.test.js tests/socket.timeoutSweep.test.js tests/tournament.service.test.js --runInBand

Run full verification after the mode audit:

    cmd /c npm test

## Validation and Acceptance

Acceptance is behavioral and testable.

An AI match must be created with the quickplay base clock and increment. A queued quickplay match must use quickplay settings. A queued ranked match and any tournament game must use ranked settings. A custom match must prefer custom settings and fall back to quickplay when custom settings are absent. The player client must recognize `AI` as a quickplay-clock mode for expected display behavior. `Game.timeControlStart` validation must accept every configured base time that a supported creation path can generate.

Automated acceptance is:

- `tests/gameModeClock.test.js` passes.
- `tests/matchmaking.clockSettings.test.js` passes.
- `tests/enterBot.route.test.js` passes with the new success-path assertions.
- The existing clock-authority suites continue to pass unchanged.
- `npm test` passes for the full repository.

## Idempotence and Recovery

These changes are additive and safe to rerun. The new helper only normalizes config reads; it does not migrate stored game state or rewrite history. The validator broadens accepted clock bases to match existing supported creation paths, which reduces risk instead of narrowing behavior. If a future mode is added, the safe extension path is to update `src/utils/gameModeClock.js` first and then add a route or service test for that mode.

## Artifacts and Notes

Focused passing verification after implementation:

    PASS tests/gameModeClock.test.js
    PASS tests/matchmaking.clockSettings.test.js
    PASS tests/enterBot.route.test.js
    PASS tests/liveClockState.test.js
    PASS tests/moveRoute.clockState.test.js
    PASS tests/readyRoute.clockState.test.js
    PASS tests/gameClockPayload.test.js
    PASS tests/socket.timeoutSweep.test.js
    PASS tests/tournament.service.test.js

Full verification after implementation:

    PASS 42 test suites
    PASS 119 tests
    Ran all test suites.

## Interfaces and Dependencies

The new stable interface is `src/utils/gameModeClock.js`, which exports:

- `getClockSettingsForMatchType(config, matchType)` to resolve the normalized base time and increment for a match type.
- `getPublicTimeSettings(config)` to build the browser-facing time-settings payload.
- `getAllowedTimeControls(config)` to support `Game.timeControlStart` validation.

The implementation continues to rely on the existing normalized server config returned by `src/utils/getServerConfig.js` and the shared constants bundle under `shared/constants`.

Revision note: created this ExecPlan after the cross-mode clock audit to record the root cause, the shared time-setting utility, the touched entry points, and the passing verification evidence.
