const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const sharedConstants = require('../shared/constants');

const modesUrl = pathToFileURL(path.resolve(__dirname, '..', 'public', 'js', 'modules', 'gameView', 'modes.js')).href;

const IDENTITIES = sharedConstants.identities;

function runModesExpression(expression) {
  const script = `
    import(${JSON.stringify(modesUrl)}).then((modes) => {
      const result = (${expression})(modes);
      console.log(JSON.stringify(result));
    }).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8' }
  );
  return JSON.parse(output);
}

describe('game view modes', () => {
  test('normalizes supported view modes', () => {
    const result = runModesExpression(`
      ({ normalizeGameViewMode, GAME_VIEW_MODES }) => ({
        defaultMode: normalizeGameViewMode(),
        spectator: normalizeGameViewMode('spectator'),
        godAlias: normalizeGameViewMode('admin'),
        invalidFallsBack: normalizeGameViewMode('weird'),
        modes: GAME_VIEW_MODES,
      })
    `);

    expect(result.defaultMode).toBe('player');
    expect(result.spectator).toBe('spectator');
    expect(result.godAlias).toBe('god');
    expect(result.invalidFallsBack).toBe('player');
    expect(result.modes).toMatchObject({
      PLAYER: 'player',
      SPECTATOR: 'spectator',
      GOD: 'god',
    });
  });

  test('player and spectator masking transform identities correctly', () => {
    const result = runModesExpression(`
      ({ createPieceVisibilityTransform }) => {
        const playerTransform = createPieceVisibilityTransform({ mode: 'player', viewerColor: 0 });
        const spectatorTransform = createPieceVisibilityTransform({ mode: 'spectator' });
        const godTransform = createPieceVisibilityTransform({ mode: 'god' });
        const whiteKing = { identity: ${IDENTITIES.KING}, color: 0 };
        const blackRook = { identity: ${IDENTITIES.ROOK}, color: 1 };
        return {
          playerOwn: playerTransform(whiteKing),
          playerEnemy: playerTransform(blackRook),
          spectatorWhite: spectatorTransform(whiteKing),
          spectatorBlack: spectatorTransform(blackRook),
          godEnemy: godTransform(blackRook),
        };
      }
    `);

    expect(result.playerOwn).toMatchObject({ identity: IDENTITIES.KING, color: 0 });
    expect(result.playerEnemy).toMatchObject({ identity: IDENTITIES.UNKNOWN, color: 1 });
    expect(result.spectatorWhite).toMatchObject({ identity: IDENTITIES.UNKNOWN, color: 0 });
    expect(result.spectatorBlack).toMatchObject({ identity: IDENTITIES.UNKNOWN, color: 1 });
    expect(result.godEnemy).toMatchObject({ identity: IDENTITIES.ROOK, color: 1 });
  });
});
