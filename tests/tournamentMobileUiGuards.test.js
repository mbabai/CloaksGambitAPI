const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'public', 'index.js');
const TOURNAMENT_UI_PATH = path.join(ROOT, 'public', 'js', 'modules', 'tournaments', 'ui.js');
const UI_CSS_PATH = path.join(ROOT, 'public', 'ui.css');

describe('tournament mobile UI guards', () => {
  test('mobile game tab relayout can recover a hidden active tournament board', () => {
    const tournamentUiSource = fs.readFileSync(TOURNAMENT_UI_PATH, 'utf8');
    const indexSource = fs.readFileSync(INDEX_PATH, 'utf8');

    expect(tournamentUiSource).toContain('activeSection: activePanelSection,');
    expect(tournamentUiSource).toContain('isInTournamentGame,');
    expect(indexSource).toContain("!isPlayAreaVisible && isInTournamentGame && activeSection === 'game'");
    expect(indexSource).toContain('showPlayArea();');
  });

  test('mobile accept controls are not blocked by board synthetic-click suppression', () => {
    const indexSource = fs.readFileSync(INDEX_PATH, 'utf8');
    const uiCssSource = fs.readFileSync(UI_CSS_PATH, 'utf8');

    expect(indexSource).toContain('const allowSuppressedClick =');
    expect(indexSource).toContain('const isExternalInteractiveControl =');
    expect(indexSource).toContain('!allowSuppressedClick && !isExternalInteractiveControl');
    expect(uiCssSource).toContain('touch-action: manipulation;');
    expect(uiCssSource).toContain('-webkit-tap-highlight-color: transparent;');
  });
});
