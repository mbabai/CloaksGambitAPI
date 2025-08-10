# API Documentation

This document lists the REST endpoints exposed by the Cloaks Gambit API. Real-
time match and move data is streamed to clients via WebSocket events.

## Users
- `POST /api/v1/users/getList` – Retrieve users with optional filters
- `POST /api/v1/users/getDetails` – Get details for a specific user

## Matches
- `POST /api/v1/matches/getList` – Get a list of matches
- `POST /api/v1/matches/getDetails` – Get details for a specific match

## Games
- `POST /api/v1/games/getList` – Get a list of games
- `POST /api/v1/games/getDetails` – Get details for a specific game

## Game Actions
- `POST /api/v1/gameAction/checkTimeControl` – Check the current player's clock
- `POST /api/v1/gameAction/setup` – Set up a game board
- `POST /api/v1/gameAction/move` – Submit a piece move
- `POST /api/v1/gameAction/challenge` – Challenge an opponent's move
- `POST /api/v1/gameAction/bomb` – Bomb the last move
- `POST /api/v1/gameAction/onDeck` – Move a piece on deck
- `POST /api/v1/gameAction/pass` – Pass the turn
- `POST /api/v1/gameAction/resign` – Resign from the game
- `POST /api/v1/gameAction/ready` – Mark a player as ready

## Lobby
- `POST /api/v1/lobby/get` – Retrieve the current lobby queues
- `POST /api/v1/lobby/enterQuickplay` – Join the quickplay queue
- `POST /api/v1/lobby/exitQuickplay` – Leave the quickplay queue
- `POST /api/v1/lobby/enterRanked` – Join the ranked queue
- `POST /api/v1/lobby/exitRanked` – Leave the ranked queue

## WebSocket Connection

Real-time features use a Socket.IO connection. Clients should connect with
their user ID to receive personalized events:

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  auth: { userId: "<USER_ID>" }
});
```

### Events

- `initialState` – Emitted once after connecting and contains queue membership
  and any active games for the player.
- `queue:update` – Notifies the client when their queue status changes.
- `match:found` – Sent when matchmaking creates a new match for the player.
- `game:update` – Provides real-time game state updates.

### Reconnection

Socket.IO will automatically try to reconnect if the connection drops. Listen
for `disconnect` and `reconnect` events and refresh any needed state after the
client rejoins.

