# ML Backend Notes

## What This Layer Owns
- `torch_training_bridge.py` is the optional Python/Torch training backend used by `src/services/ml/pythonTrainingBridge.js`.
- `venv/` is the expected local Python environment for the bridge on this machine, including the CUDA-enabled Torch install when available.
- The `models/` and `simulations/` directories are not the authoritative runtime state for the current server pipeline. The live runtime persists through `data/ml/runtime.json` and MongoDB mirrors.

## Bridge Protocol
- The bridge is a long-lived stdin/stdout JSON protocol. Each line is a JSON object with `requestId` plus `payload`, and each response mirrors `requestId` with either `ok/result` or `ok=false/error`.
- Supported commands are `handshake`, `train_batch`, `train_session_batch`, `export_training_session`, and `close_training_session`.
- `devicePreference` supports `auto`, `cpu`, and `cuda`. `auto` should prefer CUDA when `torch.cuda.is_available()` is true.
- The active shared-family path uses `train_session_batch`. That command keeps the shared encoder plus optimizer state resident in the Python process between steps, accepts combined `sharedSamples`, and only exports JSON weights/optimizer state when Node explicitly asks for it.

## Compatibility Rules
- The Python trainer must read and write the same JSON model bundle shape used by Node. Do not introduce a checkpoint format that `src/services/ml/modeling.js` or `src/services/ml/runtime.js` cannot load.
- Optimizer state returned here must remain serializable back into the runtime file and safe to resume after process restart.
- This backend only changes training. Search, self-play, evaluation, and live test games still run inference from Node.
- Shared-family session training is fused: one batch can contribute policy, value, and belief losses in a single encoder forward/backward pass. Keep that invariant unless the Node runtime/docs are updated to describe a different current-best path.

## Editing Guidance
- If you change the bridge payload or response shape, update `src/services/ml/pythonTrainingBridge.js`, `src/services/ml/runtime.js`, and the ML docs/tests together.
- Keep stderr useful. Node captures recent stderr lines for bridge debugging, so concise actionable tracebacks are better than silent failures.
- Clean shutdown and checkpoint resume depend on explicit session export calls from Node. Do not make the Python process silently discard session state that Node still expects to export on demand.
