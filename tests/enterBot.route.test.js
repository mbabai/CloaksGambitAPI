const express = require('express');
const request = require('supertest');

const mockRuntime = {
  startPromotedBotGame: jest.fn(),
};

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

jest.mock('../src/utils/mlFeatureGate', () => ({
  isMlWorkflowEnabled: jest.fn(() => true),
}));

jest.mock('../src/services/ml/runtime', () => ({
  getMlRuntime: jest.fn(() => mockRuntime),
}));

const { resolveLobbySession } = require('../src/utils/lobbyAccess');
const { ensureGuestForBotGame } = require('../src/services/bots/registry');
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
    mockRuntime.startPromotedBotGame.mockResolvedValue({
      status: 'matched',
      userId: 'human-1',
      username: 'GuestOne',
      matchId: 'match-9',
      gameId: 'game-9',
      botId: 'generation:run-1:4',
    });
  });

  test('delegates promoted-model selections to the ML runtime', async () => {
    const response = await request(createApp())
      .post('/api/v1/lobby/enterBot')
      .send({ botId: 'generation:run-1:4' });

    expect(response.status).toBe(200);
    expect(mockRuntime.startPromotedBotGame).toHaveBeenCalledWith({
      botId: 'generation:run-1:4',
      userId: 'human-1',
      username: 'GuestOne',
      sidePreference: 'random',
    });
    expect(response.body.gameId).toBe('game-9');
  });
});
