jest.mock('../src/models/User', () => ({
  findById: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
}));

const User = require('../src/models/User');
const ensureUser = require('../src/utils/ensureUser');

describe('ensureUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('preserves real accounts and repairs an incorrect guest flag', async () => {
    const existingUser = {
      _id: '68df60afeaebdf355cd8d015',
      username: 'Murelious',
      email: 'marcell@example.com',
      isGuest: true,
      isBot: false,
      save: jest.fn(async function save() {
        return this;
      }),
    };
    User.findById.mockResolvedValue(existingUser);

    const result = await ensureUser('68df60afeaebdf355cd8d015');

    expect(existingUser.isGuest).toBe(false);
    expect(existingUser.save).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      userId: '68df60afeaebdf355cd8d015',
      username: 'Murelious',
      isGuest: false,
    });
  });
});
