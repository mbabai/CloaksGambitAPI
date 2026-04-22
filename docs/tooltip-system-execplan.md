# Add a shared tooltip system with a persistent user preference

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`PLANS.md` in the repository root defines the ExecPlan rules for this repository. This document must be maintained in accordance with `PLANS.md`.

## Purpose / Big Picture

After this change, players can hover key live-game UI elements and see consistent styled tooltips instead of guessing at special actions or hidden state. The account menu also gains a persistent `Tooltips` slide toggle so signed-in users keep the preference on their account and guests keep it in cookies. You can see the feature working by opening a live game, hovering dagger tokens, captured pieces, response buttons, and declaration thought bubbles, then flipping the account-menu toggle off and confirming those hover boxes disappear and stay disabled after refresh.

## Progress

- [x] (2026-04-22 11:55-07:00) Traced the current client seams for account-menu rendering, board bubble overlays, action buttons, and shared bar rendering.
- [x] (2026-04-22 12:05-07:00) Drafted this ExecPlan with the chosen shared tooltip module plus user/cookie preference approach.
- [x] (2026-04-22 12:13-07:00) Added the server-side `tooltipsEnabled` field plus auth/session and user route payload support.
- [x] (2026-04-22 12:26-07:00) Added the shared browser tooltip module, centralized tooltip copy, HUD wiring, declaration-bubble wiring, and the response-button tooltips including `Bomb`, `Challenge`, `Pass`, `Resign`, and `Draw`.
- [x] (2026-04-22 12:31-07:00) Added the account-menu toggle for signed-in and guest flows, anchored `Logout` at the bottom, and fixed the guest cookie helper so `Max-Age=0` clears cookies correctly.
- [x] (2026-04-22 12:35-07:00) Passed focused auth/user Jest coverage and the full project test suite.
- [x] (2026-04-22 12:44-07:00) Ran a browser smoke pass on `http://127.0.0.1:3101/`, confirmed the guest account panel renders the `Tooltips` toggle, and fixed a slider clickability issue Playwright exposed.

## Surprises & Discoveries

- Observation: The existing browser cookie helper treats `0` as “do not write `Max-Age`”, so several current “clear this cookie” calls do not actually emit a clearing cookie.
  Evidence: `public/js/modules/utils/cookies.js` only appends `Max-Age` when `maxAgeSeconds` is truthy.

- Observation: The shared `renderBars()` module already owns live and spectate dagger/captured rendering, so it is the cleanest place to attach tooltip metadata for those HUD elements.
  Evidence: `public/js/modules/gameView/view.js` and `public/js/modules/spectate/controller.js` both render bars through `public/js/modules/render/bars.js`.

- Observation: The first browser smoke run showed the custom toggle slider intercepting pointer input over the hidden checkbox, which made the new switch hard to automate reliably.
  Evidence: Playwright reported `account-setting-row__slider intercepts pointer events` when clicking the checkbox in the account panel; setting `pointer-events: none` on the visual slider fixed the issue.

## Decision Log

- Decision: Use a single delegated tooltip system attached to the document instead of per-element tooltip instances.
  Rationale: The live board, bars, and action buttons are frequently re-rendered. Delegation lets renderers set only data attributes while one global layer owns visibility, positioning, and the enabled/disabled preference.
  Date/Author: 2026-04-22 / Codex

- Decision: Store the durable authenticated preference on the `User` model as a simple boolean field named `tooltipsEnabled`, defaulting to `true`.
  Rationale: The codebase does not yet have a general user-settings object. A single field keeps the schema and route changes minimal while still making the preference explicit and queryable.
  Date/Author: 2026-04-22 / Codex

- Decision: Mirror the current tooltip preference into a browser cookie even for authenticated users, while treating the database field as the source of truth for signed-in accounts.
  Rationale: The cookie lets the browser apply the last known preference immediately on load, while `/api/auth/session` and `/api/v1/users/update` keep signed-in behavior authoritative on the server.
  Date/Author: 2026-04-22 / Codex

## Outcomes & Retrospective

The feature is implemented. The repo now has one delegated tooltip layer, one centralized tooltip-copy map, and one persisted `tooltipsEnabled` preference that flows through signed-in and guest sessions. The biggest incidental fix was the cookie helper bug, because the guest preference path depends on being able to clear and rewrite cookies predictably. The remaining validation gap is a deeper browser walkthrough of in-game hover states during a live match; the automated smoke pass covered the account-menu toggle render and clickability regression but did not fully script a match flow.

## Context and Orientation

The browser entry point is `public/index.html`, which loads `public/js/main.js`, then `public/js/modules/app.js`, which currently hands off to `public/index.js`. Most live game UI still lives in `public/index.js`, but the board surface and player bars were recently extracted into shared modules. `public/js/modules/components/boardView.js` owns Canvas board rendering plus bubble overlays. `public/js/modules/render/bars.js` owns the dagger and captured-piece HUD rows. `public/js/modules/render/gameButton.js` and `public/js/modules/ui/buttons.js` render response buttons such as `Bomb`, `Pass`, and `Challenge`.

The account menu shell lives in `public/index.html`, but the actual contents are rebuilt inside `updateAccountPanel()` in `public/index.js` after `/api/auth/session` resolves. Signed-in users then fetch their own record through `POST /api/v1/users/getDetails`. `PATCH /api/v1/users/update` already updates usernames for the current authenticated user. The `User` model lives in `src/models/User.js`, and the auth/session route lives in `src/routes/auth/google.js`.

A “thought bubble” in this repository is the hoverable bubble asset shown after moving a piece to a square when the move still requires a declaration choice. Those bubble image nodes are created in `public/js/modules/components/boardView.js` from bubble asset keys such as `kingThoughtRight` and `rookThoughtLeft`.

## Plan of Work

First, add the persistent preference on the server. Update `src/models/User.js` with a `tooltipsEnabled` boolean defaulting to `true`. Create a small helper in `src/utils/` that resolves missing values to `true` so old Mongo records without the field behave correctly. Use that helper in `src/routes/auth/google.js`, `src/routes/v1/users/getDetails.js`, and `src/routes/v1/users/update.js`. Extend the update route so authenticated users can patch `tooltipsEnabled` for themselves, and include the resolved value in the response payloads.

Next, add a shared tooltip module in `public/js/modules/ui/`. That module should create one floating tooltip element in `document.body`, position it near the hovered or focused trigger, and read tooltip text from `data-` attributes set on the triggers. It must expose helpers to initialize the global listeners, enable or disable the system, and assign or clear tooltip text on individual elements. Style the tooltip in `public/ui.css` with a semi-transparent `#5b20b6` background, white text, and a `#b0851e` border.

Then add a small tooltip-copy module in `public/js/modules/ui/` that centralizes the requested strings for dagger tokens, the `Bomb`, `Challenge`, and `Pass` buttons, the captured-piece strip, and the declaration thought bubbles. Wire the shared bar renderer to attach tooltip text to the dagger counter wrapper and each captured-piece wrapper. Wire `public/index.js` to attach tooltip text to the rendered response buttons. Wire `public/js/modules/components/boardView.js` to attach the declaration tooltip only to the interactive thought-bubble assets, not to the final speech-bubble confirmation art.

Finally, extend the account menu in `public/index.js` and `public/index.html` styles. Add a `Tooltips` slide toggle row directly under `Tournaments` for authenticated users and directly under the guest login prompt text for guests. Set the default to on. When toggled by a guest, update the cookie immediately. When toggled by an authenticated user, optimistically update the local UI, send `PATCH /api/v1/users/update`, and revert with an alert if the request fails. Keep `Logout` anchored at the bottom of the account panel.

## Concrete Steps

Work from the repository root `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

1. Update server files:

    - `src/models/User.js`
    - `src/utils/userPreferences.js` (new)
    - `src/routes/auth/google.js`
    - `src/routes/v1/users/getDetails.js`
    - `src/routes/v1/users/update.js`

2. Update browser files:

    - `public/js/modules/ui/tooltips.js` (new)
    - `public/js/modules/ui/tooltipContent.js` (new)
    - `public/js/modules/render/bars.js`
    - `public/js/modules/components/boardView.js`
    - `public/index.js`
    - `public/index.html`
    - `public/ui.css`
    - `public/js/modules/utils/cookies.js`

3. Update focused tests:

    - `tests/googleAuth.session.test.js`
    - `tests/userGetDetails.test.js`
    - `tests/userUpdate.route.test.js` (new)

4. Run focused verification:

    - `cmd /c node --experimental-vm-modules node_modules/jest/bin/jest.js tests/googleAuth.session.test.js tests/userGetDetails.test.js tests/userUpdate.route.test.js --runInBand`

5. Run the broader project test command once the focused tests pass:

    - `cmd /c npm test`

6. If time permits, do a local browser sanity check on a non-`3000` port, for example:

    - `cmd /c set PORT=3100 && npm start`

## Validation and Acceptance

Acceptance is behavioral.

For signed-in users, `/api/auth/session` and `POST /api/v1/users/getDetails` must include `tooltipsEnabled`, defaulting to `true` for legacy records. `PATCH /api/v1/users/update` must accept `tooltipsEnabled: false` and return the updated value.

In the browser, hovering any dagger token must show the dagger tooltip copy. Hovering any captured piece in the live HUD must show the captured-piece tooltip copy. When the response window is open, hovering the `Bomb`, `Challenge`, and `Pass` buttons must show the requested text. When a move lands and waits on a declaration choice, hovering the thought bubble must show `Declare this piece as a ...` with the correct declaration.

The account menu must show a `Tooltips` slide toggle below `Tournaments` for authenticated users and below the guest login message for guests. The toggle must default to on. Turning it off must immediately suppress the custom tooltip box, and the preference must persist across refresh through the database for signed-in users and through cookies for guests. `Logout` must remain pinned to the bottom of the account panel.

## Idempotence and Recovery

The schema and route edits are additive and safe to rerun. If a test fails midway through the work, rerun the same Jest command after fixing the affected file; no migration step is required because missing `tooltipsEnabled` values are treated as `true`.

If the browser tooltip layer mispositions or becomes “stuck” on screen, the recovery path is to hide it on any disable, blur, resize, or scroll event and rely on the delegated listeners to re-show it on the next hover.

## Artifacts and Notes

Expected focused test transcript after implementation:

    PASS tests/googleAuth.session.test.js
    PASS tests/userGetDetails.test.js
    PASS tests/userUpdate.route.test.js

Expected manual UI observations:

    Hover dagger token -> purple tooltip box with white text and gold border.
    Toggle Tooltips off -> existing tooltip box disappears immediately.
    Refresh page -> toggle and hover behavior remain off.

## Interfaces and Dependencies

`src/utils/userPreferences.js` should export a helper that takes any user-like object and returns a boolean `tooltipsEnabled`, defaulting missing or malformed values to `true`.

`public/js/modules/ui/tooltips.js` should expose browser-only helpers that let callers:

    initTooltipSystem({ enabled })
    setTooltipsEnabled(enabled)
    applyTooltipAttributes(element, text, options)
    clearTooltipAttributes(element)

`public/js/modules/ui/tooltipContent.js` should export the fixed copy strings and a helper that maps thought-bubble asset keys to declaration tooltip text.

Revision note: created this ExecPlan before implementation after tracing the existing account menu, shared HUD rendering, and bubble overlay flow, and choosing a delegated tooltip system with a single persisted `tooltipsEnabled` preference.

Revision note: updated this ExecPlan after implementation to record the completed server/client wiring, the extra `Resign` and `Draw` tooltip copy, the passing Jest runs, and the Playwright-discovered toggle-slider fix.
