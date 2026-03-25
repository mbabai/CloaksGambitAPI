# Docs Notes

## What Lives Here
- `docs/` mixes durable documentation (`API.md`, UI docs) with point-in-time ExecPlans that explain why recent refactors happened.
- `rules.md` at the repository root is the canonical long-form rules text. Do not fork rule wording across multiple docs unless the duplication is intentional and clearly scoped.

## Read These First For Recent Gameplay Refactors
- `docs/board-annotations-clock-rules-execplan.md`: documents the live rules cleanup, spectator/board annotation work, and the first clock authority consolidation.
- `docs/clock-authority-debug-execplan.md`: documents the follow-up refactor that moved live clocks onto persisted `game.clockState`.
- `docs/canvas-game-view-execplan.md`: documents the shared Canvas board surface, the new `gameView` client abstraction, and the first player/spectator/replay migration onto explicit view modes.

## Documentation Maintenance Rules
- If auth behavior changes, update the relevant subtree docs in `src/routes/auth/AGENTS.md`, `src/utils/AGENTS.md`, and any user-facing notes in `README.md`.
- If MongoDB startup or environment handling changes, update `src/AGENTS.md` and `README.md` together.
- If gameplay rules or live-route behavior changes, update `rules.md`, `src/routes/v1/gameAction/AGENTS.md`, and the tests that lock the behavior in.
- Prefer adding implementation notes near the code's owning subtree over writing one large architecture dump in this folder.
