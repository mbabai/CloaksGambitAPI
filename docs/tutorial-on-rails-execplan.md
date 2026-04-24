# On-Rails Tutorial Mode

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with [PLANS.md](PLANS.md).

## Purpose / Big Picture

After this change, a player can start a built-in tutorial from the main menu and play through a fully guided, scripted game against `Tutorial Bot`. The tutorial is on rails: the player only advances with the intended moves or the intended `Next` button, the opponent only performs scripted responses, clocks stay blank, and the tutorial never enters Mongo-backed match or game history.

The observable result is a playable tutorial that looks like the normal live game UI, uses the real rules engine, and adds an instruction box styled like the existing tooltip with an inline `Next` button whenever the current step needs one.

## Progress

- [x] (2026-04-22 20:24Z) Traced the current main-menu, bot-match creation, live route, finish-banner, and board interaction paths.
- [x] (2026-04-22 20:33Z) Confirmed the integration strategy: add a first-class tutorial flag and state machine instead of piggybacking on the existing AI bot flow.
- [x] (2026-04-22 20:41Z) Re-checked the authored knight bluff against the live rules and confirmed the move legality follows the declaration, not the hidden identity, so the original `e6 -> d4` knight declaration is valid after all.
- [x] (2026-04-22 22:03Z) Implemented tutorial model fields, start route, advance route, scripted runtime, and tutorial-specific persistence/clock suppression.
- [x] (2026-04-22 22:27Z) Implemented the client tutorial launch modal, overlay text box, wrong-move feedback, clock blanking, and tutorial control gating.
- [x] (2026-04-22 22:36Z) Added focused Jest coverage for tutorial creation, tutorial progression, and tutorial clock disabling.
- [x] (2026-04-22 22:39Z) Ran targeted verification on tutorial tests plus adjacent clock/bot regression tests.

## Surprises & Discoveries

- Observation: the current "Ready" button in setup is actually the setup submission button that calls `/api/v1/gameAction/setup`; it is not the later `ready` route.
  Evidence: `public/index.js` renders `renderReadyButton(...)` during setup and its click handler posts `apiSetup(...)`.

- Observation: move legality in the live rules follows the declaration, not the hidden true identity.
  Evidence: `src/routes/v1/gameAction/move.js` validates `isDeclaredMoveLegal(...)` against the submitted declaration before any challenge logic compares the declaration to the true piece identity.

- Observation: the existing end-of-game banner can be delayed on the client without changing the underlying game result, because `game:finished` is a separate socket event layered on top of the already-emitted `game:update`.
  Evidence: `src/socket.js` emits `game:update` first and then `game:finished`, while `public/index.js` handles those flows independently.

## Decision Log

- Decision: tutorial games will be marked with first-class `isTutorial` and `tutorialState` fields on both `Game` and `Match`.
  Rationale: the behavior changes affect persistence, clocks, bot handling, active-match listing, and socket payload shaping. A single explicit flag is less brittle than scattering match-type checks throughout the code.
  Date/Author: 2026-04-22 / Codex

- Decision: the editable tutorial copy will live in a static JSON file under `public/` and the server will keep only the numeric tutorial step/state.
  Rationale: the user asked for easily editable text. Keeping the text client-side and the progression server-side avoids coupling route logic to HTML copy while still making the content easy to update.
  Date/Author: 2026-04-22 / Codex

- Decision: the server tutorial state machine will track only action checkpoints, while the client derives the purely local instructional substeps for "setup complete, click ready" and "rook selected, now move it."
  Rationale: those two transitions depend on local draft setup state and local selection state that are not server state. Deriving them locally avoids extra server mutation routes for ephemeral UI-only progress.
  Date/Author: 2026-04-22 / Codex

- Decision: tutorial clocks will be disabled through the clock helpers rather than by inventing a fake zero-time control.
  Rationale: zero clocks would render `0:00` and still touch timeout paths. A dedicated tutorial short-circuit keeps the UI blank and prevents timeouts entirely.
  Date/Author: 2026-04-22 / Codex

## Context and Orientation

This repository serves the live game, browser UI, and Socket.IO updates from the same Node process. The key files for this feature are:

`public/index.html` and `public/index.js` define the main menu, the live board controller, the setup/on-deck drag and click handlers, the response buttons, and the post-game banners. The main menu already contains `Account`, `Ranked`, and `Tournament` entries, so the tutorial entry belongs between `Account` and `Ranked`.

`src/routes/v1/lobby/enterBot.js` is the closest existing pattern for creating a one-player-versus-bot match. The tutorial route can borrow its guest/session handling and lobby bookkeeping, but unlike a normal bot match the tutorial must force the human to white, must create a fixed scripted black opponent, and must not create a clocked, persistent history record.

`src/models/Game.js` and `src/models/Match.js` are hybrid models: active documents live in an in-memory store, while finished history is written to Mongo. Any new field must be added to both the Mongoose schema and the in-memory document constructor/serializer path. Tutorial suppression of persistence must also live here, because `endGame()` and `endMatch()` currently own the history write path.

`src/routes/v1/gameAction/*.js` are the authoritative live action routes for setup, move, challenge, bomb, pass, on-deck, and ready/next flow. The tutorial needs route-level validation so a manual API call cannot bypass the rails.

`src/socket.js`, `src/utils/gameView.js`, and `src/routes/v1/games/getDetails.js` are the main payload shaping paths. They need to expose tutorial state to the client and keep tutorial matches out of spectator-facing active match lists.

`public/js/modules/ui/toasts.js` and the existing `showIllegalMoveToast()` helper already provide the upper-left toast behavior the tutorial can reuse for `Wrong move`.

The tutorial flow uses these authored checkpoints. Server step `1` is the setup phase, but the client can display authored step `2` once the local draft setup matches the tutorial target. Server step `3` is the first live turn, but the client can display authored step `4` once the correct rook is selected. Every later authored step maps directly to a stored server step.

## Plan of Work

First, extend `src/models/Game.js` and `src/models/Match.js` with `isTutorial` and a minimal `tutorialState` object on games. Update the end-of-game and end-of-match logic so tutorial games and matches stay in memory and never call the Mongo persistence helpers. While touching the server-side cross-cutting logic, update `src/utils/gameClock.js`, the bot failsafe, and the active-match list service so tutorial games neither tick clocks nor appear as normal active matches.

Second, add a tutorial runtime under `src/services/tutorials/`. This runtime will define the fixed board targets, the fixed scripted black setup, the allowed player actions for each stored server step, and the scripted bot actions that occur when the player presses the tutorial `Next` button. Add a `POST /api/v1/lobby/enterTutorial` route that creates the tutorial match/game and a `POST /api/v1/gameAction/tutorialAdvance` route that advances the text-only or scripted-opponent steps.

Third, patch the existing live routes. `setup.js`, `move.js`, `challenge.js`, `bomb.js`, and `onDeck.js` must reject actions that do not match the tutorial state machine when `game.isTutorial` is true. `pass.js`, `draw.js`, `resign.js`, `ready.js`, and `next.js` should be blocked for tutorial games because that flow is scripted separately.

Fourth, add a static config file at `public/tutorials/intro.json` containing the tutorial copy, HTML, and `showNextButton` flags for all authored steps. Update `public/index.html` and `public/index.js` to add the `Play tutorial` main-menu button and its yes/no modal, fetch the JSON config, render the tooltip-styled tutorial card above normal tooltips, and delay the normal finish banner until the authored tutorial reaches its last step.

Fifth, patch the board interaction code in `public/index.js`. Setup moves should be allowed only if the resulting draft remains compatible with the fixed tutorial target. Tutorial on-deck actions should accept only the currently required stash piece. Tutorial live moves should allow only the scripted origin and destination, and response buttons should be shown only when the authored tutorial step permits them. When the player deviates, restore the prior local state and enqueue a `Wrong move` toast in the existing toast system.

## Concrete Steps

All commands run from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Inspect the existing live control flow and tutorial integration points:

    Get-Content src/routes/v1/lobby/enterBot.js
    Get-Content src/models/Game.js
    Get-Content src/routes/v1/gameAction/move.js
    Get-Content public/index.js

Create and update the tutorial implementation, then run focused verification:

    cmd /c npm run build:shared
    cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/enterTutorial.route.test.js tests/tutorialRuntime.test.js tests/tutorialClockPayload.test.js --runInBand

When the browser path is ready, run the server locally on a non-3000 port and verify the menu and tutorial flow manually. Example:

    $env:PORT=3100
    cmd /c npm start

Then open `http://localhost:3100`, click `Play tutorial`, and walk through the scripted flow. The expected observations are:

1. The main menu shows `Play tutorial` between `Account` and `Ranked`.
2. The modal asks whether to start the tutorial.
3. The tutorial board opens with blank clocks and `Tutorial Bot` as black.
4. Wrong setup, on-deck, and move attempts snap back and show `Wrong move`.
5. The scripted black actions occur only after the matching `Next` step.
6. The normal victory banner appears only after the authored congratulations steps finish.

## Validation and Acceptance

Acceptance is behavioral.

Starting a tutorial must open a single live game where the human is always white and the opponent is always `Tutorial Bot`. The player must be unable to complete the tutorial with any move other than the scripted move sequence. Setup, on-deck, and move deviations must not alter the server state and must immediately show `Wrong move`.

The clocks must remain visually empty from the first board render until returning to the lobby, and the tutorial must never appear in player history or Mongo-backed completed match/game queries. Focused Jest coverage should prove the route creation and tutorial-runtime transitions, and a manual browser run should prove the UI gating and finish-banner timing.

## Idempotence and Recovery

The tutorial start route should be safe to call repeatedly as long as the user is not already in a live game; it creates a fresh tutorial match each time. The static JSON copy file is safe to edit independently of the scripted server state machine, because the server stores only numeric steps and does not parse the HTML copy. If a route-level validation bug blocks progression, the tutorial runtime should fail closed with an explicit `400` instead of mutating the game incorrectly.

## Artifacts and Notes

The authored tutorial bot bluff remains:

    Black scripted bluff move: e6 -> d4, declared as knight, actual piece bishop.

The authored mapping between stored server steps and displayed steps is:

    server step 1  => display step 1 or 2 depending on the local draft setup
    server step 3  => display step 3 or 4 depending on the currently selected piece
    server step N  => display step N for every later tutorial step

## Interfaces and Dependencies

In `src/services/tutorials/runtime.js`, define helpers with stable names so both routes and payload builders can share them:

    isTutorialGame(game)
    buildTutorialPayload(game)
    createTutorialMatchForUser({ userId, username })
    validateTutorialSetup(...)
    validateTutorialMove(...)
    validateTutorialChallenge(...)
    validateTutorialBomb(...)
    validateTutorialOnDeck(...)
    advanceTutorialStep(game, { color, trigger })

In `public/index.js`, define a small client tutorial controller that owns:

    tutorialConfig
    tutorialState
    renderTutorialOverlay()
    showWrongMoveToast()
    startTutorialFromMenu()
    advanceTutorialStepFromUi()

## Outcomes & Retrospective

The tutorial now exists as a first-class live-game mode with server-authored step progression and client-authored instructional copy. The server prevents tutorial matches from persisting to Mongo-backed history, disables clocks, filters tutorial matches out of active-match listings, and blocks non-scripted actions. The browser adds a `Play tutorial` menu entry, a yes/no launch modal, a tooltip-styled instruction card backed by `public/tutorials/intro.json`, and local wrong-move snapback/toast handling for setup, on-deck, and in-game rails.

Verification evidence:

- `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/enterTutorial.route.test.js tests/tutorialRuntime.test.js tests/tutorialClockPayload.test.js --runInBand`
- `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/gameClockPayload.test.js tests/botTurnFailsafe.service.test.js tests/enterBot.route.test.js --runInBand`

Revision note: updated after implementation and verification to record the final tutorial architecture, the confirmed declaration-based knight bluff, and the end-to-end test evidence.
