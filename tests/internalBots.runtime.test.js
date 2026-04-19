describe('internal bot runtime', () => {
  const originalJestWorkerId = process.env.JEST_WORKER_ID;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.DISABLE_INTERNAL_BOTS;
    process.env.NODE_ENV = 'development';
    process.env.BOT_DIFFICULTIES = 'easy';
    process.env.BOT_SERVER_URL = 'http://127.0.0.1:3100';
    delete process.env.JEST_WORKER_ID;
  });

  afterEach(() => {
    delete process.env.BOT_DIFFICULTIES;
    delete process.env.BOT_SERVER_URL;
    if (originalJestWorkerId === undefined) {
      delete process.env.JEST_WORKER_ID;
    } else {
      process.env.JEST_WORKER_ID = originalJestWorkerId;
    }
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('reuses and reconnects the shared difficulty client for the same bot user', async () => {
    const connect = jest.fn();
    const easyClient = {
      userId: 'easy-user',
      socket: {
        connected: false,
        connect,
      },
    };
    const startBotClient = jest.fn(async () => easyClient);

    jest.doMock('../shared/bots', () => ({
      startBotClient,
    }));
    jest.doMock('../src/models/User', () => ({
      findById: jest.fn(async () => null),
    }));
    jest.doMock('../src/utils/authTokens', () => ({
      createAuthToken: jest.fn(() => 'bot-token'),
    }));

    const {
      startInternalBots,
      ensureInternalBotClient,
    } = require('../src/services/bots/internalBots');

    await startInternalBots({ port: 3100 });
    const resolved = await ensureInternalBotClient({
      difficulty: 'easy',
      userId: 'easy-user',
    });

    expect(resolved).toBe(easyClient);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(startBotClient).toHaveBeenCalledTimes(1);
  });
});
