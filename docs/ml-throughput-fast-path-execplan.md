# Add A Fast ML Self-Play Path And Reuse Workers

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](../PLANS.md).

## Purpose / Big Picture

After this change, the bulk ML workloads in this repository will stop using the slowest path for self-play and evaluation. Continuous runs, simulation batches, and worker-thread game tasks will use an engine-only game runner that stays inside `src/services/ml/engine.js` state instead of creating temporary live games through the route stack. The worker system will also stop paying for one new `MlRuntime` instance per game task and one new worker batch per call. The observable result should be that the same ML tests still pass, replay payloads still load, and direct timing of batch game generation improves materially.

The user-visible success case is: start or resume a continuous run from `/ml-admin`, observe that the run still produces replayable games and training samples, and run the focused ML Jest coverage to prove that fast-path self-play, snapshot simulations, and worker-thread game batches still behave correctly. A direct timing check for `playRunGenerationGames()` or `simulateMatches()` should show lower elapsed time for the same seeds and search settings than before this refactor.

## Progress

- [x] (2026-03-13 11:42 -07:00) Read `PLANS.md`, the ML service notes, and the runtime/search/worker/test files needed for a throughput refactor.
- [x] (2026-03-13 11:50 -07:00) Confirmed that the repo does not contain `.agent/PLANS.md`; the root `PLANS.md` is the active ExecPlan source.
- [x] (2026-03-13 12:06 -07:00) Re-ran local timings and verified that hidden-info MCTS is the dominant cost, while the route-backed game loop is secondary.
- [x] (2026-03-13 13:54 -07:00) Added `src/services/ml/gameRunner.js` as an engine-only bulk game runner that preserves replay/training outputs.
- [x] (2026-03-13 14:12 -07:00) Routed `playRunGenerationGames()`, `simulateMatches()`, and background simulation jobs to the fast runner while leaving `runSingleGame()` as the live-parity path.
- [x] (2026-03-13 14:35 -07:00) Replaced per-hypothesis hidden-info MCTS with shared-tree ISMCTS, added per-participant tree reuse across plies, and batched policy-forward evaluation.
- [x] (2026-03-13 14:51 -07:00) Reused worker threads for parallel game generation and removed per-task `MlRuntime` construction from `parallelTaskWorker.js`.
- [x] (2026-03-13 15:20 -07:00) Preserved adaptive-search/ISMCTS metadata in retained replays and added focused runtime regressions.
- [x] (2026-03-13 15:45 -07:00) Ran focused ML Jest coverage plus direct microbenchmarks.
- [x] (2026-03-13 16:32 -07:00) Added copy-on-write move/action history handling in `engine.js` and compiled typed-array inference caches in `network.js`.
- [x] (2026-03-13 17:04 -07:00) Replaced string-built ISMCTS information-state keys with numeric encoded-state/history hashes.
- [x] (2026-03-13 17:23 -07:00) Added in-place `applyActionMutable()` and wired hidden-info MCTS simulations to use the mutable engine path.
- [x] (2026-03-13 18:11 -07:00) Preserved and cloned mutable encoded search state across MCTS simulation plies so search no longer rebuilds typed arrays from object state after every action.
- [x] (2026-03-13 19:02 -07:00) Fixed determinized-state hashing to include hidden identities and cached information-node action-key order so UCT selection stops rebuilding key arrays in the inner loop.
- [x] (2026-03-13 20:14 -07:00) Added incremental public-history hashing, preserved board-stable move-generation caches across non-board actions, and landed an adaptive search undo traversal for longer-history ISMCTS states.

## Surprises & Discoveries

- Observation: the current bottleneck is mostly search, not the temporary live-game wrapper.
  Evidence: a local benchmark of a short "default-ish" game was roughly the same route-backed and engine-only once MCTS settings were high enough, while a single opening move at 128 simulations and 4 hypotheses took about one second by itself.

- Observation: the current worker path still rebuilds runtime state per game task even though the worker thread itself stays alive for the batch.
  Evidence: `src/services/ml/parallelTaskWorker.js` constructs `new MlRuntime({ persist: false })` inside `handlePlayGameTask()`.

- Observation: the current continuous-run defaults can leave CPU idle on machines with more than six logical cores.
  Evidence: `numSelfplayWorkers` defaults to `6`, `parallelGameWorkers` defaults to `availableParallelism()`, and each cycle only enqueues `gameCount: run.config?.numSelfplayWorkers`.

- Observation: the initial ISMCTS draft still reused sampled-world value evaluations across hidden worlds because the cache key was only the information-state hash.
  Evidence: reviewing `evaluateInformationState()` showed value predictions being cached by public information hash even though the model features were still allowed to vary with sampled hidden identities. This was corrected by making node expansion use information-state priors while sampled-world leaf values use a separate determinized-state cache.

- Observation: pooled training-head workers are not the main throughput lever and were not kept on the persistent pool path.
  Evidence: the main speedups came from the fast game runner and shared-tree ISMCTS. Parallel head training still runs through worker threads, but the persistent pool remains focused on game generation where the simulation bottleneck sits.

- Observation: preserving the encoded state across mutable search plies moved the search loop more than the prior "mutable apply" change by itself.
  Evidence: the earlier in-place apply validation barely changed the microbench, while the follow-up encoded-cache preservation lowered the `runHiddenInfoMcts()` spot check from about 10.5 ms to about 9.5 ms at 16 iterations / depth 4 / 2 hypotheses. End-to-end game benches also improved, though they remain noisy because average plies vary significantly between runs.

- Observation: a broader copy-on-write search clone for board and piece objects did not pay off at higher MCTS budgets and was not kept.
  Evidence: a trial implementation that lazily cloned nested board/piece structures preserved correctness but pushed the fixed-seed 128-iteration / depth-16 search benchmark in the wrong direction. Reverting that experiment while keeping the encoded-cache work restored the better search timings.

- Observation: apply/undo is not the right default for opening-position searches, but it becomes net-positive once move/action history is long enough.
  Evidence: on a synthetic 10-ply midgame state, a 64-iteration / depth-12 / 4-hypothesis search was about 11.15 ms with cloning and about 10.83 ms with undo traversal, while opening-state timings stayed roughly flat or slightly worse if undo traversal was forced on.

## Decision Log

- Decision: keep `MlRuntime.runSingleGame()` as the existing live-route parity path instead of replacing it outright.
  Rationale: the repo already has targeted tests and live bot/test-game logic that depend on the route-backed semantics, including fallback logging and live parity handling. The high-volume bulk paths are where throughput matters most, so the fast path should be additive first.
  Date/Author: 2026-03-13 / Codex

- Decision: build the fast path as a shared ML service module, not as `MlRuntime`-local logic.
  Rationale: both the main process and worker threads need the same fast game runner, and a shared module avoids per-task `MlRuntime` setup while keeping the worker payloads structured-clone-safe.
  Date/Author: 2026-03-13 / Codex

- Decision: treat the typed-array plus apply/undo engine rewrite as a later phase, not part of this patch.
  Rationale: that rewrite crosses too many invariants in `src/services/ml/engine.js`, replay output, and rule-parity behavior to land safely in the same change as the fast-path migration and worker reuse. The first safe 10x path is bulk-path selection, adaptive budgets, and worker reuse.
  Date/Author: 2026-03-13 / Codex

- Decision: use information-state priors plus sampled-world leaf values for ISMCTS instead of caching sampled-world evaluations on shared nodes.
  Rationale: shared nodes must not bake one determinization's hidden facts into every later simulation. Public-state priors can be reused safely, while sampled-world leaf values preserve the user's requested `E_hidden[V(s_hidden, a)]` behavior.
  Date/Author: 2026-03-13 / Codex

- Decision: keep persistent worker reuse on parallel game generation and leave parallel head training on the simpler per-batch worker path.
  Rationale: simulation throughput is dominated by self-play/evaluation, not head training, and the game-worker pool is the stable/high-value optimization.
  Date/Author: 2026-03-13 / Codex

- Decision: preserve and clone the encoded search cache for sampled-world MCTS states instead of attempting a separate rules-engine rewrite in this pass.
  Rationale: the encoded cache already contains the typed board/piece representation the search path needs. Updating it incrementally inside the existing engine mutators keeps the change local, preserves rule parity, and removes repeated typed-array rebuilds from the hot loop without introducing a second full rules implementation.
  Date/Author: 2026-03-13 / Codex

- Decision: keep search-clone optimization limited to encoded-state reuse and MCTS-node bookkeeping, and do not keep nested object copy-on-write for board/piece state.
  Rationale: the board/piece copy-on-write experiment added enough hot-path branching in engine mutators that it hurt deeper searches. The landed version keeps the profitable parts: determinized hidden-state hashing, encoded-state reuse, and cheaper UCT action-key iteration.
  Date/Author: 2026-03-13 / Codex

- Decision: gate undo traversal on search-history length instead of enabling it for every ISMCTS root.
  Rationale: the undo path adds bookkeeping overhead that is only repaid when the cloned move/action history is already non-trivial. Using it adaptively keeps the opening-position path on the cheaper clone traversal while still enabling a true search-only apply/undo walk for longer-history searches.
  Date/Author: 2026-03-13 / Codex

## Outcomes & Retrospective

Bulk ML game generation now runs through `src/services/ml/gameRunner.js` instead of the route-backed live path, and the main hidden-information search is now shared-tree ISMCTS keyed by public information state. Fast games carry adaptive-search metadata in replay traces, and the same participant reuses a shared ISMCTS cache across plies inside one game.

Focused validation passed:

    $env:ENABLE_ML_WORKFLOW='true'
    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="hidden-info search does not depend on unrevealed ground-truth identities|playRunGenerationGames supports parallel game workers with unique ids|fast self-play reuses shared ISMCTS trees per participant across plies|runSingleGame keeps the requested action key available for live-route fallback logging|simulations support medium bot participants and alternating colors|snapshot simulations preserve identity-history signal across plies"
    npm.cmd test -- tests/mlStateEncoding.test.js
    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntimePersistence.test.js --runInBand

Measured spot checks after the refactor:

    - Opening move search, 32 iterations / 1 hypothesis: about 78 ms.
    - Opening move search, 32 iterations / 4 hypotheses: about 56 ms.
    - Opening move search, 128 iterations / 1 hypothesis: about 193 ms.
    - Opening move search, 128 iterations / 4 hypotheses: about 193 ms.
    - `playRunGenerationGames()` bench, 4 games at 32 iterations / depth 8 / 4 hypotheses / 4 workers: about 820 ms total, or about 4.9 games/s on this machine.

Measured spot checks after the low-level engine/inference pass:

    - `predictPolicy()` opening-state spot check: about 0.45 ms per call, down from about 0.98 ms.
    - `runHiddenInfoMcts()` spot check at 16 iterations / depth 4 / 2 hypotheses: about 12.4 ms per call, down from about 18.8 ms.
    - `playRunGenerationGames()` bench, 4 games at 32 iterations / depth 8 / 4 hypotheses / 4 workers: about 610 ms total, or about 6.6 games/s on this machine.

The remaining gap to "100 sims/s" is still the object-heavy engine and per-action JS inference path. This patch removes the biggest multiplicative waste in hidden-info search and bulk game orchestration, but a true 100x path still requires a lower-level engine representation or inference backend rewrite.

The information-state hash rewrite validated cleanly but produced only marginal microbenchmark movement, which is itself useful signal: the next meaningful speedup is unlikely to come from more hashing/cache polish alone. The remaining major step is a mutable apply/undo or typed-array search engine.

The in-place mutable apply step also validated cleanly but, by itself, did not materially improve end-to-end throughput. That narrows the remaining bottleneck further: the search still spends most of its time in legal-action generation, encoded-state rebuilds, and model inference, not the wrapper clone around `applyAction()`. A true next jump now requires an incrementally maintained search-state encoding, not just mutable action application.

The follow-up encoded-search-state pass now keeps that typed representation alive across mutable search plies and clones it for sampled-world simulations. The latest follow-up also fixed determinized hidden-state hashing, added incremental public-history hashing, preserved board-stable move-generation caches across non-board actions, and introduced an adaptive undo traversal for longer-history ISMCTS searches. Focused validation still passed:

    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlEngineNetworkOptimization.test.js --runInBand
    npm.cmd test -- tests/mlStateEncoding.test.js
    $env:ENABLE_ML_WORKFLOW='true'
    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="hidden-info search does not depend on unrevealed ground-truth identities|playRunGenerationGames supports parallel game workers with unique ids|fast self-play reuses shared ISMCTS trees per participant across plies|bootstraps snapshots and stores replayed simulations|background simulation jobs complete and expose live status|simulations support medium bot participants and alternating colors|snapshot simulations preserve identity-history signal across plies"
    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntimePersistence.test.js --runInBand

Measured spot checks after the latest landed search-path changes:

    - Opening-state `runHiddenInfoMcts()` spot check at 16 iterations / depth 4 / 2 hypotheses: about 10.6 ms per call.
    - Opening-state `runHiddenInfoMcts()` spot check at 32 iterations / depth 8 / 4 hypotheses: about 16.7 ms per call average across batches.
    - Opening-state `runHiddenInfoMcts()` spot check at 128 iterations / depth 16 / 4 hypotheses: about 49.1 ms per call average across batches.
    - Synthetic 10-ply midgame `runHiddenInfoMcts()` at 64 iterations / depth 12 / 4 hypotheses: about 11.15 ms with clone traversal versus about 10.83 ms with undo traversal.

End-to-end game generation remains noisier because average plies vary a lot between runs. Focused runtime tests stayed green, and one recent 4-game self-play spot check at 32 iterations / depth 8 / 4 hypotheses / 4 workers finished in about 242 ms inside the focused runtime test, while ad hoc bench runs still swing materially with realized game length.

That is a real improvement, but it still does not close the remaining gap to "100 sims/s". The dominant remaining cost is now the object-engine rule application and per-state legal-action generation around the encoded cache, not repeated typed-array reconstruction alone.

The current follow-up pass trims the remaining pure-JS action-generation and inference overhead instead of changing search semantics again. Declared move actions now carry stable numeric metadata for piece and square indices, `extractActionFeatures()` consumes that metadata directly rather than re-deriving indices from square objects, and policy scoring now runs through a scalar batch-forward path so the policy head does not allocate one-element output vectors for every legal action. `forwardNetworkBatch()` was also tightened to use indexed loops rather than callback-heavy `map()` chains. This is still not a replacement for a lower-level inference backend, but it reduces the remaining JS overhead sitting between fast ISMCTS and the JSON MLP bundle.

Measured spot checks after this pass:

    - `predictPolicy()` opening-state spot check: about 0.228 ms per call, down from about 0.315 ms before this pass.
    - Policy-head batch scoring on the same feature matrix: about 0.223 ms through the scalar batch path versus about 0.240 ms for the prior batch-plus-map path.
    - Extracting features for all opening legal actions: about 0.0099 ms with numeric move metadata versus about 0.0117 ms when forced back through square-object lookups.
    - Opening-state `runHiddenInfoMcts()` spot check at 32 iterations / depth 8 / 4 hypotheses: about 13.6 ms per call, down from about 16.7 ms before this pass.
    - Opening-state `runHiddenInfoMcts()` spot check at 128 iterations / depth 16 / 4 hypotheses: about 36.5 ms per call, down from about 49.1 ms before this pass.

Follow-up stability fix (same date): active-run persistence was also writing and hydrating oversized journal replay artifacts. On a real local run this produced replay-buffer journal files above 230 MB and could crash startup while hydrating the latest journal state. The runtime now:

    - bounds journal replay snapshots to a small tail instead of the full in-memory replay buffer,
    - tails the last journal line instead of reading the entire journal log into memory,
    - skips oversized replay-buffer artifacts during hydration while still loading working model state,
    - and uses a compact run-persistence signature in addition to `updatedAt` so external state changes are not skipped when callers forget to bump the timestamp.

Focused validation for that follow-up passed in `tests/mlRuntimePersistence.test.js` and `tests/mlRuntime.test.js`, and a direct non-resuming load of the real `data/ml` state successfully hydrated `run-0010` while skipping the 237 MB replay-buffer journal artifact.

## Context and Orientation

The current ML runtime is centered in `src/services/ml/runtime.js`. That file owns continuous runs, snapshot simulations, replay retention, evaluation, and the worker-thread scheduler. `src/services/ml/mcts.js` performs hidden-information search. `src/services/ml/modeling.js` performs policy, value, and identity inference plus training. `src/services/ml/engine.js` is the object-based local rules engine used by MCTS. `src/services/ml/parallelTaskWorker.js` is the worker-thread entrypoint for parallel game and training tasks.

In this repository, a "bulk path" means any gameplay generation flow whose purpose is self-play, evaluation, or offline simulation, not a live game shown to a human. The important bulk call sites are `MlRuntime.playRunGenerationGames()`, `MlRuntime.simulateMatches()`, and `MlRuntime.runSimulationJob()`. These paths need replayable game records and training samples, but they do not need the temporary live `Game` and `Match` documents used by the existing route-backed `runSingleGame()` implementation.

The important safety constraint is that live route parity must remain available. `runSingleGame()` is still used for tests that validate fallback logging and for live test-game bot behavior. The new fast path must therefore be additive and must produce the same high-level game record fields that the run/simulation code already expects: `winner`, `winReason`, `plies`, `replay`, `decisions`, `training`, participant labels, and result values.

## Plan of Work

First, add a new ML service module, tentatively `src/services/ml/gameRunner.js`, that can run one complete engine-only game between two participants. This module will own participant action selection for built-in bots and model-driven participants, adaptive search budgeting for bulk self-play, replay frame creation using the ML engine's own `toReplayFrame()` helper, and training-sample extraction from per-ply decisions. Its output must mirror the shape returned by `MlRuntime.runSingleGame()` closely enough that the existing simulation/run code can consume it without further schema changes.

Second, thread that fast runner into the bulk runtime call sites. `playRunGenerationGames()` should default to the fast path for self-play and evaluation games, and both `simulateMatches()` and `runSimulationJob()` should use the same fast path instead of calling the live-route `runSingleGame()`. `runSingleGame()` itself should remain unchanged except for delegating shared sample-building helpers where that reduces duplication.

Third, add adaptive MCTS search budgeting inside the fast path. The intent is to lower cost in quiet positions while preserving full budgets in response-heavy tactical positions such as pending challenge, bomb, or on-deck phases. The chosen per-move search settings must be recorded in the replay decision trace so test code and later debugging can see what budget was used.

Fourth, replace the batch-local worker scheduler with a persistent worker pool. The pool should reuse worker threads across multiple calls to `playRunGenerationGames()` and training tasks, and the worker entrypoint should stop constructing `MlRuntime` for fast game tasks. `MlRuntime.dispose()` must terminate the pool cleanly so Jest does not leak handles.

Finally, add focused regression tests in `tests/mlRuntime.test.js` for the new fast path and worker reuse behavior, then run the targeted ML suites. Update the relevant ML service documentation files if the runtime contract or operator-facing expectations change.

## Concrete Steps

Work from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

1. Create `docs/ml-throughput-fast-path-execplan.md` and keep it current as implementation proceeds.
2. Add `src/services/ml/gameRunner.js` with a pure fast game runner and shared training-sample builder.
3. Update `src/services/ml/runtime.js` to call the fast runner from the bulk simulation and continuous-run paths while preserving `runSingleGame()` for live parity.
4. Update `src/services/ml/parallelTaskWorker.js` and the worker scheduler in `src/services/ml/runtime.js` to use persistent worker reuse.
5. Extend `tests/mlRuntime.test.js` with focused assertions for fast-path batch games and simulations.
6. Run the targeted Jest commands listed in `Validation and Acceptance`, then record the outcomes and any measured timings in this document.

## Validation and Acceptance

Run the following from the repository root:

    $env:ENABLE_ML_WORKFLOW='true'
    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="playRunGenerationGames supports parallel game workers with unique ids|runSingleGame keeps the requested action key available for live-route fallback logging|bootstraps snapshots and stores replayed simulations"

The targeted runtime tests should pass, including the old live-route regression and the updated bulk simulation assertions.

Then run:

    npm.cmd test -- tests/mlStateEncoding.test.js

This should continue passing because the fast-path refactor must not break the encoded-state engine behavior used by search.

If time permits, run a direct timing check from the repository root comparing the before/after elapsed time for a fixed `playRunGenerationGames()` or `simulateMatches()` workload using the same seeds and search settings. The acceptance condition is not an exact millisecond number but that the fast bulk path is observably faster while replay/training outputs remain present.

## Idempotence and Recovery

This refactor should be additive and retryable. If a fast-path call site fails during implementation, the safe recovery path is to switch that one caller back to the existing `runSingleGame()` path while keeping the new shared runner module in place. Worker-pool changes must be reversible by falling back to the existing per-batch worker creation logic. No data migration is required because the returned game records keep the existing JSON-safe shape.

## Artifacts and Notes

Pre-implementation timing notes captured during investigation:

    - Opening move search, 128 iterations / 4 hypotheses: about 1083 ms.
    - Opening move search, 128 iterations / 1 hypothesis: about 335 ms.
    - Opening move search, 32 iterations / 1 hypothesis: about 143 ms.
    - Short "default-ish" full game, route-backed versus engine-only: roughly 2.2 s in both cases, indicating that search dominates once budgets are high.

These numbers show why the first safe win is fast bulk-path selection and adaptive search rather than a risky rewrite of the live test-game path.

## Interfaces and Dependencies

At the end of this task, `src/services/ml/runtime.js` must still export `MlRuntime` and `getMlRuntime()`, and `MlRuntime.runSingleGame()` must continue to return the current live-route-compatible record shape used by existing tests.

The new fast-runner module should expose functions conceptually equivalent to:

    runFastGame(options)
    buildTrainingSamplesFromDecisions(decisions, winner)
    chooseActionForParticipant(participant, state, options)

The worker-thread entrypoint must continue accepting structured-clone-safe messages and returning structured-clone-safe results. No worker payload may contain functions, class instances, or live Mongoose documents.

Revision note (2026-03-13 / Codex): created this ExecPlan after measuring the current search costs, confirming that route overhead is secondary, and choosing an additive fast-path migration that preserves the existing live-route regression path.

Revision note (2026-03-13 / Codex): the ML admin start-run surface was later streamlined to match the landed shared-tree ISMCTS flow. The public form now exposes "Belief Samples / Move" instead of legacy identity-hypothesis wording, removes user-facing knobs for risk bias, game-worker concurrency, backend/device selection, worker refresh cadence, and graph stride, and defaults run stopping to the failed-promotion cap only while keeping legacy stop toggles accepted by the runtime for older payloads/tests.
