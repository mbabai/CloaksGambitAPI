const checkTimeControlRouter = require('../src/routes/v1/gameAction/checkTimeControl');

const {
  resolveStartTimeMs,
  calculateElapsedMs,
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
});
