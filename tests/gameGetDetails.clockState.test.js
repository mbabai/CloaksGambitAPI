jest.mock('../src/models/Game', () => ({
  findById: jest.fn(),
}));

jest.mock('../src/utils/gameAccess', () => ({
  resolveGameViewerContext: jest.fn(),
}));

jest.mock('../src/utils/getServerConfig', () => {
  const mock = jest.fn();
  mock.getServerConfigSnapshotSync = jest.fn();
  return mock;
});

const express = require('express');
const request = require('supertest');
const sharedConstants = require('../shared/constants');
const Game = require('../src/models/Game');
const getServerConfig = require('../src/utils/getServerConfig');
const { resolveGameViewerContext } = require('../src/utils/gameAccess');
const gameGetDetailsRouter = require('../src/routes/v1/games/getDetails');

describe('games/getDetails live clock payload', () => {
  let app;
  let gameDoc;

  beforeEach(() => {
    jest.clearAllMocks();
    const config = {
      actions: new Map(Object.entries(sharedConstants.actions)),
      identities: new Map(Object.entries(sharedConstants.identities)),
    };
    getServerConfig.mockResolvedValue(config);
    getServerConfig.getServerConfigSnapshotSync.mockReturnValue(config);

    app = express();
    app.use(express.json());
    app.use('/', gameGetDetailsRouter);

    const startTime = new Date('2024-01-01T00:00:00Z');
    gameDoc = {
      _id: 'game-123',
      board: [[{ color: 0, identity: sharedConstants.identities.KING }]],
      stashes: [[], []],
      onDecks: [null, null],
      players: ['p1', 'p2'],
      captured: [],
      daggers: [0, 0],
      actions: [],
      moves: [],
      isActive: true,
      winner: null,
      winReason: null,
      onDeckingPlayer: null,
      playerTurn: 0,
      setupComplete: [true, true],
      playersReady: [true, true],
      startTime,
      timeControlStart: 180000,
      increment: 3000,
      clockState: {
        whiteMs: 175000,
        blackMs: 180000,
        activeColor: 0,
        setupComplete: [true, true],
        tickingWhite: true,
        tickingBlack: false,
        referenceTimestamp: startTime.getTime(),
        lastTimestamp: startTime.getTime(),
      },
    };
    Game.findById.mockReturnValue({
      lean: jest.fn(async () => gameDoc),
    });
  });

  test('returns timing fields and live clocks for a masked player view', async () => {
    resolveGameViewerContext.mockResolvedValue({
      role: 'player',
      color: 0,
    });

    const response = await request(app)
      .post('/')
      .send({ gameId: 'game-123' });

    expect(response.status).toBe(200);
    expect(response.body.setupComplete).toEqual([true, true]);
    expect(response.body.playersReady).toEqual([true, true]);
    expect(response.body.timeControlStart).toBe(180000);
    expect(response.body.increment).toBe(3000);
    expect(response.body.startTime).toBe(gameDoc.startTime.toISOString());
    expect(response.body.clocks).toMatchObject({
      whiteMs: 175000,
      blackMs: 180000,
      activeColor: 0,
      tickingWhite: true,
      tickingBlack: false,
    });
  });

  test('returns live clocks for admin views too', async () => {
    resolveGameViewerContext.mockResolvedValue({
      role: 'admin',
      color: null,
    });

    const response = await request(app)
      .post('/')
      .send({ gameId: 'game-123' });

    expect(response.status).toBe(200);
    expect(response.body.board).toEqual(gameDoc.board);
    expect(response.body.clocks).toMatchObject({
      whiteMs: 175000,
      blackMs: 180000,
      activeColor: 0,
      tickingWhite: true,
      tickingBlack: false,
    });
  });
});
