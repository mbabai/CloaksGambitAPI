# Add Valid Move Highlighter System

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`PLANS.md` is checked into the repository root and this document must be maintained in accordance with `PLANS.md`.

## Purpose / Big Picture

After this change, a player can pick up one of their pieces and immediately see every board square that piece may legally move to. Empty legal destinations show a small black semi-transparent dot. Legal captures show a larger black semi-transparent circle centered on the occupied square so the marker is still visible over the piece. Destinations that match the selected piece's true identity use a darker marker than bluff-only destinations. During setup, selecting or dragging a piece also shows the legal home-rank placement targets, and the on-deck slot receives the same marker when it is a legal destination during setup or the on-decking phase.

The user-visible proof is simple: start a game, click or drag one of your own pieces during live play, and the board should show all legal destinations at once. Start setup, click or drag a stash, deck, or home-rank piece, and the first rank should show placement dots.

## Progress

- [x] (2026-04-22 10:55-07:00) Read `PLANS.md`, `public/AGENTS.md`, `tests/AGENTS.md`, `src/routes/v1/gameAction/AGENTS.md`, and the current player-board code to map where selection, drag, setup placement, and live legal move checks already live.
- [x] (2026-04-22 11:10-07:00) Extended `public/js/modules/interactions/legalSourceHighlights.js` with live destination generation and setup home-rank destination generation, including occupied-target and true-identity metadata.
- [x] (2026-04-22 11:16-07:00) Wired `public/index.js` to resync board hit-layer markers after each render and immediately when drag starts, and added marker styling in `public/ui.css`.
- [x] (2026-04-22 11:20-07:00) Added focused Jest coverage in `tests/legalSourceHighlights.test.js` and ran `npm.cmd test -- tests/legalSourceHighlights.test.js`.
- [x] (2026-04-22 11:36-07:00) Extended the same destination-marker path to the on-deck slot for setup and on-decking selections, and updated helper coverage to lock that behavior in.

## Surprises & Discoveries

- Observation: The working tree already contains uncommitted player-side highlight work, including `public/js/modules/interactions/legalSourceHighlights.js` and board-source emphasis styles.
  Evidence: `git status --short` showed modified player UI files and one untracked helper module before this feature work started.

- Observation: On this Windows machine, invoking `npm` directly from PowerShell hits the `npm.ps1` execution-policy block.
  Evidence: `npm test -- tests/legalSourceHighlights.test.js` failed with `PSSecurityException`, while `npm.cmd test -- tests/legalSourceHighlights.test.js` succeeded immediately afterward.

## Decision Log

- Decision: Build the destination highlighter on top of the existing client legal-move helper instead of introducing a second move-rule implementation.
  Rationale: `public/index.js` already uses `Declaration`, `isWithinPieceRange`, and `isPathClear`, and the existing `legalSourceHighlights.js` module is the natural place to centralize the same legality logic for highlight generation.
  Date/Author: 2026-04-22 / Codex

- Decision: Render move markers in the board hit layer instead of adding another board-canvas painting pass.
  Rationale: The hit layer already sits above the canvas, survives both click and drag interaction flows, and can be updated immediately on drag start without forcing a full board re-render that might disturb the touch drag stream.
  Date/Author: 2026-04-22 / Codex

## Outcomes & Retrospective

The feature is implemented. Live play now computes a full destination list for the selected piece, including captures and whether each destination matches the piece's true identity, and the player board renders those markers as black semi-transparent circles in the hit layer. Setup now exposes first-rank placement targets for selected stash, deck, and home-rank pieces using the same marker system, and the on-deck slot now receives the same marker whenever it is a legal destination in setup or while choosing a replacement on-deck piece.

The focused helper tests passed, which proves the move-generation metadata behind the UI is correct for the cases covered. Manual browser verification still remains the best way to tune the final visual feel, but the data path and the render path are both in place.

## Context and Orientation

`public/index.js` is still the main live player controller. It owns the mutable client state for `selected`, `dragging`, `currentBoard`, `workingRank`, `workingStash`, `workingOnDeck`, and the click/drag handlers for setup and live play. `renderBoardAndBars()` is the single player render pass that calls the shared `gameView` board surface and the stash renderer.

`public/js/modules/interactions/legalSourceHighlights.js` is the current helper module for legal source emphasis. It already knows how to scan the board for moveable sources by using `Declaration`, `uiToServerCoords()`, `isWithinPieceRange()`, and `isPathClear()` from `public/js/modules/interactions/moveRules.js`. This is the correct place to add a destination-highlighting helper because it is already the client-side legality hub.

`public/js/modules/components/boardView.js` creates the board canvas and the transparent hit-layer buttons that sit on top of it. Those hit-layer buttons are stored in `refs.boardCells` during live play and `refs.bottomCells` during setup. The new move markers will be attached to those existing buttons so the marker can appear immediately during drag without rebuilding the whole board.

`public/ui.css` contains the board hit-cell styling and is the correct place to define the move-marker look.

`tests/legalSourceHighlights.test.js` already exercises the helper module by importing the ESM browser modules through a small Node `--input-type=module` bridge. This is the right place to add regression coverage for legal destination highlighting and setup placement highlighting.

## Plan of Work

First, extend `public/js/modules/interactions/legalSourceHighlights.js` with two new exports. One export should enumerate every legal live-play destination for a selected board piece and annotate whether each destination is a capture, whether it matches the piece's true identity, and which opacity the marker should use. The other export should enumerate the setup home-rank destination indexes for a selected setup piece, again annotating occupied targets so setup swaps can use the larger occupied-square marker.

Second, update `public/index.js` so the player client computes the current destination highlights from `selected` or `dragging.origin`. Live play should only show markers for a selected on-board piece that belongs to the active player. Setup should show first-rank destinations for a selected setup piece from the board, stash, or deck. `renderBoardAndBars()` must resync the hit-layer markers after each render, and `startDrag()` must resync them immediately when a drag begins so the user sees the markers while dragging.

Third, add the marker styles in `public/ui.css`. Empty destinations should use a smaller filled black circle. Occupied destinations should use a larger filled black circle. The opacity must come from a CSS custom property so live-play true-identity moves can render darker than bluff-only moves.

Fourth, update `tests/legalSourceHighlights.test.js` to cover the new exported helpers. The tests should prove that live-play destination generation includes captures, excludes own occupied squares, distinguishes true-identity destinations from bluff-only destinations, and that setup placement generation returns the first-rank targets with the expected occupied-marker metadata.

## Concrete Steps

From `C:\Users\marce\OneDrive\Documents\GitHub\CloaksGambitAPI`:

1. Edit `docs/valid-move-highlighter-execplan.md` as the feature progresses so the living sections always match reality.
2. Edit `public/js/modules/interactions/legalSourceHighlights.js` to add the new destination helper exports.
3. Edit `public/index.js` to compute current destination highlights and attach marker nodes to `refs.boardCells` and `refs.bottomCells`.
4. Edit `public/ui.css` to add the move-marker classes.
5. Edit `tests/legalSourceHighlights.test.js` to add focused coverage for the new helpers.
6. Run:

      npm.cmd test -- tests/legalSourceHighlights.test.js

   Expect Jest to report the file as passing.

If a broader smoke check is needed after the focused test passes, run:

      npm test

## Validation and Acceptance

Acceptance is behavioral:

1. Start the app with `npm run dev` from the repository root.
2. Open a local game in a browser.
3. During setup, click or drag a stash, deck, or home-rank piece. The first rank should show black semi-transparent circles on every legal placement target, using larger circles on occupied targets.
4. After setup finishes and it becomes your turn, click or drag one of your pieces. Every legal destination should highlight at once. Squares legal for the piece's true identity should look darker than bluff-only destinations.
5. Hover a legal capture target during live play. The occupied square should show the larger semi-transparent black circle centered over the piece.
6. Run `npm.cmd test -- tests/legalSourceHighlights.test.js` and expect the new helper assertions to pass.

## Idempotence and Recovery

The edits are additive and safe to repeat. Re-running the tests is harmless. If a partially applied client patch leaves the board markers in a broken state, revert only the move-highlighter edits in `public/index.js`, `public/js/modules/interactions/legalSourceHighlights.js`, `public/ui.css`, and `tests/legalSourceHighlights.test.js`, then reapply the steps in order. Do not revert unrelated dirty files in the worktree.

## Artifacts and Notes

Important pre-change evidence:

    git status --short
      M public/index.js
      M public/js/modules/board/scene.js
      M public/js/modules/components/boardView.js
      M public/js/modules/render/bars.js
      M public/js/modules/render/stash.js
      M public/js/modules/spectate/controller.js
      M public/js/modules/state/moves.js
      M public/js/modules/ui/banners.js
      M public/ui.css
      M src/routes/v1/gameAction/onDeck.js
      M src/routes/v1/gameAction/setup.js
     ?? public/js/modules/interactions/legalSourceHighlights.js

This matters because the feature work must layer on top of the existing in-progress UI refactor instead of overwriting it.

Important completion evidence:

    npm.cmd test -- tests/legalSourceHighlights.test.js
      PASS tests/legalSourceHighlights.test.js
        legal piece source highlights
          √ setup highlights stash pieces by default and isolates the king when the board is full without one
          √ on-deck highlights exclude the king and setup swaps refuse moving the king onto deck
          √ regular play highlights only board pieces that can legally move somewhere
          √ live destination highlights mark captures and true-identity squares separately from bluff-only squares
          √ setup destination highlights cover the home rank and exclude the selected board square

## Interfaces and Dependencies

In `public/js/modules/interactions/legalSourceHighlights.js`, define stable exports that return plain JavaScript objects so both the player client and Jest can consume them directly:

    getLegalBoardDestinationCells({
      currentBoard,
      currentIsWhite,
      rows,
      cols,
      originUI,
      piece,
    }) => Array<{
      uiR: number,
      uiC: number,
      isCapture: boolean,
      matchesTrueIdentity: boolean,
      opacity: number,
    }>

    getSetupBoardDestinationIndexes({
      workingRank,
      origin,
    }) => Array<{
      index: number,
      isCapture: boolean,
      matchesTrueIdentity: boolean,
      opacity: number,
    }>

`public/index.js` should treat those helpers as the only source of board destination markers. `public/ui.css` should style the marker through CSS classes and the `--cg-move-target-opacity` custom property.

Revision note: updated this ExecPlan after implementation to record the actual helper/UI/test changes and the Windows `npm.cmd` test invocation required by local PowerShell policy.
