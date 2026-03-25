# ML Hardware Optimizations

This document consolidates the repository's ML hardware and throughput optimization work. It mixes current implementation details with the dated evidence captured in the ML ExecPlans, and it calls out where the historical docs and the current code diverge.

## Scope

This inventory is built from:

- `src/services/ml/runtime.js`
- `src/services/ml/modeling.js`
- `src/services/ml/network.js`
- `src/services/ml/gameRunner.js`
- `src/services/ml/parallelTaskWorker.js`
- `src/services/ml/pythonTrainingBridge.js`
- `ml_backend/torch_training_bridge.py`
- `public/ml-admin.js`
- `src/services/ml/AGENTS.md`
- `ml_backend/AGENTS.md`
- `docs/ml-gpu-training-execplan.md`
- `docs/ml-persistent-gpu-training-execplan.md`
- `docs/ml-parallel-runtime-execplan.md`
- `docs/ml-throughput-fast-path-execplan.md`
- `docs/ml-max-utilization-throughput-execplan.md`
- `docs/ml-concurrent-selfplay-training-execplan.md`
- `docs/ml-shared-encoder-belief-ismcts-execplan.md`
- `tests/mlRuntime.test.js`
- `tests/mlRoutes.test.js`
- `tests/mlSharedEncoderModel.test.js`
- `tests/mlEngineNetworkOptimization.test.js`
- `tests/mlRuntimePersistence.test.js`

The relevant work landed mostly between 2026-03-10 and 2026-03-16.

## Executive Summary

The current ML pipeline has two main hardware stories:

1. CPU-heavy self-play, search, evaluation, and live inference stay in Node and are optimized with worker-thread parallelism plus several search/inference fast paths.
2. Training can move to a persistent Python/Torch backend that prefers CUDA when available and otherwise uses Python CPU threading. The best current path is persistent shared-family training sessions with fused policy/value/belief updates, AMP/autocast on CUDA, optional `torch.compile`, and hardware-aware batch sizing.

The pipeline is not "GPU end to end". GPU acceleration is currently training-only. Search, self-play, evaluation, retained replay generation, and live test games still run through the Node CPU path.

## Current Shipped Optimization Inventory

### 1. Real CPU parallelism for self-play and evaluation

What exists now:

- Self-play and evaluation games can run in parallel on Node worker threads.
- The runtime uses a persistent `ParallelTaskPool` instead of creating a fresh worker batch for every call.
- Worker payloads are structured-clone-safe and centered on whole-game tasks.
- Bulk workloads use the engine-only fast path instead of the live-route path where possible.

Where it lives:

- `src/services/ml/runtime.js`
- `src/services/ml/parallelTaskWorker.js`
- `src/services/ml/gameRunner.js`

Important details:

- `parallelGameWorkers` is the explicit game concurrency knob.
- `numSelfplayWorkers` is games-per-cycle, not thread count.
- Timed-out parallel game batches can fall back to sequential retry instead of wedging the run.
- Evaluation still shares the same CPU worker pool as self-play.

Historical evidence:

- `docs/ml-parallel-runtime-execplan.md` recorded a fixed 32-game benchmark improving from about `609s` at `1` worker to about `118s` at `16` workers on the local workstation.

### 2. CPU headroom policy instead of all-core default saturation

What exists now:

- Default ML CPU budgets intentionally reserve headroom for the browser and the rest of the machine.
- The Python bridge also inherits that same headroom policy for Torch CPU thread counts.

Where it lives:

- `src/services/ml/runtime.js`
- `src/services/ml/pythonTrainingBridge.js`
- `ml_backend/torch_training_bridge.py`

Current code behavior:

- `defaultMaxLogicalProcessors()` subtracts interactive headroom from `os.availableParallelism()`.
- Headroom policy:
  - `<= 2` CPUs: reserve `0`
  - `<= 4` CPUs: reserve `1`
  - otherwise: reserve `max(2, ceil(25% of CPUs))`, capped below full CPU count
- `parallelGameWorkers` defaults to `maxLogicalProcessors`.
- `numSelfplayWorkers` defaults to `parallelGameWorkers * 2`, clamped to `8..128`.
- Python bridge startup exports:
  - `ML_TRAINING_TORCH_THREADS`
  - `ML_TRAINING_TORCH_INTEROP_THREADS`
- Per-run training can further clamp Torch CPU threads through `maxLogicalProcessors`.

This is a responsiveness optimization, not just a throughput optimization.

### 3. Engine-only fast path for bulk ML games

What exists now:

- Continuous runs, simulation batches, and worker-thread game tasks use `gameRunner.js` instead of the slower live-route game path.
- `runSingleGame()` still exists for parity-sensitive live/test scenarios, but high-volume ML paths avoid it.

Where it lives:

- `src/services/ml/gameRunner.js`
- `src/services/ml/runtime.js`

Why it matters for hardware:

- It lowers per-game CPU overhead.
- It makes worker threads more productive because they spend more time in search/game logic and less time in route/game wrapper setup.

Historical evidence:

- `docs/ml-throughput-fast-path-execplan.md` records this change as the main bulk-path optimization before the later GPU/session work.

### 4. Search and inference hot-path optimization on CPU

What exists now:

- Shared-tree ISMCTS replaced more wasteful per-hypothesis search behavior.
- Encoded-state caches, numeric hashing, and reused search state reduce rebuild work.
- Search can preserve mutable encoded state across plies.
- Undo traversal is used adaptively for longer-history searches.
- Network forward paths use compiled typed-array caches.
- Scalar batch-forward paths reduce policy/value overhead.
- Action feature extraction uses numeric move metadata instead of repeated square-object lookups.

Where it lives:

- `src/services/ml/mcts.js`
- `src/services/ml/stateEncoding.js`
- `src/services/ml/network.js`
- `src/services/ml/gameRunner.js`
- `src/services/ml/engine.js`

Why it matters for hardware:

- These changes are not direct hardware offload, but they are the core CPU-throughput work that lets the available cores do more useful simulations per second.

Historical evidence:

- `docs/ml-throughput-fast-path-execplan.md` records multiple measured drops in search and inference latency, including lower `predictPolicy()` and `runHiddenInfoMcts()` spot-check times after the network/search hot-path passes.

### 5. Optional Python/Torch training backend with CUDA support

What exists now:

- Training can resolve to:
  - `node`
  - `python` + `cpu`
  - `python` + `cuda`
  - `auto`
- `auto` prefers the Python bridge whenever it is available, using CUDA when available and Python CPU otherwise.
- Node is fallback only when the Python bridge is unavailable or explicitly requested.

Where it lives:

- `src/services/ml/runtime.js`
- `src/services/ml/pythonTrainingBridge.js`
- `ml_backend/torch_training_bridge.py`

Important details:

- The Python bridge is long-lived and JSON-line based over stdin/stdout.
- The handshake reports:
  - `cudaAvailable`
  - `cudaDeviceCount`
  - `cudaDeviceName`
  - `cudaTotalMemoryMb`
  - `cpuCount`
  - `torchNumThreads`
  - `torchNumInteropThreads`
  - `pythonVersion`
- CUDA is only used for training.
- Returned checkpoints stay compatible with Node inference.

Historical evidence:

- `docs/ml-gpu-training-execplan.md` records the local venv upgrade to `torch 2.8.0+cu128` and the bridge handshake validating `NVIDIA GeForce RTX 2080`.

### 6. Persistent Python training sessions for the active shared-family path

What exists now:

- Shared-family training can use persistent Python sessions via `train_session_batch`.
- The session keeps model weights, optimizer state, and CUDA-resident state inside Python across steps.
- Node only exports session state when it needs a checkpoint, a save, a shutdown flush, or a final result.

Where it lives:

- `src/services/ml/runtime.js`
- `src/services/ml/pythonTrainingBridge.js`
- `ml_backend/torch_training_bridge.py`

Why it matters for hardware:

- It removes repeated model reconstruction and optimizer reconstruction overhead.
- It stops paying repeated host-to-device setup costs on every step.
- It keeps the active trainer warm on GPU.

Historical evidence:

- `docs/ml-persistent-gpu-training-execplan.md` records this as the current-best training transport for the shared-family models.

### 7. Fused shared-family training instead of separate head passes

What exists now:

- Shared-family training batches are assembled as combined `sharedSamples`.
- One training step can contribute policy, value, and identity losses from the same state-centric batch.
- The encoder forward/backward pass is shared.

Where it lives:

- `src/services/ml/runtime.js`
- `src/services/ml/gameRunner.js`
- `ml_backend/torch_training_bridge.py`

Why it matters for hardware:

- Lower payload duplication across the bridge.
- Fewer repeated forwards through the encoder.
- Better GPU utilization than three separate per-head steps.

Historical evidence:

- `docs/ml-persistent-gpu-training-execplan.md` and `docs/ml-shared-encoder-belief-ismcts-execplan.md`.

### 8. CUDA-specific training features: AMP, autocast, pinned memory, optional compile

What exists now:

- CUDA sessions enable:
  - AMP/autocast
  - GradScaler
  - optional `torch.compile(..., mode='reduce-overhead')`
  - pinned host tensors for batch data
  - non-blocking copies to device
- The Python bridge disables compile automatically if a compile-runtime error is detected.

Where it lives:

- `ml_backend/torch_training_bridge.py`
- `src/services/ml/runtime.js`

Important details:

- `enableAmp` and `enableCompile` are runtime-controlled and default to enabled for CUDA.
- Pinned memory is only used when the resolved training device is CUDA.
- `torch.set_float32_matmul_precision('high')` is configured when available.

### 9. Hardware-aware batch-size and training-step heuristics

What exists now:

- If batch size is not explicitly requested, the runtime picks a recommendation based on backend and hardware.
- Training density also scales based on backend/device.

Where it lives:

- `src/services/ml/runtime.js`

Current code behavior:

- Node CPU default batch size baseline: `256`
- Python CPU recommendation:
  - `1024` for `>= 24` logical processors
  - `768` for `>= 12`
  - `512` for `>= 8`
  - otherwise `256`
- CUDA recommendation by VRAM:
  - `>= 20 GB`: `2048`
  - `>= 12 GB`: `1536`
  - `>= 8 GB`: `1024`
  - `>= 4 GB`: `512`
  - otherwise `256`
- Training steps per cycle:
  - CPU: `32`
  - CUDA `>= 4 GB`: `48`
  - CUDA `>= 12 GB`: `64`

These are recommendations, not hard requirements. Explicit user-supplied values can override them within runtime clamps.

### 10. Concurrent CPU self-play with Python/CUDA background training

What exists now:

- One continuous run can overlap:
  - CPU self-play in the foreground
  - Python/CUDA training in the background
- This is only enabled when the resolved profile is `python` + `cuda`.
- Evaluation remains serialized because it needs the same CPU game-worker pool as self-play.

Where it lives:

- `src/services/ml/runtime.js`
- `public/ml-admin.js`

Important details:

- Background training writes against `run.working.modelBundle`.
- Self-play continues using `workerGeneration`, so it does not read half-trained weights.
- Pending checkpoint evaluation is persisted in `run.working.pendingEvaluation`.
- Live payloads include `trainingProgress` so the admin UI can show overlapping phases.

Historical evidence:

- `docs/ml-concurrent-selfplay-training-execplan.md`.

### 11. Resource telemetry and operator visibility

What exists now:

- CPU and GPU usage are sampled every `2000ms`.
- The UI keeps a rolling `10` minute history.
- GPU usage is best-effort and comes from `nvidia-smi` when available.

Where it lives:

- `src/services/ml/runtime.js`
- `public/ml-admin.js`

Important details:

- CPU telemetry is system-wide usage computed from `os.cpus()` deltas.
- GPU telemetry records the hottest visible GPU percentage from `nvidia-smi`.
- Payload shape includes:
  - `sampleIntervalMs`
  - `windowMs`
  - `cpu.currentPercent`
  - `cpu.history`
  - `gpu.currentPercent`
  - `gpu.history`
  - `gpu.label`

This is observability, but it is also part of the hardware optimization story because it is how the operator sees whether CPU/GPU changes are actually taking effect.

### 12. Timeout, restart, and failure-fast behavior for long hardware-bound work

What exists now:

- Python bridge requests are time-bounded.
- Timeouts restart the bridge child instead of leaving the runtime hung.
- Worker-thread tasks also have bounded timeouts.
- Killed runs reset the shared worker pool so CPU work does not silently keep draining in the background.

Where it lives:

- `src/services/ml/pythonTrainingBridge.js`
- `src/services/ml/runtime.js`

Important details:

- Bridge handshake timeout: `15000ms`
- Default bridge request timeout: `60000ms`
- Train-batch timeout budget scales with epochs and sample count.
- Worker-task timeout budgets scale with expected play-game cost.

These are reliability optimizations more than speed optimizations, but they matter for real hardware utilization because wedged workers or bridge calls otherwise pin the pipeline in a bad state.

## Historical Timeline

### 2026-03-10 to 2026-03-11

- Rebuilt the ML runtime/admin workbench around stronger modeling, route-backed simulation, and restart-safe jobs.
- This established the base pipeline that later hardware work optimized.

Primary docs:

- `docs/ml-runtime-rebuild-execplan.md`
- `docs/ml-continuous-run-pipeline-execplan.md`

### 2026-03-12

- Added real worker-thread concurrency for self-play and evaluation.
- Added the first Python/Torch training bridge with optional CUDA.
- Verified Python-trained checkpoints still run under Node CPU inference.

Primary docs:

- `docs/ml-parallel-runtime-execplan.md`
- `docs/ml-gpu-training-execplan.md`

### 2026-03-13

- Added the engine-only fast path for bulk ML games.
- Reworked search/inference hot paths and worker reuse.

Primary docs:

- `docs/ml-throughput-fast-path-execplan.md`

### 2026-03-14

- Migrated the published model family to the shared encoder / belief / fixed-vocabulary path.
- Added hardware-aware defaults, Python CPU preference from `auto`, and timeout/watchdog coverage.
- Recorded explicit throughput and utilization tuning for future runs.

Primary docs:

- `docs/ml-shared-encoder-belief-ismcts-execplan.md`
- `docs/ml-max-utilization-throughput-execplan.md`

### 2026-03-15

- Rebalanced defaults around local responsiveness.
- Added selectable parameter-budget presets and CPU headroom policy.

Primary docs:

- `docs/ml-shared-encoder-belief-ismcts-execplan.md`
- `docs/ml-max-utilization-throughput-execplan.md`

### 2026-03-16

- Added persistent Python training sessions, fused shared-family training, and background overlap between CPU self-play and GPU training.

Primary docs:

- `docs/ml-persistent-gpu-training-execplan.md`
- `docs/ml-concurrent-selfplay-training-execplan.md`

## Machine-Specific Evidence We Already Have

The ExecPlans include repeated measurements and environment probes from the local workstation used during this work.

Recorded hardware:

- CPU: `Intel(R) Core(TM) i9-9900K`
- Logical processors: `16`
- GPU: `NVIDIA GeForce RTX 2080`
- CUDA-reported memory: about `8191 MB`
- RAM note in plan history: about `34 GB`

Recorded bridge/handshake evidence:

- Python venv upgraded to `torch 2.8.0+cu128`
- `cudaAvailable: true`
- `cudaDeviceName: NVIDIA GeForce RTX 2080`
- `cpuCount: 16`
- `torchNumThreads: 16`
- `torchNumInteropThreads: 4`

Recorded benchmark/evidence highlights:

- Parallel game workers:
  - about `609s` for a fixed 32-game batch at `1` worker
  - about `118s` at `16` workers
- Search/inference spot checks improved repeatedly during the fast-path pass.
- Direct run-defaults probe historically reported tuned values such as `batchSize: 1024` and `trainingStepsPerCycle: 48` on the local CUDA machine.

These measurements are historical evidence captured in the plans. They are not automatically revalidated each boot.

## High-Signal Tests Covering This Area

- `tests/mlRuntime.test.js`
  - run defaults
  - background training overlap
  - workbench live payloads
  - bootstrap preference behavior
- `tests/mlRoutes.test.js`
  - workbench and live resource-telemetry payloads
- `tests/mlSharedEncoderModel.test.js`
  - preset inventory
  - shared-family training batch behavior
- `tests/mlEngineNetworkOptimization.test.js`
  - search/inference optimization regressions
- `tests/mlRuntimePersistence.test.js`
  - save/resume behavior around larger artifacts and runtime state

## Known Constraints And Open Issues

### Training is the only GPU-accelerated stage

- Search, self-play, evaluation, retained replay generation, and live test games still run in Node on CPU.
- Python/Torch is a trainer backend, not the inference/search runtime.

### Evaluation is still serialized against self-play

- Background overlap exists for self-play plus Python/CUDA training.
- Evaluation stays in the foreground because it competes for the same game-worker pool as self-play.

### Many optimizations are intentionally "next run" optimizations

- Several ML notes explicitly treat throughput tuning as something that applies to newly started runs after restart/config refresh.
- The system is not designed to surgically retrofit every tuning change into an already running run.

### GPU telemetry is optional

- GPU visibility depends on `nvidia-smi`.
- If `nvidia-smi` is missing or inaccessible, GPU telemetry falls back to unavailable rather than hard failing the ML runtime.

### The old parallel head-training path is not the active best path anymore

- Historical plans added `parallelTrainingHeadWorkers` for the older independent-head architecture.
- Later work removed that as the surfaced active-path recommendation in favor of shared-family fused training in persistent Python sessions.

### There is a current docs-vs-code inconsistency around the default shared-model preset

Historical docs and tests say:

- the future-run default preset should be `65k`

Current code in this workspace says:

- `src/services/ml/runtime.js` sets `DEFAULT_RUN_MODEL_SIZE_PRESET = '32k'`
- `src/services/ml/modeling.js` sets `DEFAULT_SHARED_MODEL_SIZE_PRESET = '32k'`
- `public/ml-admin.js` also falls back to `32k` in several places

Current tests and docs say:

- `tests/mlRuntime.test.js` expects the default bundle and preferred bootstrap baseline to be `65k`
- `src/services/ml/AGENTS.md` says `65k` is the default future-run preset
- `docs/ml-shared-encoder-belief-ismcts-execplan.md` and `docs/ml-max-utilization-throughput-execplan.md` also say `65k`

This should be treated as an unresolved repository inconsistency until code, docs, and tests are reconciled.

## File Map

Use these files as the main entry points when touching hardware-related ML behavior:

- `src/services/ml/runtime.js`
  - run defaults
  - worker-pool scheduling
  - backend selection
  - telemetry
  - concurrent self-play/training
- `src/services/ml/pythonTrainingBridge.js`
  - Python process lifecycle
  - handshake
  - timeout/restart behavior
  - Torch thread environment
- `ml_backend/torch_training_bridge.py`
  - device selection
  - Torch runtime config
  - AMP/autocast
  - compile
  - pinned memory
  - persistent shared-family sessions
- `src/services/ml/gameRunner.js`
  - fast bulk self-play/evaluation path
  - training sample extraction
- `src/services/ml/parallelTaskWorker.js`
  - worker-thread task execution
- `src/services/ml/network.js`
  - compiled forward caches and batch/scalar fast paths
- `public/ml-admin.js`
  - operator-facing defaults
  - resource telemetry UI
  - hardware-related help text

## Bottom Line

The repository already has a substantial hardware-optimization stack for ML:

- CPU parallelism for games
- CPU search/inference fast paths
- optional Python/CUDA training
- persistent CUDA trainer sessions
- fused shared-family batches
- AMP/autocast, optional compile, and pinned memory
- hardware-aware defaults and CPU headroom
- overlapping CPU self-play with GPU training
- live telemetry and failure-fast watchdogs

The main unresolved issue is not whether hardware optimization exists. It does. The main unresolved issue is alignment: the plans/tests/docs currently describe a `65k` default shared-model preset, while the live code in this workspace still defaults to `32k`.
