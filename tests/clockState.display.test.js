const path = require('path');
const { pathToFileURL } = require('url');

describe('clock display policy', () => {
  let advanceClockSnapshot;
  let resolveDisplayedClockMs;

  beforeAll(async () => {
    ({ advanceClockSnapshot, resolveDisplayedClockMs } = await import(
      pathToFileURL(path.resolve(__dirname, '../public/js/modules/utils/clockState.js')).href
    ));
  });

  test('prefers the authoritative live clock during setup before startTime exists', () => {
    expect(resolveDisplayedClockMs({
      colorIdx: 0,
      whiteTimeMs: 292315,
      blackTimeMs: 299969,
      expectedTimeControl: 300000,
      gameStartTime: null,
      hasAuthoritativeClock: true,
    })).toBe(292315);
  });

  test('falls back to the expected time control only before any authoritative clock exists', () => {
    expect(resolveDisplayedClockMs({
      colorIdx: 1,
      whiteTimeMs: 0,
      blackTimeMs: 0,
      expectedTimeControl: 300000,
      gameStartTime: null,
      hasAuthoritativeClock: false,
    })).toBe(300000);
  });

  test('holds an authoritative snapshot steady until the scheduled start time', () => {
    const receivedAt = new Date('2024-01-01T00:00:00Z').getTime();
    const startsAt = new Date('2024-01-01T00:00:03Z');
    const base = {
      whiteMs: 300000,
      blackMs: 300000,
      activeColor: null,
      setupComplete: [false, false],
      tickingWhite: true,
      tickingBlack: true,
      label: '5m + 3s',
      receivedAt,
    };

    expect(advanceClockSnapshot(base, receivedAt + 2000, { startsAt }).whiteMs).toBe(300000);
    expect(advanceClockSnapshot(base, receivedAt + 2000, { startsAt }).blackMs).toBe(300000);
    expect(advanceClockSnapshot(base, receivedAt + 4000, { startsAt }).whiteMs).toBe(299000);
    expect(advanceClockSnapshot(base, receivedAt + 4000, { startsAt }).blackMs).toBe(299000);
  });
});
