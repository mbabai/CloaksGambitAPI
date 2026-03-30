# Tournament Mode (Current Implementation)

## What Exists Now

Tournament mode now uses a persistent in-page panel once a user creates, joins, or views a tournament. The panel restores itself through `GET /api/v1/tournaments/current`, survives browser refresh, keeps the normal live board in the middle when the current user is playing, and blocks the quickplay queue UI until the user explicitly leaves the tournament.

The panel currently supports:

- Main-menu `Tournament` button restored in `public/index.html`
- Tournament browser overlay for create / join / view entry
- Persistent host controls, status summary, participant list, and host message area
- Viewer count display and host-only message editing
- Host transfer flow before the current host leaves when active players remain
- Tournament bots use dedicated bot-user instances per entrant, so bot difficulty and bot identity are no longer the same thing
- Manual promotion from round robin into elimination through `POST /api/v1/tournaments/start-elimination`
- Seed computation from round-robin results using:
  - win/loss ratio
  - more total games played
  - fewer draws
  - higher pre-tournament ELO
- Single-elimination bracket persistence plus pannable / zoomable bracket viewer
- Active-player watch buttons and bracket-node spectate handoff

## Current Lifecycle

### `starting`

- Host can add bots, start, cancel, post a host message, or transfer host duties.
- Each added tournament bot gets its own bot user account while still inheriting its configured difficulty behavior.
- Host and viewers can explicitly join the player list.
- Tournament settings are still shown in the panel and become read-only once the event starts.

### `active` + `round_robin`

- The service uses a rolling pairing loop instead of fixed classical rounds.
- While the round-robin timer is still open, any free players are paired immediately to minimize downtime.
- Pairing prefers opponents a player has faced fewer times, but rematches are allowed when that is the only way to keep games flowing.
- The timer controls when new round-robin games may start.
- Once the timer reaches zero, no new round-robin games start, but existing games continue until they finish.
- The panel shows the remaining time in that round-robin start window in real time.
- Participant rows show live round-robin W/L/D plus the current computed seed.

### `active` + `round_robin_complete`

- This phase starts only after the round-robin start window has already closed and the final in-flight round-robin game has ended.
- Elimination does not auto-start.
- The host gets a dedicated `Start Elimination` control.
- Seeds are frozen from the round-robin standings when elimination begins.

### `active` + `elimination`

- The server builds and persists a single-elimination bracket.
- First available elimination matches are created immediately.
- The bracket viewer uses the persisted bracket object and marks active spectate targets.

### `completed` / `cancelled`

- Tournament snapshots persist to MongoDB for history/admin visibility.
- The browser list still hides completed/cancelled rows, but `current` recovery can still restore a completed tournament panel until the member leaves.

## API Surface

- `GET /api/v1/tournaments`
- `GET /api/v1/tournaments/current`
- `POST /api/v1/tournaments/create`
- `POST /api/v1/tournaments/join`
- `POST /api/v1/tournaments/details`
- `POST /api/v1/tournaments/start`
- `POST /api/v1/tournaments/start-elimination`
- `POST /api/v1/tournaments/message`
- `POST /api/v1/tournaments/transfer-host`
- `POST /api/v1/tournaments/leave`
- `POST /api/v1/tournaments/cancel`
- `POST /api/v1/tournaments/add-bot`
- `POST /api/v1/tournaments/kick-player`
- `POST /api/v1/tournaments/reallow-player`

## Known Gaps

- The stored `eliminationStyle` setting still exists, but the live bracket flow currently executes as single elimination only.
- Leaving an already-active tournament still uses the existing light-touch server behavior; deeper automatic forfeiture / future-match cleanup is not fully modeled yet.
- Tournament updates are currently refreshed from the browser with polling plus existing game/match events rather than a dedicated tournament socket channel.
