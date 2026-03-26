# Tournament Mode (Current Implementation)

## What Exists Now

Tournament mode currently supports:

- Browser overlay to list live tournaments (`starting` and `active`)
- Create / Join / View / Leave / Cancel actions
- Host-only bot insertion during `starting`
- Host-only start transition
- Active games list with Spectate buttons wired to match-based spectate
- Membership-gated details access (users must be host, player, or viewer)
- Admin tournament list and delete operations (with match/game cascade cleanup)

## Current Lifecycle

### `starting`
- Host can add bots and start/cancel.
- Players/viewers can join/leave.

### `active`
- Start currently creates **round-robin matches only**.
- Elimination is not pre-seeded at kickoff.
- Tournament games are emitted with live socket bootstrap events (`gameChanged`, `players:bothNext`, `match:created`) so bot participation starts reliably.

### `completed` / `cancelled`
- Persisted for history/admin visibility.
- Removed from live browser listing.

## Spectate Integration

Active tournament rows use the shared active-match renderer and pass `matchId` into the main spectate controller.
Player usernames are registered before spectate open so labels resolve correctly.

## Admin Operations

Admin APIs:

- `GET /api/v1/tournaments/admin/list`
- `POST /api/v1/tournaments/admin/delete`

Delete performs cascade cleanup of linked match/game records and removes the tournament from in-memory live state plus persistence snapshot.

## Pending / Future Work

Not yet implemented in this slice:

- Full timed rolling round-robin scheduler
- Standings/seeding pipeline
- Bracket generation and elimination flow execution
- Dedicated tournament history filter/view UX

