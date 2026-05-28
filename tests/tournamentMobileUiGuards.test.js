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
    const tournamentUiSource = fs.readFileSync(TOURNAMENT_UI_PATH, 'utf8');
    const uiCssSource = fs.readFileSync(UI_CSS_PATH, 'utf8');

    expect(indexSource).toContain('const allowSuppressedClick =');
    expect(indexSource).toContain('const isTournamentPanelControl =');
    expect(indexSource).toContain('const isExternalInteractiveControl =');
    expect(indexSource).toContain('!allowSuppressedClick && !isTournamentPanelControl && !isExternalInteractiveControl');
    expect(tournamentUiSource).toContain("extendBtn.addEventListener('pointerdown', submitAcceptExtension);");
    expect(uiCssSource).toContain('touch-action: manipulation;');
    expect(uiCssSource).toContain('-webkit-tap-highlight-color: transparent;');
  });

  test('tournament shell controls stack above the body-mounted board layer', () => {
    const indexSource = fs.readFileSync(INDEX_PATH, 'utf8');
    const uiCssSource = fs.readFileSync(UI_CSS_PATH, 'utf8');

    expect(indexSource).toContain("playAreaRoot.style.zIndex = '1000';");
    expect(indexSource).toContain('if (!isInTournamentGame) {');
    expect(indexSource).toContain('playAreaRoot.style.pointerEvents = \'none\';');
    expect(uiCssSource).toContain('.tournament-panel {');
    expect(uiCssSource).toContain('z-index: 1200;');
    expect(uiCssSource).toContain('pointer-events: none;');
    expect(uiCssSource).toContain('.tournament-panel__card {');
    expect(uiCssSource).toContain('pointer-events: auto;');
  });

  test('tournament accept prompt clears blocking banner overlays without blocking page controls', () => {
    const indexSource = fs.readFileSync(INDEX_PATH, 'utf8');

    expect(indexSource).toContain('function hideSharedBannerOverlay');
    expect(indexSource).toContain("hideSharedBannerOverlay({ restoreFocus: false, clearTimer: !alreadyShowingThisAccept });");
    expect(indexSource).toContain("shell.className = 'tournament-accept-banner-shell';");
    expect(indexSource).toContain("shell.style.pointerEvents = 'none';");
    expect(indexSource).toContain("acceptBtn.style.pointerEvents = 'auto';");
    expect(indexSource).toContain('document.body.appendChild(shell);');
  });

  test('repeated tournament game-active updates do not rerender the panel', () => {
    const tournamentUiSource = fs.readFileSync(TOURNAMENT_UI_PATH, 'utf8');

    expect(tournamentUiSource).toContain('const nextInTournamentGame = Boolean(inGame);');
    expect(tournamentUiSource).toContain('if (wasInTournamentGame === nextInTournamentGame) {');
    expect(tournamentUiSource).toContain('return;');
  });

  test('single-elimination final results omit the redemption column', () => {
    const tournamentUiSource = fs.readFileSync(TOURNAMENT_UI_PATH, 'utf8');
    const uiCssSource = fs.readFileSync(UI_CSS_PATH, 'utf8');

    expect(tournamentUiSource).toContain('function shouldShowRedemptionResultsColumn(tournament)');
    expect(tournamentUiSource).toContain("return bracketType === 'double';");
    expect(tournamentUiSource).toContain('if (showRedemptionColumn) {');
    expect(tournamentUiSource).toContain('Deepest Redemption');
    expect(tournamentUiSource).toContain('tournament-panel__results-header--no-redemption');
    expect(tournamentUiSource).toContain('tournament-panel__results-row--no-redemption');
    expect(uiCssSource).toContain('.tournament-panel__results-header--no-redemption');
    expect(uiCssSource).toContain('.tournament-panel__results-row--no-redemption');
  });
});
