# ML Admin Dashboard (`/ml-admin`)

Quick guide for using [`public/ml-admin.html`](../public/ml-admin.html).

## Open It

1. Start the API server (`npm run dev` or `npm start`).
2. Ensure the ML workflow is enabled.
   - Development defaults to enabled unless `ENABLE_ML_WORKFLOW=false`.
   - Production defaults to disabled unless `ENABLE_ML_WORKFLOW=true`.
3. Visit `http://localhost:<port>/ml-admin`.
4. Authenticate as the admin user. The page uses the same server-enforced admin session as the rest of the admin surface.

If `/ml-admin` or `/api/v1/ml/*` returns `404`, the ML feature gate is off.

## What The Page Uses

- `GET /api/v1/ml/workbench` for defaults, run summaries, retained replay metadata, the promoted-model bot checklist state, and the latest resource telemetry snapshot.
- `GET /api/v1/ml/promoted-bots` and `PUT /api/v1/ml/promoted-bots` for the promoted-model checkbox list in the `Test` tab.
- `GET /api/v1/ml/live` plus the `/admin` socket namespace's `ml:runProgress` event for reconnect-safe live status.
- `GET /api/v1/ml/runs/:runId/games` and `GET /api/v1/ml/runs/:runId/replay/:gameId` for replay browsing.
- Older snapshot/simulation/training endpoints still exist for compatibility, but the main operator workflow is run-oriented now.

`/api/v1/ml/live` now includes `resourceTelemetry`, a rolling 10-minute history sampled every 2 seconds:

- `cpu.currentPercent` and `cpu.history`
- `gpu.currentPercent`, `gpu.history`, and `gpu.label`
- `sampleIntervalMs` and `windowMs`

GPU telemetry is best-effort and currently comes from `nvidia-smi` when it is available on the host.

## Page Sections

### Config

- Name the run and choose the seed mode:
  - `Bootstrap Model`: start from the current bootstrap model bundle.
  - `Random Init`: start from a fresh random model bundle.
- Configure the continuous pipeline:
  - self-play games per cycle
  - parallel game workers for self-play and evaluation
  - MCTS simulations, depth, hidden-identity hypotheses, risk bias, and exploration
  - replay-buffer size
  - batch size, learning rate, weight decay, and gradient clipping
  - training backend/device plus parallel training heads
  - training steps per cycle and checkpoint interval
  - worker refresh interval, graph stride, and older-generation sampling probability
- Promotion is staged now:
  - stage 1: pre-promotion test against the prior promoted generation
  - stage 2: full promotion tests against prior promoted lineage
- Optional stop conditions let the run end on best-generation, self-play, training-step, or failed-promotion limits.
- `Kick Off Run` starts one continuous self-play / train / evaluate loop. The runtime only allows one active run at a time.

### Runs

- Shows active and completed runs in one table.
- The top `Run State` row now includes CPU and GPU usage cards with:
  - the current percentage
  - a compact sparkline for the last 10 minutes
  - 2-second sampling cadence
- Selecting a run opens its detail view with:
  - status, elapsed time, and update time
  - best generation and worker generation
  - self-play games, evaluation games, training steps, and replay-buffer occupancy
  - retained generation labels and recent evaluation outcome
- `Stop Run` requests a graceful stop. `Delete Run` only works after the run is no longer active.
- `Generation Win Graph` plots generation-vs-generation results retained by the run. Hover details reflect the current staged evaluation structure, including informational `G0` results and promotion-lineage tests.
- Refreshing the page is safe. The browser reconciles live state from both polling and the admin socket.

### Replay

- Choose a run.
- Optionally filter retained games by one generation number.
- Select one retained game from the list.
- Replay controls include:
  - frame slider
  - play / pause
  - prev / next
  - playback speed
- Replays use god view, so both sides' identities are visible.
- The decision inspector and move log update with the selected frame.

### Test

- The tab lists every promoted generation currently stored in the ML runtime.
- Check the models that should appear in the main client’s bot dropdown.
- Checked models are appended after `Easy`, `Medium`, and `Hard` in the normal player bot picker.
- Starting one of those enabled promoted models from the main client creates a normal live bot match.
- The selected generation controls the bot seat using the same Node inference stack used by self-play, evaluation, and deployment.

## Training Backend Notes

- `Node CPU` keeps training inside the existing JavaScript trainer.
- `Python Torch` sends training batches through `ml_backend/torch_training_bridge.py`, which can use CPU or CUDA.
- `Auto` prefers the Python Torch backend when CUDA is available and otherwise falls back to the Node trainer.
- Inference for self-play, evaluation, retained replay generation, and live test games still runs through the Node path. The Python backend only updates checkpoint weights and writes them back into the same JSON network format.

## Typical Workflow

1. Open `Config`, choose the run settings, and start a run.
2. Switch to `Runs` to monitor replay-buffer growth, training cadence, staged promotion gates, and generation history.
3. Use `Replay` to inspect retained games from the generations you care about.
4. Use `Test` to decide which promoted models should be exposed as normal bot opponents for human sanity checks in the main client.
