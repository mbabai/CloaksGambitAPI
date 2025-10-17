const {
  BaseBotController,
  GAME_CONSTANTS,
  cloneBoard,
  cloneStashes,
  postJSON,
  toKey,
} = require('./baseBot');

class MediumBotController extends BaseBotController {
  constructor(...args) {
    super(...args);
    this.mediumState = {
      bombReturnedAt: null,
    };
  }

  updateFromPayload(payload) {
    const previousStashes = Array.isArray(this.stashes) ? cloneStashes(this.stashes) : null;
    super.updateFromPayload(payload);
    this.trackBombReturn(previousStashes);
  }

  trackBombReturn(previousStashes) {
    const color = this.color;
    if (color === null || !Array.isArray(previousStashes)) return;
    const countBombs = (stash) =>
      stash.filter(piece => piece && piece.identity === GAME_CONSTANTS.identities.BOMB).length;
    const prev = previousStashes[color] || [];
    const current = this.stashes[color] || [];
    if (countBombs(current) > countBombs(prev)) {
      this.mediumState.bombReturnedAt = Date.now();
    }
  }

  hasOpponentLostBomb() {
    if (this.color === null) return false;
    const captured = this.captured[this.color] || [];
    return captured.some(piece => piece && piece.identity === GAME_CONSTANTS.identities.BOMB);
  }

  computeChallengeScore(move) {
    if (!move || this.color === null) return 0;
    const declaration = move.declaration;
    const capturedCounts = this.computeCapturedCounts();
    if (typeof declaration === 'number') {
      const maxAvailable =
        declaration === GAME_CONSTANTS.identities.BOMB || declaration === GAME_CONSTANTS.identities.KING
          ? 1
          : 2;
      if ((capturedCounts[declaration] || 0) >= maxAvailable) {
        return Number.POSITIVE_INFINITY;
      }
    }

    const { to } = move;
    const targetPiece =
      to && this.isOnBoard(to.row, to.col) ? this.board[to.row][to.col] : null;
    const isCapture = Boolean(targetPiece && targetPiece.color === this.color);
    const myDaggers = this.daggers[this.color] ?? 0;
    let score = isCapture ? 10 : 1;

    if (isCapture && targetPiece.identity === GAME_CONSTANTS.identities.KING) {
      if (!this.hasBombAvailable()) {
        return Number.POSITIVE_INFINITY;
      }
      score = 10000;
    }

    const history = this.opponentPieceHistory.get(toKey(move.from));
    if (history && history.size > 1) {
      score += (history.size - 1) * 4;
    }

    score -= myDaggers * 3;
    if (score < 0) score = 0;
    return score;
  }

  computeBombScore(move) {
    if (!move || this.color === null) return 0;
    if (!this.hasControllablePieceAt(move.to)) return 0;
    const targetPiece = this.board[move.to.row]?.[move.to.col];
    if (!targetPiece || targetPiece.color !== this.color) return 0;

    if (targetPiece.identity === GAME_CONSTANTS.identities.BOMB) {
      return Number.POSITIVE_INFINITY;
    }

    if (targetPiece.identity === GAME_CONSTANTS.identities.KING) {
      return this.hasBombAvailable() ? 7000 : 0;
    }

    if (!this.hasBombAvailable()) {
      return 0;
    }

    const onBoard = this.countPieces(this.color);
    const deficit = Math.max(0, 6 - onBoard);
    if (deficit <= 0) return 0;
    return deficit * 3;
  }

  computePassScore({ pendingMove } = {}) {
    if (this.color === null) return 0;
    const opponentLostBomb = this.hasOpponentLostBomb();
    let kingAtStake = false;
    if (pendingMove && pendingMove.to && this.isOnBoard(pendingMove.to.row, pendingMove.to.col)) {
      const threatenedPiece = this.board[pendingMove.to.row][pendingMove.to.col];
      kingAtStake = Boolean(
        threatenedPiece &&
          threatenedPiece.color === this.color &&
          threatenedPiece.identity === GAME_CONSTANTS.identities.KING,
      );
    }

    if (opponentLostBomb || kingAtStake) {
      return 0;
    }

    const myDaggers = this.daggers[this.color] ?? 0;
    if (myDaggers >= 2) {
      return 10;
    }
    return 1;
  }

  selectWeightedAction(actions) {
    if (!Array.isArray(actions) || !actions.length) return null;
    const scored = actions.filter(action => action && action.score != null);
    if (!scored.length) return null;
    const sorted = [...scored].sort((a, b) => {
      const aScore = a.score === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : a.score;
      const bScore = b.score === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : b.score;
      return bScore - aScore;
    });
    const top = sorted.slice(0, 5);
    const infinite = top.filter(action => action.score === Number.POSITIVE_INFINITY);
    if (infinite.length) {
      return infinite[Math.floor(Math.random() * infinite.length)];
    }
    const positive = top.filter(action => action.score > 0);
    if (!positive.length) {
      return top[0] || null;
    }
    const weights = positive.map(action => action.score * action.score);
    const total = weights.reduce((acc, value) => acc + value, 0);
    if (total <= 0) {
      return positive[0];
    }
    const target = Math.random() * total;
    let cumulative = 0;
    for (let idx = 0; idx < positive.length; idx += 1) {
      cumulative += weights[idx];
      if (target <= cumulative) {
        return positive[idx];
      }
    }
    return positive[positive.length - 1];
  }

  preparePendingMovePlan(move, context = {}) {
    if (!move) {
      this.pendingMovePlan = null;
      return;
    }

    const key = this.getPendingMoveKey(move);
    if (this.pendingMovePlan && this.pendingMovePlan.key === key) {
      return;
    }

    const timestamp = this.markOpponentEvent(move.timestamp, 'pending-move');
    const snapshot = {
      from: { ...(move.from || {}) },
      to: { ...(move.to || {}) },
      declaration: move.declaration,
      player: move.player,
      state: move.state,
      timestamp: move.timestamp,
    };

    const actions = [];
    const challengeScore = this.computeChallengeScore(move);
    actions.push({
      type: 'challenge',
      response: 'challenge',
      score: challengeScore,
      reason: 'Medium bot challenge',
    });

    if (context.canBomb) {
      const bombScore = this.computeBombScore(move);
      actions.push({
        type: 'bomb',
        response: 'bomb',
        score: bombScore,
        reason: 'Medium bot bomb response',
      });
    }

    actions.push({
      type: 'pass',
      response: 'accept',
      score: this.computePassScore({ pendingMove: move }),
      reason: 'Medium bot pass',
    });

    const choice = this.selectWeightedAction(actions);

    const plan = {
      key,
      move: snapshot,
      timestamp,
      response: 'accept',
      reason: 'Medium bot default accept',
      status: 'pending',
      forceBomb: false,
    };

    if (choice) {
      plan.response = choice.response;
      plan.reason = choice.reason;
    }

    this.pendingMovePlan = plan;
    console.log('[bot] medium pending move plan', {
      gameId: this.gameId,
      response: plan.response,
      reason: plan.reason,
      score: choice?.score,
    });
  }

  buildMoveActionOptions(moves, attemptedSet) {
    if (!Array.isArray(moves)) return [];
    const options = [];
    moves.forEach((move) => {
      const declarations = this.getAvailableDeclarations(move, attemptedSet);
      declarations.forEach((declaration) => {
        options.push({
          type: 'move',
          move,
          declaration,
          score: this.computeMoveScore(move, declaration),
          key: this.getMoveAttemptKey(move, declaration),
        });
      });
    });
    return options;
  }

  computeMoveScore(move, declaration) {
    if (!move || this.color === null) return 0;
    if (!move.from || !move.to) return 0;
    if (!this.isOnBoard(move.from.row, move.from.col) || !this.isOnBoard(move.to.row, move.to.col)) return 0;

    const boardRows = this.board.length;
    if (!boardRows) return 0;

    const movingPiece = this.board[move.from.row][move.from.col];
    if (!movingPiece || movingPiece.color !== this.color) return 0;

    const myCount = this.countPieces(this.color);
    if (myCount <= 1 && declaration !== GAME_CONSTANTS.identities.KING) {
      return 0;
    }

    let score = 0;
    const protectors = this.countProtectorsAfterMove(move);
    score += protectors * 10;

    const forwardDelta = this.color === 0
      ? move.to.row - move.from.row
      : move.from.row - move.to.row;
    if (forwardDelta > 0) {
      score += forwardDelta;
    }

    const opponent = this.identifyOpponent();
    const opponentCount = opponent == null ? 0 : this.countPieces(opponent);

    if (move.capture) {
      const pieceDeficit = Math.max(0, opponentCount - myCount);
      score += 10 + pieceDeficit * 5;
    }

    if (declaration === movingPiece.identity) {
      score += 10;
    }

    if (movingPiece.identity === GAME_CONSTANTS.identities.KING && declaration === GAME_CONSTANTS.identities.KING) {
      const opponentHome = this.color === 0 ? boardRows - 1 : 0;
      if (move.to.row === opponentHome) {
        return Number.POSITIVE_INFINITY;
      }
      const forwardPosition = this.color === 0 ? move.to.row : (boardRows - 1 - move.to.row);
      const opponentPieces = Math.max(1, this.countPieces(this.identifyOpponent()));
      score += (forwardPosition * forwardPosition) / opponentPieces;
    }

    return score;
  }

  countProtectorsAfterMove(move) {
    if (!move || this.color === null) return 0;
    if (!move.from || !move.to) return 0;
    if (!this.isOnBoard(move.from.row, move.from.col) || !this.isOnBoard(move.to.row, move.to.col)) return 0;

    const movingPiece = this.board[move.from.row][move.from.col];
    if (!movingPiece || movingPiece.color !== this.color) return 0;

    const opponent = this.identifyOpponent();
    const simulated = cloneBoard(this.board);
    simulated[move.from.row][move.from.col] = null;
    simulated[move.to.row][move.to.col] = { color: opponent, identity: movingPiece.identity };

    const originalBoard = this.board;
    let count = 0;
    try {
      this.board = simulated;
      const pieces = this.collectMyPieces();
      pieces.forEach(({ piece, coord }) => {
        const targets = this.getLegalTargetsForDeclaration(coord, piece.identity);
        if (targets.some(target => target.row === move.to.row && target.col === move.to.col && target.capture)) {
          count += 1;
        }
      });
    } finally {
      this.board = originalBoard;
    }
    return count;
  }

  async submitMoveAction(move, declaration) {
    this.pendingAction = true;
    try {
      await this.waitBeforeMoveSubmission();
      await postJSON(this.serverUrl, '/api/v1/gameAction/move', this.token, {
        gameId: this.gameId,
        color: this.color,
        from: move.from,
        to: move.to,
        declaration,
      });
      this.lastBoard = cloneBoard(this.board);
      return 'success';
    } catch (err) {
      const message = this.extractErrorMessage(err);
      if (message === 'Invalid declaration' || message === 'Illegal move') {
        console.error('\x1b[31m[bot] medium move rejected\x1b[0m', {
          gameId: this.gameId,
          from: move.from,
          to: move.to,
          declaration,
          message,
        });
        return 'retry';
      }
      console.error('Medium bot move failed', err);
      return 'error';
    } finally {
      this.pendingAction = false;
    }
  }

  async executeMoveDecision() {
    if (this.pendingAction) return;
    if (this.color === null) return;
    if (this.playerTurn !== this.color) return;

    const legal = this.collectLegalActions();
    const moves = Array.isArray(legal.moves) ? legal.moves : [];
    const attemptedDeclarations = new Set();

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const options = this.buildMoveActionOptions(moves, attemptedDeclarations);
      if (legal.canPass) {
        options.push({
          type: 'pass',
          score: this.computePassScore(),
          reason: 'Medium bot pass turn',
        });
      }

      const choice = this.selectWeightedAction(options);
      if (!choice) {
        console.log('[bot] medium: no move actions available', { gameId: this.gameId, attempt });
        return;
      }

      if (choice.type === 'pass') {
        const success = await this.issuePass(choice.reason);
        if (!success) {
          console.error('[bot] medium: pass failed', { gameId: this.gameId });
        }
        return;
      }

      if (!choice.move || choice.declaration == null) {
        attemptedDeclarations.add(choice.key);
        continue;
      }

      const result = await this.submitMoveAction(choice.move, choice.declaration);
      if (result === 'success') {
        return;
      }
      if (result === 'retry') {
        attemptedDeclarations.add(choice.key);
        continue;
      }
      return;
    }

    console.error('\x1b[31m[bot] medium: exhausted move attempts without success\x1b[0m', {
      gameId: this.gameId,
    });
  }

  async placeOnDeck() {
    if (this.color === null) return;
    if (this.pendingAction) return;
    const color = this.color;
    if (this.onDecks[color]) return;
    const stash = Array.isArray(this.stashes[color]) ? this.stashes[color] : [];
    const available = stash.filter(piece => piece && piece.color === color && typeof piece.identity === 'number');
    if (!available.length) return;

    const options = available.map((piece) => {
      let score = 4;
      if (piece.identity === GAME_CONSTANTS.identities.BOMB && this.mediumState.bombReturnedAt != null) {
        score = 1;
      }
      return {
        type: 'onDeck',
        piece,
        score,
      };
    });

    const choice = this.selectWeightedAction(options);
    const selected = choice?.piece || available[0];
    this.pendingAction = true;
    try {
      await postJSON(this.serverUrl, '/api/v1/gameAction/onDeck', this.token, {
        gameId: this.gameId,
        color,
        piece: { identity: selected.identity },
      });
      if (selected.identity === GAME_CONSTANTS.identities.BOMB) {
        this.mediumState.bombReturnedAt = null;
      }
    } catch (err) {
      console.error('Medium bot failed to place on deck', err);
    } finally {
      this.finalizeAction();
    }
  }
}

module.exports = {
  MediumBotController,
};
