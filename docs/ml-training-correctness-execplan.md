# Repair ML Hidden-Info Search And Promotion Correctness

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](../PLANS.md).

## Purpose / Big Picture

After this change, the Cloak's Gambit ML pipeline stops training on hidden-information leaks and impossible belief states. Self-play search now evaluates guessed hidden worlds without reading unrevealed truth from the live state, the identity model can represent bombs, and candidate promotion is judged against the actual current best generation instead of a stale curriculum rung. A human can verify the change by running the focused Jest suites listed below and by opening the ML workbench, where the default risk bias is now neutral and the latest evaluation card reports the real best-model opponent generation.

## Progress

- [x] (2026-03-12 12:04 -07:00) Read `src/services/ml/runtime.js`, `src/services/ml/mcts.js`, `src/services/ml/modeling.js`, `src/services/ml/engine.js`, and the relevant Jest files to trace hidden-state handling, replay sampling, evaluation, and promotion.
- [x] (2026-03-12 12:18 -07:00) Reproduced the bomb-belief failure: the identity head omitted bombs, opening hypotheses could not represent the true hidden assignment, and sampled hypotheses violated per-piece count limits.
- [x] (2026-03-12 12:22 -07:00) Reproduced the promotion bug: `evaluateRunGeneration()` could promote a candidate against generation 0 while `bestGeneration` was higher.
- [x] (2026-03-12 12:30 -07:00) Reproduced the risk-bias asymmetry and confirmed that `riskBias=0.5` was not neutral.
- [x] (2026-03-12 13:25 -07:00) Reworked `src/services/ml/mcts.js` so hidden-info search determinizes one root search per identity hypothesis, uses guessed identities for state transitions, and keeps policy/value features observation-based.
- [x] (2026-03-12 13:43 -07:00) Extended `src/services/ml/modeling.js` to include bomb labels, enforce identity-count legality in hypothesis generation, and treat `riskBias=0` as neutral.
- [x] (2026-03-12 13:54 -07:00) Updated `src/services/ml/runtime.js` so promotion is gated on candidate versus current best and continuous-run defaults use neutral risk bias.
- [x] (2026-03-12 14:10 -07:00) Added regression coverage in `tests/mlRuntime.test.js` for bomb-inclusive hypotheses, hidden-truth independence, neutral risk bias, and current-best promotion.
- [x] (2026-03-12 14:24 -07:00) Updated `public/ml-admin.js` so the workbench honors `riskBias=0` and labels the primary evaluation as the current best-model comparison.
- [x] (2026-03-12 14:31 -07:00) Ran the focused Jest validation commands in this document and recorded the passing evidence below.

## Surprises & Discoveries

- Observation: the original "hidden-info" MCTS only averaged policy and value predictions across hypotheses; the tree itself still advanced a full-truth state.
  Evidence: `src/services/ml/runtime.js` built a truth-bearing shadow state, `src/services/ml/mcts.js` passed hypotheses only into `predictPolicy()` and `predictValue()`, and child nodes still came from `applyAction(node.state, action)`.

- Observation: the belief model could never assign `BOMB`, which made the opening information set impossible to represent because the opponent starts with eight hidden pieces but only seven non-bomb slots across king, rooks, bishops, and knights.
  Evidence: the opening-state probe showed one hidden bomb every time, `INFERRED_IDENTITIES` omitted `BOMB`, and every top hypothesis exceeded non-bomb piece limits.

- Observation: the promotion tests had started to encode the wrong behavior by proving advancement against generation 0 rather than promotion against `bestGeneration`.
  Evidence: the old test around `evaluation target advances only after clearing the 90 percent gate` matched the stale-target runtime logic.

- Observation: the ML workbench had a second-order regression even after the backend default changed because the browser form still parsed and rendered `riskBias` with `0.5` as the fallback, and its summary card labeled the matchup as a moving "gate" instead of the actual best-model opponent.
  Evidence: `public/ml-admin.js` used `defaults.riskBias || 0.5`, parsed form input with `0.5`, and built `Vs Gate G...` from `evaluationTargetGeneration` instead of `latestEvaluation.againstBest`.

## Decision Log

- Decision: fix hidden-information correctness by determinizing one root search per legal identity hypothesis and aggregating root visit counts, rather than by keeping a single truth-state tree with hypothesis-weighted leaf evaluations.
  Rationale: this is the smallest change that makes transitions, challenge resolution, and bomb handling depend on guessed worlds instead of leaked truth.
  Date/Author: 2026-03-12 / Codex

- Decision: keep policy and value features observation-based during determinized search instead of passing guessed identities into the policy/value heads.
  Rationale: the training pipeline stores one feature packet per position, not one packet per hypothesis. Observation-based features remove the training and inference mismatch while search still branches over hidden states.
  Date/Author: 2026-03-12 / Codex

- Decision: gate promotion strictly on candidate versus current best, and treat older-generation comparisons as diagnostics rather than promotion criteria.
  Rationale: the runtime must answer "can this candidate beat the best model we have now?" before replacing that best model.
  Date/Author: 2026-03-12 / Codex

- Decision: keep `againstTarget` in the evaluation payload as an alias of `againstBest` for now, while moving UI presentation and promotion logic onto the best-model framing.
  Rationale: this preserves compatibility for existing consumers while removing the stale-target semantics from the actual decision path.
  Date/Author: 2026-03-12 / Codex

## Outcomes & Retrospective

The core correctness issues were repaired in the ML search, belief modeling, promotion logic, and workbench defaults. The new tests show that two states that differ only in unrevealed truth now produce the same root decision, bomb-inclusive hypotheses stay within legal identity counts, and a candidate is only promoted after beating the current best generation. The main remaining work is instrumentation and broader longitudinal validation on real training runs, not another round of speculative logic fixes.

## Context and Orientation

The ML runtime is concentrated in four files. `src/services/ml/runtime.js` orchestrates self-play, training, replay buffering, evaluation, and generation promotion. `src/services/ml/mcts.js` performs search for self-play and evaluation participants. `src/services/ml/modeling.js` defines the policy, value, and identity models together with the training helpers that consume replay samples. `src/services/ml/engine.js` is the deterministic local game engine that search uses for legal actions and state transitions.

In this repository, a "hypothesis" means one guessed assignment of identities to the opponent pieces that are still hidden from the acting player. A "determinization" means cloning the search state and writing one such guessed assignment into those hidden opponent pieces so the engine can simulate challenge and bomb outcomes consistently inside that guessed world. The browser workbench for continuous runs is `public/ml-admin.js`, and the high-signal regression suite for these changes is `tests/mlRuntime.test.js`.

Before this repair, the runtime rebuilt a shadow state from full live-game truth, then allowed the engine to resolve challenges and bombs from that hidden truth even while policy and value predictions were being averaged across guessed hypotheses. At the same time, the identity head could not output bombs, so the true opening hidden state was unrepresentable, and continuous-run promotion compared candidates against `evaluationTargetGeneration`, which could lag behind the actual best model.

## Plan of Work

Start in `src/services/ml/modeling.js`. Expand `INFERRED_IDENTITIES` to include bombs, update the identity-training path so bomb labels are valid targets, and tighten `buildIdentityHypotheses()` so it never emits assignments that exceed the legal piece counts after accounting for already revealed opponent identities. Keep `applyRiskBiasToHypotheses()` neutral at zero and treat the input values as root-perspective values.

Then repair `src/services/ml/mcts.js`. Split the old implementation into an internal deterministic search over one fully specified guessed world and a root-level wrapper that infers hypotheses, clones one determinized root state per hypothesis, runs the deterministic search for each, and aggregates root visit counts and values. Keep feature extraction observation-based so the replay samples still match what the model can actually observe later.

After that, update `src/services/ml/runtime.js`. Candidate evaluation must compare the candidate generation against `bestGeneration` for promotion, while older-generation comparisons remain optional diagnostics. Default `riskBias` to zero so new continuous runs start from the neutral search setting.

Finally, update `tests/mlRuntime.test.js` and `public/ml-admin.js`. The tests must lock in bomb-inclusive hypothesis legality, hidden-truth independence, neutral risk bias, and current-best promotion. The workbench must preserve a literal zero risk bias in both form hydration and form submission, and its run summary must label the primary evaluation using the actual best-model opponent generation from the latest evaluation record.

## Milestones

The first milestone is model and search correctness. At the end of that milestone, the search tree no longer reads unrevealed live-game truth to resolve hidden-information actions, and the belief model can represent bombs legally. The proof is the new regression test that compares two observation-identical pending-challenge states with different underlying truth and gets the same search decision, plus the bomb-hypothesis legality test.

The second milestone is promotion correctness. At the end of that milestone, continuous-run evaluation promotes a candidate only if it beats the current best generation. The proof is the targeted Jest test that spies on `playRunGenerationGames()` and verifies that generation 6 is evaluated against generation 5 when generation 5 is the best model.

The third milestone is operator visibility. At the end of that milestone, the ML workbench presents the corrected neutral default and labels the evaluation summary by the actual best-model opponent generation, which makes the browser surface consistent with the backend decision path.

## Concrete Steps

Work from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

1. Read the runtime, MCTS, modeling, engine, and ML Jest files to confirm where search, belief inference, and promotion are implemented.
2. Edit `src/services/ml/modeling.js` to add bomb labels, enforce legal identity counts, and make neutral risk bias explicit.
3. Replace the hidden-info search path in `src/services/ml/mcts.js` with determinized root aggregation over guessed worlds.
4. Edit `src/services/ml/runtime.js` to evaluate candidates against `bestGeneration` and default `riskBias` to zero.
5. Extend `tests/mlRuntime.test.js` with regression coverage for the corrected behavior.
6. Edit `public/ml-admin.js` so the workbench preserves `riskBias=0` and shows the real best-opponent evaluation label.
7. Run the following commands and compare the output against the examples here.

   In PowerShell:

      npm.cmd test -- tests/mlStateEncoding.test.js

   Expected result:

      PASS tests/mlStateEncoding.test.js
      Tests:       4 passed, 4 total

   In PowerShell with ML workflow enabled:

      $env:ENABLE_ML_WORKFLOW='true'
      node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="identity hypotheses include bombs|risk bias zero is neutral|evaluation promotes only against the current best generation|hidden-info search does not depend|continuous runs promote|run workbench surfaces defaults"

   Expected result:

      PASS tests/mlRuntime.test.js
      Tests:       6 passed, 26 skipped, 32 total

   Optional extra safety slice:

      $env:ENABLE_ML_WORKFLOW='true'
      node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="bootstraps snapshots and stores replayed simulations|mcts supports on-deck action phases"

   Expected result:

      PASS tests/mlRuntime.test.js
      Tests:       2 passed, 30 skipped, 32 total

## Validation and Acceptance

Acceptance is behavioral. Run `npm.cmd test -- tests/mlStateEncoding.test.js` and expect the four existing state-encoding tests to pass. Then run the focused ML runtime command above and expect the new regression tests to pass together with the existing continuous-run and workbench tests. The key human-level behaviors are:

- a hidden opponent bomb is representable by the identity model and appears in generated hypotheses without violating piece-count limits;
- two states that are identical from the acting player's perspective but differ only in unrevealed truth produce the same root search action and value estimate;
- `riskBias=0` leaves symmetric hypothesis values unchanged;
- a candidate does not promote unless it meets the threshold against the current `bestGeneration`;
- the workbench form preserves a literal zero risk bias and labels the primary evaluation as `Vs Best G...`.

## Idempotence and Recovery

These edits are additive and safe to rerun. The safe recovery path is file-by-file review with `git diff` rather than destructive checkout commands, because this repository already contains unrelated in-progress ML work. If a focused Jest command fails, keep the changed files, inspect the failing test name against the sections above, and rerun only that slice until the observable behavior matches the acceptance criteria.

## Artifacts and Notes

The most important evidence from the investigation and implementation is:

  - Opening-state probe before the fix: hidden bomb present, `truthRepresentable: false`, and every top hypothesis exceeded non-bomb piece counts.
  - Promotion probe before the fix: `bestGeneration: 5`, `evaluatedAgainst: 0`, `promoted: true`.
  - Root-target sharpness probe before the fix: with 90 simulations the average legal action count was about 58.6 and the top action received about 17.5 percent of visits.
  - Focused regression after the fix: `hidden-info search does not depend on unrevealed ground-truth identities` passed, proving the old truth leak is blocked.
  - Focused regression after the fix: `evaluation promotes only against the current best generation` passed, proving the evaluator now loads the correct opponent generation.

## Interfaces and Dependencies

At the end of this task, `src/services/ml/mcts.js` still exports `runHiddenInfoMcts(modelBundle, rootState, options)` and `terminalValueForRoot(state, rootPlayer)`. `runHiddenInfoMcts()` still returns an object with `action`, `policyTarget`, `valueEstimate`, `trace`, and `trainingRecord`, but the trace now describes aggregated hypothesis searches rather than a single truth-state tree.

`src/services/ml/modeling.js` still exports `inferIdentityHypotheses()`, `applyRiskBiasToHypotheses()`, `trainIdentityModel()`, `trainPolicyModel()`, and `trainValueModel()`. `inferIdentityHypotheses()` can now emit hypotheses containing `IDENTITIES.BOMB`, and `trainIdentityModel()` treats bomb labels as valid supervised targets.

`src/services/ml/runtime.js` still exposes `evaluateRunGeneration()` and the continuous-run methods on `MlRuntime`, but promotion is computed from the candidate-versus-best result. `public/ml-admin.js` still drives the same ML workbench controls, but it must preserve a literal zero risk bias and read the primary evaluation summary from `latestEvaluation.againstBest` when available.

Revision note (2026-03-12 / Codex): rewrote this ExecPlan after implementation so it now reflects the completed search, belief, promotion, and workbench fixes, includes the exact validation commands that passed, and records the UI follow-up needed to keep the browser surface aligned with the backend behavior.
