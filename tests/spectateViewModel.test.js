const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const sharedConstants = require('../shared/constants');

const viewModelUrl = pathToFileURL(path.resolve(__dirname, '..', 'public', 'js', 'modules', 'spectate', 'viewModel.js')).href;

const ACTIONS = sharedConstants.actions;
const MOVE_STATES = sharedConstants.moveStates;
const IDENTITIES = sharedConstants.identities;

function deriveViaWorker(game) {
  const script = `
    import(${JSON.stringify(viewModelUrl)}).then(({ deriveSpectateView }) => {
      const result = deriveSpectateView(${JSON.stringify(game)});
      console.log(JSON.stringify(result));
    }).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;
  const output = execFileSync(
    process.execPath,
    ['--experimental-vm-modules', '--input-type=module', '-e', script],
    { encoding: 'utf8' }
  );
  return JSON.parse(output);
}

describe('deriveSpectateView', () => {
  const now = new Date().toISOString();

  function makePiece(identity, color) {
    return { identity, color };
  }

  test('produces overlay and pending capture for a pending move', () => {
    const game = {
      board: [
        [makePiece(IDENTITIES.UNKNOWN, 1), null, null],
        [null, makePiece(IDENTITIES.UNKNOWN, 0), null],
      ],
      moves: [
        {
          player: 0,
          from: { row: 1, col: 1 },
          to: { row: 0, col: 1 },
          declaration: IDENTITIES.ROOK,
          state: MOVE_STATES.PENDING,
        },
      ],
      actions: [
        {
          type: ACTIONS.MOVE,
          player: 0,
          timestamp: now,
          details: {
            from: { row: 1, col: 1 },
            to: { row: 0, col: 1 },
            declaration: IDENTITIES.ROOK,
          },
        },
      ],
    };

    const view = deriveViaWorker(game);
    expect(view.rows).toBe(2);
    expect(view.cols).toBe(3);
    expect(view.pendingMoveFrom).toEqual({ row: 1, col: 1 });
    expect(view.pendingCapture).toBeNull();
    expect(view.overlay).toMatchObject({
      uiC: 1,
      types: expect.arrayContaining(['rookSpeechLeft']),
      isPending: true,
    });
    expect(view.board[0][1]).toBeDefined();
    expect(view.board[1][1]).toBeNull();
  });

  test('keeps overlay after challenge success and marks removed square', () => {
    const game = {
      board: [
        [null, makePiece(IDENTITIES.UNKNOWN, 1), null],
        [null, null, null],
      ],
      moves: [
        {
          player: 0,
          from: { row: 1, col: 1 },
          to: { row: 0, col: 1 },
          declaration: IDENTITIES.BISHOP,
          state: MOVE_STATES.RESOLVED,
        },
      ],
      actions: [
        {
          type: ACTIONS.MOVE,
          player: 0,
          timestamp: now,
          details: {
            from: { row: 1, col: 1 },
            to: { row: 0, col: 1 },
            declaration: IDENTITIES.BISHOP,
          },
        },
        {
          type: ACTIONS.CHALLENGE,
          player: 1,
          timestamp: now,
          details: { outcome: 'SUCCESS' },
        },
      ],
    };

    const view = deriveViaWorker(game);
    expect(view.overlay).toMatchObject({
      uiC: 1,
      types: expect.arrayContaining(['bishopSpeechLeft']),
      isPending: false,
    });
    expect(view.challengeRemoved).toEqual({ row: 0, col: 1 });
  });

  test('handles bomb actions with pending capture of attacker', () => {
    const game = {
      board: [
        [makePiece(IDENTITIES.UNKNOWN, 0), null],
        [null, null],
      ],
      moves: [
        {
          player: 0,
          from: { row: 0, col: 0 },
          to: { row: 0, col: 1 },
          declaration: IDENTITIES.KNIGHT,
          state: MOVE_STATES.PENDING,
        },
      ],
      actions: [
        {
          type: ACTIONS.MOVE,
          player: 0,
          timestamp: now,
          details: {
            from: { row: 0, col: 0 },
            to: { row: 0, col: 1 },
            declaration: IDENTITIES.KNIGHT,
          },
        },
        {
          type: ACTIONS.BOMB,
          player: 0,
          timestamp: now,
          details: {},
        },
      ],
    };

    const view = deriveViaWorker(game);
    expect(view.overlay).toMatchObject({
      types: ['bombSpeechLeft'],
      isPending: true,
    });
    expect(view.pendingCapture).toMatchObject({ row: 0, col: 1 });
  });
});
