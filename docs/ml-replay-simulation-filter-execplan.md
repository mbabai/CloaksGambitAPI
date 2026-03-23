# Add Simulation Replay Theater Filters

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows [PLANS.md](../PLANS.md) from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the run replay theater in `/ml-admin` can browse two retained-game streams without changing the existing evaluation workflow. Operators can pick a run, toggle between `Evaluation` and `Simulation`, and then either keep the generation-based checkpoint replay list or browse retained self-play games filtered by curriculum shape: total board pieces and advance depth.

## Progress

- [x] (2026-03-21 12:10 -07:00) Reviewed the retained replay runtime path, `/runs/:runId/games` route contract, and the replay selector state in `public/ml-admin.js`.
- [x] (2026-03-21 12:25 -07:00) Extended retained-game summaries to preserve curriculum metadata and added replay-type-aware retained game listing on the runtime and route layers.
- [x] (2026-03-21 12:40 -07:00) Added replay type and curriculum filter controls to `public/ml-admin.html` and `public/ml-admin.js`, keeping evaluation mode unchanged.
- [ ] (2026-03-21 12:40 -07:00) Run focused Jest validation for the route and runtime replay cases.

## Surprises & Discoveries

- Observation: the runtime already retained self-play games in `run.retainedGames`; the replay theater simply never surfaced them because summary compaction dropped curriculum metadata and the list query hard-filtered evaluation only.
  Evidence: `retainRunGames()` already stores all phases, while `listRunReplayGameSummaries()` previously filtered `phase === 'evaluation'`.

## Decision Log

- Decision: map replay `Simulation` to retained `selfplay` games and keep `Evaluation` mapped to retained evaluation games.
  Rationale: this matches the existing runtime phase names and avoids adding a second retained-game storage path.
  Date/Author: 2026-03-21 / Codex

- Decision: filter simulation replays by total board pieces and advance depth, not separate white/black piece counts.
  Rationale: the user explicitly narrowed the first version to those two metrics, and total board pieces is the simplest operator-facing board-material summary.
  Date/Author: 2026-03-21 / Codex

## Outcomes & Retrospective

The replay theater remains backward-compatible for evaluation browsing while now exposing retained self-play simulations through the same replay payload path. The main follow-up risk is UI regression in `public/ml-admin.js`, so focused Jest coverage plus a quick manual browser check are the intended verification gates.

## Plan of Work

1. Preserve curriculum metadata in retained run game summaries and allow `listRunGames()` to select either evaluation or simulation rows.
2. Extend `GET /api/v1/ml/runs/:runId/games` with a `replayType` query parameter while keeping evaluation as the default.
3. Add a replay type selector plus simulation-only curriculum filters in the admin UI.
4. Update route/runtime tests and operator docs.

## Validation and Acceptance

Acceptance is:

1. `GET /api/v1/ml/runs/:runId/games` still defaults to evaluation rows.
2. `GET /api/v1/ml/runs/:runId/games?replayType=simulation` returns retained self-play summaries with curriculum metadata.
3. The Replay tab keeps the current evaluation flow unchanged.
4. Switching to `Simulation` shows retained self-play games and allows filtering by total board pieces and advance depth.

