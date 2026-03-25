# Docs Notes

## What Lives Here
- `docs/` mixes durable documentation (`API.md`, UI docs, ML admin notes) with point-in-time ExecPlans that explain why recent refactors happened.
- `rules.md` at the repository root is the canonical long-form rules text. Do not fork rule wording across multiple docs unless the duplication is intentional and clearly scoped.

## Read These First For Recent Gameplay Refactors
- `docs/board-annotations-clock-rules-execplan.md`: documents the live rules cleanup, spectator/board annotation work, and the first clock authority consolidation.
- `docs/clock-authority-debug-execplan.md`: documents the follow-up refactor that moved live clocks onto persisted `game.clockState`.
- `docs/canvas-game-view-execplan.md`: documents the shared Canvas board surface, the new `gameView` client abstraction, and the first player/spectator/replay migration onto explicit view modes.

## Read These First For Current ML Work
- `docs/ml-admin.md`: operator-facing guide for the current `/ml-admin` run workbench.
- `docs/ml-hardware-optimizations.md`: consolidated inventory of CPU/GPU/throughput ML optimization work, current runtime heuristics, and known docs-vs-code mismatches.
- `docs/ml-runtime-rebuild-execplan.md`: background on the earlier simulation/training/snapshot runtime rebuild.
- `docs/ml-continuous-run-pipeline-execplan.md`: explains the current run-oriented pipeline, generation tracking, replay buffers, and workbench contract.
- `docs/ml-parallel-runtime-execplan.md`: documents worker-thread game concurrency and optional parallel head training.
- `docs/ml-gpu-training-execplan.md`: documents the optional Python Torch training backend and CUDA path.
- `docs/ml-state-encoding-execplan.md`: documents the encoded-state/search cache refactor.
- `docs/ml-training-correctness-execplan.md`: documents recent training-correctness fixes and validation strategy.
- `docs/ml-staged-promotion-eval-execplan.md`: documents the staged promotion gate and chart semantics.

## Documentation Maintenance Rules
- If auth behavior changes, update the relevant subtree docs in `src/routes/auth/AGENTS.md`, `src/utils/AGENTS.md`, and any user-facing notes in `README.md`.
- If MongoDB startup or environment handling changes, update `src/AGENTS.md` and `README.md` together.
- If gameplay rules or live-route behavior changes, update `rules.md`, `src/routes/v1/gameAction/AGENTS.md`, and the tests that lock the behavior in.
- If the ML pipeline changes, update the closest subtree docs first: `src/services/ml/AGENTS.md`, `src/routes/v1/ml/AGENTS.md`, `public/js/modules/mlAdmin/AGENTS.md`, `ml_backend/AGENTS.md`, and any relevant ML ExecPlan or operator guide in this folder.
- Prefer adding implementation notes near the code's owning subtree over writing one large architecture dump in this folder.
