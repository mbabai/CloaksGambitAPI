const express = require('express');
const request = require('supertest');

const mockGetServerConfig = jest.fn();
mockGetServerConfig.refreshServerConfig = jest.fn();

jest.mock('../src/utils/getServerConfig', () => mockGetServerConfig);
jest.mock('../src/models/ServerConfig', () => ({
  getSingleton: jest.fn(),
}));
jest.mock('../src/utils/adminAccess', () => ({
  ensureAdminRequest: jest.fn(),
}));
jest.mock('../src/eventBus', () => ({
  emit: jest.fn(),
}));

const ServerConfig = require('../src/models/ServerConfig');
const { ensureAdminRequest } = require('../src/utils/adminAccess');
const eventBus = require('../src/eventBus');
const announcementRouter = require('../src/routes/v1/config/announcement');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/config/announcement', announcementRouter);
  return app;
}

describe('config announcement route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerConfig.mockResolvedValue({
      announcementMarkdown: '# Server note',
      announcementFontSize: 18,
      announcementHeadingFontSizes: { h1: 24, h2: 20, h3: 16 },
      updatedAt: '2026-06-01T12:00:00.000Z',
    });
    mockGetServerConfig.refreshServerConfig.mockResolvedValue({
      announcementMarkdown: 'Saved **note**',
      announcementFontSize: 22,
      announcementHeadingFontSizes: { h1: 28, h2: 24, h3: 20 },
      updatedAt: '2026-06-01T12:05:00.000Z',
    });
    ensureAdminRequest.mockResolvedValue({
      userId: 'admin-user',
      authenticated: true,
      isGuest: false,
    });
  });

  test('public get returns the current announcement markdown', async () => {
    const response = await request(createApp()).get('/api/v1/config/announcement');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      markdown: '# Server note',
      fontSize: 18,
      headingFontSizes: { h1: 24, h2: 20, h3: 16 },
      minFontSize: 12,
      maxFontSize: 32,
      maxLength: 5000,
      updatedAt: '2026-06-01T12:00:00.000Z',
    });
  });

  test('admin post persists normalized markdown and font size and emits an update', async () => {
    const save = jest.fn(async () => {});
    const configDoc = {
      announcementMarkdown: '',
      announcementFontSize: 16,
      announcementHeadingFontSizes: { h1: 22, h2: 18, h3: 16 },
      save,
    };
    ServerConfig.getSingleton.mockResolvedValue(configDoc);

    const response = await request(createApp())
      .post('/api/v1/config/announcement')
      .send({
        markdown: 'Saved **note**\r\n',
        fontSize: 22,
        headingFontSizes: { h1: 28, h2: 24, h3: 20 },
      });

    expect(response.status).toBe(200);
    expect(configDoc.announcementMarkdown).toBe('Saved **note**');
    expect(configDoc.announcementFontSize).toBe(22);
    expect(configDoc.announcementHeadingFontSizes).toEqual({ h1: 28, h2: 24, h3: 20 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(mockGetServerConfig.refreshServerConfig).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith('announcementChanged', expect.objectContaining({
      markdown: 'Saved **note**',
      fontSize: 22,
      headingFontSizes: { h1: 28, h2: 24, h3: 20 },
      maxLength: 5000,
    }));
    expect(response.body.markdown).toBe('Saved **note**');
    expect(response.body.fontSize).toBe(22);
    expect(response.body.headingFontSizes).toEqual({ h1: 28, h2: 24, h3: 20 });
  });

  test('admin post preserves leading double spaces for banner indentation', async () => {
    const save = jest.fn(async () => {});
    const configDoc = { announcementMarkdown: '', announcementFontSize: 16, save };
    ServerConfig.getSingleton.mockResolvedValue(configDoc);
    mockGetServerConfig.refreshServerConfig.mockResolvedValue({
      announcementMarkdown: '  Indented line',
      announcementFontSize: 16,
    });

    const response = await request(createApp())
      .post('/api/v1/config/announcement')
      .send({ markdown: '  Indented line\r\n' });

    expect(response.status).toBe(200);
    expect(configDoc.announcementMarkdown).toBe('  Indented line');
    expect(response.body.markdown).toBe('  Indented line');
  });

  test('post rejects non-string markdown', async () => {
    const response = await request(createApp())
      .post('/api/v1/config/announcement')
      .send({ markdown: { text: 'Nope' } });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'markdown must be a string' });
    expect(ServerConfig.getSingleton).not.toHaveBeenCalled();
  });

  test('post rejects markdown over the length limit', async () => {
    const response = await request(createApp())
      .post('/api/v1/config/announcement')
      .send({ markdown: 'x'.repeat(5001) });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      message: 'markdown must be 5000 characters or fewer',
      maxLength: 5000,
    });
    expect(ServerConfig.getSingleton).not.toHaveBeenCalled();
  });

  test('post rejects font size outside the allowed range', async () => {
    const response = await request(createApp())
      .post('/api/v1/config/announcement')
      .send({ markdown: 'Visible', fontSize: 64 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'fontSize must be a number between 12 and 32',
      minFontSize: 12,
      maxFontSize: 32,
    });
    expect(ServerConfig.getSingleton).not.toHaveBeenCalled();
  });

  test('post rejects heading font size outside the allowed range', async () => {
    const response = await request(createApp())
      .post('/api/v1/config/announcement')
      .send({ markdown: 'Visible', headingFontSizes: { h1: 64, h2: 20, h3: 16 } });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'headingFontSizes must contain h1, h2, and h3 numbers between 12 and 32',
      minFontSize: 12,
      maxFontSize: 32,
    });
    expect(ServerConfig.getSingleton).not.toHaveBeenCalled();
  });

  test('post relies on admin access enforcement', async () => {
    ensureAdminRequest.mockImplementation(async (req, res) => {
      res.status(403).json({ message: 'Forbidden' });
      return null;
    });

    const response = await request(createApp())
      .post('/api/v1/config/announcement')
      .send({ markdown: 'Hidden' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
    expect(ServerConfig.getSingleton).not.toHaveBeenCalled();
  });
});
