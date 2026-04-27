const express = require('express');
const request = require('supertest');

jest.mock('../src/utils/gameAccess', () => ({
  requireGamePlayerContext: jest.fn(),
}));

jest.mock('../src/models/Match', () => ({
  findById: jest.fn(),
}));

jest.mock('../src/state/lobby', () => ({
  removeInGame: jest.fn(() => ({ removed: false })),
  emitQueueChanged: jest.fn(),
}));

jest.mock('../src/services/tutorials/runtime', () => ({
  isTutorialGame: jest.fn(),
}));

const Match = require('../src/models/Match');
const lobbyStore = require('../src/state/lobby');
const { requireGamePlayerContext } = require('../src/utils/gameAccess');
const { isTutorialGame } = require('../src/services/tutorials/runtime');
const leaveTutorialRouter = require('../src/routes/v1/lobby/leaveTutorial');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/lobby/leaveTutorial', leaveTutorialRouter);
  return app;
}

describe('leave tutorial route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isTutorialGame.mockReturnValue(true);
  });

  test('ends the tutorial game and returns the player to lobby state', async () => {
    const game = {
      _id: 'game-1',
      match: 'match-1',
      isActive: true,
      isTutorial: true,
      save: jest.fn(async () => {}),
    };
    const match = {
      isActive: true,
      isTutorial: true,
      endMatch: jest.fn(async () => {}),
    };
    requireGamePlayerContext.mockResolvedValue({
      game,
      session: { userId: 'human-1' },
    });
    Match.findById.mockResolvedValue(match);
    lobbyStore.removeInGame.mockReturnValue({ removed: true });

    const response = await request(createApp())
      .post('/api/v1/lobby/leaveTutorial')
      .send({ gameId: 'game-1' });

    expect(response.status).toBe(200);
    expect(game.isActive).toBe(false);
    expect(game.endTime).toBeInstanceOf(Date);
    expect(game.save).toHaveBeenCalled();
    expect(match.endMatch).toHaveBeenCalledWith(null);
    expect(lobbyStore.removeInGame).toHaveBeenCalledWith(['human-1']);
    expect(lobbyStore.emitQueueChanged).toHaveBeenCalledWith(['human-1']);
    expect(response.body).toEqual({ status: 'tutorial-left', gameId: 'game-1' });
  });

  test('rejects non-tutorial games', async () => {
    requireGamePlayerContext.mockResolvedValue({
      game: { _id: 'game-1', isTutorial: false },
      session: { userId: 'human-1' },
    });
    isTutorialGame.mockReturnValue(false);

    const response = await request(createApp())
      .post('/api/v1/lobby/leaveTutorial')
      .send({ gameId: 'game-1' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'This game is not a tutorial game.' });
    expect(Match.findById).not.toHaveBeenCalled();
  });
});
