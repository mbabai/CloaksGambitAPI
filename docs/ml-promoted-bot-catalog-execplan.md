# Expose Promoted ML Models Through The Normal Bot Dropdown

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](../PLANS.md).

## Purpose / Big Picture

After this change, the `/ml-admin` `Test` tab will stop launching one-off live games directly. Instead, it will show every promoted ML generation that already exists in the runtime and let the admin toggle which of those promoted models should be exposed as normal bot opponents. The regular player client will load that enabled list and append those ML opponents to the existing bot dropdown after `Easy`, `Medium`, and `Hard`.

The observable success case is: start the server, open `/ml-admin`, go to `Test`, see a checkbox list of promoted models such as `Run Label G4`, check one or more of them, then open the main client and start a bot match. The bot dropdown now includes the checked promoted models, and choosing one creates a standard bot match in the normal UI while the selected ML generation controls the bot seat.

## Progress

- [x] (2026-03-12 22:43 -07:00) Read `PLANS.md`, ML runtime notes, bot-match routes, `/ml-admin`, and the main client bot picker to map the current behavior.
- [x] (2026-03-12 22:57 -07:00) Chose the implementation shape: persist enabled promoted-model bot entries in ML runtime state, expose a public bot catalog endpoint, and route ML bot games through the existing bot-match flow instead of the admin launcher.
- [x] (2026-03-13 00:24 -07:00) Implemented runtime state and helper methods for promoted-model bot catalog entries and ML-backed bot game scheduling.
- [x] (2026-03-13 00:36 -07:00) Added admin bot-catalog routes, a public `/api/v1/bots/catalog` route, and ML-selection handling in `src/routes/v1/lobby/enterBot.js`.
- [x] (2026-03-13 00:54 -07:00) Replaced the `/ml-admin` `Test` launcher UI with the promoted-model checkbox list and save/apply flow.
- [x] (2026-03-13 01:03 -07:00) Updated the main client bot prompt to load the dynamic catalog and append enabled promoted models after the built-in entries.
- [x] (2026-03-13 01:18 -07:00) Added route/runtime regression tests and ran focused validation for the new admin/public bot catalog flow plus the reused live-match runtime path.

## Surprises & Discoveries

- Observation: the current `Test` tab only exists in `public/ml-admin.js` and posts to `POST /api/v1/ml/test-games`, but the normal player bot flow is completely separate and only accepts `easy` and `medium`.
  Evidence: `public/ml-admin.js` calls `/api/v1/ml/test-games`, while `src/routes/v1/lobby/enterBot.js` hard-rejects anything outside `easy` and `medium`.

- Observation: the existing ML live-test path already knows how to auto-setup, auto-ready, and play moves for one chosen generation, so the ML side of a normal bot match can reuse that gameplay control loop instead of inventing a second inference path.
  Evidence: `src/services/ml/runtime.js` stores `mlTestConfig`, schedules `runMlTestGameLoop()`, and calls the same live route handlers used elsewhere.

- Observation: `User.botDifficulty` is currently restricted to `easy`, `medium`, or `hard`, which is too narrow if bot users need to represent specific promoted ML selections.
  Evidence: `src/models/User.js` uses an enum with only those three values.

- Observation: the promoted-model route does not need a second live-game control loop. Reusing the extracted `startLiveMlMatch()` helper keeps the new public bot flow and the older admin test-game flow on the same runtime path.
  Evidence: the targeted runtime validation still passes the pre-existing `startTestGame` auto-ready test after the extraction, and the new promoted-bot runtime test passes against the same helper.

## Decision Log

- Decision: keep the ML inference/gameplay engine in `src/services/ml/runtime.js` and move only the match-entry surface to the standard bot flow.
  Rationale: the user asked to stop launching games directly from the ML admin page, not to rewrite how ML-controlled live seats act once a game exists.
  Date/Author: 2026-03-12 / Codex

- Decision: persist the enabled promoted-model selections inside ML runtime state rather than browser storage.
  Rationale: the main client must be able to load the same enabled list in a different page or session, and the state should survive reloads and server restarts.
  Date/Author: 2026-03-12 / Codex

- Decision: expose a small public bot catalog endpoint for the main client instead of hardcoding bot options in `public/index.js`.
  Rationale: the enabled promoted-model list is dynamic and should be sourced from the server, while still preserving the built-in bot ordering.
  Date/Author: 2026-03-12 / Codex

- Decision: leave `POST /api/v1/ml/test-games` in place unless implementation proves it conflicts, but remove it from the primary `/ml-admin` operator workflow.
  Rationale: this keeps lower-level compatibility while satisfying the request that the `Test` tab no longer starts games directly.
  Date/Author: 2026-03-12 / Codex

- Decision: keep built-in bot definitions in `src/services/bots/registry.js` and combine them with enabled promoted models in a new public route instead of making the browser stitch two APIs together.
  Rationale: server-side ordering is simpler, keeps `Easy`/`Medium`/`Hard` canonical, and makes the main client’s dropdown logic smaller.
  Date/Author: 2026-03-13 / Codex

## Outcomes & Retrospective

Outcome: `/ml-admin` no longer launches one-off test games from its `Test` tab. It now lists promoted generations with checkboxes and persists which of those promoted models should be exposed as public bot opponents.

Outcome: the normal player bot flow now understands enabled promoted ML selections. The main client requests `/api/v1/bots/catalog`, shows the returned built-in plus enabled promoted entries, and `src/routes/v1/lobby/enterBot.js` delegates promoted selections to the ML runtime while leaving built-in bots on the old path.

Outcome: the ML runtime now persists promoted-bot enablement state, exposes admin/public catalog helpers, and reuses one extracted live-match creation helper for both the old admin test-game API and the new public promoted-bot path.

Residual gap: the old `POST /api/v1/ml/test-games` compatibility route still exists, but it is no longer the main operator workflow and was left in place deliberately.

## Context and Orientation

The current ML workbench lives in `public/ml-admin.html` and `public/ml-admin.js`. Its `Test` tab lets an admin choose one run, one generation, and a side preference, then opens a normal game tab after `src/routes/v1/ml/index.js` calls `MlRuntime.startTestGame()` in `src/services/ml/runtime.js`.

Normal bot games use a different path. In the main player client, `public/index.js` shows a bot selection overlay with hardcoded `Easy`, `Medium`, and `Hard` options. Choosing one calls `apiEnterBotQueue()` in `public/js/modules/api/game.js`, which posts to `src/routes/v1/lobby/enterBot.js`. That route currently only allows `easy` and `medium`, creates a standard `Match` and `Game`, and marks the bot seat using a bot user created by `src/services/bots/registry.js`.

This feature links those two worlds. A promoted model means a run generation whose runtime record is approved and has a promoted timestamp. The admin should be able to expose some of those promoted models as selectable bot opponents. A public bot catalog means one server response that includes both the built-in bot entries and any enabled promoted ML entries, in the order the player dropdown should show them.

## Plan of Work

First, extend `src/services/ml/runtime.js` so the persisted ML state includes a small promoted-bot catalog section. Add helper methods that scan all runs for promoted generations with model bundles, build stable ids for them, report which ones are enabled, and update the enabled set. Also add a helper that, given one enabled promoted-model bot id, can create the same ML control config that `startTestGame()` currently uses so a normal bot match can hand the opponent seat to that generation and schedule the auto-play loop.

Second, update the route layer. `src/routes/v1/ml/index.js` should add admin-only read/write endpoints for the `Test` tab checkbox state. `src/routes/v1/index.js` should mount one new public route under the normal API surface for listing available bot options. `src/routes/v1/lobby/enterBot.js` should stop assuming every selection is a built-in difficulty and instead resolve either a built-in bot or an enabled promoted ML bot before creating the match.

Third, update bot user handling in `src/services/bots/registry.js` and any touched model code so the server can safely represent promoted ML bot users without being limited to the current `easy`/`medium`/`hard` enum. Built-in bots should still keep their existing names and behavior. Promoted ML bot users should get stable usernames and emails derived from run id plus generation so the same enabled model can be reused across matches.

Fourth, rebuild the `Test` tab in `public/ml-admin.html` and `public/ml-admin.js`. Replace the run/generation/side selectors with a checkbox list of promoted models plus supporting copy that explains these checked items are mirrored into the normal bot dropdown. The browser should load the admin catalog payload from the ML workbench or dedicated endpoints, show checked state, and save changes back to the server.

Fifth, update `public/index.js` and `public/js/modules/api/game.js` so the main bot overlay loads the server-provided bot catalog before rendering the dropdown. Preserve the existing order by showing `Easy`, `Medium`, `Hard`, then the enabled promoted ML models. Starting a match against one of those ML entries must still close the prompt and land the player in a normal live game.

Finally, update `docs/ml-admin.md` and the regression suites. `tests/mlRoutes.test.js` should cover the new admin catalog endpoints and any changed workbench payload. New or updated route tests should cover the public bot catalog and `enterBot` behavior for an enabled promoted ML selection. `tests/mlRuntime.test.js` should verify that promoted-model catalog state is summarized correctly and that a normal bot match can be configured around an enabled promoted model.

## Concrete Steps

Work from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

1. Edit `src/services/ml/runtime.js` to add promoted-model catalog persistence, summary helpers, and ML-bot match helpers.
2. Edit `src/services/bots/registry.js`, `src/models/User.js`, and `src/routes/v1/lobby/enterBot.js` to support dynamic ML bot selections.
3. Add and mount a public bot catalog route under `src/routes/v1/`.
4. Edit `public/ml-admin.html` and `public/ml-admin.js` to replace the `Test` launcher UI with checkbox management.
5. Edit `public/index.js` and `public/js/modules/api/game.js` to load the dynamic bot catalog before starting a bot match.
6. Update `docs/ml-admin.md`, `tests/mlRoutes.test.js`, and any new or existing route/runtime tests affected by the new behavior.

As commands are actually run, add them here with short evidence snippets.

## Validation and Acceptance

Acceptance is behavioral:

1. Run focused tests from the repository root:

    npm test -- tests/mlRoutes.test.js

    npm test -- tests/mlRuntime.test.js

   Add any focused lobby or bot-route test commands actually used during implementation.

2. Start the server on a non-3000 port if manual verification is needed.

3. Open `http://localhost:3100/ml-admin` as an admin and verify:

   - The `Test` tab shows a checkbox list of promoted models instead of a run/generation launcher.
   - Checking a promoted model and saving makes that model remain checked after a refresh.

4. Open the main client and verify:

   - The bot dropdown still lists `Easy`, `Medium`, and `Hard` first.
   - Any checked promoted models appear after those built-in entries.
   - Choosing an enabled promoted model starts a normal live bot match.
   - The ML-controlled opponent auto-setups, auto-readies, and takes turns in that match.

## Idempotence and Recovery

This work should be safe to repeat because it only changes server/browser code and extends ML runtime persistence with additive defaults. Any new persisted promoted-bot catalog fields in `data/ml/runtime.json` must load with sensible defaults when absent so older state files continue to work.

If a bad runtime state blocks development, the safest recovery path remains moving only `data/ml/runtime.json` aside and letting the runtime rebuild fresh state. Do not delete unrelated Mongo history or user data to recover from catalog-shape issues.

## Artifacts and Notes

Focused validation commands run from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`:

- Route suites:

    npm.cmd test -- tests/mlRoutes.test.js tests/botCatalog.route.test.js tests/enterBot.route.test.js

    PASS tests/mlRoutes.test.js
    PASS tests/botCatalog.route.test.js
    PASS tests/enterBot.route.test.js

- Runtime handoff coverage:

    $env:ENABLE_ML_WORKFLOW='true'; node --experimental-vm-modules node_modules/jest/bin/jest.js tests/mlRuntime.test.js --runInBand --testNamePattern="startTestGame creates|promoted bot catalog can enable"

    PASS tests/mlRuntime.test.js
    startTestGame creates a live game against a chosen generation and the bot auto-readies
    promoted bot catalog can enable a generation for the normal bot flow

## Interfaces and Dependencies

`src/services/ml/runtime.js` must expose stable helpers for:

- reading the promoted-model admin catalog
- updating which promoted models are enabled for public bot play
- listing the public bot catalog entries the main client should render
- resolving an enabled promoted-model bot selection into live-game ML control config

`src/routes/v1/ml/index.js` should expose admin-only endpoints that let `/ml-admin` read and update the promoted-model checkbox state.

One public route under `src/routes/v1/` should expose the player-facing bot catalog payload used by `public/index.js`.

If this plan changes materially during implementation, update every section above and append a short note below describing what changed and why.
