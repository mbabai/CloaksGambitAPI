const express = require('express');
const request = require('supertest');

jest.mock('../src/models/User', () => ({
  find: jest.fn(),
}));

const User = require('../src/models/User');
const userGetListRouter = require('../src/routes/v1/users/getList');

function createQueryChain(value) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/users/getList', userGetListRouter);
  return app;
}

describe('users/getList route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('excludes guest and Anonymous-number accounts from the admin user list', async () => {
    const query = createQueryChain([
      { _id: 'u1', username: 'Murelious', isGuest: false },
    ]);
    User.find.mockReturnValueOnce(query);

    const response = await request(createApp())
      .post('/api/v1/users/getList')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { _id: 'u1', username: 'Murelious', isGuest: false },
    ]);
    expect(User.find).toHaveBeenCalledWith({
      isGuest: { $ne: true },
      $and: [
        { username: { $not: /^anonymous\d+$/i } },
      ],
    });
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(query.limit).toHaveBeenCalledWith(50);
  });
});
