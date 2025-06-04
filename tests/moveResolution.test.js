const request = require('supertest');
const express = require('express');
const moveRoute = require('../src/routes/v1/gameAction/move');
const Game = require('../src/models/Game');
const ServerConfig = require('../src/models/ServerConfig');

const app = express();
app.use(express.json());
app.use('/', moveRoute);

beforeEach(() => {
  jest.clearAllMocks();
});

test('previous move is not applied again when already resolved', async () => {
  const config = new ServerConfig();

  const pieceA = { color: 0, identity: config.identities.get('ROOK') };
  const pieceB = { color: 1, identity: config.identities.get('KNIGHT') };

  const ranks = config.boardDimensions.RANKS;
  const files = config.boardDimensions.FILES;
  const board = Array.from({ length: ranks }, () => Array(files).fill(null));

  board[1][0] = pieceA; // result of previous resolved move
  board[0][1] = pieceB; // piece to move

  const game = {
    board,
    moves: [
      {
        player: 0,
        from: { row: 0, col: 0 },
        to: { row: 1, col: 0 },
        declaration: config.identities.get('ROOK'),
        state: config.moveStates.get('RESOLVED'),
      },
    ],
    actions: [],
    captured: [[], []],
    setupComplete: [true, true],
    onDeckingPlayer: null,
    playerTurn: 1,
    isActive: true,
    movesSinceAction: 0,
    addAction: jest.fn().mockImplementation(async () => {
      // Move the piece on the board
      game.board[2][2] = game.board[0][1];
      game.board[0][1] = null;
    }),
    save: jest.fn().mockResolvedValue(),
    endGame: jest.fn().mockResolvedValue(),
  };

  Game.findById = jest.fn().mockResolvedValue(game);

  await request(app)
    .post('/')
    .send({
      gameId: '1',
      color: 1,
      from: { row: 0, col: 1 },
      to: { row: 2, col: 2 },
      declaration: config.identities.get('KNIGHT'),
    })
    .expect(200);

  // piece A should remain at its resolved position
  expect(game.board[1][0]).toBe(pieceA);
  expect(game.captured[0]).toHaveLength(0);

  // piece B should have moved
  expect(game.board[0][1]).toBe(null);
  expect(game.board[2][2]).toBe(pieceB);
});
