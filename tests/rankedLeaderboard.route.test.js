jest.mock('../src/models/Match', () => ({
  find: jest.fn(),
}));

jest.mock('../src/models/User', () => ({
  find: jest.fn(),
}));

const Match = require('../src/models/Match');
const User = require('../src/models/User');
const rankedLeaderboardRouter = require('../src/routes/v1/users/getRankedLeaderboard');

function extractGetHandler(router, routePath) {
  const layer = router.stack.find((entry) => (
    entry
    && entry.route
    && entry.route.path === routePath
    && entry.route.methods
    && entry.route.methods.get
    && Array.isArray(entry.route.stack)
    && entry.route.stack.length
  ));
  if (!layer) {
    throw new Error(`GET handler not found for ${routePath}`);
  }
  return layer.route.stack[0].handle;
}

function createLeanChain(value) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
  };
}

function callGet(handler) {
  return new Promise((resolve) => {
    const req = {};
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
    handler(req, res);
  });
}

describe('ranked leaderboard route', () => {
  const handler = extractGetHandler(rankedLeaderboardRouter, '/');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns non-bot, non-guest ranked players sorted by elo descending', async () => {
    Match.find
      .mockReturnValueOnce(createLeanChain([
        { player1: 'u1', player2: 'u2' },
        { player1: 'u3', player2: 'u1' },
      ]))
      .mockReturnValueOnce(createLeanChain([
        { player1: 'u4', player2: 'u2' },
      ]));

    User.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: 'u1', username: 'Bravo', elo: 1100, isBot: false, isGuest: false },
          { _id: 'u2', username: 'Alpha', elo: 1250, isBot: false, isGuest: false },
          { _id: 'u3', username: 'Botty', elo: 1400, isBot: true, isGuest: false },
          { _id: 'u4', username: 'Guesty', elo: 1300, isBot: false, isGuest: true },
        ]),
      }),
    });

    const response = await callGet(handler);

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual([
      { userId: 'u2', username: 'Alpha', elo: 1250 },
      { userId: 'u1', username: 'Bravo', elo: 1100 },
    ]);
    expect(Match.find).toHaveBeenNthCalledWith(1, { type: 'RANKED' });
    expect(Match.find).toHaveBeenNthCalledWith(2, { type: 'RANKED', isActive: false });
    expect(User.find).toHaveBeenCalledWith({ _id: { $in: ['u1', 'u2', 'u3', 'u4'] } });
  });
});
