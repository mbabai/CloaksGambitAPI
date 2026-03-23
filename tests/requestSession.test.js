jest.mock('../src/models/User', () => ({
  findById: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('mongoose', () => ({
  connection: {
    readyState: 1,
  },
}));

jest.mock('../src/utils/ensureUser', () => jest.fn());
jest.mock('../src/utils/authTokens', () => ({
  createAuthToken: jest.fn(() => 'dev-token'),
  TOKEN_COOKIE_NAME: 'cgToken',
  extractTokenFromRequest: jest.fn(() => null),
  resolveUserFromToken: jest.fn(() => null),
  parseCookies: jest.requireActual('../src/utils/authTokens').parseCookies,
}));

const User = require('../src/models/User');
const ensureUser = require('../src/utils/ensureUser');
const {
  extractTokenFromRequest,
  resolveUserFromToken,
} = require('../src/utils/authTokens');
const mongoose = require('mongoose');
const { resolveSessionFromRequest } = require('../src/utils/requestSession');

describe('requestSession helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
    mongoose.connection.readyState = 1;
    extractTokenFromRequest.mockReturnValue(null);
    resolveUserFromToken.mockResolvedValue(null);
    User.findById.mockResolvedValue(null);
  });

  test('reuses a guest session from the userId cookie instead of trusting a body value', async () => {
    ensureUser.mockResolvedValue({
      userId: 'guest-7',
      username: 'Anonymous7',
      isGuest: true,
    });

    const session = await resolveSessionFromRequest({
      headers: {
        cookie: 'userId=guest-7; username=Anonymous7',
      },
    }, { createGuest: false });

    expect(ensureUser).toHaveBeenCalledWith('guest-7');
    expect(session).toMatchObject({
      type: 'guest',
      userId: 'guest-7',
      username: 'Anonymous7',
      isGuest: true,
      authenticated: false,
    });
  });

  test('returns null when no request-backed session exists and guest creation is disabled', async () => {
    const session = await resolveSessionFromRequest({
      headers: {},
    }, { createGuest: false });

    expect(session).toBeNull();
    expect(ensureUser).not.toHaveBeenCalled();
  });

  test('skips cookie session resolution while mongo is disconnected', async () => {
    mongoose.connection.readyState = 0;

    const session = await resolveSessionFromRequest({
      headers: {
        cookie: 'userId=guest-7; username=Anonymous7',
      },
    }, { createGuest: false });

    expect(session).toBeNull();
    expect(User.findById).not.toHaveBeenCalled();
    expect(ensureUser).not.toHaveBeenCalled();
  });

  test('skips token session resolution while mongo is disconnected', async () => {
    mongoose.connection.readyState = 0;
    extractTokenFromRequest.mockReturnValue('signed-token');

    const session = await resolveSessionFromRequest({
      headers: {
        authorization: 'Bearer signed-token',
      },
    }, { createGuest: false });

    expect(session).toBeNull();
    expect(resolveUserFromToken).not.toHaveBeenCalled();
  });
});
