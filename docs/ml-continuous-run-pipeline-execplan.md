# Rework ML Into Continuous Run Pipelines

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](../PLANS.md).

## Purpose / Big Picture

After this change, `/ml-admin` will stop making the operator think in terms of separate simulation batches and training jobs. Instead, the page will expose one continuous AlphaZero-style workflow built around named runs. An admin will be able to open a `Config` panel, set run knobs such as self-play worker count, MCTS simulations, replay buffer size, training step cadence, promotion threshold, and stop conditions, then kick off a run. The `Runs` panel will show active and completed runs, including live pipeline status and a graph of generation-vs-generation win rates over time. The `Replay` panel will let the admin choose one run, two generations from that run, and a retained game between those generations, then inspect the full replay in the existing god-view board surface.

The observable success case is: start the server, open `/ml-admin`, create a run named for a new experiment, watch it continuously generate self-play games, train candidates, evaluate them against prior generations, promote new best generations when they pass the threshold, see the run table and graph update live, then open the replay tab and load a game between two generations from that same run.

## Progress

- [x] (2026-03-11 16:51:11 -07:00) Read `PLANS.md`, repository ML notes, current runtime/routes/tests, and the existing `/ml-admin` implementation.
- [x] (2026-03-11 16:58:00 -07:00) Authored the initial run-pipeline ExecPlan and locked the migration strategy around one continuous run abstraction.
- [x] (2026-03-11 17:22:00 -07:00) Extended `src/services/ml/runtime.js` with persistent run records, continuous self-play/training/evaluation loops, generation tracking, replay-buffer sampling, retained replay games, run summaries, and `ml:runProgress` live payloads.
- [x] (2026-03-11 17:28:00 -07:00) Added run-oriented HTTP endpoints in `src/routes/v1/ml/index.js` and admin socket forwarding in `src/socket.js`.
- [x] (2026-03-11 17:43:00 -07:00) Rebuilt `public/ml-admin.html` and `public/ml-admin.js` around `Config`, `Runs`, and `Replay`, and added `public/js/modules/mlAdmin/generationWinChart.js`.
- [x] (2026-03-11 18:05:00 -07:00) Rewrote `docs/ml-admin.md`, updated route/runtime tests for the new run workflow, and executed focused validation commands.

## Surprises & Discoveries

- Observation: the repository’s previous ML refactor already did the expensive work of routing simulated moves through the live gameplay routes, so the new continuous pipeline can be built by composing `MlRuntime.runSingleGame()` rather than by rebuilding simulation from scratch.
  Evidence: `src/services/ml/runtime.js` already executes per-move live route calls and produces replay frames plus MCTS training records.

- Observation: the current browser workbench and route contract are tightly coupled to the old nouns `snapshots`, `simulations`, and `trainingRuns`, so the UI migration must be paired with new API payloads instead of trying to reinterpret the old payload shape in the browser only.
  Evidence: `public/ml-admin.js` binds directly to `/api/v1/ml/simulations/start`, `/api/v1/ml/training/start`, and `/api/v1/ml/loss`, while `tests/mlRoutes.test.js` only validates the old aggregated workbench payload.

- Observation: the repo instruction referenced `.agent/PLANS.md`, but the checked-in plan file actually lives at the repository root as `PLANS.md`.
  Evidence: the initial lookup for `.agent/PLANS.md` failed, while `PLANS.md` exists at the root and contains the active ExecPlan requirements.

- Observation: `tests/mlRuntime.test.js` is still slow and awkward to run wholesale because the historical suite remains large, but the new run-oriented tests execute quickly when targeted directly through Jest with `ENABLE_ML_WORKFLOW=true`.
  Evidence: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="continuous runs promote"` completed in about 22 seconds, while whole-file `npm test -- tests/mlRuntime.test.js` timed out in the agent shell.

## Decision Log

- Decision: keep the existing MCTS, model bundle, and live-route game execution helpers and build the continuous run loop on top of them instead of replacing them wholesale.
  Rationale: the user asked for a pipeline and workbench refactor, not for a second engine rewrite. Reusing the tested self-play and training primitives keeps the change focused on orchestration, persistence, and UI.
  Date/Author: 2026-03-11 / Codex

- Decision: represent a run as one long-lived background job that alternates self-play generation, replay-buffer updates, minibatch training, periodic evaluation, and promotion, rather than as separate queued simulation and training jobs.
  Rationale: this matches the user’s outline directly and removes the simulation/training dichotomy from the operator-facing workflow.
  Date/Author: 2026-03-11 / Codex

- Decision: preserve the old snapshot/simulation/training helpers internally for now, but migrate `/ml-admin` and the primary ML API surface to new run-oriented endpoints and payloads.
  Rationale: a compatibility layer lowers risk while the new workflow replaces the old operator experience end to end.
  Date/Author: 2026-03-11 / Codex

- Decision: model `num_selfplay_workers` as the number of self-play games generated per continuous cycle in the single Node process, rather than trying to add real multithreaded workers in this refactor.
  Rationale: the current server runtime is single-process JavaScript. Logical workers preserve the configuration model and continuous data flow without introducing a second process orchestration system.
  Date/Author: 2026-03-11 / Codex

## Outcomes & Retrospective

Outcome: the operator workflow is now run-oriented instead of split between simulations and training. `src/services/ml/runtime.js` can start a continuous run, grow and trim a replay buffer, train a working model in minibatches, checkpoint candidate generations, evaluate them against the current best plus older approved generations, promote new best generations, expose live progress, and retain replayable generation-pair games.

Outcome: the API and admin transport now speak in terms of runs. `src/routes/v1/ml/index.js` exposes aggregated run workbench data plus run list/detail/start/stop/replay endpoints, and `src/socket.js` forwards `ml:runProgress` events to `/admin`.

Outcome: `/ml-admin` now presents the requested `Config`, `Runs`, and `Replay` panels. The browser loads run defaults, starts runs, renders a run table, charts generation-vs-generation win rates, and reuses the existing replay theater for retained generation matchups.

Residual gap: the legacy simulation/training endpoints and runtime helpers still exist internally for compatibility and because they remain useful building blocks. The user-facing workflow no longer depends on them, but they were not removed in this pass.

## Context and Orientation

The current ML system lives mostly in `src/services/ml/runtime.js`, `src/services/ml/modeling.js`, `src/services/ml/mcts.js`, `src/routes/v1/ml/index.js`, `public/ml-admin.html`, and `public/ml-admin.js`. The runtime currently stores three top-level concepts in memory and `data/ml/runtime.json`: snapshots, simulations, and training runs. A snapshot is a stored model bundle. A simulation is a batch of games between two participants. A training run reads stored samples from one or more simulations, performs several epochs of gradient descent, and creates a child snapshot.

This task replaces that operator model with a first-class ML run. A run is one long-lived experiment that owns its configuration, active replay buffer, approved generations, evaluation history, retained replay games, and stop conditions. A generation is an approved checkpoint inside one run. It is the unit that self-play workers use after promotion and the unit shown in the run graph and replay selector. A replay buffer is a sliding window of recent position targets gathered from self-play. It deliberately forgets stale early data once its configured size is exceeded.

The existing runtime already provides the expensive gameplay primitives we need. `MlRuntime.runSingleGame()` creates a temporary live game through the normal route handlers, chooses actions with either built-in bots or `runHiddenInfoMcts()`, records replay frames, and returns training records for policy, value, and identity learning. The existing modeling helpers in `src/services/ml/modeling.js` already support minibatch-friendly policy, value, and identity updates with optimizer state objects. The browser already has a reusable god-view replay renderer in `public/js/modules/mlAdmin/replay.js`. Those pieces should stay in service; the change is the orchestration and user-facing workflow around them.

## Plan of Work

First, extend `src/services/ml/runtime.js` so the persistent state includes `runs` and a `run` counter. Add run-specific helpers that create and summarize runs, generations, replay-buffer statistics, evaluation history, and retained replay games. Each run will store the current best generation, a working model bundle that the trainer updates continuously, optimizer state for that working model, a replay buffer with position-level samples, retained replay games keyed by generation matchup, and a cycle-by-cycle metrics history. Keep the existing snapshot/simulation/training helpers intact for now because they remain useful implementation building blocks and reduce migration risk.

Second, implement the continuous loop inside the runtime. A started run should create generation `G0` from either a bootstrap model bundle or a fresh random bundle, then spawn one background task keyed by run id. Each loop iteration should generate a configured number of self-play games using the latest approved generation, optionally mixing in slightly older generations for robustness. From those games, derive replay-buffer positions using the existing MCTS training records. Enforce a sliding-window buffer by evicting the oldest positions once `replay_buffer_max_positions` is exceeded. If the buffer has enough data, sample minibatches randomly and update the working model for `training_steps_per_cycle` steps using the existing policy/value/identity trainers with configurable learning rate, batch size, weight decay, and gradient clipping.

Third, add evaluation and promotion. Every time cumulative training steps cross the configured checkpoint interval, treat the current working model as a candidate. Evaluate that candidate against the current best generation and against older generations chosen at the configured stride. Record per-opponent win rates, estimated Elo deltas, and promoted/not-promoted outcomes inside the run. If the candidate’s win rate against the current best meets or exceeds `promotion_winrate_threshold`, create a new approved generation, mark it as the new best, and refresh the logical self-play worker generation when the configured worker-refresh interval allows it. Record enough retained games from both self-play and evaluation so the replay panel can later filter by run id and generation pair.

Fourth, replace the route layer in `src/routes/v1/ml/index.js` with run-oriented endpoints while keeping the old helpers available internally. The key endpoints are: aggregated workbench data, run creation, run listing, run detail, run stop, generation-pair game listing, and replay lookup for one retained game. `GET /api/v1/ml/live` should return active run payloads, and the runtime should emit a new `ml:runProgress` event on `eventBus` so the `/admin` socket namespace can forward live updates to the browser just as it already does for the old simulation/training events.

Fifth, rebuild the browser workbench. `public/ml-admin.html` should expose exactly three major panels or tabs: `Config`, `Runs`, and `Replay`. `Config` contains the run name, self-play/training/evaluation knobs, and stop conditions. `Runs` shows a table of runs with live status plus a graph that plots stored generation-vs-generation win rates. `Replay` lets the user choose a run, choose two generations from that run, then choose a retained game between those generations and view it through the existing replay renderer. Replace the old loss-specific chart with a new generation-win chart module under `public/js/modules/mlAdmin/`. Reuse `public/js/modules/mlAdmin/replay.js` instead of rebuilding board replay rendering.

Finally, add tests and docs. Extend `tests/mlRuntime.test.js` to cover starting a run, progressing through self-play plus training plus evaluation, promoting at least one new generation, listing generation-pair games, and loading a replay for a retained run game. Update `tests/mlRoutes.test.js` so it validates the new workbench payload and new run endpoints. Rewrite `docs/ml-admin.md` to explain the new Config/Runs/Replay workflow.

## Concrete Steps

Work from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

1. Edit `src/services/ml/runtime.js` to add run state, run lifecycle helpers, the continuous loop, run summaries, replay-buffer sampling, evaluation bookkeeping, and run replay accessors.
2. Edit `src/routes/v1/ml/index.js` to expose the run-oriented API endpoints and aggregated workbench response.
3. Edit `src/socket.js` to forward `ml:runProgress` events and to emit live run payloads on admin socket connect.
4. Edit `public/ml-admin.html` and `public/ml-admin.js` to replace the old simulation/training workbench with the new run-oriented UI.
5. Add a chart helper such as `public/js/modules/mlAdmin/generationWinChart.js` and update `public/js/modules/mlAdmin/replay.js` only as needed for the new replay payload shape.
6. Update `docs/ml-admin.md`, `tests/mlRoutes.test.js`, and `tests/mlRuntime.test.js`.

As implementation proceeds, record any exact commands actually run here with short expected evidence snippets.

## Validation and Acceptance

Acceptance is behavioral:

1. Run the focused ML tests from the repository root:

    npm test -- tests/mlRoutes.test.js

    npm test -- tests/mlRuntime.test.js

   The new route tests must verify the run-oriented workbench and run endpoints. The new runtime tests must prove that a started run accumulates replay-buffer data, trains candidates, records evaluation results, promotes at least one generation when thresholds are permissive, and exposes replay for a retained run game.

2. Start the server on a non-3000 port if manual verification is needed, for example by setting `PORT=3100` before `npm run dev`.

3. Open `http://localhost:3100/ml-admin` while authenticated as the admin user. Verify:

   - The `Config` panel loads sensible defaults and starts a run successfully.
   - The `Runs` table shows the new run immediately, updates its live status, and later shows completed state if stop conditions are reached.
   - Selecting a run shows a generation win-rate graph with series labeled by prior generation, sampled at the configured stride.
   - The `Replay` panel allows selecting a run, then two generations from that run, then one retained game, and the board replay renders without console errors.

4. Confirm that progress is evaluated by head-to-head results, not only training loss. A promoted generation must show evaluation results against the previous best generation in the run detail and graph data.

## Idempotence and Recovery

The route and browser edits are safe to apply repeatedly because they replace the ML workbench contract rather than mutating live gameplay data. The runtime state file `data/ml/runtime.json` is the main persistence risk. When changing the state shape, preserve backward-compatible loading by defaulting missing `runs` fields and keeping the old snapshot/simulation/training arrays intact unless an explicit migration step is implemented. If a malformed state file blocks startup during development, the safe recovery path is to move or delete only `data/ml/runtime.json` and let the runtime recreate bootstrap state on next boot.

Run retention must stay bounded. The replay buffer is intentionally a sliding window, and retained run replay games must also be trimmed or stored externally so an endless run does not grow memory without limit. Any retention limits introduced during implementation must be recorded in this document and surfaced in run summaries so the operator understands what is being kept.

## Artifacts and Notes

Expected end-state artifacts include:

- `docs/ml-continuous-run-pipeline-execplan.md` updated with actual progress, decisions, and validation evidence.
- A run-oriented `/ml-admin` UI using the labels `Config`, `Runs`, and `Replay`.
- Runtime payloads that expose run counts, active runs, generation evaluation history, replay-buffer freshness, and generation-pair replay catalogs.

Short evidence snippets will be added here as commands are run.

- Route validation:

    npm.cmd test -- tests/mlRoutes.test.js

    PASS tests/mlRoutes.test.js
    4 passed, 4 total

- Runtime validation (focused new tests because the historical whole-file runtime suite remains too slow for the agent shell):

    $env:ENABLE_ML_WORKFLOW='true'; node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="continuous runs promote"

    PASS tests/mlRuntime.test.js
    continuous runs promote generations and expose replay by generation pair

    $env:ENABLE_ML_WORKFLOW='true'; node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="run workbench surfaces defaults"

    PASS tests/mlRuntime.test.js
    run workbench surfaces defaults, live runs, and stop requests

## Interfaces and Dependencies

`src/services/ml/runtime.js` must export new run-oriented methods on `MlRuntime`:

- `async getWorkbench()`: return aggregated run-oriented data used by `/ml-admin`.
- `async listRuns(options = {})`: return summarized runs ordered by most recent update.
- `async getRun(runId)`: return one full run record suitable for the detail view.
- `async startRun(options = {})`: create a run, spawn the background loop, and return `{ run, live }`.
- `async stopRun(runId)`: request stop for one active run.
- `async listRunGames(runId, generationA, generationB)`: return retained game summaries for one generation matchup.
- `async getRunReplay(runId, gameId)`: return the replay payload for one retained run game.

The live payload emitted on `eventBus` and the admin socket should be a run-oriented object with at least:

    {
      phase: 'start' | 'selfplay' | 'training' | 'evaluation' | 'promotion' | 'complete' | 'error' | 'stopping',
      runId: string,
      label: string,
      status: string,
      bestGeneration: number,
      workerGeneration: number,
      cycle: number,
      totalTrainingSteps: number,
      totalSelfPlayGames: number,
      replayBuffer: {
        positions: number,
        oldestGeneration: number | null,
        newestGeneration: number | null,
        freshness: number | null
      },
      latestLoss: {
        policyLoss: number,
        valueLoss: number,
        identityLoss: number,
        identityAccuracy: number
      } | null,
      latestEvaluation: {
        candidateGeneration: number | null,
        againstBest: { generation: number, winRate: number, wins: number, losses: number, draws: number } | null
      } | null,
      message?: string,
      timestamp: string
    }

If this plan changes materially during implementation, update every section above and append a short note below describing what changed and why.

Revision note (2026-03-11 / Codex): updated the plan after implementation to record the completed runtime/API/UI/test work, the focused Jest commands that actually passed, and the residual compatibility decision to leave the old simulation/training helpers in place internally.
