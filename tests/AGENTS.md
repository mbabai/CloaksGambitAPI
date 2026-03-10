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
- Match normalization/history:
  - `tests/activeMatches.normalizeId.test.js`
  - `tests/historySummary.service.test.js`

## Practical Workflow
- `npm test` rebuilds shared constants first.
- The full suite can still be slowed down by `tests/mlRuntime.test.js`.
- When iterating on gameplay logic, use focused runs first and then decide whether the heavy ML suite needs to be rerun.

## Rules for New Tests
- If you change auth behavior, add or update the auth/session tests.
- If you change live game rules, add or update the route tests and any corresponding ML/runtime checks.
- If you launch a local server for manual testing, do not use port `3000` from the agent; prefer `3100` or another spare port.
