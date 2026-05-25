const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '..', 'public', 'js', 'modules', 'utils', 'matchScores.js')
).href;

function resolveViaWorker(input) {
  const script = `
    import(${JSON.stringify(moduleUrl)}).then(({ getVisibleMatchWinCounts }) => {
      console.log(JSON.stringify(getVisibleMatchWinCounts(${JSON.stringify(input)})));
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

describe('match score side HUD mapping', () => {
  test('keeps tournament win thrones attached to match players when game colors are swapped', () => {
    const match = {
      player1: { _id: 'player-a' },
      player2: { _id: 'player-b' },
      player1Score: 1,
      player2Score: 0,
    };

    expect(resolveViaWorker({
      match,
      currentPlayerIds: ['player-b', 'player-a'],
      currentIsWhite: true,
    })).toEqual({
      winsTop: 1,
      winsBottom: 0,
    });

    expect(resolveViaWorker({
      match,
      currentPlayerIds: ['player-b', 'player-a'],
      currentIsWhite: false,
    })).toEqual({
      winsTop: 0,
      winsBottom: 1,
    });
  });
});
