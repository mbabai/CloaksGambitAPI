const {
  GAME_CONSTANTS,
  MOVE_DECLARATIONS,
  cloneBoard,
  postJSON,
} = require('./baseBot');
const { MediumBotController } = require('./mediumBot');
const DEFAULT_WEIGHTS = require('./hardBot.weights.json');

const IDS = GAME_CONSTANTS.identities;
const ACTIONS = GAME_CONSTANTS.actions;

const IDENTITY_LIST = [
  IDS.KING,
  IDS.BOMB,
  IDS.BISHOP,
  IDS.ROOK,
  IDS.KNIGHT,
];

const TOTAL_COUNTS = {
  [IDS.KING]: 1,
  [IDS.BOMB]: 1,
  [IDS.BISHOP]: 2,
  [IDS.ROOK]: 2,
  [IDS.KNIGHT]: 2,
};

const VALUE_NAMES = {
  [IDS.UNKNOWN]: 'UNKNOWN',
  [IDS.KING]: 'KING',
  [IDS.BOMB]: 'BOMB',
  [IDS.BISHOP]: 'BISHOP',
  [IDS.ROOK]: 'ROOK',
  [IDS.KNIGHT]: 'KNIGHT',
};

function coordKey(coord) {
  if (!coord) return '';
  return `${coord.row},${coord.col}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cloneTrack(track) {
  return {
    id: track.id,
    color: track.color,
    cameFromOnDeck: Boolean(track.cameFromOnDeck),
    forcedIdentity: typeof track.forcedIdentity === 'number' ? track.forcedIdentity : null,
    declarations: new Set(track.declarations || []),
    declarationCounts: { ...(track.declarationCounts || {}) },
    impossible: new Set(track.impossible || []),
    wasBluffBefore: Boolean(track.wasBluffBefore),
  };
}

function identityCertainty(identity) {
  const probs = {};
  IDENTITY_LIST.forEach((candidate) => {
    probs[candidate] = candidate === identity ? 1 : 0;
  });
  return probs;
}

function normalizeProbs(probs) {
  let total = 0;
  IDENTITY_LIST.forEach((identity) => {
    const value = Number(probs[identity] || 0);
    probs[identity] = value > 0 ? value : 0;
    total += probs[identity];
  });

  if (total <= 0) {
    const fallback = 1 / IDENTITY_LIST.length;
    IDENTITY_LIST.forEach((identity) => {
      probs[identity] = fallback;
    });
    return probs;
  }

  IDENTITY_LIST.forEach((identity) => {
    probs[identity] /= total;
  });
  return probs;
}

function weightedRandom(items, getWeight) {
  const weighted = items
    .map((item) => ({ item, weight: Math.max(0, Number(getWeight(item)) || 0) }))
    .filter(entry => entry.weight > 0);
  if (!weighted.length) return items[0] || null;
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let target = Math.random() * total;
  for (const entry of weighted) {
    target -= entry.weight;
    if (target <= 0) return entry.item;
  }
  return weighted[weighted.length - 1].item;
}

function softmaxProbability(a, b, temperature) {
  const temp = Math.max(1, Number(temperature) || 1);
  const max = Math.max(a, b);
  const ea = Math.exp((a - max) / temp);
  const eb = Math.exp((b - max) / temp);
  return ea / (ea + eb);
}

class HardBotController extends MediumBotController {
  constructor(...args) {
    super(...args);
    this.hardWeights = DEFAULT_WEIGHTS;
    this.hardState = {
      pieceTracks: [new Map(), new Map()],
      offBoardIdentities: [new Set(), new Set()],
      nextTrackId: 1,
      recordedMoveCount: 0,
    };
  }

  updateFromPayload(payload) {
    const previousBoard = Array.isArray(this.board) ? cloneBoard(this.board) : [];
    const previousTracks = this.cloneTrackMaps();
    super.updateFromPayload(payload);
    this.syncBoardIdentityLocks();
    this.syncPieceTracks(previousBoard, previousTracks);
    this.recordBombEvidenceFromActions();
    this.recordMoveDeclarations();
  }

  cloneTrackMaps() {
    return this.hardState.pieceTracks.map((trackMap) => {
      const cloned = new Map();
      trackMap.forEach((track, key) => cloned.set(key, cloneTrack(track)));
      return cloned;
    });
  }

  createTrack(color, options = {}) {
    const track = {
      id: this.hardState.nextTrackId,
      color,
      cameFromOnDeck: Boolean(options.cameFromOnDeck),
      forcedIdentity: typeof options.forcedIdentity === 'number' ? options.forcedIdentity : null,
      declarations: new Set(),
      declarationCounts: {},
      impossible: new Set(),
      wasBluffBefore: false,
    };
    this.hardState.nextTrackId += 1;
    if (track.cameFromOnDeck) {
      track.impossible.add(IDS.KING);
    }
    return track;
  }

  forceTrackIdentity(track, identity) {
    if (!track || !IDENTITY_LIST.includes(identity)) return;
    track.forcedIdentity = identity;
    track.impossible.delete(identity);
  }

  clearForcedIdentity(track, identity = null) {
    if (!track) return;
    if (identity === null || track.forcedIdentity === identity) {
      track.forcedIdentity = null;
    }
  }

  markTrackImpossible(track, identity) {
    if (!track || !IDENTITY_LIST.includes(identity)) return;
    if (track.forcedIdentity === identity) {
      track.forcedIdentity = null;
    }
    track.impossible.add(identity);
  }

  forceTrackIdentityAt(color, coord, identity) {
    const track = this.getTrack(color, coord);
    if (!track) return false;
    this.forceTrackIdentity(track, identity);
    return true;
  }

  isForcedIdentityActive(color, track) {
    return Boolean(
      track
      && typeof track.forcedIdentity === 'number'
      && this.getRemainingPublicCount(color, track.forcedIdentity) > 0
      && !this.isIdentityLockedOffBoard(color, track.forcedIdentity)
      && !track.impossible?.has(track.forcedIdentity)
    );
  }

  isIdentityLockedOffBoard(color, identity) {
    return Boolean(this.hardState.offBoardIdentities?.[color]?.has(identity));
  }

  getBoardAvailablePublicCount(color, identity) {
    if (this.isIdentityLockedOffBoard(color, identity)) return 0;
    return this.getRemainingPublicCount(color, identity);
  }

  getTrack(color, coord) {
    if (color !== 0 && color !== 1) return null;
    return this.hardState.pieceTracks[color].get(coordKey(coord)) || null;
  }

  syncPieceTracks(previousBoard, previousTracks) {
    if (!Array.isArray(this.board) || !this.board.length) return;

    const nextTracks = [new Map(), new Map()];
    const usedPrevious = [new Set(), new Set()];
    const deckReplacementKeys = this.getDeckReplacementKeys();

    for (let color = 0; color <= 1; color += 1) {
      const currentPieces = this.collectPiecesOfColor(this.board, color);

      currentPieces.forEach(({ coord }) => {
        const key = coordKey(coord);
        const previousPiece = previousBoard?.[coord.row]?.[coord.col];
        const directTrack = previousPiece && previousPiece.color === color
          ? previousTracks[color].get(key)
          : null;

        if (directTrack) {
          nextTracks[color].set(key, directTrack);
          usedPrevious[color].add(key);
        }
      });

      currentPieces.forEach(({ coord }) => {
        const key = coordKey(coord);
        if (nextTracks[color].has(key)) return;

        const deckReplacement = deckReplacementKeys.has(`${color}:${key}`);
        const movedTrack = deckReplacement
          ? null
          : this.findMovedTrack(color, coord, previousBoard, previousTracks, usedPrevious[color]);

        if (movedTrack) {
          nextTracks[color].set(key, movedTrack.track);
          usedPrevious[color].add(movedTrack.previousKey);
          return;
        }

        nextTracks[color].set(key, this.createTrack(color, {
          cameFromOnDeck: deckReplacement || this.inferNewPieceFromOnDeck(color, coord, previousBoard),
        }));
      });
    }

    this.hardState.pieceTracks = nextTracks;
  }

  findMovedTrack(color, coord, previousBoard, previousTracks, usedPrevious) {
    const lastMove = this.getLastMove();
    const key = coordKey(coord);
    if (lastMove && lastMove.player === color && coordKey(lastMove.to) === key) {
      const fromKey = coordKey(lastMove.from);
      const track = previousTracks[color].get(fromKey);
      if (track && !usedPrevious.has(fromKey)) {
        return { track, previousKey: fromKey };
      }
    }

    const candidates = [];
    previousTracks[color].forEach((track, previousKey) => {
      if (usedPrevious.has(previousKey)) return;
      const [rowRaw, colRaw] = previousKey.split(',');
      const row = Number(rowRaw);
      const col = Number(colRaw);
      const previousPiece = previousBoard?.[row]?.[col];
      const currentPiece = this.board?.[row]?.[col];
      if (previousPiece?.color === color && currentPiece?.color !== color) {
        candidates.push({ track, previousKey });
      }
    });

    return candidates.length === 1 ? candidates[0] : null;
  }

  inferNewPieceFromOnDeck(color, coord, previousBoard) {
    const previousPiece = previousBoard?.[coord.row]?.[coord.col];
    if (previousPiece && previousPiece.color === color) return false;
    return this.getDeckReplacementKeys().has(`${color}:${coordKey(coord)}`);
  }

  getDeckReplacementKeys() {
    const keys = new Set();
    const lastMove = this.getLastMove();
    const context = this.getLatestFailedChallengeContext();
    if (!context || !lastMove) return keys;

    const previousAction = context.previousAction;
    if (previousAction?.type === ACTIONS.BOMB) {
      keys.add(`${1 - lastMove.player}:${coordKey(lastMove.to)}`);
      return keys;
    }

    keys.add(`${lastMove.player}:${coordKey(lastMove.to)}`);
    return keys;
  }

  getLatestFailedChallengeContext() {
    if (!Array.isArray(this.actions) || !this.actions.length) return null;
    let index = this.actions.length - 1;
    let action = this.actions[index];
    if (action?.type === ACTIONS.ON_DECK && index > 0) {
      index -= 1;
      action = this.actions[index];
    }
    if (!action || action.type !== ACTIONS.CHALLENGE) return null;
    if (action.details?.outcome !== 'FAIL') return null;
    return {
      action,
      index,
      previousAction: index >= 1 ? this.actions[index - 1] : null,
    };
  }

  syncBoardIdentityLocks() {
    const locks = [new Set(), new Set()];
    if (!Array.isArray(this.actions)) {
      this.hardState.offBoardIdentities = locks;
      return;
    }

    let moveIndex = -1;
    let activeMove = null;
    this.actions.forEach((action, index) => {
      if (!action) return;
      if (action.type === ACTIONS.MOVE) {
        moveIndex += 1;
        activeMove = this.moves?.[moveIndex] || null;
        return;
      }

      if (action.type !== ACTIONS.CHALLENGE) return;
      const outcome = typeof action.details?.outcome === 'string'
        ? action.details.outcome.toUpperCase()
        : '';
      if (outcome !== 'FAIL') return;

      const previousAction = this.actions[index - 1];
      if (previousAction?.type === ACTIONS.BOMB) {
        if (previousAction.player === 0 || previousAction.player === 1) {
          locks[previousAction.player].add(IDS.BOMB);
        }
        return;
      }

      if (previousAction?.type === ACTIONS.MOVE) {
        const replacementColor = activeMove?.player;
        if (replacementColor === 0 || replacementColor === 1) {
          locks[replacementColor].delete(IDS.BOMB);
        }
      }
    });

    this.hardState.offBoardIdentities = locks;
  }

  recordBombEvidenceFromActions() {
    if (!Array.isArray(this.actions) || this.actions.length < 2) return;
    const lastAction = this.getLastAction();
    const previousAction = this.actions[this.actions.length - 2];
    const lastMove = this.getLastMove();
    if (!lastAction || !previousAction || !lastMove) return;
    if (previousAction.type !== ACTIONS.BOMB) return;

    const bombColor = previousAction.player;
    if (bombColor !== 0 && bombColor !== 1) return;
    if (bombColor === this.color) return;

    const targetTrack = this.getTrack(bombColor, lastMove.to);
    if (lastAction.type === ACTIONS.PASS && lastAction.player === this.color) {
      this.forceTrackIdentity(targetTrack, IDS.BOMB);
      return;
    }

    if (lastAction.type !== ACTIONS.CHALLENGE || lastAction.player !== this.color) return;
    const outcome = typeof lastAction.details?.outcome === 'string'
      ? lastAction.details.outcome.toUpperCase()
      : '';
    if (outcome === 'SUCCESS') {
      this.markTrackImpossible(targetTrack, IDS.BOMB);
    } else if (outcome === 'FAIL') {
      this.clearForcedIdentity(targetTrack, IDS.BOMB);
    }
  }

  recordMoveDeclarations() {
    if (!Array.isArray(this.moves)) return;
    for (let idx = this.hardState.recordedMoveCount; idx < this.moves.length; idx += 1) {
      const move = this.moves[idx];
      if (!move || typeof move.player !== 'number') continue;
      const track = this.findTrackForMove(move);
      if (track) {
        this.recordDeclarationOnTrack(track, move.declaration);
      }
    }
    this.hardState.recordedMoveCount = this.moves.length;
  }

  findTrackForMove(move) {
    if (!move || typeof move.player !== 'number') return null;
    const map = this.hardState.pieceTracks[move.player];
    return map.get(coordKey(move.from)) || map.get(coordKey(move.to)) || null;
  }

  recordDeclarationOnTrack(track, declaration) {
    if (!track || typeof declaration !== 'number') return;
    track.declarations.add(declaration);
    track.declarationCounts[declaration] = (track.declarationCounts[declaration] || 0) + 1;

    if (track.color === this.color) {
      const coord = this.findTrackCoord(track);
      const piece = coord ? this.board?.[coord.row]?.[coord.col] : null;
      if (piece && piece.identity !== declaration) {
        track.wasBluffBefore = true;
      }
    }
  }

  findTrackCoord(track) {
    if (!track || track.color !== 0 && track.color !== 1) return null;
    let found = null;
    this.hardState.pieceTracks[track.color].forEach((candidate, key) => {
      if (candidate.id !== track.id || found) return;
      const [row, col] = key.split(',').map(Number);
      found = { row, col };
    });
    return found;
  }

  getLastMove() {
    if (!Array.isArray(this.moves) || !this.moves.length) return null;
    return this.moves[this.moves.length - 1];
  }

  collectPiecesOfColor(board, color) {
    const pieces = [];
    if (!Array.isArray(board)) return pieces;
    for (let row = 0; row < board.length; row += 1) {
      for (let col = 0; col < (board[row] || []).length; col += 1) {
        const piece = board[row][col];
        if (piece && piece.color === color) {
          pieces.push({ piece, coord: { row, col } });
        }
      }
    }
    return pieces;
  }

  countCapturedIdentity(color, identity) {
    let count = 0;
    (this.captured || []).forEach((stash) => {
      (stash || []).forEach((piece) => {
        if (piece && piece.color === color && piece.identity === identity) count += 1;
      });
    });
    return count;
  }

  getRemainingPublicCount(color, identity) {
    return Math.max(0, (TOTAL_COUNTS[identity] || 0) - this.countCapturedIdentity(color, identity));
  }

  getBaseBelief() {
    return normalizeProbs({
      [IDS.KING]: 0.2,
      [IDS.BOMB]: 0.8 * (1 / 7),
      [IDS.BISHOP]: 0.8 * (2 / 7),
      [IDS.ROOK]: 0.8 * (2 / 7),
      [IDS.KNIGHT]: 0.8 * (2 / 7),
    });
  }

  buildBeliefsForColor(color, board = this.board) {
    const pieces = this.collectPiecesOfColor(board, color);
    const beliefs = new Map();
    if (!pieces.length) return beliefs;

    const kingRemaining = this.getRemainingPublicCount(color, IDS.KING);
    if (pieces.length === 1 && kingRemaining > 0) {
      beliefs.set(coordKey(pieces[0].coord), {
        [IDS.KING]: 1,
        [IDS.BOMB]: 0,
        [IDS.BISHOP]: 0,
        [IDS.ROOK]: 0,
        [IDS.KNIGHT]: 0,
      });
      return beliefs;
    }

    pieces.forEach(({ coord }) => {
      const key = coordKey(coord);
      const track = this.hardState.pieceTracks[color].get(key);
      if (this.isForcedIdentityActive(color, track)) {
        beliefs.set(key, identityCertainty(track.forcedIdentity));
        return;
      }

      const probs = this.getBaseBelief();

      if (track?.cameFromOnDeck) {
        probs[IDS.KING] = this.hardWeights.beliefs.onDeckKingProbability;
      }

      if (track?.declarations?.size) {
        track.declarations.forEach((declaration) => {
          if (Object.prototype.hasOwnProperty.call(probs, declaration)) {
            probs[declaration] *= this.hardWeights.beliefs.declarationMultiplier;
          }
        });
        if (track.declarations.size > 1) {
          track.declarations.forEach((declaration) => {
            if (Object.prototype.hasOwnProperty.call(probs, declaration)) {
              probs[declaration] *= this.hardWeights.beliefs.changedDeclarationMultiplier;
            }
          });
        }
      } else {
        const forward = this.forwardProgress(color, coord);
        probs[IDS.BOMB] *= 1 + forward * this.hardWeights.beliefs.unmovedForwardBombMultiplier;
      }

      probs[IDS.KING] *= this.getBlockedKingMultiplier(color, coord, board);

      if (track?.impossible) {
        track.impossible.forEach((identity) => {
          probs[identity] = 0;
        });
      }

      IDENTITY_LIST.forEach((identity) => {
        if (this.getBoardAvailablePublicCount(color, identity) <= 0) {
          probs[identity] = 0;
        }
      });

      beliefs.set(key, normalizeProbs(probs));
    });

    this.applyGlobalBeliefConstraints(color, beliefs, pieces);
    return beliefs;
  }

  applyGlobalBeliefConstraints(color, beliefs, pieces) {
    for (let pass = 0; pass < 5; pass += 1) {
      IDENTITY_LIST.forEach((identity) => {
        const remaining = this.getBoardAvailablePublicCount(color, identity);
        let forcedCount = 0;
        beliefs.forEach((probs, key) => {
          const track = this.hardState.pieceTracks[color].get(key);
          if (!this.isForcedIdentityActive(color, track)) return;
          probs[identity] = track.forcedIdentity === identity ? 1 : 0;
          if (track.forcedIdentity === identity) forcedCount += 1;
        });

        let sum = 0;
        beliefs.forEach((probs, key) => {
          const track = this.hardState.pieceTracks[color].get(key);
          if (this.isForcedIdentityActive(color, track)) return;
          sum += probs[identity] || 0;
        });

        if (remaining <= 0) {
          beliefs.forEach((probs) => {
            probs[identity] = 0;
          });
          return;
        }

        const unconstrainedRemaining = Math.max(0, remaining - forcedCount);
        if (unconstrainedRemaining <= 0) {
          beliefs.forEach((probs, key) => {
            const track = this.hardState.pieceTracks[color].get(key);
            if (!this.isForcedIdentityActive(color, track)) probs[identity] = 0;
          });
          return;
        }

        if (identity === IDS.KING) {
          if (sum <= 0) {
            const eligible = pieces.filter(({ coord }) => {
              const track = this.hardState.pieceTracks[color].get(coordKey(coord));
              return !this.isForcedIdentityActive(color, track) && !track?.impossible?.has(IDS.KING);
            });
            const share = eligible.length ? unconstrainedRemaining / eligible.length : 0;
            eligible.forEach(({ coord }) => {
              const probs = beliefs.get(coordKey(coord));
              if (probs) probs[IDS.KING] = share;
            });
            return;
          }
          beliefs.forEach((probs, key) => {
            const track = this.hardState.pieceTracks[color].get(key);
            if (!this.isForcedIdentityActive(color, track)) {
              probs[IDS.KING] = ((probs[IDS.KING] || 0) / sum) * unconstrainedRemaining;
            }
          });
          return;
        }

        if (sum > unconstrainedRemaining) {
          const scale = unconstrainedRemaining / sum;
          beliefs.forEach((probs, key) => {
            const track = this.hardState.pieceTracks[color].get(key);
            if (!this.isForcedIdentityActive(color, track)) {
              probs[identity] = (probs[identity] || 0) * scale;
            }
          });
        }
      });

      beliefs.forEach((probs, key) => {
        const track = this.hardState.pieceTracks[color].get(key);
        if (this.isForcedIdentityActive(color, track)) {
          Object.assign(probs, identityCertainty(track.forcedIdentity));
        } else {
          normalizeProbs(probs);
        }
      });
    }
  }

  getBeliefAt(color, coord, board = this.board) {
    const beliefs = this.buildBeliefsForColor(color, board);
    return beliefs.get(coordKey(coord)) || this.getBaseBelief();
  }

  getBlockedKingMultiplier(color, coord, board) {
    const attacker = color === 0 ? 1 : 0;
    const attackers = this.countWeightedAttackers(board, attacker, coord, {
      targetColor: color,
      useBeliefs: false,
      trueOnly: true,
    });
    if (attackers <= 0) {
      return this.hardWeights.beliefs.blockedKingMultiplier;
    }
    return 1 + (this.hardWeights.beliefs.blockedKingMultiplier - 1) / (1 + attackers);
  }

  forwardProgress(color, coord) {
    if (!coord || !Array.isArray(this.board) || !this.board.length) return 0;
    const maxRank = Math.max(1, this.board.length - 1);
    return color === 0 ? coord.row / maxRank : (maxRank - coord.row) / maxRank;
  }

  getPieceValue(identity) {
    const key = VALUE_NAMES[identity] || 'UNKNOWN';
    return Number(this.hardWeights.pieceValues[key] || this.hardWeights.pieceValues.UNKNOWN || 100);
  }

  getWeightedEnemyPieceValue(color, coord, board = this.board) {
    const probs = this.getBeliefAt(color, coord, board);
    return IDENTITY_LIST.reduce((sum, identity) => {
      return sum + (probs[identity] || 0) * this.getPieceValue(identity);
    }, 0);
  }

  findActualKing(board, color) {
    return this.collectPiecesOfColor(board, color)
      .find(({ piece }) => piece.identity === IDS.KING)?.coord || null;
  }

  isMoveGeometryLegal(board, from, to, declaration, moverColor, options = {}) {
    if (!from || !to) return false;
    if (!this.isOnBoardForBoard(board, from.row, from.col) || !this.isOnBoardForBoard(board, to.row, to.col)) {
      return false;
    }

    const dr = to.row - from.row;
    const dc = to.col - from.col;
    const absDr = Math.abs(dr);
    const absDc = Math.abs(dc);
    if (dr === 0 && dc === 0) return false;

    const target = board[to.row]?.[to.col];
    if (!options.allowOwnTarget && target && target.color === moverColor) return false;

    if (declaration === IDS.KNIGHT) {
      return (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2);
    }

    if (declaration === IDS.KING) {
      return absDr <= 1 && absDc <= 1;
    }

    if (declaration === IDS.BISHOP) {
      if (absDr !== absDc || absDr === 0 || absDr > 3) return false;
      const stepR = dr > 0 ? 1 : -1;
      const stepC = dc > 0 ? 1 : -1;
      for (let index = 1; index < absDr; index += 1) {
        if (board[from.row + index * stepR]?.[from.col + index * stepC]) return false;
      }
      return true;
    }

    if (declaration === IDS.ROOK || declaration === IDS.BOMB) {
      if ((dr !== 0 && dc !== 0) || Math.max(absDr, absDc) > 3) return false;
      const distance = Math.max(absDr, absDc);
      const stepR = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
      const stepC = dc === 0 ? 0 : (dc > 0 ? 1 : -1);
      for (let index = 1; index < distance; index += 1) {
        if (board[from.row + index * stepR]?.[from.col + index * stepC]) return false;
      }
      return true;
    }

    return false;
  }

  isOnBoardForBoard(board, row, col) {
    return row >= 0 && row < board.length && col >= 0 && col < (board[row] || []).length;
  }

  getTargetsForDeclaration(board, color, coord, declaration) {
    const targets = [];
    if (!this.isOnBoardForBoard(board, coord.row, coord.col)) return targets;
    for (let row = 0; row < board.length; row += 1) {
      for (let col = 0; col < (board[row] || []).length; col += 1) {
        const to = { row, col };
        if (!this.isMoveGeometryLegal(board, coord, to, declaration, color)) continue;
        const target = board[row][col];
        targets.push({
          row,
          col,
          capture: Boolean(target && target.color !== color),
        });
      }
    }
    return targets;
  }

  countWeightedAttackers(board, attackerColor, targetCoord, options = {}) {
    const pieces = this.collectPiecesOfColor(board, attackerColor);
    const beliefs = options.useBeliefs === false ? null : this.buildBeliefsForColor(attackerColor, board);
    let count = 0;

    pieces.forEach(({ piece, coord }) => {
      MOVE_DECLARATIONS.forEach((declaration) => {
        let probability = 0;
        if (options.trueOnly) {
          probability = piece.identity === declaration ? 1 : 0;
        } else if (beliefs) {
          probability = beliefs.get(coordKey(coord))?.[declaration] || 0;
        } else {
          probability = 1;
        }
        if (probability <= 0) return;
        if (this.isMoveGeometryLegal(board, coord, targetCoord, declaration, attackerColor, { allowOwnTarget: true })) {
          count += probability;
        }
      });
    });

    return count;
  }

  evaluateBoardState(board = this.board, context = {}) {
    if (this.color === null || !Array.isArray(board) || !board.length) return 0;
    const color = this.color;
    const opponent = this.identifyOpponent();
    const weights = this.hardWeights.evaluation;

    if (context.forceWin) return weights.win;
    if (context.forceLoss) return weights.loss;
    if ((this.daggers[opponent] || 0) >= 3) return weights.win;
    if ((this.daggers[color] || 0) >= 3) return weights.loss;
    if (this.countCapturedIdentity(opponent, IDS.KING) > 0) return weights.win;
    if (this.countCapturedIdentity(color, IDS.KING) > 0) return weights.loss;

    const ownPieces = this.collectPiecesOfColor(board, color);
    const enemyPieces = this.collectPiecesOfColor(board, opponent);
    let score = 0;

    score += (ownPieces.length - enemyPieces.length) * weights.pieceBalance;
    score += (this.daggers[opponent] || 0) * weights.enemyDagger;
    score += (this.daggers[color] || 0) * weights.ownDagger;

    const king = this.findActualKing(board, color);
    if (!king) return weights.loss;
    const kingProgress = this.forwardProgress(color, king);
    score += kingProgress * weights.kingAdvance * this.getKingAdvancePieceFactor(board);
    score += this.scoreKingThreatSafety(board, opponent, king);

    score += this.scoreActivity(board, color);
    score += this.scoreProtection(board, color);
    score += this.scoreThreats(board, color, opponent);
    score += this.scoreExposure(board, color, opponent);

    return score;
  }

  getKingAdvancePieceFactor(board) {
    const weights = this.hardWeights.evaluation;
    const fullBoardPieces = Math.max(1, Number(weights.kingAdvanceFullBoardPieces || 10));
    const endgamePieces = clamp(Number(weights.kingAdvanceEndgamePieces || 2), 1, fullBoardPieces - 1);
    const exponent = Math.max(1, Number(weights.kingAdvancePieceExponent || 2));
    const totalPieces = this.collectPiecesOfColor(board, 0).length + this.collectPiecesOfColor(board, 1).length;
    if (totalPieces >= fullBoardPieces) return 0;
    const progress = clamp((fullBoardPieces - totalPieces) / (fullBoardPieces - endgamePieces), 0, 1);
    return Math.pow(progress, exponent);
  }

  scoreKingThreatSafety(board, opponent, kingCoord) {
    const weights = this.hardWeights.evaluation;
    const weightedThreats = this.countWeightedAttackers(board, opponent, kingCoord, { useBeliefs: true });
    if (weightedThreats <= 0) {
      return weights.kingFullyWalledOff;
    }
    return (weights.kingWall / (1 + weightedThreats)) - weightedThreats * (weights.kingThreatPenalty || 0);
  }

  scoreActivity(board, color) {
    const weights = this.hardWeights.evaluation;
    let score = 0;
    this.collectPiecesOfColor(board, color).forEach(({ piece, coord }) => {
      MOVE_DECLARATIONS.forEach((declaration) => {
        const targets = this.getTargetsForDeclaration(board, color, coord, declaration);
        let multiplier = weights.bluffActivityMultiplier;
        if (piece.identity === declaration && piece.identity !== IDS.BOMB) {
          multiplier = weights.trueActivityMultiplier;
        }
        if (piece.identity === IDS.BOMB) {
          multiplier *= weights.bombActivityMultiplier;
        }
        const pieceActivityMultiplier = piece.identity === IDS.KING
          ? (weights.kingActivityMultiplier || 1)
          : (weights.nonKingActivityMultiplier || 1);
        score += targets.length * weights.activity * multiplier * pieceActivityMultiplier;
      });
    });
    return score;
  }

  scoreProtection(board, color) {
    const weights = this.hardWeights.evaluation;
    const pieces = this.collectPiecesOfColor(board, color);
    let protectors = 0;
    pieces.forEach(({ piece: targetPiece, coord: targetCoord }) => {
      if (targetPiece.identity === IDS.KING) return;
      pieces.forEach(({ piece, coord }) => {
        if (coord.row === targetCoord.row && coord.col === targetCoord.col) return;
        if (!MOVE_DECLARATIONS.includes(piece.identity)) return;
        if (this.isMoveGeometryLegal(board, coord, targetCoord, piece.identity, color, { allowOwnTarget: true })) {
          protectors += 1;
        }
      });
    });
    return protectors * weights.protection;
  }

  scoreThreats(board, color, opponent) {
    const weights = this.hardWeights.evaluation;
    let score = 0;
    this.collectPiecesOfColor(board, color).forEach(({ piece, coord }) => {
      MOVE_DECLARATIONS.forEach((declaration) => {
        let multiplier = piece.identity === declaration && piece.identity !== IDS.BOMB
          ? weights.trueActivityMultiplier
          : weights.bluffActivityMultiplier;
        if (piece.identity === IDS.BOMB) multiplier *= weights.bombActivityMultiplier;
        this.getTargetsForDeclaration(board, color, coord, declaration)
          .filter(target => target.capture)
          .forEach((target) => {
            const value = this.getWeightedEnemyPieceValue(opponent, target, board);
            score += weights.threat * multiplier * (value / 150);
          });
      });
    });
    return score;
  }

  scoreExposure(board, color, opponent) {
    const weights = this.hardWeights.evaluation;
    const beliefs = this.buildBeliefsForColor(opponent, board);
    let score = 0;
    this.collectPiecesOfColor(board, opponent).forEach(({ coord }) => {
      const probs = beliefs.get(coordKey(coord)) || this.getBaseBelief();
      MOVE_DECLARATIONS.forEach((declaration) => {
        const probability = probs[declaration] || 0;
        if (probability <= 0) return;
        this.getTargetsForDeclaration(board, opponent, coord, declaration)
          .filter(target => target.capture)
          .forEach((target) => {
            const ownPiece = board[target.row]?.[target.col];
            if (!ownPiece || ownPiece.color !== color) return;
            const value = this.getPieceValue(ownPiece.identity);
            if (ownPiece.identity === IDS.BOMB) {
              score += weights.bombThreatGood * probability * (value / 150);
            } else {
              score -= weights.exposure * probability * (value / 150);
            }
          });
      });
    });
    return score;
  }

  simulateAcceptedMove(board, move) {
    const next = cloneBoard(board);
    const moving = next[move.from.row]?.[move.from.col];
    if (!moving) return next;
    next[move.to.row][move.to.col] = moving;
    next[move.from.row][move.from.col] = null;
    return next;
  }

  simulateMoveChallengeSuccess(board, move) {
    const next = cloneBoard(board);
    if (next[move.from.row]) {
      next[move.from.row][move.from.col] = null;
    }
    return next;
  }

  simulateMoveChallengeFail(board, move, replacementPiece = null) {
    const next = cloneBoard(board);
    const replacement = replacementPiece
      ? { ...replacementPiece }
      : { color: move.player, identity: IDS.UNKNOWN };
    next[move.from.row][move.from.col] = null;
    next[move.to.row][move.to.col] = replacement;
    return next;
  }

  simulateBombPass(board, move) {
    const next = cloneBoard(board);
    if (next[move.from.row]) {
      next[move.from.row][move.from.col] = null;
    }
    return next;
  }

  simulateBombChallengeSuccess(board, move) {
    const next = cloneBoard(board);
    const moving = next[move.from.row]?.[move.from.col];
    if (moving) {
      next[move.to.row][move.to.col] = moving;
      next[move.from.row][move.from.col] = null;
    }
    return next;
  }

  simulateBombChallengeFail(board, move, replacementPiece = null) {
    const next = cloneBoard(board);
    const replacement = replacementPiece
      ? { ...replacementPiece }
      : { color: 1 - move.player, identity: IDS.UNKNOWN };
    next[move.from.row][move.from.col] = null;
    next[move.to.row][move.to.col] = replacement;
    return next;
  }

  buildMoveActionOptions(moves, attemptedSet) {
    if (!Array.isArray(moves)) return [];
    const options = [];
    moves.forEach((move) => {
      if (this.isCertainBombCapture(move)) return;
      const declarations = this.getAvailableDeclarations(move, attemptedSet)
        .filter(declaration => !this.isHardDeclarationDisallowed(move, declaration));
      declarations.forEach((declaration) => {
        options.push({
          type: 'move',
          move,
          declaration,
          score: this.computeHardMoveActionScore(move, declaration),
          key: this.getMoveAttemptKey(move, declaration),
        });
      });
    });
    return options;
  }

  computeHardMoveActionScore(move, declaration) {
    if (!move || this.color === null) return 0;
    const piece = this.board?.[move.from.row]?.[move.from.col];
    if (!piece || piece.color !== this.color) return 0;

    const bombCaptureRisk = this.scoreBombCaptureRisk(move);
    if (this.isCertainBombCapture(move)) {
      return this.hardWeights.evaluation.certainBombCapturePenalty || this.hardWeights.evaluation.loss;
    }
    if (this.isForbiddenKingThroneBluff(move, declaration)) {
      return this.hardWeights.evaluation.loss;
    }

    const isThrone = this.isThroneDeclaration(move, declaration, this.color);
    const acceptedBoard = this.simulateAcceptedMove(this.board, move);
    const acceptedEval = this.evaluateBoardState(acceptedBoard, {
      forceWin: isThrone,
    });

    const actualTrue = piece.identity === declaration;
    const challengeBoard = actualTrue
      ? this.simulateMoveChallengeFail(this.board, { ...move, player: this.color }, this.onDecks[this.color])
      : this.simulateMoveChallengeSuccess(this.board, { ...move, player: this.color });
    let challengeEval = this.evaluateBoardState(challengeBoard, {
      forceLoss: !actualTrue && piece.identity === IDS.KING,
    });
    if (actualTrue && declaration === IDS.KING && isThrone) {
      challengeEval = this.hardWeights.evaluation.win;
    } else if (actualTrue && declaration === IDS.KING) {
      challengeEval += this.hardWeights.evaluation.trueKingChallengeReward || 0;
    }

    const challengeProbability = this.estimateOpponentChallengeProbability(move, declaration, acceptedEval, challengeEval);
    let score = acceptedEval * (1 - challengeProbability) + challengeEval * challengeProbability;

    score += bombCaptureRisk;
    if (move.capture) {
      score += this.hardWeights.evaluation.capture;
    }
    if (actualTrue) {
      const trueMoveWeight = declaration === IDS.KING && !isThrone
        ? this.hardWeights.evaluation.trueMove * (this.hardWeights.evaluation.kingTrueMoveMultiplier || 1)
        : this.hardWeights.evaluation.trueMove;
      score += trueMoveWeight;
      const track = this.getTrack(this.color, move.from);
      if (track?.wasBluffBefore) {
        score += this.hardWeights.evaluation.trueWasBluff;
      }
    }

    if (piece.identity === IDS.KING && !isThrone) {
      score += this.hardWeights.evaluation.kingNonThroneMovePenalty || 0;
      const forwardDelta = this.color === 0
        ? move.to.row - move.from.row
        : move.from.row - move.to.row;
      if (forwardDelta <= 0) {
        score += this.hardWeights.evaluation.kingNonForwardMovePenalty || 0;
      }
    }

    if (declaration === IDS.KING && !isThrone) {
      score += this.hardWeights.evaluation.kingDeclarationNonThronePenalty || 0;
    }

    return score;
  }

  isThroneDeclaration(move, declaration, color) {
    if (!move || declaration !== IDS.KING) return false;
    const throneRow = color === 0 ? this.board.length - 1 : 0;
    return move.to.row === throneRow;
  }

  isForbiddenKingThroneBluff(move, declaration) {
    if (!this.isThroneDeclaration(move, declaration, this.color)) return false;
    const piece = this.board?.[move?.from?.row]?.[move?.from?.col];
    return !piece || piece.color !== this.color || piece.identity !== IDS.KING;
  }

  getChallengeDaggerAdjustment(challengerColor = this.color, options = {}) {
    const challengeWeights = this.hardWeights.challenge || {};
    const daggers = Math.max(0, this.daggers[challengerColor] || 0);
    const opponentColor = challengerColor === 0 ? 1 : 0;
    const opponentDaggers = Math.max(0, this.daggers[opponentColor] || 0);
    const penaltyBase = Math.max(1, Number(challengeWeights.ownDaggerPenaltyBase || 1));
    const probabilityBase = Math.max(0, Math.min(1, Number(challengeWeights.ownDaggerProbabilityBase || 1)));
    const evPenalty = (challengeWeights.ownDaggerEvPenalty || 0) * (Math.pow(penaltyBase, daggers) - 1);
    const successBonus = options.successGivesOpponentDagger
      ? (challengeWeights.opponentDaggerEvBonus || 0) * (
        Math.pow(Math.max(1, Number(challengeWeights.opponentDaggerBonusBase || 1)), opponentDaggers) - 1
      )
      : 0;

    let maximumProbability = challengeWeights.maximumChallengeChance;
    if (daggers >= 1 && Number.isFinite(Number(challengeWeights.oneDaggerMaxChallengeChance))) {
      maximumProbability = Math.min(maximumProbability, challengeWeights.oneDaggerMaxChallengeChance);
    }
    if (daggers >= 2 && Number.isFinite(Number(challengeWeights.twoDaggerMaxChallengeChance))) {
      maximumProbability = Math.min(maximumProbability, challengeWeights.twoDaggerMaxChallengeChance);
    }

    return {
      daggers,
      evPenalty,
      successBonus,
      probabilityMultiplier: Math.pow(probabilityBase, daggers),
      maximumProbability,
    };
  }

  applyChallengeDaggerAdjustment(probability, challengerColor = this.color, options = {}) {
    if (options.guaranteed) return 1;
    const challengeWeights = this.hardWeights.challenge || {};
    const adjustment = this.getChallengeDaggerAdjustment(challengerColor, options);
    return clamp(
      probability * adjustment.probabilityMultiplier,
      challengeWeights.minimumChallengeChance,
      adjustment.maximumProbability,
    );
  }

  evaluateFailedChallengeBoard(board, challengerColor) {
    const weights = this.hardWeights.evaluation;
    if ((this.daggers[challengerColor] || 0) >= 2) {
      return challengerColor === this.color ? weights.loss : weights.win;
    }
    const base = this.evaluateBoardState(board);
    return base + (challengerColor === this.color ? weights.ownDagger : weights.enemyDagger);
  }

  estimateOpponentChallengeProbability(move, declaration, acceptedEval, challengeEval) {
    const probs = this.getBeliefAt(this.color, move.from);
    const publicTrue = probs[declaration] || 0;
    if (publicTrue <= 0) return 1;

    const opponent = this.identifyOpponent();
    const daggerAdjustment = this.getChallengeDaggerAdjustment(opponent);
    const challengeGainForOpponent = acceptedEval - challengeEval - daggerAdjustment.evPenalty;
    let probability = softmaxProbability(
      challengeGainForOpponent,
      0,
      this.hardWeights.challenge.temperature,
    );

    const track = this.getTrack(this.color, move.from);
    if (track?.declarations?.size && !track.declarations.has(declaration)) {
      probability += this.hardWeights.challenge.declarationChangeSuspicion;
    }

    probability *= 1 - publicTrue * 0.35;
    return this.applyChallengeDaggerAdjustment(
      probability,
      opponent,
    );
  }

  isOwnDeclarationPubliclyImpossible(coord, declaration) {
    const track = this.getTrack(this.color, coord);
    if (track?.impossible?.has(declaration)) return true;
    if (declaration === IDS.KING && track?.cameFromOnDeck) return true;
    const probs = this.getBeliefAt(this.color, coord);
    return (probs[declaration] || 0) <= 0;
  }

  isHardDeclarationDisallowed(move, declaration) {
    return this.isForbiddenKingThroneBluff(move, declaration)
      || this.isOwnDeclarationPubliclyImpossible(move.from, declaration);
  }

  getCaptureBombProbability(move) {
    if (!move || !move.to) return 0;
    const target = this.board?.[move.to.row]?.[move.to.col];
    if (!target || target.color === this.color) return 0;
    const probs = this.getBeliefAt(target.color, move.to);
    return clamp(probs[IDS.BOMB] || 0, 0, 1);
  }

  isCertainBombCapture(move) {
    const target = this.board?.[move?.to?.row]?.[move?.to?.col];
    if (!move?.capture && !target) return false;
    if (!target || target.color === this.color) return false;
    const threshold = this.hardWeights.evaluation.certainBombCaptureThreshold ?? 0.995;
    return this.getCaptureBombProbability(move) >= threshold;
  }

  scoreBombCaptureRisk(move) {
    const target = this.board?.[move?.to?.row]?.[move?.to?.col];
    if (!move?.capture && !target) return 0;
    if (!target || target.color === this.color) return 0;
    const probability = this.getCaptureBombProbability(move);
    const threshold = this.hardWeights.evaluation.certainBombCaptureThreshold ?? 0.995;
    if (probability >= threshold) {
      return this.hardWeights.evaluation.certainBombCapturePenalty || this.hardWeights.evaluation.loss;
    }
    const penalty = this.hardWeights.evaluation.bombCaptureRiskPenalty || 0;
    const exponent = Math.max(1, this.hardWeights.evaluation.bombCaptureRiskExponent || 1);
    return -penalty * Math.pow(probability, exponent);
  }

  selectWeightedAction(actions) {
    if (!Array.isArray(actions) || !actions.length) return null;
    const finite = actions.filter(action => action && Number.isFinite(action.score));
    const pool = finite.length ? finite : actions.filter(Boolean);
    if (!pool.length) return null;
    if (pool.some(action => action.score === Number.POSITIVE_INFINITY)) {
      const best = pool.filter(action => action.score === Number.POSITIVE_INFINITY);
      return best[Math.floor(Math.random() * best.length)];
    }

    const sorted = [...pool].sort((a, b) => b.score - a.score);
    const topK = Math.max(1, Number(this.hardWeights.selection.topK) || 1);
    const candidates = sorted.slice(0, topK);
    if (Math.random() < this.hardWeights.selection.randomActionChance) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    const max = candidates[0].score;
    return weightedRandom(candidates, (action) => {
      return Math.exp((action.score - max) / Math.max(1, this.hardWeights.selection.temperature));
    });
  }

  preparePendingMovePlan(move, context = {}) {
    if (!move) {
      this.pendingMovePlan = null;
      return;
    }

    const key = this.getPendingMoveKey(move);
    if (this.pendingMovePlan && this.pendingMovePlan.key === key) return;

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
      reason: 'Hard bot accept',
      status: 'pending',
      forceBomb: false,
    };

    const targetPiece = this.board?.[move.to?.row]?.[move.to?.col];
    if (
      context.canBomb &&
      targetPiece &&
      targetPiece.color === this.color &&
      targetPiece.identity === IDS.BOMB &&
      move.declaration !== IDS.KING &&
      !this.isOwnBombPubliclyImpossible(move.to)
    ) {
      plan.response = 'bomb';
      plan.reason = 'Hard bot true bomb';
      plan.forceBomb = true;
      this.pendingMovePlan = plan;
      return;
    }

    const challengeDecision = this.decideChallengeMove(move);
    if (challengeDecision.challenge) {
      plan.response = 'challenge';
      plan.reason = challengeDecision.reason;
      this.pendingMovePlan = plan;
      return;
    }

    if (context.canBomb && this.canBombPendingMove(move)) {
      const bombDecision = this.decideBombBluff(move);
      if (bombDecision.bomb) {
        plan.response = 'bomb';
        plan.reason = bombDecision.reason;
      }
    }

    this.pendingMovePlan = plan;
  }

  decideChallengeMove(move) {
    const opponent = this.identifyOpponent();
    const probs = this.getBeliefAt(opponent, move.from);
    const trueProbability = probs[move.declaration] || 0;
    if (trueProbability <= 0) {
      return { challenge: true, probability: 1, reason: 'Hard bot impossible declaration' };
    }

    const acceptBoard = this.simulateAcceptedMove(this.board, move);
    const acceptEval = this.evaluateBoardState(acceptBoard, {
      forceLoss: this.isThroneDeclaration(move, move.declaration, opponent),
    });
    const successBoard = this.simulateMoveChallengeSuccess(this.board, move);
    const successEval = this.evaluateBoardState(successBoard);
    const failBoard = this.simulateMoveChallengeFail(this.board, move);
    const failEval = move.declaration === IDS.KING
      ? this.hardWeights.evaluation.loss
      : this.evaluateFailedChallengeBoard(failBoard, this.color);

    const daggerAdjustment = this.getChallengeDaggerAdjustment(this.color);
    const challengeEval = (
      (1 - trueProbability) * successEval + trueProbability * failEval
    ) - daggerAdjustment.evPenalty;
    let challengeProbability = softmaxProbability(
      challengeEval,
      acceptEval,
      this.hardWeights.challenge.temperature,
    );

    const track = this.getTrack(opponent, move.from);
    if (track?.declarations?.size && !track.declarations.has(move.declaration)) {
      challengeProbability += this.hardWeights.challenge.declarationChangeSuspicion;
    }

    challengeProbability = this.applyChallengeDaggerAdjustment(
      challengeProbability,
      this.color,
    );

    return {
      challenge: Math.random() < challengeProbability,
      probability: challengeProbability,
      reason: 'Hard bot challenge EV',
    };
  }

  decideBombBluff(move) {
    const targetPiece = this.board?.[move.to?.row]?.[move.to?.col];
    if (!targetPiece || targetPiece.color !== this.color) {
      return { bomb: false, probability: 0, reason: 'No target to bomb' };
    }
    if (move.declaration === IDS.KING) {
      return { bomb: false, probability: 0, reason: 'Cannot bomb king declaration' };
    }
    if (targetPiece.identity === IDS.BOMB) {
      return { bomb: true, probability: 1, reason: 'Hard bot true bomb' };
    }
    if (this.isOwnBombPubliclyImpossible(move.to)) {
      return { bomb: false, probability: 0, reason: 'Bomb publicly impossible' };
    }

    const acceptEval = this.evaluateBoardState(this.simulateAcceptedMove(this.board, move));
    const noChallengeEval = this.evaluateBoardState(this.simulateBombPass(this.board, move));
    const challengedEval = this.evaluateFailedChallengeBoard(
      this.simulateBombChallengeSuccess(this.board, move),
      this.identifyOpponent(),
    );
    const opponentChallengeChance = this.estimateOpponentBombChallengeProbability(move, false, noChallengeEval, challengedEval);
    const bombEval = noChallengeEval * (1 - opponentChallengeChance) + challengedEval * opponentChallengeChance;
    const probability = clamp(
      softmaxProbability(bombEval, acceptEval, this.hardWeights.bomb.temperature),
      this.hardWeights.bomb.minimumBluffChance,
      this.hardWeights.bomb.maximumBluffChance,
    );

    return {
      bomb: Math.random() < probability,
      probability,
      reason: 'Hard bot bomb bluff EV',
    };
  }

  estimateOpponentBombChallengeProbability(move, trueBomb, noChallengeEval, challengedEval) {
    if (trueBomb) return this.hardWeights.challenge.minimumChallengeChance;
    const probs = this.getBeliefAt(this.color, move.to);
    const publicBomb = probs[IDS.BOMB] || 0;
    if (publicBomb <= 0) return 1;
    const opponent = this.identifyOpponent();
    const daggerAdjustment = this.getChallengeDaggerAdjustment(opponent, {
      successGivesOpponentDagger: true,
    });
    const challengeGainForOpponent = noChallengeEval - challengedEval
      - daggerAdjustment.evPenalty
      + daggerAdjustment.successBonus;
    let probability = softmaxProbability(
      challengeGainForOpponent,
      0,
      this.hardWeights.challenge.temperature,
    );
    probability *= 1 - publicBomb * 0.3;
    return this.applyChallengeDaggerAdjustment(probability, opponent, {
      successGivesOpponentDagger: true,
    });
  }

  isOwnBombPubliclyImpossible(coord) {
    if (this.countCapturedIdentity(this.color, IDS.BOMB) >= TOTAL_COUNTS[IDS.BOMB]) return true;
    if (this.isIdentityLockedOffBoard(this.color, IDS.BOMB)) return true;
    const probs = this.getBeliefAt(this.color, coord);
    return (probs[IDS.BOMB] || 0) <= 0;
  }

  prepareBombPlan() {
    const lastIndex = this.actions.length - 1;
    if (lastIndex < 0) {
      this.pendingBombPlan = null;
      return;
    }
    if (lastIndex <= this.lastHandledActionIndex) return;

    const action = this.actions[lastIndex];
    if (!action || action.type !== ACTIONS.BOMB || action.player === this.color) {
      this.lastHandledActionIndex = lastIndex;
      this.pendingBombPlan = null;
      return;
    }

    this.lastHandledActionIndex = lastIndex;
    const timestamp = this.markOpponentEvent(action.timestamp, 'bomb');
    const decision = this.decideChallengeBomb();
    if (!decision.challenge) {
      const lastMove = this.getLastMove();
      this.forceTrackIdentityAt(action.player, lastMove?.to, IDS.BOMB);
    }
    this.pendingBombPlan = {
      key: `${lastIndex}:${timestamp}`,
      timestamp,
      response: decision.challenge ? 'challenge' : 'pass',
      status: 'pending',
    };
  }

  decideChallengeBomb() {
    const move = this.getLastMove();
    if (!move) return { challenge: false, probability: 0 };
    const opponent = this.identifyOpponent();
    const probs = this.getBeliefAt(opponent, move.to);
    const bombProbability = probs[IDS.BOMB] || 0;
    if (bombProbability <= 0) return { challenge: true, probability: 1 };

    const passEval = this.evaluateBoardState(this.simulateBombPass(this.board, move));
    const successEval = this.evaluateBoardState(this.simulateBombChallengeSuccess(this.board, move))
      + this.hardWeights.evaluation.enemyDagger;
    const failEval = this.evaluateFailedChallengeBoard(
      this.simulateBombChallengeFail(this.board, move),
      this.color,
    );
    const daggerAdjustment = this.getChallengeDaggerAdjustment(this.color, {
      successGivesOpponentDagger: true,
    });
    const challengeEval = (
      (1 - bombProbability) * successEval + bombProbability * failEval
    ) - daggerAdjustment.evPenalty + daggerAdjustment.successBonus;
    const probability = this.applyChallengeDaggerAdjustment(
      softmaxProbability(challengeEval, passEval, this.hardWeights.challenge.temperature),
      this.color,
      { successGivesOpponentDagger: true },
    );

    return {
      challenge: Math.random() < probability,
      probability,
    };
  }

  prepareRandomSetup() {
    if (this.color === null) return null;
    const color = this.color;
    const row = color === 0 ? 0 : this.board.length - 1;
    const stash = this.collectSetupPool(color);
    if (stash.length < 6) return super.prepareRandomSetup();

    const king = this.takePiece(stash, IDS.KING);
    if (!king) return super.prepareRandomSetup();

    const roll = Math.random();
    const setupWeights = this.hardWeights.setup;
    const setupTotal = Math.max(
      0.0001,
      setupWeights.bombBoardChance + setupWeights.bombOnDeckChance + setupWeights.bombStashChance,
    );
    const boardChance = setupWeights.bombBoardChance / setupTotal;
    const onDeckChance = setupWeights.bombOnDeckChance / setupTotal;
    let bombLocation = 'stash';
    if (roll < boardChance) {
      bombLocation = 'board';
    } else if (roll < boardChance + onDeckChance) {
      bombLocation = 'onDeck';
    }

    const boardPieces = [king];
    let onDeck = null;
    if (bombLocation === 'board') {
      const bomb = this.takePiece(stash, IDS.BOMB);
      if (bomb) boardPieces.push(bomb);
    } else if (bombLocation === 'onDeck') {
      onDeck = this.takePiece(stash, IDS.BOMB);
    }

    while (boardPieces.length < 5 && stash.length) {
      const candidates = stash.filter(piece => piece.identity !== IDS.KING && !(bombLocation === 'stash' && piece.identity === IDS.BOMB));
      const pool = candidates.length ? candidates : stash.filter(piece => piece.identity !== IDS.KING);
      if (!pool.length) break;
      const choice = pool[Math.floor(Math.random() * pool.length)];
      const index = stash.indexOf(choice);
      boardPieces.push(stash.splice(index, 1)[0]);
    }

    if (!onDeck) {
      const deckPool = stash.filter(piece =>
        piece.identity !== IDS.KING && !(bombLocation === 'stash' && piece.identity === IDS.BOMB)
      );
      if (!deckPool.length) return super.prepareRandomSetup();
      const choice = deckPool[Math.floor(Math.random() * deckPool.length)];
      onDeck = stash.splice(stash.indexOf(choice), 1)[0];
    }

    if (boardPieces.length !== 5 || !onDeck) return super.prepareRandomSetup();

    const columns = [0, 1, 2, 3, 4];
    for (let idx = columns.length - 1; idx > 0; idx -= 1) {
      const j = Math.floor(Math.random() * (idx + 1));
      [columns[idx], columns[j]] = [columns[j], columns[idx]];
    }

    return {
      pieces: boardPieces.map((piece, idx) => ({
        row,
        col: columns[idx],
        identity: piece.identity,
        color,
      })),
      onDeck: { identity: onDeck.identity, color },
    };
  }

  collectSetupPool(color) {
    const pool = [];
    const add = (piece) => {
      if (piece && piece.color === color && typeof piece.identity === 'number' && piece.identity > 0) {
        pool.push({ ...piece });
      }
    };
    (this.stashes[color] || []).forEach(add);
    add(this.onDecks[color]);
    const row = color === 0 ? 0 : this.board.length - 1;
    (this.board[row] || []).forEach(add);
    return pool;
  }

  takePiece(pool, identity) {
    const index = pool.findIndex(piece => piece.identity === identity);
    if (index === -1) return null;
    return pool.splice(index, 1)[0];
  }

  async placeOnDeck() {
    if (this.color === null || this.pendingAction) return;
    const color = this.color;
    if (this.onDecks[color]) return;
    const available = (this.stashes[color] || [])
      .filter(piece => piece && piece.color === color && typeof piece.identity === 'number' && piece.identity !== IDS.KING);
    if (!available.length) return;

    let selected = null;
    const bomb = available.find(piece => piece.identity === IDS.BOMB);
    const bombChance = clamp(this.countPieces(color) * this.hardWeights.onDeck.bombChancePerBoardPiece, 0, 1);
    if (bomb && Math.random() < bombChance) {
      selected = bomb;
    }

    if (!selected && Math.random() < this.hardWeights.onDeck.varianceChoiceChance) {
      selected = this.selectVarianceOnDeckPiece(available);
    }
    if (!selected) {
      selected = available[Math.floor(Math.random() * available.length)];
    }

    this.pendingAction = true;
    try {
      await postJSON(this.serverUrl, '/api/v1/gameAction/onDeck', this.token, {
        gameId: this.gameId,
        color,
        piece: { identity: selected.identity },
      });
      if (selected.identity === IDS.BOMB) {
        this.mediumState.bombReturnedAt = null;
      }
    } catch (err) {
      console.error('Hard bot failed to place on deck', err);
    } finally {
      this.finalizeAction();
    }
  }

  selectVarianceOnDeckPiece(available) {
    const counts = {};
    this.collectMyPieces().forEach(({ piece }) => {
      counts[piece.identity] = (counts[piece.identity] || 0) + 1;
    });
    const sorted = [...available].sort((a, b) => {
      const aCount = counts[a.identity] || 0;
      const bCount = counts[b.identity] || 0;
      if (aCount !== bCount) return aCount - bCount;
      return Math.random() - 0.5;
    });
    return sorted[0] || available[0];
  }
}

module.exports = {
  HardBotController,
};
