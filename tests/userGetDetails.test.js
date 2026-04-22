jest.mock('../src/models/User', () => ({
  findById: jest.fn(),
}));

jest.mock('../src/utils/requestSession', () => ({
  resolveSessionFromRequest: jest.fn(),
}));

jest.mock('../src/utils/adminAccess', () => ({
  isAdminSession: jest.fn(() => false),
}));

const User = require('../src/models/User');
const { resolveSessionFromRequest } = require('../src/utils/requestSession');
const userGetDetailsRouter = require('../src/routes/v1/users/getDetails');

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
    throw new Error('POST handler not found');
  }
  return layer.route.stack[0].handle;
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
    handler(req, res, () => resolve({ statusCode: 200, payload: {} }));
  });
}

describe('users/getDetails route', () => {
  const handler = extractPostHandler(userGetDetailsRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    resolveSessionFromRequest.mockResolvedValue(null);
  });

  test('rejects invalid user ids as a client error', async () => {
    const response = await callPost(handler, { userId: 'not-a-valid-id' });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Invalid userId' });
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('returns a safe placeholder when the user record no longer exists', async () => {
    const userId = '507f191e810c19729de860ea';
    User.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const response = await callPost(handler, { userId });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({
      _id: userId,
      userId,
      username: 'Unavailable Player',
      elo: 800,
      isBot: false,
      isGuest: true,
      photoUrl: '',
      missing: true,
    });
  });

  test('defaults missing elo values to 800 for existing users', async () => {
    const userId = '507f191e810c19729de860ea';
    User.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: userId,
        username: 'Chateau',
        elo: undefined,
        isBot: false,
        isGuest: false,
        photoUrl: '',
      }),
    });

    const response = await callPost(handler, { userId });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      userId,
      username: 'Chateau',
      elo: 800,
      isBot: false,
      isGuest: false,
      tooltipsEnabled: true,
    });
  });

  test('returns stored tooltip preference when present', async () => {
    const userId = '507f191e810c19729de860ea';
    User.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: userId,
        username: 'Chateau',
        elo: 920,
        isBot: false,
        isGuest: false,
        tooltipsEnabled: false,
        photoUrl: '',
      }),
    });

    const response = await callPost(handler, { userId });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      userId,
      username: 'Chateau',
      tooltipsEnabled: false,
    });
  });
});
