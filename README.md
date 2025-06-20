# Cloaks Gambit API

A REST API application built with Node.js and MongoDB.

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
- POST /api/v1/games/listenForMove - Poll for the opponent's next action

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

## Listening for Moves

Use the `/api/v1/games/listenForMove` endpoint after each action to stay
synchronized with your opponent. Send a POST request with `gameId`, `color`
and the `lastAction` index or timestamp you have processed. If a new
opponent action occurs before the 30 second timeout, the route returns the
updated game state with HTTP `200`. Otherwise it returns `204` and you should
immediately issue another poll.

Example client logic (using `fetch`):

```javascript
async function listenLoop(gameId, color, lastAction) {
  const body = JSON.stringify({ gameId, color, lastAction });
  const res = await fetch('/api/v1/games/listenForMove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (res.status === 200) {
    const game = await res.json();
    // handle updated game state here
    return game;
  }

  // status 204 indicates no action; call again
  return listenLoop(gameId, color, lastAction);
}
```
