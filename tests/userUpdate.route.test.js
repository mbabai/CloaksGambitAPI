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
      animationSpeed: 'slow',
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
      animationSpeed: 'slow',
    });
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(applyAuthenticatedCookies).not.toHaveBeenCalled();
  });

  test('marks username setup complete when the authenticated user saves a username', async () => {
    User.findOne.mockResolvedValue(null);
    User.findByIdAndUpdate.mockResolvedValue({
      _id: '507f191e810c19729de860ea',
      username: 'NewName',
      elo: 880,
      isBot: false,
      isGuest: false,
      hasUpdatedUsername: true,
      tooltipsEnabled: true,
      toastNotificationsEnabled: true,
      animationSpeed: 'slow',
      email: 'c@example.com',
    });

    const response = await callPatch(handler, { username: ' NewName ' });

    expect(response.statusCode).toBe(200);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      '507f191e810c19729de860ea',
      { username: 'NewName', hasUpdatedUsername: true },
      { new: true }
    );
    expect(response.payload).toMatchObject({
      username: 'NewName',
      hasUpdatedUsername: true,
    });
    expect(eventBus.emit).toHaveBeenCalledWith('user:updated', {
      userId: '507f191e810c19729de860ea',
      username: 'NewName',
    });
    expect(applyAuthenticatedCookies).toHaveBeenCalledTimes(1);
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
      animationSpeed: 'slow',
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

  test('updates animation speed preference', async () => {
    User.findByIdAndUpdate.mockResolvedValue({
      _id: '507f191e810c19729de860ea',
      username: 'Chateau',
      elo: 880,
      isBot: false,
      isGuest: false,
      tooltipsEnabled: true,
      toastNotificationsEnabled: true,
      animationSpeed: 'fast',
      email: 'c@example.com',
    });

    const response = await callPatch(handler, {
      animationSpeed: 'Fast',
    });

    expect(response.statusCode).toBe(200);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      '507f191e810c19729de860ea',
      { animationSpeed: 'fast' },
      { new: true }
    );
    expect(response.payload).toMatchObject({
      animationSpeed: 'fast',
    });
  });

  test('updates audio volume preference', async () => {
    User.findByIdAndUpdate.mockResolvedValue({
      _id: '507f191e810c19729de860ea',
      username: 'Chateau',
      elo: 880,
      isBot: false,
      isGuest: false,
      tooltipsEnabled: true,
      toastNotificationsEnabled: true,
      animationSpeed: 'slow',
      audioVolume: 0.35,
      gameStartAlertVolume: 0.65,
      email: 'c@example.com',
    });

    const response = await callPatch(handler, {
      audioVolume: '0.35',
      gameStartAlertVolume: '0.65',
    });

    expect(response.statusCode).toBe(200);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      '507f191e810c19729de860ea',
      { audioVolume: 0.35, gameStartAlertVolume: 0.65 },
      { new: true }
    );
    expect(response.payload).toMatchObject({
      audioVolume: 0.35,
      gameStartAlertVolume: 0.65,
    });
  });

  test('rejects invalid audio volume preference input', async () => {
    const response = await callPatch(handler, { audioVolume: 1.5 });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'audioVolume must be a number between 0 and 1' });
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects invalid game start alert volume preference input', async () => {
    const response = await callPatch(handler, { gameStartAlertVolume: 1.5 });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'gameStartAlertVolume must be a number between 0 and 1' });
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects invalid animation speed preference input', async () => {
    const response = await callPatch(handler, { animationSpeed: 'medium' });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'animationSpeed must be one of off, fast, slow' });
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
