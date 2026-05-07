jest.mock('../src/models/User', () => ({
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));

jest.mock('../src/eventBus', () => ({
  emit: jest.fn(),
}));

jest.mock('../src/utils/adminAccess', () => ({
  isAdminSession: jest.fn(() => false),
}));

jest.mock('../src/utils/requestSession', () => ({
  applyAuthenticatedCookies: jest.fn(),
  resolveSessionFromRequest: jest.fn(),
}));

const User = require('../src/models/User');
const eventBus = require('../src/eventBus');
const { applyAuthenticatedCookies, resolveSessionFromRequest } = require('../src/utils/requestSession');
const userUpdateRouter = require('../src/routes/v1/users/update');

function extractPatchHandler(router) {
  const layer = router.stack.find((entry) => (
    entry
    && entry.route
    && entry.route.path === '/'
    && entry.route.methods
    && entry.route.methods.patch
    && Array.isArray(entry.route.stack)
    && entry.route.stack.length
  ));
  if (!layer) {
    throw new Error('PATCH handler not found');
  }
  return layer.route.stack[0].handle;
}

function callPatch(handler, body = {}) {
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

describe('users/update route preferences', () => {
  const handler = extractPatchHandler(userUpdateRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    resolveSessionFromRequest.mockResolvedValue({
      userId: '507f191e810c19729de860ea',
      isGuest: false,
      authenticated: true,
    });
  });

  test('updates the authenticated user tooltip preference', async () => {
    User.findByIdAndUpdate.mockResolvedValue({
      _id: '507f191e810c19729de860ea',
      username: 'Chateau',
      elo: 880,
      isBot: false,
      isGuest: false,
      tooltipsEnabled: false,
      toastNotificationsEnabled: true,
      email: 'c@example.com',
    });

    const response = await callPatch(handler, { tooltipsEnabled: false });

    expect(response.statusCode).toBe(200);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      '507f191e810c19729de860ea',
      { tooltipsEnabled: false },
      { new: true }
    );
    expect(response.payload).toMatchObject({
      username: 'Chateau',
      tooltipsEnabled: false,
      toastNotificationsEnabled: true,
    });
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(applyAuthenticatedCookies).not.toHaveBeenCalled();
  });

  test('rejects non-boolean tooltip preference input', async () => {
    const response = await callPatch(handler, { tooltipsEnabled: 'sometimes' });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'tooltipsEnabled must be a boolean' });
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('updates toast notification preference', async () => {
    User.findByIdAndUpdate.mockResolvedValue({
      _id: '507f191e810c19729de860ea',
      username: 'Chateau',
      elo: 880,
      isBot: false,
      isGuest: false,
      tooltipsEnabled: true,
      toastNotificationsEnabled: false,
      email: 'c@example.com',
    });

    const response = await callPatch(handler, {
      toastNotificationsEnabled: false,
    });

    expect(response.statusCode).toBe(200);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      '507f191e810c19729de860ea',
      { toastNotificationsEnabled: false },
      { new: true }
    );
    expect(response.payload).toMatchObject({
      toastNotificationsEnabled: false,
    });
  });
});
