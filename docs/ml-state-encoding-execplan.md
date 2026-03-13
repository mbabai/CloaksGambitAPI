# Optimize ML State Encoding and Search Hot Paths

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/PLANS.md).

## Purpose / Big Picture

After this change, self-play and simulation search in the ML stack should spend much less time cloning object graphs, rescanning the full board, and rebuilding the same hidden-information features over and over. The practical result is that more games can be searched and simulated per unit time without changing the live game API or replay format.

The observable success case is: run the targeted ML tests, confirm move generation and state hashing still behave correctly, and compare a direct `runHiddenInfoMcts()` benchmark before and after the refactor to see materially lower elapsed time for the same search settings.

## Progress

- [x] (2026-03-12 10:45:47 -07:00) Read `PLANS.md`, repo guidance, `src/services/ml/engine.js`, `src/services/ml/modeling.js`, `src/services/ml/mcts.js`, and the ML runtime call sites to identify the dominant search costs.
- [x] (2026-03-12 10:45:47 -07:00) Captured a baseline benchmark for the current search path: 40 `runHiddenInfoMcts()` calls at 32 iterations / depth 10 / 4 hypotheses took about 5438 ms.
- [x] (2026-03-12 11:06:00 -07:00) Added `src/services/ml/stateEncoding.js` with compact per-state caches, fixed square indexing, precomputed move templates, and an encoded deterministic state hash.
- [x] (2026-03-12 11:13:00 -07:00) Replaced brute-force declared-move scans in `src/services/ml/engine.js` with encoded move generation and a count-only mobility path for feature extraction, while keeping the public action/state shapes unchanged.
- [x] (2026-03-12 11:20:00 -07:00) Reused cached state features in `src/services/ml/modeling.js` and added per-search evaluation/transposition reuse plus cache statistics in `src/services/ml/mcts.js`.
- [x] (2026-03-12 11:30:00 -07:00) Added focused regression coverage in `tests/mlStateEncoding.test.js` for move parity, hashing stability, non-canonical piece ids, and search trace stats.
- [x] (2026-03-12 11:44:00 -07:00) Validated the new path with targeted Jest runs and reran the benchmark; the same 40-search benchmark dropped to about 5102 ms, with a warmed rerun at about 5084 ms.
- [x] (2026-03-12 11:44:00 -07:00) Confirmed the full `tests/mlRuntime.test.js` file still exceeds the shell timeout in this environment, then replaced that with focused runtime coverage for the search/simulation cases touched by this refactor.

## Surprises & Discoveries

- Observation: the main search path already pays for the same state multiple times because `getLegalActions()`, `countMoveOptionsForColor()`, `summarizeMaterial()`, `findKing()`, and `computeStateHash()` all rebuild overlapping board scans from object state.
  Evidence: `extractStateFeatures()` in `src/services/ml/modeling.js` calls the move counter, material summary, king lookup, and piece counters separately, while `createNode()` in `src/services/ml/mcts.js` also hashes the same state independently.

- Observation: the current declared-move generator is especially expensive because it scans every square on the board for every piece and every declarable identity, even though the board is fixed at 6x5 and all movement radii are bounded.
  Evidence: `getDeclaredMoveActionsForColor()` in `src/services/ml/engine.js` nests loops over source squares, four declarations, and every destination square.

- Observation: the existing state hash is descriptive but not search-friendly.
  Evidence: `computeStateHash()` currently builds several joined strings, sorts revealed identities, and serializes the latest move/action fields on every call.

- Observation: mobility counting was still wasting work even after encoded move generation landed because feature extraction only needed counts, not full action objects.
  Evidence: the first post-refactor benchmark was still roughly flat until `countMoveOptionsForColor()` stopped delegating to `getDeclaredMoveActionsForColor().length` and switched to a count-only encoded traversal.

- Observation: in this repo, the broad `tests/mlRuntime.test.js` file remains a poor final gate for targeted ML engine changes because it contains unrelated long-running cases.
  Evidence: a direct `npm.cmd test -- tests/mlRuntime.test.js` invocation exceeded the shell timeout, while focused Jest runs against the affected test names completed and passed in about fifty-two seconds.

## Decision Log

- Decision: keep the public ML state shape and action payload shape intact while adding a non-enumerable compact cache beside them.
  Rationale: `src/services/ml/runtime.js`, replay output, and existing tests all expect object-based `state.board`, `state.pieces`, and ordinary action objects. A hidden cache gives most of the performance gain without forcing a repo-wide migration.
  Date/Author: 2026-03-12 / Codex

- Decision: optimize the fixed-size board with precomputed move templates and cached occupancy masks instead of introducing a fully separate typed-array-only engine.
  Rationale: the board is always 6x5, declarations have bounded geometry, and the current code already relies on rich history/action objects. Precomputed templates address the hottest path with lower migration risk.
  Date/Author: 2026-03-12 / Codex

- Decision: add transposition-aware node reuse inside a single MCTS run.
  Rationale: once state hashing becomes cheap enough, search can reuse identical states reached by different response/action orders instead of rebuilding identical nodes and reevaluating them.
  Date/Author: 2026-03-12 / Codex

- Decision: keep the new search reuse scoped to a single `runHiddenInfoMcts()` call instead of caching evaluations globally across runs.
  Rationale: the model bundle can change between training iterations, and global caches would need invalidation rules that are more brittle than the gain is worth. Search-local caches deliver reuse without stale-model risk.
  Date/Author: 2026-03-12 / Codex

## Outcomes & Retrospective

- Outcome: the ML engine now derives a non-enumerable compact cache from the existing object state instead of forcing the rest of the repo onto a new typed-array state format. `src/services/ml/stateEncoding.js` encodes board occupancy, piece placement, alive/zone summaries, hidden-piece lists, and a deterministic encoded hash with precomputed movement templates for the fixed 6x5 board.

- Outcome: declared move generation is no longer a nested full-board scan. `src/services/ml/engine.js` now iterates occupied friendly squares and precomputed destination templates, caches legal moves on immutable states, and uses a count-only mobility path for `countMoveOptionsForColor()` so feature extraction avoids allocating move objects just to measure mobility.

- Outcome: model feature extraction now reuses state-local caches. `src/services/ml/modeling.js` caches response-phase info, alive counts, identity feature packets, material summaries, and guessed-identity-specific state feature vectors, and `predictPolicy()` / `predictValue()` can share a single precomputed state feature vector per identity hypothesis.

- Outcome: MCTS now reuses work within a search. `src/services/ml/mcts.js` adds a search-local evaluation cache and transposition table keyed by the encoded state hash, and exposes cache statistics in `trace` so future tuning can observe node reuse instead of guessing.

- Outcome: the benchmark moved in the right direction, though not dramatically. The direct 40-search benchmark improved from about 5438 ms before the refactor to about 5102 ms after the count-only mobility optimization, with a warmed rerun around 5084 ms. That is a modest but real reduction while preserving compatibility.

- Validation: `npm.cmd test -- tests/mlStateEncoding.test.js` passed for move-generation parity, pending-response parity, hashing stability, and the new search trace counters.

- Validation: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js -t "mcts supports on-deck action phases|simulations support medium bot participants and alternating colors|snapshot simulations preserve identity-history signal across plies"` passed, covering the MCTS and simulation paths touched by the refactor.

- Validation: `npm.cmd test -- tests/mlRuntime.test.js` was attempted but exceeded the shell timeout in this environment, so full-suite ML runtime validation remains incomplete for the same reason already documented elsewhere in the repo.

## Context and Orientation

The optimization target is the internal ML rules engine, not the live HTTP gameplay routes. The relevant files are `src/services/ml/engine.js`, which owns state creation, move legality, action application, and replay serialization; `src/services/ml/modeling.js`, which extracts policy/value/identity features from engine states; and `src/services/ml/mcts.js`, which expands hidden-information search trees for snapshot-controlled participants.

The current ML state is an object graph: `state.board` is a 6x5 array of piece ids, `state.pieces` is a map of piece id to piece metadata, and history lives in arrays such as `state.moves`, `state.actions`, and `state.moveHistoryByPiece`. That representation is convenient for correctness and replay, but it is expensive for search because many helpers repeatedly re-derive occupancy, piece counts, and legal geometry from scratch.

For this change, "compact encoding" means a derived in-memory representation attached to a state object that stores the same position in cache-friendly terms: numeric square indices from 0 to 29, compact arrays for piece placement and status, occupancy bitmasks, and precomputed movement templates for all squares and declarations. The live object state remains the source of truth for compatibility, but the hot-path helpers will consult the compact cache first.

## Plan of Work

First, add a new helper module under `src/services/ml/` that knows how to derive and cache compact state data from an ordinary ML state. That module will expose the fixed square indexing helpers, move templates for king/rook/bishop/knight declarations, compact occupancy summaries, per-color counts, and a faster deterministic hash assembled from encoded state instead of repeated string joins.

Second, update `src/services/ml/engine.js` to use the encoded cache in the hottest read paths. `getDeclaredMoveActionsForColor()` will iterate board occupants and precomputed move templates instead of scanning every destination square. `countMoveOptionsForColor()`, `getHiddenPieceIds()`, `summarizeMaterial()`, `findKing()`, and `computeStateHash()` will all read from the compact cache and memoize their results on the immutable state object.

Third, update `src/services/ml/modeling.js` and `src/services/ml/mcts.js` so search stops redoing identical work. Modeling will reuse cached state features where possible and avoid recomputing the same state feature vector separately for policy and value on each identity hypothesis. MCTS will add a transposition table and evaluation cache scoped to a search run so repeated states reuse nodes and evaluations.

Finally, add focused tests under `tests/` for move-generation parity and hashing stability, then rerun targeted ML tests and the direct benchmark to confirm the optimization is both correct and measurably faster.

## Concrete Steps

Work from the repository root `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

1. Create `src/services/ml/stateEncoding.js` for compact encoding, movement templates, and encoded hashing.
2. Update `src/services/ml/engine.js` to read from the compact cache for move generation, counts, and hashing.
3. Update `src/services/ml/modeling.js` and `src/services/ml/mcts.js` to consume the new cache and add search-level reuse.
4. Add a focused Jest suite for the new engine behavior.
5. Run targeted tests and rerun the direct benchmark command used for the baseline.

Expected command cadence:

    cd C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI
    npm test -- tests/mlStateEncoding.test.js
    npm test -- tests/mlRuntime.test.js
    @'
    const { createInitialState } = require('./src/services/ml/engine');
    const { createDefaultModelBundle } = require('./src/services/ml/modeling');
    const { runHiddenInfoMcts } = require('./src/services/ml/mcts');
    const model = createDefaultModelBundle({ seed: 1234 });
    const states = Array.from({ length: 8 }, (_, i) => createInitialState({ seed: 1000 + i, maxPlies: 80 }));
    const started = Date.now();
    for (let i = 0; i < 40; i += 1) {
      const state = states[i % states.length];
      runHiddenInfoMcts(model, state, { iterations: 32, maxDepth: 10, hypothesisCount: 4, rootPlayer: state.toMove });
    }
    console.log(JSON.stringify({ runs: 40, elapsedMs: Date.now() - started }));
    '@ | node

## Validation and Acceptance

Acceptance is behavioral.

Run `npm test -- tests/mlStateEncoding.test.js` and expect the new move-generation and hash regressions to pass.

Run `npm test -- tests/mlRuntime.test.js` and expect the existing ML runtime behavior to remain intact for the targeted suite.

Run the direct benchmark command from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI` and expect the elapsed time to be materially lower than the baseline 5438 ms for the same 40 searches.

## Idempotence and Recovery

The compact cache is derived from existing ML state and is intentionally non-enumerable and recomputable. If any helper returns stale or suspect data during implementation, deleting the cache property from the state object and rerunning the helper must rebuild it from canonical object state.

The change should remain safe to retry because it does not alter Mongo persistence, live route contracts, or replay schema. If a new optimization proves incorrect, the affected helper can be reverted to the existing object-walk logic without data migration.

## Artifacts and Notes

Baseline benchmark captured before implementation:

    {"runs":40,"elapsedMs":5438}

Post-change benchmark captured after the count-only mobility optimization:

    {"runs":40,"elapsedMs":5102}

Warmed rerun on the same benchmark command:

    {"runs":40,"elapsedMs":5084}

## Interfaces and Dependencies

At the end of this work, the engine/search layer should expose the same public entry points it does now, with one additive helper module.

In `src/services/ml/stateEncoding.js`, define helpers conceptually equivalent to:

    ensureEncodedState(state)
    computeEncodedStateHash(state)
    getEncodedMoveTemplates()
    squareToIndex(row, col)
    indexToSquare(index)

In `src/services/ml/engine.js`, keep these exports stable:

    createInitialState(options?)
    cloneState(state)
    getLegalActions(state, color?)
    countMoveOptionsForColor(state, color)
    applyAction(state, action)
    computeStateHash(state)

In `src/services/ml/mcts.js`, keep `runHiddenInfoMcts(modelBundle, state, options?)` returning the chosen action, value estimate, training record, and trace data, while allowing the trace payload to grow with cache/transposition statistics.

Revision note: updated on 2026-03-12 after implementation to record the shipped compact-state cache, encoded move generation, search-local reuse, targeted validation evidence, and the remaining limitation that the full `tests/mlRuntime.test.js` file still times out as a single shell command in this environment.
