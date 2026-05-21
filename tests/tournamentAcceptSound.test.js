const path = require('path');
const { pathToFileURL } = require('url');

describe('tournament accept sound guard', () => {
  let isTournamentAcceptSoundAllowed;
  let normalizeAcceptSoundGameId;

  beforeAll(async () => {
    ({ isTournamentAcceptSoundAllowed, normalizeAcceptSoundGameId } = await import(
      pathToFileURL(path.resolve(__dirname, '../public/js/modules/tournaments/acceptSound.js')).href
    ));
  });

  test('allows the loop only while the matching accept banner is visible', () => {
    expect(isTournamentAcceptSoundAllowed({
      activeBannerKind: 'tournament-accept',
      activeBannerGameId: 'game-1',
      gameId: 'game-1',
      isBannerVisible: () => true,
    })).toBe(true);

    expect(isTournamentAcceptSoundAllowed({
      activeBannerKind: 'tournament-accept',
      activeBannerGameId: 'game-1',
      gameId: 'game-1',
      isBannerVisible: () => false,
    })).toBe(false);
  });

  test('rejects stale, missing, or non-accept banner state', () => {
    expect(isTournamentAcceptSoundAllowed({
      activeBannerKind: 'game-finished',
      activeBannerGameId: 'game-1',
      gameId: 'game-1',
      isBannerVisible: () => true,
    })).toBe(false);

    expect(isTournamentAcceptSoundAllowed({
      activeBannerKind: 'tournament-accept',
      activeBannerGameId: 'game-1',
      gameId: 'game-2',
      isBannerVisible: () => true,
    })).toBe(false);

    expect(isTournamentAcceptSoundAllowed({
      activeBannerKind: 'tournament-accept',
      activeBannerGameId: 'game-1',
      gameId: null,
      isBannerVisible: () => true,
    })).toBe(false);
  });

  test('normalizes only non-empty game ids', () => {
    expect(normalizeAcceptSoundGameId(123)).toBe('123');
    expect(normalizeAcceptSoundGameId('')).toBe(null);
    expect(normalizeAcceptSoundGameId(null)).toBe(null);
  });
});
