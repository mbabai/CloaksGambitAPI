jest.mock('../src/models/User', () => ({
  findOne: jest.fn(),
}));

const User = require('../src/models/User');
const findByUsernameRouter = require('../src/routes/v1/users/findByUsername');

function extractPostHandler(router, routePath) {
  const layer = router.stack.find((entry) => (
    entry
    && entry.route
    && entry.route.path === routePath
    && entry.route.methods
    && entry.route.methods.post
    && Array.isArray(entry.route.stack)
    && entry.route.stack.length
  ));
  if (!layer) {
    throw new Error(`POST handler not found for ${routePath}`);
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

function callPost(handler, body = {}) {
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
    handler(req, res);
  });
}

describe('findByUsername route', () => {
  const handler = extractPostHandler(findByUsernameRouter, '/');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns a non-bot user with case-insensitive username lookup', async () => {
    User.findOne.mockReturnValue(createLeanChain({
      _id: 'u1',
      username: 'AlphaWolf',
      elo: 1234,
      isBot: false,
    }));

    const response = await callPost(handler, { username: '  alphawolf  ' });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({
      userId: 'u1',
      username: 'AlphaWolf',
      elo: 1234,
      isBot: false,
    });
    expect(User.findOne).toHaveBeenCalledTimes(1);
    const query = User.findOne.mock.calls[0][0];
    expect(query.username).toBeInstanceOf(RegExp);
    expect(query.username.test('AlphaWolf')).toBe(true);
    expect(query.username.test('alphawolf')).toBe(true);
    expect(query.username.test('alphawolfx')).toBe(false);
  });

  test('returns 404 when the user is missing or is a bot', async () => {
    User.findOne
      .mockReturnValueOnce(createLeanChain(null))
      .mockReturnValueOnce(createLeanChain({
        _id: 'u2',
        username: 'Botty',
        elo: 1600,
        isBot: true,
      }));

    const missing = await callPost(handler, { username: 'Nobody' });
    const bot = await callPost(handler, { username: 'Botty' });

    expect(missing.statusCode).toBe(404);
    expect(missing.payload).toEqual({ message: 'User not found' });
    expect(bot.statusCode).toBe(404);
    expect(bot.payload).toEqual({ message: 'User not found' });
  });
});
