# Cloaks Gambit API

A REST API application built with Node.js and MongoDB. Real-time match and move
updates are delivered through WebSocket events.

The web client now includes private board annotations for live play and spectating:
right-click a square to place a purple circle, right-drag to place a snapped arrow,
and left-click anywhere to clear local drawings.

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (local installation or MongoDB Atlas account)

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and update the values with your
   local Google OAuth credentials and MongoDB connection string. This file is
   ignored by git so each developer can manage their own secrets locally.

## Environment configuration

- **Development:** Environment variables are loaded from `.env` via
  `dotenv`. Ensure you keep this file private and never commit it to version
  control.
- **Production:** All secrets must be provided as environment variables (for
  example via Azure App Service with Key Vault references). The application
  requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
  `JWT_SECRET`, and `MONGODB_ATLAS_CONNECTION_STRING` to be defined at runtime.
  For Azure App Service, the default host for this repo is typically
  `https://cloaksgambit.azurewebsites.net`, so the Google callback should be
  `https://cloaksgambit.azurewebsites.net/api/auth/google/callback` unless you
  have a custom domain.
  If auth is served from a custom domain or embedded cross-site, set
  `AUTH_COOKIE_SAME_SITE=none` and `AUTH_COOKIE_SECURE=true`. Set
  `AUTH_COOKIE_DOMAIN` only when you intentionally want to share cookies across
  subdomains.
- The admin ML workflow is feature-gated by `ENABLE_ML_WORKFLOW`. It defaults to
  enabled outside production and disabled in production unless explicitly set.

## Running the Application

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## ML Workbench

- Admin UI: `http://localhost:3000/ml-admin`
- The route and `/api/v1/ml/*` endpoints are only mounted when
  `ENABLE_ML_WORKFLOW` is enabled.
- The current workbench is run-oriented: `Config`, `Runs`, `Replay`, and `Test`.
- Training can stay in the Node CPU trainer or use the optional Python Torch
  bridge in `ml_backend/`.
- Usage guide: [`docs/ml-admin.md`](docs/ml-admin.md)

## WebSocket Connection

Real-time updates are delivered over a Socket.IO connection. Clients should
establish a normal browser session first, then connect with cookies enabled so
the server can resolve the player or guest identity from the session:

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  withCredentials: true
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
  // game: { matchId, gameId, board, actions, clocks, ... }
});

socket.on("game:finished", (summary) => {
  // summary: { gameId, winner, winReason, clocks, ...full state }
});
```

`game:update`, `game:finished`, and `initialState.games[]` now include a `clocks`
payload with `whiteMs`, `blackMs`, `activeColor`, `tickingWhite`, `tickingBlack`,
and `label` so player and spectator clients can render the same server-authored
clock baseline.

Socket.IO automatically attempts to reconnect when the connection drops.
For best results, listen for `disconnect` and `reconnect` events and refresh
any application state after reconnecting.

The browser client should not mirror the auth JWT into `localStorage`. Fetches
and sockets are expected to rely on the server-owned session cookies.

## Local Clock Debugging

When running locally, the server can write verbose per-game clock logs to the
operating system temp directory. By default this is enabled outside production
and tests; set `CG_LOCAL_GAME_LOGS=false` to disable it or
`CG_LOCAL_GAME_LOGS=true` to force-enable it.

The log file path is:

- Windows: `%TEMP%\cloaks-gambit-debug\clock-events.jsonl`

Useful searches:

```powershell
rg -n "clock-transition|socket-payload|client-clock|timeout-check" "$env:TEMP\cloaks-gambit-debug\clock-events.jsonl"
Get-Content "$env:TEMP\cloaks-gambit-debug\clock-events.jsonl" -Tail 80
```

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
- POST /api/v1/gameAction/draw - Offer or accept a draw
- POST /api/v1/gameAction/next - Advance to the next game in a match flow

### Lobby
- POST /api/v1/lobby/get - Retrieve the current lobby queues
- POST /api/v1/lobby/enterQuickplay - Join the quickplay queue
- POST /api/v1/lobby/exitQuickplay - Leave the quickplay queue
- POST /api/v1/lobby/enterRanked - Join the ranked queue
- POST /api/v1/lobby/exitRanked - Leave the ranked queue

### ML (Admin-only, Feature-gated)
- GET /api/v1/ml/workbench - Load the aggregated ML workbench payload
- GET /api/v1/ml/live - Load current live run/simulation/training status
- GET /api/v1/ml/runs - List continuous ML runs
- GET /api/v1/ml/runs/:runId - Load one run with generations and retained games
- POST /api/v1/ml/runs - Start a continuous run
- POST /api/v1/ml/runs/:runId/stop - Request a graceful stop for a run
- DELETE /api/v1/ml/runs/:runId - Delete a stopped run
- GET /api/v1/ml/runs/:runId/games - List retained games for a run
- GET /api/v1/ml/runs/:runId/replay/:gameId - Load one retained replay
- POST /api/v1/ml/test-games - Launch a live test game against a selected run generation
- Legacy snapshot/simulation/training helper endpoints still exist under
  `/api/v1/ml/*` for compatibility and lower-level tooling.

## Project Structure

```
src/
├── models/         # MongoDB models
├── routes/         # API routes
└── server.js       # Application entry point
```

For game UI styling, see `docs/colors.md` for the centralized color palette. Always
use the `CG-` variables instead of hard-coded color values.

