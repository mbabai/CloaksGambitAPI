jest.mock('../src/models/Game', () => ({
  findById: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const Game = require('../src/models/Game');
const checkTimeControlRouter = require('../src/routes/v1/gameAction/checkTimeControl');

describe('checkTimeControl route', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/', checkTimeControlRouter);
  });

  test('treats stale game ids as a no-op timeout probe', async () => {
    Game.findById.mockResolvedValue(null);

    const response = await request(app)
      .post('/')
      .send({ gameId: '507f1f77bcf86cd799439011' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ gameOver: false, missing: true });
  });
});
