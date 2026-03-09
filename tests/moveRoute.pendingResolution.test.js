jest.mock('../src/models/Game', () => ({
  findById: jest.fn(),
}));

jest.mock('../src/utils/getServerConfig', () => jest.fn());
jest.mock('../src/eventBus', () => ({ emit: jest.fn() }));
jest.mock('../src/utils/authTokens', () => ({
  resolveUserFromRequest: jest.fn().mockResolvedValue(null),
}));
jest.mock('../src/models/User', () => ({
  findById: jest.fn(),
}));

const sharedConstants = require('../shared/constants');
const Game = require('../src/models/Game');
const getServerConfig = require('../src/utils/getServerConfig');
const moveRouter = require('../src/routes/v1/gameAction/move');

function extractPostHandler(router) {
  const layer = router.stack.find((entry) => (
    entry
    && entry.route
    && entry.route.path === '/'
    && entry.route.methods
    && entry.route.methods.post
    && Array.isArray(entry.route.stack)
    && entry.route.stack.length
  ));
  if (!layer) {
    throw new Error('POST handler not found on move router');
  }
  return layer.route.stack[0].handle;
}

function callPost(handler, body) {
  return new Promise((resolve) => {
    const req = { body };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload });
        return this;
      },
    };
    handler(req, res, () => resolve({ statusCode: 200, payload: {} }));
  });
}

describe('move route pending-resolution safety', () => {
  const handler = extractPostHandler(moveRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    getServerConfig.mockResolvedValue({
      actions: new Map(Object.entries(sharedConstants.actions)),
      moveStates: new Map(Object.entries(sharedConstants.moveStates)),
      identities: new Map(Object.entries(sharedConstants.identities)),
      winReasons: new Map(Object.entries(sharedConstants.winReasons)),
      boardDimensions: { RANKS: 6, FILES: 5 },
    });
  });

  test('rejects stale from-square after resolving previous pending move', async () => {
    const {
      actions,
      moveStates,
      identities,
    } = sharedConstants;

    const board = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => null));
    board[1][1] = { color: 0, identity: identities.ROOK };
    board[2][2] = { color: 1, identity: identities.KNIGHT };

    const game = {
      _id: 'game-test-1',
      isActive: true,
      setupComplete: [true, true],
      playerTurn: 1,
      onDeckingPlayer: null,
      actions: [
        {
          type: actions.MOVE,
          player: 0,
          details: {
            from: { row: 1, col: 1 },
            to: { row: 2, col: 2 },
            declaration: identities.ROOK,
          },
        },
      ],
      moves: [
        {
          player: 0,
          from: { row: 1, col: 1 },
          to: { row: 2, col: 2 },
          declaration: identities.ROOK,
          state: moveStates.PENDING,
        },
      ],
      board,
      captured: [[], []],
      stashes: [[], []],
      onDecks: [null, null],
      daggers: [0, 0],
      movesSinceAction: 0,
      players: [],
      addAction: jest.fn(async function addAction(type, player, details) {
        this.actions.push({ type, player, details });
      }),
      save: jest.fn(async () => {}),
      endGame: jest.fn(async function endGame(winner, reason) {
        this.isActive = false;
        this.winner = winner;
        this.winReason = reason;
      }),
    };

    Game.findById.mockResolvedValue(game);

    const response = await callPost(handler, {
      gameId: game._id,
      color: 1,
      from: { row: 2, col: 2 },
      to: { row: 3, col: 2 },
      declaration: identities.KNIGHT,
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload.message).toBe("Not this player's turn");

    // Previous pending move should have resolved first.
    expect(game.board[1][1]).toBeNull();
    expect(game.board[2][2]).toEqual(expect.objectContaining({ color: 0, identity: identities.ROOK }));
    expect(game.moves[0].state).toBe(moveStates.RESOLVED);
    expect(game.captured[0]).toHaveLength(1);

    // No new move accepted after stale validation candidate.
    expect(game.moves).toHaveLength(1);
    expect(game.save).not.toHaveBeenCalled();
  });
});
