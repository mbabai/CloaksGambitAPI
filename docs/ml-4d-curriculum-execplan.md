# Implement 4D Self-Play Curriculum For ML Runs

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows [PLANS.md](../PLANS.md) from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, continuous-run self-play no longer has to start every training game from the same full fast-start setup. Operators can set one `curriculumCadence` dial in `/ml-admin`, and the runtime will slowly shift self-play openings from advanced endgames toward proper setup-like starts while still sampling the full 4D space: white board material, black board material, board advancement, and total daggers. The feature is observable by starting a run with a chosen cadence, inspecting the saved run config, and running the focused ML Jest coverage that proves early curriculum samples are endgame-heavy while later samples become setup-heavy.

## Progress

- [x] (2026-03-21 08:35 -07:00) Researched the engine-fast setup path, worker-thread handoff, run-config normalization, and `/ml-admin` config plumbing.
- [x] (2026-03-21 09:05 -07:00) Implemented curriculum-aware engine start-state generation that preserves the existing hidden reserve model and only activates when a self-play task explicitly supplies curriculum data.
- [x] (2026-03-21 09:22 -07:00) Added persisted `curriculumCadence` run config support and threaded per-game curriculum progression through self-play worker task payloads only.
- [x] (2026-03-21 09:31 -07:00) Exposed the cadence control in `public/ml-admin.html` and `public/ml-admin.js`, and updated operator/developer docs.
- [x] (2026-03-21 09:52 -07:00) Added focused Jest coverage for curriculum distribution, state invariants, runtime payload wiring, and affected workbench defaults.
- [x] (2026-03-21 10:08 -07:00) Verified targeted runtime and route tests, plus existing fast-runner and continuous-run regression coverage.

## Surprises & Discoveries

- Observation: the worker-thread self-play path already accepts arbitrary structured-clone-safe game options, so no worker protocol redesign was needed.
  Evidence: `src/services/ml/parallelTaskWorker.js` already forwards `task.options` directly into `runFastGame()`.

- Observation: the existing fast-start representation always keeps one on-deck piece and two stash pieces per side, which gave a clean way to reduce board material without redesigning hidden reserves.
  Evidence: the previous `createInitialState()` always built `5` board pieces, `1` on-deck piece, and `2` stash pieces from the fixed 8-piece side pool.

- Observation: running the full `tests/mlRuntime.test.js` suite was too slow to use as a single validation gate in this environment, so targeted long-path tests were more reliable.
  Evidence: two full-suite attempts hit the shell timeout window, while focused continuous-run tests passed in about 13 seconds.

## Decision Log

- Decision: keep the current engine-fast hidden reserve layout and convert reduced board material into public captured pieces instead of removing pieces from the side pool.
  Rationale: this matches the requested behavior, preserves existing on-deck/stash mechanics, and avoids touching route-parity rules or model input shape.
  Date/Author: 2026-03-21 / Codex

- Decision: apply the curriculum only to continuous-run self-play, not evaluation, snapshot simulations, or live test games.
  Rationale: the user explicitly asked for training-only behavior, and keeping evaluation on the normal setup path preserves comparability between checkpoints.
  Date/Author: 2026-03-21 / Codex

- Decision: use a smooth binomial distribution with a small uniform exploration mix instead of hard curriculum rungs.
  Rationale: this preserves the requested “slow shift” while still visiting all corners of the 4D space throughout training.
  Date/Author: 2026-03-21 / Codex

- Decision: compute curriculum progress from `totalSelfPlayGames` plus the per-batch game index and pass that explicit game index into each self-play task.
  Rationale: this keeps progression stable across chunked execution, parallel workers, and resumed runs.
  Date/Author: 2026-03-21 / Codex

## Outcomes & Retrospective

The feature landed as a self-play-only extension of the existing engine-fast setup path. The runtime now persists a single operator-facing cadence dial, self-play game tasks derive deterministic curriculum progress from run history, and the engine samples curriculum-biased states without changing evaluation behavior or the live-route gameplay contract. The main remaining limitation is that the full runtime Jest suite is still too slow to use as one broad gate in this shell session, so validation relied on focused coverage that directly exercises the touched paths.

## Context and Orientation

The relevant runtime is split across three files. `src/services/ml/runtime.js` owns continuous-run configuration, self-play batching, worker payload assembly, and workbench summaries. `src/services/ml/gameRunner.js` runs one engine-fast game from a generated starting state. `src/services/ml/engine.js` creates the actual hidden-information state used by search and replay recording. The admin workbench lives in `public/ml-admin.html` and `public/ml-admin.js`, while operator notes live in `docs/ml-admin.md`.

A “fast-start” state in this repository means a post-setup position built directly inside the ML engine instead of replaying route-level setup actions. Each side still owns the fixed 8-piece pool defined in `src/services/ml/engine.js`: king, two rooks, two bishops, two knights, and one bomb. Before this change, fast-start always placed five pieces on the home row, one on deck, and two in stash.

The new curriculum keeps that pool intact but changes how a self-play start state is sampled. For each self-play game, the runtime computes one curriculum progress number. The engine then samples four dimensions from that progress-biased distribution: white board pieces (`1..5`), black board pieces (`1..5`), advance depth (`0..4` ranks from the side’s own back rank), and total daggers (`0..4`, allocated randomly with at most two per player). Missing board pieces become public captured pieces, which are stored in the existing `state.captured` arrays and marked revealed in `state.revealedIdentities`.

## Plan of Work

First, extend `src/services/ml/engine.js` so `createInitialState(options)` accepts an optional `options.curriculum` object. Keep the old setup path as the default. When curriculum is present, sample the four curriculum dimensions from a smooth progress-biased distribution, place board pieces inside the allowed rank band for each color, assign missing board pieces into the opponent’s captured list, keep one on-deck piece plus two stash pieces per side, and set daggers from the sampled total. Return curriculum metadata on the state so tests and replays can inspect what was sampled.

Second, extend `src/services/ml/gameRunner.js` and `src/services/ml/runtime.js`. `runFastGame()` must pass the optional curriculum object into `createInitialState()` and preserve the sampled curriculum metadata on the game result and initial replay frame. `runtime.js` must add `curriculumCadence` to the persisted run config defaults, normalize it on run creation, and pass per-game curriculum data only for `phase === 'selfplay'` when building worker task payloads.

Third, expose the dial in `public/ml-admin.html` and `public/ml-admin.js`, and document it in `docs/ml-admin.md` plus the closest owning AGENTS files. The field should load from defaults, submit on run creation, and appear in the selected-run config rendering.

Fourth, add tests in `tests/mlRuntime.test.js` that verify the distribution shift, the curriculum state invariants, and the runtime task-payload wiring. Re-run the existing targeted runtime and route tests that cover start-run defaults, fast self-play, and continuous-run batching.

## Concrete Steps

From the repository root, inspect the ML runtime surfaces:

    rg -n "createInitialState|runFastGame|buildRunGameTaskPayload|playRunGenerationGames" src/services/ml

Run the focused validation:

    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRoutes.test.js tests/mlRuntime.test.js --runInBand --testNamePattern="curriculum|run workbench surfaces defaults|startRun applies hardware-tuned defaults|startRun caps worker defaults and overrides by max logical processors|POST /runs starts a continuous ML run|GET /workbench returns the aggregated run payload"

Expected result:

    PASS tests/mlRoutes.test.js
    PASS tests/mlRuntime.test.js

Run the fast-runner regression checks:

    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="appendRunReplayBuffer accepts shared-model self-play samples emitted by runFastGame|self-play fast games vary openings across seeds"

Run the continuous-run regression checks:

    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="continuous runs promote generations and expose replay by generation pair|continuous self-play emits partial progress updates while chunking long batches|continuous runs can overlap background training with the next self-play cycle"

## Validation and Acceptance

Acceptance is:

1. Starting a run from `/ml-admin` shows a `Curriculum Cadence` input and the selected run config later reports the saved value.
2. `createInitialState({ curriculum: { progress: 0 } })` samples endgame-heavy starts on average, while `progress: 1` samples setup-heavy starts on average.
3. Curriculum-generated states keep the fixed reserve model intact: one on-deck piece, two stash pieces, public captured pieces for missing board slots, and legal dagger totals with at most two per side.
4. `runtime.buildRunGameTaskPayload()` includes curriculum data for self-play tasks and omits it for evaluation tasks.
5. The focused Jest commands above pass.

## Idempotence and Recovery

These edits are additive and safe to re-run. If a test flakes because of randomness, keep the assertions distribution-based across many seeds instead of expecting one exact sampled state. If a saved runtime file predates this feature and does not include `curriculumCadence`, the runtime should continue to load it without migration; only new runs need the new default.

## Artifacts and Notes

Focused validation transcripts captured during implementation:

    PASS tests/mlRoutes.test.js
    PASS tests/mlRuntime.test.js

    PASS tests/mlRuntime.test.js
      √ appendRunReplayBuffer accepts shared-model self-play samples emitted by runFastGame
      √ self-play fast games vary openings across seeds

    PASS tests/mlRuntime.test.js
      √ continuous runs promote generations and expose replay by generation pair
      √ continuous self-play emits partial progress updates while chunking long batches
      √ continuous runs can overlap background training with the next self-play cycle

The full `tests/mlRuntime.test.js` suite exceeded the shell timeout window in this session, so the targeted commands above are the reliable proof captured here.

## Interfaces and Dependencies

At the end of this work, these interfaces must exist:

- `src/services/ml/engine.js:createInitialState(options)` accepts `options.curriculum` with either a direct `progress` number or a `{ gameIndex, cadence }` pair.
- `src/services/ml/runtime.js:createDefaultRunConfig()` and `normalizeRunConfig()` include `curriculumCadence`.
- `src/services/ml/runtime.js:buildRunGameTaskPayload(run, options)` attaches `options.curriculum` only for self-play tasks.
- `public/ml-admin.js:readRunConfigForm()` reads `curriculumCadence`, and `applyDefaults()` populates it.

Revision note (2026-03-21 / Codex): created this ExecPlan alongside the implementation so the feature remains reproducible from the repository alone, including the targeted validation commands that passed in this session.
