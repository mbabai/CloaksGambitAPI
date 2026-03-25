const express = require('express');
const request = require('supertest');

jest.mock('../src/services/bots/registry', () => ({
  listBuiltinBotCatalog: jest.fn(() => ([
    { id: 'easy', label: 'Easy', playable: true, type: 'builtin' },
    { id: 'medium', label: 'Medium', playable: true, type: 'builtin' },
    { id: 'hard', label: 'Hard', playable: false, type: 'builtin' },
  ])),
}));

const { listBuiltinBotCatalog } = require('../src/services/bots/registry');
const botCatalogRouter = require('../src/routes/v1/bots/catalog');

function createApp() {
  const app = express();
  app.use('/api/v1/bots/catalog', botCatalogRouter);
  return app;
}

describe('bot catalog route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns only built-in bots', async () => {
    const response = await request(createApp()).get('/api/v1/bots/catalog');

    expect(response.status).toBe(200);
    expect(listBuiltinBotCatalog).toHaveBeenCalledTimes(1);
    expect(response.body.items.map((item) => item.id)).toEqual([
      'easy',
      'medium',
      'hard',
    ]);
  });
});
