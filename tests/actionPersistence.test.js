const request = require('supertest');
const express = require('express');
const Game = require('../src/models/Game');
const ServerConfig = require('../src/models/ServerConfig');

const moveRoute = require('../src/routes/v1/gameAction/move');
const challengeRoute = require('../src/routes/v1/gameAction/challenge');
const bombRoute = require('../src/routes/v1/gameAction/bomb');

describe('game action routes persist once', () => {
  let config;
  beforeEach(() => {
    jest.clearAllMocks();
    config = new ServerConfig();
  });

  test('move route saves exactly once', async () => {
    const app = express();
    app.use(express.json());
    app.use('/', moveRoute);

    const ranks = config.boardDimensions.RANKS;
    const files = config.boardDimensions.FILES;
    const board = Array.from({ length: ranks }, () => Array(files).fill(null));
    const piece = { color: 1, identity: config.identities.get('KNIGHT') };
    board[0][1] = piece;

    const game = {
      board,
      moves: [],
      actions: [],
      captured: [[], []],
      setupComplete: [true, true],
      onDeckingPlayer: null,
      playerTurn: 1,
      isActive: true,
      movesSinceAction: 0,
      addAction: jest.fn(function(type, player, details) {
        this.actions.push({ type, player, details });
        return this;
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

    expect(game.save).toHaveBeenCalledTimes(1);
  });

  test('challenge route saves exactly once', async () => {
    const app = express();
    app.use(express.json());
    app.use('/', challengeRoute);

    const ranks = config.boardDimensions.RANKS;
    const files = config.boardDimensions.FILES;
    const board = Array.from({ length: ranks }, () => Array(files).fill(null));
    const piece = { color: 0, identity: config.identities.get('BISHOP') };
    board[0][0] = piece;

    const game = {
      board,
      moves: [
        {
          player: 0,
          from: { row: 0, col: 0 },
          to: { row: 0, col: 1 },
          declaration: config.identities.get('ROOK'),
          state: config.moveStates.get('PENDING'),
        },
      ],
      actions: [
        { type: config.actions.get('MOVE'), player: 0, details: {} },
      ],
      captured: [[], []],
      daggers: [0, 0],
      stashes: [[], []],
      onDecks: [null, null],
      setupComplete: [true, true],
      onDeckingPlayer: null,
      playerTurn: 1,
      isActive: true,
      movesSinceAction: 0,
      addAction: jest.fn(function(type, player, details) {
        this.actions.push({ type, player, details });
        return this;
      }),
      save: jest.fn().mockResolvedValue(),
      endGame: jest.fn().mockResolvedValue(),
    };

    Game.findById = jest.fn().mockResolvedValue(game);

    await request(app)
      .post('/')
      .send({ gameId: '1', color: 1 })
      .expect(200);

    expect(game.save).toHaveBeenCalledTimes(1);
  });

  test('bomb route saves exactly once', async () => {
    const app = express();
    app.use(express.json());
    app.use('/', bombRoute);

    const ranks = config.boardDimensions.RANKS;
    const files = config.boardDimensions.FILES;
    const board = Array.from({ length: ranks }, () => Array(files).fill(null));
    const piece = { color: 0, identity: config.identities.get('ROOK') };
    board[1][1] = piece;

    const game = {
      board,
      moves: [
        {
          player: 0,
          from: { row: 0, col: 0 },
          to: { row: 1, col: 1 },
          declaration: config.identities.get('ROOK'),
          state: config.moveStates.get('PENDING'),
        },
      ],
      actions: [
        { type: config.actions.get('MOVE'), player: 0, details: {} },
      ],
      captured: [[], []],
      setupComplete: [true, true],
      onDeckingPlayer: null,
      playerTurn: 0,
      isActive: true,
      addAction: jest.fn(function(type, player, details) {
        this.actions.push({ type, player, details });
        return this;
      }),
      save: jest.fn().mockResolvedValue(),
      endGame: jest.fn().mockResolvedValue(),
    };

    Game.findById = jest.fn().mockResolvedValue(game);

    await request(app)
      .post('/')
      .send({ gameId: '1', color: 0 })
      .expect(200);

    expect(game.save).toHaveBeenCalledTimes(1);
  });
});

