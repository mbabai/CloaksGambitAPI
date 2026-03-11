const express = require('express');
const request = require('supertest');

const mockRuntime = {
  getSummary: jest.fn(),
  listParticipants: jest.fn(),
  listSimulations: jest.fn(),
  listTrainingRuns: jest.fn(),
  getLiveStatus: jest.fn(),
};

jest.mock('../src/utils/adminAccess', () => ({
  ensureAdminRequest: jest.fn(async () => ({ userId: 'admin-user' })),
}));

jest.mock('../src/services/ml/runtime', () => ({
  getMlRuntime: jest.fn(() => mockRuntime),
}));

const { ensureAdminRequest } = require('../src/utils/adminAccess');
const mlRouter = require('../src/routes/v1/ml');

function createApp() {
  const app = express();
  app.use('/api/v1/ml', mlRouter);
  return app;
}

describe('ml routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureAdminRequest.mockResolvedValue({ userId: 'admin-user' });
    mockRuntime.getSummary.mockResolvedValue({
      snapshots: { total: 2 },
      simulations: { total: 3 },
    });
    mockRuntime.listParticipants.mockResolvedValue([
      { id: 'snapshot:snapshot-1', kind: 'snapshot', label: 'Snapshot 1' },
      { id: 'builtin:medium-bot', kind: 'builtin', label: 'Medium Bot' },
    ]);
    mockRuntime.listSimulations.mockResolvedValue([
      { id: 'simulation-1', label: 'Simulation 1' },
    ]);
    mockRuntime.listTrainingRuns.mockResolvedValue([
      { id: 'training-1', label: 'Training 1' },
    ]);
    mockRuntime.getLiveStatus.mockResolvedValue({
      simulation: null,
      training: null,
    });
  });

  test('GET /workbench returns the aggregated admin payload', async () => {
    const response = await request(createApp())
      .get('/api/v1/ml/workbench')
      .query({ limit: 25, trainingLimit: 10 });

    expect(response.status).toBe(200);
    expect(ensureAdminRequest).toHaveBeenCalledTimes(1);
    expect(mockRuntime.getSummary).toHaveBeenCalledTimes(1);
    expect(mockRuntime.listParticipants).toHaveBeenCalledTimes(1);
    expect(mockRuntime.listSimulations).toHaveBeenCalledWith({ limit: '25' });
    expect(mockRuntime.listTrainingRuns).toHaveBeenCalledWith({ limit: '10' });
    expect(mockRuntime.getLiveStatus).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual({
      summary: {
        snapshots: { total: 2 },
        simulations: { total: 3 },
      },
      participants: [
        { id: 'snapshot:snapshot-1', kind: 'snapshot', label: 'Snapshot 1' },
        { id: 'builtin:medium-bot', kind: 'builtin', label: 'Medium Bot' },
      ],
      simulations: {
        items: [{ id: 'simulation-1', label: 'Simulation 1' }],
      },
      trainingRuns: {
        items: [{ id: 'training-1', label: 'Training 1' }],
      },
      live: {
        simulation: null,
        training: null,
      },
    });
  });

  test('GET /workbench surfaces runtime failures', async () => {
    mockRuntime.getSummary.mockRejectedValue(new Error('Workbench exploded'));

    const response = await request(createApp()).get('/api/v1/ml/workbench');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Workbench exploded' });
  });
});
