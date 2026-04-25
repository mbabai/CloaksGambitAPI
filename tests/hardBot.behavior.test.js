const { HardBotController } = require('../shared/bots/hardBot');
const { BotClient } = require('../shared/bots/client');
const { GAME_CONSTANTS } = require('../shared/bots/baseBot');

const IDS = GAME_CONSTANTS.identities;
const ACTIONS = GAME_CONSTANTS.actions;

function createBoard(rows = 6, cols = 5) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

function createHardBot() {
  const bot = new HardBotController('http://localhost', 'game-1', 'player-1', null, null);
  bot.color = 0;
  bot.board = createBoard();
  bot.stashes = [[], []];
  bot.onDecks = [null, null];
  bot.captured = [[], []];
  bot.daggers = [0, 0];
  return bot;
}

describe('HardBotController beliefs and setup', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('on-deck replacement pieces are clamped away from king in beliefs', () => {
    const bot = createHardBot();
    bot.board[3][1] = { color: 1, identity: IDS.UNKNOWN };
    bot.board[4][2] = { color: 1, identity: IDS.UNKNOWN };

    const replacement = bot.createTrack(1, { cameFromOnDeck: true });
    bot.hardState.pieceTracks[1].set('3,1', replacement);
    bot.hardState.pieceTracks[1].set('4,2', bot.createTrack(1));

    const beliefs = bot.buildBeliefsForColor(1);

    expect(beliefs.get('3,1')[IDS.KING]).toBe(0);
    expect(beliefs.get('4,2')[IDS.KING]).toBeGreaterThan(0);
  });

  test('single remaining enemy piece is treated as king', () => {
    const bot = createHardBot();
    bot.board[3][1] = { color: 1, identity: IDS.UNKNOWN };
    bot.hardState.pieceTracks[1].set('3,1', bot.createTrack(1));

    const beliefs = bot.buildBeliefsForColor(1);

    expect(beliefs.get('3,1')[IDS.KING]).toBe(1);
  });

  test('declarations increase the declared identity belief for that tracked piece', () => {
    const bot = createHardBot();
    bot.board[3][1] = { color: 1, identity: IDS.UNKNOWN };
    bot.board[4][2] = { color: 1, identity: IDS.UNKNOWN };
    const declared = bot.createTrack(1);
    bot.recordDeclarationOnTrack(declared, IDS.ROOK);
    bot.hardState.pieceTracks[1].set('3,1', declared);
    bot.hardState.pieceTracks[1].set('4,2', bot.createTrack(1));

    const beliefs = bot.buildBeliefsForColor(1);

    expect(beliefs.get('3,1')[IDS.ROOK]).toBeGreaterThan(beliefs.get('4,2')[IDS.ROOK]);
  });

  test('reverse public certainty blocks king declarations for own on-deck pieces', () => {
    const bot = createHardBot();
    bot.board[2][2] = { color: 0, identity: IDS.ROOK };
    bot.hardState.pieceTracks[0].set('2,2', bot.createTrack(0, { cameFromOnDeck: true }));

    expect(bot.isOwnDeclarationPubliclyImpossible({ row: 2, col: 2 }, IDS.KING)).toBe(true);
  });

  test('own on-deck replacement remains king-impossible after a following on-deck action', () => {
    const bot = createHardBot();
    const previousBoard = createBoard();
    previousBoard[2][0] = { color: 0, identity: IDS.ROOK };
    bot.board = previousBoard;
    bot.hardState.pieceTracks[0].set('2,0', bot.createTrack(0));
    const previousTracks = bot.cloneTrackMaps();

    bot.board = createBoard();
    bot.board[2][3] = { color: 0, identity: IDS.KNIGHT };
    bot.moves = [{
      player: 0,
      from: { row: 2, col: 0 },
      to: { row: 2, col: 3 },
      declaration: IDS.ROOK,
    }];
    bot.actions = [
      { type: ACTIONS.MOVE, player: 0 },
      { type: ACTIONS.CHALLENGE, player: 1, details: { outcome: 'FAIL' } },
      { type: ACTIONS.ON_DECK, player: 1, details: { identity: IDS.BISHOP } },
    ];

    bot.syncPieceTracks(previousBoard, previousTracks);
    const replacementTrack = bot.getTrack(0, { row: 2, col: 3 });

    expect(replacementTrack.cameFromOnDeck).toBe(true);
    expect(bot.isOwnDeclarationPubliclyImpossible({ row: 2, col: 3 }, IDS.KING)).toBe(true);
    expect(bot.buildMoveActionOptions([{
      from: { row: 2, col: 3 },
      to: { row: 3, col: 3 },
      capture: false,
    }], new Set()).some(option => option.declaration === IDS.KING)).toBe(false);
  });

  test('non-king pieces never bluff king onto the final rank', () => {
    const bot = createHardBot();
    bot.board[0][0] = { color: 0, identity: IDS.KING };
    bot.board[4][2] = { color: 0, identity: IDS.ROOK };
    bot.hardState.pieceTracks[0].set('0,0', bot.createTrack(0));
    bot.hardState.pieceTracks[0].set('4,2', bot.createTrack(0));
    const throneMove = {
      from: { row: 4, col: 2 },
      to: { row: 5, col: 2 },
      capture: false,
    };

    const options = bot.buildMoveActionOptions([throneMove], new Set());

    expect(bot.isForbiddenKingThroneBluff(throneMove, IDS.KING)).toBe(true);
    expect(bot.computeHardMoveActionScore(throneMove, IDS.KING)).toBe(bot.hardWeights.evaluation.loss);
    expect(options.some(option => option.declaration === IDS.KING)).toBe(false);
    expect(options.some(option => option.declaration === IDS.ROOK)).toBe(true);
  });

  test('true kings can still declare king onto the final rank', () => {
    const bot = createHardBot();
    bot.board[4][2] = { color: 0, identity: IDS.KING };
    bot.hardState.pieceTracks[0].set('4,2', bot.createTrack(0));
    const throneMove = {
      from: { row: 4, col: 2 },
      to: { row: 5, col: 2 },
      capture: false,
    };

    const options = bot.buildMoveActionOptions([throneMove], new Set());

    expect(bot.isForbiddenKingThroneBluff(throneMove, IDS.KING)).toBe(false);
    expect(options.some(option => option.declaration === IDS.KING)).toBe(true);
  });

  test('failed challenges against own bombs make bomb declarations impossible', () => {
    const bot = createHardBot();
    bot.board[0][0] = { color: 0, identity: IDS.KING };
    bot.board[2][3] = { color: 0, identity: IDS.ROOK };
    bot.hardState.pieceTracks[0].set('0,0', bot.createTrack(0));
    bot.hardState.pieceTracks[0].set('2,3', bot.createTrack(0, { cameFromOnDeck: true }));
    bot.moves = [{
      player: 1,
      from: { row: 2, col: 0 },
      to: { row: 2, col: 3 },
      declaration: IDS.ROOK,
    }];
    bot.actions = [
      { type: ACTIONS.MOVE, player: 1 },
      { type: ACTIONS.BOMB, player: 0 },
      { type: ACTIONS.CHALLENGE, player: 1, details: { outcome: 'FAIL' } },
    ];

    bot.syncBoardIdentityLocks();
    const futureAttack = {
      player: 1,
      from: { row: 2, col: 0 },
      to: { row: 2, col: 3 },
      declaration: IDS.ROOK,
    };

    expect(bot.isIdentityLockedOffBoard(0, IDS.BOMB)).toBe(true);
    expect(bot.getBeliefAt(0, { row: 2, col: 3 })[IDS.BOMB]).toBe(0);
    expect(bot.isOwnBombPubliclyImpossible({ row: 2, col: 3 })).toBe(true);
    expect(bot.decideBombBluff(futureAttack).bomb).toBe(false);
  });

  test('placing bomb on deck does not make bomb declarations possible until another failed challenge', () => {
    const bot = createHardBot();
    bot.moves = [{
      player: 1,
      from: { row: 2, col: 0 },
      to: { row: 2, col: 3 },
      declaration: IDS.ROOK,
    }];
    bot.actions = [
      { type: ACTIONS.MOVE, player: 1 },
      { type: ACTIONS.BOMB, player: 0 },
      { type: ACTIONS.CHALLENGE, player: 1, details: { outcome: 'FAIL' } },
      { type: ACTIONS.ON_DECK, player: 0, details: { identity: IDS.BOMB } },
    ];

    bot.syncBoardIdentityLocks();
    expect(bot.isIdentityLockedOffBoard(0, IDS.BOMB)).toBe(true);

    bot.moves.push({
      player: 0,
      from: { row: 3, col: 3 },
      to: { row: 4, col: 3 },
      declaration: IDS.ROOK,
    });
    bot.actions.push(
      { type: ACTIONS.MOVE, player: 0 },
      { type: ACTIONS.CHALLENGE, player: 1, details: { outcome: 'FAIL' } },
    );

    bot.syncBoardIdentityLocks();
    expect(bot.isIdentityLockedOffBoard(0, IDS.BOMB)).toBe(false);
  });

  test('hard setup can intentionally put bomb on deck', () => {
    const bot = createHardBot();
    bot.stashes[0] = [
      { color: 0, identity: IDS.ROOK },
      { color: 0, identity: IDS.ROOK },
      { color: 0, identity: IDS.BISHOP },
      { color: 0, identity: IDS.BISHOP },
      { color: 0, identity: IDS.KNIGHT },
      { color: 0, identity: IDS.KNIGHT },
      { color: 0, identity: IDS.KING },
      { color: 0, identity: IDS.BOMB },
    ];
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const setup = bot.prepareRandomSetup();

    expect(setup.onDeck.identity).toBe(IDS.BOMB);
    expect(setup.pieces).toHaveLength(5);
    expect(setup.pieces.some(piece => piece.identity === IDS.KING)).toBe(true);
  });

  test('king wall score is only weighted threats with a zero-threat step bonus', () => {
    const bot = createHardBot();
    const safeBoard = createBoard();
    safeBoard[2][2] = { color: 0, identity: IDS.KING };

    const oneThreatBoard = createBoard();
    oneThreatBoard[2][2] = { color: 0, identity: IDS.KING };
    oneThreatBoard[2][4] = { color: 1, identity: IDS.UNKNOWN };
    oneThreatBoard[5][0] = { color: 1, identity: IDS.UNKNOWN };

    const manyThreatBoard = createBoard();
    manyThreatBoard[2][2] = { color: 0, identity: IDS.KING };
    manyThreatBoard[2][4] = { color: 1, identity: IDS.UNKNOWN };
    manyThreatBoard[4][4] = { color: 1, identity: IDS.UNKNOWN };
    manyThreatBoard[5][0] = { color: 1, identity: IDS.UNKNOWN };

    const safeScore = bot.scoreKingThreatSafety(safeBoard, 1, { row: 2, col: 2 });
    const oneThreatScore = bot.scoreKingThreatSafety(oneThreatBoard, 1, { row: 2, col: 2 });
    const manyThreatScore = bot.scoreKingThreatSafety(manyThreatBoard, 1, { row: 2, col: 2 });

    expect(safeScore).toBe(bot.hardWeights.evaluation.kingFullyWalledOff);
    expect(oneThreatScore).toBeLessThan(safeScore);
    expect(manyThreatScore).toBeLessThan(oneThreatScore);
  });

  test('king advance factor is zero at full board and grows quadratically as pieces leave', () => {
    const bot = createHardBot();
    const fullBoard = createBoard();
    const midBoard = createBoard();
    const endBoard = createBoard();

    for (let col = 0; col < 5; col += 1) {
      fullBoard[0][col] = { color: 0, identity: col === 0 ? IDS.KING : IDS.ROOK };
      fullBoard[5][col] = { color: 1, identity: IDS.UNKNOWN };
    }

    [[0, 0], [0, 1], [0, 2], [5, 0], [5, 1], [5, 2]].forEach(([row, col], idx) => {
      midBoard[row][col] = { color: row === 0 ? 0 : 1, identity: idx === 0 ? IDS.KING : IDS.UNKNOWN };
    });

    endBoard[0][0] = { color: 0, identity: IDS.KING };
    endBoard[5][4] = { color: 1, identity: IDS.UNKNOWN };

    expect(bot.getKingAdvancePieceFactor(fullBoard)).toBe(0);
    expect(bot.getKingAdvancePieceFactor(midBoard)).toBeCloseTo(0.25);
    expect(bot.getKingAdvancePieceFactor(endBoard)).toBe(1);
  });

  test('non-throne king shuffles score below active rook moves', () => {
    const bot = createHardBot();
    bot.board[0][0] = { color: 0, identity: IDS.KING };
    bot.board[2][0] = { color: 0, identity: IDS.ROOK };

    const kingMove = {
      from: { row: 0, col: 0 },
      to: { row: 0, col: 1 },
      capture: false,
    };
    const rookMove = {
      from: { row: 2, col: 0 },
      to: { row: 2, col: 3 },
      capture: false,
    };

    expect(bot.computeHardMoveActionScore(rookMove, IDS.ROOK))
      .toBeGreaterThan(bot.computeHardMoveActionScore(kingMove, IDS.KING));
  });

  test('activity rewards non-king pieces more than king activity', () => {
    const bot = createHardBot();
    const kingBoard = createBoard();
    kingBoard[2][2] = { color: 0, identity: IDS.KING };
    const rookBoard = createBoard();
    rookBoard[2][2] = { color: 0, identity: IDS.ROOK };

    expect(bot.scoreActivity(rookBoard, 0)).toBeGreaterThan(bot.scoreActivity(kingBoard, 0));
  });

  test('own daggers exponentially suppress move challenge probability', () => {
    const bot = createHardBot();
    bot.board[0][0] = { color: 0, identity: IDS.KING };
    bot.board[3][1] = { color: 1, identity: IDS.UNKNOWN };
    bot.board[4][4] = { color: 1, identity: IDS.UNKNOWN };
    const track = bot.createTrack(1);
    bot.recordDeclarationOnTrack(track, IDS.BISHOP);
    bot.hardState.pieceTracks[1].set('3,1', track);
    bot.hardState.pieceTracks[1].set('4,4', bot.createTrack(1));
    const move = {
      player: 1,
      from: { row: 3, col: 1 },
      to: { row: 2, col: 1 },
      declaration: IDS.ROOK,
    };
    jest.spyOn(Math, 'random').mockReturnValue(1);

    bot.daggers = [0, 0];
    const noDagger = bot.decideChallengeMove(move).probability;
    bot.daggers = [1, 0];
    const oneDagger = bot.decideChallengeMove(move).probability;
    bot.daggers = [2, 0];
    const twoDaggers = bot.decideChallengeMove(move).probability;

    expect(oneDagger).toBeLessThan(noDagger * 0.5);
    expect(twoDaggers).toBeLessThan(oneDagger * 0.5);
    expect(twoDaggers).toBeLessThanOrEqual(bot.hardWeights.challenge.twoDaggerMaxChallengeChance);
  });

  test('own daggers exponentially suppress bomb challenge probability', () => {
    const bot = createHardBot();
    bot.board[0][0] = { color: 0, identity: IDS.KING };
    bot.board[2][0] = { color: 0, identity: IDS.ROOK };
    bot.board[2][3] = { color: 1, identity: IDS.UNKNOWN };
    bot.board[4][4] = { color: 1, identity: IDS.UNKNOWN };
    bot.hardState.pieceTracks[1].set('2,3', bot.createTrack(1));
    bot.hardState.pieceTracks[1].set('4,4', bot.createTrack(1));
    bot.moves = [{
      player: 0,
      from: { row: 2, col: 0 },
      to: { row: 2, col: 3 },
      declaration: IDS.ROOK,
    }];
    jest.spyOn(Math, 'random').mockReturnValue(1);

    bot.daggers = [0, 2];
    const noDagger = bot.decideChallengeBomb().probability;
    bot.daggers = [1, 2];
    const oneDagger = bot.decideChallengeBomb().probability;
    bot.daggers = [2, 2];
    const twoDaggers = bot.decideChallengeBomb().probability;

    expect(oneDagger).toBeLessThan(noDagger * 0.5);
    expect(twoDaggers).toBeLessThan(oneDagger * 0.5);
    expect(twoDaggers).toBeLessThanOrEqual(bot.hardWeights.challenge.twoDaggerMaxChallengeChance);
  });

  test('passing on an opponent bomb claim makes that target a known bomb', () => {
    const bot = createHardBot();
    bot.board[2][3] = { color: 1, identity: IDS.UNKNOWN };
    bot.board[4][4] = { color: 1, identity: IDS.UNKNOWN };
    bot.hardState.pieceTracks[1].set('2,3', bot.createTrack(1));
    bot.hardState.pieceTracks[1].set('4,4', bot.createTrack(1));
    bot.moves = [{
      player: 0,
      from: { row: 2, col: 0 },
      to: { row: 2, col: 3 },
      declaration: IDS.ROOK,
    }];
    bot.actions = [
      { type: ACTIONS.MOVE, player: 0 },
      { type: ACTIONS.BOMB, player: 1 },
      { type: ACTIONS.PASS, player: 0 },
    ];

    bot.recordBombEvidenceFromActions();
    const targetBelief = bot.getBeliefAt(1, { row: 2, col: 3 });
    const otherBelief = bot.getBeliefAt(1, { row: 4, col: 4 });

    expect(targetBelief[IDS.BOMB]).toBe(1);
    expect(otherBelief[IDS.BOMB]).toBe(0);
  });

  test('successful bomb challenges mark that target as not a bomb', () => {
    const bot = createHardBot();
    bot.board[2][3] = { color: 1, identity: IDS.UNKNOWN };
    bot.board[4][4] = { color: 1, identity: IDS.UNKNOWN };
    bot.hardState.pieceTracks[1].set('2,3', bot.createTrack(1));
    bot.hardState.pieceTracks[1].set('4,4', bot.createTrack(1));
    bot.moves = [{
      player: 0,
      from: { row: 2, col: 0 },
      to: { row: 2, col: 3 },
      declaration: IDS.ROOK,
    }];
    bot.actions = [
      { type: ACTIONS.MOVE, player: 0 },
      { type: ACTIONS.BOMB, player: 1 },
      { type: ACTIONS.CHALLENGE, player: 0, details: { outcome: 'SUCCESS' } },
    ];

    bot.recordBombEvidenceFromActions();

    expect(bot.getBeliefAt(1, { row: 2, col: 3 })[IDS.BOMB]).toBe(0);
  });

  test('failed bomb challenges do not mark the on-deck replacement as the bomb', () => {
    const bot = createHardBot();
    bot.board[2][3] = { color: 1, identity: IDS.UNKNOWN };
    bot.board[4][4] = { color: 1, identity: IDS.UNKNOWN };
    const replacementTrack = bot.createTrack(1, { cameFromOnDeck: true });
    bot.forceTrackIdentity(replacementTrack, IDS.BOMB);
    bot.hardState.pieceTracks[1].set('2,3', replacementTrack);
    bot.hardState.pieceTracks[1].set('4,4', bot.createTrack(1));
    bot.moves = [{
      player: 0,
      from: { row: 2, col: 0 },
      to: { row: 2, col: 3 },
      declaration: IDS.ROOK,
    }];
    bot.actions = [
      { type: ACTIONS.MOVE, player: 0 },
      { type: ACTIONS.BOMB, player: 1 },
      { type: ACTIONS.CHALLENGE, player: 0, details: { outcome: 'FAIL' } },
    ];

    bot.recordBombEvidenceFromActions();
    const belief = bot.getBeliefAt(1, { row: 2, col: 3 });

    expect(replacementTrack.forcedIdentity).toBeNull();
    expect(belief[IDS.BOMB]).toBeLessThan(1);
    expect(belief[IDS.KING]).toBe(0);
  });

  test('known bombs are excluded from capture move options', () => {
    const bot = createHardBot();
    bot.board[2][0] = { color: 0, identity: IDS.ROOK };
    bot.board[2][3] = { color: 1, identity: IDS.UNKNOWN };
    bot.board[4][4] = { color: 1, identity: IDS.UNKNOWN };
    const bombTrack = bot.createTrack(1);
    bot.forceTrackIdentity(bombTrack, IDS.BOMB);
    bot.hardState.pieceTracks[1].set('2,3', bombTrack);
    bot.hardState.pieceTracks[1].set('4,4', bot.createTrack(1));
    const capture = {
      from: { row: 2, col: 0 },
      to: { row: 2, col: 3 },
      capture: true,
    };

    expect(bot.isCertainBombCapture(capture)).toBe(true);
    expect(bot.computeHardMoveActionScore(capture, IDS.ROOK))
      .toBe(bot.hardWeights.evaluation.certainBombCapturePenalty);
    expect(bot.buildMoveActionOptions([capture], new Set())).toHaveLength(0);
  });

  test('bot client resolves hard difficulty to hard controller', () => {
    const client = new BotClient('http://localhost', 'token', 'user', 'hard');

    expect(client.ControllerClass).toBe(HardBotController);
  });
});
