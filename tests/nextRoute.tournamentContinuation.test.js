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

describe('next route tournament continuation', () => {
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

  test('auto-next emits the real next tournament game with accept metadata', async () => {
    requireGamePlayerContext.mockResolvedValue({
      game: {
        _id: 'finished-game',
        match: 'match-1',
        playersNext: [false, false],
      },
      color: 0,
    });

    Game.findByIdAndUpdate
      .mockReturnValueOnce({
        lean: jest.fn(async () => ({
          _id: 'finished-game',
          match: 'match-1',
          players: ['user-1', 'user-2'],
          playersNext: [true, false],
        })),
      })
      .mockReturnValueOnce({
        lean: jest.fn(async () => ({
          _id: 'finished-game',
          match: 'match-1',
          players: ['user-1', 'user-2'],
          playersNext: [true, true],
        })),
      });

    Game.findById.mockReturnValue({
      lean: jest.fn(async () => ({
        _id: 'finished-game',
        match: 'match-1',
        players: ['user-1', 'user-2'],
        playersNext: [true, false],
      })),
    });

    const nextGame = {
      _id: 'next-game',
      isActive: true,
      players: ['user-1', 'user-2'],
      toObject() {
        return {
          _id: 'next-game',
          isActive: true,
          players: ['user-1', 'user-2'],
        };
      },
    };

    Match.findById.mockReturnValue({
      populate: jest.fn(async () => ({
        _id: 'match-1',
        type: 'TOURNAMENT_ELIMINATION',
        tournamentId: 'tournament-1',
        tournamentPhase: 'elimination',
        games: [
          { _id: 'finished-game', isActive: false, players: ['user-1', 'user-2'] },
          nextGame,
        ],
      })),
    });

    const responsePromise = callPost(handler, {
      gameId: 'finished-game',
      color: 0,
    });

    await jest.advanceTimersByTimeAsync(5000);
    const response = await responsePromise;

    expect(response.statusCode).toBe(200);
    expect(eventBus.emit).toHaveBeenCalledWith('players:bothNext', expect.objectContaining({
      game: expect.objectContaining({
        _id: 'next-game',
        isActive: true,
      }),
      affectedUsers: ['user-1', 'user-2'],
      currentGameNumber: 2,
      tournamentId: 'tournament-1',
      tournamentPhase: 'elimination',
      requiresAccept: true,
      acceptWindowSeconds: 30,
    }));
  });

  test('elimination follow-up games do not require accept after the series has started', async () => {
    requireGamePlayerContext.mockResolvedValue({
      game: {
        _id: 'finished-game-2',
        match: 'match-2',
        playersNext: [false, false],
      },
      color: 0,
    });

    Game.findByIdAndUpdate
      .mockReturnValueOnce({
        lean: jest.fn(async () => ({
          _id: 'finished-game-2',
          match: 'match-2',
          players: ['user-a', 'user-b'],
          playersNext: [true, true],
        })),
      });

    const nextGame = {
      _id: 'next-game-2',
      isActive: true,
      players: ['user-a', 'user-b'],
      toObject() {
        return {
          _id: 'next-game-2',
          isActive: true,
          players: ['user-a', 'user-b'],
        };
      },
    };

    Match.findById.mockReturnValue({
      populate: jest.fn(async () => ({
        _id: 'match-2',
        type: 'TOURNAMENT_ELIMINATION',
        tournamentId: 'tournament-2',
        tournamentPhase: 'elimination',
        player1Score: 1,
        player2Score: 0,
        drawCount: 0,
        games: [
          { _id: 'finished-game-2', isActive: false, players: ['user-a', 'user-b'] },
          nextGame,
        ],
      })),
    });

    const response = await callPost(handler, {
      gameId: 'finished-game-2',
      color: 0,
    });

    expect(response.statusCode).toBe(200);
    expect(eventBus.emit).toHaveBeenCalledWith('players:bothNext', expect.objectContaining({
      game: expect.objectContaining({
        _id: 'next-game-2',
      }),
      currentGameNumber: 2,
      requiresAccept: false,
      acceptWindowSeconds: 0,
    }));
  });

  test('tournament final games do not emit players:bothNext when the match is over', async () => {
    requireGamePlayerContext.mockResolvedValue({
      game: {
        _id: 'finished-tournament-final',
        match: 'match-final',
        playersNext: [false, false],
      },
      color: 0,
    });

    Game.findByIdAndUpdate.mockReturnValueOnce({
      lean: jest.fn(async () => ({
        _id: 'finished-tournament-final',
        match: 'match-final',
        players: ['user-a', 'user-b'],
        playersNext: [true, true],
      })),
    });

    Match.findById.mockReturnValue({
      populate: jest.fn(async () => ({
        _id: 'match-final',
        type: 'TOURNAMENT_ELIMINATION',
        tournamentId: 'tournament-final',
        tournamentPhase: 'elimination',
        winner: 'user-a',
        isActive: false,
        games: [
          { _id: 'finished-tournament-final', isActive: false, players: ['user-a', 'user-b'] },
        ],
      })),
    });

    const response = await callPost(handler, {
      gameId: 'finished-tournament-final',
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
