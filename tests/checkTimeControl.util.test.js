const checkTimeControlRouter = require('../src/routes/v1/gameAction/checkTimeControl');

const {
  resolveStartTimeMs,
  calculateElapsedMs,
  resolveTimeoutResult,
} = checkTimeControlRouter._private;

describe('checkTimeControl helpers', () => {
  afterAll(() => {
    jest.useRealTimers();
  });

  it('returns the startTime when available', () => {
    const start = new Date('2024-01-02T12:00:00Z');
    const created = new Date('2024-01-01T00:00:00Z');

    const ms = resolveStartTimeMs({ startTime: start, createdAt: created });

    expect(ms).toBe(start.getTime());
  });

  it('falls back to createdAt when startTime is missing', () => {
    const created = new Date('2024-01-05T09:30:00Z');

    const ms = resolveStartTimeMs({ startTime: null, createdAt: created });

    expect(ms).toBe(created.getTime());
  });

  it('returns null when no usable timestamps exist', () => {
    const ms = resolveStartTimeMs({ startTime: null, createdAt: null });

    expect(ms).toBeNull();
  });

  it('falls back to earliest action timestamp when startTime is missing', () => {
    const actionTime = new Date('2024-01-02T01:00:00Z');
    const created = new Date('2024-01-02T02:00:00Z');

    const ms = resolveStartTimeMs({
      startTime: null,
      createdAt: created,
      actions: [
        { timestamp: new Date('2024-01-02T01:30:00Z') },
        { timestamp: actionTime },
      ],
    });

    expect(ms).toBe(actionTime.getTime());
  });

  it('calculates elapsed time using the resolved timestamp', () => {
    const now = new Date('2024-01-03T00:00:00Z').getTime();
    const start = new Date('2024-01-02T23:59:00Z');

    const elapsed = calculateElapsedMs({ startTime: start, createdAt: null }, now);

    expect(elapsed).toBe(60000);
  });

  it('treats missing timestamps as zero elapsed', () => {
    const now = new Date('2024-01-03T00:00:00Z').getTime();

    const elapsed = calculateElapsedMs({ startTime: null, createdAt: null }, now);

    expect(elapsed).toBe(0);
  });

  it('awards a timeout win to black when white clock expires during setup', () => {
    const now = new Date('2024-01-01T00:00:06Z').getTime();
    const start = new Date('2024-01-01T00:00:00Z');

    const result = resolveTimeoutResult({
      startTime: start,
      isActive: true,
      timeControlStart: 5000,
      increment: 0,
      setupComplete: [false, true],
      playerTurn: null,
      actions: [],
    }, {
      now,
      setupActionType: 0,
    });

    expect(result.expired).toBe(true);
    expect(result.draw).toBe(false);
    expect(result.winner).toBe(1);
  });

  it('returns a draw when both clocks expire in setup', () => {
    const now = new Date('2024-01-01T00:00:06Z').getTime();
    const start = new Date('2024-01-01T00:00:00Z');

    const result = resolveTimeoutResult({
      startTime: start,
      isActive: true,
      timeControlStart: 5000,
      increment: 0,
      setupComplete: [false, false],
      playerTurn: null,
      actions: [],
    }, {
      now,
      setupActionType: 0,
    });

    expect(result.expired).toBe(true);
    expect(result.draw).toBe(true);
    expect(result.winner).toBeNull();
  });
});
