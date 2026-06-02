const fs = require('fs');
const path = require('path');

const DASHBOARD_MODULE = path.join(
  __dirname,
  '..',
  'public',
  'js',
  'modules',
  'history',
  'dashboard.js',
);

describe('history dashboard player name source guards', () => {
  test('history display names use bot and anonymous fallbacks instead of raw ids', () => {
    const source = fs.readFileSync(DASHBOARD_MODULE, 'utf8');

    expect(source).toContain('appendBotTypeLabel(detailName, botTypeLabel)');
    expect(source).toContain("|| 'Cloak Bot';");
    expect(source).toContain("return 'Anonymous';");
    expect(source).toContain('resolveHistoryPlayerName(match, playerIndex');
    expect(source).not.toContain('return fallback || id;');
    expect(source).not.toContain('usernameLookup(entry.id) || entry.id');
  });

  test('fox mode win reason labels use themed identities and strikes', () => {
    const source = fs.readFileSync(DASHBOARD_MODULE, 'utf8');

    expect(source).toContain('getIdentityLabelsForVisualTheme');
    expect(source).toContain('getTerminologyForVisualTheme');
    expect(source).toContain('return `Captured ${kingLabel}`;');
    expect(source).toContain('return `True ${kingLabel} Revealed`;');
    expect(source).toContain('return `${daggerLabel.charAt(0).toUpperCase()}${daggerLabel.slice(1)} Victory`;');
  });
});
