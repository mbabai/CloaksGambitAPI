# ML Service Notes

## What Lives Here
- `runtime.js`: singleton coordinator for continuous runs, legacy snapshots/simulations/training jobs, replay retention, persistence, and admin payloads.
- `engine.js`: ML-oriented rules/state implementation used for hidden-information reasoning and training features.
- `stateEncoding.js`: encoded-state caches, hashing, and move-template helpers used to keep search fast.
- `mcts.js`: determinized and hidden-information MCTS on top of `engine.js`, `stateEncoding.js`, and `modeling.js`.
- `modeling.js` and `network.js`: JSON-safe policy/value/identity model bundle, feature extraction, pure Node training math, and optimizer helpers.
- `pythonTrainingBridge.js` and `mlDebugLogger.js`: optional persistent Torch bridge plus debug logging for Python training.
- `parallelTaskWorker.js`: worker-thread entrypoint for parallel self-play/evaluation games and optional parallel head training.
- `builtinBots.js`: built-in non-ML opponents that can still participate in simulations or tests.

## Pipeline Shape
1. `src/routes/v1/ml/index.js` calls `getMlRuntime()` and routes admin requests into `runtime.js`.
2. `runtime.js` loads or resumes state from `data/ml/runtime.json`, with simulation/training mirrors in MongoDB when available.
3. Self-play and evaluation games are created through the live route stack using internal sessions. The live routes are authoritative; the ML engine stays in sync as a search/training shadow state.
4. `mcts.js` uses `modeling.js` predictions over `engine.js` states, with `stateEncoding.js` providing caches and hashes.
5. Training either stays in Node or is sent through `pythonTrainingBridge.js`. Both paths must round-trip the same JSON model bundle shape.
6. Live status is emitted on `eventBus` and forwarded to `/admin` by `src/socket.js`.

## Core Invariants
- Live game routes are authoritative for simulated gameplay. If rules change in `src/routes/v1/gameAction/`, update `engine.js`, `modeling.js`, and the ML tests in the same edit.
- Model bundle shape changes must stay aligned across `modeling.js`, `network.js`, `runtime.js`, `parallelTaskWorker.js`, and `ml_backend/torch_training_bridge.py`.
- Python training is only a trainer backend. Returned checkpoints still have to load into Node for inference, self-play, evaluation, and live test games.
- Worker payloads and results must stay structured-clone-safe. Do not pass functions, class instances, or live Mongoose documents into `parallelTaskWorker.js`.
- `runtime.js` should keep backward compatibility with older `data/ml/runtime.json` files unless an explicit migration is added and documented.

## Validation
- `tests/mlRoutes.test.js`: admin API contract.
- `tests/mlRuntime.test.js`: continuous runs, promotions, replay retention, and compatibility helpers.
- `tests/mlRuntimePersistence.test.js`: file-backed save/resume behavior.
- `tests/mlStateEncoding.test.js`: encoded-state and hashing regressions.
- `tests/mlFeatureGate.test.js`: `ENABLE_ML_WORKFLOW` behavior.
