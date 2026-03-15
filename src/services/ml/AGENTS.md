# ML Service Notes

## What Lives Here
- `runtime.js`: singleton coordinator for continuous runs, legacy snapshots/simulations/training jobs, replay retention, persistence, and admin payloads.
- `engine.js`: ML-oriented rules/state implementation used for hidden-information reasoning and training features.
- `stateEncoding.js`: encoded-state caches, hashing, and move-template helpers used to keep search fast.
- `mcts.js`: determinized search plus shared-tree ISMCTS on top of `engine.js`, `stateEncoding.js`, and `modeling.js`.
- `modeling.js` and `network.js`: JSON-safe policy/value/identity model bundle, feature extraction, pure Node training math, and optimizer helpers.
- `pythonTrainingBridge.js` and `mlDebugLogger.js`: optional persistent Torch bridge plus debug logging for Python training.
- `gameRunner.js`: engine-only fast runner used by bulk self-play, evaluation, and snapshot simulation paths.
- `parallelTaskWorker.js`: worker-thread entrypoint for persistent pooled self-play/evaluation games and optional parallel head training.
- `builtinBots.js`: built-in non-ML opponents that can still participate in simulations or tests.

## Pipeline Shape
1. `src/routes/v1/ml/index.js` calls `getMlRuntime()` and routes admin requests into `runtime.js`.
2. `runtime.js` loads or resumes state from `data/ml/runtime.json`, with simulation/training mirrors in MongoDB when available.
3. Bulk self-play, evaluation, and snapshot simulations use the engine-only runner in `gameRunner.js`; live test games still use the route stack for parity/debugging.
4. `mcts.js` uses shared-tree ISMCTS keyed by information state, while `modeling.js` and `stateEncoding.js` provide cached features and hashes.
5. Training either stays in Node or is sent through `pythonTrainingBridge.js`. `trainingBackend: auto` now prefers the Python bridge whenever it is available, using CUDA when present and Python CPU otherwise; Node is the fallback only when the bridge is unavailable or explicitly requested.
6. Live status is emitted on `eventBus` and forwarded to `/admin` by `src/socket.js`.

## Core Invariants
- Live game routes are authoritative for parity-sensitive gameplay. If rules change in `src/routes/v1/gameAction/`, update `engine.js`, `gameRunner.js`, `modeling.js`, and the ML tests in the same edit.
- Model bundle shape changes must stay aligned across `modeling.js`, `network.js`, `runtime.js`, `parallelTaskWorker.js`, and `ml_backend/torch_training_bridge.py`.
- Python training is only a trainer backend. Returned checkpoints still have to load into Node for inference, self-play, evaluation, and live test games.
- Long-running bridge requests and worker-thread tasks are now expected to fail fast on timeout instead of hanging indefinitely. If you add a new worker task type or bridge command, give it a bounded timeout path in `runtime.js` or `pythonTrainingBridge.js`.
- Continuous runs now expose two operator stop modes in the admin workbench: `Stop Run` is cooperative and waits for the current phase boundary, while `Kill Run` immediately marks the run `stopped` with `stopReason: manual_kill`, drops the active task slot, resets the shared run-worker pool, and may discard in-flight unsaved work. Any late pipeline completion or failure for a killed task must be ignored rather than rewriting the killed run state.
- Worker payloads and results must stay structured-clone-safe. Do not pass functions, class instances, or live Mongoose documents into `parallelTaskWorker.js`.
- ISMCTS nodes may cache only information-state data plus aggregate action stats. Do not attach determinized hidden-state payloads to tree nodes.
- `runtime.js` should keep backward compatibility with older `data/ml/runtime.json` files unless an explicit migration is added and documented.
- Normal server shutdown now calls `flushForShutdown()` before process exit. A clean stop should therefore preserve active continuous runs for restart/resume, while hard kills still only recover from the last completed periodic save/checkpoint.

## Validation
- `tests/mlRoutes.test.js`: admin API contract.
- `tests/mlRuntime.test.js`: continuous runs, promotions, replay retention, and compatibility helpers.
- `tests/mlRuntimePersistence.test.js`: file-backed save/resume behavior.
- `tests/mlStateEncoding.test.js`: encoded-state and hashing regressions.
- `tests/mlFeatureGate.test.js`: `ENABLE_ML_WORKFLOW` behavior.
