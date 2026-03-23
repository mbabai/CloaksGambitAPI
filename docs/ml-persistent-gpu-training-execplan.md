# Rebuild The Active ML Training Pipeline Around A Persistent GPU Trainer

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as the work lands.

The repository pointer to `.agent/PLANS.md` is stale in this workspace, so this file follows the same ExecPlan structure already used under `docs/`.

Operator note: performance improvements in this area are targeted at the next run, not surgical repair of a currently running one. When a new throughput optimization lands, assume the user will restart the server and start a fresh run to benefit from it unless the change explicitly supports in-place adoption.

## Purpose / Big Picture

After this change, the active shared-family ML pipeline should stop paying the cost of reconstructing the model, optimizer, and CUDA state on every training step. Continuous runs and background training jobs should use persistent Python trainer sessions, shared-family training should happen in one fused step instead of three legacy-style passes, and the admin/runtime surface should stop exposing training knobs that no longer matter in the active pipeline. The observable success case is: start a shared-family run on `python / cuda`, see materially lower average training-step time, and verify the runtime still checkpoints, resumes, promotes, and evaluates correctly.

## Progress

- [x] (2026-03-16 10:55 -07:00) Audited the current Node runtime, Python bridge, shared-family Node trainer, and active workbench/runtime knobs.
- [x] (2026-03-16 11:01 -07:00) Confirmed the major active-path bottlenecks: stateless JSON bridge payloads, model/optimizer reconstruction per request, duplicate state inputs across policy/value/identity sample payloads, and three separate shared-head training passes.
- [x] (2026-03-16 11:05 -07:00) Confirmed the obvious active-pipeline legacy residue: `parallelTrainingHeadWorkers`, `trainHead` worker tasks, and legacy-style shared-head separation in both Node and Python trainers.
- [x] (2026-03-16 12:36 -07:00) Added persistent shared-family Python trainer sessions with `train_session_batch`, `export_training_session`, and `close_training_session`, plus fused policy/value/belief training under AMP/autocast and optional `torch.compile`.
- [x] (2026-03-16 12:54 -07:00) Switched the active shared-family runtime path to combined `sharedSamples` batches, added per-decision `sampleKey` correlation, and exported session state only at checkpoints/finalization/shutdown instead of every step.
- [x] (2026-03-16 13:09 -07:00) Removed the surfaced `parallelTrainingHeadWorkers` knob from the workbench/defaults/tests and updated the ML `AGENTS.md` files to describe the session-based pipeline as the current best path.
- [x] (2026-03-16 13:22 -07:00) Validated the new bridge/session path with targeted Jest coverage plus a direct Node-to-Python session smoke test.

## Surprises & Discoveries

- Observation: the shared-family Python path is still architected like the old independent-head trainer.
  Evidence: `ml_backend/torch_training_bridge.py` currently runs `train_shared_policy_epoch()`, `train_shared_value_epoch()`, and `train_shared_identity_epoch()` sequentially, each with its own encoder forward/backward/optimizer step.

- Observation: the bridge is long-lived, but the trainer state is not.
  Evidence: `src/services/ml/pythonTrainingBridge.js` keeps the child process alive, yet every `train_batch` request still sends a full JSON bundle and optimizer state, and `ml_backend/torch_training_bridge.py` rebuilds the `JsonMlp` modules and optimizers from scratch for that request.

- Observation: the active workbench still exposes a knob that no longer helps the current shared-family path.
  Evidence: `parallelTrainingHeadWorkers` is still in `public/ml-admin.html` / `public/ml-admin.js`, but the current best path is shared-family Python/CUDA, where per-head worker parallelism is not the right optimization.

- Observation: shutdown/export correctness required explicit session flushing instead of assuming the in-memory Python process would stay aligned with Node state.
  Evidence: once the runtime stopped exporting model state on every shared-family step, `flushForShutdown()` and task finalizers needed to call `export_training_session` so clean restarts resumed from the latest checkpointed bundle instead of a stale pre-session copy.

- Observation: per-decision sample correlation could not rely on `createdAt` alone.
  Evidence: `appendRunReplayBuffer()` stamps every sample from the same finished game with the same `createdAt`, so batching by timestamp alone can over-select identity rows. Adding `sampleKey` in `src/services/ml/gameRunner.js` makes the combined batch shape deterministic.

## Decision Log

- Decision: optimize the active shared-family pipeline first and keep only minimal compatibility for older persisted artifacts.
  Rationale: the user explicitly asked to remove legacy execution paths that are no longer the current best. The active continuous-run/shared-family path should be simple and fast; compatibility should be limited to reading older artifacts, not carrying old execution models forever.
  Date/Author: 2026-03-16 / Codex

- Decision: use persistent trainer sessions keyed by logical runtime/training-job session ids.
  Rationale: that removes repeated CUDA/model/optimizer reconstruction while still allowing multiple active training contexts when necessary.
  Date/Author: 2026-03-16 / Codex

- Decision: represent shared-family training batches in a combined state-centric shape instead of shipping duplicated `stateInput` payloads in three separate arrays.
  Rationale: that lowers bridge payload size and makes a genuinely fused shared-family training step possible.
  Date/Author: 2026-03-16 / Codex

- Decision: remove `parallelTrainingHeadWorkers` from the active shared-family surface.
  Rationale: it reflects the old independent-head training architecture and encourages the wrong optimization for the current best path.
  Date/Author: 2026-03-16 / Codex

## Outcomes & Retrospective

The active shared-family training pipeline now has a clear current-best path: persistent Python/Torch sessions for training, combined `sharedSamples` payloads, fused policy/value/belief updates, and AMP/autocast on CUDA. The workbench no longer advertises the old per-head worker knob, and the runtime exports session state only when checkpoints, shutdown, or final artifacts need it. Compatibility paths for older artifacts still exist, but they are now clearly secondary.

The remaining gap is measurement, not plumbing. The code now supports the intended lower-overhead path, but the repository still needs a before/after throughput comparison on the target RTX 2080 hardware under a representative run configuration to quantify the exact speedup.

## Context and Orientation

The active runtime scheduler lives in `src/services/ml/runtime.js`. The model format and Node-side training helpers live in `src/services/ml/modeling.js`. The Python bridge transport lives in `src/services/ml/pythonTrainingBridge.js`, and the actual Torch implementation lives in `ml_backend/torch_training_bridge.py`. The workbench form and selected-run view live in `public/ml-admin.html` and `public/ml-admin.js`. Focused regression coverage belongs primarily in `tests/mlRuntime.test.js` and `tests/mlRoutes.test.js`.

## Plan of Work

First, add persistent trainer sessions to the Python bridge so one session can keep the shared-family model and optimizer resident on GPU across many training steps. Keep the JSON compatibility boundary at session import/export rather than at every step.

Second, replace the current three-pass shared-family training logic with one fused shared training step that computes policy, value, and identity losses inside the same training function. Add AMP/autocast and `torch.compile` where they are stable for this workload.

Third, reduce payload inefficiency by assembling combined shared training batches in the runtime, sending one state-centric batch shape to Python instead of three duplicate per-head arrays for the active shared-family path.

Fourth, remove the old active-pipeline training knobs and worker paths that only existed for the independent-head model design, while keeping only the minimal compatibility surface still needed to read older artifacts.

Finally, update `AGENTS.md` files and focused tests so the new active ML pipeline is explicit and the old one stops being the documented default.

Revision note (2026-03-16): updated after implementation to record the landed session commands, combined shared batch shape, removal of the workbench head-parallelism knob, and the focused validation evidence.
