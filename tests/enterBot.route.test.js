const express = require('express');
const request = require('supertest');

jest.mock('../src/utils/lobbyAccess', () => ({
  resolveLobbySession: jest.fn(),
}));

jest.mock('../src/models/Match', () => ({
  create: jest.fn(),
}));

jest.mock('../src/models/Game', () => ({
  create: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../src/eventBus', () => ({
  emit: jest.fn(),
}));

jest.mock('../src/state/lobby', () => ({
  isInGame: jest.fn(() => false),
  isInAnyQueue: jest.fn(() => false),
  removeFromAllQueues: jest.fn(),
  emitQueueChanged: jest.fn(),
  addInGame: jest.fn(),
}));

jest.mock('../src/utils/getServerConfig', () => jest.fn());

jest.mock('../src/services/bots/registry', () => ({
  ensureGuestForBotGame: jest.fn(),
  ensureBotUser: jest.fn(),
  normalizeDifficulty: jest.fn((value) => (typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'easy')),
  normalizeBuiltinBotId: jest.fn((value) => (typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'easy')),
  getBuiltinBotDefinition: jest.fn(() => null),
}));

const Match = require('../src/models/Match');
const Game = require('../src/models/Game');
const eventBus = require('../src/eventBus');
const getServerConfig = require('../src/utils/getServerConfig');
const { resolveLobbySession } = require('../src/utils/lobbyAccess');
const {
  ensureGuestForBotGame,
  ensureBotUser,
  getBuiltinBotDefinition,
} = require('../src/services/bots/registry');
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
    getServerConfig.mockResolvedValue({
      gameModes: {
        AI: 'AI',
      },
      gameModeSettings: {
        QUICKPLAY: {
          TIME_CONTROL: 420000,
        },
        INCREMENT: 4000,
      },
    });
    Match.create.mockResolvedValue({
      _id: 'match-1',
      games: [],
      save: jest.fn(async () => {}),
    });
    Game.create.mockResolvedValue({
      _id: 'game-1',
      players: ['human-1', 'bot-1'],
      toObject() {
        return {
          _id: this._id,
          players: this.players,
        };
      },
    });
    Game.updateOne.mockResolvedValue({ acknowledged: true });
  });

  test('rejects unknown bot selections', async () => {
    const response = await request(createApp())
      .post('/api/v1/lobby/enterBot')
      .send({ botId: 'unknown-bot' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Selected bot is not available.' });
    expect(ensureBotUser).not.toHaveBeenCalled();
  });

  test('creates bot matches with the quickplay clock and AI match type', async () => {
    getBuiltinBotDefinition.mockReturnValue({
      id: 'easy',
      playable: true,
    });

    const response = await request(createApp())
      .post('/api/v1/lobby/enterBot')
      .send({ botId: 'easy' });

    expect(response.status).toBe(200);
    expect(Match.create).toHaveBeenCalledWith(expect.objectContaining({
      player1: 'human-1',
      player2: 'bot-1',
      type: 'AI',
    }));
    expect(Game.create).toHaveBeenCalledWith(expect.objectContaining({
      match: 'match-1',
      timeControlStart: 420000,
      increment: 4000,
    }));
    expect(Game.updateOne).toHaveBeenCalledWith(
      { _id: 'game-1', playersReady: { $exists: false } },
      { $set: { playersReady: [false, false] } },
    );
    expect(eventBus.emit).toHaveBeenCalledWith('players:bothNext', expect.objectContaining({
      affectedUsers: expect.arrayContaining(['human-1', 'bot-1']),
      currentGameNumber: 1,
    }));
  });
});
