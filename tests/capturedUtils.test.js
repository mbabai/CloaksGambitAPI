const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const sharedConstants = require('../shared/constants');

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '..', 'public', 'js', 'modules', 'utils', 'captured.js')
).href;

function groupViaWorker(captured) {
  const script = `
    import(${JSON.stringify(moduleUrl)}).then(({ groupCapturedPiecesByColor }) => {
      console.log(JSON.stringify(groupCapturedPiecesByColor(${JSON.stringify(captured)})));
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

describe('captured piece UI grouping', () => {
  test('groups captured pieces by piece color instead of raw server bucket', () => {
    const whitePiece = { color: 0, identity: sharedConstants.identities.ROOK };
    const blackPiece = { color: 1, identity: sharedConstants.identities.BISHOP };

    const grouped = groupViaWorker([
      [blackPiece],
      [whitePiece],
    ]);

    expect(grouped).toEqual([
      [whitePiece],
      [blackPiece],
    ]);
  });
});
