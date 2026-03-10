jest.mock('../src/models/User', () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
}));

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

function createUserQueryChain(value) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function callGet(handler, req = {}) {
  return new Promise((resolve) => {
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

  test('returns legacy array payload when pagination params are absent', async () => {
    const legacyQuery = createUserQueryChain([
      { _id: 'u2', username: 'Alpha', elo: 1250 },
      { _id: 'u1', username: 'Bravo', elo: 1100 },
      { _id: 'u5', username: 'Fallback', elo: 'not-a-number' },
    ]);

    User.find.mockReturnValueOnce(legacyQuery);

    const response = await callGet(handler, { query: {} });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual([
      { userId: 'u2', username: 'Alpha', elo: 1250 },
      { userId: 'u1', username: 'Bravo', elo: 1100 },
      { userId: 'u5', username: 'Fallback', elo: 800 },
    ]);
    expect(User.countDocuments).not.toHaveBeenCalled();
    expect(User.find).toHaveBeenCalledWith({
      isBot: { $ne: true },
      isGuest: { $ne: true },
      elo: { $exists: true, $ne: null },
    });
    expect(legacyQuery.select).toHaveBeenCalledWith('_id username elo');
  });

  test('returns non-bot, non-guest users with elo in leaderboard order', async () => {
    const pageQuery = createUserQueryChain([
      { _id: 'u2', username: 'Alpha', elo: 1250 },
      { _id: 'u1', username: 'Bravo', elo: 1100 },
      { _id: 'u5', username: 'Fallback', elo: 'not-a-number' },
    ]);

    User.countDocuments.mockResolvedValue(3);
    User.find.mockReturnValueOnce(pageQuery);

    const response = await callGet(handler, { query: { page: '1' } });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({
      items: [
        { userId: 'u2', username: 'Alpha', elo: 1250 },
        { userId: 'u1', username: 'Bravo', elo: 1100 },
        { userId: 'u5', username: 'Fallback', elo: 800 },
      ],
      pagination: {
        page: 1,
        perPage: 100,
        totalItems: 3,
        totalPages: 1,
      },
      currentUser: null,
    });
    expect(User.countDocuments).toHaveBeenCalledWith({
      isBot: { $ne: true },
      isGuest: { $ne: true },
      elo: { $exists: true, $ne: null },
    });
    expect(User.find).toHaveBeenCalledWith({
      isBot: { $ne: true },
      isGuest: { $ne: true },
      elo: { $exists: true, $ne: null },
    });
    expect(pageQuery.skip).toHaveBeenCalledWith(0);
    expect(pageQuery.limit).toHaveBeenCalledWith(100);
    expect(pageQuery.select).toHaveBeenCalledWith('_id username elo');
  });

  test('returns requested page and current user placement metadata', async () => {
    const pageTwoQuery = createUserQueryChain([
      { _id: 'u101', username: 'Player 101', elo: 900 },
      { _id: 'u155', username: 'Player 155', elo: 845 },
    ]);
    const placementQuery = createUserQueryChain(
      Array.from({ length: 205 }, (_, index) => ({ _id: `u${index + 1}` }))
    );

    User.countDocuments.mockResolvedValue(205);
    User.find
      .mockReturnValueOnce(pageTwoQuery)
      .mockReturnValueOnce(placementQuery);

    const response = await callGet(handler, {
      query: {
        page: '2',
        userId: 'u155',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload.pagination).toEqual({
      page: 2,
      perPage: 100,
      totalItems: 205,
      totalPages: 3,
    });
    expect(response.payload.currentUser).toEqual({
      userId: 'u155',
      rank: 155,
      page: 2,
    });
    expect(pageTwoQuery.skip).toHaveBeenCalledWith(100);
    expect(pageTwoQuery.limit).toHaveBeenCalledWith(100);
    expect(placementQuery.select).toHaveBeenCalledWith('_id');
  });
});
