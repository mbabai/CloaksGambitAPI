# Rename Public Piece Identities And Compose Bubbles

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the repository guidance in `PLANS.md`.

## Purpose / Big Picture

The game is changing its public piece identity language away from chess names. Players should see Heart, Sword, Spear, Scythe, and Poison in UI copy, tutorial text, tooltips, history labels, and declaration prompts. The tutorial may still reference chess names only when explaining movement rules. Declaration thought and speech bubbles should also be rendered procedurally: a reusable bubble background plus the existing declaration icon layered on top.

## Progress

- [x] (2026-04-27 14:09-07:00) Located public copy and bubble rendering paths with repository search.
- [x] (2026-04-27 14:12-07:00) Confirmed procedural bubble backgrounds exist in `public/assets/images/UI/Procedural/`.
- [x] (2026-04-27 14:25-07:00) Updated obvious public-facing identity labels and tutorial copy.
- [x] (2026-04-27 14:28-07:00) Replaced declaration bubble image rendering with procedural background-plus-icon composition.
- [x] (2026-04-27 14:31-07:00) Added focused tests for procedural bubble asset wiring and updated affected copy tests.
- [x] (2026-04-27 14:36-07:00) Validated with a browser screenshot of bubbles and `npm.cmd test`.

## Surprises & Discoveries

- Observation: The code uses chess identity names as internal enum and route names throughout server and bot logic.
  Evidence: `src/routes/v1/gameAction/bomb.js`, `shared/bots/baseBot.js`, and many tests refer to bomb/king/rook as implementation concepts rather than UI copy.

- Observation: The tutorial intentionally uses chess movement names to explain movement.
  Evidence: `public/tutorials/intro.json` contains wording such as "Rooks can move straight (like in chess)" and the user explicitly allowed tutorial movement explanations to reference chess pieces.

- Observation: The new procedural bubble backgrounds are blank bubbles, and the existing identity SVG files can sit cleanly on top as the icon layer.
  Evidence: A temporary browser preview at `/bubble-preview.html` rendered speech and thought bubbles with no console errors and visible Heart/Sword/Spear/Scythe/Poison art.

## Decision Log

- Decision: Keep internal enum names, route paths, function names, and algorithm comments unchanged unless they directly render to users.
  Rationale: Renaming internal identifiers would create a risky rules-engine migration, while the user asked specifically for UI and tutorial copy. Public strings can be scrubbed without destabilizing gameplay.
  Date/Author: 2026-04-27 / Codex

- Decision: Use Heart, Sword, Spear, Scythe, and Poison as the public names for King, Rook, Bishop, Knight, and Bomb.
  Rationale: These are the identity art names already introduced by the procedural piece assets.
  Date/Author: 2026-04-27 / Codex

- Decision: Keep bubble type strings such as `kingSpeechLeft` and route names such as `/gameAction/bomb` internal for now.
  Rationale: They are control identifiers and API paths rather than player-facing copy. Renaming them would require a broader protocol migration and is not needed for the visible terminology scrub.
  Date/Author: 2026-04-27 / Codex

## Outcomes & Retrospective

Completed the public-facing terminology pass and procedural bubble renderer. Internal route names and enum keys remain as implementation identifiers. Browser preview showed layered bubbles rendering without console errors, and the full Jest suite passed.

## Context and Orientation

The browser starts at `public/index.html`, loads `public/js/main.js`, and then runs most live game behavior in `public/index.js`. Shared board rendering is in `public/js/modules/components/boardView.js`; it renders declaration bubbles over the Canvas board. Bubble asset lookup is in `public/js/modules/ui/icons.js` and currently returns precomposed SVGs from `public/js/shared/assetManifest.js`. Tutorial instructional copy lives in `public/tutorials/intro.json`. Tooltip copy lives in `public/js/modules/ui/tooltipContent.js`. History win labels live in `public/js/modules/history/dashboard.js` and related text in `public/index.js`.

The old public identity names are King, Rook, Bishop, Knight, and Bomb. The new public identity names are Heart, Sword, Spear, Scythe, and Poison. The internal numeric identities and enum property names remain unchanged for this pass.

## Plan of Work

First update shared public labels so UI modules can use the new names consistently. Then update tutorial JSON and tooltip/history/toast text. Preserve chess names only in tutorial sentences that explain movement geometry, for example "the Sword moves like a rook in chess." Next add a procedural bubble asset helper that maps each bubble type to a background (`BubbleSpeechLeft.svg`, `BubbleThoughtLeft.svg`, or `BubbleThoughtRight.svg`) and the existing precomposed bubble's declaration icon source. Update DOM bubble renderers to layer the background and icon instead of using a single image for declaration thought/speech bubbles. Finally update tests and run the full suite.

## Concrete Steps

Work from `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`.

Run searches with:

    rg -n "\b(King|king|Rook|rook|Bishop|bishop|Knight|knight|Bomb|bomb)\b" public src/services/tutorials rules.md docs/API.md tests

Run focused checks after edits:

    npm.cmd test -- tests/proceduralPieceAssets.test.js

Run full validation:

    npm.cmd test

## Validation and Acceptance

Acceptance is user-visible. In a browser, declaration bubbles use the new procedural bubble backgrounds with the current declaration icon layered on top. Player-facing labels, tooltips, toasts, history summaries, and tutorial instructions use Heart, Sword, Spear, Scythe, and Poison. Tutorial movement explanation may still say the Sword moves like a rook in chess, the Spear moves like a bishop in chess, and the Scythe moves like a knight in chess.

The final `npm.cmd test` command should pass all suites.

Observed final validation:

    Test Suites: 64 passed, 64 total
    Tests:       221 passed, 221 total

## Idempotence and Recovery

All edits are text and browser-renderer changes. The existing SVG asset edits in the worktree belong to the user and must not be reverted. Temporary preview files, if used, should be deleted before completion.

## Artifacts and Notes

Pending completion.

## Interfaces and Dependencies

Use existing browser modules and no new third-party dependencies. New helpers may be added under `public/js/modules/ui/` or `public/js/modules/render/` and imported by `boardView.js` and `public/index.js` for consistent bubble composition.
