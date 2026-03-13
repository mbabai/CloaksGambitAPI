# ML Staged Promotion Evaluation ExecPlan

## Goal
Replace the old single-matchup promotion gate with a staged evaluation flow:

1. Always record an informational 50-game result versus `G0`.
2. Run a pre-promotion test versus the prior promoted generation.
3. If that passes, run full promotion tests against the prior promoted lineage.

The admin UI should expose knobs for the stage 1 and stage 2 gate settings and show the new evaluation structure in the generation chart.

## Implementation
- Added staged promotion config fields in `src/services/ml/runtime.js`:
  - `prePromotionTestGames`
  - `prePromotionTestWinRate`
  - `promotionTestGames`
  - `promotionTestWinRate`
  - `promotionTestPriorGenerations`
- Kept backward compatibility by mapping legacy `evalGamesPerCheckpoint` and `promotionWinrateThreshold` into the new config when loading older runs.
- Reworked `evaluateRunGeneration()` to:
  - always collect `gen0Info`
  - gate on `prePromotionTest`
  - only run `promotionTests` after stage 1 passes
  - require every stage 2 matchup to clear the configured threshold
- Updated the evaluation series builder so the chart renders:
  - `vs G0 (info)`
  - `vs prior promotion`
  - hover details for the full promotion matchup set
- Updated the admin config UI to expose the new staged-promotion controls.
- Updated the chart renderer to support star markers for passed pre-promotion tests and richer hover tooltips.

## Validation
- `node -c src/services/ml/runtime.js`
- focused `tests/mlRuntime.test.js` staged promotion gate test
- `npm.cmd test -- tests/mlRoutes.test.js`

## Notes
- The always-on `G0` result is informational only and does not affect promotion.
- The pre-promotion point is the chart’s promotion marker: star when stage 1 passes, dot when it fails.
- Stage 2 hover details show the win rates for the prior promoted generations that were actually tested.
