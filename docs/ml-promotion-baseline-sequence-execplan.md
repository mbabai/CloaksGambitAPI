# ML Promotion Baseline Sequence ExecPlan

## Goal
Replace the staged promotion flow with a strict baseline-first sequence:

1. Beat the current baseline generation.
2. If that passes, beat the most recent promoted generations in order.
3. If the promoted lineage is shorter than the requested count, reuse the baseline generation for the remaining checks.
4. Promote only if every step passes.
5. If the candidate both promotes and sweeps the baseline 100%, move the baseline forward to that newly promoted generation.

## Implementation
- Reworked `src/services/ml/runtime.js` promotion evaluation so the baseline gate is the first blocking step and the old separate pre-promotion matchup is removed from new evaluations.
- Kept backward-compatible evaluation readers so older persisted histories with `prePromotionTest` still render.
- Updated `/ml-admin` labels and helper copy to describe the baseline-first gate instead of the old pre-promotion stage.
- Refreshed the focused ML runtime tests to cover:
  - ordered baseline then promotion checks
  - stop-on-first-failure behavior
  - baseline fallback when there are not enough prior promoted generations
  - baseline advancement after a perfect baseline sweep plus promotion

## Validation
- `npm.cmd test -- tests/mlRuntime.test.js --runInBand --testNamePattern="evaluation uses a baseline gate|promotion-short-circuit|promotion-baseline-fallback|baseline-advance|chunking the baseline and promotion batches|evaluation series separates baseline"`
- `node --check src/services/ml/runtime.js`
- `node --check public/ml-admin.js`
