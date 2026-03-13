# Add Run Continue And Promoted-Generation Seeding To ML Workbench

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](../PLANS.md).

## Purpose / Big Picture

After this change, `/ml-admin` will let an operator restart a previously stopped continuous ML run instead of only deleting it, and the `Config` tab will let a new run start from an already-promoted generation from any existing non-deleted run. Bootstrap and random initialization remain the first two seed choices, but the same picker will also list promoted generations such as `Run 0006 | G12`.

The observable success case is: stop a run from `/ml-admin`, wait for it to reach `stopped`, click `Continue`, and see it return to `running` without creating a new run id. Separately, open the `Config` tab and see a seed-model list whose first entries are `Bootstrap Model` and `Random Init`, followed by promoted generations from existing runs; starting a new run from one of those promoted generations produces a new run whose generation 0 uses that promoted model as its seed.

## Progress

- [x] (2026-03-12 18:15 -07:00) Read `PLANS.md`, `public/ml-admin.html`, `public/ml-admin.js`, `src/routes/v1/ml/index.js`, and the relevant `MlRuntime` run lifecycle methods.
- [x] (2026-03-12 18:27 -07:00) Confirmed that stopped runs are currently compacted like completed runs, which removes `working.modelBundle` and makes true resume impossible.
- [x] (2026-03-12 18:31 -07:00) Chose the implementation shape: preserve resumable state for `stopped` runs, add a dedicated continue route/runtime method, and expose a server-authored seed-source list in the workbench payload.
- [x] (2026-03-12 19:11 -07:00) Implemented runtime support for resumable stopped runs, continue-in-place behavior, and promoted-generation seed resolution in `src/services/ml/runtime.js`.
- [x] (2026-03-12 19:18 -07:00) Added `POST /api/v1/ml/runs/:runId/continue` and extended the workbench payload with server-authored seed-source options.
- [x] (2026-03-12 19:30 -07:00) Updated `/ml-admin` so the config tab renders the new seed-model dropdown and the runs tab exposes `Continue` actions for resumable stopped runs.
- [x] (2026-03-12 19:47 -07:00) Added focused regression coverage and ran passing route/persistence plus targeted runtime validation for the new behavior.

## Surprises & Discoveries

- Observation: `stopRun()` does not itself finalize the run. It only switches the run to `stopping`; the long-running pipeline later exits and converts that to `stopped`.
  Evidence: `src/services/ml/runtime.js` sets `run.status = 'stopping'` in `stopRun()`, and `runContinuousPipeline()` later writes `run.status = 'stopped'` when the stop reason is `manual_stop`.

- Observation: the existing browser seed selector is not dynamic at all. `public/ml-admin.html` hardcodes only `bootstrap` and `random`, and `public/ml-admin.js` reads that select directly into `seedMode`.
  Evidence: `public/ml-admin.html` contains two fixed `<option>` elements for `#seedModeSelect`, and `readRunConfigForm()` returns `seedMode: els.seedModeSelect.value || 'bootstrap'`.

- Observation: promoted generations already have stable ids and detection helpers in the runtime, so the same `generation:<runId>:<generation>` identifier format can be reused for the new seed-source picker.
  Evidence: `buildPromotedModelBotId()`, `parsePromotedModelBotId()`, and `isPromotedGenerationRecord()` already exist in `src/services/ml/runtime.js`.

- Observation: the broader `tests/mlRuntime.test.js` suite is currently blocked by an unrelated pre-existing simulation bug (`requestedKey is not defined`) and by older persistence expectations that still assume the monolithic run layout.
  Evidence: running the full file on 2026-03-12 fails in `runSingleGame()` around `src/services/ml/runtime.js:4971` before many unrelated simulation and pipeline tests finish.

## Decision Log

- Decision: only `stopped` runs will be resumable through the new `Continue` action; `completed` and `error` runs stay terminal.
  Rationale: the user explicitly asked for continuing stopped runs, and preserving resumable working state for fully terminal outcomes would increase storage cost without a requested operator benefit.
  Date/Author: 2026-03-12 / Codex

- Decision: the workbench payload will publish one seed-source list from the server instead of having the browser infer promoted generations on its own.
  Rationale: the server already owns the rules for what counts as a promoted generation and whether a stopped run is resumable, so the client should render a stable summary rather than duplicate that logic.
  Date/Author: 2026-03-12 / Codex

- Decision: the seed selector will remain a single dropdown that starts with `Bootstrap Model` and `Random Init`, then appends promoted generations from non-deleted runs.
  Rationale: this matches the user request exactly and avoids adding a second dependent selector.
  Date/Author: 2026-03-12 / Codex

## Outcomes & Retrospective

Outcome: `/ml-admin` now exposes a real continue flow for stopped runs. The runtime keeps resumable state for `stopped` runs, the admin API exposes `POST /api/v1/ml/runs/:runId/continue`, and the UI shows `Continue Run` in the selected-run panel plus `Continue` actions in the runs table when the server says the run is resumable.

Outcome: the run start form now accepts promoted-generation seeds from existing runs. The workbench payload publishes a single ordered seed-source list, and the browser keeps `Bootstrap Model` and `Random Init` at the top while appending promoted generations underneath.

Residual gap: older stopped runs that were already compacted before this change may still be non-resumable because their working model state was already discarded.

Residual gap: the full `tests/mlRuntime.test.js` file is not green because of unrelated failures outside this feature. Focused validations for the new behavior do pass and are recorded below.

## Context and Orientation

The ML admin page is served from `public/ml-admin.html` and `public/ml-admin.js`. The `Config` tab lets an admin start a continuous run, and the `Runs` tab shows a table plus a selected-run panel with stop/delete actions. The browser gets almost all of its data from `GET /api/v1/ml/workbench`, which is implemented in `src/routes/v1/ml/index.js` and backed by `MlRuntime.getWorkbench()` in `src/services/ml/runtime.js`.

A continuous ML run is an in-memory record in `MlRuntime.state.runs`. The record includes promoted generations in `run.generations`, a training replay buffer in `run.replayBuffer`, and the current resumable training state in `run.working`. The critical fields for resume are `run.working.modelBundle` and `run.working.optimizerState`. Those values are currently erased for every non-running run by `compactTerminalRunState()`, which is why stopped runs cannot actually continue today even though their summaries still exist.

Promoted generations are already identifiable. In this repository a promoted generation means a generation record with `approved !== false`, a model bundle, and either `promotedAt`, `isBest`, or `source === 'promoted'`. `src/services/ml/runtime.js` already encodes those rules in `isPromotedGenerationRecord()`. The same file also already has stable ids for promoted generations via `buildPromotedModelBotId(runId, generation)`, yielding values like `generation:run-0006:12`.

## Plan of Work

First, extend `src/services/ml/runtime.js` so `stopped` runs remain resumable. Add a small helper that treats `running`, `stopping`, and `stopped` as resumable states for persistence purposes. Use that helper anywhere the runtime currently decides whether to compact replay buffer samples and working model state. Add a `canContinueRun()` helper and include its result in run summaries so the UI can show a continue button only when the server says resume state is available.

Second, add `MlRuntime.continueRun()` in `src/services/ml/runtime.js` and expose it through `src/routes/v1/ml/index.js` as `POST /api/v1/ml/runs/:runId/continue`. The method should reject if the run is missing, if it is not `stopped`, if another run is active and the caller did not request forced stopping, or if the stopped run no longer has a working model bundle. On success it should clear `stopReason`, switch the run back to `running`, save, emit live progress, and restart the background pipeline against the same run id.

Third, add runtime support for promoted-generation seed sources. Extend run config normalization in `src/services/ml/runtime.js` so new runs can accept either `bootstrap`, `random`, or a promoted-generation selection identified by run id and generation. Add a helper that lists seed-source options from existing runs, keeping `Bootstrap Model` and `Random Init` first and then sorting promoted generations by newest promotion/update. Update `getWorkbench()` to return that list so the browser can render it directly.

Fourth, rebuild the relevant pieces of `public/ml-admin.html` and `public/ml-admin.js`. Keep the existing select element id to minimize churn, but change the label/copy to reflect seed models instead of seed mode. Render the new seed-source list from the workbench payload. Parse promoted-generation option values before posting `POST /api/v1/ml/runs`. In the `Runs` tab, add a `Continue Run` button for the selected run and render `Continue` actions in the runs table for stopped runs while preserving delete for completed/error runs.

Finally, add focused tests. `tests/mlRuntime.test.js` should cover promoted-generation seed listings, new-run seeding from a promoted generation, and continuing a stopped run. `tests/mlRuntimePersistence.test.js` should verify that stopped runs stay resumable across persistence reloads. `tests/mlRoutes.test.js` should cover the new continue endpoint and the additional workbench seed-source payload.

## Concrete Steps

Work from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

1. Edit `src/services/ml/runtime.js` to preserve resumable stopped state, list promoted-generation seed sources, and continue stopped runs.
2. Edit `src/routes/v1/ml/index.js` to add the continue route and expose the updated workbench payload.
3. Edit `public/ml-admin.html` and `public/ml-admin.js` to render the new continue action and seed-model dropdown behavior.
4. Update `tests/mlRuntime.test.js`, `tests/mlRuntimePersistence.test.js`, and `tests/mlRoutes.test.js`.

As commands are actually run, append them here with short evidence snippets.

## Validation and Acceptance

Acceptance is behavioral:

1. Run focused tests from the repository root.

   - `npm.cmd test -- tests/mlRoutes.test.js`
   - `npm.cmd test -- tests/mlRuntimePersistence.test.js`
   - `npm.cmd test -- tests/mlRuntime.test.js`

2. Start the server on a non-3000 port if manual verification is needed and open `/ml-admin`.

3. In the `Runs` tab, stop a run, wait for its status to become `stopped`, then click `Continue`. The same run id should return to `running`, and its counts should continue increasing rather than creating a new run row.

4. In the `Config` tab, confirm the seed dropdown starts with `Bootstrap Model` and `Random Init`, then shows promoted generations from existing runs beneath them. Starting a new run from one of those promoted generations should create a new run whose saved config records the originating run id plus generation.

## Idempotence and Recovery

The code changes are additive and safe to repeat. The new config fields for promoted-generation seeds must default cleanly when absent, and older persisted runs that never stored resumable stopped state should still load even if they cannot be continued.

If a previously stopped run was already compacted before this change, it may remain non-resumable because its working model was already discarded. Recovery for that historical case is to start a new run from one of its promoted generations once the new seed-source picker exists.

## Artifacts and Notes

Focused validation commands run from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`:

- Route and persistence coverage:

  `npm.cmd test -- tests/mlRoutes.test.js tests/mlRuntimePersistence.test.js`

  Result: `PASS tests/mlRoutes.test.js`, `PASS tests/mlRuntimePersistence.test.js`

- Targeted ML runtime coverage for the new features:

  `$env:ENABLE_ML_WORKFLOW='true'; node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="new runs can seed from an existing promoted generation and workbench lists it|stopped runs can be continued in place when resumable state exists"`

  Result: both targeted tests passed.

## Interfaces and Dependencies

`src/services/ml/runtime.js` must expose:

- a method that returns workbench seed-source options, including built-in `bootstrap` and `random` entries plus promoted-generation entries from existing runs
- a `continueRun(runId, options)` method that restarts a `stopped` run in place
- run summaries that include whether a run can be continued

`src/routes/v1/ml/index.js` must expose `POST /api/v1/ml/runs/:runId/continue` for admin users.

`public/ml-admin.js` must post promoted-generation selections as structured run-start config instead of sending the raw dropdown value as `seedMode`.

Revision note: created this ExecPlan before implementation so the runtime resume rules and the new server-authored seed-source contract stay explicit while the work is in flight.

Revision note: updated after implementation to record the completed runtime, route, UI, and test work, and to note that the remaining failures in the full `tests/mlRuntime.test.js` file are unrelated to this feature.
