# ML Route Notes

## Access and Mounting
- This router is mounted from `src/routes/v1/index.js` only when `src/utils/mlFeatureGate.js` enables the ML workflow.
- Every endpoint here is admin-only through `ensureAdminRequest()`.
- The file uses the singleton `getMlRuntime()`, so route changes usually imply runtime, browser, and test changes too.

## Route Groups
- `GET /workbench` and `GET /live` drive the current `/ml-admin` page state and polling recovery.
- `runs/*` is the primary operator flow: create, inspect, stop, delete, list retained games, fetch replays, and launch live test games.
- `snapshots/*`, `simulations/*`, `training/*`, `/loss`, and `/participants` are still exposed for compatibility and focused tooling even though the main workbench is run-oriented now.

## Response Expectations
- Keep `Cache-Control: no-store` on live status, retained game list, and replay endpoints. The workbench expects fresh run state.
- Preserve runtime-provided `statusCode`, `code`, `details`, and `activeRuns` fields when present. `public/ml-admin.js` uses them for operator feedback.
- Replay payloads must stay compatible with `public/js/modules/mlAdmin/replay.js` and the god-view board renderer.
- `GET /runs/:runId/games` now defaults to evaluation rows but also accepts `replayType=simulation` for retained self-play games. Generation filters should remain evaluation-only.

## Editing Guidance
- If you add or rename a runtime method, update this router, `public/ml-admin.js`, and `tests/mlRoutes.test.js` together.
- If you change retained replay metadata or live progress payload shape, also update `src/socket.js` and the ML admin modules.
- Continuous runs are the main user workflow, but do not casually remove the older snapshot/simulation/training endpoints. They still back tests, compatibility flows, and lower-level debugging.
