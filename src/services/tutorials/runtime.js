const { isDeclaredMoveLegal, getLastMove, isPendingMove, resolvePendingMove } = require('../game/liveGameRules');
const { applyChallengeAction } = require('../game/challengeAction');
const { transitionStoredClockState } = require('../../utils/gameClock');

const INTRO_TUTORIAL_ID = 'intro';

const TUTORIAL_STEPS = Object.freeze({
  SETUP: 1,
  FIRST_TURN: 3,
  POST_ROOK_MOVE: 5,
  MOVE_KING_AS_ROOK: 6,
  POST_KING_ROOK_MOVE: 8,
  POST_BOT_BLUFF: 9,
  CHALLENGE_BOT_BLUFF: 10,
  MOVE_BISHOP: 11,
  EXPLAIN_BOT_FAILED_CHALLENGE: 12,
  AFTER_BOT_FAILED_CHALLENGE: 13,
  ON_DECK_ROOK: 14,
  BEFORE_BOT_ROOK_CAPTURE: 15,
  AFTER_BOT_ROOK_CAPTURE: 16,
  DECLARE_BOMB: 17,
  AFTER_BOMB_DECLARATION: 18,
  ON_DECK_ANY: 19,
  BLUFF_WITH_LEFT_ROOK: 20,
  BEFORE_BOT_CHALLENGE_SUCCESS: 21,
  AFTER_BOT_CHALLENGE_SUCCESS: 22,
  AFTER_BOT_KING_MOVE: 23,
  EXPLAIN_TRUE_KING_RISK: 24,
  EXPLAIN_WIN_CONDITIONS: 25,
  CAPTURE_KING_WITH_ROOK: 26,
  BEFORE_FINAL_CHALLENGE: 27,
  AFTER_FINAL_CHALLENGE: 28,
  CONGRATULATIONS: 29,
  SHOW_FINISH_BANNER: 30,
});

function createTutorialError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function cloneTutorialState(game) {
  if (!game?.tutorialState || typeof game.tutorialState !== 'object') {
    return { id: INTRO_TUTORIAL_ID, step: TUTORIAL_STEPS.SETUP };
  }
  return {
    ...game.tutorialState,
    id: typeof game.tutorialState.id === 'string' && game.tutorialState.id.trim()
      ? game.tutorialState.id.trim()
      : INTRO_TUTORIAL_ID,
    step: Number.isFinite(Number(game.tutorialState.step))
      ? Number(game.tutorialState.step)
      : TUTORIAL_STEPS.SETUP,
  };
}

function setTutorialStep(game, step) {
  const next = cloneTutorialState(game);
  next.step = step;
  game.tutorialState = next;
  if (typeof game.markModified === 'function') {
    game.markModified('tutorialState');
  }
  return next;
}

function getTutorialStep(game) {
  if (!game?.isTutorial) return null;
  return cloneTutorialState(game).step;
}

function isTutorialGame(game) {
  return Boolean(game?.isTutorial);
}

function buildTutorialPayload(game) {
  if (!isTutorialGame(game)) return null;
  const state = cloneTutorialState(game);
  return {
    active: true,
    id: state.id,
    step: state.step,
    hideClocks: true,
  };
}

function consumePieceFromStash(stash, color, identity) {
  const index = Array.isArray(stash)
    ? stash.findIndex((piece) => piece && piece.color === color && piece.identity === identity)
    : -1;
  if (index === -1) {
    throw new Error(`Tutorial piece not available in stash: ${identity}`);
  }
  return stash.splice(index, 1)[0];
}

function prepareIntroTutorialGame(game, config) {
  if (!isTutorialGame(game)) {
    return game;
  }

  const colors = config.colors;
  const identities = config.identities;
  const white = colors.get('WHITE');
  const black = colors.get('BLACK');
  const blackRank = config.boardDimensions.RANKS - 1;

  const blackStash = Array.isArray(game.stashes?.[1]) ? game.stashes[1] : [];
  const blackPieces = [
    { row: blackRank, col: 0, identity: identities.get('BISHOP') },
    { row: blackRank, col: 1, identity: identities.get('KNIGHT') },
    { row: blackRank, col: 2, identity: identities.get('ROOK') },
    { row: blackRank, col: 3, identity: identities.get('KING') },
    { row: blackRank, col: 4, identity: identities.get('BISHOP') },
  ].map((entry) => {
    const piece = consumePieceFromStash(blackStash, black, entry.identity);
    return { ...piece, row: entry.row, col: entry.col };
  });

  blackPieces.forEach((piece) => {
    game.board[piece.row][piece.col] = {
      color: black,
      identity: piece.identity,
    };
  });

  game.onDecks[1] = consumePieceFromStash(blackStash, black, identities.get('ROOK'));
  game.stashes[1] = blackStash;
  game.setupComplete = [false, true];
  game.playersReady = [false, false];
  game.playerTurn = null;
  game.onDeckingPlayer = null;
  setTutorialStep(game, TUTORIAL_STEPS.SETUP);

  game.addAction(
    config.actions.get('SETUP'),
    1,
    {
      pieces: blackPieces.map((piece) => ({
        identity: piece.identity,
        row: piece.row,
        col: piece.col,
      })),
      onDeck: {
        identity: game.onDecks[1].identity,
      },
      tutorial: true,
      color: black,
      whiteColor: white,
    }
  );

  return game;
}

function validateTutorialSetup(game, { pieces, onDeck, color, config }) {
  if (!isTutorialGame(game)) return null;
  if (color !== 0) {
    return 'Tutorial setup must be completed by the white player.';
  }
  if (getTutorialStep(game) !== TUTORIAL_STEPS.SETUP) {
    return 'Tutorial setup is no longer available.';
  }

  const identities = config.identities;
  const expectedRank = 0;
  const expectedByCol = new Map([
    [0, identities.get('KING')],
    [1, identities.get('ROOK')],
    [2, identities.get('KNIGHT')],
    [3, identities.get('BISHOP')],
    [4, identities.get('BISHOP')],
  ]);

  if (!Array.isArray(pieces) || pieces.length !== expectedByCol.size) {
    return 'Tutorial setup requires the fixed tutorial layout.';
  }
  if (!onDeck || onDeck.identity !== identities.get('BOMB') || onDeck.color !== color) {
    return 'Tutorial setup requires the bomb on deck.';
  }

  for (const piece of pieces) {
    if (!piece || piece.color !== color || piece.row !== expectedRank) {
      return 'Tutorial setup requires the fixed tutorial layout.';
    }
    if (!expectedByCol.has(piece.col)) {
      return 'Tutorial setup requires the fixed tutorial layout.';
    }
    const expectedIdentity = expectedByCol.get(piece.col);
    if (piece.identity !== expectedIdentity) {
      return 'Tutorial setup requires the fixed tutorial layout.';
    }
  }

  return null;
}

function validateExpectedMove(step, from, to, declaration, config) {
  const identities = config.identities;
  const expected = new Map([
    [TUTORIAL_STEPS.FIRST_TURN, { from: { row: 0, col: 1 }, to: { row: 3, col: 1 }, declaration: identities.get('ROOK') }],
    [TUTORIAL_STEPS.MOVE_KING_AS_ROOK, { from: { row: 0, col: 0 }, to: { row: 1, col: 0 }, declaration: identities.get('ROOK') }],
    [TUTORIAL_STEPS.MOVE_BISHOP, { from: { row: 0, col: 4 }, to: { row: 2, col: 2 }, declaration: identities.get('BISHOP') }],
    [TUTORIAL_STEPS.BLUFF_WITH_LEFT_ROOK, { from: { row: 3, col: 1 }, to: { row: 5, col: 3 }, declaration: identities.get('BISHOP') }],
    [TUTORIAL_STEPS.CAPTURE_KING_WITH_ROOK, { from: { row: 2, col: 2 }, to: { row: 5, col: 2 }, declaration: identities.get('ROOK') }],
  ]);

  const entry = expected.get(step);
  if (!entry) return 'Tutorial move is not allowed right now.';
  const matches = (
    from?.row === entry.from.row
    && from?.col === entry.from.col
    && to?.row === entry.to.row
    && to?.col === entry.to.col
    && declaration === entry.declaration
  );
  return matches ? null : 'Tutorial move is not allowed right now.';
}

function validateTutorialMove(game, { from, to, declaration, color, config }) {
  if (!isTutorialGame(game)) return null;
  if (color !== 0) {
    return 'Only the white player may make tutorial moves.';
  }
  return validateExpectedMove(getTutorialStep(game), from, to, declaration, config);
}

function validateTutorialChallenge(game, { color }) {
  if (!isTutorialGame(game)) return null;
  if (color !== 0) {
    return 'Only the white player may challenge in the tutorial.';
  }
  return getTutorialStep(game) === TUTORIAL_STEPS.CHALLENGE_BOT_BLUFF
    ? null
    : 'Challenge is not available right now in the tutorial.';
}

function validateTutorialBomb(game, { color }) {
  if (!isTutorialGame(game)) return null;
  if (color !== 0) {
    return 'Only the white player may declare bomb in the tutorial.';
  }
  return getTutorialStep(game) === TUTORIAL_STEPS.DECLARE_BOMB
    ? null
    : 'Bomb is not available right now in the tutorial.';
}

function validateTutorialOnDeck(game, { color, piece, config }) {
  if (!isTutorialGame(game)) return null;
  if (color !== 0) {
    return 'Only the white player may place tutorial on-deck pieces.';
  }

  const step = getTutorialStep(game);
  const identity = Number(piece?.identity);
  if (!Number.isFinite(identity)) {
    return 'Invalid tutorial on-deck piece.';
  }

  if (step === TUTORIAL_STEPS.ON_DECK_ROOK) {
    return identity === config.identities.get('ROOK')
      ? null
      : 'The tutorial requires placing the rook on deck.';
  }

  if (step === TUTORIAL_STEPS.ON_DECK_ANY) {
    return identity === config.identities.get('KING')
      ? 'The king cannot be placed on deck.'
      : null;
  }

  return 'On-deck is not available right now in the tutorial.';
}

function advanceTutorialAfterSetup(game) {
  if (!isTutorialGame(game)) return;
  if (getTutorialStep(game) === TUTORIAL_STEPS.SETUP) {
    setTutorialStep(game, TUTORIAL_STEPS.FIRST_TURN);
  }
}

function advanceTutorialAfterMove(game) {
  if (!isTutorialGame(game)) return;
  const step = getTutorialStep(game);
  if (step === TUTORIAL_STEPS.FIRST_TURN) {
    setTutorialStep(game, TUTORIAL_STEPS.POST_ROOK_MOVE);
  } else if (step === TUTORIAL_STEPS.MOVE_KING_AS_ROOK) {
    setTutorialStep(game, TUTORIAL_STEPS.POST_KING_ROOK_MOVE);
  } else if (step === TUTORIAL_STEPS.MOVE_BISHOP) {
    setTutorialStep(game, TUTORIAL_STEPS.EXPLAIN_BOT_FAILED_CHALLENGE);
  } else if (step === TUTORIAL_STEPS.BLUFF_WITH_LEFT_ROOK) {
    setTutorialStep(game, TUTORIAL_STEPS.BEFORE_BOT_CHALLENGE_SUCCESS);
  } else if (step === TUTORIAL_STEPS.CAPTURE_KING_WITH_ROOK) {
    setTutorialStep(game, TUTORIAL_STEPS.BEFORE_FINAL_CHALLENGE);
  }
}

function advanceTutorialAfterChallenge(game, { success }) {
  if (!isTutorialGame(game)) return;
  if (getTutorialStep(game) === TUTORIAL_STEPS.CHALLENGE_BOT_BLUFF && success) {
    setTutorialStep(game, TUTORIAL_STEPS.MOVE_BISHOP);
  }
}

function advanceTutorialAfterBomb(game) {
  if (!isTutorialGame(game)) return;
  if (getTutorialStep(game) === TUTORIAL_STEPS.DECLARE_BOMB) {
    setTutorialStep(game, TUTORIAL_STEPS.AFTER_BOMB_DECLARATION);
  }
}

function advanceTutorialAfterOnDeck(game) {
  if (!isTutorialGame(game)) return;
  const step = getTutorialStep(game);
  if (step === TUTORIAL_STEPS.ON_DECK_ROOK) {
    setTutorialStep(game, TUTORIAL_STEPS.BEFORE_BOT_ROOK_CAPTURE);
  } else if (step === TUTORIAL_STEPS.ON_DECK_ANY) {
    setTutorialStep(game, TUTORIAL_STEPS.BLUFF_WITH_LEFT_ROOK);
  }
}

async function recordScriptedMove(game, { player, from, to, declaration }, config, now = Date.now()) {
  if (!game.isActive) {
    throw createTutorialError('Tutorial game is not active.');
  }

  const previousMove = getLastMove(game);
  if (isPendingMove(previousMove, config)) {
    const ended = await resolvePendingMove(game, previousMove, config);
    if (ended) {
      throw createTutorialError('Tutorial game ended before the scripted move could resolve.');
    }
  }

  const piece = game.board?.[from.row]?.[from.col];
  if (!piece) {
    throw new Error('Tutorial scripted move is missing its source piece.');
  }
  if (piece.color !== player) {
    throw new Error('Tutorial scripted move source piece color mismatch.');
  }

  const target = game.board?.[to.row]?.[to.col] || null;
  if (target && target.color === player) {
    throw new Error('Tutorial scripted move target is occupied by the same color.');
  }
  if (!isDeclaredMoveLegal(game.board, from, to, declaration, config)) {
    throw new Error('Tutorial scripted move is not legal.');
  }

  game.moves.push({
    player,
    from: { ...from },
    to: { ...to },
    declaration,
    state: config.moveStates.get('PENDING'),
    timestamp: new Date(now),
  });
  game.playerTurn = player === 0 ? 1 : 0;

  transitionStoredClockState(game, {
    actingColor: player,
    now,
    setupActionType: config.actions.get('SETUP'),
    reason: 'tutorial-scripted-move',
  });

  await game.addAction(config.actions.get('MOVE'), player, {
    from: { ...from },
    to: { ...to },
    declaration,
  });
  await game.save();
}

async function advanceTutorialStep(game, { color, config, now = Date.now() }) {
  if (!isTutorialGame(game)) {
    throw createTutorialError('This game is not a tutorial game.');
  }
  if (color !== 0) {
    throw createTutorialError('Only the white player may advance the tutorial.');
  }

  const identities = config.identities;
  const step = getTutorialStep(game);
  switch (step) {
    case TUTORIAL_STEPS.POST_ROOK_MOVE:
      await recordScriptedMove(game, {
        player: 1,
        from: { row: 5, col: 0 },
        to: { row: 4, col: 0 },
        declaration: identities.get('ROOK'),
      }, config, now);
      setTutorialStep(game, TUTORIAL_STEPS.MOVE_KING_AS_ROOK);
      break;
    case TUTORIAL_STEPS.POST_KING_ROOK_MOVE:
      await recordScriptedMove(game, {
        player: 1,
        from: { row: 5, col: 4 },
        to: { row: 3, col: 3 },
        declaration: identities.get('KNIGHT'),
      }, config, now);
      setTutorialStep(game, TUTORIAL_STEPS.POST_BOT_BLUFF);
      break;
    case TUTORIAL_STEPS.POST_BOT_BLUFF:
      setTutorialStep(game, TUTORIAL_STEPS.CHALLENGE_BOT_BLUFF);
      break;
    case TUTORIAL_STEPS.EXPLAIN_BOT_FAILED_CHALLENGE: {
      const result = await applyChallengeAction(game, 1, config, { now });
      if (result.success !== false) {
        throw new Error('Tutorial expected the scripted bot challenge to fail.');
      }
      setTutorialStep(game, TUTORIAL_STEPS.AFTER_BOT_FAILED_CHALLENGE);
      break;
    }
    case TUTORIAL_STEPS.AFTER_BOT_FAILED_CHALLENGE:
      setTutorialStep(game, TUTORIAL_STEPS.ON_DECK_ROOK);
      break;
    case TUTORIAL_STEPS.BEFORE_BOT_ROOK_CAPTURE:
      await recordScriptedMove(game, {
        player: 1,
        from: { row: 5, col: 2 },
        to: { row: 2, col: 2 },
        declaration: identities.get('ROOK'),
      }, config, now);
      setTutorialStep(game, TUTORIAL_STEPS.AFTER_BOT_ROOK_CAPTURE);
      break;
    case TUTORIAL_STEPS.AFTER_BOT_ROOK_CAPTURE:
      setTutorialStep(game, TUTORIAL_STEPS.DECLARE_BOMB);
      break;
    case TUTORIAL_STEPS.AFTER_BOMB_DECLARATION: {
      const result = await applyChallengeAction(game, 1, config, { now });
      if (result.success !== false) {
        throw new Error('Tutorial expected the scripted bomb challenge to fail.');
      }
      setTutorialStep(game, TUTORIAL_STEPS.ON_DECK_ANY);
      break;
    }
    case TUTORIAL_STEPS.BEFORE_BOT_CHALLENGE_SUCCESS: {
      const result = await applyChallengeAction(game, 1, config, { now });
      if (result.success !== true) {
        throw new Error('Tutorial expected the scripted challenge to succeed.');
      }
      setTutorialStep(game, TUTORIAL_STEPS.AFTER_BOT_CHALLENGE_SUCCESS);
      break;
    }
    case TUTORIAL_STEPS.AFTER_BOT_CHALLENGE_SUCCESS:
      await recordScriptedMove(game, {
        player: 1,
        from: { row: 5, col: 3 },
        to: { row: 5, col: 2 },
        declaration: identities.get('KING'),
      }, config, now);
      setTutorialStep(game, TUTORIAL_STEPS.AFTER_BOT_KING_MOVE);
      break;
    case TUTORIAL_STEPS.AFTER_BOT_KING_MOVE:
      setTutorialStep(game, TUTORIAL_STEPS.EXPLAIN_TRUE_KING_RISK);
      break;
    case TUTORIAL_STEPS.EXPLAIN_TRUE_KING_RISK:
      setTutorialStep(game, TUTORIAL_STEPS.EXPLAIN_WIN_CONDITIONS);
      break;
    case TUTORIAL_STEPS.EXPLAIN_WIN_CONDITIONS:
      setTutorialStep(game, TUTORIAL_STEPS.CAPTURE_KING_WITH_ROOK);
      break;
    case TUTORIAL_STEPS.BEFORE_FINAL_CHALLENGE: {
      const result = await applyChallengeAction(game, 1, config, { now });
      if (result.success !== false) {
        throw new Error('Tutorial expected the final scripted challenge to fail.');
      }
      setTutorialStep(game, TUTORIAL_STEPS.AFTER_FINAL_CHALLENGE);
      break;
    }
    case TUTORIAL_STEPS.AFTER_FINAL_CHALLENGE:
      setTutorialStep(game, TUTORIAL_STEPS.CONGRATULATIONS);
      break;
    case TUTORIAL_STEPS.CONGRATULATIONS:
      setTutorialStep(game, TUTORIAL_STEPS.SHOW_FINISH_BANNER);
      break;
    default:
      throw createTutorialError('Tutorial cannot advance right now.');
  }

  await game.save();
  return buildTutorialPayload(game);
}

module.exports = {
  INTRO_TUTORIAL_ID,
  TUTORIAL_STEPS,
  isTutorialGame,
  buildTutorialPayload,
  getTutorialStep,
  setTutorialStep,
  prepareIntroTutorialGame,
  validateTutorialSetup,
  validateTutorialMove,
  validateTutorialChallenge,
  validateTutorialBomb,
  validateTutorialOnDeck,
  advanceTutorialAfterSetup,
  advanceTutorialAfterMove,
  advanceTutorialAfterChallenge,
  advanceTutorialAfterBomb,
  advanceTutorialAfterOnDeck,
  advanceTutorialStep,
};
