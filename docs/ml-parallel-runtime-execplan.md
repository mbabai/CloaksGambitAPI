# Add Real Parallelism To ML Self-Play And Head Training

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](../PLANS.md).

## Purpose / Big Picture

After this change, the Cloak's Gambit ML pipeline will use real worker-thread concurrency for self-play and evaluation games instead of looping through `await this.runSingleGame(...)` one game at a time. The runtime will also be able to train the independent policy, value, and identity heads in parallel when configured to do so. A human should be able to see the improvement by starting a run from the ML workbench, observing new concurrency settings in the UI, and running focused Jest coverage that proves the new configuration is accepted and the continuous-run path still completes successfully.

## Progress

- [x] (2026-03-12 16:42 -07:00) Inspected the ML runtime, training stack, and hardware path to confirm the current bottleneck and the feasible forms of parallelism.
- [x] (2026-03-12 16:53 -07:00) Verified that the current continuous-run path is sequential because `playRunGenerationGames()` loops over `await this.runSingleGame(...)`.
- [x] (2026-03-12 16:58 -07:00) Verified that the current ML stack is plain JavaScript MLP code with no TensorFlow or CUDA backend, so the RTX 2080 cannot be used without swapping training libraries.
- [x] (2026-03-12 17:18 -07:00) Implemented `src/services/ml/parallelTaskWorker.js` and runtime worker-pool helpers for whole-game execution and optional per-head training tasks.
- [x] (2026-03-12 17:31 -07:00) Threaded `parallelGameWorkers` and `parallelTrainingHeadWorkers` through run config normalization, the continuous-run loop, and the ML admin workbench UI.
- [x] (2026-03-12 17:39 -07:00) Added focused regression coverage for parallel game workers, parallel head training, and the expanded workbench defaults.
- [x] (2026-03-12 17:41 -07:00) Ran the focused Jest suites and confirmed the new concurrency paths pass.
- [x] (2026-03-12 18:11 -07:00) Ran a controlled post-change 32-game benchmark with fixed seeds and measured scaling through the machine's 16 logical CPUs.

## Surprises & Discoveries

- Observation: `numSelfplayWorkers` is currently only "games per cycle" and not true concurrency.
  Evidence: `src/services/ml/runtime.js` calls `playRunGenerationGames()` from `runContinuousPipeline()`, and `playRunGenerationGames()` advances through the batch with `await this.runSingleGame(...)` inside a `for` loop.

- Observation: the current training code can be parallelized by head without changing learning math because policy, value, and identity use separate networks and separate optimizer state.
  Evidence: `src/services/ml/modeling.js` defines three distinct networks and optimizer states, and `trainPolicyModel()`, `trainValueModel()`, and `trainIdentityModel()` update them independently.

- Observation: the GPU is not reachable from the current stack.
  Evidence: `package.json` has no TensorFlow or GPU runtime dependency, `src/services/ml/network.js` is a handwritten array-based MLP, and the local machine reports an `NVIDIA GeForce RTX 2080` that the code never targets.

- Observation: once real worker threads were added, the benchmark became stable across concurrency levels because the same seeded games completed with the same average plies and outcomes.
  Evidence: the controlled benchmark returned `averagePlies: 49.781`, `draws: 29`, `whiteWins: 3`, and `blackWins: 0` for every tested worker setting.

- Observation: throughput continued improving up to the machine's 16 logical CPUs, after which higher requested values were clamped to 16.
  Evidence: the runtime now defaults to `parallelGameWorkers: 16` on this machine, and `normalizeRunConfig({ parallelGameWorkers: 32 })` also returned `16`.

## Decision Log

- Decision: use Node worker threads rather than child processes for parallel game execution and head training.
  Rationale: worker threads are lighter weight, the tasks exchange only plain serializable objects, and the runtime already runs in Node 24.
  Date/Author: 2026-03-12 / Codex

- Decision: keep the GPU discussion explicit but out of scope for this implementation.
  Rationale: the current handwritten JavaScript MLP stack cannot use CUDA; wiring GPU support would require a backend replacement rather than a runtime-level parallelism patch.
  Date/Author: 2026-03-12 / Codex

- Decision: add new configuration fields instead of overloading `numSelfplayWorkers`.
  Rationale: `numSelfplayWorkers` already means "games per cycle" in persisted runs and UI labels, so a separate concurrency knob avoids silent behavioral drift.
  Date/Author: 2026-03-12 / Codex

## Outcomes & Retrospective

The runtime now has real worker-thread parallelism for self-play and evaluation, plus an optional worker-thread path for the independent policy, value, and identity training heads. The ML workbench exposes both controls explicitly. On this i9-9900K machine, a fixed 32-game batch at current default self-play settings improved from about `609s` with one game worker to about `118s` with 16 game workers, a little over `5.1x` throughput improvement. GPU training remains a separate phase because the current handwritten JavaScript network stack still cannot target CUDA.

## Context and Orientation

The continuous-run pipeline lives in `src/services/ml/runtime.js`. That file owns run configuration, self-play/evaluation scheduling, replay buffering, training, promotion, and ML workbench payloads. The model and optimizer code lives in `src/services/ml/modeling.js` and `src/services/ml/network.js`. The ML admin workbench is rendered by `public/ml-admin.html` and `public/ml-admin.js`. Route passthrough coverage is in `tests/mlRoutes.test.js`, and continuous-run integration coverage is in `tests/mlRuntime.test.js`.

In this plan, "game worker" means one Node worker thread that executes one full self-play or evaluation game and returns the completed replay and training samples. "Training head worker" means one Node worker thread that trains exactly one of the three independent heads: policy, value, or identity.

## Plan of Work

Add a worker-thread entrypoint under `src/services/ml/` that can execute a game task or a training-head task based on the incoming message. For game tasks, the worker should instantiate its own `MlRuntime` with persistence disabled and call `runSingleGame()`. For training-head tasks, the worker should run the existing training function for the requested head and return the updated network state, optimizer state, and loss metrics.

Then update `src/services/ml/runtime.js`. Add new run config fields for game concurrency and training-head concurrency, normalize them with hardware-aware defaults, and use them in the continuous-run loop. Replace the sequential `playRunGenerationGames()` loop with a worker-pool scheduler that fans out independent game tasks and returns them in the same format as today. Update training so it can either stay sequential or dispatch independent head-training tasks in parallel and merge the returned model and optimizer state back into the working bundle.

After that, update `public/ml-admin.html` and `public/ml-admin.js` so the new settings are visible, editable, and included in the workbench defaults and run-start payload. Keep the old `numSelfplayWorkers` label semantics as "games per cycle."

Finally, add focused Jest coverage in `tests/mlRuntime.test.js` and `tests/mlRoutes.test.js` for the new configuration surface, then rerun the high-signal ML tests.

## Milestones

The first milestone is real parallel game execution. At the end of that milestone, self-play and evaluation batches no longer execute as a simple sequential `for` loop. The proof is a focused runtime test that still completes continuous runs successfully with a `parallelGameWorkers` setting above 1.

The second milestone is optional parallel head training. At the end of that milestone, the runtime can dispatch policy, value, and identity training to separate worker threads when configured to do so. The proof is that the continuous-run path and workbench defaults still pass their regression tests.

The third milestone is operator control. At the end of that milestone, the ML workbench exposes the new concurrency settings with accurate help text, so someone starting a run can control how many CPU workers are used for games and for head training.

## Concrete Steps

Work from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

1. Add this ExecPlan and keep it current while the implementation proceeds.
2. Create a worker-thread task module under `src/services/ml/`.
3. Edit `src/services/ml/runtime.js` to add concurrency defaults, worker-pool scheduling, and optional parallel head training.
4. Edit `public/ml-admin.html` and `public/ml-admin.js` to expose the new settings.
5. Extend `tests/mlRuntime.test.js` and `tests/mlRoutes.test.js` with focused assertions for the new configuration surface.
6. Run the targeted Jest commands listed below and capture the results in this file.

## Validation and Acceptance

Run:

  npm.cmd test -- tests/mlRoutes.test.js

and expect the ML route suite to pass with the new fields appearing in default payloads or forwarded run-start payloads where relevant. Then run:

  $env:ENABLE_ML_WORKFLOW='true'
  node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="continuous runs promote|run workbench surfaces defaults|evaluation promotes only against the current best generation"

and expect the focused continuous-run tests to pass after the parallelism changes. Acceptance is that runs still complete, the defaults expose the new concurrency knobs, and the runtime can execute game batches without relying on the old sequential loop.

## Idempotence and Recovery

These changes should be additive. If a worker-thread path fails, keep the fallback sequential path available until the tests pass so the runtime remains usable. If a focused test fails mid-implementation, rerun only that slice while preserving the in-progress code and this plan.

## Artifacts and Notes

Initial evidence before implementation:

  - CPU: `Intel(R) Core(TM) i9-9900K`, 8 physical cores, 16 logical processors.
  - RAM: about 34 GB total physical memory.
  - GPU: `NVIDIA GeForce RTX 2080`, but unused by the current plain-JS MLP stack.
  - Controlled benchmark before true worker threads: the current one-process overlap experiment improved somewhat up to roughly 8 concurrent games but remained noisy because it was not real multicore self-play.

Validation evidence after implementation:

  - `npm.cmd test -- tests/mlRoutes.test.js` passed with 6 tests.
  - Focused `tests/mlRuntime.test.js` slice passed for continuous runs, workbench defaults, current-best promotion, parallel game workers, and parallel training-head workers.
  - Controlled 32-game benchmark at current default self-play settings:
    - `1` game worker: `609.307s`, `3.151` games/minute.
    - `2` game workers: `304.184s`, `6.312` games/minute.
    - `4` game workers: `182.001s`, `10.549` games/minute.
    - `8` game workers: `128.705s`, `14.918` games/minute.
    - `16` game workers: `117.998s`, `16.271` games/minute.
    - Requested `32` workers normalized to `16` on this machine and produced the same saturation region.

## Interfaces and Dependencies

At the end of this task, `src/services/ml/runtime.js` must still expose `MlRuntime`, `getMlRuntime()`, and the continuous-run methods that the routes already call. The new worker-thread module must accept serializable task payloads and return serializable results so it can be used by both game execution and head-training tasks. The run config must gain explicit fields for game concurrency and training-head concurrency, and the ML workbench must include matching form controls.

Revision note (2026-03-12 / Codex): created this ExecPlan after confirming that the current pipeline is sequential for games, that head training is structurally independent, and that GPU acceleration is out of scope for the current handwritten JavaScript network stack.
Revision note (2026-03-12 / Codex): updated this ExecPlan after implementation to record the completed worker-thread game and training changes, the new workbench settings, the passing focused tests, and the post-change benchmark that justified using the machine's full logical parallelism as the default game-worker count.
