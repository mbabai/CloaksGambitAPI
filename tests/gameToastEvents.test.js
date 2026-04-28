const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const sharedConstants = require('../shared/constants');

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '..', 'public', 'js', 'modules', 'ui', 'gameToastEvents.js')
).href;

const ACTIONS = sharedConstants.actions;
const IDENTITIES = sharedConstants.identities;

function deriveViaWorker(input) {
  const script = `
    import(${JSON.stringify(moduleUrl)}).then(({ createGameToastSnapshot, deriveGameToastFeedback }) => {
      const previous = createGameToastSnapshot(${JSON.stringify(input.previous)});
      const current = createGameToastSnapshot(${JSON.stringify(input.current)});
      const feedback = deriveGameToastFeedback({
        previous,
        current,
        viewerColor: ${JSON.stringify(input.viewerColor ?? null)},
        viewMode: ${JSON.stringify(input.viewMode ?? 'player')},
      });
      console.log(JSON.stringify(feedback));
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

function makePiece(identity, color) {
  return { identity, color };
}

describe('gameToastEvents', () => {
  test('queues opponent bomb feedback before the turn toast for players', () => {
    const previous = {
      _id: 'game-1',
      playerTurn: 1,
      actions: [
        { type: ACTIONS.MOVE, player: 1, details: {} },
      ],
      daggers: [0, 0],
      captured: [[], []],
    };
    const current = {
      _id: 'game-1',
      playerTurn: 0,
      actions: [
        { type: ACTIONS.MOVE, player: 1, details: {} },
        { type: ACTIONS.BOMB, player: 1, details: {} },
      ],
      daggers: [0, 0],
      captured: [[], []],
    };

    const feedback = deriveViaWorker({ previous, current, viewerColor: 0 });

    expect(feedback.toasts).toEqual([
      {
        text: 'Poison!',
        tone: 'danger',
        placement: 'board-center',
        appearance: 'board-alert',
        durationMs: 1400,
      },
      {
        text: 'Your turn!',
        tone: 'light',
        placement: 'board-center',
        appearance: 'board-turn',
        durationMs: 1400,
      },
    ]);
  });

  test('queues challenge resolution before the turn toast for players', () => {
    const previous = {
      _id: 'game-2',
      playerTurn: 1,
      actions: [
        { type: ACTIONS.MOVE, player: 1, details: {} },
      ],
      daggers: [0, 0],
      captured: [[], []],
    };
    const current = {
      _id: 'game-2',
      playerTurn: 0,
      actions: [
        { type: ACTIONS.MOVE, player: 1, details: {} },
        { type: ACTIONS.CHALLENGE, player: 0, details: { outcome: 'SUCCESS' } },
      ],
      daggers: [0, 0],
      captured: [[], []],
    };

    const feedback = deriveViaWorker({ previous, current, viewerColor: 0 });

    expect(feedback.toasts).toEqual([
      {
        text: 'Challenge Successful!',
        tone: 'danger',
        placement: 'board-center',
        appearance: 'board-alert',
        durationMs: 1400,
      },
      {
        text: 'Your turn!',
        tone: 'light',
        placement: 'board-center',
        appearance: 'board-turn',
        durationMs: 1400,
      },
    ]);
  });

  test('spectator mode only emits color-based turn text', () => {
    const previous = {
      _id: 'game-3',
      playerTurn: 1,
      actions: [
        { type: ACTIONS.MOVE, player: 1, details: {} },
      ],
      daggers: [0, 0],
      captured: [[], []],
    };
    const current = {
      _id: 'game-3',
      playerTurn: 0,
      actions: [
        { type: ACTIONS.MOVE, player: 1, details: {} },
        { type: ACTIONS.BOMB, player: 1, details: {} },
      ],
      daggers: [0, 0],
      captured: [[], []],
    };

    const feedback = deriveViaWorker({ previous, current, viewMode: 'spectator' });

    expect(feedback.toasts).toEqual([
      {
        text: 'White\'s turn',
        tone: 'light',
        placement: 'board-center',
        appearance: 'board-turn',
        durationMs: 1400,
      },
    ]);
  });

  test('detects dagger gains and newly added captured pieces', () => {
    const previous = {
      _id: 'game-4',
      playerTurn: 0,
      actions: [],
      daggers: [0, 0],
      captured: [[makePiece(IDENTITIES.UNKNOWN, 0)], []],
    };
    const current = {
      _id: 'game-4',
      playerTurn: 0,
      actions: [],
      daggers: [1, 0],
      captured: [[
        makePiece(IDENTITIES.UNKNOWN, 0),
        makePiece(IDENTITIES.UNKNOWN, 0),
        makePiece(IDENTITIES.KNIGHT, 0),
      ], []],
    };

    const feedback = deriveViaWorker({ previous, current, viewerColor: 0 });

    expect(feedback.pulses.daggerColors).toEqual([
      { color: 0, durationMs: 1500 },
    ]);
    expect(feedback.pulses.captured).toEqual([
      { color: 0, index: 1, durationMs: 1500 },
      { color: 0, index: 2, durationMs: 1500 },
    ]);
  });

  test('ignores the first snapshot of a different game', () => {
    const previous = {
      _id: 'game-5',
      playerTurn: 0,
      actions: [],
      daggers: [0, 0],
      captured: [[], []],
    };
    const current = {
      _id: 'game-6',
      playerTurn: 1,
      actions: [
        { type: ACTIONS.CHALLENGE, player: 1, details: { outcome: 'FAIL' } },
      ],
      daggers: [1, 0],
      captured: [[makePiece(IDENTITIES.BISHOP, 0)], []],
    };

    const feedback = deriveViaWorker({ previous, current, viewerColor: 0 });

    expect(feedback).toEqual({
      toasts: [],
      pulses: {
        daggerColors: [],
        captured: [],
      },
    });
  });
});
