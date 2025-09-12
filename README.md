# Cloaks Gambit API

A REST API application built with Node.js and MongoDB. Real-time match and move
updates are delivered through WebSocket events.

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (local installation or MongoDB Atlas account)

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory with the following variables:
   ```
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/cloaks-gambit
   NODE_ENV=development
   ```

## Running the Application

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## WebSocket Connection

Real-time updates are delivered over a Socket.IO connection. Clients should
connect with their user ID to receive personalized events:

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  auth: { userId: "<USER_ID>" }
});

socket.on("initialState", ({ queued, games }) => {
  // queued: { quickplay: boolean, ranked: boolean }
  // games: array of active games masked for the player
});

socket.on("queue:update", (status) => {
  // status: { quickplay: boolean, ranked: boolean }
});

socket.on("match:found", (match) => {
  // match: { matchId, gameId, type }
});

socket.on("game:update", (game) => {
  // game: { matchId, gameId, board, actions }
});

socket.on("game:finished", (summary) => {
  // summary: { gameId, winner, winReason, ...full state }
});
```

Socket.IO automatically attempts to reconnect when the connection drops.
For best results, listen for `disconnect` and `reconnect` events and refresh
any application state after reconnecting.

## API Endpoints

### Users
- POST /api/v1/users/getList - Retrieve users with optional filters
- POST /api/v1/users/getDetails - Get details for a specific user

### Matches
- POST /api/v1/matches/getList - Get a list of matches
- POST /api/v1/matches/getDetails - Get details for a specific match

### Games
- POST /api/v1/games/getList - Get a list of games
- POST /api/v1/games/getDetails - Get details for a specific game

### Game Actions
- POST /api/v1/gameAction/checkTimeControl - Check the current player's clock
- POST /api/v1/gameAction/setup - Set up a game board
- POST /api/v1/gameAction/move - Submit a piece move
- POST /api/v1/gameAction/challenge - Challenge an opponent's move
- POST /api/v1/gameAction/bomb - Bomb the last move
- POST /api/v1/gameAction/onDeck - Move a piece on deck
- POST /api/v1/gameAction/pass - Pass the turn
- POST /api/v1/gameAction/resign - Resign from the game
- POST /api/v1/gameAction/ready - Mark a player as ready

### Lobby
- POST /api/v1/lobby/get - Retrieve the current lobby queues
- POST /api/v1/lobby/enterQuickplay - Join the quickplay queue
- POST /api/v1/lobby/exitQuickplay - Leave the quickplay queue
- POST /api/v1/lobby/enterRanked - Join the ranked queue
- POST /api/v1/lobby/exitRanked - Leave the ranked queue

## Project Structure

```
src/
├── models/         # MongoDB models
├── routes/         # API routes
└── server.js       # Application entry point
```

For game UI styling, see `docs/colors.md` for the centralized color palette. Always
use the `CG-` variables instead of hard-coded color values.

