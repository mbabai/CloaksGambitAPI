# Shared Code Notes

## Constants Pipeline
- `shared/constants/game.json` is the source of truth for numeric enums, win reasons, board size, and default time controls.
- `scripts/build-shared-constants.js` generates browser-consumable files from `game.json` and `assets.json`.
- Do not hand-edit:
  - `public/js/shared/gameConstants.js`
  - `public/js/shared/assetManifest.js`
- After editing shared constants, run `npm run build:shared`.

## Runtime Exports
- `shared/constants/index.js` deep-freezes the exported structures.
- Clone before mutating if you need a writable copy.
- The long-form wording of the game rules lives in `rules.md`, not in `game.json`.

## Shared Bots
- `shared/bots/` contains the shared bot client/runtime used by:
  - internal bot startup on the server
  - external bot tooling
- `BaseBotController` talks to the live HTTP routes and listens to socket payloads, so live route changes immediately affect bot behavior.

## Change Discipline
- If you change `game.json`, update:
  - `rules.md` if the change is player-visible
  - relevant Jest coverage such as `tests/sharedGameConstants.test.js`
  - any live-route validation that depends on the constant
- If you change a shared bot assumption, inspect both `shared/bots/*` and `src/services/bots/*`.
