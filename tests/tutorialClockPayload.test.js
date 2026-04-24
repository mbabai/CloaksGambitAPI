const {
  areClocksDisabled,
  buildClockPayload,
  resolveTimeoutResult,
} = require('../src/utils/gameClock');

describe('tutorial clock behavior', () => {
  test('tutorial games disable clock rendering and timeout resolution', () => {
    const game = {
      isTutorial: true,
      isActive: true,
      timeControlStart: 300000,
      increment: 3000,
      setupComplete: [true, true],
      playerTurn: 0,
      actions: [],
    };

    expect(areClocksDisabled(game)).toBe(true);
    expect(buildClockPayload(game, {
      now: new Date('2026-04-22T12:00:00Z').getTime(),
      setupActionType: 0,
    })).toBeNull();
    expect(resolveTimeoutResult(game, {
      now: new Date('2026-04-22T12:00:00Z').getTime(),
      setupActionType: 0,
    })).toEqual({
      expired: false,
      winner: null,
      draw: false,
      clock: null,
    });
  });
});
