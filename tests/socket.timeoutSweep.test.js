const initSocket = require('../src/socket');

const { enforceActiveGameTimeouts } = initSocket._private;

describe('socket active game timeout sweep', () => {
  test('ends expired active games and emits a gameChanged update', async () => {
    const now = new Date('2026-03-28T12:00:00Z').getTime();
    const endGame = jest.fn(async (winner, winReason) => {
      game.winner = winner;
      game.winReason = winReason;
      game.isActive = false;
    });
    const game = {
      _id: 'game-timeout-1',
      isActive: true,
      players: ['white-user', 'black-user'],
      timeControlStart: 300000,
      clockState: {
        whiteMs: 0,
        blackMs: 182000,
        activeColor: 0,
        setupComplete: [true, true],
        tickingWhite: true,
        tickingBlack: false,
        lastUpdatedAt: now,
      },
      endGame,
      toObject() {
        return {
          _id: this._id,
          isActive: this.isActive,
          players: this.players,
          winner: this.winner,
          winReason: this.winReason,
        };
      },
    };
    const GameModel = {
      find: jest.fn(async () => [game]),
    };
    const eventBusRef = {
      emit: jest.fn(),
    };
    const getConfig = jest.fn(async () => ({
      actions: new Map([['SETUP', 0]]),
      winReasons: new Map([['TIME_CONTROL', 8]]),
    }));

    const expiredGames = await enforceActiveGameTimeouts({
      GameModel,
      getConfig,
      eventBusRef,
      now,
    });

    expect(endGame).toHaveBeenCalledWith(1, 8);
    expect(eventBusRef.emit).toHaveBeenCalledWith('gameChanged', {
      game: expect.objectContaining({
        _id: 'game-timeout-1',
        isActive: false,
        winner: 1,
        winReason: 8,
      }),
      affectedUsers: ['white-user', 'black-user'],
    });
    expect(expiredGames).toEqual([
      { gameId: 'game-timeout-1', winner: 1, draw: false },
    ]);
  });

  test('ignores active games whose clocks have not expired', async () => {
    const now = new Date('2026-03-28T12:00:00Z').getTime();
    const game = {
      _id: 'game-live-1',
      isActive: true,
      players: ['white-user', 'black-user'],
      timeControlStart: 300000,
      clockState: {
        whiteMs: 61000,
        blackMs: 182000,
        activeColor: 0,
        setupComplete: [true, true],
        tickingWhite: true,
        tickingBlack: false,
        lastUpdatedAt: now,
      },
      endGame: jest.fn(),
    };

    const expiredGames = await enforceActiveGameTimeouts({
      GameModel: {
        find: jest.fn(async () => [game]),
      },
      getConfig: jest.fn(async () => ({
        actions: new Map([['SETUP', 0]]),
        winReasons: new Map([['TIME_CONTROL', 8]]),
      })),
      eventBusRef: {
        emit: jest.fn(),
      },
      now,
    });

    expect(game.endGame).not.toHaveBeenCalled();
    expect(expiredGames).toEqual([]);
  });
});
