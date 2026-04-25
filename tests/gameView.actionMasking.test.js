const maskGameForColor = require('../src/utils/gameView');
const { GAME_CONSTANTS } = require('../shared/constants');

const { identities, actions } = GAME_CONSTANTS;

function createGame() {
  return {
    board: [
      [{ color: 0, identity: identities.KING }, { color: 1, identity: identities.ROOK }],
    ],
    stashes: [
      [{ color: 0, identity: identities.BISHOP }],
      [{ color: 1, identity: identities.KNIGHT }],
    ],
    onDecks: [
      { color: 0, identity: identities.BOMB },
      { color: 1, identity: identities.BISHOP },
    ],
    actions: [
      {
        type: actions.SETUP,
        player: 1,
        details: {
          pieces: [
            { row: 5, col: 0, identity: identities.KING },
            { row: 5, col: 1, identity: identities.ROOK },
          ],
          onDeck: { identity: identities.BOMB },
        },
      },
      {
        type: actions.ON_DECK,
        player: 1,
        details: { identity: identities.KNIGHT },
      },
      {
        type: actions.MOVE,
        player: 1,
        details: {
          from: { row: 5, col: 1 },
          to: { row: 4, col: 1 },
          declaration: identities.ROOK,
        },
      },
    ],
    isActive: true,
    winner: null,
    winReason: null,
    onDeckingPlayer: null,
    playerTurn: 0,
    setupComplete: [true, true],
    playersReady: [true, true],
  };
}

describe('maskGameForColor action details', () => {
  test('masks opponent setup and on-deck identities in action history', () => {
    const masked = maskGameForColor(createGame(), 0);

    expect(masked.actions[0].details.pieces).toEqual([
      { row: 5, col: 0, identity: identities.UNKNOWN },
      { row: 5, col: 1, identity: identities.UNKNOWN },
    ]);
    expect(masked.actions[0].details.onDeck.identity).toBe(identities.UNKNOWN);
    expect(masked.actions[1].details.identity).toBe(identities.UNKNOWN);
    expect(masked.actions[2].details.declaration).toBe(identities.ROOK);
  });

  test('preserves own setup and on-deck identities in action history', () => {
    const masked = maskGameForColor(createGame(), 1);

    expect(masked.actions[0].details.pieces[0].identity).toBe(identities.KING);
    expect(masked.actions[0].details.pieces[1].identity).toBe(identities.ROOK);
    expect(masked.actions[0].details.onDeck.identity).toBe(identities.BOMB);
    expect(masked.actions[1].details.identity).toBe(identities.KNIGHT);
  });

  test('masks all setup and on-deck identities for spectators', () => {
    const masked = maskGameForColor(createGame(), 'spectator');

    expect(masked.actions[0].details.pieces.every(piece => piece.identity === identities.UNKNOWN)).toBe(true);
    expect(masked.actions[0].details.onDeck.identity).toBe(identities.UNKNOWN);
    expect(masked.actions[1].details.identity).toBe(identities.UNKNOWN);
  });
});
