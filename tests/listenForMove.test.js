const request = require('supertest');
const express = require('express');
const listenRoute = require('../src/routes/v1/games/listenForMove');
const Game = require('../src/models/Game');
const ServerConfig = require('../src/models/ServerConfig');

const app = express();
app.use(express.json());
app.use('/', listenRoute);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test('polling resolves when an opponent action is added', async () => {
  const config = new ServerConfig();
  const board = [[{ color: 1, identity: config.identities.get('ROOK') }]];
  const baseGame = { actions: [{ player: 0, type: 1, details: {}, timestamp: new Date() }], board, stashes: [[], []], onDecks: [] };
  const gameWithAction = { ...baseGame, actions: [...baseGame.actions, { player: 1, type: 1, details: {}, timestamp: new Date() }] };

  Game.findById = jest.fn()
    .mockResolvedValueOnce(baseGame)
    .mockResolvedValueOnce(baseGame)
    .mockResolvedValueOnce(gameWithAction);

  const req = request(app)
    .post('/')
    .send({ gameId: '1', color: 0, lastAction: 0 });

  await jest.advanceTimersByTimeAsync(2000);
  const res = await req;

  expect(res.status).toBe(200);
  const unknown = config.identities.get('UNKNOWN');
  expect(res.body.board[0][0].identity).toBe(unknown);
  expect(Game.findById).toHaveBeenCalledTimes(3);
});

test('returns 204 when no new action occurs before timeout', async () => {
  const config = new ServerConfig();
  const board = [[{ color: 1, identity: config.identities.get('ROOK') }]];
  const baseGame = { actions: [{ player: 0, type: 1, details: {}, timestamp: new Date() }], board, stashes: [[], []], onDecks: [] };

  Game.findById = jest.fn().mockResolvedValue(baseGame);

  const req = request(app)
    .post('/')
    .send({ gameId: '1', color: 0, lastAction: 0 });

  await jest.advanceTimersByTimeAsync(31000);
  const res = await req;

  expect(res.status).toBe(204);
  expect(Game.findById).toHaveBeenCalled();
});
