const mockUser = {
  find: jest.fn(),
  deleteMany: jest.fn(),
};

const mockGame = {
  find: jest.fn(),
};

const mockMatch = {
  find: jest.fn(),
};

const mockAdminErrorFeed = {
  reportServerError: jest.fn(),
};

jest.mock('mongoose', () => ({
  connection: {
    readyState: 0,
  },
}));

jest.mock('../src/models/User', () => mockUser);
jest.mock('../src/models/Game', () => mockGame);
jest.mock('../src/models/Match', () => mockMatch);
jest.mock('../src/services/adminErrorFeed', () => mockAdminErrorFeed);

const mongoose = require('mongoose');
const { removeStaleGuests } = require('../src/services/guestCleanup');

describe('guest cleanup', () => {
  let warnSpy;
  let errorSpy;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    mongoose.connection.readyState = 0;
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  test('skips guest cleanup when MongoDB is not connected', async () => {
    await removeStaleGuests();

    expect(mockUser.find).not.toHaveBeenCalled();
    expect(mockUser.deleteMany).not.toHaveBeenCalled();
    expect(mockAdminErrorFeed.reportServerError).toHaveBeenCalledWith(expect.objectContaining({
      source: 'guestCleanup',
      code: 'mongo_unavailable',
      level: 'warn',
    }));
  });

  test('does not delete stale guests when the protected-history lookup fails', async () => {
    mongoose.connection.readyState = 1;
    const userQuery = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: 'guest-1' }]),
    };
    mockUser.find.mockReturnValue(userQuery);
    mockGame.find.mockReturnValue(Promise.reject(new Error('history lookup failed')));
    mockMatch.find.mockReturnValue(Promise.resolve([]));

    await removeStaleGuests();

    expect(mockUser.deleteMany).not.toHaveBeenCalled();
    expect(mockAdminErrorFeed.reportServerError).toHaveBeenCalledWith(expect.objectContaining({
      source: 'guestCleanup',
      code: 'guest_cleanup_failed',
      level: 'error',
      message: 'history lookup failed',
    }));
  });
});
