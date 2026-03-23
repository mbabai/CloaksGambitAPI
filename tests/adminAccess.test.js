jest.mock('../src/utils/requestSession', () => ({
  resolveSessionFromRequest: jest.fn(),
  resolveSessionFromSocketHandshake: jest.fn(),
}));

const {
  ensureAdminRequest,
} = require('../src/utils/adminAccess');
const {
  resolveSessionFromRequest,
} = require('../src/utils/requestSession');

function createResponse() {
  return {
    statusCode: 200,
    contentType: null,
    body: null,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    type(value) {
      this.contentType = value;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    json(payload) {
      this.jsonBody = payload;
      return this;
    },
  };
}

describe('adminAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns an html 403 page for denied document requests', async () => {
    resolveSessionFromRequest.mockResolvedValue(null);
    const req = {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'sec-fetch-dest': 'document',
      },
    };
    const res = createResponse();

    const session = await ensureAdminRequest(req, res);

    expect(session).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.contentType).toBe('html');
    expect(res.body).toContain('Admin Access Required');
    expect(res.jsonBody).toBeNull();
  });

  test('returns json 403 for denied api requests', async () => {
    resolveSessionFromRequest.mockResolvedValue(null);
    const req = {
      headers: {
        accept: 'application/json',
      },
    };
    const res = createResponse();

    const session = await ensureAdminRequest(req, res);

    expect(session).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.jsonBody).toEqual({ message: 'Forbidden' });
    expect(res.body).toBeNull();
  });
});
