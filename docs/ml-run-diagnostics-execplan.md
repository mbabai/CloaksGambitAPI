# ML Run Diagnostics And Action-Coverage Checks

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](../PLANS.md).

## Purpose / Big Picture

After this change, the ML admin run view will stop forcing the operator to infer collapse from a noisy win-rate chart alone. A selected run will expose concrete diagnostics for recent self-play: starting-setup variety, first-move and opening-prefix variety, exact-sequence repetition, simple-action exposure and choice rates (`challenge`, `bomb`, `pass`, `on-deck`), replay-target coverage for policy/value/identity heads, and warnings when those signals indicate collapse or missing training targets.

This matters because the current failure mode is not just “low strength”; it is “the system can silently learn on weak or degenerate data and the UI does not tell us why.” The result must make it possible to open `/ml-admin`, inspect a run, and answer three questions directly: are openings diverse, are simple actions actually entering training/search, and are value/identity targets still flowing.

## Progress

- [x] (2026-03-20 22:20Z) Re-read `PLANS.md` and the ML/game-action AGENTS documents, then mapped the run summary, live payload, retained-game compaction, and selected-run UI render path.
- [x] (2026-03-20 22:34Z) Confirmed that retained run games already store enough replay state and compact decision traces to support diagnostics without replaying full engine games from scratch.
- [x] (2026-03-20 22:40Z) Confirmed the shared policy vocabulary includes `challenge`, `bomb`, `pass`, and `on-deck`; the remaining gap is instrumentation and diagnostics, not missing policy slots.
- [x] (2026-03-20 23:18Z) Implemented per-decision legal-action summaries and policy-coverage counters in `src/services/ml/gameRunner.js`, and preserved them through replay compaction in `src/services/ml/runtime.js`.
- [x] (2026-03-20 23:39Z) Implemented run diagnostics and warning generation in `src/services/ml/runtime.js`, exposed them through `summarizeRun()` and `buildRunProgressPayload()`, and snapshot them into `metricsHistory`.
- [x] (2026-03-20 23:46Z) Surfaced diagnostics in the selected-run admin panel in `public/ml-admin.html` and `public/ml-admin.js`, including replay-target counts and latest-batch sample counts.
- [x] (2026-03-20 23:57Z) Added focused regression tests for repeated openings, simple-action exposure, missing value samples, compacted terminal replay counts, and shared-policy simple-action coverage.
- [x] (2026-03-21 00:01Z) Ran focused Jest validation with `ENABLE_ML_WORKFLOW=1`; all new diagnostics tests passed.

## Surprises & Discoveries

- Observation: retained replay frames are post-action snapshots, but each frame also stores the chosen decision and a compacted trace.
  Evidence: `compactReplayFrameForRun()` in `src/services/ml/runtime.js` preserves `frame.decision`, and `compactDecisionTraceForReplay()` already keeps root `actionStats`.

- Observation: the engine is already generating the simple-action branches in `getLegalActions()`.
  Evidence: `src/services/ml/engine.js` adds `CHALLENGE`, `BOMB`, `PASS`, and `ON_DECK` actions; existing tests already cover on-deck MCTS and pass-after-bomb resolution.

- Observation: the shared policy path does not drop unmapped legal actions from search, but it can still under-report mapping gaps unless we record them explicitly.
  Evidence: `evaluateInformationState()` keeps `legalActions` from the engine, while `predictPolicy()` may return fewer `slotIndices` than legal actions for the shared encoder path.

- Observation: completed runs compact replay arrays down to a summary, so treating empty replay arrays as literal zeroes creates false “missing value targets” diagnostics.
  Evidence: the first implementation flagged terminal runs incorrectly until the diagnostics code started treating compacted replay counts as unknown and relying on `replayBuffer.summary.positions`.

## Decision Log

- Decision: compute diagnostics from recent retained self-play games instead of from the full replay buffer alone.
  Rationale: collapse is a recent-behavior problem; older varied games can mask current degeneration. Retained self-play already captures the exact opening and action traces we need.
  Date/Author: 2026-03-20 / Codex

- Decision: record compact legal-action summaries per decision rather than reconstructing them later from post-action replay frames.
  Rationale: this avoids brittle state reconstruction, keeps diagnostics cheap, and lets us count simple-action opportunities even when root action stats are truncated for replay storage.
  Date/Author: 2026-03-20 / Codex

- Decision: use semantic action signatures for diversity metrics instead of raw piece IDs.
  Rationale: identical rooks or bishops swapping fixed piece IDs should not count as different openings or move sequences from the operator’s perspective.
  Date/Author: 2026-03-20 / Codex

- Decision: treat compacted replay value/identity counts as unknown rather than zero for terminal runs.
  Rationale: terminal run compaction intentionally drops those arrays, so zero would be a false diagnostic, not an observed fact.
  Date/Author: 2026-03-20 / Codex

## Outcomes & Retrospective

Implemented. The selected-run view now exposes recent opening/setup variety, repeated sequence warnings, simple-action legal/chosen coverage, policy-coverage gaps, replay-target ratios, and latest-batch sample counts. The runtime also stores legal-action and policy-coverage summaries per decision so those diagnostics reflect actual search inputs instead of replay heuristics.

The main lesson from implementation was that diagnostics have to respect storage compaction. The replay buffer for terminal runs no longer has full sample arrays, so diagnostics must distinguish “unknown because compacted” from “observed zero.” That distinction is now covered by regression tests.

## Context and Orientation

The ML continuous-run pipeline lives in `src/services/ml/runtime.js`. That file creates and updates run records, retains recent self-play and evaluation games, manages the replay buffer, records training losses, and builds the summary/live payloads consumed by the admin UI. The selected-run panel in `public/ml-admin.html` and `public/ml-admin.js` renders those summary and live payloads.

Fast self-play games are generated in `src/services/ml/gameRunner.js`. A “decision” is one model/bot choice before an action is applied. A retained replay frame stores the board snapshot plus, when available, the chosen decision and a compacted trace from search. `src/services/ml/engine.js` defines legal game actions and their routing (`MOVE`, `CHALLENGE`, `BOMB`, `PASS`, `ON_DECK`). `src/services/ml/sharedEncoderModel.js` defines the shared policy vocabulary for the shared-encoder model family, including explicit non-move slots for those simple actions.

In this repository, a “retained game” means a compact replay kept inside a run record for later admin inspection. A “replay buffer” means the training sample queue used for learning. The first helps diagnose behavior; the second feeds the trainer.

## Plan of Work

First, extend the fast-game decision trace in `src/services/ml/gameRunner.js` to include a compact summary of the legal actions available at the root state of each decision. That summary must count how many legal actions existed in total and how many belonged to each action family (`move`, `challenge`, `bomb`, `pass`, `on_deck`, `resign`). Record policy-slot coverage there as well so the run can detect if the shared policy mapping ever fails to cover all legal actions for a decision.

Second, update replay compaction in `src/services/ml/runtime.js` so the retained trace keeps those new legal-action and policy-coverage summaries. Add a diagnostics builder in the runtime that inspects recent retained self-play games, the replay buffer, and the latest loss/evaluation snapshots. The diagnostics builder must compute setup variety, first-move variety, opening-prefix variety, exact sequence repetition, simple-action legal/chosen counts and choice rates, fallback-action count, policy-mapping gaps, replay target counts and ratios, and a list of warnings with severity levels. Expose the diagnostics through both `summarizeRun()` and `buildRunProgressPayload()`, and include a snapshot in `metricsHistory` so later work can chart them without recomputing old cycles.

Third, add a diagnostics section to the selected-run admin panel in `public/ml-admin.html` and render it in `public/ml-admin.js`. The panel should show high-signal metrics and human-readable warnings, not raw JSON. The latest-loss card should also show head sample counts so a zero value loss can immediately be distinguished from “value head received zero samples.”

Finally, add focused Jest coverage in `tests/mlRuntime.test.js`. The tests must prove that diagnostics detect repeated openings, count simple-action opportunities and selections, and flag missing value samples. Add at least one regression that exercises the shared-policy simple-action mapping contract, because the user explicitly asked whether all possible moves are even entering the model path.

## Concrete Steps

Work from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Inspect and edit the runtime path:

    rg -n "buildDecisionTrace|compactDecisionTraceForReplay|summarizeRun|buildRunProgressPayload|recordRunMetrics" src/services/ml

Run focused ML diagnostics tests while the workflow flag is enabled:

    $env:ENABLE_ML_WORKFLOW='1'
    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js -t "run diagnostics|simple-action|value samples|opening diversity"

If a focused pattern misses the new tests, run the full ML runtime file:

    $env:ENABLE_ML_WORKFLOW='1'
    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js

Expected result after implementation: the new diagnostics tests pass, and manual inspection of a selected run in `/ml-admin` shows a diagnostics section with non-empty opening/action coverage metrics and warnings when a crafted run is degenerate.

## Validation and Acceptance

Acceptance is behavioral, not structural.

Open `/ml-admin`, select a run with retained self-play, and confirm the run view now shows diagnostics that include setup variety, first-move variety, opening-prefix repetition, simple-action coverage, replay target counts, and warning rows. A run with healthy diversity should show multiple unique setups/first moves and either no warnings or only informational notes. A crafted or collapsed run should show repeated-opening warnings and, if the replay buffer lacks value samples, a missing-value warning.

Run the focused Jest coverage described above and confirm the new tests fail before the implementation and pass after it. The tests must cover:

1. repeated-opening detection from retained self-play;
2. simple-action legal/chosen accounting for `challenge`, `bomb`, `pass`, and `on-deck`;
3. value-sample warning when replay or latest batch drops value targets;
4. shared-policy simple-action mapping coverage.

## Idempotence and Recovery

The edits are additive. Re-running the focused tests is safe. The diagnostics code must tolerate older persisted run records that do not yet contain the new trace fields by falling back to zeros or best-effort inference rather than throwing. If the UI renders an older run, it should show partial diagnostics or “not enough data” instead of failing.

## Artifacts and Notes

Key files to change:

    src/services/ml/gameRunner.js
    src/services/ml/runtime.js
    public/ml-admin.html
    public/ml-admin.js
    tests/mlRuntime.test.js

The user specifically asked whether the system is “putting in all possible moves.” The plan addresses that in two ways: by exposing policy-coverage gaps as diagnostics, and by adding regression tests around simple-action mapping so unsupported action families fail loudly.

## Interfaces and Dependencies

In `src/services/ml/gameRunner.js`, extend `buildDecisionTrace()` so it can receive the legal root actions and emit:

    legalActionSummary: {
      total: number,
      move: number,
      challenge: number,
      bomb: number,
      pass: number,
      onDeck: number,
      resign: number,
    }

and

    policyCoverage: {
      totalLegalActions: number,
      mappedPolicyActions: number | null,
      unmappedLegalActions: number | null,
    }

In `src/services/ml/runtime.js`, define a diagnostics summary returned by `summarizeRun()` and `buildRunProgressPayload()`:

    diagnostics: {
      sampleWindow: { selfPlayGames: number, evaluationGames: number },
      openings: { ... },
      actions: { ... },
      replayTargets: { ... },
      evaluation: { ... },
      checks: Array<{ code: string, severity: string, message: string }>
    }

The UI in `public/ml-admin.js` must treat `run.diagnostics` and `live.diagnostics` as read-only view data and render them without mutating the payload.

Revision note: created this ExecPlan after tracing the retained-game, replay-buffer, and selected-run code paths so the implementation can proceed with concrete diagnostics rather than exploratory edits.

Revision note: updated after implementation to record the shipped diagnostics, the compacted-replay edge case, and the focused Jest validation that passed on 2026-03-21.
