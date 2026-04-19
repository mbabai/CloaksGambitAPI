const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BANNERS_PATH = path.join(ROOT, 'public', 'js', 'modules', 'ui', 'banners.js');
const ELO_BADGE_PATH = path.join(ROOT, 'public', 'js', 'modules', 'render', 'eloBadge.js');
const BARS_PATH = path.join(ROOT, 'public', 'js', 'modules', 'render', 'bars.js');
const UI_CSS_PATH = path.join(ROOT, 'public', 'ui.css');

describe('elo badge renderer source guards', () => {
  test('shared name rows append the badge after the player name', () => {
    const source = fs.readFileSync(BANNERS_PATH, 'utf8');
    const rankedBlockMatch = source.match(
      /if \(badge\) \{\s*nameContent\.appendChild\(nameWrap\);\s*nameContent\.appendChild\(badge\);\s*\} else \{\s*nameContent\.appendChild\(nameWrap\);\s*\}/
    );

    expect(rankedBlockMatch).not.toBeNull();
  });

  test('standard elo badge keeps the font size while tightening the shell ratios', () => {
    const source = fs.readFileSync(ELO_BADGE_PATH, 'utf8');

    expect(source).toContain('const fontSize = Math.max(10, Math.floor(baseSize * 0.44));');
    expect(source).toContain('const horizontalPadding = Math.round(baseSize * 0.42);');
    expect(source).toContain('const verticalPadding = Math.round(baseSize * 0.22);');
    expect(source).toContain('const badgeWidth = Math.max(Math.round(baseSize * 1.55), estimatedTextWidth + horizontalPadding);');
    expect(source).toContain('const badgeHeight = Math.max(Math.round(baseSize * 1.18), fontSize + verticalPadding * 2);');
  });

  test('game bars use per-player badge flags instead of showing badges unconditionally', () => {
    const source = fs.readFileSync(BARS_PATH, 'utf8');

    expect(source).toContain('showEloBadge: isTopBar ? showEloTop : showEloBottom,');
  });

  test('shared elo badge value shifts downward by thirty percent of the configured font size', () => {
    const source = fs.readFileSync(UI_CSS_PATH, 'utf8');

    expect(source).toContain(
      'transform: translateY(var(--cg-elo-badge-value-offset, calc(var(--cg-elo-badge-font-size, 13px) * 0.3)));'
    );
  });
});
