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
    throw new Error('POST handler not found on pass router');
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

describe('pass route bomb resolution', () => {
  const handler = extractPostHandler(passRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    getServerConfig.mockResolvedValue({
      actions: new Map(Object.entries(sharedConstants.actions)),
      moveStates: new Map(Object.entries(sharedConstants.moveStates)),
      identities: new Map(Object.entries(sharedConstants.identities)),
      winReasons: new Map(Object.entries(sharedConstants.winReasons)),
    });
  });

  test('awards the win to the bomber when pass reveals the mover king', async () => {
    const board = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => null));
    board[0][4] = { color: 0, identity: sharedConstants.identities.KING };

    const game = {
      _id: 'game-pass-1',
      isActive: true,
      playerTurn: 0,
      actions: [
        { type: sharedConstants.actions.MOVE, player: 0, details: {} },
        { type: sharedConstants.actions.BOMB, player: 1, details: {} },
      ],
      moves: [
        {
          player: 0,
          from: { row: 0, col: 4 },
          to: { row: 2, col: 2 },
          declaration: sharedConstants.identities.BISHOP,
          state: sharedConstants.moveStates.PENDING,
        },
      ],
      board,
      captured: [[], []],
      setupComplete: [true, true],
      clockState: null,
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
      toObject() {
        return this;
      },
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

    const response = await callPost(handler, {
      gameId: game._id,
      color: 0,
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload.message).toBe('Game ended: Heart captured');
    expect(game.endGame).toHaveBeenCalledWith(1, sharedConstants.winReasons.CAPTURED_KING);
    expect(game.winner).toBe(1);
    expect(game.captured[0]).toEqual([
      expect.objectContaining({ color: 0, identity: sharedConstants.identities.KING }),
    ]);
  });
});
