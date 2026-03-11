# Rebuild ML Training, Simulations, and Admin Workbench

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/PLANS.md).

## Purpose / Big Picture

After this change, the ML workflow will stop feeling like a fragile experiment hidden behind a monolithic runtime file. An admin will be able to run self-play batches, inspect per-epoch loss for the policy, value, and identity models, continue training from any snapshot, and watch simulation games through the existing god-view replay surface. Simulation games will be executed through the live server gameplay routes instead of only through the separate ML rules implementation, so training data and replay output stay aligned with the real server.

The observable success case is: start the server, open `/ml-admin`, choose snapshot participants, run a simulation batch, see live progress, load one of the produced games in replay, then select that batch as training data and run another training job while watching all three losses update by epoch.

## Progress

- [x] (2026-03-10 21:50 -07:00) Read `PLANS.md`, repo instructions, ML runtime, simulation schemas, admin panel, socket wiring, and the live gameplay route stack.
- [x] (2026-03-10 21:50 -07:00) Identified the current failure pattern: `src/services/ml/runtime.js` is a single-file orchestrator that mixes persistence, model definitions, route probing, simulation execution, and training loops; `public/ml-admin.js` is likewise a single-file dashboard.
- [x] (2026-03-10 23:35 -07:00) Replaced the current hand-rolled linear-weight model bundle in `src/services/ml/modeling.js` with modular feed-forward network helpers, richer feature extraction, legacy snapshot normalization, and batched training with stable per-epoch loss reporting.
- [x] (2026-03-11 00:40 -07:00) Replaced engine-only simulation execution with a route-backed simulation harness that creates real live games, applies actions through the current server routes, records replay frames from the live game objects, and keeps an ML shadow state for search/training features.
- [x] (2026-03-11 00:40 -07:00) Refactored the ML runtime responsibilities by splitting shared network math into `src/services/ml/network.js`, adding internal simulation request helpers, and simplifying the admin summary surface with `GET /api/v1/ml/workbench`.
- [x] (2026-03-11 01:30 -07:00) Rebuilt `public/ml-admin.html` and `public/ml-admin.js` into a workbench focused on snapshot management, training controls, simulation browsing, replay viewing, and per-model loss inspection, with smaller browser modules under `public/js/modules/mlAdmin/`.
- [x] (2026-03-11 02:05 -07:00) Added targeted validation for training, replayed simulations, progress events, and stop behavior; broad ML regression coverage still has one long-running timeout case to resolve separately.
- [x] (2026-03-11 02:10 -07:00) Updated the ExecPlan with the shipped behavior, notable runtime discoveries, and validation outcomes.
- [x] (2026-03-11 20:42 -07:00) Simplified `/ml-admin` into separate Simulations and Training tabs, removed duplicate live-stream ids from the HTML shell, rewired the browser controller around tab-specific selection state, and verified the rebuilt browser module parses cleanly.
- [x] (2026-03-11 22:30 -07:00) Added restart-safe ML background jobs with runtime-file checkpoints, Mongo checkpoint persistence for simulations and training runs, `/api/v1/ml/live` plus workbench live payloads, server-start resume, and browser polling that reconciles live state after disconnects or refreshes.

## Surprises & Discoveries

- Observation: the runtime already contains dormant helpers for route-backed simulations (`createApiBackedGame`, `cleanupApiBackedGame`, `buildMlStateFromGame`) but the active simulation path never uses them.
  Evidence: `src/services/ml/runtime.js` defines those helpers around lines 496-695, while `simulateMatches()` still calls `runSingleGame()` which operates on `src/services/ml/engine.js` only.

- Observation: the existing route-backed helper is blocked mostly by auth/session expectations, not by game creation.
  Evidence: live game-action routes call `requireGamePlayerContext()` in `src/utils/gameAccess.js`, which resolves session state from cookies; the internal route harness currently sends no cookie/session data.

- Observation: the current “models” are shallow linear weight arrays with direct gradient steps, so the admin panel’s three-loss display is more sophisticated than the actual training core.
  Evidence: `src/services/ml/modeling.js` currently stores `policy.weights`, `value.weights`, and `identity.weightsByIdentity` and updates them with in-place SGD.

- Observation: the first route-backed simulation draft appeared to be unusably slow because every teardown tried to hit buffered Mongo history deletes even when no database connection was active.
  Evidence: single-game runs consistently stalled for roughly twenty seconds until `cleanupApiBackedGame()` was guarded on `mongoose.connection.readyState === 1`, after which equivalent self-play runs completed in tens of milliseconds.

- Observation: browser verification for `/ml-admin` is constrained by the admin auth gate, not by the rebuilt page itself.
  Evidence: local Playwright verification reached the page shell on `http://127.0.0.1:3100/ml-admin`, but the unauthenticated session received the expected `403 Forbidden` response from the admin ML API.

- Observation: the first tabbed-admin draft still behaved unpredictably because the page shell duplicated ids for simulation and training stream widgets, so `document.getElementById()` could bind to the wrong copy.
  Evidence: a direct regex-based duplicate-id scan of `public/ml-admin.html` now returns `no-duplicate-ids` after removing the duplicate banner-level stream controls.

- Observation: route/socket progress alone is not enough to make long ML jobs operationally robust, because both browser disconnects and process restarts can leave the UI blind even when the runtime is still resumable.
  Evidence: before this follow-up, `simulateMatches()` and `trainSnapshot()` only saved terminal state, `socket.js` only forwarded transient progress events, and `/ml-admin` had no polling path to reconstruct live work after reconnect.

## Decision Log

- Decision: keep the admin API namespace `/api/v1/ml/*` and the `/admin` socket namespace for ML progress instead of inventing a new transport.
  Rationale: the server wiring, auth, and current admin page already depend on those paths; reusing them keeps the refactor focused on capability and correctness instead of route churn.
  Date/Author: 2026-03-10 / Codex

- Decision: move simulation execution onto the live gameplay route stack while keeping an ML shadow state for feature extraction and search.
  Rationale: the user explicitly wants the current server reused for simulation play, but the ML feature pipeline still needs richer hidden-information bookkeeping than the live game objects currently expose directly.
  Date/Author: 2026-03-10 / Codex

- Decision: replace the current linear models with small in-repo feed-forward networks implemented in plain Node instead of introducing a new heavyweight JS dependency.
  Rationale: the project currently ships no ML runtime dependency, the tests run in Node-only Jest, and the existing admin workflow stores model bundles as JSON-like data; a small self-contained network implementation keeps deployment and persistence simple.
  Date/Author: 2026-03-10 / Codex

- Decision: split the ML admin workbench into two explicit tabs, one for simulations and one for training, instead of keeping simulation controls, replay, model lists, and training flows interleaved on one page.
  Rationale: the user workflow is task-based rather than implementation-based. Grouping controls by workflow removes visual noise and makes replay inspection, source selection, and live loss monitoring easier to follow.
  Date/Author: 2026-03-11 / Codex

- Decision: keep the original synchronous `simulateMatches()` / `trainSnapshot()` methods for direct-runtime tests and add separate persisted background job APIs for the admin UI and restart recovery.
  Rationale: the existing runtime tests exercise the direct methods already, while restart-safe admin execution needs non-fragile task ids, checkpoint state, and boot-time resume behavior that should not be bolted onto the test-facing sync methods.
  Date/Author: 2026-03-11 / Codex

## Outcomes & Retrospective

- Outcome: the ML stack no longer trains shallow linear models. `src/services/ml/modeling.js` now delegates network math to `src/services/ml/network.js` and trains policy, value, and identity networks with richer features, Adam updates, gradient clipping, epoch histories, and backward-compatible snapshot normalization.

- Outcome: simulation play now runs through the authoritative live server routes instead of only through the parallel ML engine. `src/services/ml/runtime.js` creates temporary live games, submits setup and action routes as synthetic internal player sessions, records replay frames from the live game objects, and rehydrates the ML shadow state from live data whenever parity drifts.

- Outcome: the admin experience is now workflow-oriented instead of implementation-oriented. The rebuilt `public/ml-admin.html` and modular `public/js/modules/mlAdmin/` scripts expose snapshot controls, simulation runs, replay viewing, and a loss explorer that surfaces all three model losses across epochs.

- Outcome: the admin workbench is now arranged around two primary tasks instead of one mixed dashboard. The Simulations tab handles controller selection, batch creation, run deletion, game browsing, and replay loading. The Training tab handles base-snapshot selection, training-source selection, live loss bars and graphing, recent training runs, and output-model inspection/deletion.

- Outcome: simulation batches and training runs are now restart-safe server jobs instead of browser-tethered one-shot requests. `src/services/ml/runtime.js` persists active job checkpoints into the runtime file, mirrors simulation checkpoints into `Simulation` / `SimulationGame`, mirrors training checkpoints into the new `TrainingRun` model, and resumes unfinished work automatically when the server boots again.

- Outcome: `/ml-admin` now reconciles live state from both sockets and polling. `GET /api/v1/ml/live` and the `live` section in `GET /api/v1/ml/workbench` let the browser recover active simulation/training progress, loss history, and recent terminal states even when the page is refreshed or the socket reconnects late.

- Outcome: performance is materially better for local experimentation once route-backed cleanup stops buffering database deletes. Self-play simulation latency dropped from roughly twenty seconds per game in the broken draft to roughly forty-six milliseconds per game for built-in self-play and roughly one second per game for snapshot-vs-snapshot runs with low search settings.

- Validation: targeted Jest runs passed for snapshot bootstrapping, replay persistence, training child snapshots, empty-training-data error handling, simulation progress events, and simulation stop behavior. A broader `tests/mlRuntime.test.js` run still has at least one long-running timeout around the historical “above 64 games” regression, so full-suite ML validation remains incomplete.

- Validation: the rebuilt `public/ml-admin.js` parses successfully under `node --experimental-vm-modules`, and the HTML shell now passes a duplicate-id scan for the workbench controls.
- Validation: direct node probes passed for background simulation start/completion, background training start/completion, and runtime-file restart resume for both a partially completed simulation batch and a partially completed training run.
- Validation: `tests/mlRoutes.test.js` passes with the new aggregated live payload, and direct Jest invocations passed for the new `background simulation jobs complete and expose live status` and `background training jobs complete and create a new snapshot` cases in `tests/mlRuntime.test.js`.

## Context and Orientation

The ML workflow currently lives mainly in four places. `src/services/ml/runtime.js` is the orchestration layer for snapshots, simulation batches, training runs, replay loading, and persistence. `src/services/ml/modeling.js` defines the current policy/value/identity model bundle and the training math. `src/services/ml/mcts.js` runs hidden-information search using those models. `public/ml-admin.html` and `public/ml-admin.js` implement the browser-side admin interface.

Two persistence layers exist today. Runtime metadata is stored in `data/ml/runtime.json` when persistence is enabled. Simulation runs are also mirrored to MongoDB using `src/models/Simulation.js` and `src/models/SimulationGame.js`, with detailed games optionally stored in the `SimulationGame` collection and only summaries kept inline.

There are two gameplay implementations in the repository. The authoritative live game routes live under `src/routes/v1/gameAction/` and mutate active `Game` documents in memory through the same code path the real server uses. The ML engine in `src/services/ml/engine.js` is a separate rules implementation used today for simulation and search. The refactor will keep the ML engine for search/legal-action generation and training features, but simulation moves themselves will be executed through the live routes so the server remains the final authority for simulated play.

The admin transport already exists and should be preserved. `src/routes/v1/ml/index.js` exposes the REST endpoints. `src/socket.js` forwards `ml:trainingProgress` and `ml:simulationProgress` events onto the `/admin` namespace. `public/ml-admin.js` already consumes those events, but the file is too large and the UI is organized around implementation details instead of the actual workflow the user wants.

## Plan of Work

First, split the current model math out of `src/services/ml/modeling.js`. The replacement will introduce self-contained network helpers for dense layers, activations, softmax/tanh outputs, JSON-safe parameter serialization, Xavier-style initialization, and Adam-based parameter updates. Feature extraction will stay near the ML engine, but the policy, value, and identity feature sets will be revised to include clearer response-phase and material-pressure signals so the three models train on more useful inputs. Training functions will switch from one-sample-at-a-time weight nudging to shuffled mini-batch passes with stable reported loss, optional regularization, and returned metrics for every epoch.

Second, rework simulation execution in `src/services/ml/runtime.js`. The runtime will gain a live-route simulation adapter that can create a temporary match/game, perform setup and ready actions through the existing routes using internal simulated player sessions, and then step through a game by sending move/challenge/bomb/pass/on-deck actions through the same route handlers the server uses in production. The adapter will fetch the updated live game object after each action, record replay frames from that object, and keep a synchronized ML shadow state for search and training sample extraction. The shadow state will remain responsible for legal-action generation, hidden-information reasoning, and feature bookkeeping.

Third, separate storage and runtime orchestration concerns. Snapshot summarization, simulation persistence, simulation hydration, and training-run history management should stop living inline with model math. `src/services/ml/runtime.js` should become a coordinator over smaller helpers rather than the place where every concern is implemented directly.

Fourth, rebuild the admin page. The new page should foreground the workflow: choose or fork a snapshot, run simulation batches, inspect recent batches, watch a replay, pick training sources, and run more training while seeing the policy/value/identity losses update per epoch. The JavaScript should be split into smaller browser modules so replay rendering, API calls, loss chart rendering, and page state are not entangled in one file.

Finally, update tests and docs. The highest-signal cases are route-backed simulation integrity, training loss emission, snapshot lineage, replay loading, simulation cancellation, and the new admin summary data used by the page.

## Concrete Steps

Work from the repository root `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

1. Create the new ML model/training helper modules under `src/services/ml/` and update `src/services/ml/modeling.js` exports to delegate to them.
2. Add a live-route simulation adapter under `src/services/ml/` and wire `MlRuntime.runSingleGame()` / `simulateMatches()` to use it.
3. Split persistence and summary helpers out of `src/services/ml/runtime.js` as needed, then simplify the runtime class to orchestration plus API-facing behavior.
4. Replace `public/ml-admin.html` and `public/ml-admin.js` with the new workbench layout and modular browser code.
5. Update Jest suites in `tests/` and add new focused tests where coverage is currently missing.
6. Run targeted tests during the migration, then run `npm test` as the final validation pass.

Expected command cadence during implementation:

    cd C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI
    npm test -- tests/mlRuntime.test.js
    npm test -- tests/<new-or-updated-suite>.test.js
    npm test

## Validation and Acceptance

Acceptance is behavioral.

Run `npm test` from the repository root and expect the ML runtime suites plus any newly added suites to pass.

Then start the server on a non-3000 port, for example:

    cd C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI
    $env:PORT=3100
    npm start

Open `http://localhost:3100/ml-admin` while authenticated as the admin user. The page should:

1. Load snapshots, simulations, and loss history without console errors.
2. Start a simulation batch and show live progress updates over the `/admin` socket.
3. Let the user choose a completed simulation game and view replay frames in the god-view board.
4. Let the user pick a snapshot and simulation sources, start training, and see policy/value/identity losses update by epoch.
5. Show the resulting trained snapshot in the snapshot list and make it selectable for additional training or simulation runs.

## Idempotence and Recovery

The new runtime modules and admin UI changes are additive refactors and can be applied safely multiple times. If the runtime JSON file contains older snapshot or simulation data, the new runtime must continue to load it or degrade cleanly by preserving readable summaries. If route-backed simulation fails mid-game, the adapter must delete its temporary live `Game` and `Match` records through the existing cleanup path so active-lobby state is not polluted.

If MongoDB is unavailable locally, the runtime should continue to function with file-backed state only, as the current runtime already does. The admin page should report storage mode accurately instead of assuming Mongo persistence succeeded.

## Artifacts and Notes

Initial evidence gathered before implementation:

    src/services/ml/runtime.js: route-backed helpers exist but are unused by simulateMatches()
    src/services/ml/modeling.js: policy/value/identity training uses direct in-place linear-weight updates
    public/ml-admin.js: single-file dashboard script > 2000 lines

## Interfaces and Dependencies

At the end of this refactor, the following interfaces should exist conceptually even if the filenames vary slightly:

In `src/services/ml/modeling.js`, export functions that still satisfy the runtime and search layers:

    createDefaultModelBundle(options?)
    cloneModelBundle(bundle)
    predictPolicy(modelBundle, state, perspective, actions?, guessedIdentities?)
    predictValue(modelBundle, state, perspective, guessedIdentities?)
    inferIdentityHypotheses(modelBundle, state, perspective, options?)
    trainPolicyModel(modelBundle, policySamples, optionsOrLearningRate?)
    trainValueModel(modelBundle, valueSamples, optionsOrLearningRate?)
    trainIdentityModel(modelBundle, identitySamples, optionsOrLearningRate?)

In the simulation adapter, define a route-backed game runner that can:

    create a live temporary match/game
    execute setup and ready actions for both simulated players
    submit move/challenge/bomb/pass/on-deck actions as those players
    fetch the updated live game after each step
    clean up the temporary match/game when finished

In the admin UI, the browser code must continue to consume:

    GET /api/v1/ml/summary
    GET /api/v1/ml/snapshots
    GET /api/v1/ml/participants
    GET /api/v1/ml/simulations
    GET /api/v1/ml/simulations/:simulationId
    GET /api/v1/ml/replay/:simulationId/:gameId
    GET /api/v1/ml/loss
    POST /api/v1/ml/simulations/run
    POST /api/v1/ml/simulations/stop
    POST /api/v1/ml/training/run

Revision note: updated on 2026-03-11 to capture the follow-up `/ml-admin` tab refactor, the duplicate-id discovery in the HTML shell, and the browser parse/id validation evidence.
