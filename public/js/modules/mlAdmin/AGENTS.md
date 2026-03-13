# ML Admin Module Notes

## What This Subtree Owns
- `generationWinChart.js`: canvas charting for generation-vs-generation evaluation history.
- `replay.js`: retained-game replay theater, frame playback, decision inspector, and board layer composition.
- `utils.js`: shared formatting and DOM helpers used by the ML workbench modules.
- `public/ml-admin.js` remains the page-level controller; this subtree is the reusable rendering layer beneath it.

## Data Contracts
- Inputs come from `GET /api/v1/ml/workbench`, `GET /api/v1/ml/live`, `GET /api/v1/ml/runs/:runId`, `GET /api/v1/ml/runs/:runId/games`, and `GET /api/v1/ml/runs/:runId/replay/:gameId`.
- Replays are god-view by design. Keep decision traces, action logs, and both sides' identities readable without relying on live-game masking rules.
- Canvas sizing, DOM ids, and replay layer containers must stay aligned with `public/ml-admin.html` and the selectors in `public/ml-admin.js`.

## Editing Guidance
- Prefer moving chart/replay presentation logic into this subtree instead of growing `public/ml-admin.js`.
- If you change replay frame metadata or decision payload shape, update both the route/runtime producers and `replay.js`.
- If you change tab layout or element ids in `public/ml-admin.html`, update the selector map in `public/ml-admin.js` in the same edit. Duplicate ids break this surface quickly.
