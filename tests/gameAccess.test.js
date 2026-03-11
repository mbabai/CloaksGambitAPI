jest.mock('../src/models/Game', () => ({
  findById: jest.fn(),
}));

jest.mock('../src/models/User', () => ({
  findById: jest.fn(),
}));

jest.mock('../src/utils/requestSession', () => ({
  resolveSessionFromRequest: jest.fn(),
}));

jest.mock('../src/utils/adminAccess', () => ({
  isAdminSession: jest.fn(() => false),
}));

const Game = require('../src/models/Game');
const User = require('../src/models/User');
const { resolveSessionFromRequest } = require('../src/utils/requestSession');
const { requireGamePlayerContext } = require('../src/utils/gameAccess');

function createResponseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

describe('gameAccess helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects requests whose claimed color does not match the session player slot', async () => {
    resolveSessionFromRequest.mockResolvedValue({
      userId: 'black-player',
      username: 'BlackPlayer',
      isGuest: true,
      authenticated: false,
    });
    Game.findById.mockResolvedValue({
      _id: 'game-1',
      players: ['white-player', 'black-player'],
    });

    const res = createResponseRecorder();
    const context = await requireGamePlayerContext({}, res, {
      gameId: 'game-1',
      color: 0,
    });

    expect(context).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual({ message: 'Player color does not match session' });
  });

  test('derives the acting color from the resolved session when it matches a player', async () => {
    resolveSessionFromRequest.mockResolvedValue({
      userId: 'black-player',
      username: 'BlackPlayer',
      isGuest: true,
      authenticated: false,
    });
    Game.findById.mockResolvedValue({
      _id: 'game-1',
      players: ['white-player', 'black-player'],
    });
    User.findById.mockResolvedValue({
      _id: 'black-player',
      username: 'BlackPlayer',
      isBot: false,
      isGuest: true,
    });

    const res = createResponseRecorder();
    const context = await requireGamePlayerContext({}, res, {
      gameId: 'game-1',
      color: 1,
    });

    expect(res.statusCode).toBe(200);
    expect(context).toMatchObject({
      color: 1,
      requesterDetails: {
        userId: 'black-player',
        username: 'BlackPlayer',
        isBot: false,
      },
    });
  });
});
