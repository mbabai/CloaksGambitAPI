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

describe('move route stored clock authority', () => {
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('accepted move stores a post-move clock snapshot without swapping totals', async () => {
    const start = new Date('2024-01-01T00:00:00Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(start + 5000);

    const board = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => null));
    board[0][0] = { color: 0, identity: sharedConstants.identities.ROOK };

    const game = {
      _id: 'game-move-clock-1',
      isActive: true,
      createdAt: new Date(start),
      startTime: new Date(start),
      timeControlStart: 300000,
      increment: 3000,
      setupComplete: [true, true],
      playerTurn: 0,
      onDeckingPlayer: null,
      actions: [],
      moves: [],
      board,
      captured: [[], []],
      stashes: [[], []],
      onDecks: [null, null],
      daggers: [0, 0],
      players: [],
      markModified: jest.fn(),
      addAction: jest.fn(async function addAction(type, player, details) {
        this.actions.push({ type, player, details, timestamp: new Date(Date.now()) });
        return this;
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
      color: 0,
      from: { row: 0, col: 0 },
      to: { row: 0, col: 2 },
      declaration: sharedConstants.identities.ROOK,
    });

    expect(response.statusCode).toBe(200);
    expect(game.clockState.whiteMs).toBe(298000);
    expect(game.clockState.blackMs).toBe(300000);
    expect(game.clockState.activeColor).toBe(1);
    expect(game.clockState.tickingWhite).toBe(false);
    expect(game.clockState.tickingBlack).toBe(true);
  });
});
