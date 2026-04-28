jest.mock('../src/models/Game', () => ({
  findById: jest.fn(),
}));

jest.mock('../src/utils/getServerConfig', () => jest.fn());
jest.mock('../src/eventBus', () => ({ emit: jest.fn() }));
jest.mock('../src/utils/gameAccess', () => ({
  requireGamePlayerContext: jest.fn(),
}));

const sharedConstants = require('../shared/constants');
const Game = require('../src/models/Game');
const getServerConfig = require('../src/utils/getServerConfig');
const { requireGamePlayerContext } = require('../src/utils/gameAccess');
const bombRouter = require('../src/routes/v1/gameAction/bomb');
const passRouter = require('../src/routes/v1/gameAction/pass');

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
    throw new Error('POST handler not found');
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

describe('bomb and pass routes require a pending move window', () => {
  const bombHandler = extractPostHandler(bombRouter);
  const passHandler = extractPostHandler(passRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    getServerConfig.mockResolvedValue({
      actions: new Map(Object.entries(sharedConstants.actions)),
      moveStates: new Map(Object.entries(sharedConstants.moveStates)),
      identities: new Map(Object.entries(sharedConstants.identities)),
    });
  });

  test('bomb rejects moves that are already resolved', async () => {
    const game = {
      _id: 'game-bomb-1',
      isActive: true,
      playerTurn: 1,
      actions: [
        { type: sharedConstants.actions.MOVE, player: 0, details: {} },
      ],
      moves: [
        {
          player: 0,
          from: { row: 1, col: 1 },
          to: { row: 2, col: 1 },
          declaration: sharedConstants.identities.ROOK,
          state: sharedConstants.moveStates.RESOLVED,
        },
      ],
      board: Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => null)),
    };
    requireGamePlayerContext.mockResolvedValue({
      game,
      color: 1,
      requesterDetails: {
        userId: 'player-1',
        username: 'Player1',
        isBot: false,
        botDifficulty: null,
      },
    });

    const response = await callPost(bombHandler, {
      gameId: 'game-bomb-1',
      color: 1,
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload.message).toBe('No pending move to Poison');
  });

  test('pass rejects bombs whose underlying move is already resolved', async () => {
    const board = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => null));
    board[1][1] = { color: 0, identity: sharedConstants.identities.ROOK };

    const game = {
      _id: 'game-pass-1',
      isActive: true,
      playerTurn: 0,
      captured: [[], []],
      actions: [
        { type: sharedConstants.actions.MOVE, player: 1, details: {} },
        { type: sharedConstants.actions.BOMB, player: 0, details: {} },
      ],
      moves: [
        {
          player: 1,
          from: { row: 1, col: 1 },
          to: { row: 1, col: 2 },
          declaration: sharedConstants.identities.BISHOP,
          state: sharedConstants.moveStates.RESOLVED,
        },
      ],
      board,
    };
    requireGamePlayerContext.mockResolvedValue({
      game,
      color: 0,
      requesterDetails: {
        userId: 'player-0',
        username: 'Player0',
        isBot: false,
        botDifficulty: null,
      },
    });

    const response = await callPost(passHandler, {
      gameId: 'game-pass-1',
      color: 0,
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload.message).toBe('No pending move to resolve');
  });
});
