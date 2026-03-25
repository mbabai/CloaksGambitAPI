# Game Action Notes

## Canonical References
- `rules.md` is the long-form, human-readable rules document.
- `shared/constants/game.json` is the machine-readable constants source.
- `src/services/game/liveGameRules.js` contains the small shared helpers already extracted for live routes.

## Live Move State Machine
- `setup.js` places 5 pieces on the home rank, marks one real on-deck piece, and leaves the remaining 2 in stash.
- `ready.js` transitions both players into the playable state after setup.
- `move.js` records a `PENDING` move and flips `playerTurn` immediately, but the board does not move yet.
- `challenge.js`, `bomb.js`, and `pass.js` resolve the response window around that pending move.
- `onDeck.js` finishes the refresh step when a failed challenge or a true bomb requires a replacement on-deck piece.

## Move State Meanings
- `PENDING`: the declaration was made and a response window is open.
- `COMPLETED`: the main board consequence happened, but an on-deck replacement is still required.
- `RESOLVED`: no more response or on-deck work remains.

## Current Rule/Route Invariants
- `move.js` always resolves any stale previous pending move before validating a new move. This prevents validating against an out-of-date board.
- `bomb.js` only works against a pending move, only if the defender controls the target square, and never against a declared king move.
- `challenge.js` branches on whether the last action was `MOVE` or `BOMB` and is allowed to end the game through:
  - `TRUE_KING`
  - `CAPTURED_KING`
  - `DAGGERS`
- Failed move challenges send the original mover into the on-deck phase.
- Failed bomb challenges send the bomb declarer into the on-deck phase.
- `pass.js` resolves a bomb by removing the attacking piece from the original `from` square because the move never resolves onto `to`.
- `setup.js` now requires a real `onDeck` piece and no longer injects fake placeholder stash pieces.

## Clock and Event Rules
- Every mutating live route should call `ensureStoredClockState()` on entry and `transitionStoredClockState()` when handing control to the next actor.
- Do not hand-roll clock math inside routes.
- After any successful mutation, emit `eventBus.emit('gameChanged', ...)` so sockets, spectators, and admin views stay aligned.

## Change Discipline
- If you change live gameplay rules, update:
  - `rules.md`
  - the route-level Jest tests
