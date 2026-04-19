# Test Notes

## Test Style
- The suite uses Jest with a mix of:
  - utility unit tests
  - extracted route-handler tests
  - higher-level service/integration-style tests
- Route tests commonly mock the model layer and call the router handler directly instead of booting the whole Express app.

## High-Signal Regression Suites
- Auth and identity:
  - `tests/googleAuth.session.test.js`
  - `tests/ensureUser.test.js`
- Live rules and pending-move flow:
  - `tests/moveRoute.pendingResolution.test.js`
  - `tests/passRoute.bombResolution.test.js`
  - `tests/responseRoutes.pendingValidation.test.js`
- Clock authority:
  - `tests/liveClockState.test.js`
  - `tests/moveRoute.clockState.test.js`
  - `tests/gameClockPayload.test.js`
- Bot runtime and recovery:
  - `tests/botClient.continuation.test.js`
  - `tests/botTurnFailsafe.service.test.js`
  - `tests/internalBots.runtime.test.js`
- Match normalization/history:
  - `tests/activeMatches.normalizeId.test.js`
  - `tests/historySummary.service.test.js`
- Tournament lifecycle and client helpers:
  - `tests/tournament.service.test.js`
  - `tests/nextRoute.matchContinuation.test.js`
  - `tests/tournamentAcceptScheduler.test.js`

## Practical Workflow
- `npm test` rebuilds shared constants first.
- When iterating on gameplay logic, use focused runs first and then rerun the broader suite if the change crosses multiple gameplay or auth surfaces.

## Rules for New Tests
- If you change auth behavior, add or update the auth/session tests.
- If you change live game rules, add or update the route tests that cover the same flow.
- If you launch a local server for manual testing, do not use port `3000` from the agent; prefer `3100` or another spare port.
