const path = require('path');
const { pathToFileURL } = require('url');

describe('clock sync preservation policy', () => {
  let shouldPreserveClockSnapshot;

  beforeAll(async () => {
    ({ shouldPreserveClockSnapshot } = await import(
      pathToFileURL(path.resolve(__dirname, '../public/js/modules/utils/clockSyncPolicy.js')).href
    ));
  });

  test('preserves the current live clock when the same active game payload omits clocks', () => {
    const preserve = shouldPreserveClockSnapshot({
      incomingClockSnapshot: null,
      currentClockSnapshot: {
        whiteMs: 298947,
        blackMs: 247740,
        activeColor: 1,
      },
      currentClockGameId: 'game-123',
      incomingGameId: 'game-123',
      gameFinished: false,
      setupComplete: [true, true],
      actionCount: 6,
      moveCount: 1,
      playerTurn: 1,
    });

    expect(preserve).toBe(true);
  });

  test('does not preserve a clock across game boundaries or when an incoming clock exists', () => {
    expect(shouldPreserveClockSnapshot({
      incomingClockSnapshot: null,
      currentClockSnapshot: { whiteMs: 1, blackMs: 1 },
      currentClockGameId: 'game-123',
      incomingGameId: 'game-999',
      gameFinished: false,
      setupComplete: [true, true],
      actionCount: 6,
      moveCount: 1,
      playerTurn: 1,
    })).toBe(false);

    expect(shouldPreserveClockSnapshot({
      incomingClockSnapshot: { whiteMs: 10, blackMs: 20 },
      currentClockSnapshot: { whiteMs: 1, blackMs: 1 },
      currentClockGameId: 'game-123',
      incomingGameId: 'game-123',
      gameFinished: false,
      setupComplete: [true, true],
      actionCount: 6,
      moveCount: 1,
      playerTurn: 1,
    })).toBe(false);
  });
});
