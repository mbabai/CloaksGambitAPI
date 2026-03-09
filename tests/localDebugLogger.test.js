const fs = require('fs');

const {
  appendLocalDebugLog,
  getLocalDebugLogPaths,
} = require('../src/utils/localDebugLogger');

describe('local debug logger', () => {
  const previousFlag = process.env.CG_LOCAL_GAME_LOGS;

  beforeEach(() => {
    process.env.CG_LOCAL_GAME_LOGS = 'true';
    const { dir } = getLocalDebugLogPaths();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (previousFlag === undefined) {
      delete process.env.CG_LOCAL_GAME_LOGS;
    } else {
      process.env.CG_LOCAL_GAME_LOGS = previousFlag;
    }
  });

  test('writes searchable jsonl records to the temp debug file', () => {
    const file = appendLocalDebugLog('clock-transition', {
      gameId: 'game-debug-1',
      marker: 'clock-marker-123',
    });

    expect(file).toBeTruthy();
    expect(fs.existsSync(file)).toBe(true);

    const contents = fs.readFileSync(file, 'utf8');
    expect(contents).toContain('"event":"clock-transition"');
    expect(contents).toContain('"gameId":"game-debug-1"');
    expect(contents).toContain('"marker":"clock-marker-123"');
  });
});
