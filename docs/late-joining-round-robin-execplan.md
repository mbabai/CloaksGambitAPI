# Add Late Joining Round Robin

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the repository requirements in `PLANS.md`.

## Purpose / Big Picture

Tournament hosts need an optional setting that keeps round-robin tournaments open after the start signal. When the setting is on, a new player can join during the timed round-robin phase and enter the same rolling pairing pool as existing players. If a new player joins during the break after round robin has closed but before elimination starts, they should not receive round-robin games; instead, they should enter the normal seed calculation with zero round-robin results.

The behavior is visible through the tournament create/settings UI, the tournament browser join button, and service tests that prove both live round-robin joining and normal break-time seeding.

## Progress

- [x] (2026-05-25 00:00Z) Read repository tournament docs, model, service, route, client UI, and focused tournament tests.
- [x] (2026-05-25 00:00Z) Identified that rolling round-robin pairing already supports newly available active players once they are added to `tournament.players`.
- [x] (2026-05-25 00:00Z) Add the `lateJoinRoundRobin` tournament config field across model normalization, persistence, client normalization, summaries, and docs.
- [x] (2026-05-25 00:00Z) Change player join rules so active round-robin and break joins are allowed only when `lateJoinRoundRobin` is enabled.
- [x] (2026-05-25 00:00Z) Add seed calculation that keeps break-time late entrants in the normal standings order with zero round-robin results.
- [x] (2026-05-25 00:00Z) Update browser and host controls so users can choose and see the setting.
- [x] (2026-05-25 00:00Z) Add focused Jest coverage and run the relevant tournament suites.

## Surprises & Discoveries

- Observation: `joinTournamentAsViewer` already allows active-tournament viewing, while `joinTournamentAsPlayer` hard-requires the `starting` state.
  Evidence: `src/services/tournaments/liveTournaments.js` uses `requireStartingState(tournament, 'Join')` in `joinTournamentAsPlayer`, but viewer joining has no equivalent phase guard.
- Observation: The current standings tiebreaker favors fewer games played before ELO and join time, so a break-time entrant with zero games can rank above existing zero-point players who played games.
  Evidence: `src/services/tournaments/standings.js` sorts by points descending, then total games ascending, then pre-tournament ELO descending.
- Observation: A tournament can remain in internal `round_robin` phase after the timer closes while active games finish.
  Evidence: `maybeAdvanceTournamentRoundRobin()` only changes to `round_robin_complete` after `pairingWindowClosed` is true and `activeGames === 0`.

## Decision Log

- Decision: Name the setting `lateJoinRoundRobin` in tournament config.
  Rationale: The name describes the feature scope without implying joins are allowed once elimination starts.
  Date/Author: 2026-05-25 / Codex
- Decision: Allow late player joins only in `active + round_robin` and `active + round_robin_complete`, never in elimination or completed/cancelled tournaments.
  Rationale: The user requested round-robin and break joins. Elimination brackets are already generated from seeds and should not be mutated mid-bracket.
  Date/Author: 2026-05-25 / Codex
- Decision: Mark break-time entrants with `lateJoinPhase: 'break'` to prevent new pairings, but include them in the same standings comparator as every other entrant for elimination seeding.
  Rationale: The corrected product rule is that late entrants have zero round-robin results, not an automatic bottom seed.
  Date/Author: 2026-05-25 / Codex
- Decision: Treat joins after the round-robin deadline but before all in-flight games finish as break-style late joins.
  Rationale: The pairing pool is already closed at that point, so these entrants should not receive new round-robin games; their later elimination seed still comes from the normal standings comparator.
  Date/Author: 2026-05-25 / Codex

## Outcomes & Retrospective

Implemented. Hosts can enable `lateJoinRoundRobin`, active round-robin joins are accepted only when the setting is enabled, and break-time late joiners are included in normal seeding with zero round-robin results. Focused late-join service tests and the tournament route suite pass.

## Context and Orientation

Tournament state is owned by `src/services/tournaments/liveTournaments.js`. The service keeps active tournaments in the process-local `TOURNAMENTS` map and persists started/completed tournament snapshots through `src/models/Tournament.js` when MongoDB is available. The Express REST routes in `src/routes/v1/tournaments/index.js` call service functions for create, config, join, start, and details. Browser tournament UI lives in `public/js/modules/tournaments/ui.js`; API wrappers for those UI calls live in `public/js/modules/api/game.js`.

Round robin is rolling, not fixed. `buildRollingRoundRobinPairings()` reads active players from `tournament.players`, excludes users already in active round-robin games, and creates new pairings while the round-robin timer remains open. `maybeAdvanceTournamentRoundRobin()` is the lifecycle pass that either creates new pairings or moves the tournament into `round_robin_complete` once the timer closes and all round-robin games are completed.

Elimination seeding currently happens in `startEliminationInternal()`, where standings are built from `tournament.players` and finished round-robin games. The new break-time joining behavior must keep players who joined after the round-robin phase completed in `tournament.players` so the existing standings rules can seed them with zero round-robin results.

## Plan of Work

First add `lateJoinRoundRobin` to the config shape everywhere tournament config is normalized or persisted. This includes `src/models/Tournament.js`, `toTournamentModelPayload()`, `fromTournamentDocument()`, service `normalizeTournamentConfig()`, client `normalizeTournamentConfig()`, and the tournament setting summary.

Next update `joinTournamentAsPlayer()` so the starting-state guard becomes a joinability check. Existing pre-start behavior remains unchanged. If the tournament is active in `round_robin` and the setting is on, the service creates the normal human player entry with `lateJoinPhase: 'round_robin'`, persists it, emits an update, and calls `maybeAdvanceTournamentRoundRobin()` so any available pairing can start immediately. If the tournament is active in `round_robin_complete` and the setting is on, the service creates the entry with `lateJoinPhase: 'break'`, persists it, emits an update, and leaves round-robin games untouched.

Then add a helper that builds a seed map for elimination and participant display from the normal round-robin standings order. `startEliminationInternal()` should use this helper before building the bracket, and `buildParticipantView()` should use it during the break so the roster previews the same seed order elimination will use.

Finally update the UI. The create modal gets a checkbox for late joining. The host setup panel gets the same setting while the tournament is still starting. The browser join button should allow active joins when the selected tournament advertises `lateJoinRoundRobin` and is in `round_robin` or `round_robin_complete`. Documentation in `docs/tournaments.md` should describe the setting and seed rule.

## Concrete Steps

Work from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Run focused tests while iterating:

    npm test -- tests/tournament.service.test.js tests/tournament.route.test.js

After implementation, run the broader affected tests if time allows:

    npm test -- tests/tournament.service.test.js tests/tournament.route.test.js tests/tournament.standings.test.js tests/tournamentMobileUiGuards.test.js

Because PowerShell blocks `npm.ps1` on this machine, use `npm.cmd` in this workspace:

    npm.cmd test -- tests/tournament.service.test.js tests/tournament.route.test.js tests/tournament.standings.test.js tests/tournamentMobileUiGuards.test.js

## Validation and Acceptance

Acceptance requires all of these behaviors:

When a host creates a tournament with `config.lateJoinRoundRobin: true`, the returned tournament config includes `lateJoinRoundRobin: true`.

When a player attempts to join an already active round-robin tournament with the setting off, the service rejects the join with a message explaining that joining is not available after start.

When a player joins an active round-robin tournament with the setting on, the player appears in `tournament.players`, appears in client participants, and the existing rolling pairing pass can include them in new round-robin games before the timer closes.

When a player joins during `round_robin_complete` with the setting on, they appear in participants and their seed follows the normal standings rules with zero round-robin results. A high-ELO late entrant can rank above zero-point entrants who have worse normal seeding tiebreaks.

When elimination starts after break-time late joins, the bracket uses those same normal standings seeds.

Initial validation completed with:

    npm.cmd test -- tests/tournament.service.test.js tests/tournament.route.test.js
    PASS tests/tournament.route.test.js
    PASS tests/tournament.service.test.js
    Test Suites: 2 passed, 2 total
    Tests: 54 passed, 54 total

    npm.cmd test -- tests/tournament.service.test.js tests/tournament.route.test.js tests/tournament.standings.test.js tests/tournamentMobileUiGuards.test.js
    PASS tests/tournament.standings.test.js
    PASS tests/tournamentMobileUiGuards.test.js
    PASS tests/tournament.service.test.js
    PASS tests/tournament.route.test.js
    Test Suites: 4 passed, 4 total
    Tests: 64 passed, 64 total

After correcting break-time seeding to follow normal standings rules, focused validation completed with:

    npm.cmd test -- tests/tournament.service.test.js tests/tournament.route.test.js --runInBand -t late
    PASS tests/tournament.service.test.js
    Test Suites: 1 skipped, 1 passed, 1 of 2 total
    Tests: 52 skipped, 5 passed, 57 total

    npm.cmd test -- tests/tournament.route.test.js --runInBand
    PASS tests/tournament.route.test.js
    Test Suites: 1 passed, 1 total
    Tests: 10 passed, 10 total

The broader rerun currently also exercises unrelated dirty tournament changes in this worktree and fails on existing expectations for expanded config fields and tournament accept-window duration. Those failures are outside the late-join seeding correction.

## Idempotence and Recovery

The changes are additive and can be re-run safely. If a test leaves active tournament state behind, `resetForTests()` clears the process-local tournament map and timers in the next test `beforeEach`. No destructive database migration is required because MongoDB defaults the new config field to `false`.

## Artifacts and Notes

Focused validation passed. The only command issue was PowerShell's local script execution policy rejecting `npm`; `npm.cmd` worked.

## Interfaces and Dependencies

The tournament config object must include:

    lateJoinRoundRobin: Boolean

The player entry may include:

    lateJoinPhase: 'round_robin' | 'break' | null

The service-level seed helper should return a `Map` keyed by user id:

    buildTournamentSeedMap(tournament, games) -> Map<string, number>

The map ranks all participants, including break-time late entrants, using existing round-robin standings. Break-time late entrants simply have no completed round-robin games contributing to their score.

Revision note: Updated after implementation to record completed work, validation commands, and the `npm.cmd` PowerShell workaround discovered during testing. Revised again after the product correction that break-time entrants should follow normal standings seeding with zero round-robin results rather than automatic bottom seeding.
