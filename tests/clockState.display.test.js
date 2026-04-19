const path = require('path');
const { pathToFileURL } = require('url');

describe('clock display policy', () => {
  let resolveDisplayedClockMs;

  beforeAll(async () => {
    ({ resolveDisplayedClockMs } = await import(
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
});
