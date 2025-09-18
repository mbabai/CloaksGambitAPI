const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const sharedConstants = require('../shared/constants');

const artifactUrl = pathToFileURL(path.resolve(__dirname, '..', 'public', 'js', 'shared', 'gameConstants.js')).href;

describe('Browser game constants artifact', () => {
  it('matches the backend shared constants payload', () => {
    const script = `
      import(${JSON.stringify(artifactUrl)}).then((mod) => {
        console.log(JSON.stringify({
          GAME_CONSTANTS: mod.GAME_CONSTANTS,
          GAME_MODES: mod.GAME_MODES,
          WIN_REASONS: mod.WIN_REASONS,
          MOVE_STATES: mod.MOVE_STATES
        }));
      }).catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `;

    const output = execFileSync(process.execPath, [
      '--experimental-vm-modules',
      '--input-type=module',
      '-e',
      script
    ], { encoding: 'utf8' });

    const moduleSnapshot = JSON.parse(output);

    expect(moduleSnapshot.GAME_CONSTANTS).toEqual(sharedConstants.GAME_CONSTANTS);
    expect(moduleSnapshot.GAME_MODES).toEqual(sharedConstants.gameModes);
    expect(moduleSnapshot.WIN_REASONS).toEqual(sharedConstants.winReasons);
    expect(moduleSnapshot.MOVE_STATES).toEqual(sharedConstants.moveStates);
  });
});
