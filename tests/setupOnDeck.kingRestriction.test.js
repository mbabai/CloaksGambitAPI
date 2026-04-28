jest.mock('../src/utils/getServerConfig', () => jest.fn());
jest.mock('../src/utils/gameAccess', () => ({
  requireGamePlayerContext: jest.fn(),
}));
jest.mock('../src/utils/gameRouteEvents', () => ({
  emitGameChanged: jest.fn(),
}));
jest.mock('../src/utils/localDebugLogger', () => ({
  appendLocalDebugLog: jest.fn(),
}));

const sharedConstants = require('../shared/constants');
const getServerConfig = require('../src/utils/getServerConfig');
const { requireGamePlayerContext } = require('../src/utils/gameAccess');
const setupRouter = require('../src/routes/v1/gameAction/setup');
const onDeckRouter = require('../src/routes/v1/gameAction/onDeck');

function extractPostHandler(router, label) {
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
    throw new Error(`POST handler not found on ${label}`);
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

function createBaseGame() {
  return {
    _id: 'game-king-deck-1',
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    startTime: new Date('2024-01-01T00:00:00Z'),
    timeControlStart: 300000,
    increment: 3000,
    setupComplete: [false, false],
    playerTurn: 0,
    onDeckingPlayer: 0,
    actions: [],
    moves: [],
    board: Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => null)),
    captured: [[], []],
    stashes: [[], []],
    onDecks: [null, null],
    daggers: [0, 0],
    players: ['player-0', 'player-1'],
    markModified: jest.fn(),
    addAction: jest.fn(async () => {}),
    save: jest.fn(async () => {}),
    endGame: jest.fn(async () => {}),
  };
}

describe('king deck restrictions', () => {
  const setupHandler = extractPostHandler(setupRouter, 'setup router');
  const onDeckHandler = extractPostHandler(onDeckRouter, 'onDeck router');

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

  test('setup rejects choosing the king as the initial on-deck piece', async () => {
    const game = createBaseGame();
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

    const response = await callPost(setupHandler, {
      gameId: game._id,
      color: 0,
      pieces: Array.from({ length: 5 }, (_, col) => ({
        identity: sharedConstants.identities.ROOK,
        color: 0,
        row: 0,
        col,
      })),
      onDeck: {
        identity: sharedConstants.identities.KING,
        color: 0,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload.message).toBe('Heart cannot be placed on deck');
    expect(game.save).not.toHaveBeenCalled();
  });

  test('onDeck rejects refreshing the deck with the king', async () => {
    const game = createBaseGame();
    game.setupComplete = [true, true];
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

    const response = await callPost(onDeckHandler, {
      gameId: game._id,
      color: 0,
      piece: {
        identity: sharedConstants.identities.KING,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload.message).toBe('Heart cannot be placed on deck');
    expect(game.save).not.toHaveBeenCalled();
  });
});
