let mockLobbyState;

jest.mock('../src/models/Match', () => ({
  create: jest.fn(),
}));

jest.mock('../src/models/Game', () => ({
  create: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../src/utils/getServerConfig', () => jest.fn());

jest.mock('../src/eventBus', () => ({
  emit: jest.fn(),
}));

jest.mock('../src/models/User', () => ({
  findById: jest.fn(),
}));

jest.mock('../src/utils/ensureUser', () => jest.fn(async () => ({})));

jest.mock('../src/state/lobby', () => ({
  getState: jest.fn(() => mockLobbyState),
  removeFromQueue: jest.fn((queueName, userId) => {
    const queueKey = queueName === 'ranked' ? 'rankedQueue' : 'quickplayQueue';
    mockLobbyState[queueKey] = (mockLobbyState[queueKey] || []).filter((entry) => entry !== userId);
    return { removed: true };
  }),
  addInGame: jest.fn((players) => {
    mockLobbyState.inGame = Array.from(new Set([...(mockLobbyState.inGame || []), ...players]));
    return { added: true };
  }),
  emitQueueChanged: jest.fn(() => mockLobbyState),
}));

const Match = require('../src/models/Match');
const Game = require('../src/models/Game');
const User = require('../src/models/User');
const eventBus = require('../src/eventBus');
const ensureUser = require('../src/utils/ensureUser');
const getServerConfig = require('../src/utils/getServerConfig');
const { checkAndCreateMatches } = require('../src/routes/v1/lobby/matchmaking');

describe('matchmaking clock settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLobbyState = {
      quickplayQueue: [],
      rankedQueue: [],
      inGame: [],
    };
    getServerConfig.mockResolvedValue({
      gameModes: {
        QUICKPLAY: 'QUICKPLAY',
        RANKED: 'RANKED',
      },
      gameModeSettings: {
        QUICKPLAY: { TIME_CONTROL: 480000 },
        RANKED: { TIME_CONTROL: 210000 },
        INCREMENT: 5000,
      },
    });
    Match.create.mockImplementation(async (payload) => ({
      _id: `${payload.type}-match-1`,
      games: [],
      type: payload.type,
      save: jest.fn(async () => {}),
    }));
    Game.create.mockImplementation(async (payload) => ({
      _id: `${payload.match}-game-1`,
      players: payload.players,
      toObject() {
        return {
          _id: this._id,
          players: this.players,
        };
      },
    }));
    Game.updateOne.mockResolvedValue({ acknowledged: true });
    User.findById.mockImplementation((id) => ({
      lean: jest.fn(async () => ({ _id: id, elo: 812 })),
    }));
  });

  test('quickplay matchmaking creates games with quickplay clock settings', async () => {
    mockLobbyState.quickplayQueue = ['player-1', 'player-2'];

    await checkAndCreateMatches();

    expect(ensureUser).toHaveBeenCalledTimes(2);
    expect(Game.create).toHaveBeenCalledWith(expect.objectContaining({
      timeControlStart: 480000,
      increment: 5000,
    }));
    expect(eventBus.emit).toHaveBeenCalledWith('players:bothNext', expect.objectContaining({
      currentGameNumber: 1,
    }));
  });

  test('ranked matchmaking creates games with ranked clock settings', async () => {
    mockLobbyState.rankedQueue = ['player-a', 'player-b'];
    User.findById
      .mockImplementationOnce((id) => ({
        lean: jest.fn(async () => ({ _id: id, elo: 1010 })),
      }))
      .mockImplementationOnce((id) => ({
        lean: jest.fn(async () => ({ _id: id, elo: 990 })),
      }));

    await checkAndCreateMatches();

    expect(Game.create).toHaveBeenCalledWith(expect.objectContaining({
      timeControlStart: 210000,
      increment: 5000,
    }));
    expect(Match.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'RANKED',
      player1StartElo: 1010,
      player2StartElo: 990,
    }));
    expect(eventBus.emit).toHaveBeenCalledWith('players:bothNext', expect.objectContaining({
      currentGameNumber: 1,
    }));
  });
});
