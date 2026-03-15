const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const sharedConstants = require('../shared/constants');

const responseWindowUrl = pathToFileURL(path.resolve(__dirname, '..', 'public', 'js', 'shared', 'responseWindow.js')).href;

function runResponseWindowExpression(expression) {
  const script = `
    import(${JSON.stringify(responseWindowUrl)}).then((mod) => {
      const result = (${expression})(mod);
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

describe('response window helper', () => {
  test('opens the bomb response window for the original mover', () => {
    const result = runResponseWindowExpression(`
      ({ getResponseWindowState }) => getResponseWindowState({
        isMyTurn: true,
        isInSetup: false,
        currentOnDeckingPlayer: null,
        myColor: 0,
        lastMove: {
          player: 0,
          state: ${sharedConstants.moveStates.PENDING},
          from: { row: 1, col: 1 },
          to: { row: 2, col: 1 },
        },
        lastAction: {
          type: ${sharedConstants.actions.BOMB},
          player: 1,
        },
        lastMoveAction: {
          type: ${sharedConstants.actions.BOMB},
          player: 1,
        },
        latestMoveContext: {
          isPending: true,
          actor: 0,
          action: {
            type: ${sharedConstants.actions.MOVE},
            player: 0,
          },
        },
      })
    `);

    expect(result.responseWindowOpen).toBe(true);
    expect(result.responseAction.type).toBe(sharedConstants.actions.BOMB);
    expect(result.responseActor).toBe(1);
  });

  test('opens the move response window only for the defending player', () => {
    const result = runResponseWindowExpression(`
      ({ getResponseWindowState }) => getResponseWindowState({
        isMyTurn: true,
        isInSetup: false,
        currentOnDeckingPlayer: null,
        myColor: 1,
        lastMove: {
          player: 0,
          state: ${sharedConstants.moveStates.PENDING},
          from: { row: 1, col: 1 },
          to: { row: 2, col: 1 },
        },
        lastAction: {
          type: ${sharedConstants.actions.MOVE},
          player: 0,
        },
        lastMoveAction: {
          type: ${sharedConstants.actions.MOVE},
          player: 0,
        },
        latestMoveContext: {
          isPending: true,
          actor: 0,
          action: {
            type: ${sharedConstants.actions.MOVE},
            player: 0,
          },
        },
      })
    `);

    expect(result.responseWindowOpen).toBe(true);
    expect(result.responseAction.type).toBe(sharedConstants.actions.MOVE);
    expect(result.responseActor).toBe(0);
  });
});
