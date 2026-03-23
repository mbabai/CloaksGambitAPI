# Overlap Self-Play With GPU Training In Continuous Runs

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` should be kept current as the work lands.

The repository-level pointer to `.agent/PLANS.md` is stale in this workspace, so this document follows the same ExecPlan structure already used under `docs/`.

## Purpose / Big Picture

After this change, one continuous ML run should be able to keep CPU self-play running while GPU-backed Python training is in flight. The runtime should still serialize checkpoint evaluation, because evaluation and self-play compete for the same Node game-worker pool. The observable success case is: start a Python/CUDA run, see both self-play and training stay active in the workbench at the same time, and still see checkpoint evaluation run as its own phase once a candidate generation is ready.

## Progress

- [x] (2026-03-16 10:20 -07:00) Re-read the current continuous-run loop in `src/services/ml/runtime.js` and confirmed it still alternates self-play, training, and evaluation in strict sequence.
- [x] (2026-03-16 10:27 -07:00) Confirmed the key architectural constraint: self-play already uses `workerGeneration` while training mutates `working.modelBundle`, so self-play can overlap with training without reading half-trained weights.
- [x] (2026-03-16 10:34 -07:00) Implemented run-local background training coordination, persisted pending-evaluation handoff, and live `trainingProgress` payload support in `src/services/ml/runtime.js`.
- [x] (2026-03-16 10:41 -07:00) Updated the admin selected-run panel in `public/ml-admin.js` so self-play and training can both highlight as active.
- [ ] Run focused validation and capture any remaining runtime caveats.

## Surprises & Discoveries

- Observation: the existing shared-encoder pipeline was already very close to supporting overlap.
  Evidence: self-play refreshes workers from approved generations via `refreshRunWorkerGeneration()`, while training updates `run.working.modelBundle`. Those are intentionally different objects.

- Observation: evaluation must remain serialized in the first pass.
  Evidence: `evaluateRunGeneration()` ultimately runs through `playRunGenerationGamesChunked()`, which uses the same CPU game-worker pool as self-play.

- Observation: the live payload previously could not represent genuine overlap.
  Evidence: `buildRunProgressPayload()` exposed `selfPlayProgress` and `evaluationProgress`, but there was no `trainingProgress`, and the admin UI inferred activity from one string `phase`.

## Decision Log

- Decision: only allow automatic overlap when the resolved trainer is Python/CUDA.
  Rationale: the user explicitly wants CPU self-play and GPU training overlap. Running Node/CPU or Python/CPU training concurrently with self-play would mostly just reintroduce CPU contention.
  Date/Author: 2026-03-16 / Codex

- Decision: keep checkpoint evaluation out of the background training task.
  Rationale: evaluation competes for the same game workers as self-play, so moving only training into the background captures the biggest resource split without forcing a more invasive scheduler rewrite.
  Date/Author: 2026-03-16 / Codex

- Decision: persist a `working.pendingEvaluation` marker.
  Rationale: clean shutdown and resume should not lose the fact that a candidate checkpoint was already produced and still needs evaluation.
  Date/Author: 2026-03-16 / Codex

## Outcomes & Retrospective

The continuous-run scheduler now has a cleaner split of responsibilities. Self-play remains the CPU-heavy foreground loop. Python/CUDA training can run in the background against the mutable working bundle, and checkpoint evaluation is handed back to the foreground loop once a candidate generation is queued. Live payloads now expose `trainingProgress`, which lets the workbench highlight self-play and training simultaneously instead of pretending the run only has one active phase at a time.

The main deliberate limitation is unchanged: evaluation does not overlap with self-play yet. That is intentional because both phases want the same search/game workers. This change targets the most valuable overlap first, not full arbitrary phase parallelism.

## Context and Orientation

The run scheduler and persistence logic live in `src/services/ml/runtime.js`. The selected-run dashboard lives in `public/ml-admin.js` and `public/ml-admin.html`. Focused regression coverage belongs in `tests/mlRuntime.test.js`.

## Plan of Work

First, keep the existing self-play/evaluation worker scheduling intact and add a run-local background training coordinator that can safely manage at most one in-flight training task per run.

Second, teach `trainRunWorkingModel()` to either evaluate inline as before or, in background mode, queue a pending candidate-generation evaluation and return control to the main loop.

Third, update the run-progress payload and selected-run UI so the dashboard reflects simultaneous self-play and training rather than forcing one synthetic phase string.

Finally, extend the focused runtime tests to prove that overlapping self-play plus background training is possible and that the live payload can represent both phases at once.
