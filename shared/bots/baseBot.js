const GAME_CONSTANTS = {
  identities: {
    UNKNOWN: 0,
    KING: 1,
    BOMB: 2,
    BISHOP: 3,
    ROOK: 4,
    KNIGHT: 5,
  },
  moveStates: {
    PENDING: 0,
    COMPLETED: 1,
    RESOLVED: 2,
  },
  actions: {
    SETUP: 0,
    MOVE: 1,
    CHALLENGE: 2,
    BOMB: 3,
    PASS: 4,
    ON_DECK: 5,
    RESIGN: 6,
    READY: 7,
  },
};

const MOVE_DECLARATIONS = [
  GAME_CONSTANTS.identities.KING,
  GAME_CONSTANTS.identities.ROOK,
  GAME_CONSTANTS.identities.BISHOP,
  GAME_CONSTANTS.identities.KNIGHT,
  GAME_CONSTANTS.identities.BOMB,
];

function toKey(coord) {
  return `${coord.row},${coord.col}`;
}

function cloneBoard(board) {
  return board.map(row => row.map(cell => (cell ? { ...cell } : null)));
}

function cloneStashes(stashes) {
  return stashes.map(stash => stash.map(piece => ({ ...piece })));
}

async function postJSON(serverUrl, path, token, body) {
  const target = path.startsWith('http://') || path.startsWith('https://')
    ? path
    : `${serverUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

  const res = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      errMsg = (data && data.message) || errMsg;
      const error = new Error(errMsg);
      error.data = data;
      throw error;
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error(errMsg);
    }
  }

  try {
    return await res.json();
  } catch (_) {
    return undefined;
  }
}

class BaseBotController {
  constructor(serverUrl, gameId, playerId, token, socket) {
    this.serverUrl = serverUrl;
    this.gameId = gameId;
    this.playerId = playerId;
    this.token = token;
    this.socket = socket;

    this.matchId = null;
    this.color = null;
    this.board = [];
    this.stashes = [[], []];
    this.onDecks = [null, null];
    this.captured = [[], []];
    this.daggers = [0, 0];
    this.setupComplete = [false, false];
    this.playersReady = [false, false];
    this.actions = [];
    this.moves = [];
    this.opponentPieceHistory = new Map();
    this.pendingAction = false;
    this.lastBoard = null;
    this.readySubmitted = false;
    this.lastProcessedMoveIndex = -1;
    this.lastHandledActionIndex = -1;
    this.playerTurn = null;
    this.onDeckingPlayer = null;
    this.isActive = false;
    this.actionTimer = null;
    this.lastOpponentEventAt = null;
    this.pendingMovePlan = null;
    this.pendingBombPlan = null;
    this.pendingOnDeckTimestamp = null;
    this.pendingStateEvaluation = false;
  }

  async waitBeforeMoveSubmission() {
    const delayMs = 2000;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  updateFromPayload(payload) {
    this.matchId = payload.matchId ?? this.matchId;
    this.board = cloneBoard(payload.board || []);
    this.stashes = cloneStashes(payload.stashes || [[], []]);
    this.onDecks = (payload.onDecks || []).map(piece => (piece ? { ...piece } : null));
    this.captured = Array.isArray(payload.captured) ? cloneStashes(payload.captured) : [[], []];
    this.daggers = Array.isArray(payload.daggers) ? [...payload.daggers] : [0, 0];
    this.setupComplete = Array.isArray(payload.setupComplete) ? [...payload.setupComplete] : [false, false];
    this.playersReady = Array.isArray(payload.playersReady) ? [...payload.playersReady] : [false, false];
    this.actions = Array.isArray(payload.actions) ? [...payload.actions] : [];
    this.moves = Array.isArray(payload.moves) ? [...payload.moves] : [];
    this.playerTurn = typeof payload.playerTurn === 'number' ? payload.playerTurn : this.playerTurn;
    if (Object.prototype.hasOwnProperty.call(payload, 'onDeckingPlayer')) {
      const { onDeckingPlayer } = payload;
      this.onDeckingPlayer =
        onDeckingPlayer === null || typeof onDeckingPlayer === 'number'
          ? onDeckingPlayer
          : this.onDeckingPlayer;
    }
    this.isActive = typeof payload.isActive === 'boolean' ? payload.isActive : this.isActive;

    if (this.color === null) {
      const normalizedPlayers = Array.isArray(payload.players)
        ? payload.players.map(id => (id != null ? id.toString() : ''))
        : [];
      const targetId = this.playerId != null ? this.playerId.toString() : '';
      const idx = normalizedPlayers.findIndex(id => id === targetId);
      if (idx === -1) {
        console.warn('[bot] unable to resolve color from payload', {
          gameId: this.gameId,
          playerId: targetId,
          players: normalizedPlayers,
        });
      } else {
        this.color = idx;
        console.log('[bot] color assigned', {
          gameId: this.gameId,
          playerId: targetId,
          color: idx,
        });
      }
    }
  }

  extractTimestampValue(value) {
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (value && typeof value === 'object' && typeof value.getTime === 'function') {
      const result = value.getTime();
      if (Number.isFinite(result)) return result;
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
  }

  getLastAction() {
    if (!this.actions.length) return null;
    return this.actions[this.actions.length - 1];
  }

  trackMoveHistory() {
    if (this.color === null) return;
    const opponent = this.identifyOpponent();
    for (let idx = this.lastProcessedMoveIndex + 1; idx < this.moves.length; idx += 1) {
      const move = this.moves[idx];
      if (!move) continue;
      if (move.state === GAME_CONSTANTS.moveStates.PENDING) {
        break;
      }
      this.lastProcessedMoveIndex = idx;
      const fromKey = toKey(move.from);
      const toKeyStr = toKey(move.to);
      if (move.player === opponent) {
        const history = this.opponentPieceHistory.get(fromKey) || new Set();
        history.add(move.declaration);
        this.opponentPieceHistory.delete(fromKey);
        const existing = this.opponentPieceHistory.get(toKeyStr) || new Set();
        history.forEach(value => existing.add(value));
        this.opponentPieceHistory.set(toKeyStr, existing);
      } else if (move.player === this.color) {
        this.opponentPieceHistory.delete(toKeyStr);
      }
    }
  }

  hasPendingOpponentMove() {
    if (!this.moves.length) return null;
    const lastMove = this.moves[this.moves.length - 1];
    if (!lastMove) return null;
    if (lastMove.state !== GAME_CONSTANTS.moveStates.PENDING) return null;
    if (this.color === null) return null;
    if (lastMove.player === this.color) return null;
    return lastMove;
  }

  getPendingMoveKey(move) {
    if (!move) return '';
    const from = move.from || {};
    const to = move.to || {};
    const timestamp = this.extractTimestampValue(move.timestamp);
    return `${from.row},${from.col}->${to.row},${to.col}:${timestamp ?? 'unknown'}`;
  }

  markOpponentEvent(rawTimestamp, context) {
    const timestamp = this.extractTimestampValue(rawTimestamp) ?? Date.now();
    this.lastOpponentEventAt = timestamp;
    if (context) {
      console.log('[bot] opponent event recorded', {
        gameId: this.gameId,
        context,
        timestamp,
      });
    }
    return timestamp;
  }

  acknowledgePendingMove(move) {
    if (!move) return;

    const opponent = this.identifyOpponent();
    const key = this.getPendingMoveKey(move);

    let targetIndex = -1;
    let targetMove = null;

    if (key) {
      targetIndex = this.moves.findIndex((entry) => {
        if (!entry || entry.player !== opponent) return false;
        if (entry.state !== GAME_CONSTANTS.moveStates.PENDING) return false;
        return this.getPendingMoveKey(entry) === key;
      });
      if (targetIndex !== -1) {
        targetMove = this.moves[targetIndex];
      }
    }

    if (!targetMove) {
      const lastIndex = this.moves.length - 1;
      const candidate = this.moves[lastIndex];
      if (
        candidate &&
        candidate.player === opponent &&
        candidate.state === GAME_CONSTANTS.moveStates.PENDING
      ) {
        targetIndex = lastIndex;
        targetMove = candidate;
      }
    }

    if (!targetMove) return;
    const from = targetMove.from || move.from;
    const to = targetMove.to || move.to;
    if (!from || !to) return;
    if (!this.board.length || !this.board[0].length) return;
    if (!this.isOnBoard(from.row, from.col) || !this.isOnBoard(to.row, to.col)) return;

    const board = cloneBoard(this.board);
    const movingPiece = board[from.row][from.col];
    const targetPiece = board[to.row][to.col];

    const fallbackPiece =
      movingPiece ||
      targetPiece ||
      {
        color: opponent,
        identity: typeof targetMove.declaration === 'number' ? targetMove.declaration : move.declaration,
      };

    board[from.row][from.col] = null;
    board[to.row][to.col] = fallbackPiece ? { ...fallbackPiece, color: opponent } : null;

    if (targetPiece && (!movingPiece || targetPiece.color !== movingPiece.color)) {
      const captureArray = Array.isArray(this.captured[opponent]) ? [...this.captured[opponent]] : [];
      captureArray.push({ ...targetPiece });
      this.captured[opponent] = captureArray;
    }

    if (targetIndex !== -1) {
      this.moves[targetIndex] = {
        ...this.moves[targetIndex],
        state: GAME_CONSTANTS.moveStates.COMPLETED,
      };
      this.lastProcessedMoveIndex = Math.max(this.lastProcessedMoveIndex, targetIndex);
    }

    this.board = board;

    console.log('[bot] accepted pending move', {
      gameId: this.gameId,
      from,
      to,
      declaration: this.moves[targetIndex]?.declaration ?? targetMove.declaration,
    });
  }

  async ensureSetup() {
    if (this.color === null) return;
    const color = this.color;
    if (this.setupComplete[color]) return;
    if (this.pendingAction) return;
    const setup = this.prepareRandomSetup();
    if (!setup) {
      console.warn('[bot] prepareRandomSetup failed', {
        gameId: this.gameId,
        color,
        stashCount: this.stashes[color]?.length,
        boardRows: this.board.length,
      });
      return;
    }
    this.pendingAction = true;
    try {
      console.log('[bot] submitting setup', {
        gameId: this.gameId,
        color,
        pieces: setup.pieces.map(piece => ({ col: piece.col, identity: piece.identity })),
        onDeck: setup.onDeck?.identity,
      });
      await postJSON(this.serverUrl, '/api/v1/gameAction/setup', this.token, {
        gameId: this.gameId,
        color,
        pieces: setup.pieces,
        onDeck: setup.onDeck,
      });
      console.log('[bot] setup submission complete', { gameId: this.gameId, color });
    } catch (err) {
      console.error('Failed to submit setup', err);
    } finally {
      this.finalizeAction();
    }
  }

  prepareRandomSetup() {
    if (this.color === null) return null;
    const color = this.color;
    const row = color === 0 ? 0 : this.board.length - 1;
    if (!Array.isArray(this.stashes[color])) return null;

    const pool = [];
    const stash = this.stashes[color];
    stash.forEach((piece) => {
      if (piece && piece.color === color && typeof piece.identity === 'number' && piece.identity > 0) {
        pool.push({ ...piece });
      }
    });

    const onDeckPiece = this.onDecks[color];
    if (onDeckPiece && onDeckPiece.color === color && typeof onDeckPiece.identity === 'number' && onDeckPiece.identity > 0) {
      pool.push({ ...onDeckPiece });
    }

    const boardRow = this.board[row] || [];
    boardRow.forEach((piece) => {
      if (piece && piece.color === color && typeof piece.identity === 'number' && piece.identity > 0) {
        pool.push({ ...piece });
      }
    });

    if (pool.length < 6) return null;

    const kingIdx = pool.findIndex(piece => piece.identity === GAME_CONSTANTS.identities.KING);
    if (kingIdx === -1) return null;
    const rankPieces = [pool.splice(kingIdx, 1)[0]];

    while (rankPieces.length < 5 && pool.length > 0) {
      const idx = Math.floor(Math.random() * pool.length);
      rankPieces.push(pool.splice(idx, 1)[0]);
    }

    if (rankPieces.length < 5) return null;
    if (pool.length === 0) return null;

    const deckIndex = Math.floor(Math.random() * pool.length);
    const deckPiece = pool.splice(deckIndex, 1)[0];
    if (!deckPiece) return null;

    const columns = [0, 1, 2, 3, 4];
    for (let i = columns.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [columns[i], columns[j]] = [columns[j], columns[i]];
    }

    const pieces = rankPieces.map((piece, idx) => ({
      row,
      col: columns[idx],
      identity: piece.identity,
      color,
    }));

    return {
      pieces,
      onDeck: { identity: deckPiece.identity, color },
    };
  }

  async ensureReady() {
    if (this.color === null) return;
    const color = this.color;
    if (!this.setupComplete[color]) return;
    if (this.playersReady[color]) return;
    if (this.pendingAction) return;
    this.pendingAction = true;
    try {
      console.log('[bot] submitting ready', { gameId: this.gameId, color });
      await postJSON(this.serverUrl, '/api/v1/gameAction/ready', this.token, {
        gameId: this.gameId,
        color,
      });
      this.readySubmitted = true;
      console.log('[bot] ready submission complete', { gameId: this.gameId, color });
    } catch (err) {
      console.error('Failed to submit ready', err);
    } finally {
      this.finalizeAction();
    }
  }

  async placeOnDeck() {
    if (this.color === null) return;
    if (this.pendingAction) return;
    const color = this.color;
    if (this.onDecks[color]) return;
    const stash = Array.isArray(this.stashes[color]) ? this.stashes[color] : [];
    const available = stash.filter(piece => piece && piece.color === color && typeof piece.identity === 'number');
    if (!available.length) return;
    const idx = Math.floor(Math.random() * available.length);
    const piece = available[idx];
    this.pendingAction = true;
    try {
      await postJSON(this.serverUrl, '/api/v1/gameAction/onDeck', this.token, {
        gameId: this.gameId,
        color,
        piece: { identity: piece.identity },
      });
    } catch (err) {
      console.error('Failed to place on deck', err);
    } finally {
      this.finalizeAction();
    }
  }

  computeCapturedCounts() {
    const counts = {};
    if (this.color === null) return counts;
    const capturedByMe = this.captured[this.color] || [];
    capturedByMe.forEach((piece) => {
      counts[piece.identity] = (counts[piece.identity] || 0) + 1;
    });
    return counts;
  }

  evaluateChallenge(move) {
    if (this.color === null) return { shouldChallenge: false };
    const decision = { shouldChallenge: false };
    const capturedCounts = this.computeCapturedCounts();

    const declaration = move.declaration;
    const maxAvailable =
      declaration === GAME_CONSTANTS.identities.BOMB || declaration === GAME_CONSTANTS.identities.KING ? 1 : 2;
    const captured = capturedCounts[declaration] || 0;
    if (captured >= maxAvailable) {
      return { shouldChallenge: true, reason: 'Impossible declaration' };
    }

    const backRank = this.color === 0 ? 0 : this.board.length - 1;
    if (declaration === GAME_CONSTANTS.identities.KING && move.to.row === backRank) {
      return { shouldChallenge: true, reason: 'King reached back rank' };
    }

    const myDaggers = this.daggers[this.color] ?? 0;

    if (declaration === GAME_CONSTANTS.identities.BOMB) {
      const chance = myDaggers < 2 ? 1 : 0.2;
      if (Math.random() < chance) {
        return { shouldChallenge: true, reason: 'Bomb declaration' };
      }
    }

    const history = this.opponentPieceHistory.get(toKey(move.from));
    if (history && !history.has(declaration)) {
      const chance = myDaggers < 2 ? 0.8 : 0.5;
      if (Math.random() < chance) {
        return { shouldChallenge: true, reason: 'Identity change' };
      }
    }

    const lastAction = this.getLastAction();
    if (lastAction && lastAction.type === GAME_CONSTANTS.actions.BOMB) {
      const chance = myDaggers < 2 ? 1 : 0.2;
      if (Math.random() < chance) {
        return { shouldChallenge: true, reason: 'Bomb declaration' };
      }
    }

    return decision;
  }

  async issueChallenge(reason) {
    if (this.pendingAction || this.color === null) return;
    const color = this.color;
    this.pendingAction = true;
    try {
      await postJSON(this.serverUrl, '/api/v1/gameAction/challenge', this.token, {
        gameId: this.gameId,
        color,
      });
    } catch (err) {
      console.error('Challenge failed', err, reason);
    } finally {
      this.finalizeAction();
    }
  }

  async issuePass(reason) {
    if (this.pendingAction || this.color === null) return false;
    const color = this.color;
    this.pendingAction = true;
    try {
      await postJSON(this.serverUrl, '/api/v1/gameAction/pass', this.token, {
        gameId: this.gameId,
        color,
      });
      console.log('[bot] pass submitted', { gameId: this.gameId, reason });
      return true;
    } catch (err) {
      console.error('Pass failed', err, reason);
      return false;
    } finally {
      this.finalizeAction();
    }
  }

  shouldAttemptBomb(move, options = {}) {
    if (this.color === null) return false;
    const { force = false } = options;
    if (force) return true;
    const color = this.color;
    const myDaggers = this.daggers[color] ?? 0;
    const baseProbability = myDaggers < 2 ? 0.35 : 0.05;
    return Math.random() < baseProbability;
  }

  async considerBomb(move, options = {}) {
    if (this.pendingAction || this.color === null) return false;
    const { reason = 'Bomb action' } = options;
    const color = this.color;
    this.pendingAction = true;
    try {
      await postJSON(this.serverUrl, '/api/v1/gameAction/bomb', this.token, {
        gameId: this.gameId,
        color,
      });
      console.log('[bot] bomb submitted', { gameId: this.gameId, reason });
      return true;
    } catch (err) {
      console.error('Bomb attempt failed', err, reason);
      return false;
    } finally {
      this.finalizeAction();
    }
  }

  collectMyPieces() {
    const result = [];
    for (let r = 0; r < this.board.length; r += 1) {
      for (let c = 0; c < this.board[r].length; c += 1) {
        const cell = this.board[r][c];
        if (cell && cell.color === this.color) result.push({ piece: cell, coord: { row: r, col: c } });
      }
    }
    return result;
  }

  isOnBoard(row, col) {
    return row >= 0 && row < this.board.length && col >= 0 && col < this.board[0].length;
  }

  hasControllablePieceAt(coord) {
    if (!coord || this.color === null) return false;
    if (!this.board.length || !this.board[0].length) return false;
    if (!this.isOnBoard(coord.row, coord.col)) return false;
    const cell = this.board[coord.row][coord.col];
    return Boolean(cell && cell.color === this.color);
  }

  canBombPendingMove(move) {
    if (!move) return false;
    if (!this.hasControllablePieceAt(move.to)) return false;
    return true;
  }

  isDeclarationPermitted(identity) {
    if (identity === GAME_CONSTANTS.identities.KING) return true;
    return this.canDeclareIdentity(identity);
  }

  getLegalTargetsForDeclaration(coord, declaration) {
    const targets = [];
    const opponent = this.identifyOpponent();
    const addTarget = (row, col) => {
      if (!this.isOnBoard(row, col)) return false;
      const targetPiece = this.board[row][col];
      if (targetPiece && targetPiece.color === this.color) {
        return false;
      }
      targets.push({
        row,
        col,
        capture: Boolean(targetPiece && targetPiece.color === opponent),
      });
      return !targetPiece;
    };

    switch (declaration) {
      case GAME_CONSTANTS.identities.KNIGHT: {
        const jumps = [
          { row: coord.row + 2, col: coord.col + 1 },
          { row: coord.row + 2, col: coord.col - 1 },
          { row: coord.row - 2, col: coord.col + 1 },
          { row: coord.row - 2, col: coord.col - 1 },
          { row: coord.row + 1, col: coord.col + 2 },
          { row: coord.row + 1, col: coord.col - 2 },
          { row: coord.row - 1, col: coord.col + 2 },
          { row: coord.row - 1, col: coord.col - 2 },
        ];
        jumps.forEach(({ row, col }) => {
          addTarget(row, col);
        });
        break;
      }
      case GAME_CONSTANTS.identities.KING: {
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            if (dr === 0 && dc === 0) continue;
            addTarget(coord.row + dr, coord.col + dc);
          }
        }
        break;
      }
      case GAME_CONSTANTS.identities.BISHOP: {
        const directions = [
          { dr: 1, dc: 1 },
          { dr: 1, dc: -1 },
          { dr: -1, dc: 1 },
          { dr: -1, dc: -1 },
        ];
        directions.forEach(({ dr, dc }) => {
          for (let step = 1; step <= 3; step += 1) {
            const row = coord.row + dr * step;
            const col = coord.col + dc * step;
            if (!addTarget(row, col)) break;
          }
        });
        break;
      }
      case GAME_CONSTANTS.identities.ROOK:
      case GAME_CONSTANTS.identities.BOMB: {
        const directions = [
          { dr: 1, dc: 0 },
          { dr: -1, dc: 0 },
          { dr: 0, dc: 1 },
          { dr: 0, dc: -1 },
        ];
        directions.forEach(({ dr, dc }) => {
          for (let step = 1; step <= 3; step += 1) {
            const row = coord.row + dr * step;
            const col = coord.col + dc * step;
            if (!addTarget(row, col)) break;
          }
        });
        break;
      }
      default:
        break;
    }

    return targets;
  }

  getLegalDeclarationsForMove(move) {
    const declarations = new Set();
    const dr = move.to.row - move.from.row;
    const dc = move.to.col - move.from.col;
    const absDr = Math.abs(dr);
    const absDc = Math.abs(dc);

    if ((absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2)) {
      declarations.add(GAME_CONSTANTS.identities.KNIGHT);
    }

    if (absDr <= 1 && absDc <= 1 && (absDr !== 0 || absDc !== 0)) {
      declarations.add(GAME_CONSTANTS.identities.KING);
    }

    if (absDr === absDc && absDr > 0 && absDr <= 3) {
      declarations.add(GAME_CONSTANTS.identities.BISHOP);
    }

    if ((dr === 0 || dc === 0) && (absDr + absDc > 0) && absDr <= 3 && absDc <= 3) {
      declarations.add(GAME_CONSTANTS.identities.ROOK);
      declarations.add(GAME_CONSTANTS.identities.BOMB);
    }

    return Array.from(declarations);
  }

  generateMoves() {
    if (this.color === null) return [];
    const moves = [];
    this.collectMyPieces().forEach(({ piece, coord }) => {
      MOVE_DECLARATIONS.forEach((declaration) => {
        if (!this.isDeclarationPermitted(declaration)) return;
        const targets = this.getLegalTargetsForDeclaration(coord, declaration);
        targets.forEach(({ row, col, capture }) => {
          moves.push({
            from: { ...coord },
            to: { row, col },
            declaration,
            capture,
            sourceIdentity: piece.identity,
          });
        });
      });
    });
    return moves;
  }

  canDeclareIdentity(identity) {
    if (identity === GAME_CONSTANTS.identities.KING) return true;
    const available = this.getAvailableIdentityCounts();
    return (available[identity] || 0) > 0;
  }

  scoreMoves(options) {
    if (this.color === null) return [];
    const color = this.color;
    const opponentCount = this.countPieces(this.identifyOpponent());
    const myCount = this.countPieces(color);
    const homeRank = color === 0 ? 0 : this.board.length - 1;

    return options.map(option => {
      const piece = this.board[option.from.row][option.from.col];
      let score = 0;
      const forwardDelta = color === 0 ? option.to.row - option.from.row : option.from.row - option.to.row;
      score += forwardDelta * 0.5;

      const distanceFromHome = Math.abs(option.to.row - homeRank);
      if (piece && piece.identity !== GAME_CONSTANTS.identities.KING) {
        score += distanceFromHome;
      }

      if (piece && piece.identity === GAME_CONSTANTS.identities.KING) {
        const remaining = this.countPieces(color);
        if (remaining < 3) {
          score += distanceFromHome * 2;
        }
      }

      if (option.capture) {
        if (myCount < opponentCount) {
          score += 15;
        } else {
          score += 6;
        }
      }

      return { option, score };
    });
  }

  selectMove(candidates) {
    const poolSource = Array.isArray(candidates) && candidates.length ? candidates : this.generateMoves();
    if (!poolSource.length) return null;
    if (this.color === null) return null;

    const color = this.color;
    if (this.countPieces(color) <= 1) {
      const kingMoves = poolSource.filter(option => option.declaration === GAME_CONSTANTS.identities.KING);
      if (kingMoves.length) {
        return kingMoves[Math.floor(Math.random() * kingMoves.length)];
      }
    }
    const opponentHome = color === 0 ? this.board.length - 1 : 0;
    const canDeclareKing = this.canDeclareIdentity(GAME_CONSTANTS.identities.KING);
    if (canDeclareKing) {
      const winningMove = poolSource.find(option => option.to.row === opponentHome);
      if (winningMove) {
        return { ...winningMove, forceKing: true };
      }
    }

    const myCount = this.countPieces(color);
    const opponentCount = this.countPieces(this.identifyOpponent());
    const captureMoves = poolSource.filter(option => option.capture);
    let pool = poolSource;
    if (captureMoves.length) {
      if (myCount < opponentCount) {
        pool = captureMoves;
      } else if (Math.random() < 0.6) {
        pool = captureMoves;
      }
    }

    const scored = this.scoreMoves(pool);
    scored.sort((a, b) => b.score - a.score + (Math.random() - 0.5) * 0.1);
    return scored[0]?.option || null;
  }

  chooseDeclaration(move, bluff, options = {}) {
    const piece = this.board[move.from.row][move.from.col];
    if (!piece) return move.declaration;

    let legalDeclarations = Array.isArray(options.allowed) && options.allowed.length
      ? [...options.allowed]
      : this.getLegalDeclarationsForMove(move);

    legalDeclarations = legalDeclarations.filter(identity =>
      identity === GAME_CONSTANTS.identities.KING || this.canDeclareIdentity(identity)
    );

    if (!legalDeclarations.length) {
      return move.declaration;
    }

    const color = this.color;
    if (color !== null && this.countPieces(color) <= 1 && legalDeclarations.includes(GAME_CONSTANTS.identities.KING)) {
      return GAME_CONSTANTS.identities.KING;
    }

    if (!bluff) {
      return legalDeclarations.includes(move.declaration) ? move.declaration : legalDeclarations[0];
    }

    const myDaggers = color !== null ? (this.daggers[color] ?? 0) : 0;
    const alternatives = legalDeclarations.filter(identity => identity !== move.declaration);
    if (!alternatives.length) {
      return legalDeclarations.includes(move.declaration) ? move.declaration : legalDeclarations[0];
    }

    if (myDaggers < 2) {
      const bombOptions = alternatives.filter(identity => identity === GAME_CONSTANTS.identities.BOMB);
      if (bombOptions.length && Math.random() < 0.35) {
        return GAME_CONSTANTS.identities.BOMB;
      }
    }

    const idx = Math.floor(Math.random() * alternatives.length);
    return alternatives[idx];
  }

  getMoveAttemptKey(move, declaration) {
    const from = move?.from || {};
    const to = move?.to || {};
    return `${from.row},${from.col}->${to.row},${to.col}:${declaration}`;
  }

  getAvailableDeclarations(move, attemptedSet) {
    if (!move || !move.from || !move.to) return [];
    let legal = this.getLegalDeclarationsForMove(move);
    legal = legal.filter(identity =>
      identity === GAME_CONSTANTS.identities.KING || this.canDeclareIdentity(identity)
    );

    if (move.forceKing) {
      legal = legal.filter(identity => identity === GAME_CONSTANTS.identities.KING);
    }

    if (attemptedSet) {
      legal = legal.filter(identity => !attemptedSet.has(this.getMoveAttemptKey(move, identity)));
    }

    return legal;
  }

  markMoveExhausted(move, attemptedSet) {
    if (!attemptedSet) return;
    const legal = this.getLegalDeclarationsForMove(move).filter(identity =>
      identity === GAME_CONSTANTS.identities.KING || this.canDeclareIdentity(identity)
    );
    legal.forEach(identity => attemptedSet.add(this.getMoveAttemptKey(move, identity)));
  }

  extractErrorMessage(err) {
    if (!err) return '';
    if (err.data && typeof err.data.message === 'string') return err.data.message;
    if (typeof err.message === 'string') return err.message;
    return '';
  }

  getAvailableIdentityCounts() {
    if (this.color === null) return {};
    const counts = {};
    const stash = this.stashes[this.color] || [];
    stash.forEach((piece) => {
      counts[piece.identity] = (counts[piece.identity] || 0) + 1;
    });
    const boardPieces = this.collectMyPieces();
    boardPieces.forEach(({ piece }) => {
      counts[piece.identity] = (counts[piece.identity] || 0) + 1;
    });
    const onDeck = this.onDecks[this.color];
    if (onDeck) {
      counts[onDeck.identity] = (counts[onDeck.identity] || 0) + 1;
    }
    return counts;
  }

  countPieces(color) {
    let total = 0;
    for (let r = 0; r < this.board.length; r += 1) {
      for (let c = 0; c < this.board[r].length; c += 1) {
        if (this.board[r][c]?.color === color) total += 1;
      }
    }
    return total;
  }

  locateMyKing() {
    if (this.color === null) return null;
    for (let r = 0; r < this.board.length; r += 1) {
      for (let c = 0; c < this.board[r].length; c += 1) {
        const cell = this.board[r][c];
        if (cell && cell.color === this.color && cell.identity === GAME_CONSTANTS.identities.KING) {
          return { row: r, col: c };
        }
      }
    }
    return null;
  }

  hasBombAvailable() {
    const counts = this.getAvailableIdentityCounts();
    return (counts[GAME_CONSTANTS.identities.BOMB] || 0) > 0;
  }

  evaluateKingThreatResponse(move) {
    if (this.color === null || !move || !move.to) return null;
    const kingPosition = this.locateMyKing();
    if (!kingPosition) return null;
    if (move.to.row !== kingPosition.row || move.to.col !== kingPosition.col) {
      return null;
    }

    if (!this.hasControllablePieceAt(move.to)) {
      return { action: 'challenge', reason: 'King attacked (king missing at target)' };
    }

    const remainingPieces = this.countPieces(this.color);
    if (!this.hasBombAvailable() || remainingPieces <= 1) {
      return { action: 'challenge', reason: 'King attacked (no bomb available)' };
    }

    if (Math.random() < 0.7) {
      return { action: 'challenge', reason: 'King attacked (challenge priority)' };
    }

    return { action: 'bomb', reason: 'King attacked (bomb response)' };
  }

  identifyOpponent() {
    if (this.color === null) return 1;
    return this.color === 0 ? 1 : 0;
  }

  collectLegalActions() {
    const pendingMove = this.hasPendingOpponentMove();
    const lastAction = this.getLastAction();
    const canBomb = Boolean(
      pendingMove &&
      lastAction &&
      lastAction.type === GAME_CONSTANTS.actions.MOVE &&
      lastAction.player === this.identifyOpponent() &&
      this.canBombPendingMove(pendingMove)
    );

    const canOnDeck = this.onDeckingPlayer === this.color && !this.onDecks[this.color];

    return {
      moves: this.generateMoves(),
      pendingMove,
      canChallenge: Boolean(pendingMove),
      canBomb,
      canOnDeck,
      canPass: true,
    };
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

    const plan = {
      key,
      move: snapshot,
      timestamp,
      response: 'accept',
      reason: 'Default accept',
      forceBomb: false,
      status: 'pending',
    };

    const kingResponse = this.evaluateKingThreatResponse(move);
    if (kingResponse) {
      if (kingResponse.action === 'bomb') {
        if (context.canBomb && this.canBombPendingMove(move)) {
          plan.response = 'bomb';
          plan.reason = kingResponse.reason;
          plan.forceBomb = true;
        } else {
          plan.response = 'challenge';
          plan.reason = kingResponse.reason;
        }
      } else {
        plan.response = 'challenge';
        plan.reason = kingResponse.reason;
      }
      this.pendingMovePlan = plan;
      console.log('[bot] pending move plan created', {
        gameId: this.gameId,
        response: plan.response,
        reason: plan.reason,
      });
      return;
    }

    const decision = this.evaluateChallenge(move);
    if (decision.shouldChallenge) {
      plan.response = 'challenge';
      plan.reason = decision.reason || 'Challenge decision';
      this.pendingMovePlan = plan;
      console.log('[bot] pending move plan created', {
        gameId: this.gameId,
        response: plan.response,
        reason: plan.reason,
      });
      return;
    }

    if (context.canBomb && this.canBombPendingMove(move) && this.shouldAttemptBomb(move)) {
      plan.response = 'bomb';
      plan.reason = 'Bomb heuristic';
    }

    this.pendingMovePlan = plan;
    console.log('[bot] pending move plan created', {
      gameId: this.gameId,
      response: plan.response,
      reason: plan.reason,
    });
  }

  schedulePendingMovePlan() {
    const plan = this.pendingMovePlan;
    if (!plan) return false;
    if (plan.status === 'scheduled') return true;

    const handler = async () => {
      if (!this.pendingMovePlan || this.pendingMovePlan.key !== plan.key) return;
      this.pendingMovePlan.status = 'executing';
      try {
        if (plan.response === 'challenge') {
          await this.issueChallenge(plan.reason);
          this.pendingMovePlan = null;
          return;
        }

        if (plan.response === 'bomb') {
          if (!this.canBombPendingMove(plan.move)) {
            console.warn('[bot] aborting bomb plan (no controllable piece)', {
              gameId: this.gameId,
            });
            if (plan.forceBomb) {
              await this.issueChallenge(plan.reason);
              this.pendingMovePlan = null;
              return;
            }
            if (plan.move) {
              this.acknowledgePendingMove(plan.move);
            }
            this.pendingMovePlan = null;
            if (this.playerTurn === this.color) {
              await this.executeMoveDecision();
            }
            return;
          }
          const bombed = await this.considerBomb(plan.move, { reason: plan.reason });
          if (!bombed && plan.forceBomb) {
            console.log('[bot] forced bomb unavailable, challenging instead', { gameId: this.gameId });
            await this.issueChallenge(plan.reason);
            this.pendingMovePlan = null;
            return;
          }
          if (bombed) {
            this.pendingMovePlan = null;
            return;
          }
        }

        if (plan.move) {
          this.acknowledgePendingMove(plan.move);
        }
        this.pendingMovePlan = null;
        if (this.playerTurn === this.color) {
          await this.executeMoveDecision();
        }
      } finally {
        if (this.pendingMovePlan && this.pendingMovePlan.key === plan.key) {
          this.pendingMovePlan = null;
        }
      }
    };

    this.scheduleAction(`pending-move-${plan.response}`, plan.timestamp, handler);
    plan.status = 'scheduled';
    return true;
  }

  prepareBombPlan() {
    const lastIndex = this.actions.length - 1;
    if (lastIndex < 0) {
      this.pendingBombPlan = null;
      return;
    }

    if (lastIndex <= this.lastHandledActionIndex) {
      return;
    }

    const action = this.actions[lastIndex];
    if (!action || action.type !== GAME_CONSTANTS.actions.BOMB || action.player === this.color) {
      this.lastHandledActionIndex = lastIndex;
      this.pendingBombPlan = null;
      return;
    }

    this.lastHandledActionIndex = lastIndex;
    const timestamp = this.markOpponentEvent(action.timestamp, 'bomb');
    const myDaggers = this.color !== null ? (this.daggers[this.color] ?? 0) : 0;
    const shouldChallenge = myDaggers < 2 || Math.random() < 0.2;

    this.pendingBombPlan = {
      key: `${lastIndex}:${timestamp}`,
      timestamp,
      response: shouldChallenge ? 'challenge' : 'pass',
      status: 'pending',
    };

    console.log('[bot] bomb plan created', {
      gameId: this.gameId,
      response: this.pendingBombPlan.response,
    });
  }

  scheduleBombPlan() {
    const plan = this.pendingBombPlan;
    if (!plan) return false;
    if (plan.status === 'scheduled') return true;

    const handler = async () => {
      if (!this.pendingBombPlan || this.pendingBombPlan.key !== plan.key) return;
      this.pendingBombPlan.status = 'executing';
      try {
        if (plan.response === 'challenge') {
          await this.issueChallenge('Bomb action');
        } else {
          const passed = await this.issuePass('Bomb action - declined challenge');
          if (!passed) {
            console.error('\x1b[31m[bot] failed to pass after bomb action\x1b[0m', {
              gameId: this.gameId,
            });
          }
        }
      } finally {
        this.pendingBombPlan = null;
      }
    };

    this.scheduleAction(`bomb-${plan.response}`, plan.timestamp, handler);
    plan.status = 'scheduled';
    return true;
  }

  clearActionTimer() {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
  }

  scheduleAction(label, eventTimestamp, handler) {
    const reference = typeof eventTimestamp === 'number' ? eventTimestamp : this.lastOpponentEventAt;
    const now = Date.now();
    const elapsed = reference != null ? now - reference : 0;
    const delayMs = Math.max(0, 2000 - elapsed);
    this.clearActionTimer();
    const execute = async () => {
      if (this.pendingAction) {
        console.log('[bot] deferred scheduled action due to pending action', {
          gameId: this.gameId,
          label,
        });
        this.actionTimer = setTimeout(execute, 50);
        return;
      }
      this.actionTimer = null;
      try {
        await handler();
      } catch (err) {
        console.error(`[bot] scheduled action failed (${label})`, err);
      }
    };
    this.actionTimer = setTimeout(execute, delayMs);
    console.log('[bot] action scheduled', { gameId: this.gameId, label, delayMs });
  }

  processStateEvaluation() {
    if (this.pendingAction) return;
    if (!this.pendingStateEvaluation) return;
    this.pendingStateEvaluation = false;
    if (this.color === null) return;

    if (!this.isActive) {
      this.clearActionTimer();
      return;
    }

    this.prepareBombPlan();
    if (this.scheduleBombPlan()) {
      return;
    }

    const legalActions = this.collectLegalActions();
    this.preparePendingMovePlan(legalActions.pendingMove, { canBomb: legalActions.canBomb });
    if (this.schedulePendingMovePlan()) {
      return;
    }

    this.handleAvailableActions(legalActions);
  }

  finalizeAction() {
    this.pendingAction = false;
    this.processStateEvaluation();
  }

  async executeMoveDecision() {
    if (this.pendingAction) return;
    if (this.color === null) return;
    if (this.playerTurn !== this.color) return;
    const legal = this.collectLegalActions();
    if (legal.pendingMove) {
      console.warn('[bot] move decision invoked with pending move', {
        gameId: this.gameId,
      });
      return;
    }

    const candidateMoves = Array.isArray(legal.moves) ? [...legal.moves] : [];
    const attemptedDeclarations = new Set();

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const viableMoves = candidateMoves.filter(option => this.getAvailableDeclarations(option, attemptedDeclarations).length);
      if (!viableMoves.length) {
        console.log('[bot] no legal move available', { gameId: this.gameId, attempts: attempt });
        return;
      }

      const move = this.selectMove(viableMoves);
      if (!move) {
        console.log('[bot] move selection failed', { gameId: this.gameId });
        return;
      }

      const availableDeclarations = this.getAvailableDeclarations(move, attemptedDeclarations);
      if (!availableDeclarations.length) {
        this.markMoveExhausted(move, attemptedDeclarations);
        continue;
      }

      let declaration = null;
      const myDaggers = this.daggers[this.color] ?? 0;

      if (move.forceKing) {
        if (availableDeclarations.includes(GAME_CONSTANTS.identities.KING)) {
          declaration = GAME_CONSTANTS.identities.KING;
        } else {
          this.markMoveExhausted(move, attemptedDeclarations);
          continue;
        }
      } else {
        let bluffChance = 0;
        if (myDaggers < 2) {
          bluffChance = move.capture ? 0.5 : 0.2;
        } else {
          bluffChance = move.capture ? 0.25 : 0.1;
        }
        declaration = this.chooseDeclaration(move, Math.random() < bluffChance, {
          allowed: availableDeclarations,
        });

        if (!availableDeclarations.includes(declaration)) {
          declaration = availableDeclarations[0];
        }
      }

      if (declaration == null) {
        this.markMoveExhausted(move, attemptedDeclarations);
        continue;
      }

      const attemptKey = this.getMoveAttemptKey(move, declaration);
      if (attemptedDeclarations.has(attemptKey)) {
        this.markMoveExhausted(move, attemptedDeclarations);
        continue;
      }

      let retryMove = false;
      this.pendingAction = true;
      try {
        console.log('[bot] submitting move', {
          gameId: this.gameId,
          from: move.from,
          to: move.to,
          declaration,
          capture: move.capture,
        });
        await this.waitBeforeMoveSubmission();
        await postJSON(this.serverUrl, '/api/v1/gameAction/move', this.token, {
          gameId: this.gameId,
          color: this.color,
          from: move.from,
          to: move.to,
          declaration,
        });
        this.lastBoard = cloneBoard(this.board);
        return;
      } catch (err) {
        const message = this.extractErrorMessage(err);
        if (message === 'Invalid declaration' || message === 'Illegal move') {
          attemptedDeclarations.add(attemptKey);
          console.error(`\x1b[31m[bot] move rejected\x1b[0m`, {
            gameId: this.gameId,
            from: move.from,
            to: move.to,
            declaration,
            message,
          });
          retryMove = true;
        } else {
          console.error('Failed to play move', err);
          return;
        }
      } finally {
        this.finalizeAction();
      }

      if (!retryMove) {
        return;
      }
    }

    console.error('\x1b[31m[bot] exhausted move attempts without success\x1b[0m', {
      gameId: this.gameId,
    });
  }

  async handleUpdate(payload) {
    this.updateFromPayload(payload);
    this.trackMoveHistory();
    await this.ensureSetup();
    await this.ensureReady();
    this.pendingStateEvaluation = true;
    if (this.pendingAction) return;

    this.processStateEvaluation();
  }
}

BaseBotController.prototype.handleAvailableActions = function handleAvailableActions(legalActions) {
  if (!legalActions) return;
  if (legalActions.canOnDeck) {
    if (this.pendingOnDeckTimestamp == null) {
      this.pendingOnDeckTimestamp = this.lastOpponentEventAt ?? Date.now();
    }
    this.scheduleAction('on-deck', this.pendingOnDeckTimestamp, async () => {
      this.pendingOnDeckTimestamp = null;
      await this.placeOnDeck();
    });
    return;
  }
  this.pendingOnDeckTimestamp = null;

  if (this.playerTurn === this.color) {
    if (this.lastOpponentEventAt == null) {
      this.lastOpponentEventAt = Date.now();
    }
    this.scheduleAction('move', this.lastOpponentEventAt, async () => {
      await this.executeMoveDecision();
    });
  } else {
    this.clearActionTimer();
  }
};

module.exports = {
  GAME_CONSTANTS,
  MOVE_DECLARATIONS,
  BaseBotController,
  cloneBoard,
  cloneStashes,
  postJSON,
  toKey,
};
