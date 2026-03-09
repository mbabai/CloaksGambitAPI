const {
  buildClockPayload,
} = require('../src/utils/gameClock');

describe('buildClockPayload', () => {
  test('marks only the unfinished side as ticking during setup', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const payload = buildClockPayload({
      startTime: start,
      isActive: true,
      timeControlStart: 300000,
      increment: 3000,
      setupComplete: [true, false],
      playerTurn: null,
      actions: [],
    }, {
      now: new Date('2024-01-01T00:00:05Z').getTime(),
      setupActionType: 0,
    });

    expect(payload.tickingWhite).toBe(false);
    expect(payload.tickingBlack).toBe(true);
    expect(payload.whiteMs).toBe(300000);
    expect(payload.blackMs).toBe(295000);
    expect(payload.label).toBe('5m + 3s');
  });

  test('stops ticking and uses endTime for completed games', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const moveAt = new Date('2024-01-01T00:00:05Z');
    const end = new Date('2024-01-01T00:00:08Z');
    const payload = buildClockPayload({
      startTime: start,
      endTime: end,
      isActive: false,
      timeControlStart: 180000,
      increment: 3000,
      setupComplete: [true, true],
      playerTurn: 1,
      actions: [
        { type: 0, player: 0, timestamp: start },
        { type: 0, player: 1, timestamp: start },
        { type: 1, player: 0, timestamp: moveAt },
      ],
    }, {
      now: new Date('2024-01-01T00:00:20Z').getTime(),
      setupActionType: 0,
    });

    expect(payload.tickingWhite).toBe(false);
    expect(payload.tickingBlack).toBe(false);
    expect(payload.whiteMs).toBe(178000);
    expect(payload.blackMs).toBe(177000);
    expect(payload.label).toBe('3m + 3s');
  });
});
