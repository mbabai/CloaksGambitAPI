const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const sharedConstants = require('../shared/constants');

const helpersUrl = pathToFileURL(
  path.resolve(__dirname, '..', 'public', 'js', 'modules', 'interactions', 'legalSourceHighlights.js'),
).href;
const movesUrl = pathToFileURL(
  path.resolve(__dirname, '..', 'public', 'js', 'modules', 'state', 'moves.js'),
).href;

const IDENTITIES = sharedConstants.identities;

function runExpression(expression) {
  const script = `
    Promise.all([
      import(${JSON.stringify(helpersUrl)}),
      import(${JSON.stringify(movesUrl)}),
    ]).then(([helpers, moves]) => {
      const result = (${expression})({ helpers, moves });
      console.log(JSON.stringify(result));
    }).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8' },
  );
  return JSON.parse(output);
}

describe('legal piece source highlights', () => {
  test('setup highlights stash pieces by default and isolates the king when the board is full without one', () => {
    const result = runExpression(`
      ({ helpers }) => {
        const rook = { identity: ${IDENTITIES.ROOK}, color: 0 };
        const king = { identity: ${IDENTITIES.KING}, color: 0 };
        return {
          defaultSetup: helpers.getSetupLegalSources({
            workingRank: [king, null, null, null, null],
            workingStash: [rook, null, king, rook],
            workingOnDeck: rook,
          }),
          missingKingSetup: helpers.getSetupLegalSources({
            workingRank: [rook, rook, rook, rook, rook],
            workingStash: [rook, null, king, rook],
            workingOnDeck: rook,
          }),
          completableSetup: helpers.getSetupLegalSources({
            workingRank: [rook, rook, king, rook, rook],
            workingStash: [rook, null, king, rook],
            workingOnDeck: rook,
            isSetupCompletable: true,
          }),
        };
      }
    `);

    expect(result.defaultSetup).toEqual({
      stashIndexes: [0, 2, 3],
      highlightDeck: false,
    });
    expect(result.missingKingSetup).toEqual({
      stashIndexes: [2],
      highlightDeck: false,
    });
    expect(result.completableSetup).toEqual({
      stashIndexes: [],
      highlightDeck: false,
    });
  });

  test('on-deck highlights exclude the king and setup swaps refuse moving the king onto deck', () => {
    const result = runExpression(`
      ({ helpers, moves }) => {
        const king = { identity: ${IDENTITIES.KING}, color: 0 };
        const rook = { identity: ${IDENTITIES.ROOK}, color: 0 };
        const kingRank = new Array(5).fill(null);
        const rookRank = new Array(5).fill(null);
        return {
          onDeckSources: helpers.getOnDeckLegalSources({ stash: [king, rook, null] }),
          deckHighlightFromRook: helpers.getDeckDestinationHighlight({
            origin: { type: 'stash', index: 1 },
            piece: rook,
            deckPiece: king,
          }),
          deckHighlightFromKing: helpers.getDeckDestinationHighlight({
            origin: { type: 'stash', index: 0 },
            piece: king,
            deckPiece: rook,
          }),
          deckHighlightFromDeck: helpers.getDeckDestinationHighlight({
            origin: { type: 'deck', index: 0 },
            piece: rook,
            deckPiece: king,
          }),
          kingToDeckAllowed: moves.performMove(
            kingRank,
            { value: null },
            [king, rook],
            { type: 'stash', index: 0 },
            { type: 'deck', index: 0 },
          ),
          rookToDeckAllowed: moves.performMove(
            rookRank,
            { value: null },
            [king, rook],
            { type: 'stash', index: 1 },
            { type: 'deck', index: 0 },
          ),
        };
      }
    `);

    expect(result.onDeckSources).toEqual({
      stashIndexes: [1],
      highlightDeck: false,
    });
    expect(result.deckHighlightFromRook).toEqual({
      targetType: 'deck',
      isCapture: true,
      matchesTrueIdentity: true,
      opacity: 0.7,
    });
    expect(result.deckHighlightFromKing).toBeNull();
    expect(result.deckHighlightFromDeck).toBeNull();
    expect(result.kingToDeckAllowed).toBe(false);
    expect(result.rookToDeckAllowed).toBe(true);
  });

  test('regular play highlights only board pieces that can legally move somewhere', () => {
    const result = runExpression(`
      ({ helpers }) => {
        const piece = { identity: ${IDENTITIES.ROOK}, color: 0 };
        const openBoard = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => null));
        openBoard[1][1] = piece;
        const blockedBoard = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ identity: ${IDENTITIES.ROOK}, color: 0 })));
        return {
          openBoard: helpers.getLegalBoardSourceCells({
            currentBoard: openBoard,
            currentIsWhite: true,
            playerColor: 0,
            rows: 3,
            cols: 3,
          }),
          blockedBoard: helpers.getLegalBoardSourceCells({
            currentBoard: blockedBoard,
            currentIsWhite: true,
            playerColor: 0,
            rows: 3,
            cols: 3,
          }),
        };
      }
    `);

    expect(result.openBoard).toEqual([{ uiR: 1, uiC: 1 }]);
    expect(result.blockedBoard).toEqual([]);
  });

  test('live destination highlights mark captures and true-identity squares separately from bluff-only squares', () => {
    const result = runExpression(`
      ({ helpers }) => {
        const rook = { identity: ${IDENTITIES.ROOK}, color: 0 };
        const enemy = { identity: ${IDENTITIES.BISHOP}, color: 1 };
        const friend = { identity: ${IDENTITIES.KNIGHT}, color: 0 };
        const board = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => null));
        board[2][2] = rook;
        board[2][4] = enemy;
        board[4][2] = friend;
        const highlights = helpers.getLegalBoardDestinationCells({
          currentBoard: board,
          currentIsWhite: true,
          rows: 5,
          cols: 5,
          originUI: { uiR: 2, uiC: 2 },
          piece: rook,
        });
        const byCell = Object.fromEntries(highlights.map((entry) => [\`\${entry.uiR}:\${entry.uiC}\`, entry]));
        return {
          capture: byCell['2:4'] || null,
          bluffOnly: byCell['1:1'] || null,
          friendlyOccupied: byCell['0:2'] || null,
        };
      }
    `);

    expect(result.capture).toEqual({
      uiR: 2,
      uiC: 4,
      isCapture: true,
      matchesTrueIdentity: true,
      opacity: 0.7,
    });
    expect(result.bluffOnly).toEqual({
      uiR: 1,
      uiC: 1,
      isCapture: false,
      matchesTrueIdentity: false,
      opacity: 0.15,
    });
    expect(result.friendlyOccupied).toBeNull();
  });

  test('setup destination highlights cover the home rank and exclude the selected board square', () => {
    const result = runExpression(`
      ({ helpers }) => {
        const rook = { identity: ${IDENTITIES.ROOK}, color: 0 };
        const bishop = { identity: ${IDENTITIES.BISHOP}, color: 0 };
        const king = { identity: ${IDENTITIES.KING}, color: 0 };
        return {
          fromStash: helpers.getSetupBoardDestinationIndexes({
            workingRank: [rook, null, bishop, null, king],
            origin: { type: 'stash', index: 1 },
          }),
          fromBoard: helpers.getSetupBoardDestinationIndexes({
            workingRank: [rook, null, bishop, null, king],
            origin: { type: 'board', index: 2 },
          }),
        };
      }
    `);

    expect(result.fromStash).toEqual([
      { index: 0, isCapture: true, matchesTrueIdentity: true, opacity: 0.7 },
      { index: 1, isCapture: false, matchesTrueIdentity: true, opacity: 0.7 },
      { index: 2, isCapture: true, matchesTrueIdentity: true, opacity: 0.7 },
      { index: 3, isCapture: false, matchesTrueIdentity: true, opacity: 0.7 },
      { index: 4, isCapture: true, matchesTrueIdentity: true, opacity: 0.7 },
    ]);
    expect(result.fromBoard).toEqual([
      { index: 0, isCapture: true, matchesTrueIdentity: true, opacity: 0.7 },
      { index: 1, isCapture: false, matchesTrueIdentity: true, opacity: 0.7 },
      { index: 3, isCapture: false, matchesTrueIdentity: true, opacity: 0.7 },
      { index: 4, isCapture: true, matchesTrueIdentity: true, opacity: 0.7 },
    ]);
  });
});
