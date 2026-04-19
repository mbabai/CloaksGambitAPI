const initSocket = require('../src/socket');

const { enforceTournamentAcceptTimeoutForGame } = initSocket._private;

describe('socket tournament accept timeout handling', () => {
  test('round robin accept timeout emits gameChanged after awarding the ready player a win', async () => {
    const endGame = jest.fn(async (winner, winReason) => {
      game.winner = winner;
      game.winReason = winReason;
      game.isActive = false;
    });
    const game = {
      _id: 'rr-timeout-1',
      isActive: true,
      match: 'rr-match-1',
      players: ['user-a', 'user-b'],
      playersReady: [true, false],
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
    const match = {
      _id: 'rr-match-1',
      isActive: true,
      type: 'TOURNAMENT_ROUND_ROBIN',
    };
    const eventBusRef = {
      emit: jest.fn(),
    };

    const result = await enforceTournamentAcceptTimeoutForGame('rr-timeout-1', {
      GameModel: { findById: jest.fn(async () => game) },
      MatchModel: { findById: jest.fn(async () => match) },
      eventBusRef,
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      matchType: 'TOURNAMENT_ROUND_ROBIN',
      winnerColor: 0,
    }));
    expect(endGame).toHaveBeenCalledWith(0, expect.any(Number));
    expect(eventBusRef.emit).toHaveBeenCalledWith('gameChanged', {
      game: expect.objectContaining({
        _id: 'rr-timeout-1',
        isActive: false,
        winner: 0,
      }),
      affectedUsers: ['user-a', 'user-b'],
    });
  });

  test('round robin accept timeout emits gameChanged after counting double no-shows as zero-point losses', async () => {
    const endGame = jest.fn(async (winner, winReason) => {
      game.winner = winner;
      game.winReason = winReason;
      game.isActive = false;
    });
    const game = {
      _id: 'rr-timeout-2',
      isActive: true,
      match: 'rr-match-2',
      players: ['user-c', 'user-d'],
      playersReady: [false, false],
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
    const match = {
      _id: 'rr-match-2',
      isActive: true,
      type: 'TOURNAMENT_ROUND_ROBIN',
    };
    const eventBusRef = {
      emit: jest.fn(),
    };

    const result = await enforceTournamentAcceptTimeoutForGame('rr-timeout-2', {
      GameModel: { findById: jest.fn(async () => game) },
      MatchModel: { findById: jest.fn(async () => match) },
      eventBusRef,
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      matchType: 'TOURNAMENT_ROUND_ROBIN',
      winnerColor: null,
    }));
    expect(endGame).toHaveBeenCalledWith(null, expect.any(Number));
    expect(game.tournamentScoreOutcome).toBe('double_no_show_loss');
    expect(eventBusRef.emit).toHaveBeenCalledWith('gameChanged', {
      game: expect.objectContaining({
        _id: 'rr-timeout-2',
        isActive: false,
        winner: null,
      }),
      affectedUsers: ['user-c', 'user-d'],
    });
  });

  test('elimination accept timeout awards a double no-show to the better seed', async () => {
    const endGame = jest.fn();
    const game = {
      _id: 'elim-timeout-1',
      isActive: true,
      match: 'elim-match-1',
      players: ['user-b', 'user-a'],
      playersReady: [false, false],
      endGame,
      save: jest.fn(async () => game),
      toObject() {
        return {
          _id: this._id,
          isActive: this.isActive,
          players: this.players,
          winner: this.winner,
          winReason: this.winReason,
          match: this.match,
        };
      },
    };
    const match = {
      _id: 'elim-match-1',
      isActive: true,
      type: 'TOURNAMENT_ELIMINATION',
      tournamentId: 'tour-1',
      player1: 'user-a',
      player2: 'user-b',
      endMatch: jest.fn(async () => match),
    };
    const eventBusRef = {
      emit: jest.fn(),
    };

    const result = await enforceTournamentAcceptTimeoutForGame('elim-timeout-1', {
      GameModel: { findById: jest.fn(async () => game) },
      MatchModel: { findById: jest.fn(async () => match) },
      eventBusRef,
      getTournamentDetailsFn: jest.fn(async () => ({
        players: [
          { userId: 'user-a', seed: 1 },
          { userId: 'user-b', seed: 2 },
        ],
      })),
      finalizeClockState: jest.fn(),
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      matchType: 'TOURNAMENT_ELIMINATION',
      winnerColor: 1,
    }));
    expect(game.winner).toBe(1);
    expect(match.endMatch).toHaveBeenCalledWith('user-a');
  });
});
