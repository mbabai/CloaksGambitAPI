# Service Notes

## What This Layer Owns
- `game/liveGameRules.js`: shared pending-move legality and resolution helpers for live HTTP routes.
- `matches/activeMatches.js`: normalizes active/history match payloads for APIs, spectating, and admin views.
- `history/summary.js`: derives match/game history summary data.
- `bots/`: bot user registration plus internal bot startup.
- `ml/`: continuous runs, legacy simulation/training helpers, replay tooling, search/modeling code, and optional Python/worker-thread acceleration.
- `guestCleanup.js`: scheduled deletion of stale guest users.

## Live Rules vs ML Rules
- The live game routes still own the authoritative HTTP state machine.
- The ML engine is a second implementation that is useful as a reference and for hidden-information search/state bookkeeping.
- `src/services/ml/runtime.js` directly imports several live route handlers. If you change request/response shapes or route behavior, inspect the ML runtime too.
- Route-backed ML self-play and evaluation still execute moves through the live route handlers; the ML engine is the shadow/search state, not the final authority.

## ML Service Notes
- `src/services/ml/runtime.js` is the coordinator for run lifecycle, replay retention, state persistence, and admin payloads.
- `src/services/ml/modeling.js`, `src/services/ml/network.js`, `src/services/ml/mcts.js`, and `src/services/ml/stateEncoding.js` are the core ML/search stack.
- `src/services/ml/pythonTrainingBridge.js` is the optional Torch path. Changes there must stay compatible with `ml_backend/torch_training_bridge.py` and the JSON bundle shape used by Node inference.
- `src/services/ml/parallelTaskWorker.js` is the worker-thread entrypoint for parallel game batches and optional parallel head training.

## Match and History Helpers
- `matches/activeMatches.js` exists because active matches, completed matches, and frontend payloads are not all shaped identically.
- The normalization logic is intentionally defensive around ids and score fields. Keep that flexibility unless you also simplify every caller.

## Bots
- `bots/registry.js` ensures durable bot users and creates auth tokens for them.
- `bots/internalBots.js` launches socket-connected internal bot clients after the server starts listening.
- Shared bot behavior lives under `shared/bots/`, not only here.

## Guest Cleanup
- `guestCleanup.js` deletes guest users whose `lastDisconnectedAt` is older than 24 hours.
- The cleanup now skips any guest record still referenced by a live or historical `Game`/`Match`, so active boards and history views keep stable player identities.
- Startup begins the cleanup loop only after the database connection succeeds.

## Change Discipline
- If you extract more route logic into services, preserve the existing tests or add new ones before deleting duplicated behavior from the routes.
- If you touch ML code, expect slower tests and check whether the change also affects live gameplay parity.
- If you change ML payloads or run config fields, update `src/routes/v1/ml/index.js`, `public/ml-admin.js`, and the ML Jest suites in the same change.
