const {
  ensureStoredClockState,
  transitionStoredClockState,
  getLiveClockStateSnapshot,
  buildClockPayload,
} = require('../src/utils/gameClock');

describe('stored live clock state', () => {
  test('move transition keeps white and black totals on their correct sides', () => {
    const start = new Date('2024-01-01T00:00:00Z').getTime();
    const now = start + 5000;
    const game = {
      _id: 'game-clock-1',
      isActive: true,
      createdAt: new Date(start),
      startTime: new Date(start),
      timeControlStart: 300000,
      increment: 3000,
      setupComplete: [true, true],
      playerTurn: 0,
      actions: [],
      moves: [],
      markModified: jest.fn(),
    };

    ensureStoredClockState(game, {
      now,
      setupActionType: 0,
    });

    expect(game.clockState.whiteMs).toBe(295000);
    expect(game.clockState.blackMs).toBe(300000);
    expect(game.clockState.activeColor).toBe(0);
    expect(game.clockState.tickingWhite).toBe(true);
    expect(game.clockState.tickingBlack).toBe(false);

    game.playerTurn = 1;
    transitionStoredClockState(game, {
      actingColor: 0,
      now,
      setupActionType: 0,
      reason: 'move',
    });

    expect(game.clockState.whiteMs).toBe(298000);
    expect(game.clockState.blackMs).toBe(300000);
    expect(game.clockState.activeColor).toBe(1);
    expect(game.clockState.tickingWhite).toBe(false);
    expect(game.clockState.tickingBlack).toBe(true);

    const later = getLiveClockStateSnapshot(game, {
      now: start + 8000,
      setupActionType: 0,
    });
    expect(later.whiteMs).toBe(298000);
    expect(later.blackMs).toBe(297000);
    expect(later.activeColor).toBe(1);
  });

  test('response transition advances only the active responder before handing back turn', () => {
    const start = new Date('2024-01-01T00:00:00Z').getTime();
    const game = {
      _id: 'game-clock-2',
      isActive: true,
      timeControlStart: 300000,
      increment: 3000,
      setupComplete: [true, true],
      playerTurn: 0,
      clockState: {
        whiteMs: 298000,
        blackMs: 300000,
        activeColor: 1,
        setupComplete: [true, true],
        tickingWhite: false,
        tickingBlack: true,
        lastUpdatedAt: new Date(start + 5000),
      },
      markModified: jest.fn(),
    };

    game.playerTurn = 0;
    transitionStoredClockState(game, {
      actingColor: 1,
      now: start + 8000,
      setupActionType: 0,
      reason: 'bomb',
    });

    expect(game.clockState.whiteMs).toBe(298000);
    expect(game.clockState.blackMs).toBe(300000);
    expect(game.clockState.activeColor).toBe(0);
    expect(game.clockState.tickingWhite).toBe(true);
    expect(game.clockState.tickingBlack).toBe(false);
  });

  test('buildClockPayload prefers stored clock state when present', () => {
    const payload = buildClockPayload({
      isActive: true,
      timeControlStart: 300000,
      increment: 3000,
      setupComplete: [true, true],
      playerTurn: 1,
      actions: [
        { type: 1, player: 0, timestamp: new Date('2024-01-01T00:00:05Z') },
      ],
      clockState: {
        whiteMs: 298000,
        blackMs: 300000,
        activeColor: 1,
        setupComplete: [true, true],
        tickingWhite: false,
        tickingBlack: true,
        lastUpdatedAt: new Date('2024-01-01T00:00:05Z'),
      },
    }, {
      now: new Date('2024-01-01T00:00:07Z').getTime(),
      setupActionType: 0,
    });

    expect(payload.whiteMs).toBe(298000);
    expect(payload.blackMs).toBe(298000);
    expect(payload.activeColor).toBe(1);
    expect(payload.tickingBlack).toBe(true);
  });
});
