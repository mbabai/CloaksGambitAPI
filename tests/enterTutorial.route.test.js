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
}));

jest.mock('../src/models/User', () => ({
  findOne: jest.fn(),
  updateOne: jest.fn(),
  create: jest.fn(),
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
}));

jest.mock('../src/utils/gameModeClock', () => ({
  getClockSettingsForMatchType: jest.fn(() => ({ timeControl: 420000, increment: 4000 })),
  getGameModeType: jest.fn(() => 'AI'),
}));

jest.mock('../src/services/tutorials/runtime', () => ({
  INTRO_TUTORIAL_ID: 'intro',
  prepareIntroTutorialGame: jest.fn((game) => game),
}));

const Match = require('../src/models/Match');
const Game = require('../src/models/Game');
const User = require('../src/models/User');
const eventBus = require('../src/eventBus');
const lobbyStore = require('../src/state/lobby');
const getServerConfig = require('../src/utils/getServerConfig');
const { resolveLobbySession } = require('../src/utils/lobbyAccess');
const { ensureGuestForBotGame } = require('../src/services/bots/registry');
const { prepareIntroTutorialGame } = require('../src/services/tutorials/runtime');
const enterTutorialRouter = require('../src/routes/v1/lobby/enterTutorial');

function createLeanQuery(value) {
  return {
    lean: jest.fn().mockResolvedValue(value),
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/lobby/enterTutorial', enterTutorialRouter);
  return app;
}

describe('enter tutorial route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveLobbySession.mockResolvedValue({ userId: 'human-1' });
    ensureGuestForBotGame.mockResolvedValue({ userId: 'human-1', username: 'GuestOne' });
    getServerConfig.mockResolvedValue({ gameModes: { AI: 'AI' } });
    User.findOne.mockImplementation((query) => createLeanQuery(query?.email ? null : null));
    User.create.mockResolvedValue({
      toObject() {
        return {
          _id: 'tutorial-bot-1',
          username: 'Tutorial Bot',
          email: 'tutorial.bot@cg-bots.local',
          isBot: true,
          botDifficulty: 'tutorial',
        };
      },
    });
    Match.create.mockResolvedValue({
      _id: 'match-1',
      games: [],
      save: jest.fn(async () => {}),
    });
    Game.create.mockResolvedValue({
      _id: 'game-1',
      players: ['human-1', 'tutorial-bot-1'],
      save: jest.fn(async () => {}),
      toObject() {
        return {
          _id: this._id,
          players: this.players,
          tutorialState: { id: 'intro', step: 1 },
          isTutorial: true,
        };
      },
    });
  });

  test('creates a tutorial match and game without starting the normal next-game flow', async () => {
    const response = await request(createApp())
      .post('/api/v1/lobby/enterTutorial')
      .send({});

    expect(response.status).toBe(200);
    expect(Match.create).toHaveBeenCalledWith(expect.objectContaining({
      player1: 'human-1',
      player2: 'tutorial-bot-1',
      type: 'AI',
      isTutorial: true,
    }));
    expect(Game.create).toHaveBeenCalledWith(expect.objectContaining({
      match: 'match-1',
      players: ['human-1', 'tutorial-bot-1'],
      timeControlStart: 420000,
      increment: 4000,
      isTutorial: true,
      tutorialState: {
        id: 'intro',
        step: 1,
      },
    }));
    expect(prepareIntroTutorialGame).toHaveBeenCalled();
    expect(lobbyStore.addInGame).toHaveBeenCalledWith(['human-1']);
    expect(eventBus.emit).toHaveBeenCalledWith('gameChanged', expect.objectContaining({
      affectedUsers: ['human-1', 'tutorial-bot-1'],
      initiator: expect.objectContaining({
        action: 'tutorial-created',
        userId: 'human-1',
      }),
      botPlayers: ['tutorial-bot-1'],
    }));
    expect(eventBus.emit).toHaveBeenCalledWith('match:created', expect.objectContaining({
      matchId: 'match-1',
      players: ['human-1', 'tutorial-bot-1'],
      type: 'AI',
      botPlayers: ['tutorial-bot-1'],
    }));
    expect(eventBus.emit).not.toHaveBeenCalledWith('players:bothNext', expect.anything());
    expect(response.body).toEqual(expect.objectContaining({
      status: 'tutorial-started',
      userId: 'human-1',
      username: 'GuestOne',
      matchId: 'match-1',
      gameId: 'game-1',
      botId: 'tutorial-bot-1',
    }));
  });
});
