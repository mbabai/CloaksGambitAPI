# Tournament Mode

This document describes the current tournament system end to end: server lifecycle, client ownership boundaries, player/viewer behavior, bracket rules, accept flow, and the transition rules between games and matches.

## Core Model

Tournament mode is a persistent in-page shell. Once a user creates, joins, or spectates a tournament, the tournament panel becomes the primary background interface until that user explicitly leaves the tournament.

Key properties of the current system:

- refresh-safe recovery through `GET /api/v1/tournaments/current`
- a persistent panel for hosts, players, and viewers
- live board in the center while the current user is actively playing
- bracket access during elimination and after completion
- final placings in the center panel once the tournament is complete

## Ownership Boundaries

Tournament behavior is intentionally split across a few files.

### Server

- `src/services/tournaments/liveTournaments.js`
  - source of truth for tournament state, lifecycle, standings, seeding, break timing, autopilot, and bracket state
- `src/services/tournaments/standings.js`
  - round-robin points and tie-break calculations
- `src/services/tournaments/bracket.js`
  - single/double elimination structure and bracket wiring
- `src/routes/v1/tournaments/index.js`
  - REST surface for tournament creation, join/leave, config, bot management, and lifecycle actions

### Client Panel

- `public/js/modules/tournaments/ui.js`
  - tournament browser
  - persistent tournament panel
  - participant roster
  - host settings/message controls
  - bracket overlay
  - refresh/poll handling for tournament state
  - publication of "accept required" state back to the live-game client

### Live Game Client

- `public/index.js`
  - live board lifecycle
  - end-of-game and next-game banners
  - match continuation
  - tournament match accept banner rendering
  - transition between the live board and the tournament panel

### Client Accept Timing Helper

- `public/js/modules/tournaments/acceptScheduler.js`
  - owns the client-side delay between a finished tournament match and the next accept banner
  - keeps accept countdowns honest by tracking a per-game deadline
  - does not decide whether accept is required; that remains server-authoritative

This split matters: `ui.js` knows tournament state, but `public/index.js` owns the live board and overlay banners.

## Roles

### Host

The creator starts as host. While a host exists, only that user can:

- edit pre-start settings
- edit the tournament message
- add bots
- remove/reallow players
- start the tournament
- manually start elimination once round robin is complete

### Players

Players:

- participate in round robin and elimination
- stay attached across refresh
- use the persistent tournament panel as their default background shell
- return to the panel between tournament matches

### Viewers

Viewers:

- can join at any time
- are not locked in
- are removed when they disconnect or close the browser
- update viewer count in real time

### Hostless Autopilot

If the host leaves an active tournament with remaining members:

- `tournament.host` becomes `null`
- no new host is assigned
- no one can edit message or break time
- no one can manually start elimination early
- the tournament continues automatically

The UI labels this state as `Autopilot`.

If the host leaves a pre-start tournament and nobody remains, the tournament is removed instead of entering autopilot.

## Configuration

Current tournament settings:

- `roundRobinMinutes`
- `breakMinutes`
- `eliminationStyle`: `single` or `double`
- `victoryPoints`: elimination best-of target

Edit rules:

- while `starting`, the host can edit all settings
- while `active + round_robin`, only `breakMinutes` remains editable
- once the round-robin phase fully ends and the break countdown starts, `breakMinutes` locks
- once elimination begins, all settings are fixed

All tournament games use ranked time controls, including round robin.

## Standings and Seeding

Round-robin standings use arena-style scoring:

- win: `1`
- draw: `0.5`
- loss: `0`

Tie-break order:

1. Buchholz
2. Sonneborn-Berger
3. Number of wins
4. Head-to-head
5. Performance rating

The roster currently shows:

- player name
- pre-tournament ELO badge for human entrants
- round-robin points
- seed

Seeds freeze when elimination starts.

## Lifecycle

### `starting`

- host can add players and bots
- same-difficulty bots are separate bot instances, not one shared bot user
- host can edit all settings and the message
- host can start or cancel

### `active + round_robin`

Round robin uses timed rolling pairings rather than fixed rounds.

- free players are matched immediately
- pairings prefer opponents played fewer times
- rematches are allowed to minimize downtime
- new round-robin games may only start while the timer is still open
- games already started continue after the timer reaches zero

### `active + round_robin_complete`

This phase starts only after:

1. the round-robin timer has expired
2. the last in-flight round-robin game has ended

At that point:

- standings freeze
- seeds freeze
- `eliminationStartsAt` is scheduled from `breakMinutes`
- the host may start elimination early if a host still exists
- otherwise elimination starts automatically when the break expires

### `active + elimination`

Supported elimination formats:

- single elimination
- double elimination

Double elimination renders winners bracket above losers bracket, with dotted loser-drop connectors and finals/grand-final structure generated from the persisted bracket object.

Additional rules:

- elimination ELO is awarded once per match, not per individual game
- elimination ELO only applies when both participants are human
- elimination matches involving bots never affect ELO

### `completed`

- tournament panel remains restorable until the user leaves
- bracket remains inspectable
- center stage shows final placings instead of an idle state
- completed placings are ordered by:
  - champion
  - runner-up
  - then deepest finals round, deepest losers round, deepest winners round, and round-robin points
- if those values are still tied, the placement remains tied instead of using an alphabetical fallback
- the final results table shows placement, name, deepest losers round, deepest winners round, and points

## Match Acceptance and Continuation

Tournament accept behavior is intentionally different for round robin vs elimination.

### Round Robin

Every new round-robin game requires acceptance.

- accept window: `30` seconds
- if one player accepts and the other does not, the accepting player wins
- if neither player accepts, the game resolves as a draw

### Elimination

Acceptance is match-scoped, not game-scoped.

- game 1 of an elimination match requires acceptance
- later games in the same elimination match do not
- if one player accepts and the other does not, the accepting player wins the match
- if neither player accepts, the higher seed advances

### Within-Match `Next`

Once a match is already in progress, continuation uses normal match flow instead of the purple accept banner.

- one player presses `Next`
- the other player gets `5` seconds to do the same
- if the other player does nothing, the server auto-advances them
- bots auto-submit `Next`

This applies to:

- ranked multi-game matches
- later games inside an elimination series

It does not apply to the opening game of a new tournament match when accept is required.

## Match-End and Banner Transition Rules

This is the area with the most client coordination and the easiest place to regress.

### End of a Game Inside an Ongoing Match

When the match still has another game:

- the player sees the normal game-end banner
- `Next` queues the next game
- elimination game 2/game 3/etc does not show the tournament accept banner

### End of the Last Game in a Tournament Match

When the tournament match itself is over:

- the player still sees the game-end banner for the final game
- pressing `Next` exits the live board and moves back onto the tournament shell
- after that, the player sees the tournament-flavored `Match Complete` summary with `Back to Lobby`
- `Back to Lobby` returns to the tournament panel, not the global lobby
- the client does not keep the finished board mounted behind the tournament summary or the accept banner

### Delay Before the Next Accept Banner

After a tournament match ends, the next tournament accept banner is delayed for up to `5` seconds.

The purpose of that delay is to avoid instantly interrupting the end-of-match transition while still keeping accept deadlines accurate.

Current behavior:

- if the next match requires accept, the client queues the accept banner
- the queue waits up to `5` seconds while the player is on the game-finished and match-summary flow
- if the player reaches `Back to Lobby` early, the banner is flushed immediately
- if the player does nothing, the queued accept banner replaces the finished-match flow when the `5` seconds expire
- the countdown uses the real server-backed remaining accept time, not a restarted local `30`

### Refresh / Reconnect Behavior

On refresh or reconnect:

- tournament panel state is restored first
- if a current tournament game is live, the play area is rehydrated
- if a current tournament game requires accept and the player has not accepted yet, the accept banner is shown
- if the game is already in progress, the accept banner is not shown again

## Client Safeguards

The current client includes a few protections that are worth preserving.

### Stale Match Summary Suppression

Old finished-match timers must not override a newer live game.

The client now suppresses stale summary/back-to-lobby actions when:

- a different game is already active
- a different match has replaced the finished one

### Refresh-Backed Panel Exit

When a tournament match ends and the player leaves the board, the client refreshes tournament state immediately instead of waiting for poll cadence. This ensures the next accept decision is based on fresh server state.

### Accept Timing Helper

`acceptScheduler.js` centralizes:

- per-game accept deadline tracking
- the 5-second post-match grace window
- immediate flush when the player exits early
- suppression for locally accepted games

Keep those rules in the helper rather than duplicating countdown/grace logic in multiple event handlers.

## Panel Layout

The persistent tournament shell currently includes:

- left host/status column
- center stage for the live board or final results
- upper-right summary/status card
- lower-right participant table
- host message area
- bracket overlay entry

The panel survives refresh for anyone still attached to the tournament.

## Bracket View

Current bracket behavior:

- pannable overlay
- curved connectors between rounds
- winning connectors thicker than loser-drop connectors
- loser-drop connectors dotted
- connector color reflects upstream match completion
- winners bracket above losers bracket in double elimination
- small vertical status tabs on each match card
- win-progress throne icons on slots
- `BYE` for actual byes
- grey placeholder `_________` for unresolved slots

## API Surface

Current tournament routes:

- `GET /api/v1/tournaments`
- `GET /api/v1/tournaments/current`
- `GET /api/v1/tournaments/test-mode`
- `POST /api/v1/tournaments/create`
- `POST /api/v1/tournaments/config`
- `POST /api/v1/tournaments/join`
- `POST /api/v1/tournaments/details`
- `POST /api/v1/tournaments/start`
- `POST /api/v1/tournaments/start-elimination`
- `POST /api/v1/tournaments/message`
- `POST /api/v1/tournaments/leave`
- `POST /api/v1/tournaments/cancel`
- `POST /api/v1/tournaments/add-bot`
- `POST /api/v1/tournaments/kick-player`
- `POST /api/v1/tournaments/reallow-player`

Legacy route still exists for compatibility/admin coverage:

- `POST /api/v1/tournaments/transfer-host`

The current UI no longer depends on host transfer.

## Files to Read Before Editing Tournament Flow

If you are changing tournaments, start here:

- `docs/tournaments.md`
- `public/js/modules/tournaments/ui.js`
- `public/js/modules/tournaments/acceptScheduler.js`
- `public/index.js`
- `src/services/tournaments/liveTournaments.js`
- `tests/tournament.service.test.js`
- `tests/nextRoute.matchContinuation.test.js`
- `tests/tournamentAcceptScheduler.test.js`
