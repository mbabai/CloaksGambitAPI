# Migrate ML To A Shared Encoder, Fixed Policy Vocabulary, And Belief Head

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/PLANS.md).

## Purpose / Big Picture

After this change, newly published ML models will stop being three unrelated hand-crafted heads that each consume a different feature view. A published model will instead expose one locked, fixed-shape game-state input, one locked fixed-vocabulary policy output, one scalar value output, and one locked fixed-slot belief output for the opponent pieces. Hidden-information search will continue to use IS-MCTS, but it will consume the shared model family instead of the older separate policy/value/identity feature pipelines.

The observable success case is: create a new bootstrap run, inspect the model descriptor in the ML workbench, see a shared-encoder model family name with a clean parameter count, run self-play through IS-MCTS, and confirm the training path can update the same shared bundle through either the Node trainer or the Python Torch bridge while older legacy bundles remain loadable.

## Progress

- [x] (2026-03-14 17:05 -07:00) Read `PLANS.md`, repository ML instructions, `src/services/ml/runtime.js`, `src/services/ml/modeling.js`, `src/services/ml/mcts.js`, `src/services/ml/stateEncoding.js`, `src/services/ml/gameRunner.js`, and the Python bridge files.
- [x] (2026-03-14 17:10 -07:00) Confirmed the current architecture gap: policy uses `(state, action)` features, value uses state-summary features, and identity uses per-piece local features, so there is no shared encoder and no fixed published input/output contract.
- [x] (2026-03-14 17:18 -07:00) Confirmed the repo already has the two ingredients needed for a locked interface: stable per-side piece ids from `src/services/ml/engine.js` and a deterministic move-template generator in `src/services/ml/stateEncoding.js`.
- [x] (2026-03-14 18:08 -07:00) Added `src/services/ml/sharedEncoderModel.js` with the published `shared_encoder_belief_ismcts_v1` interface, including the locked state-input layout, fixed policy vocabulary, and fixed opponent-piece belief slots.
- [x] (2026-03-14 18:24 -07:00) Extended `src/services/ml/modeling.js` so new default bundles use the shared family while legacy `version: 2` bundles still normalize and remain loadable.
- [x] (2026-03-14 18:40 -07:00) Reworked the new-model inference path in `src/services/ml/modeling.js` and `src/services/ml/mcts.js` so policy, value, and belief predictions all come from one encoded shared state.
- [x] (2026-03-14 18:58 -07:00) Reworked the new-model training path in Node and Python so policy, value, and belief losses can update the same encoder trunk while keeping the JSON bundle/optimizer format.
- [x] (2026-03-14 19:07 -07:00) Updated runtime naming, compatibility helpers, admin seed-label fallbacks, and added focused shared-model regression coverage in `tests/mlSharedEncoderModel.test.js`.
- [x] (2026-03-14 21:58 -07:00) Added a persistence codec for packed float32 tensor storage, made zeroed optimizer state lazy for new runs, and deduplicated untouched working bundles against their base generation during persistence so the larger shared family can save/reload without exploding runtime artifact size.
- [x] (2026-03-14 20:49 -07:00) Followed up on the shared-family training/runtime path by making `trainingBackend: auto` prefer Python CPU/CUDA when available, adding worker/bridge timeouts, and fixing the snapshot-training bundle swap plus background-training batch sizing.
- [x] (2026-03-15 13:40 -07:00) Reworked the shared-family default from one 1.6M-parameter bundle into selectable hidden-size presets (`32k`, `65k`, `126k`, `256k`, `512k`) while keeping the published shared input/output slots locked. The new default future-run preset is `65k`.
- [x] (2026-03-15 14:10 -07:00) Tightened local responsiveness around the shared-family runtime by reserving CPU headroom for default self-play/training threads and by throttling the ML admin page's selected-run detail refresh path.
- [ ] Broaden the runtime-level regression suite so more of `tests/mlRuntime.test.js` explicitly covers the new shared family instead of assuming the old per-head default bundle.

## Surprises & Discoveries

- Observation: the move-template system is already strong enough to define a fixed action vocabulary for the policy head.
  Evidence: `src/services/ml/stateEncoding.js` deterministically generates legal move templates for every board square and declaration identity, and `src/services/ml/engine.js` encodes move actions using stable `from`, `to`, and `declaration` fields.

- Observation: the piece-id system is also already strong enough to define fixed belief slots.
  Evidence: `src/services/ml/engine.js` creates piece ids in a stable order (`w-0`..`w-7`, `b-0`..`b-7`) from `PIECE_POOL_BY_COLOR`, so opponent-piece slot order can be published without relying on runtime discovery.

- Observation: the current runtime training path parallelizes heads separately, which is incompatible with a truly shared encoder.
  Evidence: `src/services/ml/runtime.js` currently builds independent `trainHead` worker tasks for `policy`, `value`, and `identity`, each with its own optimizer state and copied model bundle.

- Observation: the first shared training test exposed an unrelated but real robustness issue in `buildTrainingSamplesFromDecisions()`: the helper assumed every identity sample carried the legacy `featureByIdentity` payload.
  Evidence: `tests/mlSharedEncoderModel.test.js` initially failed with `SyntaxError: "undefined" is not valid JSON` until `src/services/ml/gameRunner.js` was updated to let `deepClone(undefined)` pass through safely.

- Observation: once the default bundle grew to 1.6M parameters, the runtime persistence path became the next bottleneck rather than inference.
  Evidence: a plain persisted bootstrap/runtime save was initially writing about 34 MB to `runtime.json` and about 74 MB across run artifacts until tensor packing and working-bundle deduplication were added.

- Observation: the post-migration training follow-up exposed two shared-family runtime bugs that were easy to miss in the original green path: `trainSnapshot()` was not swapping in the returned trained bundle, and background training jobs were using the full dataset size as the batch size.
  Evidence: `trainSnapshot()` kept `const trainedBundle = cloneModelBundle(...)` without assigning `trainingResult.modelBundle`, while `runTrainingJob()` passed `samples.policySamples.length || 24` as `batchSize`.

## Decision Log

- Decision: publish a first shared model family named `shared_encoder_belief_ismcts_v1`.
  Rationale: the repo needs one explicit, versioned interface name so model names can advertise both family and parameter count and so future migrations can remain backward-compatible.
  Date/Author: 2026-03-14 / Codex

- Decision: keep legacy bundle compatibility rather than rewriting old snapshots in place.
  Rationale: `data/ml/runtime.json` and persisted run artifacts already depend on the current `version: 2` layout, and the repo instructions require backward compatibility unless an explicit migration is documented.
  Date/Author: 2026-03-14 / Codex

- Decision: define policy outputs over a deterministic fixed vocabulary built from the existing move templates plus non-move action slots.
  Rationale: that is the closest AlphaZero-like policy interface that fits the current game rules and lets search mask illegal actions while still publishing a stable output contract.
  Date/Author: 2026-03-14 / Codex

- Decision: define belief outputs as fixed opponent-piece slots, not a full joint hidden-state tensor.
  Rationale: fixed per-piece belief slots are a clean published contract, fit the existing hypothesis builder, and are much cheaper to train and integrate than a full joint hidden-state distribution.
  Date/Author: 2026-03-14 / Codex

- Decision: keep IS-MCTS rather than replacing search in the same change.
  Rationale: the user explicitly asked for shared encoder + belief head + IS-MCTS, and keeping search stable reduces migration risk while still removing the older model-interface assumptions.
  Date/Author: 2026-03-14 / Codex

- Decision: keep the legacy `policy`, `value`, and `identity` keys in the new bundle and add `encoder` as a new top-level block.
  Rationale: the runtime, persistence, and Python bridge already understand those top-level keys, so preserving them reduces the amount of refactoring needed while still publishing a truly shared-encoder family.
  Date/Author: 2026-03-14 / Codex

- Decision: use a fixed policy vocabulary of move-template slots plus non-move action slots, for a current total of 691 policy outputs.
  Rationale: that gives the repo a stable AlphaZero-like policy output without requiring dynamic action heads, and the move-template system already guarantees deterministic ordering.
  Date/Author: 2026-03-14 / Codex

- Decision: make the first shared default bundle materially larger and name it `Shared-Encoder MLP`.
  Rationale: the user explicitly asked for clean model naming and aggressive CPU/GPU utilization. The landed default has 1,598,172 parameters, enough to make GPU-backed training batches more meaningful than the previous tiny heads.
  Date/Author: 2026-03-14 / Codex

- Decision: persist model networks and optimizer tensors in packed float32 form, and avoid materializing zero-valued optimizer state until the first real training step.
  Rationale: published in-memory bundles must remain JSON-shaped and backward-compatible, but the expanded nested arrays were far too expensive to save/load for the new default family. Packing tensors and keeping zero-state lazy cuts persistence cost without changing the published model IO contract.
  Date/Author: 2026-03-14 / Codex

- Decision: keep the shared published interface fixed, but expose several hidden-size presets and make `65k` the default future-run preset instead of the original 1.6M default.
  Rationale: the 1.6M shared family proved too expensive for IS-MCTS-heavy self-play on this hardware. Presets preserve the AlphaZero-like shared interface while letting operators trade strength against throughput explicitly.
  Date/Author: 2026-03-15 / Codex

## Outcomes & Retrospective

The shared-interface migration is still the active published family, but the default future-run shape is no longer the original 1.6M-parameter bundle. Newly created shared bundles now publish the same `shared_encoder_belief_ismcts_v1` IO contract through selectable presets: `32k`, `65k`, `126k`, `256k`, and `512k`. The current default future-run preset is `65k`, and published run/model names still use the exact live parameter count from the chosen bundle. The published state input still has 1,534 slots, the fixed policy vocabulary still has 691 outputs, and the fixed opponent-belief head still has 40 outputs arranged as eight opponent-piece slots times five identity classes.

IS-MCTS now consumes that family through one shared-state encoding and one shared encoder trunk for policy, value, and belief inference. The training path can update the shared family in both the Node trainer and the Python Torch bridge without abandoning the existing JSON serialization contract. Legacy `version: 2` bundles are still normalized and loadable.

The runtime persistence path was also reworked for the larger shared family. Snapshot and run artifacts now store packed float32 tensors, untouched working bundles reuse their base-generation copy on disk, and brand new runs do not materialize zeroed Adam state until training actually begins. In direct measurements, a persisted bootstrap/runtime save dropped from about 34 MB in `runtime.json` plus about 74 MB of run-artifact data to about 8.5 MB in `runtime.json` plus about 8.5 MB for the checkpoint, with the redundant working-state artifact shrinking to 42 bytes in the untrained stopped-run case.

The follow-up stability/throughput pass also tightened the shared-family training runtime around those larger artifacts. Auto backend resolution now prefers Python CPU/CUDA whenever the bridge is available, future-run defaults are hardware-aware, snapshot/background training uses the same bounded batch-size heuristic, and both worker-thread tasks and bridge requests now fail on timeout instead of hanging indefinitely.

The biggest remaining gap is broad regression coverage. The dedicated shared-model test file is green, the focused runtime and route checks are green, and a direct Node persistence round-trip check is green, but the legacy-heavy `tests/mlRuntime.test.js` suite still contains explicit assumptions about the old default bundle shape and the Windows/Jest persistence suite remains much slower than the same direct Node flow.

## Context and Orientation

The current ML workflow is spread across several files that all need to agree about model shape. `src/services/ml/modeling.js` defines model-bundle creation, inference, and Node-side training for the current three-head setup. `src/services/ml/mcts.js` consumes that bundle during hidden-information search. `src/services/ml/gameRunner.js` converts MCTS decisions into replay-buffer training samples. `src/services/ml/runtime.js` persists model bundles, chooses training backends, validates sample shapes, and orchestrates continuous runs. `src/services/ml/pythonTrainingBridge.js` and `ml_backend/torch_training_bridge.py` are the optional GPU-capable training backend and must round-trip the same JSON bundle layout.

In this repository, “shared encoder” means one neural-network trunk that processes one canonical encoded game-state vector. The trunk output is then reused by separate output heads for policy, value, and belief. In this repository, “belief head” means a fixed-size output block whose slots correspond to the opponent’s stable piece ids for the chosen perspective. In this repository, “published model” means the new default model family produced by `createDefaultModelBundle()`; once that family is published, its input slot order and output slot order must remain stable.

The current model family does not satisfy those constraints. Policy currently scores legal actions one at a time from action-specific handcrafted features. Value currently consumes only a small hand-authored state summary. Identity currently predicts one piece’s hidden identity at a time from per-piece handcrafted features. Those are separate interfaces, not one published model interface.

## Plan of Work

First, introduce a new shared-encoder specification module under `src/services/ml/` that defines the locked state-input layout, the fixed policy vocabulary, the fixed belief-slot order, and helper functions to convert legal actions and opponent piece ids into those published slots. The state input will be a deterministic vector composed of global game metadata, per-piece slots for all stable piece ids, and a fixed window of recent public actions. The policy vocabulary will be a deterministic list of move-template slots plus the non-move action slots that can arise during live play. The belief slots will be a deterministic per-perspective ordering of the opponent’s eight stable piece ids.

Second, extend the model bundle format in `src/services/ml/modeling.js`. The new bundle family will keep the JSON-safe MLP storage format already used in the repo, but it will store an encoder network plus three head networks instead of three unrelated task networks. `createDefaultModelBundle()` will start returning the new family, while normalization will continue to preserve `version: 2` legacy bundles. Inference helpers will dispatch by family: legacy bundles keep the old path, new bundles use the shared state encoding and shared-head inference.

Third, rework the new-model MCTS and training record flow. `src/services/ml/mcts.js` will use the new shared model to evaluate information states, mask policy logits to legal actions, emit value estimates, and construct belief probabilities for opponent-piece slots. `src/services/ml/gameRunner.js` will store shared-state policy/value/belief training samples for the new family while still supporting older sample payloads already in persisted state.

Fourth, rework training. The Node trainer must stop updating heads independently for the new family because the encoder is shared. Instead, `src/services/ml/runtime.js` and the Python bridge must route new-family training through one combined training function that computes policy, value, and belief losses against the same encoder and reports the three losses in the existing history payload. Legacy bundles can keep the old independent-head training path.

Fifth, update runtime presentation and validation. Model naming must use the published family name plus clean parameter counts. Runtime shape signatures, optimizer-state compatibility checks, and sample validators must become family-aware so both legacy and shared bundles can coexist safely.

## Milestones

The first milestone is the published-interface milestone. At the end of that milestone, the repo contains the shared-encoder specification with a fixed state-input layout, fixed policy vocabulary, and fixed belief-slot order, and `createDefaultModelBundle()` returns the new family with descriptive model naming.

The second milestone is the shared-inference milestone. At the end of that milestone, IS-MCTS can evaluate the new family using one shared encoded state for policy, value, and belief outputs while still supporting older bundles.

The third milestone is the shared-training milestone. At the end of that milestone, the Node trainer and Python trainer can both update the shared encoder with policy, value, and belief losses while emitting the same run-history metrics already expected by the runtime.

The fourth milestone is the compatibility milestone. At the end of that milestone, legacy bundles still load, runtime persistence stays backward-compatible, and focused tests prove both the new family and the compatibility path.

## Concrete Steps

Work from the repository root `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

1. Add a new shared-interface helper module under `src/services/ml/` with the locked input/output definitions and conversion helpers.
2. Patch `src/services/ml/network.js` if needed so head backpropagation can feed gradients back into the shared encoder.
3. Extend `src/services/ml/modeling.js` to create, normalize, describe, infer with, and train the new shared bundle family while preserving the legacy bundle family.
4. Update `src/services/ml/mcts.js` and `src/services/ml/gameRunner.js` so the new family produces shared-state training records and belief samples.
5. Update `src/services/ml/runtime.js`, `src/services/ml/pythonTrainingBridge.js`, and `ml_backend/torch_training_bridge.py` so runtime training, optimizer compatibility, and model naming understand the new family.
6. Add focused tests in `tests/mlRuntime.test.js` and any new dedicated suite needed for the shared-interface helpers. Run focused ML tests after each milestone.

Expected command cadence during implementation:

    cd C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI
    node -c src\services\ml\modeling.js
    node -c src\services\ml\mcts.js
    node -c src\services\ml\runtime.js
    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="shared encoder|bootstrap|seed source|python-trained"
    npm.cmd test -- tests/mlRoutes.test.js

## Validation and Acceptance

Acceptance is behavioral.

Create a new default model bundle in Node and verify that its descriptor reports the shared family plus a clean parameter count. Then run focused ML tests and confirm that:

1. newly created bootstrap and random seed sources are named after the shared family and parameter count;
2. IS-MCTS can run with the new default bundle and return a legal action;
3. the training path can accept shared-family replay samples and update the shared bundle;
4. legacy bundles still normalize and load without breaking persistence.

If the Python backend is available, acceptance also includes a focused proof that a shared-family bundle can be trained through the Python bridge and still run inference through the Node runtime.

Focused validation completed on 2026-03-14:

    node -c src\services\ml\sharedEncoderModel.js
    node -c src\services\ml\modeling.js
    node -c src\services\ml\mcts.js
    node -c src\services\ml\runtime.js
    python -m py_compile ml_backend/torch_training_bridge.py
    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlSharedEncoderModel.test.js --runInBand
    npm.cmd test -- tests/mlRoutes.test.js
    node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js -t "default model bundles use the larger future-run architecture|bootstrap seeding upgrades legacy root baselines to the preferred modern snapshot" --runInBand
    node -e "<direct persistence round-trip assertion script>"

Observed results:

    - all four Node syntax checks passed
    - `python -m py_compile ml_backend/torch_training_bridge.py` passed
    - `tests/mlSharedEncoderModel.test.js` passed with 4 tests
    - `tests/mlRoutes.test.js` passed with 11 tests
    - the focused runtime naming/shape tests in `tests/mlRuntime.test.js` passed
    - a direct Node persistence round-trip check passed and reported:
      {"ok":true,"runtimeJsonBytes":8527040,"checkpointBytes":8529108,"workingStateBytes":42,"canContinue":true,"family":"shared_encoder_belief_ismcts_v1"}
    - a direct Node probe now reports the default preset bundle:
      {"family":"shared_encoder_belief_ismcts_v1","descriptor":"Shared-Encoder MLP (65.6K params)","params":65600,"presetId":"65k","stateInputSize":1534,"policyOutputSize":691,"beliefOutputSize":40}

## Idempotence and Recovery

This migration must be additive and safe to retry. The new shared-interface module can be introduced without deleting the legacy path. If the shared-family training path is incomplete at an intermediate step, keep `version: 2` bundle support intact so persisted historical runs remain readable. If any persisted run contains old replay samples that cannot train the new family, the runtime must avoid corrupting them and either continue using the legacy path or start new-family runs with fresh replay buffers.

## Artifacts and Notes

Important facts captured during research:

    src/services/ml/engine.js creates stable piece ids `w-0`..`w-7` and `b-0`..`b-7`.
    src/services/ml/stateEncoding.js already exposes deterministic move templates for legal moves.
    src/services/ml/runtime.js currently parallelizes training by head, which must change for a true shared encoder.

## Interfaces and Dependencies

At the end of the first implementation slice, the following interfaces must exist conceptually even if helper names vary slightly:

In `src/services/ml/sharedEncoderModel.js`, define helpers equivalent to:

    getSharedModelInterfaceSpec()
    encodeSharedState(state, perspective, guessedIdentities?)
    getSharedPolicyVocabulary()
    getBeliefPieceSlotsForPerspective(perspective)
    getPolicySlotForAction(state, perspective, action)

In `src/services/ml/modeling.js`, preserve the existing public exports while making them family-aware:

    createDefaultModelBundle(options?)
    cloneModelBundle(bundle)
    normalizeModelBundle(bundle)
    createOptimizerState(bundle)
    predictPolicy(modelBundle, state, perspective, actions?, guessedIdentities?)
    predictValue(modelBundle, state, perspective, guessedIdentities?)
    inferIdentityHypotheses(modelBundle, state, perspective, options?)
    trainPolicyModel(modelBundle, policySamples, optionsOrLearningRate?)
    trainValueModel(modelBundle, valueSamples, optionsOrLearningRate?)
    trainIdentityModel(modelBundle, identitySamples, optionsOrLearningRate?)

`src/services/ml/runtime.js`, `src/services/ml/pythonTrainingBridge.js`, and `ml_backend/torch_training_bridge.py` must all remain compatible with the JSON model-bundle format and must continue to round-trip optimizer state without introducing binary checkpoints.

Revision note: created on 2026-03-14 to guide the migration from the current separate-feature-head models to a shared-encoder + belief-head + IS-MCTS architecture with locked published IO slots.

Revision note: updated on 2026-03-14 after the first implementation slice landed. The plan now records the shipped shared-interface module, modeling/runtime/Python changes, focused test evidence, the current published slot counts, and the remaining runtime-suite follow-up work.

Revision note: updated again on 2026-03-14 after the training-runtime follow-up to record the new auto-backend behavior, timeout/watchdog coverage, and the shared-family batch-size/persistence fixes.

Revision note: updated on 2026-03-15 after the preset/downsize follow-up. The shared family still publishes the same IO contract, but the default future-run bundle is now the `65k` preset instead of the original 1.6M baseline, and the runtime/UI now reserve headroom for local browser responsiveness.
