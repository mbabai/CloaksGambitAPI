# ML Backend Notes

## What This Layer Owns
- `torch_training_bridge.py` is the optional Python/Torch training backend used by `src/services/ml/pythonTrainingBridge.js`.
- `venv/` is the expected local Python environment for the bridge on this machine, including the CUDA-enabled Torch install when available.
- The `models/` and `simulations/` directories are not the authoritative runtime state for the current server pipeline. The live runtime persists through `data/ml/runtime.json` and MongoDB mirrors.

## Bridge Protocol
- The bridge is a long-lived stdin/stdout JSON protocol. Each line is a JSON object with `requestId` plus `payload`, and each response mirrors `requestId` with either `ok/result` or `ok=false/error`.
- Supported commands are currently `handshake` and `train_batch`.
- `devicePreference` supports `auto`, `cpu`, and `cuda`. `auto` should prefer CUDA when `torch.cuda.is_available()` is true.

## Compatibility Rules
- The Python trainer must read and write the same JSON model bundle shape used by Node. Do not introduce a checkpoint format that `src/services/ml/modeling.js` or `src/services/ml/runtime.js` cannot load.
- Optimizer state returned here must remain serializable back into the runtime file and safe to resume after process restart.
- This backend only changes training. Search, self-play, evaluation, and live test games still run inference from Node.

## Editing Guidance
- If you change the bridge payload or response shape, update `src/services/ml/pythonTrainingBridge.js`, `src/services/ml/runtime.js`, and the ML docs/tests together.
- Keep stderr useful. Node captures recent stderr lines for bridge debugging, so concise actionable tracebacks are better than silent failures.
