const sharedConstants = require('../shared/constants');
const {
  TUTORIAL_STEPS,
  prepareIntroTutorialGame,
  setTutorialStep,
  getTutorialStep,
  advanceTutorialStep,
} = require('../src/services/tutorials/runtime');

function buildConfig() {
  return {
    actions: new Map(Object.entries(sharedConstants.actions)),
    moveStates: new Map(Object.entries(sharedConstants.moveStates)),
    identities: new Map(Object.entries(sharedConstants.identities)),
    winReasons: new Map(Object.entries(sharedConstants.winReasons)),
    colors: new Map(Object.entries(sharedConstants.colors)),
    boardDimensions: sharedConstants.boardDimensions,
  };
}

function buildPiece(color, identity) {
  return { color, identity };
}

function buildStartingStash(color, identities) {
  return [
    buildPiece(color, identities.get('KING')),
    buildPiece(color, identities.get('BOMB')),
    buildPiece(color, identities.get('BISHOP')),
    buildPiece(color, identities.get('BISHOP')),
    buildPiece(color, identities.get('ROOK')),
    buildPiece(color, identities.get('ROOK')),
    buildPiece(color, identities.get('KNIGHT')),
    buildPiece(color, identities.get('KNIGHT')),
  ];
}

function buildTutorialGame(config) {
  const rows = config.boardDimensions.RANKS;
  const cols = config.boardDimensions.FILES;
  return {
    _id: 'tutorial-game-1',
    isTutorial: true,
    isActive: true,
    winner: null,
    winReason: null,
    players: ['white-player', 'tutorial-bot'],
    board: Array.from({ length: rows }, () => Array(cols).fill(null)),
    stashes: [
      buildStartingStash(0, config.identities),
      buildStartingStash(1, config.identities),
    ],
    onDecks: [null, null],
    captured: [[], []],
    daggers: [0, 0],
    actions: [],
    moves: [],
    setupComplete: [false, false],
    playersReady: [false, false],
    playerTurn: null,
    onDeckingPlayer: null,
    movesSinceAction: 0,
    tutorialState: { id: 'intro', step: 1 },
    markModified: jest.fn(),
    save: jest.fn(async () => {}),
    addAction(type, player, details = {}) {
      this.actions.push({
        type,
        player,
        details,
        timestamp: new Date(),
      });
    },
    async endGame(winner, winReason) {
      this.isActive = false;
      this.winner = winner;
      this.winReason = winReason;
    },
  };
}

function consumeFromStash(stash, color, identity) {
  const index = stash.findIndex((piece) => piece && piece.color === color && piece.identity === identity);
  if (index === -1) {
    throw new Error(`Missing stash piece ${identity} for color ${color}`);
  }
  return stash.splice(index, 1)[0];
}

function seedWhiteTutorialSetup(game, config) {
  const white = config.colors.get('WHITE');
  const stash = game.stashes[0];
  const placements = [
    { row: 0, col: 0, identity: config.identities.get('KING') },
    { row: 0, col: 1, identity: config.identities.get('ROOK') },
    { row: 0, col: 2, identity: config.identities.get('KNIGHT') },
    { row: 0, col: 3, identity: config.identities.get('BISHOP') },
    { row: 0, col: 4, identity: config.identities.get('BISHOP') },
  ];

  placements.forEach(({ row, col, identity }) => {
    const piece = consumeFromStash(stash, white, identity);
    game.board[row][col] = piece;
  });

  game.onDecks[0] = consumeFromStash(stash, white, config.identities.get('BOMB'));
  game.stashes[0] = stash;
  game.setupComplete[0] = true;
}

describe('tutorial runtime', () => {
  const config = buildConfig();

  test('prepareIntroTutorialGame seeds the scripted black setup', () => {
    const game = buildTutorialGame(config);

    prepareIntroTutorialGame(game, config);

    expect(game.board[5][0]).toEqual(expect.objectContaining({ color: 1, identity: sharedConstants.identities.BISHOP }));
    expect(game.board[5][1]).toEqual(expect.objectContaining({ color: 1, identity: sharedConstants.identities.KNIGHT }));
    expect(game.board[5][2]).toEqual(expect.objectContaining({ color: 1, identity: sharedConstants.identities.ROOK }));
    expect(game.board[5][3]).toEqual(expect.objectContaining({ color: 1, identity: sharedConstants.identities.KING }));
    expect(game.board[5][4]).toEqual(expect.objectContaining({ color: 1, identity: sharedConstants.identities.BISHOP }));
    expect(game.onDecks[1]).toEqual(expect.objectContaining({ color: 1, identity: sharedConstants.identities.ROOK }));
    expect(game.setupComplete).toEqual([false, true]);
    expect(game.playersReady).toEqual([false, false]);
    expect(game.playerTurn).toBeNull();
    expect(getTutorialStep(game)).toBe(TUTORIAL_STEPS.SETUP);
    expect(game.actions).toHaveLength(1);
    expect(game.actions[0]).toEqual(expect.objectContaining({
      type: sharedConstants.actions.SETUP,
      player: 1,
    }));
  });

  test('advanceTutorialStep scripts the bot rook advance after the player rook move', async () => {
    const game = buildTutorialGame(config);
    prepareIntroTutorialGame(game, config);
    seedWhiteTutorialSetup(game, config);

    game.moves.push({
      player: 0,
      from: { row: 0, col: 1 },
      to: { row: 3, col: 1 },
      declaration: sharedConstants.identities.ROOK,
      state: sharedConstants.moveStates.PENDING,
      timestamp: new Date('2026-04-22T12:00:00Z'),
    });
    game.actions.push({
      type: sharedConstants.actions.MOVE,
      player: 0,
      details: {
        from: { row: 0, col: 1 },
        to: { row: 3, col: 1 },
        declaration: sharedConstants.identities.ROOK,
      },
      timestamp: new Date('2026-04-22T12:00:00Z'),
    });
    game.playerTurn = 1;
    setTutorialStep(game, TUTORIAL_STEPS.POST_ROOK_MOVE);

    await advanceTutorialStep(game, {
      color: 0,
      config,
      now: new Date('2026-04-22T12:00:05Z').getTime(),
    });

    expect(game.board[3][1]).toEqual(expect.objectContaining({ color: 0, identity: sharedConstants.identities.ROOK }));
    expect(game.board[0][1]).toBeNull();
    expect(game.moves).toHaveLength(2);
    expect(game.moves[0].state).toBe(sharedConstants.moveStates.RESOLVED);
    expect(game.moves[1]).toEqual(expect.objectContaining({
      player: 1,
      from: { row: 5, col: 0 },
      to: { row: 4, col: 0 },
      declaration: sharedConstants.identities.ROOK,
      state: sharedConstants.moveStates.PENDING,
    }));
    expect(getTutorialStep(game)).toBe(TUTORIAL_STEPS.MOVE_KING_AS_ROOK);
  });

  test('advanceTutorialStep scripts the first bot bluff after the king is declared as a rook', async () => {
    const game = buildTutorialGame(config);
    prepareIntroTutorialGame(game, config);
    seedWhiteTutorialSetup(game, config);

    game.moves.push({
      player: 0,
      from: { row: 0, col: 0 },
      to: { row: 1, col: 0 },
      declaration: sharedConstants.identities.ROOK,
      state: sharedConstants.moveStates.PENDING,
      timestamp: new Date('2026-04-22T12:01:00Z'),
    });
    game.actions.push({
      type: sharedConstants.actions.MOVE,
      player: 0,
      details: {
        from: { row: 0, col: 0 },
        to: { row: 1, col: 0 },
        declaration: sharedConstants.identities.ROOK,
      },
      timestamp: new Date('2026-04-22T12:01:00Z'),
    });
    game.playerTurn = 1;
    setTutorialStep(game, TUTORIAL_STEPS.POST_KING_ROOK_MOVE);

    await advanceTutorialStep(game, {
      color: 0,
      config,
      now: new Date('2026-04-22T12:01:05Z').getTime(),
    });

    expect(game.board[1][0]).toEqual(expect.objectContaining({ color: 0, identity: sharedConstants.identities.KING }));
    expect(game.board[0][0]).toBeNull();
    expect(game.moves).toHaveLength(2);
    expect(game.moves[0].state).toBe(sharedConstants.moveStates.RESOLVED);
    expect(game.moves[1]).toEqual(expect.objectContaining({
      player: 1,
      from: { row: 5, col: 4 },
      to: { row: 3, col: 3 },
      declaration: sharedConstants.identities.KNIGHT,
      state: sharedConstants.moveStates.PENDING,
    }));
    expect(getTutorialStep(game)).toBe(TUTORIAL_STEPS.POST_BOT_BLUFF);
  });

  test('advanceTutorialStep scripts the failed bot challenge and replaces the bishop with the bomb', async () => {
    const game = buildTutorialGame(config);
    prepareIntroTutorialGame(game, config);
    seedWhiteTutorialSetup(game, config);

    game.moves.push({
      player: 0,
      from: { row: 0, col: 4 },
      to: { row: 2, col: 2 },
      declaration: sharedConstants.identities.BISHOP,
      state: sharedConstants.moveStates.PENDING,
      timestamp: new Date('2026-04-22T12:10:00Z'),
    });
    game.actions.push({
      type: sharedConstants.actions.MOVE,
      player: 0,
      details: {
        from: { row: 0, col: 4 },
        to: { row: 2, col: 2 },
        declaration: sharedConstants.identities.BISHOP,
      },
      timestamp: new Date('2026-04-22T12:10:00Z'),
    });
    game.playerTurn = 1;
    setTutorialStep(game, TUTORIAL_STEPS.EXPLAIN_BOT_FAILED_CHALLENGE);

    await advanceTutorialStep(game, {
      color: 0,
      config,
      now: new Date('2026-04-22T12:10:05Z').getTime(),
    });

    expect(game.daggers).toEqual([0, 1]);
    expect(game.board[0][4]).toBeNull();
    expect(game.board[2][2]).toEqual(expect.objectContaining({
      color: 0,
      identity: sharedConstants.identities.BOMB,
    }));
    expect(game.onDecks[0]).toBeNull();
    expect(game.onDeckingPlayer).toBe(0);
    expect(getTutorialStep(game)).toBe(TUTORIAL_STEPS.AFTER_BOT_FAILED_CHALLENGE);
  });
});
