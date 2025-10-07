const request = require('supertest');
const express = require('express');

const routes = require('../src/routes');
const simulationQueue = require('../src/state/simulationQueue');

describe('POST /api/simulate', () => {
  let app;

  beforeEach(() => {
    simulationQueue.clear();
    app = express();
    app.use(express.json());
    app.use('/api', routes);
  });

  it('queues a simulation request with normalized payload data', async () => {
    const response = await request(app)
      .post('/api/simulate')
      .send({
        model_ids: [' model-A ', 'model-B'],
        num_games: 12,
        concurrency: 3,
        options: { temperature: 1.2 }
      });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe('queued');
    expect(response.body.simulation).toMatchObject({
      status: 'queued',
      queuePosition: 0
    });
    expect(response.body.simulation.payload).toEqual({
      modelIds: ['model-A', 'model-B'],
      numGames: 12,
      concurrency: 3,
      options: { temperature: 1.2 }
    });
  });

  it('rejects invalid payloads with a helpful error response', async () => {
    const response = await request(app)
      .post('/api/simulate')
      .send({ model_ids: [], num_games: 0, concurrency: 0, options: [] });

    expect(response.status).toBe(400);
    expect(response.body.status).toBe('error');
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        'model_ids must contain at least one non-empty string',
        'num_games must be a positive integer',
        'concurrency must be a positive integer',
        'options must be an object when provided'
      ])
    );
  });

  it('assigns queue positions sequentially and defaults concurrency to 1', async () => {
    const first = await request(app)
      .post('/api/simulate')
      .send({ model_ids: ['model-A'], num_games: 5, concurrency: 2 });

    expect(first.status).toBe(202);
    expect(first.body.simulation.queuePosition).toBe(0);

    const second = await request(app)
      .post('/api/simulate')
      .send({ model_ids: ['model-B'], num_games: 3 });

    expect(second.status).toBe(202);
    expect(second.body.simulation.queuePosition).toBe(1);
    expect(second.body.simulation.payload.concurrency).toBe(1);
  });
});
