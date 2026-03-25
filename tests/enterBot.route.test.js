const express = require('express');
const request = require('supertest');

jest.mock('../src/utils/lobbyAccess', () => ({
  resolveLobbySession: jest.fn(),
}));

jest.mock('../src/services/bots/registry', () => ({
  ensureGuestForBotGame: jest.fn(),
  ensureBotUser: jest.fn(),
  normalizeDifficulty: jest.fn((value) => (typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'easy')),
  normalizeBuiltinBotId: jest.fn(() => ''),
  getBuiltinBotDefinition: jest.fn(() => null),
}));

const { resolveLobbySession } = require('../src/utils/lobbyAccess');
const { ensureGuestForBotGame, ensureBotUser } = require('../src/services/bots/registry');
const enterBotRouter = require('../src/routes/v1/lobby/enterBot');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/lobby/enterBot', enterBotRouter);
  return app;
}

describe('enter bot route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveLobbySession.mockResolvedValue({ userId: 'human-1' });
    ensureGuestForBotGame.mockResolvedValue({ userId: 'human-1', username: 'GuestOne' });
    ensureBotUser.mockResolvedValue({
      user: {
        _id: 'bot-1',
        username: 'EasyBot',
      },
    });
  });

  test('rejects unknown bot selections', async () => {
    const response = await request(createApp())
      .post('/api/v1/lobby/enterBot')
      .send({ botId: 'unknown-bot' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Selected bot is not available.' });
    expect(ensureBotUser).not.toHaveBeenCalled();
  });
});
