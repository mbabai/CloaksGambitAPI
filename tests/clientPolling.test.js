const request = require('supertest');
const express = require('express');
const listenRoute = require('../src/routes/v1/games/listenForMove');
const Game = require('../src/models/Game');
const ServerConfig = require('../src/models/ServerConfig');

const app = express();
app.use(express.json());
app.use('/', listenRoute);

// simple client side polling function
async function longPoll(gameId, color, lastAction) {
  // this loops until the server indicates there is a new action
  while (true) {
    const res = await request(app)
      .post('/')
      .send({ gameId, color, lastAction });

    if (res.status === 200) {
      return res.body;
    }

    if (res.status !== 204) {
      throw new Error(`Unexpected status ${res.status}`);
    }

    // wait before sending the next poll
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

test('client polling repeats until a new action is received', async () => {
  const config = new ServerConfig();
  const board = [[{ color: 1, identity: config.identities.get('ROOK') }]];
  const baseGame = { actions: [{ player: 0, type: 1, details: {}, timestamp: new Date() }], board, stashes: [[], []], onDecks: [] };
  const updated = { ...baseGame, actions: [...baseGame.actions, { player: 1, type: 1, details: {}, timestamp: new Date() }] };

  Game.findById = jest.fn()
    .mockResolvedValueOnce(baseGame)
    .mockResolvedValueOnce(baseGame)
    .mockResolvedValueOnce(updated);

  const pollPromise = longPoll('1', 0, 0);

  await jest.advanceTimersByTimeAsync(31000); // first server timeout
  await jest.advanceTimersByTimeAsync(31000); // second server timeout
  await jest.advanceTimersByTimeAsync(2000);  // third call resolves

  const result = await pollPromise;
  expect(result.board[0][0].identity).toBe(config.identities.get('UNKNOWN'));
  expect(Game.findById).toHaveBeenCalledTimes(3);
});
