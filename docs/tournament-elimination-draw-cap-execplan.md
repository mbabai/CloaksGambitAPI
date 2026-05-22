# Tournament Elimination Draw Cap and Sudden Death

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the repository guidance in `PLANS.md`.

## Purpose / Big Picture

Tournament elimination matches currently continue through unlimited draws until one player reaches the victory target. After this change, elimination matches use the configured victory target as a draw cap too. When the cap is reached, the player with more game wins advances; if the game-win score is tied, the match continues in sudden death until one player gets the next game win. Players should see that tied-cap continuation clearly because the existing next-game countdown says `Sudden Death Game Starting`.

## Progress

- [x] (2026-05-21 21:23-07:00) Read the tournament, match, next-route, countdown helper, and documentation ownership files.
- [x] (2026-05-21 21:31-07:00) Implemented a shared server helper for elimination draw-cap winner and sudden-death detection.
- [x] (2026-05-21 21:31-07:00) Updated `src/models/Game.js` so tournament elimination draw caps can end the match or enter sudden death.
- [x] (2026-05-21 21:33-07:00) Updated `src/routes/v1/gameAction/next.js` and `public/index.js` so next-game countdown events carry and render the sudden-death title.
- [x] (2026-05-21 21:35-07:00) Updated rules and tournament documentation.
- [x] (2026-05-21 21:36-07:00) Added regression tests for draw-cap winner, tied-cap continuation, next-route sudden-death payload, and countdown title copy.
- [x] (2026-05-21 21:41-07:00) Ran focused and full Jest suites. Full `npm.cmd test` passed with 72 suites and 268 tests.

## Surprises & Discoveries

- Observation: The current elimination branch already disables the old generic draw-wins behavior by checking `!isTournamentElimination` before ending a match on draw count.
  Evidence: `src/models/Game.js` increments `match.drawCount`, then computes `drawWins = !isTournamentElimination && ...`.

- Observation: The new tournament service tests must disable `eloEligible` for their direct elimination match completions in this no-database Jest environment.
  Evidence: The first focused run timed out because `Match.endMatch()` tried to buffer `User.updateOne()` for elimination ELO writes. Setting `match.eloEligible = false` matches the pattern used by nearby direct match-ending tests.

## Decision Log

- Decision: Put the match-ending rule in `src/models/Game.js`, not in tournament bracket code.
  Rationale: `Game.endGame()` already updates match scores, draw count, creates the next game, and ends the match. Bracket advancement listens for `match:ended`, so ending the match there keeps single and double elimination bracket code unchanged.
  Date/Author: 2026-05-21 / Codex.

- Decision: Add a small shared helper under `src/utils/` for elimination draw-cap and sudden-death state.
  Rationale: Both `Game.js` and the `next` route need the same state calculation. A helper avoids duplicating the “draw cap reached, scores tied” predicate.
  Date/Author: 2026-05-21 / Codex.

## Outcomes & Retrospective

Complete. Elimination matches now advance the current game-win leader when `drawCount` reaches `victoryPoints`; tied matches continue and mark the next countdown as sudden death. Focused and full Jest validation passed.

## Context and Orientation

`src/models/Game.js` owns `updateMatchAfterGame()`, which runs after every game ends. It increments `match.player1Score`, `match.player2Score`, or `match.drawCount`, then either ends the match or creates the next game. `src/models/Match.js` owns `endMatch()`, which emits `match:ended`. `src/services/tournaments/liveTournaments.js` listens for `match:ended` and advances the bracket.

The browser receives the next-game countdown through the `players:bothNext` socket event. `src/routes/v1/gameAction/next.js` builds that event payload after both players press Next, and `public/index.js` renders the countdown banner with the title returned by `public/js/modules/ui/matchCountdown.js`.

## Plan of Work

First, add a server utility that can answer two questions for a match: whether the draw cap should pick a winner, and whether the match is in sudden death because the draw cap has been reached while game wins are tied. Then use that helper inside `src/models/Game.js` after scores and draw count are updated. For elimination matches only, if draw count has reached `winScoreTarget` and one player has more wins, call `match.endMatch()` with that player. If the scores are tied, skip ending and allow the existing next-game creation path to run.

Second, expose the sudden-death state in `src/routes/v1/gameAction/next.js` by adding `suddenDeath: true` to the `players:bothNext` payload when the next game belongs to an elimination match whose draw cap has been reached with tied scores. Pass that flag through `public/index.js` into `showMatchFoundBanner()`, and update `getMatchCountdownBannerTitle()` so it returns `Sudden Death Game Starting` when the flag is set.

Third, update `rules.md` and `docs/tournaments.md` to describe the new elimination draw-cap rule. Add tests in the tournament service suite, next-route suite, and countdown helper suite.

## Concrete Steps

Work from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Edit:

- `src/utils/tournamentMatchRules.js`
- `src/models/Game.js`
- `src/routes/v1/gameAction/next.js`
- `public/js/modules/ui/matchCountdown.js`
- `public/index.js`
- `tests/tournament.service.test.js`
- `tests/nextRoute.tournamentContinuation.test.js`
- `tests/matchCountdownBannerTitle.test.js`
- `rules.md`
- `docs/tournaments.md`

Run focused tests:

    npm test -- tests/tournament.service.test.js tests/nextRoute.tournamentContinuation.test.js tests/matchCountdownBannerTitle.test.js

If the focused tests pass, run broader affected tests if time allows:

    npm test -- tests/tournamentAcceptWindow.test.js tests/nextRoute.matchContinuation.test.js

## Validation and Acceptance

A score-leading player advances when elimination `drawCount` reaches `victoryPoints`. A tied match remains active at the draw cap, creates another active game, and the next player win ends the match even if that player has fewer than `victoryPoints` wins. The `players:bothNext` payload contains `suddenDeath: true` for those tied-cap continuation games, and the countdown banner title renders `Sudden Death Game Starting`.

## Idempotence and Recovery

The edits are normal source changes and can be rerun safely. If tests fail, inspect the focused test output first because it will point to either the score-resolution branch or the countdown payload path. No migrations or destructive commands are required.

## Artifacts and Notes

Focused validation:

    npm.cmd test -- tests/tournament.service.test.js tests/nextRoute.tournamentContinuation.test.js tests/matchCountdownBannerTitle.test.js
    Test Suites: 3 passed, 3 total
    Tests:       40 passed, 40 total

Adjacent validation:

    npm.cmd test -- tests/tournamentAcceptWindow.test.js tests/nextRoute.matchContinuation.test.js
    Test Suites: 2 passed, 2 total
    Tests:       5 passed, 5 total

Full validation:

    npm.cmd test
    Test Suites: 72 passed, 72 total
    Tests:       268 passed, 268 total

## Interfaces and Dependencies

Create `src/utils/tournamentMatchRules.js` with CommonJS exports:

- `isTournamentEliminationMatch(match)`
- `getTournamentEliminationDrawCapWinner(match, winScoreTarget)`
- `isTournamentEliminationSuddenDeath(match, winScoreTarget)`

The helper accepts plain objects, Mongoose documents, and in-memory match documents. It must treat `player1Score`, `player2Score`, and `drawCount` as numbers and return the existing `match.player1` or `match.player2` value as the winner identifier.
