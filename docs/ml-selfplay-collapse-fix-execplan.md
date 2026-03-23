# Repair ML Self-Play Collapse, Replay Confidence, And Value-Target Diagnostics

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](../PLANS.md).

## Purpose / Big Picture

After this change, continuous ML runs should stop collapsing into nearly identical opening games where both sides repeat the same first move, challenge immediately, and end by `true_king`. A human should be able to start or inspect a run, see varied opening boards and varied early move sequences in retained replays, confirm that value targets are still present in training batches, and trust that replay browsing is showing distinct retained games rather than an accidental duplicate view.

## Progress

- [x] (2026-03-20 14:42 -07:00) Re-read `PLANS.md`, the ML subtree notes, the route-level gameplay notes, and the replay UI contracts before touching the code.
- [x] (2026-03-20 14:49 -07:00) Reproduced engine-fast setup diversity directly from `createInitialState()` and confirmed that starting setups do vary across seeds before any replay/UI code is involved.
- [x] (2026-03-20 14:57 -07:00) Reproduced the self-play collapse in `runFastGame()`: across 20 probe games, every game ended by `true_king`, the first move always stepped the leftmost white piece forward, and the first declaration was always king.
- [x] (2026-03-20 15:03 -07:00) Confirmed move generation is not omitting opening moves: the opening state exposed 60 legal declared move actions, including multiple declarations per geometry where the rules allow them.
- [x] (2026-03-20 15:11 -07:00) Confirmed Node-side training batches do produce non-zero value loss on real self-play samples, so `V 0.000` is not explained by a blanket absence of value targets in the shared-family replay path.
- [x] (2026-03-20 17:06 -07:00) Patched self-play action selection so training games can sample from root visit counts with a self-play-only stochastic root, while evaluation remains greedy.
- [x] (2026-03-20 17:21 -07:00) Fixed two shared-family replay-buffer bugs: compacted value and identity samples were being dropped during sanitization, and compacted identity samples were being re-selected by coarse `createdAt` fallback instead of matching `sampleKey`.
- [x] (2026-03-20 17:34 -07:00) Fixed runtime task payload construction so explicit game phases are forwarded to worker game tasks instead of silently defaulting every task back to `selfplay`.
- [x] (2026-03-20 17:52 -07:00) Added focused Jest coverage for preserved shared-family value/identity targets, evaluation-phase propagation, and opening diversity across fixed seeds.
- [x] (2026-03-20 18:29 -07:00) Ran focused validation and captured direct probe evidence showing replay batches now retain value and identity targets and that openings vary across seeds.

## Surprises & Discoveries

- Observation: the engine-fast setup path is already random.
  Evidence: direct probes of `src/services/ml/engine.js:createInitialState()` produced different opening boards, on-deck pieces, and stash contents for seeds `9000` through `9004`.

- Observation: the collapse happens after setup generation, during action selection.
  Evidence: in 20 direct `runFastGame()` probes with distinct seeds, the opening boards varied, but the first move always had geometry `0,0 -> 1,0`, always declared king, and every game ended with `winReason: "true_king"`.

- Observation: opening search is intentionally weakened by the current adaptive-search fast path.
  Evidence: `src/services/ml/gameRunner.js:buildAdaptiveSearchOptions()` quarters iterations for the first several plies and clamps hidden-identity hypotheses down to `1` in opening quiet positions.

- Observation: legal move generation is broad enough that the repeated opening is not explained by a missing-moves bug.
  Evidence: `getLegalActions(createInitialState({ seed: 5000 }), WHITE)` returned 60 opening move actions covering king, rook, bishop, and knight declarations where the geometry permits them.

- Observation: Node-side shared-family training still sees value samples and non-zero value loss on probe data.
  Evidence: a direct `trainModelBundleBatch()` call on one probe game returned `valueLoss ~= 0.988` with `valueSamples: 3`.

- Observation: shared-family replay-buffer sanitization was dropping all compacted value and identity samples before training.
  Evidence: after `appendRunReplayBuffer()`, `sampleReplayBufferSamples()` immediately reduced shared-model replay batches to `policy > 0`, `value = 0`, `identity = 0` because compacted samples retained only correlation metadata plus targets.

- Observation: shared-family identity replay selection was also over-broad because all samples from one game shared the same `createdAt`.
  Evidence: `sampleReplayBufferSamples()` was pulling identity samples for plies that were not in the sampled policy batch, so `buildSharedTrainingSamples()` could not merge them back onto a sampled state input and dropped the identity targets.

## Decision Log

- Decision: treat the opening-collapse symptom as a self-play policy-generation bug first, not a replay-only UI bug.
  Rationale: the repeated first move and `true_king` outcome reproduce directly in `runFastGame()` before replay compaction or browser rendering.
  Date/Author: 2026-03-20 / Codex

- Decision: preserve evaluation greediness while making self-play stochastic at the root.
  Rationale: evaluation should stay stable and comparable across checkpoints, while self-play needs controlled diversity to generate useful policy targets.
  Date/Author: 2026-03-20 / Codex

- Decision: keep checking replay/runtime integrity even though the core collapse is already reproduced in the engine.
  Rationale: the user reported a replay-level symptom, so the work is not complete until retained replay browsing is shown to preserve distinct games.
  Date/Author: 2026-03-20 / Codex

## Outcomes & Retrospective

Implemented results:

- Self-play openings now use stochastic root action selection, with temperature-controlled sampling from root visit counts and less aggressive opening search throttling.
- Continuous-run worker tasks now preserve the requested phase, so evaluation no longer silently inherits self-play defaults.
- Shared-family replay sampling now preserves compacted value and identity targets through sanitization and sampling, which restores value-head and identity-head training signal.

Validation evidence:

- Direct opening probe: `createInitialState()` still produced distinct opening boards for seeds `9000..9004`.
- Direct move-coverage probe: the opening state still exposed `60` legal actions, `runHiddenInfoMcts()` reported `60` root action stats, and `legalActionMismatchCount` stayed `0`.
- Direct replay-batch probe after the fix: a shared replay batch retained `policy: 20`, `value: 20`, and `identity: 142` samples in the buffer, and the sampled batch produced shared samples with both finite `valueTarget` fields and merged `identityTargets`.
- Focused Jest run: `ENABLE_ML_WORKFLOW=1 node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js -t "sampleReplayBufferSamples includes combined shared samples for the active shared-family path|playRunGenerationGames preserves evaluation phase and keeps root sampling deterministic|self-play fast games vary openings across seeds"` passed all three targeted tests.

## Context and Orientation

The self-play and evaluation game loop lives in `src/services/ml/runtime.js`. That runtime builds game tasks, launches engine-fast worker games, appends replay/training samples into the live replay buffer, and exposes retained replays to `/api/v1/ml/runs/:runId/games` and `/api/v1/ml/runs/:runId/replay/:gameId`.

The engine-fast game runner lives in `src/services/ml/gameRunner.js`. It creates a random opening state with `createInitialState()` from `src/services/ml/engine.js`, asks the MCTS layer for an action, applies that action, records replay frames, and converts the resulting decisions into policy, value, and identity training samples.

The hidden-information search lives in `src/services/ml/mcts.js`. Today it returns a single selected action by taking the highest-visit root move. That is acceptable for evaluation, but it makes self-play deterministic when the model is weak and the opening search budget is small.

The retained replay browser is split between `public/ml-admin.js` and `public/js/modules/mlAdmin/replay.js`. The browser lists retained evaluation games by id, loads a replay payload by id, and renders the stored frame boards in god view. If different retained games look identical there, either the runtime is storing duplicate data or the browser is reusing the wrong replay payload.

The current investigation already established that the engine setup randomization is working and that legal move generation is not missing opening moves. The remaining work is to fix the self-play collapse, prove replay browsing is distinct, and either fix or explicitly rule out a value-target bug in the active training path.

## Plan of Work

First, update `src/services/ml/mcts.js` and `src/services/ml/gameRunner.js` so self-play can use stochastic root action selection. The root should continue to produce the same policy target vector for training, but the executed move in self-play should come from a sampled distribution rather than the raw max-visit argmax. The change must be self-play-only so checkpoint evaluation remains deterministic. If root-prior noise is needed as well, keep it behind a self-play-specific option and apply it only at the root.

Second, revisit the opening fast-path policy in `src/services/ml/gameRunner.js`. The existing adaptive-search logic sharply reduces opening iterations and collapses opening hypotheses to one guessed hidden world. If the stochastic-root change alone does not sufficiently diversify the first few plies, loosen those opening clamps for self-play while leaving evaluation behavior conservative enough to stay fast and comparable.

Third, inspect retained replay storage in `src/services/ml/runtime.js` and replay loading/rendering in `public/ml-admin.js` and `public/js/modules/mlAdmin/replay.js`. Confirm that compacted retained games preserve distinct seeds, frame boards, and action histories; if not, patch the offending compaction or selection logic.

Fourth, add tests in `tests/mlRuntime.test.js` and any other focused Jest file that best matches the behavior. The tests should prove that distinct seeds produce distinct retained opening states, that self-play no longer always chooses the same opening action across many seeds, that replay browsing returns the correct retained game by id, and that value samples remain present in shared-family training batches after the replay buffer compaction path.

## Concrete Steps

Work from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

1. Edit `src/services/ml/mcts.js` to add self-play-specific root stochasticity and, if needed, root-prior noise hooks.
2. Edit `src/services/ml/gameRunner.js` so self-play enables those hooks while evaluation remains greedy.
3. Inspect and patch `src/services/ml/runtime.js`, `public/ml-admin.js`, and `public/js/modules/mlAdmin/replay.js` if retained replay data is being collapsed or the wrong replay is loaded by id.
4. Add or update Jest coverage in `tests/mlRuntime.test.js` and the smallest supporting test file that keeps the behavior locked in.
5. Run focused test slices and record the results here.

## Validation and Acceptance

Acceptance is behavioral.

Run focused Jest slices that prove:

- opening seeds still produce distinct opening boards;
- engine-fast self-play does not always choose the same first move across many seeds;
- retained replay reads return the game requested by id and preserve distinct opening boards or action histories between games;
- shared-family training batches still include value targets and produce non-zero value-loss metrics on probe data.

If browser verification is needed, start the app on a non-3000 port, open `/ml-admin`, inspect a run with multiple retained evaluation games, and verify that selecting different replay ids changes the opening board and move log.

## Idempotence and Recovery

These edits are ordinary source changes and test additions. They are safe to re-run. If a change to stochastic self-play makes a test flaky, tighten the test to assert aggregate diversity over a fixed seed set rather than one exact move sequence. If replay verification shows no browser bug after the engine fix, keep the replay tests that prove distinct ids still map to distinct retained games and do not invent a UI patch.

## Artifacts and Notes

Important evidence captured during investigation:

  - `createInitialState()` with seeds `9000..9004` produced different opening boards and on-deck pieces, so setup randomization already exists.
  - `runFastGame()` with seeds `7000..7019` produced different openings but the same first-move geometry and `winReason: "true_king"` in all 20 games.
  - `getLegalActions()` on an opening state returned 60 move actions, showing move generation is not obviously omitting legal declarations.
  - A direct Node `trainModelBundleBatch()` probe on one self-play game returned non-zero `valueLoss`, so the value-target path is at least functional in the Node backend.

## Interfaces and Dependencies

At the end of this task:

- `src/services/ml/mcts.js` should still export `runHiddenInfoMcts(modelBundle, rootState, options)` and keep the existing result shape, but it may accept new self-play-only options such as a stochastic root selector or root noise.
- `src/services/ml/gameRunner.js` should still export `runFastGame(options, hooks)` and keep replay/training payload compatibility with `src/services/ml/runtime.js`.
- `src/services/ml/runtime.js` must keep `/runs/:runId/games` and `/runs/:runId/replay/:gameId` compatible with `public/js/modules/mlAdmin/replay.js`.
- `public/js/modules/mlAdmin/replay.js` must continue to render retained games in god view from the stored replay frames.

Revision note (2026-03-20 / Codex): created this ExecPlan after reproducing the engine-fast self-play collapse, confirming that setup randomization and legal move generation are already working, and narrowing the remaining work to root stochasticity, replay confidence, and value-target diagnostics.
