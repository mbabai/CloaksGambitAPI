const { BotClient } = require('../shared/bots/client');

describe('BotClient match continuation', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
  });

  afterEach(() => {
    delete global.fetch;
    jest.restoreAllMocks();
  });

  test('queues next when a finished game belongs to an active match', async () => {
    const client = new BotClient('http://127.0.0.1:3100', 'bot-token', 'bot-user', 'medium');
    client.games.set('game-1:0', { color: 0 });

    await client.handleGameFinished({
      gameId: 'game-1',
      matchIsActive: true,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3100/api/v1/gameAction/next',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer bot-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          gameId: 'game-1',
          color: 0,
        }),
      }),
    );
    expect(client.games.size).toBe(0);
  });

  test('accepts the next game when both players advance', async () => {
    const client = new BotClient('http://127.0.0.1:3100', 'bot-token', 'bot-user', 'medium');

    await client.handleBothNext({
      gameId: 'game-2',
      color: 1,
      requiresAccept: true,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3100/api/v1/gameAction/ready',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer bot-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          gameId: 'game-2',
          color: 1,
        }),
      }),
    );
  });
});
