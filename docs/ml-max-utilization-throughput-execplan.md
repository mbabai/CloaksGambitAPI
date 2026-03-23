# Maximize ML Run Utilization For Future Runs

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

The repository-level pointer to `.agent/PLANS.md` is currently stale in this workspace, so this plan follows the established ExecPlan structure already used under `docs/`.

## Purpose / Big Picture

After this change, future continuous ML runs should drive substantially higher hardware utilization without touching the currently active run. CPU-side self-play should stop underfeeding the worker pool, future runs should default to larger gradient batches, and newly created default models should be larger so CUDA work is less bursty. Bootstrap seeding should prefer a modern larger baseline for future runs while preserving historical snapshots and promoted generations.

## Progress

- [x] (2026-03-14 13:00 -07:00) Inspected the current runtime, training bridge, persisted run manifests, and workbench defaults to identify the actual utilization ceilings.
- [x] (2026-03-14 13:08 -07:00) Confirmed that a single run still alternates self-play and training in sequence, so average CPU/GPU overlap remains structurally limited even when each phase is improved.
- [x] (2026-03-14 13:13 -07:00) Confirmed that self-play is still chunked at a hard cap of four games, which prevents one run from using the configured parallel worker count.
- [x] (2026-03-14 13:19 -07:00) Confirmed that the active `run-0017` already uses aggressive self-play settings, but future bootstrap runs still inherit a legacy small bootstrap snapshot.
- [x] (2026-03-14 13:37 -07:00) Updated runtime scheduling and future-run defaults for higher throughput, including self-play chunk sizing that now scales to the configured game-worker count.
- [x] (2026-03-14 13:43 -07:00) Enlarged the default model architecture and added a preferred modern bootstrap baseline for future bootstrap-seeded runs.
- [x] (2026-03-14 13:55 -07:00) Updated workbench defaults/help text and extended focused runtime coverage for the larger default model and bootstrap upgrade path.
- [x] (2026-03-14 14:08 -07:00) Ran focused ML validation and recorded the results, including the existing open-handle caveat for the targeted runtime slice.
- [x] (2026-03-14 19:42 -07:00) Rechecked the shared-family runtime and confirmed the remaining utilization/stall risks were in auto-backend selection, snapshot/background-training batch sizing, the Python bridge thread cap, and missing bridge/worker timeouts.
- [x] (2026-03-14 20:18 -07:00) Changed `trainingBackend: auto` to prefer the Python bridge whenever it is available, using CUDA when present and Python CPU otherwise, and added hardware-aware future-run defaults for batch size and training-step density.
- [x] (2026-03-14 20:36 -07:00) Added explicit timeout/watchdog handling for persistent worker tasks and Python bridge requests so dead workers or dead bridge calls fail as errors instead of wedging a run forever.
- [x] (2026-03-14 20:49 -07:00) Fixed the snapshot-training bundle persistence bug and replaced the unsafe “full sample count” background-training batch sizing with the same hardware-aware batch selection used elsewhere.
- [x] (2026-03-14 21:02 -07:00) Re-ran focused runtime and route validation and captured a direct hardware/defaults probe from this machine for the final recorded behavior.
- [x] (2026-03-14 22:18 -07:00) Added a destructive `Kill Run` control that immediately retires a run, ignores stale async completions after the kill, and resets the shared worker pool so pooled self-play work is cut off instead of draining in the background.
- [x] (2026-03-15 13:40 -07:00) Rebalanced future-run defaults for local responsiveness: shared-family runs now expose selectable parameter-budget presets, the default future-run preset dropped to `65k`, and default CPU worker/thread counts now intentionally leave headroom for the browser and the rest of the desktop.
- [x] (2026-03-15 14:10 -07:00) Reduced admin-page churn by batching live rerenders, throttling repeated selected-run detail fetches, and skipping hidden-tab polling work where live socket/poll data is already sufficient.

## Surprises & Discoveries

- Observation: `parallelGameWorkers` can already be set higher than the real self-play chunk size, so one run may appear underutilized even with aggressive settings.
  Evidence: `src/services/ml/runtime.js` resolves up to the requested worker count, but `getRunSelfPlayChunkSize()` caps self-play chunks to `RUN_SELFPLAY_PROGRESS_MAX_CHUNK_GAMES`, currently `4`.

- Observation: the active run is not bottlenecked by conservative self-play settings.
  Evidence: `data/ml/runs/run-0017/manifest.json` shows `numSelfplayWorkers: 15`, `parallelGameWorkers: 16`, `numMctsSimulationsPerMove: 1200`, and `hypothesisCount: 8`.

- Observation: the active CUDA path still trains extremely small models and small minibatches.
  Evidence: `run-0017` records `batchSize: 64`, and the persisted bootstrap bundle uses one-layer legacy networks with empty `hiddenSizes`.

- Observation: merely changing `createDefaultModelBundle()` is not enough to affect future bootstrap-seeded runs in an already-persisted workspace.
  Evidence: bootstrap seeding resolves through the persisted snapshot list in `resolveRunSeedBundle()`, and the existing `Bootstrap` snapshot already contains the older architecture.

- Observation: `trainingBackend: auto` was still leaving CPU-only machines on the Node trainer even when the Python bridge was installed and usable.
  Evidence: `resolveEffectiveTrainingBackend()` returned Node whenever the handshake said `cudaAvailable: false`, so multithreaded Torch CPU training was never selected from `auto`.

- Observation: background training jobs were using `samples.policySamples.length` as the batch size, which can make the runtime look hung on large simulations and can spike memory unnecessarily.
  Evidence: `runTrainingJob()` was passing `batchSize: samples.policySamples.length || 24` into `trainModelBundleBatch()`.

- Observation: the Python bridge was still hard-capped to four Torch CPU threads and had no request timeout.
  Evidence: `ml_backend/torch_training_bridge.py` called `torch.set_num_threads(max(1, min(4, torch.get_num_threads())))`, and `src/services/ml/pythonTrainingBridge.js` had no timeout/restart path around `sendPayload()`.

- Observation: a direct post-patch probe on this machine now shows the tuned defaults and bridge capabilities clearly.
  Evidence: the probe reported `cudaAvailable: true`, `cudaDeviceName: NVIDIA GeForce RTX 2080`, `cudaTotalMemoryMb: 8191`, `cpuCount: 16`, `torchNumThreads: 16`, and future-run defaults `parallelGameWorkers: 16`, `numSelfplayWorkers: 32`, `batchSize: 1024`, `trainingStepsPerCycle: 48`.

- Observation: cooperative `Stop Run` still only requests cancellation at safe phase boundaries, so it does not satisfy the operational need for an immediate override.
  Evidence: `stopRun()` flips `status: stopping` and `cancelRequested`, but long self-play chunks and training calls only observe that flag after the in-flight await returns.

- Observation: maximizing ML throughput on the same machine as the browser can make the admin UI feel unresponsive even when the page itself is not doing much work.
  Evidence: the runtime previously defaulted to all-core self-play/training settings and the admin page was still force-refreshing selected run details every live poll, which kept both the server and browser busier than necessary during active runs.

## Decision Log

- Decision: keep the current active run untouched and scope all behavior changes to future-created runs, future-created snapshots, and future bootstrap preference.
  Rationale: the user explicitly asked not to worry about the current run, and mutating in-flight working state would create unnecessary risk.
  Date/Author: 2026-03-14 / Codex

- Decision: raise effective self-play concurrency by fixing chunk sizing rather than by further increasing worker-count defaults alone.
  Rationale: the current limit is caused by the scheduler underfeeding work, not by an inability to configure more workers.
  Date/Author: 2026-03-14 / Codex

- Decision: preserve historical snapshots and promoted generations, but introduce a preferred modern bootstrap baseline for future bootstrap-seeded runs.
  Rationale: this keeps older artifacts readable and comparable while moving new runs onto the larger architecture automatically.
  Date/Author: 2026-03-14 / Codex

- Decision: make `trainingBackend: auto` prefer the Python bridge even when CUDA is absent.
  Rationale: the Python/Torch path is the only trainer in this repo that can use multiple CPU threads for the shared family, so falling back to Node on CPU-only bridge installs was leaving training throughput on the table.
  Date/Author: 2026-03-14 / Codex

- Decision: use hardware-aware batch-size and training-step heuristics rather than one larger fixed default.
  Rationale: the shared family is still small enough that 8 GB CUDA cards can take much larger batches than the original defaults, but snapshot/background training still needs safe behavior on CPU-only machines and on tiny sample sets.
  Date/Author: 2026-03-14 / Codex

- Decision: bound both worker-thread tasks and Python bridge requests with explicit timeouts.
  Rationale: the user explicitly asked to prevent long runs from getting stuck. A delayed failure is safer than an unbounded hang, and these failures now flow into the existing run/job error paths.
  Date/Author: 2026-03-14 / Codex

- Decision: keep `Stop Run` cooperative and add a separate destructive `Kill Run` action.
  Rationale: operators need an immediate override that can discard in-flight unsaved work, while the older stop path is still useful when a clean phase-boundary exit is preferred.
  Date/Author: 2026-03-14 / Codex

- Decision: prefer sustained local responsiveness over absolute all-core saturation for default future runs.
  Rationale: this workstation hosts both the server and the browser. Reserving CPU headroom and shrinking the default shared-model preset to `65k` keeps the ML workbench usable while still allowing larger presets to be selected explicitly.
  Date/Author: 2026-03-15 / Codex

## Outcomes & Retrospective

Future runs now default to a denser training workload and a larger model architecture, while bootstrap seeding prefers a new modern baseline instead of inheriting the legacy small root snapshot forever. Self-play chunking now scales to the configured game-worker count, so a single run can actually fill the worker pool during CPU-heavy phases. The ML workbench defaults/help text and focused regression coverage were updated to match.

The follow-up utilization pass also removed the last obvious throughput and stall traps in the shared-family training path. `trainingBackend: auto` now prefers the Python bridge whenever it is available, using CUDA when possible and Python CPU otherwise. The bridge now reports hardware details that the runtime uses for future-run defaults, snapshot/background training no longer use pathological batch sizes, and both worker-thread tasks and bridge requests now time out instead of hanging indefinitely.

The run controls now distinguish cooperative stop from destructive kill. `Stop Run` still waits for the next safe boundary. `Kill Run` immediately marks the run `stopped` with `manual_kill`, removes its active task slot, and treats any later pipeline completion or failure as stale so it cannot overwrite the killed state. The runtime also recreates the shared worker pool so pooled self-play work is interrupted instead of draining until timeout.

That initial throughput push has since been rebalanced for local-machine usability. The shared-family architecture is still the default published path, but new runs now choose among `32k`, `65k`, `126k`, `256k`, and `512k` parameter-budget presets, with `65k` as the default. Default `parallelGameWorkers` and Torch CPU thread counts now reserve explicit CPU headroom instead of consuming every available core, and the admin UI now avoids unnecessary live-detail fetches and hidden-tab redraws.

The structural limit remains that one run still alternates self-play and training rather than overlapping them, so this change improves phase utilization and throughput without claiming perfect simultaneous CPU/GPU saturation from one run.

## Context and Orientation

The continuous-run pipeline, run config defaults, seed resolution, and bootstrap snapshot handling all live in `src/services/ml/runtime.js`. The default model architecture lives in `src/services/ml/modeling.js`. The Python/CUDA training bridge lives in `ml_backend/torch_training_bridge.py`. The ML workbench form defaults and tooltips live in `public/ml-admin.js`. The high-signal regression coverage for this change belongs primarily in `tests/mlRuntime.test.js` and `tests/mlRoutes.test.js`.

## Plan of Work

First, update the runtime scheduler so self-play chunking can actually fill the configured game-worker pool during a single run. That should raise CPU utilization immediately for future runs using the existing concurrency knobs.

Second, raise the default future-run training workload by increasing the workbench/runtime batch-size defaults and, if needed, related defaults that keep the training phase dense enough to give CUDA a larger burst of work per batch.

Third, enlarge the default model architecture in `modeling.js`, then update runtime bootstrap preference so new bootstrap-seeded runs pick a modern baseline instead of the persisted legacy bootstrap snapshot. Preserve old snapshots so historical runs and tests remain valid.

Finally, update the ML workbench defaults/help text and extend runtime/route regression coverage so the new future-run behavior is explicit and test-proven.

## Concrete Steps

1. Update `src/services/ml/runtime.js` self-play chunk sizing and future-run default config values.
2. Update `src/services/ml/modeling.js` default network sizes for newly created model bundles.
3. Add a runtime helper that identifies or creates a preferred modern bootstrap snapshot for future bootstrap seeding without deleting old bootstrap artifacts.
4. Update `public/ml-admin.js` defaults/help text to reflect the new future-run defaults.
5. Extend `tests/mlRuntime.test.js` and `tests/mlRoutes.test.js` with focused assertions for the new defaults, bootstrap preference, and self-play chunking behavior.
6. Run focused Jest coverage and record the results here.

## Validation and Acceptance

Run:

  npm.cmd test -- tests/mlRoutes.test.js

Then run:

  $env:ENABLE_ML_WORKFLOW='true'
  node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="run workbench surfaces defaults|continuous self-play emits partial progress updates while chunking long batches|new runs can seed from an existing promoted generation and workbench lists it|bootstraps snapshots"

Acceptance is:

- future-run defaults show the higher-throughput settings;
- self-play progress proves chunking can use the configured worker count instead of hard-stopping at four;
- new default models are larger than the legacy baseline;
- bootstrap seeding for future runs prefers the modern baseline without breaking historical artifacts.

Validation results:

  - `npm.cmd test -- tests/mlRoutes.test.js` passed with 11 tests.
  - `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --forceExit --testNamePattern="default model bundles use the larger future-run architecture|run workbench surfaces defaults|bootstrap seeding upgrades legacy root baselines to the preferred modern snapshot|continuous self-play emits partial progress updates while chunking long batches|new runs can seed from an existing promoted generation and workbench lists it"` passed with 5 targeted tests.
  - `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="bootstraps snapshots"` passed with 1 targeted test.
  - `node -c src/services/ml/runtime.js` passed.
  - `node -c src/services/ml/pythonTrainingBridge.js` passed.
  - `python -m py_compile ml_backend/torch_training_bridge.py` passed.
  - `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --forceExit --testNamePattern="run workbench surfaces defaults, live runs, and stop requests|startRun applies hardware-tuned defaults when batch settings are omitted|auto backend prefers Python CPU when the bridge is available without CUDA|trainSnapshot persists the trained model bundle returned by the trainer|python-trained snapshots still run through Node CPU inference"` passed with 5 focused tests.
  - `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --forceExit --testNamePattern="killRun stops a run immediately with manual_kill and clears the active task slot|killRun prevents stale pipeline failures from rewriting the killed run state|run workbench surfaces defaults, live runs, and stop requests|only one active continuous run is allowed at a time|a stop-pending run does not block starting a replacement run"` passed with 5 focused tests.
  - `npm.cmd test -- tests/mlRoutes.test.js --runInBand --forceExit` passed with 12 tests after the kill-route addition.
  - A direct Node probe reported:
    `{"cudaDeviceName":"NVIDIA GeForce RTX 2080","cudaTotalMemoryMb":8191,"cpuCount":16,"torchNumThreads":16,"parallelGameWorkers":16,"numSelfplayWorkers":32,"batchSize":1024,"trainingStepsPerCycle":48}`.

Testing caveat:

  - The targeted runtime slice still needed `--forceExit` to terminate cleanly after passing, which matches the suite's long-standing open-handle behavior rather than a newly discovered failing assertion.

Revision note (2026-03-14 / Codex): updated after the shared-encoder follow-up to record the new auto-backend behavior, hardware-aware training defaults, timeout/watchdog coverage, and the focused validation/results from the throughput-and-stability pass.

Revision note (2026-03-15 / Codex): updated after the model-size-preset and responsiveness follow-up to record the new `32k`/`65k`/`126k`/`256k`/`512k` shared-family presets, the `65k` default, the CPU-headroom policy, and the admin-page polling/render throttles.
