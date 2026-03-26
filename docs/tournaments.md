# Tournament Mode

## Purpose

Tournament mode provides a dedicated flow for creating and running multi-game events from the main menu, with host-managed lobby controls, bot entrants, spectator access, and admin-side cleanup tooling.

This file documents the **current implemented behavior** and the known follow-up gaps.

## Current User-Facing Flow

### Main menu entry

- Main menu includes a `Tournament` button.
- Clicking it opens the Tournament Browser overlay.

### Tournament Browser

- Lists tournaments in `starting` or `active` state.
- Each row displays:
  - label
  - state
  - host username
  - player count
  - viewer count
- Browser actions:
  - `Create`
  - `Join` (as player)
  - `View` (as viewer)

Behavior:

- `Join` is enabled only for `starting` tournaments.
- `View` is enabled for `starting` and `active` tournaments.
- `View` auto-joins the user as a viewer before opening details.
- Tournament details endpoint requires membership (host/player/viewer).

### Create Tournament

Create modal currently supports:

- Label
- Round robin minutes (1–30)
- Elimination style (`single`, `double`)
- Victory points (`3`, `4`, `5`)

On success, the creator becomes host and lands in the lobby overlay.

### Lobby / host controls

Lobby displays current players and state/phase.

Host-only while `starting`:

- `Start Tournament`
- `Add Bot`
- `Cancel Tournament`

All members:

- `Leave Tournament`

Add Bot modal supports:

- bot display name
- difficulty from bot registry options (currently Easy/Medium playable)

### Active Tournament view

- Active overlay renders tournament games using the same styled active-match rows as spectate browser.
- Each row has a `Spectate` action.
- Spectating opens the existing shared spectate controller by `matchId`.
- Tournament player usernames are registered before spectate opens so names render correctly.

## Current Server Behavior

## States

Persisted tournament states:

- `starting`
- `active`
- `completed`
- `cancelled`

## Roles

- `host`
- `player`
- `viewer`

## Match/Game creation

When host starts a tournament:

- state becomes `active`
- phase becomes `round_robin`
- service creates **real `Match` and `Game` records** for round-robin pairings
- `matchIds` and `gameIds` are stored on the tournament

Important current behavior:

- no elimination match is pre-seeded at start
- elimination progression is not yet implemented end-to-end

## Live event emission

Tournament-created games emit the same runtime events as other live modes:

- `gameChanged`
- `players:bothNext`
- `match:created`

This ensures bot clients receive prompts and bot-vs-bot tournament games actually play.

## ELO and match typing

`Match` supports tournament types:

- `TOURNAMENT_ROUND_ROBIN`
- `TOURNAMENT_ELIMINATION`

ELO logic:

- round-robin games: no ELO
- elimination: ELO applies only when `eloEligible === true`
- elimination matches involving bots are created with `eloEligible = false`

## Persistence and Recovery

Tournament persistence model:

- in-memory map for live runtime state
- Mongo snapshotting for started/completed/cancelled tournament records

Stored fields include:

- host/config/state/phase/timestamps
- players/viewers
- `matchIds`
- `gameIds`

## API Surface (implemented)

Participant routes:

- `GET /api/v1/tournaments`
- `GET /api/v1/tournaments/test-mode`
- `POST /api/v1/tournaments/create`
- `POST /api/v1/tournaments/join`
- `POST /api/v1/tournaments/leave`
- `POST /api/v1/tournaments/cancel`
- `POST /api/v1/tournaments/add-bot`
- `POST /api/v1/tournaments/start`
- `POST /api/v1/tournaments/details`

Admin routes:

- `POST /api/v1/tournaments/admin/list`
- `POST /api/v1/tournaments/admin/delete`

Admin delete behavior:

- deletes tournament record
- cascades deletion of associated matches and games (active and historic where applicable)
- emits `adminRefresh`

## Admin Dashboard

Admin UI now has a dedicated `Tournaments` tab with two lists:

- Active Tournaments
- Historic Tournaments

Each row includes a delete action that calls the admin delete endpoint and reports deleted match/game counts.

## History Integration (implemented)

History summary now includes `tournamentMatches` bucket:

- total
- wins
- draws
- losses
- winPct

Tournament match types are normalized and included in summary aggregation.

## Dev Test Mode

Current behavior:

- non-production: guest participation allowed for tournament flows
- production: guests blocked from participation endpoints

## Known Gaps / Next Work

The following are **not fully implemented yet**:

1. Full round-robin scheduler lifecycle (timed rolling pairings with repeat-avoidance and transition handling).
2. Seeding and bracket generation from round-robin standings.
3. Full elimination progression/acceptance overlays/forfeit windows.
4. Final placements modal (`1st/2nd/3rd`) and finish flow.
5. Dedicated tournament filter controls in all history UIs.
