const express = require('express');
const request = require('supertest');

jest.mock('../src/utils/requestSession', () => ({
  resolveSessionFromRequest: jest.fn(),
}));
jest.mock('../src/utils/adminAccess', () => ({
  ensureAdminRequest: jest.fn(),
}));
jest.mock('../src/utils/ensureUser', () => jest.fn(async (userId) => ({
  userId: userId || '000000000000000000000401',
  username: 'EnsuredGuest',
  isGuest: true,
})));
jest.mock('../src/services/bots/registry', () => ({
  ensureBotUserInstance: jest.fn(async (options = {}) => ({
    user: {
      _id: `instance-${String(options?.instanceKey || 'bot')}`,
      username: 'instance-bot',
    },
    token: `token-${String(options?.instanceKey || 'bot')}`,
  })),
  ensureBotUser: jest.fn(async () => ({ user: { _id: '000000000000000000000499', username: 'easy-bot' } })),
  listBuiltinBotCatalog: jest.fn(() => [
    { id: 'easy', label: 'Easy', playable: true },
    { id: 'medium', label: 'Medium', playable: true },
  ]),
  getBuiltinBotDefinition: jest.fn((input) => {
    const lowered = String(input || '').toLowerCase();
    if (lowered === 'easy') return { id: 'easy', label: 'Easy', playable: true };
    if (lowered === 'medium') return { id: 'medium', label: 'Medium', playable: true };
    return null;
  }),
  normalizeBuiltinBotId: jest.fn((input) => {
    const lowered = String(input || '').toLowerCase();
    return lowered === 'medium' ? 'medium' : lowered === 'easy' ? 'easy' : '';
  }),
}));

const { resolveSessionFromRequest } = require('../src/utils/requestSession');
const { ensureAdminRequest } = require('../src/utils/adminAccess');
const tournamentsRouter = require('../src/routes/v1/tournaments');
const { resetForTests } = require('../src/services/tournaments/liveTournaments');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tournaments', tournamentsRouter);
  return app;
}

describe('tournaments routes', () => {
  beforeEach(() => {
    resetForTests();
    resolveSessionFromRequest.mockReset();
    ensureAdminRequest.mockReset();
    ensureAdminRequest.mockResolvedValue({ userId: 'admin-user', authenticated: true, isGuest: false });
  });

  test('development test-mode allows guest participation', async () => {
    process.env.NODE_ENV = 'development';
    resolveSessionFromRequest.mockResolvedValue({
      userId: 'guest-1',
      username: 'GuestOne',
      isGuest: true,
      authenticated: false,
    });

    const app = createApp();
    const createRes = await request(app)
      .post('/api/v1/tournaments/create')
      .send({ label: 'Guest Cup' });

    expect(createRes.status).toBe(200);
    expect(createRes.body.testModeEnabled).toBe(true);
    expect(createRes.body.tournament.host).toMatchObject({
      username: 'GuestOne',
      isGuest: true,
    });
  });

  test('production blocks guest participation', async () => {
    process.env.NODE_ENV = 'production';
    resolveSessionFromRequest.mockResolvedValue({
      userId: 'guest-2',
      username: 'GuestTwo',
      isGuest: true,
      authenticated: false,
    });

    const app = createApp();
    const createRes = await request(app)
      .post('/api/v1/tournaments/create')
      .send({ label: 'Blocked Cup' });

    expect(createRes.status).toBe(403);
    expect(createRes.body.message).toMatch(/log in/i);
  });

  test('non-host cannot add bot', async () => {
    process.env.NODE_ENV = 'development';
    const app = createApp();

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'host-1',
      username: 'Host',
      isGuest: true,
      authenticated: false,
    });
    const createRes = await request(app)
      .post('/api/v1/tournaments/create')
      .send({ label: 'Bot Guard Cup' });

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'user-2',
      username: 'OtherUser',
      isGuest: true,
      authenticated: false,
    });
    const addBotRes = await request(app)
      .post('/api/v1/tournaments/add-bot')
      .send({ tournamentId: createRes.body.tournament.id, name: 'Sneaky', difficulty: 'easy' });

    expect(addBotRes.status).toBe(403);
    expect(addBotRes.body.message).toMatch(/only host/i);
  });

  test('host leave route cancels tournament', async () => {
    process.env.NODE_ENV = 'development';
    const app = createApp();

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'host-leave',
      username: 'HostLeave',
      isGuest: true,
      authenticated: false,
    });
    const createRes = await request(app)
      .post('/api/v1/tournaments/create')
      .send({ label: 'Leave Cup' });

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'host-leave',
      username: 'HostLeave',
      isGuest: true,
      authenticated: false,
    });
    const leaveRes = await request(app)
      .post('/api/v1/tournaments/leave')
      .send({ tournamentId: createRes.body.tournament.id });

    expect(leaveRes.status).toBe(200);
    expect(leaveRes.body.tournament.state).toBe('cancelled');

    const listRes = await request(app).get('/api/v1/tournaments');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.tournaments)).toBe(true);
    expect(listRes.body.tournaments.some((row) => row.id === createRes.body.tournament.id)).toBe(false);
  });

  test('missing session identity is rejected', async () => {
    process.env.NODE_ENV = 'development';
    resolveSessionFromRequest.mockResolvedValue({ userId: null, isGuest: true, authenticated: false });
    const app = createApp();
    const joinRes = await request(app)
      .post('/api/v1/tournaments/join')
      .send({ tournamentId: '507f1f77bcf86cd799439011', role: 'player' });

    expect(joinRes.status).toBe(401);
  });

  test('details requires membership before loading', async () => {
    process.env.NODE_ENV = 'development';
    const app = createApp();

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'host-ctx',
      username: 'HostCtx',
      isGuest: true,
      authenticated: false,
    });
    const createRes = await request(app)
      .post('/api/v1/tournaments/create')
      .send({ label: 'Members Cup' });

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'stranger',
      username: 'Stranger',
      isGuest: true,
      authenticated: false,
    });
    const detailsRes = await request(app)
      .post('/api/v1/tournaments/details')
      .send({ tournamentId: createRes.body.tournament.id });

    expect(detailsRes.status).toBe(403);
    expect(detailsRes.body.message).toMatch(/must join/i);
  });

  test('current route restores the joined tournament for refresh flows', async () => {
    process.env.NODE_ENV = 'development';
    const app = createApp();

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'host-current',
      username: 'HostCurrent',
      isGuest: true,
      authenticated: false,
    });
    const createRes = await request(app)
      .post('/api/v1/tournaments/create')
      .send({ label: 'Current Cup' });

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'viewer-current',
      username: 'ViewerCurrent',
      isGuest: true,
      authenticated: false,
    });
    await request(app)
      .post('/api/v1/tournaments/join')
      .send({ tournamentId: createRes.body.tournament.id, role: 'viewer' });

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'viewer-current',
      username: 'ViewerCurrent',
      isGuest: true,
      authenticated: false,
    });
    const currentRes = await request(app).get('/api/v1/tournaments/current');
    expect(currentRes.status).toBe(200);
    expect(currentRes.body.tournament.id).toBe(createRes.body.tournament.id);
    expect(currentRes.body.role).toBe('viewer');
  });

  test('admin list and delete endpoints work', async () => {
    process.env.NODE_ENV = 'development';
    const app = createApp();
    resolveSessionFromRequest.mockResolvedValue({
      userId: 'host-admin-path',
      username: 'HostAdminPath',
      isGuest: true,
      authenticated: false,
    });

    const createRes = await request(app)
      .post('/api/v1/tournaments/create')
      .send({ label: 'Admin Delete Cup' });

    const listRes = await request(app).get('/api/v1/tournaments/admin/list');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.tournaments)).toBe(true);
    expect(listRes.body.tournaments.some((row) => row.id === createRes.body.tournament.id)).toBe(true);

    const deleteRes = await request(app)
      .post('/api/v1/tournaments/admin/delete')
      .send({ tournamentId: createRes.body.tournament.id });
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.deleted).toBe(true);
  });

  test('host can kick and re-allow players through routes', async () => {
    process.env.NODE_ENV = 'development';
    const app = createApp();

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'host-kick-route',
      username: 'KickHost',
      isGuest: true,
      authenticated: false,
    });
    const createRes = await request(app)
      .post('/api/v1/tournaments/create')
      .send({ label: 'Kick Route Cup' });

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'guest-kick-route',
      username: 'KickTarget',
      isGuest: true,
      authenticated: false,
    });
    await request(app)
      .post('/api/v1/tournaments/join')
      .send({ tournamentId: createRes.body.tournament.id, role: 'player' });

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'host-kick-route',
      username: 'KickHost',
      isGuest: true,
      authenticated: false,
    });
    const kickRes = await request(app)
      .post('/api/v1/tournaments/kick-player')
      .send({ tournamentId: createRes.body.tournament.id, userId: 'guest-kick-route' });
    expect(kickRes.status).toBe(200);
    expect(kickRes.body.tournament.removedPlayers.some((entry) => entry.userId === 'guest-kick-route')).toBe(true);

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'guest-kick-route',
      username: 'KickTarget',
      isGuest: true,
      authenticated: false,
    });
    const listRes = await request(app).get('/api/v1/tournaments');
    expect(listRes.status).toBe(200);
    expect(listRes.body.tournaments.some((entry) => entry.id === createRes.body.tournament.id)).toBe(false);
    expect(Array.isArray(listRes.body.alerts)).toBe(true);
    expect(listRes.body.alerts.join(' ')).toMatch(/removed/i);

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'host-kick-route',
      username: 'KickHost',
      isGuest: true,
      authenticated: false,
    });
    const reallowRes = await request(app)
      .post('/api/v1/tournaments/reallow-player')
      .send({ tournamentId: createRes.body.tournament.id, userId: 'guest-kick-route' });
    expect(reallowRes.status).toBe(200);
    expect(reallowRes.body.tournament.removedPlayers.some((entry) => entry.userId === 'guest-kick-route')).toBe(false);
  });

  test('host can transfer control and update the tournament message through routes', async () => {
    process.env.NODE_ENV = 'development';
    const app = createApp();

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'host-transfer-route',
      username: 'TransferHost',
      isGuest: true,
      authenticated: false,
    });
    const createRes = await request(app)
      .post('/api/v1/tournaments/create')
      .send({ label: 'Transfer Route Cup' });

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'player-transfer-route',
      username: 'TransferPlayer',
      isGuest: true,
      authenticated: false,
    });
    await request(app)
      .post('/api/v1/tournaments/join')
      .send({ tournamentId: createRes.body.tournament.id, role: 'player' });

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'host-transfer-route',
      username: 'TransferHost',
      isGuest: true,
      authenticated: false,
    });
    const messageRes = await request(app)
      .post('/api/v1/tournaments/message')
      .send({ tournamentId: createRes.body.tournament.id, message: 'Check in at the board.' });
    expect(messageRes.status).toBe(200);
    expect(messageRes.body.tournament.message).toBe('Check in at the board.');

    resolveSessionFromRequest.mockResolvedValueOnce({
      userId: 'host-transfer-route',
      username: 'TransferHost',
      isGuest: true,
      authenticated: false,
    });
    const transferRes = await request(app)
      .post('/api/v1/tournaments/transfer-host')
      .send({ tournamentId: createRes.body.tournament.id, userId: 'player-transfer-route' });
    expect(transferRes.status).toBe(200);
    expect(transferRes.body.tournament.host.userId).toBe('player-transfer-route');
  });
});
