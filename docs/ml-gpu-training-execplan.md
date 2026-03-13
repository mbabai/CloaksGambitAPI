# Enable GPU-Capable Training While Keeping CPU Inference

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

## Purpose / Big Picture

After this change, Cloak's Gambit training can run through a Python Torch backend that is capable of using CUDA on the local RTX 2080, while self-play, simulations, and deployed gameplay continue to use the existing Node CPU inference stack. A human should be able to select a training backend/device from the ML workbench, train a snapshot, and still load the resulting weights into the Node runtime without any inference-path migration.

## Progress

- [x] (2026-03-12 13:03 -07:00) Added `ml_backend/torch_training_bridge.py` to train the policy, value, and identity heads in PyTorch and serialize the updated weights back into the existing JSON network format.
- [x] (2026-03-12 13:07 -07:00) Added `src/services/ml/pythonTrainingBridge.js` so Node can keep a persistent Python bridge process and exchange JSON-line training requests.
- [x] (2026-03-12 13:16 -07:00) Threaded `trainingBackend` and `trainingDevicePreference` through runtime normalization, training entrypoints, and the ML admin workbench form.
- [x] (2026-03-12 13:34 -07:00) Fixed the remaining runtime cleanup issues, aligned the workbench defaults with `trainingBackend: auto`, and added focused route/runtime coverage for backend-device forwarding and Node CPU inference compatibility.
- [x] (2026-03-12 13:42 -07:00) Upgraded `ml_backend\\venv` from `torch 2.8.0+cpu` to `torch 2.8.0+cu128` and verified CUDA availability through both Python and the Node bridge handshake.
- [x] (2026-03-12 13:50 -07:00) Ran a focused runtime-level proof that trained a small batch with `trainingBackend: 'python'`, `trainingDevicePreference: 'cuda'`, then executed Node-side MCTS inference on the returned model bundle.

## Surprises & Discoveries

- Observation: the local machine has a usable NVIDIA stack, but the Python venv is still CPU-only.
  Evidence: `nvidia-smi` reports an `NVIDIA GeForce RTX 2080` with driver `566.14` and CUDA `12.7`, while `ml_backend\\venv\\Scripts\\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"` returned `2.8.0+cpu` and `False`.

- Observation: the initial runtime patch set left `src/services/ml/runtime.js` in a broken parse state.
  Evidence: `node -c src\\services\\ml\\runtime.js` failed on March 12, 2026 with `SyntaxError: Identifier 'trainingBackend' has already been declared` inside `startTrainingJob()`.

- Observation: CPU inference compatibility is practical because the PyTorch bridge exports the same JSON weight layout the existing Node trainer and inference code already consume.
  Evidence: `ml_backend/torch_training_bridge.py` reconstructs MLPs from `network.layers[].weights/biases` and exports the trained bundle back into that same structure.

- Observation: a full `trainSnapshot()` test through CPU-only PyTorch was too slow for a focused Jest slice, but the lower-level bridge path was fast enough for a reliable compatibility test.
  Evidence: the original explicit Python-path test timed out at 120 seconds, while a reduced `trainModelBundleBatch()` compatibility test completed in about 11 seconds and still proved Node CPU inference on a Python-trained bundle.

## Decision Log

- Decision: keep training and inference split across runtimes.
  Rationale: the user explicitly wants CPU inference to remain available for self-play and deployment, and the Node inference stack is already integrated with the game engine and MCTS.
  Date/Author: 2026-03-12 / Codex

- Decision: expose backend/device selection explicitly rather than silently replacing the Node trainer.
  Rationale: this lets operators choose between the established Node trainer, Python CPU, Python CUDA, or auto-selection without making deployment depend on Python.
  Date/Author: 2026-03-12 / Codex

- Decision: default continuous runs to `trainingBackend: auto`.
  Rationale: when CUDA is available, the runtime should prefer GPU-capable training automatically, but `auto` can still fall back to the Node CPU trainer when Python/CUDA is unavailable.
  Date/Author: 2026-03-12 / Codex

## Outcomes & Retrospective

The runtime now supports GPU-capable training through a persistent Python Torch bridge while preserving the existing Node CPU inference path for self-play, simulations, and deployment. Continuous runs default to `trainingBackend: auto`, so they will prefer the Python Torch backend when CUDA is available and fall back to the Node trainer otherwise. The ML workbench, training routes, and runtime summaries all expose backend/device selection explicitly.

On this machine, `ml_backend\\venv` now reports `torch 2.8.0+cu128` with `cudaAvailable: true` and device name `NVIDIA GeForce RTX 2080`. A focused end-to-end runtime probe successfully trained a small batch on `device: 'cuda'` and immediately ran Node-side MCTS inference on the returned checkpoint, confirming that the JSON weight format remains CPU-inference compatible.

## Context and Orientation

The relevant runtime orchestration is in `src/services/ml/runtime.js`. The Node-side bridge wrapper is `src/services/ml/pythonTrainingBridge.js`. The PyTorch bridge implementation is `ml_backend/torch_training_bridge.py`. The training controls live in `public/ml-admin.html` and `public/ml-admin.js`. High-signal regression coverage is in `tests/mlRuntime.test.js` and `tests/mlRoutes.test.js`.

## Plan of Work

First, repair the runtime issues left by the initial migration and finish threading backend/device values through any missing test or docs surfaces. Then add a focused runtime test that trains through the Python bridge and immediately uses the resulting checkpoint through the existing Node CPU inference path.

After the code path is verified, upgrade the Python venv to a CUDA-enabled PyTorch build using the official PyTorch Windows wheel channel. Once the venv can report `torch.cuda.is_available() === True`, rerun the bridge handshake and a minimal training batch with `trainingBackend: 'python'` and `trainingDevicePreference: 'cuda'`.

Finally, capture the outcomes in this plan and keep the operator docs aligned with the new configuration.

## Milestones

The first milestone is code-path correctness. At the end of that milestone, the runtime parses again, the training routes/workbench reflect backend/device selection, and a focused test proves Python-trained checkpoints still run under Node CPU inference.

The second milestone is environment readiness. At the end of that milestone, the local `ml_backend` venv reports CUDA availability through PyTorch and the bridge handshake exposes that capability back to Node.

The third milestone is operator proof. At the end of that milestone, a focused end-to-end check shows the runtime can train with the Python backend and keep using the same checkpoints for CPU inference.

## Concrete Steps

1. Repair the runtime parse error and any remaining training-backend plumbing gaps.
2. Extend focused Jest coverage for route forwarding and Python-trained CPU inference.
3. Update the ML admin docs with the new backend/device controls and the CPU-inference guarantee.
4. Install a CUDA-enabled PyTorch build into `ml_backend\\venv`.
5. Verify the bridge handshake and run a minimal training check with the Python backend.

## Validation and Acceptance

Run:

  node -c src\\services\\ml\\runtime.js

and expect the runtime to parse cleanly. Then run:

  npm.cmd test -- tests/mlRoutes.test.js

and expect the route suite to pass with backend/device fields forwarded correctly. Then run:

  $env:ENABLE_ML_WORKFLOW='true'
  node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="run workbench surfaces defaults|training creates a child snapshot with loss history|python-trained snapshots still run through Node CPU inference|background training jobs complete and create a new snapshot"

and expect the focused runtime slice to pass. Acceptance is that the Python trainer path exists, the runtime still uses CPU inference, and the local environment can expose CUDA if the PyTorch install supports it.

Validation evidence captured on 2026-03-12:

  - `node -c src\\services\\ml\\runtime.js` passed.
  - `node -c src\\services\\ml\\pythonTrainingBridge.js` passed.
  - `npm.cmd test -- tests/mlRoutes.test.js` passed with 7 tests.
  - Focused `tests/mlRuntime.test.js` slice passed with 4 tests, including the Python-trained Node CPU inference check.
  - `ml_backend\\venv\\Scripts\\python.exe -c "import torch, json; ..."` reported `torch: 2.8.0+cu128`, `cuda_available: true`, `cuda_name: NVIDIA GeForce RTX 2080`.
  - The Node bridge handshake reported `cudaAvailable: true` and `cudaDeviceName: NVIDIA GeForce RTX 2080`.
  - A direct runtime probe returned `{ backend: 'python', device: 'cuda', legal: true }` after training through the bridge and running Node CPU inference on the trained weights.

## Idempotence and Recovery

The bridge is additive. If the Python environment is missing or still CPU-only, `trainingBackend: auto` can fall back to the Node trainer and `trainingBackend: python` can still run on CPU. If the CUDA install fails, keep the bridge code and tests intact and report the environment blocker rather than reverting the migration.

## Interfaces and Dependencies

`src/services/ml/runtime.js` must continue exposing the existing `MlRuntime` interface and its run/training methods. The Python bridge must continue accepting and returning plain JSON so it can be driven from the Node process without changing checkpoint storage. The saved model bundle format must remain compatible with the existing Node inference code.

Revision note (2026-03-12 / Codex): completed the GPU-training migration by repairing the runtime parse break, aligning the workbench defaults with `auto`, adding focused Jest coverage for route forwarding and Python-trained CPU inference, upgrading the local venv to `torch 2.8.0+cu128`, and validating both the bridge handshake and a small CUDA training plus Node inference probe.
