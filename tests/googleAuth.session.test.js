jest.mock('../src/models/User', () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
  exists: jest.fn(),
  create: jest.fn(),
}));

jest.mock('../src/utils/ensureUser', () => jest.fn());
jest.mock('mongoose', () => ({
  connection: {
    readyState: 1,
  },
}));
jest.mock('../src/utils/authTokens', () => ({
  createAuthToken: jest.fn(() => 'dev-token'),
  TOKEN_COOKIE_NAME: 'cgToken',
  extractTokenFromRequest: jest.fn(() => null),
  resolveUserFromToken: jest.fn(() => null),
  parseCookies: jest.requireActual('../src/utils/authTokens').parseCookies,
}));

const User = require('../src/models/User');
const ensureUser = require('../src/utils/ensureUser');
const mongoose = require('mongoose');
const authRouter = require('../src/routes/auth/google');

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

function callGet(handler, headers = {}) {
  return new Promise((resolve) => {
    const req = {
      headers,
      protocol: 'http',
      get(name) {
        return headers[name.toLowerCase()];
      },
    };
    const res = {
      statusCode: 200,
      cookies: [],
      set() {
        return this;
      },
      cookie(name, value, options) {
        this.cookies.push({ name, value, options });
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload, cookies: this.cookies });
        return this;
      },
    };
    handler(req, res, () => resolve({ statusCode: 200, payload: {}, cookies: res.cookies }));
  });
}

describe('google auth session route', () => {
  const sessionHandler = extractGetHandler(authRouter, '/session');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
    mongoose.connection.readyState = 1;
  });

  test('re-mints an authenticated local session from a real user cookie in development', async () => {
    User.findById.mockResolvedValue({
      _id: 'user-123',
      username: 'Murelious',
      email: 'm@example.com',
      isGuest: false,
      photoUrl: '/profile.png',
    });
    ensureUser.mockResolvedValue({
      userId: 'guest-1',
      username: 'Anonymous1',
      isGuest: true,
    });

    const response = await callGet(sessionHandler, {
      cookie: 'userId=user-123; username=Murelious',
      host: 'localhost:3000',
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      userId: 'user-123',
      username: 'Murelious',
      isGuest: false,
      authenticated: true,
    });
    expect(response.cookies.some((cookie) => cookie.name === 'cgToken' && cookie.value === 'dev-token')).toBe(true);
  });

  test('repairs a damaged local real user and re-mints an authenticated session', async () => {
    const damagedUser = {
      _id: 'user-123',
      username: 'Murelious',
      email: 'm@example.com',
      isGuest: true,
      photoUrl: '/profile.png',
      save: jest.fn(async function save() {
        return this;
      }),
    };
    User.findById.mockResolvedValue(damagedUser);
    ensureUser.mockResolvedValue({
      userId: 'guest-1',
      username: 'Anonymous1',
      isGuest: true,
    });

    const response = await callGet(sessionHandler, {
      cookie: 'userId=user-123; username=Murelious',
      host: 'localhost:3000',
    });

    expect(damagedUser.isGuest).toBe(false);
    expect(damagedUser.save).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      userId: 'user-123',
      username: 'Murelious',
      isGuest: false,
      authenticated: true,
    });
    expect(response.cookies.some((cookie) => cookie.name === 'cgToken' && cookie.value === 'dev-token')).toBe(true);
  });
});
