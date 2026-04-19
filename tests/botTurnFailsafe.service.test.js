const {
  BOT_TURN_FAILSAFE_MS,
  createBotTurnFailsafe,
} = require('../src/services/bots/turnFailsafe');

function makeQuery(result) {
  return {
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

function buildGame(overrides = {}) {
  return {
    _id: 'game-1',
    isActive: true,
    players: ['human-1', 'bot-1'],
    setupComplete: [true, true],
    playersReady: [true, true],
    playerTurn: 1,
    onDeckingPlayer: null,
    onDecks: [
      { identity: 1, color: 0 },
      { identity: 4, color: 1 },
    ],
    actions: [
      { type: 1, player: 0, timestamp: new Date('2026-04-08T23:40:00.000Z') },
    ],
    moves: [],
    createdAt: new Date('2026-04-08T23:39:30.000Z'),
    ...overrides,
  };
}

describe('bot turn failsafe service', () => {
  let currentNow;
  let eventBusRef;
  let ensureBotClient;
  let debugLog;
  let setTimer;
  let clearTimer;

  beforeEach(() => {
    jest.useFakeTimers();
    currentNow = new Date('2026-04-08T23:40:00.000Z').getTime();
    eventBusRef = {
      emit: jest.fn(),
    };
    ensureBotClient = jest.fn(async () => null);
    debugLog = jest.fn();
    setTimer = jest.fn((handler, delay) => setTimeout(handler, delay));
    clearTimer = jest.fn((handle) => clearTimeout(handle));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('schedules a watchdog when a bot-owned turn is active', async () => {
    const game = buildGame();
    const service = createBotTurnFailsafe({
      GameModel: {
        findById: jest.fn(async () => game),
        find: jest.fn(async () => [game]),
      },
      UserModel: {
        find: jest.fn(() => makeQuery([
          { _id: 'bot-1', isBot: true, botDifficulty: 'medium' },
        ])),
      },
      eventBusRef,
      ensureBotClient,
      hasConnectedUser: () => false,
      debugLog,
      now: () => currentNow,
      setTimer,
      clearTimer,
    });

    const scheduled = await service.scheduleGame(game, { reason: 'test' });

    expect(scheduled).toMatchObject({
      gameId: 'game-1',
      botPlayers: ['bot-1'],
      scheduledDelayMs: BOT_TURN_FAILSAFE_MS,
    });
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), BOT_TURN_FAILSAFE_MS);
    expect(eventBusRef.emit).not.toHaveBeenCalled();
  });

  test('does not schedule when only a human can act', async () => {
    const game = buildGame({
      players: ['bot-1', 'human-1'],
      playerTurn: 1,
    });
    const service = createBotTurnFailsafe({
      GameModel: {
        findById: jest.fn(async () => game),
        find: jest.fn(async () => [game]),
      },
      UserModel: {
        find: jest.fn(() => makeQuery([
          { _id: 'human-1', isBot: false, botDifficulty: null },
        ])),
      },
      eventBusRef,
      ensureBotClient,
      hasConnectedUser: () => false,
      debugLog,
      now: () => currentNow,
      setTimer,
      clearTimer,
    });

    const scheduled = await service.scheduleGame(game, { reason: 'test' });

    expect(scheduled).toBeNull();
    expect(setTimer).not.toHaveBeenCalled();
    expect(eventBusRef.emit).not.toHaveBeenCalled();
  });

  test('recovers a stalled bot turn after five seconds', async () => {
    const game = buildGame();
    const GameModel = {
      findById: jest.fn(async () => game),
      find: jest.fn(async () => [game]),
    };
    const service = createBotTurnFailsafe({
      GameModel,
      UserModel: {
        find: jest.fn(() => makeQuery([
          { _id: 'bot-1', isBot: true, botDifficulty: 'medium' },
        ])),
      },
      eventBusRef,
      ensureBotClient,
      hasConnectedUser: () => false,
      debugLog,
      now: () => currentNow,
      setTimer,
      clearTimer,
    });

    await service.scheduleGame(game, { reason: 'test' });

    currentNow += BOT_TURN_FAILSAFE_MS;
    await jest.advanceTimersByTimeAsync(BOT_TURN_FAILSAFE_MS);

    expect(ensureBotClient).toHaveBeenCalledWith({
      difficulty: 'medium',
      userId: 'bot-1',
    });
    expect(eventBusRef.emit).toHaveBeenCalledWith('gameChanged', expect.objectContaining({
      game: game,
      affectedUsers: ['human-1', 'bot-1'],
      initiator: { action: 'bot-turn-failsafe' },
      botPlayers: ['bot-1'],
    }));
  });

  test('skips recovery when the game state already progressed', async () => {
    const scheduledGame = buildGame();
    const progressedGame = buildGame({
      playerTurn: 0,
      actions: [
        { type: 1, player: 0, timestamp: new Date('2026-04-08T23:40:02.000Z') },
      ],
    });
    const GameModel = {
      findById: jest.fn(async () => progressedGame),
      find: jest.fn(async () => [scheduledGame]),
    };
    const service = createBotTurnFailsafe({
      GameModel,
      UserModel: {
        find: jest.fn((query) => {
          const ids = query?._id?.$in || [];
          const users = ids.map((id) => (
            id === 'bot-1'
              ? { _id: 'bot-1', isBot: true, botDifficulty: 'medium' }
              : { _id: 'human-1', isBot: false, botDifficulty: null }
          ));
          return makeQuery(users);
        }),
      },
      eventBusRef,
      ensureBotClient,
      hasConnectedUser: () => false,
      debugLog,
      now: () => currentNow,
      setTimer,
      clearTimer,
    });

    await service.scheduleGame(scheduledGame, { reason: 'test' });

    currentNow += BOT_TURN_FAILSAFE_MS;
    await jest.advanceTimersByTimeAsync(BOT_TURN_FAILSAFE_MS);

    expect(ensureBotClient).not.toHaveBeenCalled();
    expect(eventBusRef.emit).not.toHaveBeenCalled();
  });

  test('bootstraps overdue active bot games without waiting another five seconds', async () => {
    const overdueGame = buildGame({
      actions: [
        { type: 1, player: 0, timestamp: new Date('2026-04-08T23:39:40.000Z') },
      ],
    });
    const GameModel = {
      findById: jest.fn(async () => overdueGame),
      find: jest.fn(async () => [overdueGame]),
    };
    const service = createBotTurnFailsafe({
      GameModel,
      UserModel: {
        find: jest.fn(() => makeQuery([
          { _id: 'bot-1', isBot: true, botDifficulty: 'medium' },
        ])),
      },
      eventBusRef,
      ensureBotClient,
      hasConnectedUser: () => false,
      debugLog,
      now: () => currentNow,
      setTimer,
      clearTimer,
    });

    const results = await service.bootstrapActiveGames();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      gameId: 'game-1',
      botPlayers: ['bot-1'],
      scheduledDelayMs: 0,
    });
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 0);
  });
});
