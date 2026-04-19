jest.mock('../src/models/Game', () => ({
  findByIdAndUpdate: jest.fn(),
  findById: jest.fn(),
}));

jest.mock('../src/models/Match', () => ({
  findById: jest.fn(),
}));

jest.mock('../src/eventBus', () => ({ emit: jest.fn() }));
jest.mock('../src/utils/gameAccess', () => ({
  requireGamePlayerContext: jest.fn(),
}));

const Game = require('../src/models/Game');
const Match = require('../src/models/Match');
const eventBus = require('../src/eventBus');
const { requireGamePlayerContext } = require('../src/utils/gameAccess');
const nextRouter = require('../src/routes/v1/gameAction/next');

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
    throw new Error('POST handler not found on next router');
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

describe('next route match continuation', () => {
  const handler = extractPostHandler(nextRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('ranked rematches auto-advance after five seconds without tournament accept', async () => {
    requireGamePlayerContext.mockResolvedValue({
      game: {
        _id: 'finished-ranked-game',
        match: 'ranked-match-1',
        playersNext: [false, false],
      },
      color: 0,
    });

    Game.findByIdAndUpdate
      .mockReturnValueOnce({
        lean: jest.fn(async () => ({
          _id: 'finished-ranked-game',
          match: 'ranked-match-1',
          players: ['ranked-user-1', 'ranked-user-2'],
          playersNext: [true, false],
        })),
      })
      .mockReturnValueOnce({
        lean: jest.fn(async () => ({
          _id: 'finished-ranked-game',
          match: 'ranked-match-1',
          players: ['ranked-user-1', 'ranked-user-2'],
          playersNext: [true, true],
        })),
      });

    Game.findById.mockReturnValue({
      lean: jest.fn(async () => ({
        _id: 'finished-ranked-game',
        match: 'ranked-match-1',
        players: ['ranked-user-1', 'ranked-user-2'],
        playersNext: [true, false],
      })),
    });

    const nextGame = {
      _id: 'ranked-next-game',
      isActive: true,
      players: ['ranked-user-1', 'ranked-user-2'],
      requiresAccept: false,
      acceptWindowSeconds: 0,
      toObject() {
        return {
          _id: 'ranked-next-game',
          isActive: true,
          players: ['ranked-user-1', 'ranked-user-2'],
          requiresAccept: false,
          acceptWindowSeconds: 0,
        };
      },
    };

    Match.findById.mockReturnValue({
      populate: jest.fn(async () => ({
        _id: 'ranked-match-1',
        type: 'RANKED',
        games: [
          { _id: 'finished-ranked-game', isActive: false, players: ['ranked-user-1', 'ranked-user-2'] },
          nextGame,
        ],
      })),
    });

    const responsePromise = callPost(handler, {
      gameId: 'finished-ranked-game',
      color: 0,
    });

    const response = await responsePromise;

    expect(eventBus.emit).toHaveBeenCalledWith('nextCountdown', {
      gameId: 'finished-ranked-game',
      color: 1,
      seconds: 5,
      affectedUsers: ['ranked-user-2'],
    });

    await jest.advanceTimersByTimeAsync(5000);

    expect(response.statusCode).toBe(200);
    expect(eventBus.emit).toHaveBeenCalledWith('players:bothNext', expect.objectContaining({
      game: expect.objectContaining({
        _id: 'ranked-next-game',
        requiresAccept: false,
      }),
      affectedUsers: ['ranked-user-1', 'ranked-user-2'],
      currentGameNumber: 2,
      requiresAccept: false,
      acceptWindowSeconds: 0,
      tournamentId: null,
      tournamentPhase: null,
    }));
  });

  test('completed matches do not emit players:bothNext when there is no active next game', async () => {
    requireGamePlayerContext.mockResolvedValue({
      game: {
        _id: 'finished-ranked-final',
        match: 'ranked-match-final',
        playersNext: [false, false],
      },
      color: 0,
    });

    Game.findByIdAndUpdate.mockReturnValueOnce({
      lean: jest.fn(async () => ({
        _id: 'finished-ranked-final',
        match: 'ranked-match-final',
        players: ['ranked-user-1', 'ranked-user-2'],
        playersNext: [true, true],
      })),
    });

    Match.findById.mockReturnValue({
      populate: jest.fn(async () => ({
        _id: 'ranked-match-final',
        type: 'RANKED',
        winner: 'ranked-user-1',
        isActive: false,
        games: [
          { _id: 'finished-ranked-final', isActive: false, players: ['ranked-user-1', 'ranked-user-2'] },
        ],
      })),
    });

    const response = await callPost(handler, {
      gameId: 'finished-ranked-final',
      color: 0,
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(expect.objectContaining({
      hasNextGame: false,
      matchEnded: true,
    }));
    expect(eventBus.emit).not.toHaveBeenCalledWith('players:bothNext', expect.anything());
  });
});
