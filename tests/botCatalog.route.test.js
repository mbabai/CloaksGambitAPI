const express = require('express');
const request = require('supertest');

const mockRuntime = {
  listEnabledPromotedBotCatalog: jest.fn(),
};

jest.mock('../src/services/bots/registry', () => ({
  listBuiltinBotCatalog: jest.fn(() => ([
    { id: 'easy', label: 'Easy', playable: true, type: 'builtin' },
    { id: 'medium', label: 'Medium', playable: true, type: 'builtin' },
    { id: 'hard', label: 'Hard', playable: false, type: 'builtin' },
  ])),
}));

jest.mock('../src/utils/mlFeatureGate', () => ({
  isMlWorkflowEnabled: jest.fn(() => true),
}));

jest.mock('../src/services/ml/runtime', () => ({
  getMlRuntime: jest.fn(() => mockRuntime),
}));

const botCatalogRouter = require('../src/routes/v1/bots/catalog');

function createApp() {
  const app = express();
  app.use('/api/v1/bots/catalog', botCatalogRouter);
  return app;
}

describe('bot catalog route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRuntime.listEnabledPromotedBotCatalog.mockResolvedValue([
      {
        id: 'generation:run-1:4',
        label: 'Run 1 G4',
        playable: true,
        type: 'promoted_model',
      },
    ]);
  });

  test('returns built-in bots followed by enabled promoted models', async () => {
    const response = await request(createApp()).get('/api/v1/bots/catalog');

    expect(response.status).toBe(200);
    expect(mockRuntime.listEnabledPromotedBotCatalog).toHaveBeenCalledTimes(1);
    expect(response.body.items.map((item) => item.id)).toEqual([
      'easy',
      'medium',
      'hard',
      'generation:run-1:4',
    ]);
  });
});
