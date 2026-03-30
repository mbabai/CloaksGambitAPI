# Tournament Mode

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/PLANS.md).

## Purpose / Big Picture

After this change, a user can open the main menu, create or join a tournament, play through a timed round-robin phase, advance into a seeded single- or double-elimination bracket, accept live elimination match prompts, spectate tournament games when idle, open a live bracket view, and finish by seeing first, second, and third place in a final modal. Tournament state, standings, bracket progression, matches, and games are saved as first-class history.

## Progress

- [x] (2026-03-25 20:03Z) Read `PLANS.md`, the repository `AGENTS.md`, and the relevant docs for routes, models, services, utils, client overlays, and tests.
- [x] (2026-03-25 20:03Z) Mapped the current live architecture in `public/index.js`, `public/index.html`, `src/socket.js`, `src/state/lobby.js`, `src/models/Game.js`, `src/models/Match.js`, `src/services/matches/activeMatches.js`, and `src/services/history/summary.js`.
- [x] (2026-03-25 20:03Z) Researched standard seeded brackets and double-elimination structure, then captured the product rules in `docs/tournaments.md`.
- [x] (2026-03-25 20:03Z) Drafted this initial ExecPlan before implementation.
- [x] (2026-03-25 21:34Z) Confirmed product decisions with the user: login is required for creation, the owner role is `host`, host participation is a starting-mode toggle instead of auto-join, minimum start count is `4`, all players advance to elimination with BYEs as needed, accept timeout is a loss of the current matchup, double elimination uses a true reset final, elimination ELO is applied once per match/series, and active tournaments must persist in MongoDB for recovery even if active matches are disposable.
- [x] (2026-03-26 00:00Z) Added doc requirement that hosts can add bots during `starting` via a name + difficulty modal, and bot entrants behave exactly like normal players in tournament flow.
- [x] (2026-03-26 17:30Z) Added a first-pass live in-memory tournament manager with create/join/leave/start/add-bot flows and bot difficulty options.
- [x] (2026-03-26 17:30Z) Added tournament HTTP routes under `/api/v1/tournaments` for browser list, create, join/leave, add-bot, start, details, and test-mode inspection.
- [x] (2026-03-26 17:30Z) Added tournament browser/create/lobby/add-bot/active-game modals in the main menu and wired them to the new API routes.
- [x] (2026-03-28 22:40Z) Reworked the browser into a persistent tournament panel with refresh recovery, host controls, participant seeds/records, host messaging, and a pannable elimination bracket viewer.
- [x] (2026-03-28 22:40Z) Added `current`, `start-elimination`, `transfer-host`, and `message` routes plus client-state shaping for seeds, active-watch targets, and the current user's live tournament game.
- [x] (2026-03-28 22:40Z) Implemented manual transition from round robin to elimination, single-elimination bracket persistence, host-transfer-before-leave behavior, and victory-target-aware elimination series scoring.
- [x] (2026-03-28 22:40Z) Added focused tournament Jest coverage for standings helpers, host transfer, current-tournament recovery, host message updates, and manual elimination start; `npm test` passes.
- [x] (2026-03-29 00:20Z) Split tournament bot entrants from canonical difficulty accounts by creating dedicated bot-user instances per entrant, auto-connecting internal bot clients for those instances, and adding regressions for same-difficulty tournament bots.
- [x] (2026-03-29 01:05Z) Replaced the incorrect fixed-round round-robin implementation with timed rolling pairings that keep free players active until the start window closes, then wait for the last in-flight game before unlocking elimination.
- [x] (2026-03-29 03:10Z) Corrected tournament follow-through so tournament games inherit ranked clocks, spectator mode follows the current live series game instead of the just-finished one, and bot-controlled tournament series can advance into later games.
- [ ] Implement true double-elimination bracket execution, not just the persisted `eliminationStyle` setting.
- [ ] Deepen active-player leave/forfeit handling so future pairings and current matches are auto-resolved rather than lightly detached.

## Surprises & Discoveries

- Observation: `Match.type` is a closed enum and ELO updates happen only for `RANKED`.
  Evidence: [src/models/Match.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/models/Match.js).

- Observation: `Game.timeControlStart` validation currently accepts only configured quickplay or ranked time controls.
  Evidence: [src/models/Game.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/models/Game.js).

- Observation: the browser already has reusable overlays and a working spectator flow, so tournament UI can be layered onto existing primitives without a framework rewrite.
  Evidence: [public/js/modules/ui/overlays.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/public/js/modules/ui/overlays.js) and [public/index.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/public/index.js).

- Observation: the requested "round robin" is actually a timed rolling-pairing phase, not a classical fixed schedule.
  Evidence: the requested behavior pairs free players randomly, avoids repeats until exhausted, and stops only new pairings when the timer ends.

- Observation: proper double elimination needs more than a winners bracket and a loose losers list; it needs lower-bracket major/minor rounds and often a reset grand final.
  Evidence: [Brackets Documentation: Glossary](https://drarig29.github.io/brackets-docs/user-guide/glossary/) and [Brackets Documentation: Structure](https://drarig29.github.io/brackets-docs/user-guide/structure/).

- Observation: the round-robin seed comparator cannot use simple numeric subtraction when two players are undefeated because `Infinity - Infinity` becomes `NaN` and destabilizes sort order.
  Evidence: [tests/tournament.standings.test.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/tests/tournament.standings.test.js) failed until the comparator switched to explicit greater-than / less-than checks.

- Observation: the first implementation accidentally shipped a classical fixed-round scheduler even though the product spec called for rolling pairings with a start-window cutoff.
  Evidence: the user clarified the mismatch after seeing `Round Robin 2 / 3` in the panel, and the prior scheduler in [src/services/tournaments/liveTournaments.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/services/tournaments/liveTournaments.js) precomputed `roundRobinRounds` instead of pairing free players continuously.

## Decision Log

- Decision: keep [docs/tournaments.md](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/docs/tournaments.md) as the durable product spec and use this file only for implementation planning and execution tracking.
  Rationale: the user explicitly asked for both a `tournaments.md` document and a plan.
  Date/Author: 2026-03-25 / Codex

- Decision: recommend a first-class `Tournament` object instead of trying to infer tournaments from groups of matches.
  Rationale: tournaments own configuration, entrants, viewers, standings, bracket state, and final placements.
  Date/Author: 2026-03-25 / Codex

- Decision: recommend tournament-specific match metadata plus an explicit ELO-impact rule instead of reusing ordinary ranked matchmaking semantics.
  Rationale: elimination must affect ELO, but tournament history still needs to stay separate from ranked queue history.
  Date/Author: 2026-03-25 / Codex

- Decision: recommend standard seeded bracket placement with BYEs to the next power of two.
  Rationale: this matches the researched bracket references and keeps bracket generation predictable.
  Date/Author: 2026-03-25 / Codex

- Decision: recommend evaluating `brackets-manager.js` and `brackets-viewer.js` early.
  Rationale: the hardest parts of the feature are correct double-elimination progression and the requested pannable/zoomable bracket view.
  Date/Author: 2026-03-25 / Codex

- Decision: use `host` as the ownership term and make host participation an explicit starting-mode toggle instead of auto-enrollment.
  Rationale: the user confirmed that the tournament owner should not automatically consume a player slot.
  Date/Author: 2026-03-25 / Codex

- Decision: treat elimination ELO exactly like ranked `Match` ELO, awarded once per elimination matchup, while round-robin games award none.
  Rationale: the user explicitly wants elimination to impact ratings "the same way it is done per match in ranked play" and round robin to award nothing.
  Date/Author: 2026-03-25 / Codex

- Decision: persist active tournament objects in MongoDB for recovery, but allow active matches/games to be lost across restart.
  Rationale: the user wants tournament continuity after restart without requiring full live-game recovery.
  Date/Author: 2026-03-25 / Codex

- Decision: allow only the host to add bot entrants, and only during the `starting` state, through a small modal with bot name plus difficulty.
  Rationale: this keeps lobby curation explicit, prevents active-phase bracket manipulation, and preserves parity between bot entrants and normal player entrants.
  Date/Author: 2026-03-26 / Codex

- Decision: enable a tournament dev test-mode in non-production that allows guest sessions to create/join tournaments while keeping production participation login-gated.
  Rationale: this supports local/manual QA of tournament UX without Google auth while preserving production auth requirements.
  Date/Author: 2026-03-26 / Codex

- Decision: tournament elimination ELO applies only when both participants are human; any elimination matchup containing a bot has zero ELO impact.
  Rationale: user explicitly required no rating impact for bot opponents even during elimination rounds.
  Date/Author: 2026-03-26 / Codex

- Decision: land the persistent tournament panel and elimination flow with single-elimination execution first, while keeping the `eliminationStyle` field documented as a remaining gap.
  Rationale: the user-visible panel, refresh recovery, host transfer, manual elimination start, and bracket viewer were the critical path; full double-elimination progression remained substantially larger and was not yet implemented in this slice.
  Date/Author: 2026-03-28 / Codex

- Decision: keep bot difficulty as behavior only, and give each tournament bot entrant its own bot user instance plus internal bot client.
  Rationale: same-difficulty bots must be able to face each other without collapsing to one shared user identity for color resolution, naming, or game actions.
  Date/Author: 2026-03-29 / Codex

- Decision: implement round robin as a rolling pairing queue with a hard start cutoff, not as precomputed fixed rounds.
  Rationale: the user explicitly wants minimum downtime, rematches only when needed, and a timer that stops new starts rather than forcibly ending live games.
  Date/Author: 2026-03-29 / Codex

## Outcomes & Retrospective

This slice delivered the persistent tournament shell, refresh recovery route, seeded participant list, host message editing, host transfer flow, manual elimination start, a live single-elimination bracket viewer, per-entrant tournament bot identities, and now a rolling round-robin scheduler that actually matches the product rules. The biggest remaining gaps are explicit: `eliminationStyle` still persists a future double-elimination intent while the live bracket path is single elimination only, and leaving an active tournament still needs stronger automatic forfeit cleanup.

## Context and Orientation

The server is rooted at [src/server.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/server.js). Real-time state flows through [src/socket.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/socket.js). Current live queue membership is process-local in [src/state/lobby.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/state/lobby.js). Active `Game` and `Match` objects use in-memory wrappers in [src/models/Game.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/models/Game.js) and [src/models/Match.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/models/Match.js), while completed history goes to MongoDB.

The browser still lives mostly in [public/index.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/public/index.js), with the shell and menu in [public/index.html](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/public/index.html). Reusable dialogs are already implemented in [public/js/modules/ui/overlays.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/public/js/modules/ui/overlays.js). History summaries and match normalization live in [src/services/history/summary.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/services/history/summary.js) and [src/services/matches/activeMatches.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/services/matches/activeMatches.js).

Key terms used in this plan:

- Tournament: a first-class object that owns tournament lifecycle and state.
- Round-robin phase: the timed rolling-pairing stage requested by the user.
- Elimination series: a bracket matchup that can contain multiple games until one player reaches the configured victory target.
- BYE: an empty bracket slot used to pad a non-power-of-two field.
- Bracket reset: the extra deciding final required when an undefeated upper-bracket finalist takes their first loss in a true double-elimination final.

## Plan of Work

First, add tournament domain state on the server. Create [src/models/Tournament.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/models/Tournament.js) plus a live tournament manager under `src/services/` or `src/state/`. That layer should own create/join/leave/start/cancel logic, host participation toggling, live membership, round-robin pairing, seeding, elimination progression, recovery serialization, and rehydration from MongoDB.

Next, teach `Match` and `Game` how to belong to a tournament. Add `tournamentId` and tournament metadata to [src/models/Match.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/models/Match.js) and [src/models/Game.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/models/Game.js), keeping schema, in-memory constructor, and persistence helpers aligned. Also add a way to express whether a match affects ELO.

Then add the server contract. Create `src/routes/v1/tournaments/` with routes for live list loading, create, join as player, join as viewer, leave, toggle host participation, start, cancel, accept matchup, and detail fetching. Mount them in [src/routes/v1/index.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/routes/v1/index.js). Extend [src/socket.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/socket.js) so the browser receives tournament browser updates, membership updates, standings, accept prompts, bracket updates, recovery state, and completion.

After that, add the browser UI. Update the menu in [public/index.html](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/public/index.html). In [public/index.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/public/index.js), add the tournament browser modal, the create modal, the pre-start lobby modal, the host participation toggle, the live tournament panel, the mobile slide-over tab, the accept overlay, and the bracket view. Spectating should reuse the existing spectator controller and return users to the tournament shell they came from.

Finally, add persistence, history, and validation. Tournament records must be queryable in MongoDB, tournament-linked matches/games must surface in history, and player history must gain a tournament section or filter. Recovery logic must restore active tournaments after restart and safely requeue any matchup whose live game was lost. Add focused Jest coverage for model serialization, pairing, seeding, bracket progression, accept timeouts, recovery, and history summaries, then run the full test suite and a browser walkthrough on port `3100`.

## Concrete Steps

All commands run from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Read the current touch points before editing:

    Get-Content public\index.html
    Get-Content public\index.js
    Get-Content src\socket.js
    Get-Content src\state\lobby.js
    Get-Content src\models\Match.js
    Get-Content src\models\Game.js
    Get-Content src\services\history\summary.js
    Get-Content src\services\matches\activeMatches.js
    Get-Content docs\tournaments.md

Prototype the bracket-library integration early:

    npm install brackets-manager brackets-viewer
    node -e "const { BracketsManager } = require('brackets-manager'); console.log(typeof BracketsManager);"

If the spike is accepted, serve any needed viewer assets from the repo itself. If it fails, remove the dependency changes, record why in this plan, and keep the same bracket semantics with an internal implementation.

Focused test workflow during implementation:

    cmd /c npm run build:shared
    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/historySummary.service.test.js --runInBand
    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/activeMatches.normalizeId.test.js --runInBand

Example new tournament suites to add:

    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/tournamentModel.test.js --runInBand
    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/tournamentRoundRobinScheduler.test.js --runInBand
    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/tournamentBracketProgression.test.js --runInBand
    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/tournamentHistorySummary.test.js --runInBand

Manual verification command:

    $env:PORT=3100; cmd /c npm start

## Validation and Acceptance

The feature is accepted when a human can demonstrate all of the following on a running local app:

1. The menu shows `Tournament` between `Ranked` and `Rulebook`.
2. The tournament browser modal supports create, join, and view with the correct disabled-state and login rules.
3. Creating a tournament opens a config modal, then a pre-start lobby modal.
4. The host can start or cancel; non-host users can leave.
5. Round-robin games are created automatically for free players, avoid repeats until necessary, and stop only new pairings when the timer expires.
6. Elimination seeding follows the standings rules in [docs/tournaments.md](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/docs/tournaments.md).
7. Elimination acceptance prompts appear with a clear 30-second timer and a missed timer records a loss of the current matchup, not immediate tournament deletion.
8. The live tournament panel and bracket view update in real time and can launch spectator mode.
9. Finished spectator sessions return the user to the same tournament shell.
10. The final modal shows placements and `Finish` returns the user to the main lobby.
11. Tournament records, linked matches, linked games, standings, bracket state, and final placements persist and appear in history.
12. Restarting the server restores active tournament objects from MongoDB and safely recovers any live matchup whose in-progress game was lost.

Automated acceptance is that new tournament-focused Jest suites pass and `npm test` succeeds.

## Idempotence and Recovery

The source edits are safe to land incrementally if tournament routes and UI are kept isolated from existing quickplay/ranked paths until tested. Model changes must be made in lockstep across schema, in-memory document, and persistence helpers. If the bracket-library spike is rejected, cleanly remove the experimental changes before continuing. Avoid destructive git cleanup; the repo may already be dirty.

## Artifacts and Notes

Important references:

- Product spec: [docs/tournaments.md](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/docs/tournaments.md)
- Seed ordering: [Brackets Documentation: Ordering](https://drarig29.github.io/brackets-docs/user-guide/ordering/)
- Double-elimination structure: [Brackets Documentation: Structure](https://drarig29.github.io/brackets-docs/user-guide/structure/)
- Major/minor rounds and BYEs: [Brackets Documentation: Glossary](https://drarig29.github.io/brackets-docs/user-guide/glossary/)

Expected evidence at completion:

    PASS tests/tournamentModel.test.js
    PASS tests/tournamentRoundRobinScheduler.test.js
    PASS tests/tournamentBracketProgression.test.js
    PASS tests/tournamentRecovery.test.js
    PASS tests/tournamentHistorySummary.test.js

## Interfaces and Dependencies

New server-side surface:

- [src/models/Tournament.js](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/src/models/Tournament.js)
- `src/routes/v1/tournaments/`
- a live tournament manager under `src/services/` or `src/state/`

`Match` and `Game` should gain enough tournament metadata to express:

- `tournamentId`
- tournament phase
- bracket/round or series identifiers where needed
- whether the match affects ELO

Recommended dependencies if the spike succeeds:

- `brackets-manager` for bracket generation and progression
- `brackets-viewer` for the pannable/zoomable browser bracket view

Do not depend on a public CDN at runtime.

Revision note: initial planning revision created before implementation so the repo has both a durable tournament spec and a concrete execution plan.

Revision note: updated after user clarification to lock the `host` terminology, host participation toggle, elimination ELO semantics, and Mongo-backed active-tournament recovery rules.

Revision note: updated after the first implementation slice to record the new `/api/v1/tournaments` routes, menu-driven tournament modals, development test-mode guest participation, and bot-opponent elimination ELO exemption.

Revision note: updated after the persistent-panel slice to record the refresh-restored tournament shell, manual elimination start, host transfer flow, standings helper tests, and the remaining single-vs-double elimination gap.

Revision note: updated after the tournament-bot identity fix to record dedicated bot-instance users, dynamic internal bot clients for tournament entrants, and the same-difficulty bot regression coverage.

Revision note: updated after the rolling round-robin correction to record the timed continuous-pairing scheduler, the no-new-games-after-cutoff rule, and the new tournament regressions covering that behavior.

Revision note: updated after the tournament follow-through fix to record ranked time controls for tournament games, live spectator handoff to the active series game, corrected elimination/round-robin spectate labeling, and automatic bot continuation through multi-game tournament matches.
