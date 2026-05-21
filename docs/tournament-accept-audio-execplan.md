# Add tournament accept audio and elimination accept timing

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the repository-root `PLANS.md` guidance.

## Purpose / Big Picture

Tournament players should have a clearer accept prompt. After this change, the first game of an elimination match gives each player 120 seconds to accept instead of 30 seconds, while round-robin accept windows remain 30 seconds. Any player who still needs to accept hears `public/assets/sounds/MatchFound.mp3` loop until their accept succeeds or the accept prompt is dismissed by game state. Players can control all game audio through a global Volume slider in Settings; authenticated users persist that value on their user record, and guests persist it in the same cookie-backed preference path as other local settings.

## Progress

- [x] (2026-05-21 13:58Z) Read `PLANS.md`, `public/AGENTS.md`, the existing preference flow in `public/index.js`, tournament accept scheduling, and the backend accept-timeout paths.
- [x] (2026-05-21 14:03Z) Centralized accept-window calculation so elimination accept-required games use 120 seconds and round-robin games keep 30 seconds.
- [x] (2026-05-21 14:04Z) Added `audioVolume` as a normalized, persisted user preference across `User`, `/api/auth/session`, `/api/v1/users/getDetails`, and `/api/v1/users/update`.
- [x] (2026-05-21 14:05Z) Added a browser audio manager module that registers sounds, applies a master volume, starts/stops named loops, and retries browser-blocked playback after user interaction.
- [x] (2026-05-21 14:06Z) Added a Settings Volume slider and wired it to the audio manager plus persistence.
- [x] (2026-05-21 14:07Z) Started the `MatchFound.mp3` loop from the tournament accept banner and stopped it when the local player accepts or the banner is cleared.
- [x] (2026-05-21 14:12Z) Updated focused tests and documentation, ran focused Jest suites, performed a browser smoke check, and ran the full Jest suite.
- [x] (2026-05-21 14:36Z) Extended the audio manager with one-shot playback and wired move, pending-capture, poison, and challenge sounds into the live game event paths.

## Surprises & Discoveries

- Observation: The requested `.agent/PLANS.md` path does not exist in this checkout, but `PLANS.md` exists at the repository root.
  Evidence: `Get-Content .agent\PLANS.md` failed with `Cannot find path`, and `Get-ChildItem -Recurse -Filter PLANS.md` found `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI\PLANS.md`.
- Observation: Tournament accept deadlines are server-authoritative; the frontend scheduler only delays display and preserves the server-provided remaining seconds.
  Evidence: `public/js/modules/tournaments/acceptScheduler.js` stores per-game deadlines from the `acceptWindowSeconds` payload and explicitly states that the server decides whether accept is required.
- Observation: `public/assets/sounds/MatchFound.mp3` exists locally and can be referenced by the browser, but the `public/assets/sounds/` folder is currently untracked in git.
  Evidence: `Test-Path public\assets\sounds\MatchFound.mp3` returned `True`; `git ls-files public/assets/sounds/MatchFound.mp3` returned no tracked path.
- Observation: PowerShell blocks `npm.ps1` in this environment, so test commands need `npm.cmd`.
  Evidence: `npm test ...` failed with `running scripts is disabled on this system`; the same command through `npm.cmd test ...` passed.
- Observation: Two-choice declaration moves optimistically overwrite the destination before the final bubble click, so pending-capture audio needs to preserve whether the destination had an opposing piece before that optimistic update.
  Evidence: `attemptInGameMove()` moves `movingNow` into `currentBoard[to.row][to.col]` before `commitMoveFromOverlay()` sends the move.

## Decision Log

- Decision: Keep round-robin accept windows at 30 seconds and change only tournament elimination accept windows to 120 seconds.
  Rationale: The user asked specifically for "direct elimination" to become 120 seconds, and existing docs/tests describe round robin as a separate 30-second accept flow.
  Date/Author: 2026-05-21 / Codex
- Decision: Persist `audioVolume` beside existing user-backed preferences instead of creating a separate settings endpoint.
  Rationale: Tooltip, toast, and animation settings already have a cookie fallback for guests plus `/api/v1/users/update` persistence for authenticated users; using the same route satisfies "saved the same way all other settings are saved."
  Date/Author: 2026-05-21 / Codex
- Decision: Build a reusable audio manager rather than calling `new Audio(...).play()` directly from the accept banner.
  Rationale: A central manager can apply master volume to every current and future sound, avoid duplicate loops for the same prompt, and handle browser autoplay restrictions consistently.
  Date/Author: 2026-05-21 / Codex
- Decision: Trigger challenge audio from the server update after rendering the transient challenge bubble, rather than from the local button click.
  Rationale: This keeps the sound aligned with the speech bubble appearance for both players and avoids a separate local sound that could drift from the rendered challenge state.
  Date/Author: 2026-05-21 / Codex

## Outcomes & Retrospective

Completed for the tournament accept work. The implementation now uses a shared server accept-window helper, persists `audioVolume` through the existing preference flow, exposes a reusable frontend audio manager, shows a Settings Volume slider, and loops `MatchFound.mp3` while a player still has an actionable tournament accept banner. The follow-up sound work adds one-shot playback, registers `Move.mp3`, `Capture.mp3`, `Poison.mp3`, and `Challenge.mp3`, plays move/capture sounds from local move commits and opponent move updates, plays poison sounds on declaration, and aligns challenge audio with the challenge speech bubble render. Focused tests passed; the earlier full Jest suite and browser smoke check passed for the settings and accept-audio changes.

## Context and Orientation

The backend tournament accept flow creates active `Game` records with `requiresAccept` and `acceptWindowSeconds`. `src/models/Game.js` creates follow-up games for active matches, and `src/services/tournaments/liveTournaments.js` creates new tournament matches. `src/socket.js` schedules accept timeout enforcement when it receives `players:bothNext`, and `src/routes/v1/gameAction/next.js` emits that event when both players advance from a finished game. A player accepts through `src/routes/v1/gameAction/ready.js`, which sets one `playersReady` entry to `true`; when both entries are true, the game starts.

The frontend settings panel is mostly in `public/index.js`. Existing preferences use cookies for local fallback, `sessionInfo` for runtime state, and `PATCH /api/v1/users/update` for authenticated persistence. The tournament accept banner is rendered by `showTournamentAcceptBanner()` in `public/index.js`. `public/js/modules/tournaments/acceptScheduler.js` queues that banner and keeps the countdown aligned with server-provided deadlines.

## Plan of Work

First, add a backend utility for tournament accept timing so all callers agree that round robin is 30 seconds and elimination is 120 seconds. Update `src/models/Game.js`, `src/services/tournaments/liveTournaments.js`, `src/socket.js`, and `src/routes/v1/gameAction/next.js` to use it.

Second, add the `audioVolume` preference. `src/models/User.js` stores it as a number. `src/utils/userPreferences.js` normalizes and resolves it. The auth session, user details, and update route include it. Existing route tests are extended to cover valid, invalid, default, and session-returned volume values.

Third, create `public/js/modules/audio/audioManager.js`. It exports `createAudioManager()` and volume normalization helpers. It should register sounds by id, maintain a master volume from 0 to 1, start and stop named loops idempotently, update volumes on active loops, and retry blocked playback after a later user gesture.

Fourth, update `public/index.js` to import the audio manager, register `MatchFound.mp3`, add a Settings Volume slider, apply volume changes live, and persist them through the existing preference helper. The tournament accept banner starts a named loop keyed by game id and stops it when the player accepts, when accept succeeds, when accept fails and the banner is cleared, or when any other game state clears the banner.

Finally, update docs and focused tests, then run the relevant Jest suites.

## Concrete Steps

Work from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Focused tests run after edits:

    npm test -- tests/userUpdate.route.test.js tests/userGetDetails.test.js tests/googleAuth.session.test.js tests/nextRoute.tournamentContinuation.test.js tests/socket.acceptTimeout.test.js tests/tournamentAcceptScheduler.test.js

Because PowerShell blocks `npm.ps1` here, use `npm.cmd`:

    npm.cmd test -- tests/userUpdate.route.test.js tests/userGetDetails.test.js tests/googleAuth.session.test.js tests/nextRoute.tournamentContinuation.test.js tests/socket.acceptTimeout.test.js tests/tournamentAcceptScheduler.test.js tests/audioManager.test.js tests/tournamentAcceptWindow.test.js tests/tournament.service.test.js

Full suite:

    npm.cmd test

## Validation and Acceptance

Backend acceptance: a newly created tournament elimination game with `requiresAccept: true` exposes `acceptWindowSeconds: 120`, while round-robin accept games still expose `30`, and elimination follow-up games expose `0`. Existing accept-timeout tests pass, proving one-ready-player and no-ready-player elimination outcomes are unchanged except for the longer deadline.

Settings acceptance: an authenticated user can save an audio volume through `/api/v1/users/update`, then `/api/auth/session` and `/api/v1/users/getDetails` return the normalized value. Invalid values are rejected.

Frontend acceptance: opening Settings shows a Volume slider. Moving it changes the audio manager master volume and persists the value. When a tournament accept banner appears for a player who has not accepted, `MatchFound.mp3` loops. Clicking Accept stops the loop immediately; if the accept request fails, the banner remains and the loop can resume at the current volume. A browser smoke check confirmed the Settings panel and Volume slider render and can be adjusted without console errors.

## Idempotence and Recovery

The backend utility is additive and can be re-run safely through tests. Cookie persistence for guests overwrites a single `cgAudioVolume` cookie. The audio manager uses named loop keys so repeated calls for the same game do not stack duplicate audio. If browser autoplay blocks playback, the manager keeps the desired loop state and retries after a later pointer, keyboard, or touch interaction.

## Artifacts and Notes

Focused test output:

    Test Suites: 9 passed, 9 total
    Tests:       60 passed, 60 total

Latest focused audio test output:

    Test Suites: 1 passed, 1 total
    Tests:       4 passed, 4 total

Latest full test output:

    Test Suites: 69 passed, 69 total
    Tests:       255 passed, 255 total

Browser smoke check:

    Opened http://127.0.0.1:3101/
    Opened Menu > Settings
    Found slider "Volume"
    Adjusted slider to 50%
    Browser console errors: []

## Interfaces and Dependencies

In `src/utils/tournamentAccept.js`, provide functions that accept match-like objects:

    shouldRequireTournamentMatchAccept(match)
    getTournamentAcceptWindowSeconds(match, requiresAccept)

In `src/utils/userPreferences.js`, provide:

    DEFAULT_AUDIO_VOLUME
    normalizeAudioVolume(value, fallback)
    normalizeAudioVolumeInput(value)
    resolveAudioVolume(userLike)

In `public/js/modules/audio/audioManager.js`, provide:

    normalizeAudioVolume(value, fallback)
    createAudioManager(options)

The audio manager returned object must include at least:

    registerSound(id, options)
    setVolume(value)
    getVolume()
    startLoop(id, options)
    play(id, options)
    stopLoop(key)
    stopAll()
    dispose()

Change note: Created this plan before implementation because the request spans backend timing, persistence, frontend settings, and browser audio behavior.

Change note: Updated this plan after implementation and validation to record completed work, test evidence, browser smoke-check evidence, and the untracked local audio asset observation.
