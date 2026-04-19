const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const MATCH_COUNTDOWN_PATH = path.join(ROOT, 'public', 'js', 'modules', 'ui', 'matchCountdown.js');
const INDEX_PATH = path.join(ROOT, 'public', 'index.js');

describe('match countdown banner title', () => {
  test('shared helper returns Match Found for game one and Game Starting afterwards', async () => {
    const { getMatchCountdownBannerTitle } = await import(pathToFileURL(MATCH_COUNTDOWN_PATH).href);

    expect(getMatchCountdownBannerTitle(undefined)).toBe('Match Found');
    expect(getMatchCountdownBannerTitle(1)).toBe('Match Found');
    expect(getMatchCountdownBannerTitle(2)).toBe('Game Starting');
    expect(getMatchCountdownBannerTitle(5)).toBe('Game Starting');
  });

  test('match found banner stays up for the same game until both players are ready', async () => {
    const { shouldPreserveMatchCountdownBanner } = await import(pathToFileURL(MATCH_COUNTDOWN_PATH).href);

    expect(shouldPreserveMatchCountdownBanner({
      activeBannerKind: 'match-found',
      activeBannerGameId: 'game-1',
      incomingGameId: 'game-1',
      playersReady: [false, false],
    })).toBe(true);

    expect(shouldPreserveMatchCountdownBanner({
      activeBannerKind: 'match-found',
      activeBannerGameId: 'game-1',
      incomingGameId: 'game-1',
      playersReady: [true, true],
    })).toBe(false);

    expect(shouldPreserveMatchCountdownBanner({
      activeBannerKind: 'match-found',
      activeBannerGameId: 'game-1',
      incomingGameId: 'game-2',
      playersReady: [false, false],
    })).toBe(false);
  });

  test('legacy client banner uses the shared countdown helpers', () => {
    const source = fs.readFileSync(INDEX_PATH, 'utf8');

    expect(source).toContain("import { getMatchCountdownBannerTitle, shouldPreserveMatchCountdownBanner } from '/js/modules/ui/matchCountdown.js';");
    expect(source).toContain('title.textContent = getMatchCountdownBannerTitle(currentGameNumber);');
    expect(source).toContain('const shouldPreserveCountdownBanner = shouldPreserveMatchCountdownBanner({');
    expect(source).toContain('if (!shouldPreserveCountdownBanner) {');
    expect(source).toContain('const currentGameNumber = Number.isFinite(Number(payload?.currentGameNumber))');
    expect(source).toContain('}, { gameId: nextGameId, currentGameNumber });');
  });
});
