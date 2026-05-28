jest.mock('../src/models/User', () => ({
  updateMany: jest.fn(),
}));

const User = require('../src/models/User');
const { backfillMissingUsernameUpdatedFlags } = require('../src/utils/usernameFlags');

describe('username flag backfill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sets hasUpdatedUsername to false only when the field is missing', async () => {
    User.updateMany.mockResolvedValue({ matchedCount: 3, modifiedCount: 3 });

    const result = await backfillMissingUsernameUpdatedFlags();

    expect(User.updateMany).toHaveBeenCalledWith(
      { hasUpdatedUsername: { $exists: false } },
      { $set: { hasUpdatedUsername: false } }
    );
    expect(result).toEqual({ matchedCount: 3, modifiedCount: 3 });
  });
});
