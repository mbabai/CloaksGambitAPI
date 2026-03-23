# ML Service Notes

## What Lives Here
- `runtime.js`: singleton coordinator for continuous runs, legacy snapshots/simulations/training jobs, replay retention, persistence, and admin payloads.
- `engine.js`: ML-oriented rules/state implementation used for hidden-information reasoning and training features.
- `stateEncoding.js`: encoded-state caches, hashing, and move-template helpers used to keep search fast.
- `mcts.js`: determinized search plus shared-tree ISMCTS on top of `engine.js`, `stateEncoding.js`, and `modeling.js`.
- `modeling.js` and `network.js`: JSON-safe policy/value/identity model bundle, feature extraction, pure Node training math, and optimizer helpers.
- `pythonTrainingBridge.js` and `mlDebugLogger.js`: persistent Torch bridge/session transport plus debug logging for Python training.
- `gameRunner.js`: engine-only fast runner used by bulk self-play, evaluation, and snapshot simulation paths.
- `parallelTaskWorker.js`: worker-thread entrypoint for persistent pooled self-play/evaluation games and compatibility worker tasks that still need structured-clone execution.
- `builtinBots.js`: built-in non-ML opponents that can still participate in simulations or tests.

## Pipeline Shape
1. `src/routes/v1/ml/index.js` calls `getMlRuntime()` and routes admin requests into `runtime.js`.
2. `runtime.js` loads or resumes state from `data/ml/runtime.json`, with simulation/training mirrors in MongoDB when available.
3. Bulk self-play, evaluation, and snapshot simulations use the engine-only runner in `gameRunner.js`; live test games still use the route stack for parity/debugging.
4. `mcts.js` uses shared-tree ISMCTS keyed by information state, while `modeling.js` and `stateEncoding.js` provide cached features and hashes.
5. Training either stays in Node or is sent through `pythonTrainingBridge.js`. `trainingBackend: auto` now prefers the Python bridge whenever it is available, using CUDA when present and Python CPU otherwise; Node is the fallback only when the bridge is unavailable or explicitly requested.
6. The current best shared-family path is a persistent Python trainer session. Continuous runs, snapshot training, and background training jobs keep the shared encoder plus optimizer state resident in the Python process and send combined `sharedSamples` batches instead of three duplicated per-head sample arrays. Runtime state is only exported back into Node when a checkpoint, save, shutdown, or final result actually needs it.
7. The Python/Torch shared-family trainer now performs one fused policy/value/belief step per batch under AMP/autocast on CUDA, with optional `torch.compile` on the resident modules.
8. Live status is emitted on `eventBus` and forwarded to `/admin` by `src/socket.js`.
9. New shared-family runs now choose a fixed published IO contract plus a selectable hidden-size preset via `config.modelSizePreset`. Current presets are `32k`, `65k`, `126k`, `256k`, and `512k`, with `65k` as the default future-run preset.
10. Continuous runs now overlap CPU self-play with Python/CUDA background training when that backend is available. Checkpoint evaluation is still serialized in the foreground loop because it uses the same game-worker pool as self-play.
11. Continuous-run self-play can now bias its engine-fast starting states through a 4D curriculum (`config.curriculumCadence`). The curriculum is self-play-only; evaluation, snapshot simulation, and live test games should continue to use the normal full-setup fast-start unless explicitly changed.

## Core Invariants
- Live game routes are authoritative for parity-sensitive gameplay. If rules change in `src/routes/v1/gameAction/`, update `engine.js`, `gameRunner.js`, `modeling.js`, and the ML tests in the same edit.
- Model bundle shape changes must stay aligned across `modeling.js`, `network.js`, `runtime.js`, `parallelTaskWorker.js`, and `ml_backend/torch_training_bridge.py`.
- Shared-family model-size presets may change hidden widths, but they must not change the published state-input slots, fixed policy vocabulary, or fixed belief-slot ordering once the family is published.
- Python training is only a trainer backend. Returned checkpoints still have to load into Node for inference, self-play, evaluation, and live test games.
- Persistent Python trainer sessions are the active training transport for shared-family models. If you change batch payloads or optimizer export semantics, update both `src/services/ml/runtime.js` and `ml_backend/torch_training_bridge.py`, and keep clean-shutdown export/resume behavior working.
- Shared-family replay sampling now carries a per-decision `sampleKey` so policy/value/identity rows can be recombined into a single batch shape without timestamp heuristics. Preserve that key when reshaping or filtering training data.
- Long-running bridge requests and worker-thread tasks are now expected to fail fast on timeout instead of hanging indefinitely. If you add a new worker task type or bridge command, give it a bounded timeout path in `runtime.js` or `pythonTrainingBridge.js`.
- Continuous runs now expose two operator stop modes in the admin workbench: `Stop Run` is cooperative and waits for the current phase boundary, while `Kill Run` immediately marks the run `stopped` with `stopReason: manual_kill`, drops the active task slot, resets the shared run-worker pool, and may discard in-flight unsaved work. Any late pipeline completion or failure for a killed task must be ignored rather than rewriting the killed run state.
- Worker payloads and results must stay structured-clone-safe. Do not pass functions, class instances, or live Mongoose documents into `parallelTaskWorker.js`.
- ISMCTS nodes may cache only information-state data plus aggregate action stats. Do not attach determinized hidden-state payloads to tree nodes.
- `runtime.js` should keep backward compatibility with older `data/ml/runtime.json` files unless an explicit migration is added and documented.
- Normal server shutdown now calls `flushForShutdown()` before process exit. A clean stop should therefore preserve active continuous runs for restart/resume, while hard kills still only recover from the last completed periodic save/checkpoint.
- Local responsiveness now matters as an explicit runtime constraint. Future-run default `parallelGameWorkers` and Torch CPU thread counts both reserve CPU headroom for the browser and the rest of the machine, and the admin UI batches live renders, throttles selected-run detail refreshes, and skips hidden-tab polling work. The old `parallelTrainingHeadWorkers` knob is no longer surfaced because the active shared-family path no longer trains independent heads in parallel worker threads.
- Performance work is scoped to the next run unless explicitly stated otherwise. Prefer landing optimizations that improve newly started runs after restart/config refresh, and do not spend time trying to retrofit already-running runs in place just to pick up a tuning change.

## Validation
- `tests/mlRoutes.test.js`: admin API contract.
- `tests/mlRuntime.test.js`: continuous runs, promotions, replay retention, and compatibility helpers.
- `tests/mlRuntimePersistence.test.js`: file-backed save/resume behavior.
- `tests/mlStateEncoding.test.js`: encoded-state and hashing regressions.
- `tests/mlFeatureGate.test.js`: `ENABLE_ML_WORKFLOW` behavior.
