jest.mock('../src/models/Game', () => ({
  findByIdAndUpdate: jest.fn(),
  findById: jest.fn(),
}));

jest.mock('../src/utils/getServerConfig', () => jest.fn());
jest.mock('../src/eventBus', () => ({ emit: jest.fn() }));
jest.mock('../src/utils/gameAccess', () => ({
  requireGamePlayerContext: jest.fn(),
}));

const sharedConstants = require('../shared/constants');
const eventBus = require('../src/eventBus');
const Game = require('../src/models/Game');
const getServerConfig = require('../src/utils/getServerConfig');
const { requireGamePlayerContext } = require('../src/utils/gameAccess');
const readyRouter = require('../src/routes/v1/gameAction/ready');

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
    throw new Error('POST handler not found on ready router');
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

describe('ready route stored clock authority', () => {
  const handler = extractPostHandler(readyRouter);

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

  test('second ready starts a ticking stored clock snapshot for white', async () => {
    const now = new Date('2024-01-01T00:00:05Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const updated = {
      _id: 'game-ready-clock-1',
      isActive: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      startTime: null,
      timeControlStart: 300000,
      increment: 3000,
      setupComplete: [true, true],
      playersReady: [true, true],
      playerTurn: 0,
      onDeckingPlayer: null,
      actions: [
        { type: sharedConstants.actions.SETUP, player: 0, timestamp: new Date('2024-01-01T00:00:01Z') },
        { type: sharedConstants.actions.SETUP, player: 1, timestamp: new Date('2024-01-01T00:00:02Z') },
        { type: sharedConstants.actions.READY, player: 0, timestamp: new Date('2024-01-01T00:00:04Z') },
        { type: sharedConstants.actions.READY, player: 1, timestamp: new Date(now) },
      ],
      clockState: null,
      markModified: jest.fn(),
      save: jest.fn(async () => {}),
    };

    Game.findByIdAndUpdate.mockResolvedValue(updated);
    Game.findById.mockReturnValue({
      lean: jest.fn(async () => ({
        _id: updated._id,
        playersReady: updated.playersReady,
        playerTurn: updated.playerTurn,
        setupComplete: updated.setupComplete,
        startTime: updated.startTime,
        clockState: updated.clockState,
      })),
    });

    requireGamePlayerContext.mockResolvedValue({
      game: {
        playersReady: [true, false],
      },
      requesterDetails: {
        userId: 'player-1',
        username: 'Player1',
        isBot: false,
        botDifficulty: null,
      },
      color: 1,
    });

    const response = await callPost(handler, {
      gameId: updated._id,
      color: 1,
    });

    expect(response.statusCode).toBe(200);
    expect(updated.startTime).toEqual(new Date(now));
    expect(updated.clockState.whiteMs).toBe(300000);
    expect(updated.clockState.blackMs).toBe(300000);
    expect(updated.clockState.activeColor).toBe(0);
    expect(updated.clockState.tickingWhite).toBe(true);
    expect(updated.clockState.tickingBlack).toBe(false);
  });

  test('duplicate ready is ignored without mutating clocks or emitting ready events again', async () => {
    requireGamePlayerContext.mockResolvedValue({
      game: {
        playersReady: [true, true],
      },
      requesterDetails: {
        userId: 'player-2',
        username: 'Player2',
        isBot: true,
        botDifficulty: 'easy',
      },
      color: 1,
    });

    const response = await callPost(handler, {
      gameId: 'game-ready-clock-2',
      color: 1,
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({ message: 'Player already ready' });
    expect(Game.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(Game.findById).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
