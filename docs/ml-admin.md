# ML Admin Dashboard (`/ml-admin`)

Quick guide for using [`public/ml-admin.html`](../public/ml-admin.html).

## Open It

1. Start the API server (`npm run dev` or `npm start`).
2. Visit `http://localhost:3000/ml-admin`.
3. Click `Set Admin Secret` and enter your `ADMIN_SECRET` value.

## Page Sections

### Header Buttons
- `Refresh`: Reloads snapshots, simulations, loss data, and replay controls.
- `Set Admin Secret`: Stores `ADMIN_SECRET` in browser local storage and sends it in API headers.

### System Stats
- High-level counters for snapshots, simulations, games, and training runs.
- `Training stream` badge: live Socket.IO status and training progress.
- Status line: current operation/result messages.

### Snapshots
- `White Snapshot`: model bundle used for white in simulation.
- `Black Snapshot`: model bundle used for black in simulation.
- `Train Snapshot`: base snapshot to train from.
- `Fork`: clones the selected training snapshot into a new snapshot.
- Snapshot list cards: quick stats and latest losses per snapshot.

### Train Controls
- `Epochs`, `Learning Rate`, `New Snapshot Label`: training parameters.
- Simulation checklist: choose which simulation batches provide training samples.
- `Run Training Batch`: trains policy/value/identity models and creates a new snapshot.

### Simulation Controls
- Configure self-play/search settings:
  - `Game Count`, `Max Plies`
  - `MCTS Iterations`, `Max Depth`
  - `Identity Hypotheses`, `Risk Bias`, `Exploration`
  - optional `Seed`, optional `Simulation Label`
- `Run Simulation Batch`: runs games between selected white/black snapshots.

### Simulations
- Shows simulation history and results (wins/draws/average plies).
- `Replay` button on a simulation preselects it in the replay panel.

### Loss View
- Choose a snapshot to plot training losses over time:
  - Policy loss
  - Value loss
  - Identity loss
  - Identity accuracy (legend)

### Replay (God View)
- Select simulation + game, click `Load Replay`.
- Frame slider scrubs full-state replay.
- Board shows true identities for both sides.
- Log shows chosen actions per ply (`MOVE`, `CHALLENGE`, `BOMB`, `PASS`, `ON_DECK`).

## Typical Workflow

1. Set admin secret.
2. Run a simulation batch.
3. Select simulation(s) and run training.
4. Inspect loss curves for the new snapshot.
5. Replay a game to inspect decision flow.
