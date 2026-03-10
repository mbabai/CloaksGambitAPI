# Model Notes

## Two Persistence Modes
- `Game` and `Match` are hybrid models:
  - active/live documents live in process memory through custom `GameDocument` and `MatchDocument` wrappers.
  - completed documents are persisted into the underlying Mongoose history models.
- `User`, `ServerConfig`, `Simulation`, and `SimulationGame` are plain Mongoose models.

## Why This Matters
- Active games and matches are fast and mutable in-memory objects.
- Completed history survives process restarts because `endGame()` and `endMatch()` persist them to MongoDB.
- A server restart loses active in-memory matches. The code explicitly clears lobby queue state on boot for the same reason.

## Game Model Invariants
- `src/models/Game.js` must keep schema fields and the in-memory `GameDocument` constructor in sync.
- `clockState` is a recent example: it had to be added to:
  - the Mongoose schema
  - the in-memory document constructor
  - the persistence preparation path
- `updateMatchAfterGame()` increments match scores, handles draws, and creates the next game in the match with player colors swapped.
- `endGame()` also finalizes stored clock state before persisting.

## Match Model Invariants
- `Match.endMatch()` updates ranked Elo with K-factor 32 and writes the result back to the user records.
- Ending a match also emits `match:ended` and removes players from the in-game lobby set.
- Like `Game`, the in-memory `MatchDocument` and the Mongoose schema have to stay in lockstep for new fields.

## Query Behavior
- Active queries are usually served from the in-memory store.
- Queries that explicitly target `isActive: false` route to the Mongoose history model.
- Be careful when changing query helpers: history queries and live queries intentionally do not hit the same backing store.

## Editing Guidance
- When adding a new `Game` or `Match` field, inspect all of these in the same edit:
  - schema definition
  - document constructor
  - `_prepareForMongo()`
  - any masking/serialization helpers
  - tests that cover active vs completed behavior
