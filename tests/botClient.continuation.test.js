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

  test('hydrates live games from initialState-style payloads that only expose _id', async () => {
    const client = new BotClient('http://127.0.0.1:3100', 'bot-token', 'bot-user', 'medium');
    const controllerHandleUpdate = jest.fn().mockResolvedValue(undefined);

    class FakeController {
      constructor(serverUrl, gameId, userId, token, socket, forcedColor) {
        this.serverUrl = serverUrl;
        this.gameId = gameId;
        this.userId = userId;
        this.token = token;
        this.socket = socket;
        this.color = forcedColor;
      }

      handleUpdate(payload) {
        return controllerHandleUpdate(payload);
      }
    }

    client.ControllerClass = FakeController;
    client.socket = {};

    client.handleUpdate({
      _id: 'game-3',
      match: 'match-3',
      players: ['bot-user', 'human-user'],
      playerTurn: 0,
    });

    expect(client.games.has('game-3:0')).toBe(true);
    expect(controllerHandleUpdate).toHaveBeenCalledWith(expect.objectContaining({
      gameId: 'game-3',
      matchId: 'match-3',
      players: ['bot-user', 'human-user'],
      playerTurn: 0,
    }));
  });
});
