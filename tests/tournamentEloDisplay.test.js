const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TOURNAMENT_UI_PATH = path.join(ROOT, 'public', 'js', 'modules', 'tournaments', 'ui.js');

describe('tournament ELO display guards', () => {
  test('tournament badges prefer live ELO over pre-tournament seed ELO', () => {
    const source = fs.readFileSync(TOURNAMENT_UI_PATH, 'utf8');
    const liveEloIndex = source.indexOf('const elo = Number(entry?.elo);');
    const seedEloIndex = source.indexOf('const preTournamentElo = Number(entry?.preTournamentElo);');

    expect(liveEloIndex).toBeGreaterThanOrEqual(0);
    expect(seedEloIndex).toBeGreaterThanOrEqual(0);
    expect(liveEloIndex).toBeLessThan(seedEloIndex);
  });
});
