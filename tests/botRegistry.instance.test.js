const mockUserStore = new Map();
let mockNextUserId = 1;

jest.mock('../src/models/User', () => ({
  findOne: jest.fn((query = {}) => ({
    lean: jest.fn(async () => {
      const cloneUser = (user) => {
        if (!user) return null;
        return {
          ...user,
          toObject() {
            return { ...this };
          },
        };
      };
      if (query.email) {
        return cloneUser(mockUserStore.get(`email:${query.email}`));
      }
      if (query.username) {
        return cloneUser(mockUserStore.get(`username:${query.username}`));
      }
      return null;
    }),
  })),
  create: jest.fn(async (payload = {}) => {
    const created = {
      _id: `bot-user-${mockNextUserId}`,
      ...payload,
      toObject() {
        return { ...this };
      },
    };
    mockNextUserId += 1;
    mockUserStore.set(`email:${created.email}`, created);
    mockUserStore.set(`username:${created.username}`, created);
    return created;
  }),
}));

jest.mock('../src/utils/authTokens', () => ({
  createAuthToken: jest.fn((user) => `token-${user?._id || 'unknown'}`),
}));

const User = require('../src/models/User');
const {
  ensureBotUserInstance,
  getBuiltinBotDefinition,
  listBuiltinBotCatalog,
} = require('../src/services/bots/registry');

describe('bot registry instance users', () => {
  beforeEach(() => {
    mockUserStore.clear();
    mockNextUserId = 1;
    User.findOne.mockClear();
    User.create.mockClear();
  });

  test('reuses the same bot user for the same instance key', async () => {
    const first = await ensureBotUserInstance({ difficulty: 'medium', instanceKey: 'tour_bot_alpha' });
    const second = await ensureBotUserInstance({ difficulty: 'medium', instanceKey: 'tour_bot_alpha' });

    expect(first.user._id).toBe(second.user._id);
    expect(first.user.email).toBe(second.user.email);
    expect(User.create).toHaveBeenCalledTimes(1);
  });

  test('creates distinct bot users for distinct instance keys of the same difficulty', async () => {
    const first = await ensureBotUserInstance({ difficulty: 'medium', instanceKey: 'tour_bot_alpha' });
    const second = await ensureBotUserInstance({ difficulty: 'medium', instanceKey: 'tour_bot_beta' });

    expect(first.user._id).not.toBe(second.user._id);
    expect(first.user.email).not.toBe(second.user.email);
    expect(first.user.username).not.toBe(second.user.username);
    expect(first.user.botDifficulty).toBe('medium');
    expect(second.user.botDifficulty).toBe('medium');
  });

  test('keeps hard bot listed but unavailable', () => {
    const hard = getBuiltinBotDefinition('hard');
    const catalogHard = listBuiltinBotCatalog().find((item) => item.id === 'hard');

    expect(hard.playable).toBe(false);
    expect(hard.unavailableMessage).toBe('Hard bot under construction');
    expect(catalogHard).toEqual(expect.objectContaining({
      id: 'hard',
      playable: false,
      unavailableMessage: 'Hard bot under construction',
    }));
  });
});
