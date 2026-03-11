const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const {
  WHITE,
  BLACK,
  createRng,
  getLegalActions,
  applyAction,
  actionKey,
} = require('./engine');
const {
  createDefaultModelBundle,
  cloneModelBundle,
  createOptimizerState,
  trainPolicyModel,
  trainValueModel,
  trainIdentityModel,
} = require('./modeling');
const { runHiddenInfoMcts } = require('./mcts');
const {
  BUILTIN_PARTICIPANTS,
  normalizeParticipantId,
  isBuiltinParticipantId,
  getBuiltinParticipant,
  chooseBuiltinAction,
} = require('./builtinBots');
const eventBus = require('../../eventBus');
const SimulationModel = require('../../models/Simulation');
const SimulationGameModel = require('../../models/SimulationGame');
const TrainingRunModel = require('../../models/TrainingRun');
const Match = require('../../models/Match');
const Game = require('../../models/Game');
const getServerConfig = require('../../utils/getServerConfig');
const matchesCreateRoute = require('../../routes/v1/matches/create');
const gamesCreateRoute = require('../../routes/v1/games/create');
const setupRoute = require('../../routes/v1/gameAction/setup');
const readyRoute = require('../../routes/v1/gameAction/ready');
const moveRoute = require('../../routes/v1/gameAction/move');
const challengeRoute = require('../../routes/v1/gameAction/challenge');
const bombRoute = require('../../routes/v1/gameAction/bomb');
const passRoute = require('../../routes/v1/gameAction/pass');
const onDeckRoute = require('../../routes/v1/gameAction/onDeck');
const resignRoute = require('../../routes/v1/gameAction/resign');
const drawRoute = require('../../routes/v1/gameAction/draw');
const { runInSimulationRequestContext } = require('../../utils/simulationRequestContext');

const SIMULATION_CHECKPOINT_GAME_INTERVAL = 2;
const SIMULATION_CHECKPOINT_MS = 5000;
const LIVE_STATUS_RETENTION_MS = 30000;
const SAVE_RENAME_RETRY_DELAYS_MS = [25, 75, 150];

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDirSync(targetDir) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

function isRetriableRenameError(err) {
  const code = String(err?.code || '').toUpperCase();
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

async function persistJsonWithFallback(targetPath, payload) {
  const tmpPath = `${targetPath}.tmp`;
  await fs.promises.writeFile(tmpPath, payload, 'utf8');
  let lastRenameError = null;
  for (const delayMs of [0, ...SAVE_RENAME_RETRY_DELAYS_MS]) {
    if (delayMs) await sleep(delayMs);
    try {
      await fs.promises.rename(tmpPath, targetPath);
      return;
    } catch (err) {
      lastRenameError = err;
      if (!isRetriableRenameError(err)) {
        throw err;
      }
    }
  }
  try {
    await fs.promises.writeFile(targetPath, payload, 'utf8');
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
  if (lastRenameError) {
    console.warn('[ml-runtime] rename fallback used while persisting state', {
      code: lastRenameError.code,
      path: tmpPath,
      dest: targetPath,
    });
  }
}

function clampPositiveInt(value, fallback, min = 1, max = 100000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeFloat(value, fallback, min = -Infinity, max = Infinity) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const SNAPSHOT_REF_PREFIX = 'snapshot:';

function toSnapshotParticipantId(snapshotId) {
  if (!snapshotId) return '';
  return `${SNAPSHOT_REF_PREFIX}${snapshotId}`;
}

function parseSnapshotParticipantId(participantId) {
  if (typeof participantId !== 'string') return null;
  const value = participantId.trim();
  if (!value) return null;
  if (value.startsWith(SNAPSHOT_REF_PREFIX)) {
    const snapshotId = value.slice(SNAPSHOT_REF_PREFIX.length).trim();
    return snapshotId || null;
  }
  return null;
}

function normalizeParticipantStatsEntry(entry, games) {
  const safeGames = Number.isFinite(games) && games > 0 ? games : 0;
  const wins = Number(entry?.wins || 0);
  const draws = Number(entry?.draws || 0);
  const losses = Number(entry?.losses || 0);
  const winRate = safeGames > 0 ? (wins / safeGames) : 0;
  const drawRate = safeGames > 0 ? (draws / safeGames) : 0;
  const lossRate = safeGames > 0 ? (losses / safeGames) : 0;
  return {
    ...entry,
    games: safeGames,
    wins,
    draws,
    losses,
    winRate,
    drawRate,
    lossRate,
    winPct: winRate * 100,
    drawPct: drawRate * 100,
    lossPct: lossRate * 100,
  };
}

function parseTimeValue(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function simulationHasDetailedGames(simulation) {
  const games = Array.isArray(simulation?.games) ? simulation.games : [];
  return games.some((game) => (
    Array.isArray(game?.replay)
    || Array.isArray(game?.decisions)
    || game?.training
    || Array.isArray(game?.actionHistory)
    || Array.isArray(game?.moveHistory)
  ));
}

function choosePreferredSimulationRecord(existing, candidate) {
  if (!existing) return candidate;
  if (!candidate) return existing;

  const existingDetailed = simulationHasDetailedGames(existing);
  const candidateDetailed = simulationHasDetailedGames(candidate);
  if (existingDetailed !== candidateDetailed) {
    return candidateDetailed ? candidate : existing;
  }

  const existingGames = Array.isArray(existing.games) ? existing.games.length : 0;
  const candidateGames = Array.isArray(candidate.games) ? candidate.games.length : 0;
  if (candidateGames !== existingGames) {
    return candidateGames > existingGames ? candidate : existing;
  }

  const existingTime = Math.max(parseTimeValue(existing?.updatedAt), parseTimeValue(existing?.createdAt));
  const candidateTime = Math.max(parseTimeValue(candidate?.updatedAt), parseTimeValue(candidate?.createdAt));
  return candidateTime >= existingTime ? candidate : existing;
}

function mergeSimulationRecords(sources = [], limit = null) {
  const byId = new Map();
  sources.forEach((items) => {
    if (!Array.isArray(items)) return;
    items.forEach((simulation) => {
      if (!simulation || !simulation.id) return;
      const existing = byId.get(simulation.id);
      byId.set(simulation.id, choosePreferredSimulationRecord(existing, simulation));
    });
  });

  const merged = Array.from(byId.values()).sort((a, b) => (
    Math.max(parseTimeValue(b?.updatedAt), parseTimeValue(b?.createdAt))
    - Math.max(parseTimeValue(a?.updatedAt), parseTimeValue(a?.createdAt))
  ));
  if (!Number.isFinite(limit) || limit <= 0) {
    return merged;
  }
  return merged.slice(0, limit);
}

function chunkArray(values, chunkSize = 10) {
  const size = Math.max(1, Math.floor(chunkSize));
  const arr = Array.isArray(values) ? values : [];
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function deriveWinReasonCountsFromGames(simulation) {
  const games = Array.isArray(simulation?.games) ? simulation.games : [];
  const counts = {};
  games.forEach((game) => {
    const reason = game?.winReason;
    if (reason === null || reason === undefined || reason === '') return;
    const key = String(reason);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function summarizeGameForStorage(game) {
  if (!game || typeof game !== 'object') return null;
  const decisions = Array.isArray(game.decisions) ? game.decisions : [];
  const replay = Array.isArray(game.replay) ? game.replay : [];
  return {
    id: game.id,
    createdAt: game.createdAt,
    seed: game.seed,
    setupMode: game.setupMode || 'random',
    whiteParticipantId: game.whiteParticipantId || null,
    blackParticipantId: game.blackParticipantId || null,
    whiteParticipantLabel: game.whiteParticipantLabel || null,
    blackParticipantLabel: game.blackParticipantLabel || null,
    winner: Number.isFinite(game.winner) ? game.winner : null,
    winReason: game.winReason ?? null,
    plies: Number.isFinite(game.plies) ? game.plies : decisions.length,
    decisionCount: decisions.length,
    replayFrameCount: replay.length,
  };
}

function compactSimulationForState(simulation) {
  if (!simulation || typeof simulation !== 'object') return simulation;
  if (!simulation.gamesStoredExternally) return simulation;
  const games = Array.isArray(simulation.games) ? simulation.games : [];
  return {
    ...simulation,
    gamesStoredExternally: true,
    gameCount: Number.isFinite(simulation.gameCount)
      ? simulation.gameCount
      : games.length,
    games: games
      .map((game) => summarizeGameForStorage(game))
      .filter(Boolean),
  };
}

function createEmptyState() {
  return {
    version: 2,
    counters: {
      snapshot: 1,
      simulation: 1,
      game: 1,
      training: 1,
    },
    snapshots: [],
    simulations: [],
    trainingRuns: [],
    activeJobs: {
      simulation: null,
      training: null,
    },
  };
}

function extractPostHandler(router) {
  if (!router || !Array.isArray(router.stack)) {
    throw new Error('Router stack unavailable');
  }
  const layer = router.stack.find((entry) => (
    entry
    && entry.route
    && entry.route.path === '/'
    && entry.route.methods
    && entry.route.methods.post
    && Array.isArray(entry.route.stack)
    && entry.route.stack.length
  ));
  if (!layer) {
    throw new Error('POST handler not found on router');
  }
  return layer.route.stack[0].handle;
}

function createInternalRequestSession(userId, username = 'SimulationUser') {
  if (!userId) return null;
  return {
    userId: String(userId),
    username,
    authenticated: false,
    isGuest: true,
    email: '',
    user: {
      _id: String(userId),
      username,
      isGuest: true,
      isBot: true,
      botDifficulty: 'medium',
    },
  };
}

async function callPostHandler(handler, body = {}, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const req = {
      method: 'POST',
      url: '/',
      headers: { ...(options.headers || {}) },
      body: deepClone(body),
      query: { ...(options.query || {}) },
      params: { ...(options.params || {}) },
      __resolvedSession: options.session || null,
    };

    const res = {
      statusCode: 200,
      headersSent: false,
      cookie() {
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        if (this.statusCode >= 400) {
          const err = new Error(payload?.message || `Request failed (${this.statusCode})`);
          err.status = this.statusCode;
          err.payload = payload;
          finish(reject, err);
          return this;
        }
        finish(resolve, payload || {});
        return this;
      },
    };

    const next = (err) => {
      if (err) {
        finish(reject, err);
      } else {
        finish(resolve, {});
      }
    };

    runInSimulationRequestContext(() => Promise.resolve(handler(req, res, next)), {
      route: options.routeName || 'internal',
      gameId: body?.gameId || null,
      matchId: body?.matchId || null,
    })
      .then(() => {
        if (!res.headersSent) {
          finish(resolve, {});
        }
      })
      .catch((err) => {
        finish(reject, err);
      });
  });
}

const ROUTE_HANDLERS = Object.freeze({
  matchCreate: extractPostHandler(matchesCreateRoute),
  gameCreate: extractPostHandler(gamesCreateRoute),
  setup: extractPostHandler(setupRoute),
  ready: extractPostHandler(readyRoute),
  move: extractPostHandler(moveRoute),
  challenge: extractPostHandler(challengeRoute),
  bomb: extractPostHandler(bombRoute),
  pass: extractPostHandler(passRoute),
  onDeck: extractPostHandler(onDeckRoute),
  resign: extractPostHandler(resignRoute),
  draw: extractPostHandler(drawRoute),
});

function normalizeActionType(type) {
  return String(type || '').trim().toUpperCase();
}

function clonePiece(piece, fallbackColor = null) {
  if (!piece || typeof piece !== 'object') return null;
  const color = Number.isFinite(piece.color) ? piece.color : fallbackColor;
  const identity = Number.isFinite(piece.identity) ? piece.identity : null;
  if (!Number.isFinite(color) || !Number.isFinite(identity)) return null;
  return { color, identity };
}

function shuffleWithRng(values, rng) {
  const arr = Array.isArray(values) ? values.slice() : [];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildRandomSetupFromGame(game, color, rng, config) {
  const ranks = Number(config?.boardDimensions?.RANKS) || 6;
  const files = Number(config?.boardDimensions?.FILES) || 5;
  const kingIdentity = config?.identities?.get
    ? config.identities.get('KING')
    : 1;

  const row = color === WHITE ? 0 : (ranks - 1);
  const stash = Array.isArray(game?.stashes?.[color]) ? game.stashes[color] : [];
  const candidates = stash
    .map((piece) => clonePiece(piece, color))
    .filter(Boolean);
  if (candidates.length < (files + 1)) {
    throw new Error(`Insufficient stash pieces for setup (color ${color})`);
  }

  const kingIndex = candidates.findIndex((piece) => piece.identity === kingIdentity);
  if (kingIndex < 0) {
    throw new Error(`Setup stash missing king for color ${color}`);
  }

  const kingPiece = candidates.splice(kingIndex, 1)[0];
  const shuffled = shuffleWithRng(candidates, rng);
  const rankPieces = [kingPiece, ...shuffled.slice(0, files - 1)];
  const remaining = shuffled.slice(files - 1);
  if (!remaining.length) {
    throw new Error(`Setup stash missing on-deck piece for color ${color}`);
  }
  const onDeck = remaining[0];

  const columns = shuffleWithRng(
    Array.from({ length: files }, (_, idx) => idx),
    rng,
  );

  const pieces = rankPieces.map((piece, index) => ({
    row,
    col: columns[index],
    color,
    identity: piece.identity,
  }));

  return {
    pieces,
    onDeck: {
      color,
      identity: onDeck.identity,
    },
  };
}

async function loadGameLean(gameId) {
  const query = Game.findById(gameId);
  if (!query) return null;
  if (typeof query.lean === 'function') {
    return query.lean();
  }
  const doc = await query;
  if (!doc) return null;
  return typeof doc.toObject === 'function' ? doc.toObject() : deepClone(doc);
}

async function loadGameDocument(gameId) {
  const query = Game.findById(gameId);
  if (!query) return null;
  const doc = await query;
  return doc || null;
}

function toReplayPiece(piece, zone, row = -1, col = -1, id = '') {
  if (!piece) return null;
  return {
    id: id || `${zone}:${row}:${col}:${piece.color}:${piece.identity}`,
    color: piece.color,
    identity: piece.identity,
    zone,
    row,
    col,
  };
}

function toReplayFrameFromGame(game, metadata = {}) {
  const board = Array.isArray(game?.board)
    ? game.board.map((row, rIdx) => (
      Array.isArray(row)
        ? row.map((piece, cIdx) => (
          piece
            ? toReplayPiece(piece, 'board', rIdx, cIdx, `b:${rIdx}:${cIdx}`)
            : null
        ))
        : []
    ))
    : [];

  const onDecks = [WHITE, BLACK].map((color) => {
    const piece = game?.onDecks?.[color] || null;
    return piece ? toReplayPiece(piece, 'onDeck', -1, -1, `d:${color}`) : null;
  });

  const stashes = [WHITE, BLACK].map((color) => (
    Array.isArray(game?.stashes?.[color])
      ? game.stashes[color]
        .map((piece, idx) => toReplayPiece(piece, 'stash', -1, idx, `s:${color}:${idx}`))
        .filter(Boolean)
      : []
  ));

  const captured = [WHITE, BLACK].map((color) => (
    Array.isArray(game?.captured?.[color])
      ? game.captured[color]
        .map((piece, idx) => toReplayPiece(piece, 'captured', -1, idx, `c:${color}:${idx}`))
        .filter(Boolean)
      : []
  ));

  const moves = Array.isArray(game?.moves) ? game.moves : [];
  const actions = Array.isArray(game?.actions) ? game.actions : [];
  const lastMove = moves.length ? deepClone(moves[moves.length - 1]) : null;
  const lastAction = actions.length ? deepClone(actions[actions.length - 1]) : null;

  return {
    ply: actions.length,
    actionCount: actions.length,
    moveCount: moves.length,
    toMove: Number.isFinite(game?.playerTurn) ? game.playerTurn : WHITE,
    winner: Number.isFinite(game?.winner) ? game.winner : null,
    winReason: game?.winReason ?? null,
    isActive: Boolean(game?.isActive),
    board,
    onDecks,
    stashes,
    captured,
    daggers: Array.isArray(game?.daggers) ? game.daggers.slice(0, 2) : [0, 0],
    movesSinceAction: Number.isFinite(game?.movesSinceAction) ? game.movesSinceAction : 0,
    onDeckingPlayer: Number.isFinite(game?.onDeckingPlayer) ? game.onDeckingPlayer : null,
    lastMove,
    lastAction,
    ...metadata,
  };
}

function buildMlStateFromGame(game, options = {}) {
  const rows = Number(options?.rows) || 6;
  const cols = Number(options?.cols) || 5;
  const board = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
  const pieces = {};
  const stashes = [[], []];
  const onDecks = [null, null];
  const captured = [[], []];
  const moveHistoryByPiece = {};
  const revealedIdentities = {};
  let counter = 0;

  const register = (piece, zone, color, row = -1, col = -1, capturedBy = null) => {
    const normalized = clonePiece(piece, color);
    if (!normalized) return null;
    const id = `p-${counter}`;
    counter += 1;
    pieces[id] = {
      id,
      color: normalized.color,
      identity: normalized.identity,
      alive: zone !== 'captured',
      zone,
      row,
      col,
      capturedBy,
    };
    moveHistoryByPiece[id] = [];
    if (zone === 'board') {
      if (row >= 0 && row < rows && col >= 0 && col < cols) {
        board[row][col] = id;
      }
    } else if (zone === 'stash') {
      stashes[normalized.color].push(id);
    } else if (zone === 'onDeck') {
      onDecks[normalized.color] = id;
    } else if (zone === 'captured' && Number.isFinite(capturedBy)) {
      captured[capturedBy].push(id);
    }
    return id;
  };

  if (Array.isArray(game?.board)) {
    game.board.forEach((row, rIdx) => {
      if (!Array.isArray(row)) return;
      row.forEach((piece, cIdx) => {
        if (piece) {
          register(piece, 'board', piece.color, rIdx, cIdx, null);
        }
      });
    });
  }

  [WHITE, BLACK].forEach((color) => {
    if (Array.isArray(game?.stashes?.[color])) {
      game.stashes[color].forEach((piece) => {
        register(piece, 'stash', color, -1, -1, null);
      });
    }
    const onDeckPiece = game?.onDecks?.[color];
    if (onDeckPiece) {
      register(onDeckPiece, 'onDeck', color, -1, -1, null);
    }
    if (Array.isArray(game?.captured?.[color])) {
      game.captured[color].forEach((piece) => {
        register(piece, 'captured', piece?.color, -1, -1, color);
      });
    }
  });

  const actions = Array.isArray(game?.actions)
    ? game.actions.map((action, idx) => ({
      type: action.type,
      player: action.player,
      timestamp: idx,
      details: deepClone(action.details || {}),
    }))
    : [];
  const moves = Array.isArray(game?.moves)
    ? game.moves.map((move, idx) => ({
      player: move.player,
      pieceId: null,
      from: move.from ? { row: move.from.row, col: move.from.col } : null,
      to: move.to ? { row: move.to.row, col: move.to.col } : null,
      declaration: move.declaration,
      state: move.state,
      timestamp: idx,
    }))
    : [];

  return {
    board,
    pieces,
    stashes,
    onDecks,
    captured,
    moves,
    actions,
    daggers: Array.isArray(game?.daggers) ? game.daggers.slice(0, 2) : [0, 0],
    movesSinceAction: Number.isFinite(game?.movesSinceAction) ? game.movesSinceAction : 0,
    setupComplete: Array.isArray(game?.setupComplete) ? game.setupComplete.slice(0, 2) : [true, true],
    playersReady: Array.isArray(game?.playersReady) ? game.playersReady.slice(0, 2) : [true, true],
    onDeckingPlayer: Number.isFinite(game?.onDeckingPlayer) ? game.onDeckingPlayer : null,
    playerTurn: Number.isFinite(game?.playerTurn) ? game.playerTurn : WHITE,
    toMove: Number.isFinite(game?.playerTurn) ? game.playerTurn : WHITE,
    winner: Number.isFinite(game?.winner) ? game.winner : null,
    winReason: game?.winReason ?? null,
    isActive: Boolean(game?.isActive),
    ply: actions.length,
    maxPlies: Number.isFinite(options?.maxPlies) ? options.maxPlies : 120,
    seed: Number.isFinite(options?.seed) ? options.seed : Date.now(),
    moveHistoryByPiece,
    revealedIdentities,
  };
}

function createShadowStateFromLiveGame(game, options = {}) {
  const state = buildMlStateFromGame(game, options);
  if (options.resetActionHistory) {
    state.actions = [];
    state.moves = [];
    state.movesSinceAction = Number.isFinite(game?.movesSinceAction) ? game.movesSinceAction : 0;
  }
  if (Number.isFinite(options.playablePly)) {
    state.ply = options.playablePly;
  }
  if (Number.isFinite(game?.playerTurn)) {
    state.playerTurn = game.playerTurn;
    state.toMove = game.playerTurn;
  }
  if (Number.isFinite(options.maxPlies)) {
    state.maxPlies = options.maxPlies;
  }
  return state;
}

async function createApiBackedGame(seed) {
  const config = typeof getServerConfig.getServerConfigSnapshotSync === 'function'
    ? getServerConfig.getServerConfigSnapshotSync()
    : await getServerConfig();
  const quickplaySettings = config?.gameModeSettings?.get
    ? (config.gameModeSettings.get('QUICKPLAY') || {})
    : (config?.gameModeSettings?.QUICKPLAY || {});
  const modeSettings = config?.gameModeSettings || {};
  const timeControlStart = Number(quickplaySettings.TIME_CONTROL || 300000);
  const increment = Number(
    modeSettings?.get
      ? modeSettings.get('INCREMENT')
      : modeSettings.INCREMENT,
  ) || 0;
  const type = config?.gameModes?.get
    ? (config.gameModes.get('QUICKPLAY') || 'QUICKPLAY')
    : (config?.gameModes?.QUICKPLAY || 'QUICKPLAY');

  const player1 = new mongoose.Types.ObjectId().toString();
  const player2 = new mongoose.Types.ObjectId().toString();
  const sessionsByColor = {
    [WHITE]: createInternalRequestSession(player1, 'SimulationWhite'),
    [BLACK]: createInternalRequestSession(player2, 'SimulationBlack'),
  };
  const match = await callPostHandler(ROUTE_HANDLERS.matchCreate, {
    type,
    player1,
    player2,
    player1Score: 0,
    player2Score: 0,
    drawCount: 0,
    games: [],
    // Keep match inactive so game end does not auto-spawn follow-up games.
    isActive: false,
  });
  const matchId = String(match?._id || '');
  if (!matchId) {
    throw new Error('Failed to create API simulation match');
  }

  const game = await callPostHandler(ROUTE_HANDLERS.gameCreate, {
    matchId,
    players: [player1, player2],
    timeControlStart,
    increment,
  });
  const gameId = String(game?._id || '');
  if (!gameId) {
    throw new Error('Failed to create API simulation game');
  }

  const rng = createRng(seed);
  let liveGame = await loadGameLean(gameId);
  if (!liveGame) {
    throw new Error('Created game was not found');
  }
  const whiteSetup = buildRandomSetupFromGame(liveGame, WHITE, rng, config);
  await callPostHandler(ROUTE_HANDLERS.setup, {
    gameId,
    color: WHITE,
    pieces: whiteSetup.pieces,
    onDeck: whiteSetup.onDeck,
  }, { session: sessionsByColor[WHITE] });
  liveGame = await loadGameLean(gameId);
  const blackSetup = buildRandomSetupFromGame(liveGame, BLACK, rng, config);
  await callPostHandler(ROUTE_HANDLERS.setup, {
    gameId,
    color: BLACK,
    pieces: blackSetup.pieces,
    onDeck: blackSetup.onDeck,
  }, { session: sessionsByColor[BLACK] });

  await callPostHandler(ROUTE_HANDLERS.ready, { gameId, color: WHITE }, { session: sessionsByColor[WHITE] });
  await callPostHandler(ROUTE_HANDLERS.ready, { gameId, color: BLACK }, { session: sessionsByColor[BLACK] });

  const readyGame = await loadGameLean(gameId);
  if (!readyGame) {
    throw new Error('Game disappeared after setup');
  }

  return {
    gameId,
    matchId,
    game: readyGame,
    players: [player1, player2],
    sessionsByColor,
  };
}

async function cleanupApiBackedGame({ gameId, matchId }) {
  const canTouchMongoHistory = Boolean(mongoose.connection && mongoose.connection.readyState === 1);
  if (gameId) {
    try {
      await Game.deleteMany({ _id: gameId });
    } catch (_) {}
    try {
      if (
        canTouchMongoHistory
        && Game.historyModel
        && typeof Game.historyModel.deleteOne === 'function'
      ) {
        await Game.historyModel.deleteOne({ _id: gameId });
      }
    } catch (_) {}
  }
  if (matchId) {
    try {
      await Match.deleteMany({ _id: matchId });
    } catch (_) {}
    try {
      if (
        canTouchMongoHistory
        && Match.historyModel
        && typeof Match.historyModel.deleteOne === 'function'
      ) {
        await Match.historyModel.deleteOne({ _id: matchId });
      }
    } catch (_) {}
  }
}

function summarizeLiveBoard(game) {
  return Array.isArray(game?.board)
    ? game.board.map((row) => (
      Array.isArray(row)
        ? row.map((piece) => (piece ? `${piece.color}:${piece.identity}` : '.')).join('|')
        : ''
    ))
    : [];
}

function summarizeShadowBoard(state) {
  return Array.isArray(state?.board)
    ? state.board.map((row) => (
      Array.isArray(row)
        ? row.map((pieceId) => {
          if (!pieceId) return '.';
          const piece = state.pieces?.[pieceId];
          return piece ? `${piece.color}:${piece.identity}` : '.';
        }).join('|')
        : ''
    ))
    : [];
}

function summarizeLiveZone(zone = []) {
  return (Array.isArray(zone) ? zone : [])
    .map((piece) => (piece ? `${piece.color}:${piece.identity}` : '.'))
    .sort();
}

function summarizeShadowZone(state, pieceIds = []) {
  return (Array.isArray(pieceIds) ? pieceIds : [])
    .map((pieceId) => {
      const piece = state?.pieces?.[pieceId];
      return piece ? `${piece.color}:${piece.identity}` : '.';
    })
    .sort();
}

function compareLiveGameToShadowState(liveGame, shadowState) {
  const mismatches = [];
  if (!liveGame || !shadowState) {
    return {
      ok: false,
      mismatches: ['missing_state'],
    };
  }
  if ((liveGame.playerTurn ?? null) !== (shadowState.playerTurn ?? null)) {
    mismatches.push('playerTurn');
  }
  if ((liveGame.onDeckingPlayer ?? null) !== (shadowState.onDeckingPlayer ?? null)) {
    mismatches.push('onDeckingPlayer');
  }
  if (Boolean(liveGame.isActive) !== Boolean(shadowState.isActive)) {
    mismatches.push('isActive');
  }
  if (summarizeLiveBoard(liveGame).join('/') !== summarizeShadowBoard(shadowState).join('/')) {
    mismatches.push('board');
  }
  [WHITE, BLACK].forEach((color) => {
    if (summarizeLiveZone(liveGame?.stashes?.[color]).join(',') !== summarizeShadowZone(shadowState, shadowState?.stashes?.[color]).join(',')) {
      mismatches.push(`stash:${color}`);
    }
    if (summarizeLiveZone(liveGame?.captured?.[color]).join(',') !== summarizeShadowZone(shadowState, shadowState?.captured?.[color]).join(',')) {
      mismatches.push(`captured:${color}`);
    }
    const liveOnDeck = liveGame?.onDecks?.[color] ? `${liveGame.onDecks[color].color}:${liveGame.onDecks[color].identity}` : '.';
    const shadowOnDeckId = shadowState?.onDecks?.[color];
    const shadowOnDeckPiece = shadowOnDeckId ? shadowState?.pieces?.[shadowOnDeckId] : null;
    const shadowOnDeck = shadowOnDeckPiece ? `${shadowOnDeckPiece.color}:${shadowOnDeckPiece.identity}` : '.';
    if (liveOnDeck !== shadowOnDeck) {
      mismatches.push(`onDeck:${color}`);
    }
  });
  return {
    ok: mismatches.length === 0,
    mismatches,
  };
}

async function applyLiveActionToGame(context, action, shadowState) {
  const type = normalizeActionType(action?.type);
  const color = Number.isFinite(action?.player) ? action.player : shadowState?.playerTurn;
  const session = context?.sessionsByColor?.[color] || null;
  if (!context?.gameId || !session) {
    throw new Error('Simulation live game context is incomplete');
  }

  if (type === 'MOVE') {
    await callPostHandler(ROUTE_HANDLERS.move, {
      gameId: context.gameId,
      color,
      from: action.from,
      to: action.to,
      declaration: action.declaration,
    }, { session });
  } else if (type === 'CHALLENGE') {
    await callPostHandler(ROUTE_HANDLERS.challenge, {
      gameId: context.gameId,
      color,
    }, { session });
  } else if (type === 'BOMB') {
    await callPostHandler(ROUTE_HANDLERS.bomb, {
      gameId: context.gameId,
      color,
    }, { session });
  } else if (type === 'PASS') {
    await callPostHandler(ROUTE_HANDLERS.pass, {
      gameId: context.gameId,
      color,
    }, { session });
  } else if (type === 'ON_DECK') {
    const onDeckPiece = action.pieceId ? shadowState?.pieces?.[action.pieceId] : null;
    await callPostHandler(ROUTE_HANDLERS.onDeck, {
      gameId: context.gameId,
      color,
      piece: {
        identity: Number.isFinite(action.identity)
          ? action.identity
          : onDeckPiece?.identity,
      },
    }, { session });
  } else if (type === 'RESIGN') {
    await callPostHandler(ROUTE_HANDLERS.resign, {
      gameId: context.gameId,
      color,
    }, { session });
  } else {
    throw new Error(`Unsupported live action type: ${type || 'unknown'}`);
  }

  const liveGame = await loadGameLean(context.gameId);
  if (!liveGame) {
    throw new Error('Live simulation game disappeared after action');
  }
  return liveGame;
}

async function forceLiveGameDraw(context) {
  const game = await loadGameDocument(context?.gameId);
  if (!game || !game.isActive) {
    return loadGameLean(context?.gameId);
  }
  const config = typeof getServerConfig.getServerConfigSnapshotSync === 'function'
    ? getServerConfig.getServerConfigSnapshotSync()
    : await getServerConfig();
  await game.endGame(null, config.winReasons.get('DRAW'));
  return loadGameLean(context.gameId);
}

class MlRuntime {
  constructor(options = {}) {
    const defaultPath = path.join(process.cwd(), 'data', 'ml', 'runtime.json');
    this.dataFilePath = options.dataFilePath || defaultPath;
    this.persist = options.persist !== false;
    this.useMongoSimulations = options.useMongoSimulations !== false;
    this.maxSimulationHistory = clampPositiveInt(options.maxSimulationHistory, 200000, 100, 1000000);
    this.trimMongoSimulationHistoryEnabled = options.trimMongoSimulationHistory === true;
    this.state = createEmptyState();
    this.loaded = false;
    this.savePromise = Promise.resolve();
    this.didAttemptMongoSimulationMigration = false;
    this.simulationTasks = new Map();
    this.trainingTasks = new Map();
    this.resumePromise = null;
    this.lastLiveStatus = {
      simulation: null,
      training: null,
    };
  }

  async ensureLoaded() {
    if (this.loaded) return;
    if (!this.persist) {
      this.state = createEmptyState();
      this.ensureBootstrapSnapshot();
      this.loaded = true;
      return;
    }

    try {
      if (fs.existsSync(this.dataFilePath)) {
        const raw = await fs.promises.readFile(this.dataFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const emptyState = createEmptyState();
          this.state = {
            ...emptyState,
            ...parsed,
            counters: {
              ...emptyState.counters,
              ...(parsed.counters || {}),
            },
            activeJobs: {
              ...emptyState.activeJobs,
              ...(parsed.activeJobs || {}),
            },
          };
          if (Array.isArray(this.state.simulations)) {
            this.state.simulations = this.state.simulations
              .map((simulation) => compactSimulationForState(simulation))
              .slice(0, this.maxSimulationHistory);
          }
          if (!Array.isArray(this.state.trainingRuns)) {
            this.state.trainingRuns = [];
          }
        }
      } else {
        ensureDirSync(path.dirname(this.dataFilePath));
      }
    } catch (err) {
      console.error('[ml-runtime] failed to load persisted state, resetting runtime', err);
      this.state = createEmptyState();
    }

    this.ensureBootstrapSnapshot();
    this.loaded = true;
    await this.save();
    await this.ensureResumedJobs();
  }

  ensureBootstrapSnapshot() {
    if (Array.isArray(this.state.snapshots) && this.state.snapshots.length) return;
    const snapshot = this.createSnapshotRecord({
      label: 'Bootstrap',
      generation: 0,
      parentSnapshotId: null,
      modelBundle: createDefaultModelBundle({ seed: 20260224 }),
      notes: 'Initial baseline model bundle',
    });
    this.state.snapshots = [snapshot];
  }

  nextId(prefix) {
    const key = prefix === 'snapshot'
      ? 'snapshot'
      : prefix === 'simulation'
        ? 'simulation'
        : prefix === 'game'
          ? 'game'
          : 'training';
    const current = clampPositiveInt(this.state.counters[key], 1);
    this.state.counters[key] = current + 1;
    return `${prefix}-${String(current).padStart(4, '0')}`;
  }

  createSnapshotRecord(options = {}) {
    const createdAt = nowIso();
    return {
      id: options.id || this.nextId('snapshot'),
      label: options.label || 'Snapshot',
      createdAt,
      updatedAt: createdAt,
      generation: clampPositiveInt(options.generation, 0, 0, 100000),
      parentSnapshotId: options.parentSnapshotId || null,
      notes: options.notes || '',
      modelBundle: cloneModelBundle(options.modelBundle || createDefaultModelBundle()),
      stats: {
        simulations: 0,
        games: 0,
        whiteWins: 0,
        blackWins: 0,
        draws: 0,
        trainingRuns: 0,
        ...options.stats,
      },
      losses: Array.isArray(options.losses) ? options.losses.slice() : [],
    };
  }

  async save() {
    if (!this.persist) return;
    ensureDirSync(path.dirname(this.dataFilePath));
    const payload = JSON.stringify(this.state, null, 2);
    this.savePromise = this.savePromise
      .then(async () => {
        await persistJsonWithFallback(this.dataFilePath, payload);
      })
      .catch((err) => {
        console.error('[ml-runtime] failed to persist state', err);
      });
    await this.savePromise;
  }

  async ensureResumedJobs() {
    if (!this.persist) return;
    if (this.resumePromise) {
      await this.resumePromise;
      return;
    }
    this.resumePromise = Promise.resolve()
      .then(async () => {
        await this.hydrateActiveJobsFromMongo();
        await this.resumePersistedJobs();
      })
      .catch((err) => {
        console.error('[ml-runtime] failed to resume persisted jobs', err);
      });
    await this.resumePromise;
  }

  async hydrateActiveJobsFromMongo() {
    if (!this.isMongoSimulationPersistenceAvailable()) return;
    let stateChanged = false;

    if (!this.state.activeJobs?.simulation) {
      const doc = await SimulationModel.findOne(
        { status: { $in: ['running', 'stopping'] } },
        { _id: 0, __v: 0 },
      )
        .sort({ createdAt: -1 })
        .lean()
        .catch(() => null);
      const simulation = doc ? this.normalizeStoredSimulationRecord(doc) : null;
      if (simulation?.id) {
        const config = simulation.config || {};
        this.state.activeJobs.simulation = {
          type: 'simulation',
          taskId: simulation?.persistence?.taskId || `simulation:${simulation.id}`,
          simulationId: simulation.id,
          status: simulation.status === 'stopping' ? 'stopping' : 'running',
          createdAt: simulation.createdAt || nowIso(),
          updatedAt: simulation.updatedAt || simulation.createdAt || nowIso(),
          label: simulation.label || simulation.id,
          participantAId: simulation.participantAId || null,
          participantBId: simulation.participantBId || null,
          participantALabel: simulation.participantALabel || null,
          participantBLabel: simulation.participantBLabel || null,
          whiteSnapshotId: simulation.whiteSnapshotId || null,
          blackSnapshotId: simulation.blackSnapshotId || null,
          options: {
            whiteParticipantId: simulation.participantAId || null,
            blackParticipantId: simulation.participantBId || null,
            whiteSnapshotId: simulation.whiteSnapshotId || null,
            blackSnapshotId: simulation.blackSnapshotId || null,
            gameCount: config.requestedGameCount || config.gameCount || simulation.gameCount || 0,
            maxPlies: config.maxPlies,
            iterations: config.iterations,
            maxDepth: config.maxDepth,
            hypothesisCount: config.hypothesisCount,
            riskBias: config.riskBias,
            exploration: config.exploration,
            alternateColors: Boolean(config.alternateColors),
            seed: config.seed,
            label: simulation.label || null,
          },
          checkpoint: {
            requestedGameCount: config.requestedGameCount || config.gameCount || simulation.gameCount || 0,
            completedGames: Number(config.completedGameCount || simulation?.stats?.games || simulation.gameCount || 0),
            stats: deepClone(simulation.stats || {}),
            lastCheckpointAt: simulation?.persistence?.checkpointedAt || simulation.updatedAt || simulation.createdAt || nowIso(),
          },
        };
        if (!this.getInMemorySimulation(simulation.id)) {
          this.state.simulations.unshift(simulation);
          this.state.simulations = this.state.simulations.slice(0, this.maxSimulationHistory);
        }
        stateChanged = true;
      }
    }

    if (!this.state.activeJobs?.training) {
      const doc = await TrainingRunModel.findOne(
        { status: 'running' },
        { _id: 0, __v: 0 },
      )
        .sort({ createdAt: -1 })
        .lean()
        .catch(() => null);
      const run = doc ? this.normalizeStoredTrainingRunRecord(doc) : null;
      if (run?.id) {
        this.state.activeJobs.training = {
          type: 'training',
          taskId: run?.checkpoint?.taskId || `training:${run.id}`,
          trainingRunId: run.id,
          status: 'running',
          createdAt: run.createdAt || nowIso(),
          updatedAt: run.updatedAt || run.createdAt || nowIso(),
          baseSnapshotId: run.baseSnapshotId || null,
          epochs: Number(run.epochs || 0),
          learningRate: Number(run.learningRate || 0),
          sourceSimulationIds: Array.isArray(run.sourceSimulationIds) ? run.sourceSimulationIds.slice() : [],
          sourceGames: Number(run.sourceGames || 0),
          sourceSimulations: Number(run.sourceSimulations || 0),
          sampleCounts: deepClone(run.sampleCounts || {}),
          label: run.label || '',
          notes: run.notes || '',
          checkpoint: deepClone(run.checkpoint || {}),
        };
        if (!this.getInMemoryTrainingRun(run.id)) {
          this.state.trainingRuns.unshift({
            ...run,
            checkpoint: {
              ...deepClone(run.checkpoint || {}),
              modelBundle: undefined,
              optimizerState: undefined,
            },
          });
          this.state.trainingRuns = this.state.trainingRuns.slice(0, 500);
        }
        stateChanged = true;
      }
    }

    if (stateChanged) {
      await this.save();
    }
  }

  async resumePersistedJobs() {
    const simulationJob = this.state.activeJobs?.simulation || null;
    if (simulationJob && String(simulationJob.status || '').toLowerCase() === 'running') {
      this.resumeSimulationJob(simulationJob);
    }

    const trainingJob = this.state.activeJobs?.training || null;
    if (trainingJob && String(trainingJob.status || '').toLowerCase() === 'running') {
      this.resumeTrainingJob(trainingJob);
    }
  }

  rememberLiveStatus(type, payload = null) {
    if (!type) return;
    if (!payload) {
      this.lastLiveStatus[type] = null;
      return;
    }
    this.lastLiveStatus[type] = {
      observedAt: nowIso(),
      payload: deepClone(payload),
    };
  }

  getRecentRememberedLiveStatus(type) {
    const entry = this.lastLiveStatus?.[type] || null;
    if (!entry?.observedAt || !entry?.payload) return null;
    const age = Date.now() - parseTimeValue(entry.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > LIVE_STATUS_RETENTION_MS) {
      return null;
    }
    return deepClone(entry.payload);
  }

  getInMemoryTrainingRun(trainingRunId) {
    return (this.state.trainingRuns || []).find((item) => item.id === trainingRunId) || null;
  }

  normalizeStoredTrainingRunRecord(trainingRun) {
    if (!trainingRun || typeof trainingRun !== 'object') return null;
    const normalized = deepClone(trainingRun);
    if (Object.prototype.hasOwnProperty.call(normalized, '_id')) {
      delete normalized._id;
    }
    if (Object.prototype.hasOwnProperty.call(normalized, '__v')) {
      delete normalized.__v;
    }
    return normalized;
  }

  isMongoSimulationPersistenceAvailable() {
    if (!this.persist || !this.useMongoSimulations) return false;
    return mongoose.connection && mongoose.connection.readyState === 1;
  }

  normalizeStoredSimulationRecord(simulation) {
    if (!simulation || typeof simulation !== 'object') return null;
    const normalized = deepClone(simulation);
    if (Object.prototype.hasOwnProperty.call(normalized, '_id')) {
      delete normalized._id;
    }
    if (Object.prototype.hasOwnProperty.call(normalized, '__v')) {
      delete normalized.__v;
    }
    return normalized;
  }

  getInMemorySimulation(simulationId) {
    return (this.state.simulations || []).find((item) => item.id === simulationId) || null;
  }

  async listStoredSimulations(options = {}) {
    const rawLimit = Number(options.limit);
    const hasLimit = Number.isFinite(rawLimit);
    const limit = hasLimit
      ? clampPositiveInt(rawLimit, this.maxSimulationHistory, 1, this.maxSimulationHistory)
      : null;
    if (this.isMongoSimulationPersistenceAvailable()) {
      await this.maybeMigrateStateSimulationsToMongo();
      let query = SimulationModel.find({}, { _id: 0, __v: 0 })
        .sort({ createdAt: -1 });
      if (limit) {
        query = query.limit(limit);
      }
      const docs = await query.lean();
      const mongoRecords = (Array.isArray(docs) ? docs : [])
        .map((doc) => this.normalizeStoredSimulationRecord(doc))
        .filter(Boolean);
      const memoryRecords = (this.state.simulations || [])
        .map((simulation) => this.normalizeStoredSimulationRecord(simulation))
        .filter(Boolean);
      const mongoIds = new Set(mongoRecords.map((record) => record.id));
      const unsavedMemoryRecords = memoryRecords.filter((record) => !mongoIds.has(record.id));
      return mergeSimulationRecords([mongoRecords, unsavedMemoryRecords], limit);
    }

    const source = Array.isArray(this.state.simulations) ? this.state.simulations : [];
    const bounded = limit ? source.slice(0, limit) : source.slice();
    return bounded
      .map((simulation) => this.normalizeStoredSimulationRecord(simulation))
      .filter(Boolean);
  }

  async maybeMigrateStateSimulationsToMongo() {
    if (!this.isMongoSimulationPersistenceAvailable()) return;
    if (this.didAttemptMongoSimulationMigration) return;
    this.didAttemptMongoSimulationMigration = true;

    const legacySimulations = Array.isArray(this.state.simulations)
      ? this.state.simulations
      : [];
    if (!legacySimulations.length) return;

    try {
      for (let idx = 0; idx < legacySimulations.length; idx += 1) {
        const simulation = this.normalizeStoredSimulationRecord(legacySimulations[idx]);
        if (!simulation || !simulation.id) continue;
        const existing = await SimulationModel.exists({ id: simulation.id });
        if (existing) continue;
        await this.persistSimulationToMongo(simulation, { skipMigration: true });
      }
    } catch (err) {
      console.error('[ml-runtime] failed to migrate local simulation history to MongoDB', err);
    }
  }

  async getStoredSimulationById(simulationId) {
    if (!simulationId) return null;

    if (this.isMongoSimulationPersistenceAvailable()) {
      await this.maybeMigrateStateSimulationsToMongo();
      const doc = await SimulationModel.findOne({ id: simulationId }, { _id: 0, __v: 0 }).lean();
      const mongoRecord = doc ? this.normalizeStoredSimulationRecord(doc) : null;
      const memoryRecord = this.normalizeStoredSimulationRecord(this.getInMemorySimulation(simulationId));
      if (memoryRecord && !mongoRecord) {
        return memoryRecord;
      }
      if (!memoryRecord) {
        return mongoRecord;
      }
      const mongoDetailed = simulationHasDetailedGames(mongoRecord);
      const memoryDetailed = simulationHasDetailedGames(memoryRecord);
      if (memoryDetailed && !mongoDetailed) {
        return memoryRecord;
      }
      return mongoRecord;
    }

    return this.normalizeStoredSimulationRecord(this.getInMemorySimulation(simulationId));
  }

  async listStoredSimulationsForTraining(simulationIds = null) {
    const allowed = Array.isArray(simulationIds) && simulationIds.length
      ? new Set(simulationIds)
      : null;

    if (this.isMongoSimulationPersistenceAvailable()) {
      await this.maybeMigrateStateSimulationsToMongo();
      const query = allowed ? { id: { $in: Array.from(allowed) } } : {};
      const docs = await SimulationModel.find(query, { _id: 0, __v: 0 })
        .sort({ createdAt: -1 })
        .lean();
      const mongoRecords = (Array.isArray(docs) ? docs : [])
        .map((doc) => this.normalizeStoredSimulationRecord(doc))
        .filter(Boolean);
      const memoryRecords = (this.state.simulations || [])
        .filter((simulation) => !allowed || allowed.has(simulation.id))
        .map((simulation) => this.normalizeStoredSimulationRecord(simulation))
        .filter(Boolean);
      const mongoIds = new Set(mongoRecords.map((record) => record.id));
      const unsavedMemoryRecords = memoryRecords.filter((record) => !mongoIds.has(record.id));
      const memoryDetailedRecords = memoryRecords
        .filter((record) => simulationHasDetailedGames(record));
      const merged = mergeSimulationRecords(
        [mongoRecords, memoryDetailedRecords, unsavedMemoryRecords],
        null,
      );

      const externalSimulationIds = merged
        .filter((simulation) => simulation?.gamesStoredExternally && !simulationHasDetailedGames(simulation))
        .map((simulation) => simulation.id)
        .filter(Boolean);
      const gamesBySimulationId = new Map();
      if (externalSimulationIds.length) {
        const gameDocs = await SimulationGameModel
          .find(
            { simulationId: { $in: externalSimulationIds } },
            { _id: 0, __v: 0 },
          )
          .sort({ simulationId: 1, createdAt: 1 })
          .lean();
        (Array.isArray(gameDocs) ? gameDocs : []).forEach((gameDoc) => {
          const normalized = this.normalizeStoredSimulationRecord(gameDoc);
          if (!normalized?.simulationId) return;
          if (!gamesBySimulationId.has(normalized.simulationId)) {
            gamesBySimulationId.set(normalized.simulationId, []);
          }
          gamesBySimulationId.get(normalized.simulationId).push(normalized);
        });
      }

      return merged.map((simulation) => {
        if (!simulation?.gamesStoredExternally || simulationHasDetailedGames(simulation)) {
          return simulation;
        }
        const hydratedGames = gamesBySimulationId.get(simulation.id);
        if (!Array.isArray(hydratedGames) || !hydratedGames.length) {
          return simulation;
        }
        return {
          ...simulation,
          games: hydratedGames,
        };
      });
    }

    return (this.state.simulations || [])
      .filter((simulation) => !allowed || allowed.has(simulation.id))
      .map((simulation) => this.normalizeStoredSimulationRecord(simulation))
      .filter(Boolean);
  }

  async persistSimulationToMongo(simulation, options = {}) {
    if (!simulation || !this.isMongoSimulationPersistenceAvailable()) {
      return {
        saved: false,
        reason: 'mongo_unavailable',
      };
    }

    try {
      if (!options.skipMigration) {
        await this.maybeMigrateStateSimulationsToMongo();
      }
      const payload = this.normalizeStoredSimulationRecord(simulation);
      if (!payload || !payload.id) {
        return {
          saved: false,
          reason: 'invalid_payload',
        };
      }

      const gamePayloads = Array.isArray(payload.games) ? payload.games : [];
      const checkpointGameIds = Array.isArray(options.gameIds)
        ? new Set(options.gameIds.filter(Boolean))
        : null;
      const hasDetailedGamePayloads = simulationHasDetailedGames(payload);
      const gameSummaries = gamePayloads
        .map((game) => summarizeGameForStorage(game))
        .filter(Boolean);
      const inlineSummaryLimit = 256;
      const inlineSummaries = gameSummaries.slice(0, inlineSummaryLimit);

      const mongoStatus = {
        saved: true,
        mode: 'external-games',
        gameCount: gameSummaries.length,
      };
      const simulationDoc = {
        ...payload,
        games: inlineSummaries,
        gameCount: gameSummaries.length,
        gamesStoredExternally: true,
        status: payload.status || 'completed',
        persistence: {
          ...(payload.persistence || {}),
          mongo: mongoStatus,
        },
      };

      await SimulationModel.updateOne(
        { id: simulationDoc.id },
        { $set: simulationDoc },
        { upsert: true, setDefaultsOnInsert: true },
      );

      const shouldSyncDetailedGames = hasDetailedGamePayloads || !payload.gamesStoredExternally;
      if (shouldSyncDetailedGames) {
        const checkpointGames = checkpointGameIds
          ? gamePayloads.filter((game) => checkpointGameIds.has(game?.id))
          : gamePayloads;
        const gameOperations = checkpointGames
          .filter((game) => game && game.id)
          .map((game) => {
            const summary = summarizeGameForStorage(game) || {};
            return {
              updateOne: {
                filter: { simulationId: simulationDoc.id, id: game.id },
                update: {
                  $set: {
                    simulationId: simulationDoc.id,
                    decisionCount: summary.decisionCount || 0,
                    replayFrameCount: summary.replayFrameCount || 0,
                    ...deepClone(game),
                  },
                },
                upsert: true,
              },
            };
          });

        if (gameOperations.length) {
          const chunks = chunkArray(gameOperations, 10);
          for (let idx = 0; idx < chunks.length; idx += 1) {
            await SimulationGameModel.bulkWrite(chunks[idx], { ordered: false });
          }
        }

        if (options.pruneMissingGames === true) {
          const gameIds = gamePayloads
            .map((game) => game?.id)
            .filter(Boolean);
          if (gameIds.length) {
            await SimulationGameModel.deleteMany({
              simulationId: simulationDoc.id,
              id: { $nin: gameIds },
            });
          } else {
            await SimulationGameModel.deleteMany({ simulationId: simulationDoc.id });
          }
        }
      }

      return mongoStatus;
    } catch (err) {
      const status = {
        saved: false,
        reason: 'mongo_write_failed',
        message: err?.message || 'MongoDB write failed',
      };
      console.error('[ml-runtime] failed to persist simulation to MongoDB', err);
      return status;
    }
  }

  isMongoTrainingPersistenceAvailable() {
    return this.isMongoSimulationPersistenceAvailable();
  }

  async persistTrainingRunToMongo(trainingRun, options = {}) {
    if (!trainingRun || !this.isMongoTrainingPersistenceAvailable()) {
      return {
        saved: false,
        reason: 'mongo_unavailable',
      };
    }

    try {
      const payload = this.normalizeStoredTrainingRunRecord(trainingRun);
      if (!payload?.id) {
        return {
          saved: false,
          reason: 'invalid_payload',
        };
      }

      const checkpoint = deepClone(payload.checkpoint || {});
      if (options.includeCheckpointArtifacts !== true) {
        delete checkpoint.modelBundle;
        delete checkpoint.optimizerState;
      }

      await TrainingRunModel.updateOne(
        { id: payload.id },
        {
          $set: {
            ...payload,
            checkpoint,
            updatedAt: payload.updatedAt || nowIso(),
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );

      return {
        saved: true,
        mode: options.includeCheckpointArtifacts === true ? 'checkpoint' : 'summary',
      };
    } catch (err) {
      const status = {
        saved: false,
        reason: 'mongo_write_failed',
        message: err?.message || 'MongoDB write failed',
      };
      console.error('[ml-runtime] failed to persist training run to MongoDB', err);
      return status;
    }
  }

  async listStoredTrainingRuns(options = {}) {
    const limit = clampPositiveInt(options.limit, 20, 1, 500);
    if (this.isMongoTrainingPersistenceAvailable()) {
      const docs = await TrainingRunModel.find(
        {},
        {
          _id: 0,
          __v: 0,
          'checkpoint.modelBundle': 0,
          'checkpoint.optimizerState': 0,
        },
      )
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      const mongoRecords = (Array.isArray(docs) ? docs : [])
        .map((doc) => this.normalizeStoredTrainingRunRecord(doc))
        .filter(Boolean);
      const memoryRecords = (this.state.trainingRuns || [])
        .map((run) => this.normalizeStoredTrainingRunRecord(run))
        .filter(Boolean);
      const mergedById = new Map();
      [...mongoRecords, ...memoryRecords].forEach((run) => {
        if (!run?.id) return;
        const existing = mergedById.get(run.id);
        if (!existing) {
          mergedById.set(run.id, run);
          return;
        }
        const existingTime = Math.max(parseTimeValue(existing.updatedAt), parseTimeValue(existing.createdAt));
        const candidateTime = Math.max(parseTimeValue(run.updatedAt), parseTimeValue(run.createdAt));
        if (candidateTime >= existingTime) {
          mergedById.set(run.id, run);
        }
      });
      return Array.from(mergedById.values())
        .sort((a, b) => (
          Math.max(parseTimeValue(b?.updatedAt), parseTimeValue(b?.createdAt))
          - Math.max(parseTimeValue(a?.updatedAt), parseTimeValue(a?.createdAt))
        ))
        .slice(0, limit);
    }

    return (this.state.trainingRuns || [])
      .slice(0, limit)
      .map((run) => this.normalizeStoredTrainingRunRecord(run))
      .filter(Boolean);
  }

  async trimMongoSimulationHistory() {
    if (!this.trimMongoSimulationHistoryEnabled) return;
    if (!this.isMongoSimulationPersistenceAvailable()) return;

    try {
      await this.maybeMigrateStateSimulationsToMongo();
      const stale = await SimulationModel.find({}, { id: 1, _id: 0 })
        .sort({ createdAt: -1 })
        .skip(this.maxSimulationHistory)
        .lean();
      if (!stale.length) return;
      const staleIds = stale
        .map((entry) => entry.id)
        .filter(Boolean);
      if (!staleIds.length) return;
      await SimulationModel.deleteMany({ id: { $in: staleIds } });
      await SimulationGameModel.deleteMany({ simulationId: { $in: staleIds } });
    } catch (err) {
      console.error('[ml-runtime] failed to trim simulation history in MongoDB', err);
    }
  }

  getSnapshotById(snapshotId) {
    return (this.state.snapshots || []).find((snapshot) => snapshot.id === snapshotId) || null;
  }

  summarizeSnapshot(snapshot) {
    if (!snapshot) return null;
    const latestLoss = Array.isArray(snapshot.losses) && snapshot.losses.length
      ? snapshot.losses[snapshot.losses.length - 1]
      : null;
    return {
      id: snapshot.id,
      label: snapshot.label,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      generation: snapshot.generation,
      parentSnapshotId: snapshot.parentSnapshotId,
      notes: snapshot.notes,
      stats: snapshot.stats,
      latestLoss,
      lossCount: Array.isArray(snapshot.losses) ? snapshot.losses.length : 0,
    };
  }

  summarizeSimulation(simulation) {
    if (!simulation) return null;
    const participantResults = Array.isArray(simulation?.stats?.participantResults)
      ? simulation.stats.participantResults.map((entry) => (
        normalizeParticipantStatsEntry(entry, entry?.games)
      ))
      : [];
    const stats = {
      ...(simulation.stats || {}),
      participantResults,
    };
    const hasReasonStats = stats.winReasons
      && typeof stats.winReasons === 'object'
      && Object.keys(stats.winReasons).length > 0;
    if (!hasReasonStats) {
      const derived = deriveWinReasonCountsFromGames(simulation);
      if (Object.keys(derived).length) {
        stats.winReasons = derived;
      }
    }
    const errorMessage = simulation?.persistence?.error
      || simulation?.persistence?.message
      || simulation?.persistence?.mongo?.message
      || null;
    return {
      id: simulation.id,
      createdAt: simulation.createdAt,
      label: simulation.label,
      whiteSnapshotId: simulation.whiteSnapshotId,
      blackSnapshotId: simulation.blackSnapshotId,
      participantAId: simulation.participantAId || null,
      participantBId: simulation.participantBId || null,
      participantALabel: simulation.participantALabel || null,
      participantBLabel: simulation.participantBLabel || null,
      alternateColors: Boolean(simulation?.config?.alternateColors),
      status: simulation.status || 'completed',
      config: simulation.config,
      gameCount: Number.isFinite(simulation.gameCount)
        ? simulation.gameCount
        : Number.isFinite(simulation?.stats?.games)
          ? Number(simulation.stats.games)
          : (Array.isArray(simulation.games) ? simulation.games.length : 0),
      gamesStoredExternally: Boolean(simulation.gamesStoredExternally),
      persistence: simulation.persistence || null,
      errorMessage,
      stats,
    };
  }

  summarizeTrainingRun(trainingRun) {
    if (!trainingRun) return null;
    const history = Array.isArray(trainingRun.history) ? trainingRun.history : [];
    const latestLoss = trainingRun.finalLoss || (history.length ? history[history.length - 1] : null);
    return {
      id: trainingRun.id,
      createdAt: trainingRun.createdAt,
      updatedAt: trainingRun.updatedAt || trainingRun.createdAt,
      status: trainingRun.status || 'completed',
      label: trainingRun.label || '',
      notes: trainingRun.notes || '',
      baseSnapshotId: trainingRun.baseSnapshotId || null,
      newSnapshotId: trainingRun.newSnapshotId || null,
      epochs: Number(trainingRun.epochs || 0),
      learningRate: Number(trainingRun.learningRate || 0),
      sourceSimulationIds: Array.isArray(trainingRun.sourceSimulationIds)
        ? trainingRun.sourceSimulationIds.slice()
        : [],
      sourceGames: Number(trainingRun.sourceGames || 0),
      sourceSimulations: Number(trainingRun.sourceSimulations || 0),
      sampleCounts: deepClone(trainingRun.sampleCounts || {}),
      history: deepClone(history),
      finalLoss: latestLoss ? deepClone(latestLoss) : null,
      checkpoint: {
        completedEpochs: Number(trainingRun?.checkpoint?.completedEpochs || history.length || 0),
        totalEpochs: Number(trainingRun?.checkpoint?.totalEpochs || trainingRun.epochs || 0),
        checkpointedAt: trainingRun?.checkpoint?.checkpointedAt || null,
      },
    };
  }

  async getSummary() {
    await this.ensureLoaded();
    const snapshots = (this.state.snapshots || []).map((snapshot) => this.summarizeSnapshot(snapshot));
    const simulations = await this.listStoredSimulations({ limit: this.maxSimulationHistory });
    const trainingRuns = await this.listStoredTrainingRuns({ limit: 1 });
    const totalGames = simulations.reduce((acc, simulation) => (
      acc + ((simulation.stats && simulation.stats.games) || 0)
    ), 0);
    const totalTrainingRuns = (await this.listStoredTrainingRuns({ limit: 500 })).length;
    const latestSimulation = simulations.length ? this.summarizeSimulation(simulations[0]) : null;
    const latestTraining = trainingRuns.length ? this.summarizeTrainingRun(trainingRuns[0]) : null;

    return {
      snapshots,
      counts: {
        snapshots: snapshots.length,
        simulations: simulations.length,
        games: totalGames,
        trainingRuns: totalTrainingRuns,
      },
      latestSimulation,
      latestTraining,
    };
  }

  async listSnapshots() {
    await this.ensureLoaded();
    return (this.state.snapshots || []).map((snapshot) => this.summarizeSnapshot(snapshot));
  }

  async listParticipants() {
    await this.ensureLoaded();
    const snapshots = (this.state.snapshots || []).map((snapshot) => ({
      id: toSnapshotParticipantId(snapshot.id),
      type: 'snapshot',
      snapshotId: snapshot.id,
      label: snapshot.label,
      generation: snapshot.generation,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      stats: snapshot.stats || {},
      notes: snapshot.notes || '',
    }));
    return {
      builtins: this.listBuiltinParticipants(),
      snapshots,
      items: [...snapshots, ...this.listBuiltinParticipants()],
    };
  }

  async getSnapshotDetails(snapshotId) {
    await this.ensureLoaded();
    const snapshot = this.getSnapshotById(snapshotId);
    if (!snapshot) return null;
    return deepClone(snapshot);
  }

  async createSnapshot(options = {}) {
    await this.ensureLoaded();
    const base = options.fromSnapshotId ? this.getSnapshotById(options.fromSnapshotId) : null;
    const generation = base ? (base.generation + 1) : 0;
    const label = options.label
      || (base ? `${base.label} (fork)` : 'Snapshot');
    const record = this.createSnapshotRecord({
      label,
      generation,
      parentSnapshotId: base ? base.id : null,
      modelBundle: base ? base.modelBundle : createDefaultModelBundle({ seed: Date.now() }),
      notes: options.notes || '',
    });
    this.state.snapshots.unshift(record);
    await this.save();
    return this.summarizeSnapshot(record);
  }

  async renameSnapshot(snapshotId, nextLabel) {
    await this.ensureLoaded();
    const id = typeof snapshotId === 'string' ? snapshotId.trim() : '';
    const label = typeof nextLabel === 'string' ? nextLabel.trim() : '';
    if (!id) {
      const err = new Error('Snapshot id is required');
      err.statusCode = 400;
      err.code = 'INVALID_SNAPSHOT_ID';
      throw err;
    }
    if (!label) {
      const err = new Error('Snapshot label is required');
      err.statusCode = 400;
      err.code = 'INVALID_SNAPSHOT_LABEL';
      throw err;
    }

    const snapshot = this.getSnapshotById(id);
    if (!snapshot) {
      return null;
    }
    snapshot.label = label;
    snapshot.updatedAt = nowIso();
    await this.save();
    return this.summarizeSnapshot(snapshot);
  }

  async deleteSnapshot(snapshotId) {
    await this.ensureLoaded();
    const id = typeof snapshotId === 'string' ? snapshotId.trim() : '';
    if (!id) {
      const err = new Error('Snapshot id is required');
      err.statusCode = 400;
      err.code = 'INVALID_SNAPSHOT_ID';
      throw err;
    }

    const snapshots = Array.isArray(this.state.snapshots) ? this.state.snapshots : [];
    const index = snapshots.findIndex((snapshot) => snapshot.id === id);
    if (index < 0) {
      return { deleted: false, id };
    }

    if (snapshots.length <= 1) {
      const err = new Error('Cannot delete the last snapshot');
      err.statusCode = 409;
      err.code = 'LAST_SNAPSHOT';
      throw err;
    }

    const [removed] = snapshots.splice(index, 1);
    await this.save();
    return {
      deleted: true,
      id,
      removedSnapshot: this.summarizeSnapshot(removed),
      remainingSnapshots: snapshots.length,
    };
  }

  getLatestSnapshot() {
    return (this.state.snapshots || [])[0] || null;
  }

  resolveSnapshot(snapshotId) {
    if (!snapshotId) return this.getLatestSnapshot();
    return this.getSnapshotById(snapshotId) || this.getLatestSnapshot();
  }

  listBuiltinParticipants() {
    return BUILTIN_PARTICIPANTS.map((participant) => ({
      id: participant.id,
      type: participant.type,
      label: participant.label,
      notes: participant.notes || '',
    }));
  }

  resolveParticipant(participantId, fallbackSnapshotId = null) {
    const normalizedBuiltinId = normalizeParticipantId(participantId);
    if (normalizedBuiltinId && isBuiltinParticipantId(normalizedBuiltinId)) {
      const builtin = getBuiltinParticipant(normalizedBuiltinId);
      if (builtin) {
        return {
          id: builtin.id,
          type: 'builtin',
          label: builtin.label,
          notes: builtin.notes || '',
          snapshot: null,
          snapshotId: null,
          builtinId: builtin.id,
        };
      }
    }

    let snapshotId = parseSnapshotParticipantId(participantId);
    if (!snapshotId && typeof participantId === 'string' && participantId.trim()) {
      snapshotId = participantId.trim();
    }
    if (!snapshotId && fallbackSnapshotId) {
      snapshotId = fallbackSnapshotId;
    }

    const snapshot = this.resolveSnapshot(snapshotId);
    if (!snapshot) return null;
    return {
      id: toSnapshotParticipantId(snapshot.id),
      type: 'snapshot',
      label: snapshot.label || snapshot.id,
      notes: snapshot.notes || '',
      snapshot,
      snapshotId: snapshot.id,
      builtinId: null,
    };
  }

  getDisplayParticipantId(participant) {
    if (!participant) return '';
    if (participant.type === 'builtin') return participant.id || '';
    if (participant.snapshotId) return toSnapshotParticipantId(participant.snapshotId);
    return participant.id || '';
  }

  getDisplayParticipantLabel(participant, fallbackId = '') {
    if (!participant) return fallbackId || 'Unknown';
    return participant.label || participant.snapshot?.label || participant.snapshotId || participant.id || fallbackId || 'Unknown';
  }

  async buildUniqueSimulationLabel(baseLabel, options = {}) {
    const normalizedBase = typeof baseLabel === 'string'
      ? baseLabel.trim()
      : '';
    const safeBase = normalizedBase || 'Simulation';
    const forceOrdinal = Boolean(options.forceOrdinal);

    const existingSimulations = await this.listStoredSimulations({ limit: this.maxSimulationHistory });
    const existingLabels = new Set(
      existingSimulations
        .map((simulation) => String(simulation?.label || '').trim())
        .filter(Boolean),
    );

    if (!forceOrdinal && !existingLabels.has(safeBase)) {
      return safeBase;
    }

    let index = 1;
    let candidate = `${safeBase} ${String(index).padStart(3, '0')}`;
    while (existingLabels.has(candidate)) {
      index += 1;
      candidate = `${safeBase} ${String(index).padStart(3, '0')}`;
    }
    return candidate;
  }

  chooseActionForParticipant(participant, state, options = {}) {
    if (!participant || !state || !state.isActive) {
      return {
        action: null,
        trace: { reason: 'inactive_or_missing_participant' },
        valueEstimate: 0,
        trainingRecord: null,
      };
    }

    if (participant.type === 'builtin') {
      return chooseBuiltinAction(participant.id, state, options);
    }

    if (!participant.snapshot || !participant.snapshot.modelBundle) {
      return {
        action: null,
        trace: { reason: 'snapshot_missing_model' },
        valueEstimate: 0,
        trainingRecord: null,
      };
    }

    return runHiddenInfoMcts(participant.snapshot.modelBundle, state, {
      rootPlayer: state.toMove,
      iterations: options.iterations,
      maxDepth: options.maxDepth,
      hypothesisCount: options.hypothesisCount,
      riskBias: options.riskBias,
      exploration: options.exploration,
    });
  }

  recordSimulationOnSnapshot(snapshot, stats = {}, asColor = WHITE) {
    if (!snapshot) return;
    snapshot.stats = snapshot.stats || {};
    snapshot.stats.simulations = (snapshot.stats.simulations || 0) + 1;
    snapshot.stats.games = (snapshot.stats.games || 0) + (stats.games || 0);
    snapshot.stats.whiteWins = (snapshot.stats.whiteWins || 0) + (stats.whiteWins || 0);
    snapshot.stats.blackWins = (snapshot.stats.blackWins || 0) + (stats.blackWins || 0);
    snapshot.stats.draws = (snapshot.stats.draws || 0) + (stats.draws || 0);
    snapshot.updatedAt = nowIso();
    snapshot.lastUsedAs = asColor === WHITE ? 'white' : 'black';
  }

  buildTrainingSamplesFromDecisions(decisions, winner) {
    const policySamples = [];
    const valueSamples = [];
    const identitySamples = [];

    const resultValueForPlayer = (player) => {
      if (winner === null || winner === undefined) return 0;
      return winner === player ? 1 : -1;
    };

    decisions.forEach((decision) => {
      if (!decision || !decision.trainingRecord) return;
      const record = decision.trainingRecord;
      const valueTarget = resultValueForPlayer(record.player);

      if (record.policy && Array.isArray(record.policy.features) && Array.isArray(record.policy.target)) {
        const actionKeys = Array.isArray(record.policy.actionKeys)
          ? record.policy.actionKeys
          : (Array.isArray(record.policy.moveKeys) ? record.policy.moveKeys : []);
        const selectedActionKey = record.policy.selectedActionKey
          || record.policy.selectedMoveKey
          || null;
        policySamples.push({
          snapshotId: record.snapshotId,
          player: record.player,
          features: record.policy.features.map((vector) => vector.slice()),
          target: record.policy.target.slice(),
          selectedActionKey,
          selectedMoveKey: selectedActionKey,
          actionKeys: actionKeys.slice(),
          moveKeys: actionKeys.slice(),
        });
      }

      if (record.value && Array.isArray(record.value.features)) {
        valueSamples.push({
          snapshotId: record.snapshotId,
          player: record.player,
          features: record.value.features.slice(),
          target: valueTarget,
        });
      }

      if (Array.isArray(record.identitySamples)) {
        record.identitySamples.forEach((sample) => {
          identitySamples.push({
            snapshotId: record.snapshotId,
            player: record.player,
            pieceId: sample.pieceId,
            trueIdentity: sample.trueIdentity,
            pieceFeatures: Array.isArray(sample.pieceFeatures)
              ? sample.pieceFeatures.slice()
              : null,
            featureByIdentity: deepClone(sample.featureByIdentity),
            probabilities: deepClone(sample.probabilities),
          });
        });
      }
    });

    return { policySamples, valueSamples, identitySamples };
  }

  getSimulationIndex(simulationId) {
    return (this.state.simulations || []).findIndex((simulation) => simulation.id === simulationId);
  }

  upsertSimulationRecord(simulation) {
    if (!simulation?.id) return null;
    const index = this.getSimulationIndex(simulation.id);
    if (index >= 0) {
      this.state.simulations.splice(index, 1);
    }
    this.state.simulations.unshift(simulation);
    if (this.state.simulations.length > this.maxSimulationHistory) {
      this.state.simulations.length = this.maxSimulationHistory;
    }
    return simulation;
  }

  getTrainingRunIndex(trainingRunId) {
    return (this.state.trainingRuns || []).findIndex((trainingRun) => trainingRun.id === trainingRunId);
  }

  upsertTrainingRunRecord(trainingRun) {
    if (!trainingRun?.id) return null;
    const index = this.getTrainingRunIndex(trainingRun.id);
    if (index >= 0) {
      this.state.trainingRuns.splice(index, 1);
    }
    this.state.trainingRuns.unshift(trainingRun);
    if (this.state.trainingRuns.length > 500) {
      this.state.trainingRuns.length = 500;
    }
    return trainingRun;
  }

  async runSingleGame(options = {}) {
    const whiteParticipant = options.whiteParticipant || null;
    const blackParticipant = options.blackParticipant || null;
    const whiteParticipantId = this.getDisplayParticipantId(whiteParticipant);
    const blackParticipantId = this.getDisplayParticipantId(blackParticipant);
    const whiteParticipantLabel = this.getDisplayParticipantLabel(whiteParticipant, whiteParticipantId);
    const blackParticipantLabel = this.getDisplayParticipantLabel(blackParticipant, blackParticipantId);
    const seed = Number.isFinite(options.seed) ? options.seed : Date.now();
    const maxPlies = clampPositiveInt(options.maxPlies, 120, 40, 300);
    const mctsOptions = {
      iterations: clampPositiveInt(options.iterations, 90, 10, 800),
      maxDepth: clampPositiveInt(options.maxDepth, 16, 4, 80),
      hypothesisCount: clampPositiveInt(options.hypothesisCount, 8, 1, 24),
      riskBias: normalizeFloat(options.riskBias, 0.75, 0, 3),
      exploration: normalizeFloat(options.exploration, 1.25, 0, 5),
    };
    const maxDecisionSafety = Math.max(maxPlies * 6, maxPlies + 24);

    const replay = [];
    const decisions = [];
    let forcedStopReason = null;
    const liveContext = await createApiBackedGame(seed);
    let liveGame = liveContext.game;
    let shadowState = createShadowStateFromLiveGame(liveGame, {
      maxPlies,
      seed,
      playablePly: 0,
      resetActionHistory: true,
    });

    replay.push(toReplayFrameFromGame(liveGame, {
      note: 'start',
      actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
      moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
    }));

    try {
      for (let step = 0; step < maxDecisionSafety; step += 1) {
        if (!liveGame || !liveGame.isActive || !shadowState || !shadowState.isActive) break;
        const currentPlayer = Number.isFinite(shadowState.playerTurn) ? shadowState.playerTurn : WHITE;
        const participant = currentPlayer === WHITE ? whiteParticipant : blackParticipant;
        const participantId = this.getDisplayParticipantId(participant);
        const participantLabel = this.getDisplayParticipantLabel(participant, participantId);

        if (!participant) {
          forcedStopReason = 'missing_participant';
          liveGame = await applyLiveActionToGame(liveContext, {
            type: 'RESIGN',
            player: currentPlayer,
          }, shadowState);
          replay.push(toReplayFrameFromGame(liveGame, {
            note: forcedStopReason,
            actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
            moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
          }));
          break;
        }

        const observationState = shadowState;
        const legalActions = getLegalActions(observationState, currentPlayer);
        if (!legalActions.length) {
          forcedStopReason = 'no_legal_actions';
          liveGame = await applyLiveActionToGame(liveContext, {
            type: 'RESIGN',
            player: currentPlayer,
          }, shadowState);
          replay.push(toReplayFrameFromGame(liveGame, {
            note: forcedStopReason,
            actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
            moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
          }));
          break;
        }

        const search = this.chooseActionForParticipant(participant, observationState, {
          ...mctsOptions,
          seed: seed + (decisions.length * 104729),
        });

        const legalByKey = new Map(legalActions.map((action) => [actionKey(action), action]));
        const requestedAction = search?.action || null;
        const requestedKey = requestedAction ? actionKey(requestedAction) : '';
        const primary = requestedKey && legalByKey.has(requestedKey)
          ? legalByKey.get(requestedKey)
          : null;

        const candidates = [];
        if (primary) candidates.push(primary);
        legalActions.forEach((action) => {
          if (!primary || actionKey(action) !== actionKey(primary)) {
            candidates.push(action);
          }
        });

        let executedAction = null;
        let nextLiveGame = liveGame;
        let nextShadowState = shadowState;
        const liveRejectedCandidates = [];

        for (let idx = 0; idx < candidates.length; idx += 1) {
          const candidate = candidates[idx];
          try {
            nextLiveGame = await applyLiveActionToGame(liveContext, candidate, shadowState);
          } catch (err) {
            liveRejectedCandidates.push({
              actionKey: actionKey(candidate),
              message: err.message || 'Action rejected',
            });
            continue;
          }

          const shadowCandidate = applyAction(shadowState, candidate);
          executedAction = candidate;
          nextShadowState = shadowCandidate === shadowState
            ? createShadowStateFromLiveGame(nextLiveGame, {
              maxPlies,
              seed,
              playablePly: decisions.length + 1,
            })
            : shadowCandidate;
          break;
        }

        if (!executedAction) {
          forcedStopReason = 'all_legal_actions_rejected';
          liveGame = await applyLiveActionToGame(liveContext, {
            type: 'RESIGN',
            player: currentPlayer,
          }, shadowState);
          replay.push(toReplayFrameFromGame(liveGame, {
            note: forcedStopReason,
            actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
            moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
            decision: {
              player: currentPlayer,
              participantId,
              participantLabel,
              snapshotId: participant.snapshotId || null,
              action: { type: 'RESIGN', player: currentPlayer },
              move: { type: 'RESIGN', player: currentPlayer },
              valueEstimate: 0,
              trace: {
                reason: forcedStopReason,
                liveRejectedCandidates,
              },
            },
          }));
          break;
        }

        const parity = compareLiveGameToShadowState(nextLiveGame, nextShadowState);
        if (!parity.ok) {
          nextShadowState = createShadowStateFromLiveGame(nextLiveGame, {
            maxPlies,
            seed,
            playablePly: decisions.length + 1,
          });
        }

        const executedKey = actionKey(executedAction);
        const useTrainingRecord = Boolean(requestedKey && executedKey === requestedKey);
        const decisionTrace = {
          ...deepClone(search?.trace || {}),
          liveRoute: {
            fallbackUsed: Boolean(requestedKey && executedKey && requestedKey !== executedKey),
            rejectedCandidates: liveRejectedCandidates,
            parityMismatches: parity.ok ? [] : parity.mismatches,
          },
        };
        const decision = {
          ply: decisions.length,
          player: currentPlayer,
          participantId,
          participantLabel,
          snapshotId: participant.snapshotId || null,
          action: deepClone(executedAction),
          move: deepClone(executedAction),
          trace: decisionTrace,
          valueEstimate: Number.isFinite(search?.valueEstimate) ? search.valueEstimate : 0,
          trainingRecord: useTrainingRecord && search?.trainingRecord
            ? {
              ...deepClone(search.trainingRecord),
              snapshotId: participant.snapshotId || null,
            }
            : null,
        };
        decisions.push(decision);
        liveGame = nextLiveGame;
        shadowState = nextShadowState;
        replay.push(toReplayFrameFromGame(liveGame, {
          actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
          moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
          decision,
        }));

        if (decisions.length >= maxPlies && liveGame.isActive) {
          forcedStopReason = 'max_plies';
          liveGame = await forceLiveGameDraw(liveContext);
          shadowState = createShadowStateFromLiveGame(liveGame, {
            maxPlies,
            seed,
            playablePly: decisions.length,
          });
          replay.push(toReplayFrameFromGame(liveGame, {
            note: forcedStopReason,
            actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
            moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
          }));
          break;
        }
      }

      if (liveGame && liveGame.isActive) {
        forcedStopReason = forcedStopReason || 'safety_stop';
        liveGame = await forceLiveGameDraw(liveContext);
        shadowState = createShadowStateFromLiveGame(liveGame, {
          maxPlies,
          seed,
          playablePly: decisions.length,
        });
        replay.push(toReplayFrameFromGame(liveGame, {
          note: forcedStopReason,
          actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
          moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
        }));
      }

      const winner = Number.isFinite(liveGame?.winner) ? liveGame.winner : null;
      const winReason = liveGame?.winReason ?? forcedStopReason ?? null;
      const training = this.buildTrainingSamplesFromDecisions(decisions, winner);
      const plies = decisions.length;

      return {
        id: this.nextId('game'),
        createdAt: nowIso(),
        seed,
        setupMode: 'live-route',
        whiteParticipantId,
        blackParticipantId,
        whiteParticipantLabel,
        blackParticipantLabel,
        winner,
        winReason,
        plies,
        actionHistory: Array.isArray(liveGame?.actions) ? deepClone(liveGame.actions) : [],
        moveHistory: Array.isArray(liveGame?.moves) ? deepClone(liveGame.moves) : [],
        replay,
        decisions,
        training,
        result: {
          whiteValue: winner === null ? 0 : (winner === WHITE ? 1 : -1),
          blackValue: winner === null ? 0 : (winner === BLACK ? 1 : -1),
        },
      };
    } finally {
      await cleanupApiBackedGame(liveContext);
    }
  }

  createSimulationAccumulator(participantA, participantB) {
    const participantResultById = {};
    [participantA, participantB].forEach((participant) => {
      const id = this.getDisplayParticipantId(participant);
      participantResultById[id] = {
        participantId: id,
        participantType: participant?.type || 'snapshot',
        snapshotId: participant?.snapshotId || null,
        label: this.getDisplayParticipantLabel(participant, id),
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        asWhite: 0,
        asBlack: 0,
        whiteWins: 0,
        blackWins: 0,
      };
    });

    return {
      stats: {
        games: 0,
        whiteWins: 0,
        blackWins: 0,
        draws: 0,
        averagePlies: 0,
        winReasons: {},
        participantResults: [],
      },
      participantResultById,
    };
  }

  applyGameToSimulationAccumulator(stats, participantResultById, game, whiteParticipant, blackParticipant) {
    if (!stats || !game) return;
    const previousGames = Number(stats.games || 0);
    const nextGames = previousGames + 1;
    stats.games = nextGames;
    stats.averagePlies = (
      ((Number(stats.averagePlies || 0) * previousGames) + Number(game.plies || 0))
      / nextGames
    );
    if (game.winner === WHITE) stats.whiteWins += 1;
    else if (game.winner === BLACK) stats.blackWins += 1;
    else stats.draws += 1;
    const reasonKey = String(game.winReason ?? 'unknown');
    stats.winReasons[reasonKey] = (stats.winReasons[reasonKey] || 0) + 1;

    const whiteId = game.whiteParticipantId || this.getDisplayParticipantId(whiteParticipant);
    const blackId = game.blackParticipantId || this.getDisplayParticipantId(blackParticipant);
    const whiteStats = participantResultById[whiteId];
    const blackStats = participantResultById[blackId];
    if (whiteStats) {
      whiteStats.games += 1;
      whiteStats.asWhite += 1;
    }
    if (blackStats) {
      blackStats.games += 1;
      blackStats.asBlack += 1;
    }
    if (game.winner === WHITE) {
      if (whiteStats) {
        whiteStats.wins += 1;
        whiteStats.whiteWins += 1;
      }
      if (blackStats) blackStats.losses += 1;
    } else if (game.winner === BLACK) {
      if (blackStats) {
        blackStats.wins += 1;
        blackStats.blackWins += 1;
      }
      if (whiteStats) whiteStats.losses += 1;
    } else {
      if (whiteStats) whiteStats.draws += 1;
      if (blackStats) blackStats.draws += 1;
    }
  }

  finalizeSimulationAccumulator(stats, participantResultById) {
    const normalizedStats = {
      ...(stats || {}),
      games: Number(stats?.games || 0),
      whiteWins: Number(stats?.whiteWins || 0),
      blackWins: Number(stats?.blackWins || 0),
      draws: Number(stats?.draws || 0),
      averagePlies: Number(stats?.averagePlies || 0),
      winReasons: deepClone(stats?.winReasons || {}),
    };
    normalizedStats.participantResults = Object.values(participantResultById || {}).map((entry) => (
      normalizeParticipantStatsEntry(entry, entry.games)
    ));
    return normalizedStats;
  }

  rebuildSimulationAccumulator(games, participantA, participantB) {
    const { stats, participantResultById } = this.createSimulationAccumulator(participantA, participantB);
    (Array.isArray(games) ? games : []).forEach((game) => {
      const whiteParticipant = game?.whiteParticipantId === this.getDisplayParticipantId(participantB)
        ? participantB
        : participantA;
      const blackParticipant = game?.blackParticipantId === this.getDisplayParticipantId(participantA)
        ? participantA
        : participantB;
      this.applyGameToSimulationAccumulator(stats, participantResultById, game, whiteParticipant, blackParticipant);
    });
    return {
      stats: this.finalizeSimulationAccumulator(stats, participantResultById),
      participantResultById,
    };
  }

  shouldCheckpointProgress(completedUnits, lastCheckpointAt, options = {}) {
    if (options.force === true) return true;
    const count = Number(completedUnits || 0);
    if (count <= 0) return false;
    if ((count % SIMULATION_CHECKPOINT_GAME_INTERVAL) === 0) return true;
    const elapsed = Date.now() - (Number(lastCheckpointAt || 0) || 0);
    return Number.isFinite(elapsed) && elapsed >= SIMULATION_CHECKPOINT_MS;
  }

  buildSimulationJobPayload(job, phase = null, overrides = {}) {
    const simulation = job?.simulationId ? this.getInMemorySimulation(job.simulationId) : null;
    const config = simulation?.config || job?.options || {};
    const requestedGameCount = Number(
      job?.checkpoint?.requestedGameCount
      || config.requestedGameCount
      || config.gameCount
      || simulation?.gameCount
      || 0
    );
    const completedGames = Number(
      overrides.completedGames
      ?? job?.checkpoint?.completedGames
      ?? simulation?.stats?.games
      ?? 0
    );
    const progress = requestedGameCount > 0 ? (completedGames / requestedGameCount) : 0;
    const inferredPhase = phase || (completedGames > 0 ? 'game' : 'start');
    return {
      phase: inferredPhase,
      taskId: job?.taskId || '',
      simulationId: job?.simulationId || simulation?.id || '',
      timestamp: nowIso(),
      label: simulation?.label || job?.label || job?.simulationId || '',
      gameCount: requestedGameCount,
      participantAId: simulation?.participantAId || job?.participantAId || null,
      participantBId: simulation?.participantBId || job?.participantBId || null,
      participantALabel: simulation?.participantALabel || job?.participantALabel || null,
      participantBLabel: simulation?.participantBLabel || job?.participantBLabel || null,
      alternateColors: Boolean(config.alternateColors),
      completedGames,
      progress: Math.max(0, Math.min(1, progress)),
      latestGameId: overrides.latestGameId || job?.checkpoint?.latestGameId || null,
      status: simulation?.status || job?.status || 'running',
      stats: deepClone(simulation?.stats || job?.checkpoint?.stats || {}),
      ...overrides,
    };
  }

  emitSimulationJobProgress(job, phase, overrides = {}) {
    const payload = this.buildSimulationJobPayload(job, phase, overrides);
    this.rememberLiveStatus('simulation', payload);
    eventBus.emit('ml:simulationProgress', payload);
    return payload;
  }

  async checkpointSimulationJob(job, simulation, options = {}) {
    if (!job || !simulation) return;
    const checkpointedAt = nowIso();
    simulation.updatedAt = checkpointedAt;
    simulation.status = options.status || simulation.status || 'running';
    simulation.config = {
      ...(simulation.config || {}),
      requestedGameCount: Number(job?.checkpoint?.requestedGameCount || simulation?.config?.requestedGameCount || 0),
      completedGameCount: Number(simulation?.stats?.games || simulation?.gameCount || 0),
    };
    simulation.gameCount = Number(simulation?.stats?.games || simulation?.gameCount || 0);
    simulation.persistence = {
      ...(simulation.persistence || {}),
      taskId: job.taskId,
      checkpointedAt,
    };

    job.updatedAt = checkpointedAt;
    job.status = simulation.status === 'stopping' ? 'stopping' : (options.jobStatus || 'running');
    job.checkpoint = {
      ...(job.checkpoint || {}),
      requestedGameCount: Number(job?.checkpoint?.requestedGameCount || simulation?.config?.requestedGameCount || 0),
      completedGames: Number(simulation?.stats?.games || simulation?.gameCount || 0),
      latestGameId: options.latestGameId || job?.checkpoint?.latestGameId || null,
      lastCheckpointAt: checkpointedAt,
      checkpointedAt,
      stats: deepClone(simulation.stats || {}),
    };

    const mongoPersistence = await this.persistSimulationToMongo(simulation, {
      gameIds: options.gameIds || null,
      pruneMissingGames: options.pruneMissingGames === true,
    });
    simulation.persistence.mongo = mongoPersistence;
    if (mongoPersistence?.saved) {
      simulation.gamesStoredExternally = true;
    }
    this.state.activeJobs.simulation = deepClone(job);
    this.upsertSimulationRecord(simulation.gamesStoredExternally
      ? compactSimulationForState(simulation)
      : simulation);
    await this.save();
  }

  resumeSimulationJob(jobRecord) {
    const job = jobRecord || this.state.activeJobs?.simulation;
    if (!job?.taskId || !job?.simulationId) return;
    if (this.simulationTasks.has(job.taskId)) return;
    const taskState = {
      id: job.taskId,
      status: 'running',
      cancelRequested: String(job.status || '').toLowerCase() === 'stopping',
    };
    this.simulationTasks.set(job.taskId, taskState);
    this.runSimulationJob(taskState).catch((err) => {
      console.error('[ml-runtime] simulation background job failed', err);
    });
  }

  async startSimulationJob(options = {}) {
    await this.ensureLoaded();
    const activeJob = this.state.activeJobs?.simulation || null;
    if (activeJob && String(activeJob.status || '').toLowerCase() === 'running') {
      const err = new Error('A simulation batch is already running');
      err.statusCode = 409;
      err.code = 'SIMULATION_ALREADY_RUNNING';
      throw err;
    }

    const participantA = this.resolveParticipant(
      options.whiteParticipantId || options.whiteSnapshotId,
      options.whiteSnapshotId || null,
    );
    const participantB = this.resolveParticipant(
      options.blackParticipantId || options.blackSnapshotId,
      options.blackSnapshotId || null,
    );
    if (!participantA || !participantB) {
      const err = new Error('Choose two valid controllers before starting a simulation batch');
      err.statusCode = 400;
      err.code = 'INVALID_SIMULATION_PARTICIPANTS';
      throw err;
    }

    const gameCount = clampPositiveInt(options.gameCount, 4, 1, 100000);
    const baseSeed = Number.isFinite(options.seed) ? Math.floor(options.seed) : Date.now();
    const participantAId = this.getDisplayParticipantId(participantA);
    const participantBId = this.getDisplayParticipantId(participantB);
    const participantALabel = this.getDisplayParticipantLabel(participantA, participantAId);
    const participantBLabel = this.getDisplayParticipantLabel(participantB, participantBId);
    const customLabel = typeof options.label === 'string' ? options.label.trim() : '';
    const labelBase = customLabel || `${participantALabel} vs ${participantBLabel}`;
    const label = await this.buildUniqueSimulationLabel(labelBase, {
      forceOrdinal: !customLabel,
    });
    const simulationId = this.nextId('simulation');
    const taskId = `simulation:${simulationId}`;
    const {
      stats,
      participantResultById,
    } = this.createSimulationAccumulator(participantA, participantB);
    const normalizedStats = this.finalizeSimulationAccumulator(stats, participantResultById);
    const simulation = {
      id: simulationId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      label,
      participantAId,
      participantBId,
      participantALabel,
      participantBLabel,
      whiteSnapshotId: participantA.snapshotId || null,
      blackSnapshotId: participantB.snapshotId || null,
      config: {
        gameCount,
        requestedGameCount: gameCount,
        completedGameCount: 0,
        maxPlies: clampPositiveInt(options.maxPlies, 120, 40, 300),
        iterations: clampPositiveInt(options.iterations, 90, 10, 800),
        maxDepth: clampPositiveInt(options.maxDepth, 16, 4, 80),
        hypothesisCount: clampPositiveInt(options.hypothesisCount, 8, 1, 24),
        riskBias: normalizeFloat(options.riskBias, 0.75, 0, 3),
        exploration: normalizeFloat(options.exploration, 1.25, 0, 5),
        alternateColors: Boolean(options.alternateColors),
        setupMode: 'random',
        seed: baseSeed,
      },
      stats: normalizedStats,
      games: [],
      gameCount: 0,
      gamesStoredExternally: false,
      status: 'running',
      persistence: {
        taskId,
      },
    };
    const job = {
      type: 'simulation',
      taskId,
      simulationId,
      status: 'running',
      createdAt: simulation.createdAt,
      updatedAt: simulation.updatedAt,
      label,
      participantAId,
      participantBId,
      participantALabel,
      participantBLabel,
      whiteSnapshotId: participantA.snapshotId || null,
      blackSnapshotId: participantB.snapshotId || null,
      options: {
        whiteParticipantId: participantAId,
        blackParticipantId: participantBId,
        whiteSnapshotId: participantA.snapshotId || null,
        blackSnapshotId: participantB.snapshotId || null,
        gameCount,
        maxPlies: simulation.config.maxPlies,
        iterations: simulation.config.iterations,
        maxDepth: simulation.config.maxDepth,
        hypothesisCount: simulation.config.hypothesisCount,
        riskBias: simulation.config.riskBias,
        exploration: simulation.config.exploration,
        alternateColors: simulation.config.alternateColors,
        seed: baseSeed,
        label,
      },
      checkpoint: {
        requestedGameCount: gameCount,
        completedGames: 0,
        latestGameId: null,
        lastCheckpointAt: simulation.updatedAt,
        checkpointedAt: simulation.updatedAt,
        stats: deepClone(normalizedStats),
      },
    };

    this.state.activeJobs.simulation = deepClone(job);
    this.upsertSimulationRecord(simulation);
    const mongoPersistence = await this.persistSimulationToMongo(simulation, { pruneMissingGames: true });
    simulation.persistence.mongo = mongoPersistence;
    if (mongoPersistence?.saved) {
      simulation.gamesStoredExternally = true;
      this.upsertSimulationRecord(simulation);
    }
    await this.save();
    this.emitSimulationJobProgress(job, 'start', {
      completedGames: 0,
      progress: 0,
      stats: deepClone(normalizedStats),
    });
    this.resumeSimulationJob(job);
    return {
      taskId,
      simulation: this.summarizeSimulation(simulation),
      live: this.buildSimulationJobPayload(job, 'start'),
    };
  }

  async runSimulationJob(taskState) {
    const job = this.state.activeJobs?.simulation || null;
    if (!job || job.taskId !== taskState?.id) {
      this.simulationTasks.delete(taskState?.id);
      return;
    }

    let simulation = this.getInMemorySimulation(job.simulationId);
    if (!simulation) {
      simulation = await this.getStoredSimulationById(job.simulationId);
      if (!simulation) {
        throw new Error(`Simulation ${job.simulationId} not found for resume`);
      }
      this.upsertSimulationRecord(simulation);
    }

    const participantA = this.resolveParticipant(
      job?.options?.whiteParticipantId || simulation.participantAId,
      job?.options?.whiteSnapshotId || simulation.whiteSnapshotId,
    );
    const participantB = this.resolveParticipant(
      job?.options?.blackParticipantId || simulation.participantBId,
      job?.options?.blackSnapshotId || simulation.blackSnapshotId,
    );
    if (!participantA || !participantB) {
      throw new Error('Could not resolve simulation participants while resuming the batch');
    }

    const requestedGameCount = clampPositiveInt(
      job?.checkpoint?.requestedGameCount || simulation?.config?.requestedGameCount || simulation?.config?.gameCount,
      1,
      1,
      100000,
    );
    const baseSeed = Number.isFinite(simulation?.config?.seed)
      ? Math.floor(simulation.config.seed)
      : Date.now();
    const alternateColors = Boolean(simulation?.config?.alternateColors);
    const games = Array.isArray(simulation.games) ? simulation.games : [];
    const rebuilt = this.rebuildSimulationAccumulator(games, participantA, participantB);
    let stats = rebuilt.stats;
    const participantResultById = rebuilt.participantResultById;
    simulation.stats = deepClone(stats);
    simulation.gameCount = stats.games;
    simulation.config = {
      ...(simulation.config || {}),
      requestedGameCount,
      completedGameCount: stats.games,
    };
    this.upsertSimulationRecord(simulation);

    this.emitSimulationJobProgress(job, stats.games > 0 ? 'game' : 'start', {
      completedGames: stats.games,
      progress: requestedGameCount > 0 ? (stats.games / requestedGameCount) : 0,
      stats: deepClone(stats),
    });

    let cancelled = false;
    let lastCheckpointAt = parseTimeValue(job?.checkpoint?.lastCheckpointAt) || Date.now();

    try {
      for (let gameIndex = stats.games; gameIndex < requestedGameCount; gameIndex += 1) {
        const latestJob = this.state.activeJobs?.simulation || null;
        if (!latestJob || latestJob.taskId !== job.taskId) break;
        if (taskState.cancelRequested || String(latestJob.status || '').toLowerCase() === 'stopping') {
          cancelled = true;
          break;
        }

        const shouldSwap = alternateColors && (gameIndex % 2 === 1);
        const whiteParticipant = shouldSwap ? participantB : participantA;
        const blackParticipant = shouldSwap ? participantA : participantB;
        const game = await this.runSingleGame({
          whiteParticipant,
          blackParticipant,
          seed: baseSeed + (gameIndex * 7919),
          maxPlies: simulation.config.maxPlies,
          iterations: simulation.config.iterations,
          maxDepth: simulation.config.maxDepth,
          hypothesisCount: simulation.config.hypothesisCount,
          riskBias: simulation.config.riskBias,
          exploration: simulation.config.exploration,
        });

        games.push(game);
        this.applyGameToSimulationAccumulator(stats, participantResultById, game, whiteParticipant, blackParticipant);
        stats = this.finalizeSimulationAccumulator(stats, participantResultById);
        simulation.games = games;
        simulation.stats = deepClone(stats);
        simulation.gameCount = stats.games;
        simulation.status = 'running';
        simulation.updatedAt = nowIso();
        simulation.config.completedGameCount = stats.games;
        job.updatedAt = simulation.updatedAt;
        job.checkpoint = {
          ...(job.checkpoint || {}),
          requestedGameCount,
          completedGames: stats.games,
          latestGameId: game.id,
          stats: deepClone(stats),
        };
        this.state.activeJobs.simulation = deepClone(job);
        this.upsertSimulationRecord(simulation.gamesStoredExternally
          ? compactSimulationForState(simulation)
          : simulation);

        this.emitSimulationJobProgress(job, 'game', {
          completedGames: stats.games,
          progress: requestedGameCount > 0 ? (stats.games / requestedGameCount) : 0,
          latestGameId: game.id,
          winner: game.winner,
          winReason: game.winReason,
          stats: deepClone(stats),
        });

        if (this.shouldCheckpointProgress(stats.games, lastCheckpointAt, {
          force: stats.games >= requestedGameCount,
        })) {
          await this.checkpointSimulationJob(job, simulation, {
            gameIds: [game.id],
            latestGameId: game.id,
          });
          lastCheckpointAt = Date.now();
        }

        await new Promise((resolve) => setImmediate(resolve));
      }

      simulation.status = cancelled ? 'stopped' : 'completed';
      simulation.updatedAt = nowIso();
      simulation.config.completedGameCount = stats.games;
      simulation.gameCount = stats.games;
      simulation.stats = deepClone(this.finalizeSimulationAccumulator(stats, participantResultById));
      if (!simulation.persistence?.snapshotStatsApplied) {
        if (participantA.type === 'snapshot' && participantA.snapshot) {
          this.recordSimulationOnSnapshot(participantA.snapshot, simulation.stats, WHITE);
        }
        if (participantB.type === 'snapshot' && participantB.snapshot) {
          this.recordSimulationOnSnapshot(participantB.snapshot, simulation.stats, BLACK);
        }
        simulation.persistence = {
          ...(simulation.persistence || {}),
          snapshotStatsApplied: true,
        };
      }
      await this.checkpointSimulationJob(job, simulation, {
        status: cancelled ? 'stopped' : 'completed',
        jobStatus: cancelled ? 'stopping' : 'completed',
        latestGameId: job?.checkpoint?.latestGameId || null,
        pruneMissingGames: true,
      });
      if (simulation.gamesStoredExternally) {
        this.upsertSimulationRecord(compactSimulationForState(simulation));
      } else {
        this.upsertSimulationRecord(simulation);
      }
      this.state.activeJobs.simulation = null;
      await this.save();
      if (simulation.gamesStoredExternally) {
        await this.trimMongoSimulationHistory();
      }

      const phase = cancelled ? 'cancelled' : 'complete';
      this.emitSimulationJobProgress({
        ...job,
        status: simulation.status,
        checkpoint: {
          ...(job.checkpoint || {}),
          completedGames: simulation.stats.games,
          stats: deepClone(simulation.stats),
        },
      }, phase, {
        completedGames: simulation.stats.games,
        progress: requestedGameCount > 0 ? (simulation.stats.games / requestedGameCount) : 0,
        stats: deepClone(simulation.stats),
        status: simulation.status,
      });
    } catch (err) {
      simulation.status = 'error';
      simulation.updatedAt = nowIso();
      simulation.persistence = {
        ...(simulation.persistence || {}),
        error: err?.message || 'Simulation failed',
      };
      this.upsertSimulationRecord(simulation.gamesStoredExternally
        ? compactSimulationForState(simulation)
        : simulation);
      await this.checkpointSimulationJob(job, simulation, {
        status: 'error',
        jobStatus: 'error',
        pruneMissingGames: false,
      }).catch(() => {});
      this.state.activeJobs.simulation = null;
      await this.save().catch(() => {});
      this.emitSimulationJobProgress(job, 'error', {
        completedGames: simulation?.stats?.games || 0,
        progress: requestedGameCount > 0 ? ((simulation?.stats?.games || 0) / requestedGameCount) : 0,
        stats: deepClone(simulation?.stats || {}),
        message: err.message || 'Simulation failed',
      });
      throw err;
    } finally {
      this.simulationTasks.delete(taskState?.id);
    }
  }

  async simulateMatches(options = {}) {
    await this.ensureLoaded();
    const participantA = this.resolveParticipant(
      options.whiteParticipantId || options.whiteSnapshotId,
      options.whiteSnapshotId || null,
    );
    const participantB = this.resolveParticipant(
      options.blackParticipantId || options.blackSnapshotId,
      options.blackSnapshotId || null,
    );
    if (!participantA || !participantB) {
      throw new Error('At least one snapshot is required to simulate games');
    }

    const gameCount = clampPositiveInt(options.gameCount, 4, 1, 100000);
    const baseSeed = Number.isFinite(options.seed) ? Math.floor(options.seed) : Date.now();
    const alternateColors = Boolean(options.alternateColors);
    const participantAId = this.getDisplayParticipantId(participantA);
    const participantBId = this.getDisplayParticipantId(participantB);
    const participantALabel = this.getDisplayParticipantLabel(participantA, participantAId);
    const participantBLabel = this.getDisplayParticipantLabel(participantB, participantBId);
    const customLabel = typeof options.label === 'string' ? options.label.trim() : '';
    const labelBase = customLabel || `${participantALabel} vs ${participantBLabel}`;
    const label = await this.buildUniqueSimulationLabel(labelBase, {
      forceOrdinal: !customLabel,
    });
    const simulationId = this.nextId('simulation');
    const taskId = `simulation-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const taskState = {
      id: taskId,
      status: 'running',
      cancelRequested: false,
      createdAt: nowIso(),
    };
    this.simulationTasks.set(taskId, taskState);
    const emitSimulationProgress = (phase, payload = {}) => {
      eventBus.emit('ml:simulationProgress', {
        phase,
        taskId,
        simulationId,
        timestamp: nowIso(),
        label,
        gameCount,
        participantAId,
        participantBId,
        participantALabel,
        participantBLabel,
        alternateColors,
        ...payload,
      });
    };

    const games = [];
    const participantResultById = {};
    [participantA, participantB].forEach((participant) => {
      const id = this.getDisplayParticipantId(participant);
      participantResultById[id] = {
        participantId: id,
        participantType: participant.type || 'snapshot',
        snapshotId: participant.snapshotId || null,
        label: this.getDisplayParticipantLabel(participant, id),
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        asWhite: 0,
        asBlack: 0,
        whiteWins: 0,
        blackWins: 0,
      };
    });

    const stats = {
      games: 0,
      whiteWins: 0,
      blackWins: 0,
      draws: 0,
      averagePlies: 0,
      winReasons: {},
      participantResults: [],
    };

    emitSimulationProgress('start', {
      completedGames: 0,
      progress: 0,
      stats: {
        games: 0,
        whiteWins: 0,
        blackWins: 0,
        draws: 0,
        averagePlies: 0,
      },
    });

    try {
      let cancelled = false;
      for (let i = 0; i < gameCount; i += 1) {
        if (taskState.cancelRequested) {
          cancelled = true;
          break;
        }
        const shouldSwap = alternateColors && (i % 2 === 1);
        const whiteParticipant = shouldSwap ? participantB : participantA;
        const blackParticipant = shouldSwap ? participantA : participantB;
        const game = await this.runSingleGame({
          whiteParticipant,
          blackParticipant,
          seed: baseSeed + (i * 7919),
          maxPlies: options.maxPlies,
          iterations: options.iterations,
          maxDepth: options.maxDepth,
          hypothesisCount: options.hypothesisCount,
          riskBias: options.riskBias,
          exploration: options.exploration,
        });
        games.push(game);
        stats.games += 1;
        stats.averagePlies += game.plies;
        if (game.winner === WHITE) stats.whiteWins += 1;
        else if (game.winner === BLACK) stats.blackWins += 1;
        else stats.draws += 1;
        const reasonKey = String(game.winReason ?? 'unknown');
        stats.winReasons[reasonKey] = (stats.winReasons[reasonKey] || 0) + 1;

        const whiteId = game.whiteParticipantId || this.getDisplayParticipantId(whiteParticipant);
        const blackId = game.blackParticipantId || this.getDisplayParticipantId(blackParticipant);
        const whiteStats = participantResultById[whiteId];
        const blackStats = participantResultById[blackId];
        if (whiteStats) {
          whiteStats.games += 1;
          whiteStats.asWhite += 1;
        }
        if (blackStats) {
          blackStats.games += 1;
          blackStats.asBlack += 1;
        }
        if (game.winner === WHITE) {
          if (whiteStats) {
            whiteStats.wins += 1;
            whiteStats.whiteWins += 1;
          }
          if (blackStats) {
            blackStats.losses += 1;
          }
        } else if (game.winner === BLACK) {
          if (blackStats) {
            blackStats.wins += 1;
            blackStats.blackWins += 1;
          }
          if (whiteStats) {
            whiteStats.losses += 1;
          }
        } else {
          if (whiteStats) whiteStats.draws += 1;
          if (blackStats) blackStats.draws += 1;
        }

        emitSimulationProgress('game', {
          completedGames: i + 1,
          progress: (i + 1) / gameCount,
          latestGameId: game.id,
          winner: game.winner,
          winReason: game.winReason,
          stats: {
            games: stats.games,
            whiteWins: stats.whiteWins,
            blackWins: stats.blackWins,
            draws: stats.draws,
            averagePlies: stats.games > 0 ? (stats.averagePlies / stats.games) : 0,
          },
        });

        await new Promise((resolve) => setImmediate(resolve));
      }

      stats.averagePlies = stats.games > 0 ? (stats.averagePlies / stats.games) : 0;
      stats.participantResults = Object.values(participantResultById).map((entry) => (
        normalizeParticipantStatsEntry(entry, entry.games)
      ));

      const simulation = {
        id: simulationId,
        createdAt: nowIso(),
        label,
        participantAId,
        participantBId,
        participantALabel,
        participantBLabel,
        whiteSnapshotId: participantA.snapshotId || null,
        blackSnapshotId: participantB.snapshotId || null,
        config: {
          gameCount,
          requestedGameCount: gameCount,
          completedGameCount: stats.games,
          maxPlies: clampPositiveInt(options.maxPlies, 120, 40, 300),
          iterations: clampPositiveInt(options.iterations, 90, 10, 800),
          maxDepth: clampPositiveInt(options.maxDepth, 16, 4, 80),
          hypothesisCount: clampPositiveInt(options.hypothesisCount, 8, 1, 24),
          riskBias: normalizeFloat(options.riskBias, 0.75, 0, 3),
          exploration: normalizeFloat(options.exploration, 1.25, 0, 5),
          alternateColors,
          setupMode: 'random',
          seed: baseSeed,
        },
        stats,
        games,
        gameCount: stats.games,
        gamesStoredExternally: false,
        status: cancelled ? 'stopped' : 'completed',
      };

      const mongoPersistence = await this.persistSimulationToMongo(simulation);
      simulation.persistence = {
        ...(simulation.persistence || {}),
        mongo: mongoPersistence,
      };
      simulation.gamesStoredExternally = Boolean(mongoPersistence?.saved);
      if (mongoPersistence?.saved) {
        await this.trimMongoSimulationHistory();
      }

      const simulationForState = simulation.gamesStoredExternally
        ? {
            ...simulation,
            games: games.map((game) => summarizeGameForStorage(game)).filter(Boolean),
          }
        : simulation;

      this.state.simulations.unshift(simulationForState);
      if (this.state.simulations.length > this.maxSimulationHistory) {
        this.state.simulations.length = this.maxSimulationHistory;
      }

      if (participantA.type === 'snapshot' && participantA.snapshot) {
        this.recordSimulationOnSnapshot(participantA.snapshot, stats, WHITE);
      }
      if (participantB.type === 'snapshot' && participantB.snapshot) {
        this.recordSimulationOnSnapshot(participantB.snapshot, stats, BLACK);
      }

      await this.save();

      if (cancelled) {
        emitSimulationProgress('cancelled', {
          completedGames: stats.games,
          progress: gameCount > 0 ? (stats.games / gameCount) : 0,
          stats: deepClone(stats),
        });
      } else {
        emitSimulationProgress('complete', {
          completedGames: gameCount,
          progress: 1,
          stats: deepClone(stats),
        });
      }

      return {
        simulation: this.summarizeSimulation(simulation),
        stats,
        participantResults: stats.participantResults,
        gameIds: games.map((game) => game.id),
        cancelled,
        requestedGameCount: gameCount,
        persistence: deepClone(simulation.persistence || null),
      };
    } catch (err) {
      emitSimulationProgress('error', {
        completedGames: stats.games,
        progress: gameCount > 0 ? (stats.games / gameCount) : 0,
        message: err.message || 'Simulation failed',
      });
      throw err;
    } finally {
      taskState.status = taskState.cancelRequested ? 'stopped' : 'complete';
      this.simulationTasks.delete(taskId);
    }
  }

  async listSimulations(options = {}) {
    await this.ensureLoaded();
    const simulations = await this.listStoredSimulations({ limit: options.limit });
    return simulations
      .map((simulation) => this.summarizeSimulation(simulation));
  }

  async renameSimulation(simulationId, nextLabel) {
    await this.ensureLoaded();
    const id = typeof simulationId === 'string' ? simulationId.trim() : '';
    const label = typeof nextLabel === 'string' ? nextLabel.trim() : '';
    if (!id) {
      const err = new Error('Simulation id is required');
      err.statusCode = 400;
      err.code = 'INVALID_SIMULATION_ID';
      throw err;
    }
    if (!label) {
      const err = new Error('Simulation label is required');
      err.statusCode = 400;
      err.code = 'INVALID_SIMULATION_LABEL';
      throw err;
    }

    let renamed = null;
    const memorySimulation = this.getInMemorySimulation(id);
    if (memorySimulation) {
      memorySimulation.label = label;
      memorySimulation.updatedAt = nowIso();
      renamed = memorySimulation;
    }

    if (this.isMongoSimulationPersistenceAvailable()) {
      await this.maybeMigrateStateSimulationsToMongo();
      const updatedAt = nowIso();
      const result = await SimulationModel.updateOne(
        { id },
        { $set: { label, updatedAt } },
      );
      const matched = Number(result?.matchedCount || 0);
      if (matched > 0) {
        if (!renamed) {
          const doc = await SimulationModel.findOne({ id }, { _id: 0, __v: 0 }).lean();
          renamed = doc ? this.normalizeStoredSimulationRecord(doc) : renamed;
        } else {
          renamed.updatedAt = updatedAt;
        }
      }
    }

    if (renamed && memorySimulation) {
      await this.save();
    }

    return renamed ? this.summarizeSimulation(renamed) : null;
  }

  async deleteSimulation(simulationId) {
    await this.ensureLoaded();
    const id = typeof simulationId === 'string' ? simulationId.trim() : '';
    if (!id) return { deleted: false };

    const mongoAvailable = this.isMongoSimulationPersistenceAvailable();
    let mongoSimulationDeleted = 0;
    let mongoGameDeleted = 0;
    let deleted = false;

    if (mongoAvailable) {
      await this.maybeMigrateStateSimulationsToMongo();
      const simulationDelete = await SimulationModel.deleteOne({ id });
      const gameDelete = await SimulationGameModel.deleteMany({ simulationId: id });
      mongoSimulationDeleted = Number(simulationDelete?.deletedCount || 0);
      mongoGameDeleted = Number(gameDelete?.deletedCount || 0);
      if ((mongoSimulationDeleted + mongoGameDeleted) > 0) {
        deleted = true;
      }
    }

    const before = Array.isArray(this.state.simulations) ? this.state.simulations.length : 0;
    this.state.simulations = (this.state.simulations || []).filter((simulation) => simulation.id !== id);
    const removedFromMemory = (this.state.simulations || []).length < before;
    if (removedFromMemory) {
      deleted = true;
    }

    if (removedFromMemory) {
      await this.save();
    }

    return {
      deleted,
      id,
      removedFromMemory,
      mongoSimulationDeleted,
      mongoGameDeleted,
    };
  }

  async stopSimulationTask(taskId) {
    await this.ensureLoaded();
    const id = typeof taskId === 'string' ? taskId.trim() : '';
    if (!id) {
      return { stopped: false, reason: 'missing_task_id' };
    }
    const activeJob = this.state.activeJobs?.simulation || null;
    if (!activeJob || activeJob.taskId !== id) {
      const legacyTask = this.simulationTasks.get(id);
      if (!legacyTask || legacyTask.status !== 'running') {
        return { stopped: false, reason: 'not_running', taskId: id };
      }
      legacyTask.cancelRequested = true;
      legacyTask.cancelRequestedAt = nowIso();
      return { stopped: true, taskId: id };
    }
    const task = this.simulationTasks.get(id);
    if (task) {
      task.cancelRequested = true;
      task.cancelRequestedAt = nowIso();
    }
    activeJob.status = 'stopping';
    activeJob.updatedAt = nowIso();
    this.state.activeJobs.simulation = deepClone(activeJob);
    const simulation = this.getInMemorySimulation(activeJob.simulationId);
    if (simulation) {
      simulation.status = 'stopping';
      simulation.updatedAt = activeJob.updatedAt;
      simulation.persistence = {
        ...(simulation.persistence || {}),
        stopRequestedAt: activeJob.updatedAt,
      };
      this.upsertSimulationRecord(simulation);
      await this.checkpointSimulationJob(activeJob, simulation, {
        status: 'stopping',
        jobStatus: 'stopping',
        pruneMissingGames: false,
      }).catch(() => {});
    } else {
      await this.save();
    }
    return { stopped: true, taskId: id };
  }

  async getSimulation(simulationId) {
    await this.ensureLoaded();
    const simulation = await this.getStoredSimulationById(simulationId);
    if (!simulation) return null;

    let games = Array.isArray(simulation.games) ? simulation.games : [];
    if (simulation.gamesStoredExternally && this.isMongoSimulationPersistenceAvailable()) {
      const gameDocs = await SimulationGameModel.find(
        { simulationId: simulation.id },
        {
          _id: 0,
          __v: 0,
          replay: 0,
          decisions: 0,
          actionHistory: 0,
          moveHistory: 0,
          training: 0,
          result: 0,
        },
      )
        .sort({ createdAt: 1 })
        .lean();
      if (Array.isArray(gameDocs) && gameDocs.length) {
        games = gameDocs
          .map((gameDoc) => this.normalizeStoredSimulationRecord(gameDoc))
          .filter(Boolean);
      }
    }

    return {
      ...this.summarizeSimulation(simulation),
      games: games.map((game) => ({
        id: game.id,
        createdAt: game.createdAt,
        seed: game.seed,
        setupMode: game.setupMode || 'random',
        whiteParticipantId: game.whiteParticipantId || null,
        blackParticipantId: game.blackParticipantId || null,
        whiteParticipantLabel: game.whiteParticipantLabel || null,
        blackParticipantLabel: game.blackParticipantLabel || null,
        winner: game.winner,
        winReason: game.winReason,
        plies: game.plies,
        decisionCount: Number.isFinite(game.decisionCount)
          ? game.decisionCount
          : (Array.isArray(game.decisions) ? game.decisions.length : 0),
      })),
    };
  }

  async getReplay(simulationId, gameId) {
    await this.ensureLoaded();
    const simulation = await this.getStoredSimulationById(simulationId);
    if (!simulation) return null;
    const simulationGames = Array.isArray(simulation.games) ? simulation.games : [];
    let game = simulationGames.find((item) => item.id === gameId);
    const hasDetailedReplay = game && (
      Array.isArray(game.replay)
      || Array.isArray(game.decisions)
      || Array.isArray(game.actionHistory)
      || Array.isArray(game.moveHistory)
    );

    if ((!game || !hasDetailedReplay) && simulation.gamesStoredExternally && this.isMongoSimulationPersistenceAvailable()) {
      const doc = await SimulationGameModel.findOne(
        { simulationId: simulation.id, id: gameId },
        { _id: 0, __v: 0 },
      ).lean();
      if (doc) {
        game = this.normalizeStoredSimulationRecord(doc);
      }
    }

    if (!game) return null;
    if (!Array.isArray(game.replay)) return null;

    return deepClone({
      simulation: this.summarizeSimulation(simulation),
      game: {
        id: game.id,
        createdAt: game.createdAt,
        seed: game.seed,
        setupMode: game.setupMode || 'random',
        whiteParticipantId: game.whiteParticipantId || null,
        blackParticipantId: game.blackParticipantId || null,
        whiteParticipantLabel: game.whiteParticipantLabel || null,
        blackParticipantLabel: game.blackParticipantLabel || null,
        winner: game.winner,
        winReason: game.winReason,
        plies: game.plies,
        actionHistory: game.actionHistory || [],
        moveHistory: game.moveHistory || [],
        replay: game.replay || [],
        decisions: game.decisions || [],
      },
    });
  }

  async collectTrainingSamples(snapshotId, simulationIds = null) {
    await this.ensureLoaded();
    const simulations = await this.listStoredSimulationsForTraining(simulationIds);
    const policySamples = [];
    const valueSamples = [];
    const identitySamples = [];
    let sourceGames = 0;
    let sourceSimulations = 0;

    simulations.forEach((simulation) => {
      sourceSimulations += 1;
      (simulation.games || []).forEach((game) => {
        sourceGames += 1;
        (game.training?.policySamples || []).forEach((sample) => {
          if (!snapshotId || sample.snapshotId === snapshotId) {
            policySamples.push(deepClone(sample));
          }
        });
        (game.training?.valueSamples || []).forEach((sample) => {
          if (!snapshotId || sample.snapshotId === snapshotId) {
            valueSamples.push(deepClone(sample));
          }
        });
        (game.training?.identitySamples || []).forEach((sample) => {
          if (!snapshotId || sample.snapshotId === snapshotId) {
            identitySamples.push(deepClone(sample));
          }
        });
      });
    });

    return {
      sourceSimulations,
      sourceGames,
      policySamples,
      valueSamples,
      identitySamples,
    };
  }

  buildTrainingJobPayload(job, phase = null, overrides = {}) {
    const trainingRun = job?.trainingRunId ? this.getInMemoryTrainingRun(job.trainingRunId) : null;
    const history = Array.isArray(overrides.history)
      ? overrides.history
      : (Array.isArray(trainingRun?.history) ? trainingRun.history : []);
    const completedEpochs = Number(
      overrides.epoch
      ?? overrides.completedEpochs
      ?? job?.checkpoint?.completedEpochs
      ?? history.length
      ?? 0
    );
    const totalEpochs = Number(job?.epochs || trainingRun?.epochs || 0);
    const inferredPhase = phase || (completedEpochs > 0 ? 'epoch' : 'start');
    const latestLoss = overrides.loss
      || trainingRun?.finalLoss
      || (history.length ? history[history.length - 1] : null)
      || null;
    return {
      phase: inferredPhase,
      taskId: job?.taskId || '',
      trainingRunId: job?.trainingRunId || trainingRun?.id || '',
      timestamp: nowIso(),
      baseSnapshotId: job?.baseSnapshotId || trainingRun?.baseSnapshotId || null,
      newSnapshotId: trainingRun?.newSnapshotId || null,
      epochs: totalEpochs,
      totalEpochs,
      epoch: completedEpochs,
      learningRate: Number(job?.learningRate || trainingRun?.learningRate || 0),
      sourceSimulationIds: Array.isArray(job?.sourceSimulationIds)
        ? job.sourceSimulationIds.slice()
        : (Array.isArray(trainingRun?.sourceSimulationIds) ? trainingRun.sourceSimulationIds.slice() : []),
      sourceGames: Number(job?.sourceGames || trainingRun?.sourceGames || 0),
      sourceSimulations: Number(job?.sourceSimulations || trainingRun?.sourceSimulations || 0),
      sampleCounts: deepClone(job?.sampleCounts || trainingRun?.sampleCounts || {}),
      loss: latestLoss ? deepClone(latestLoss) : null,
      history: deepClone(history),
      status: trainingRun?.status || job?.status || 'running',
      ...overrides,
    };
  }

  emitTrainingJobProgress(job, phase, overrides = {}) {
    const payload = this.buildTrainingJobPayload(job, phase, overrides);
    this.rememberLiveStatus('training', payload);
    eventBus.emit('ml:trainingProgress', payload);
    return payload;
  }

  async checkpointTrainingJob(job, trainingRun, options = {}) {
    if (!job || !trainingRun) return;
    const checkpointedAt = nowIso();
    trainingRun.updatedAt = checkpointedAt;
    trainingRun.status = options.status || trainingRun.status || 'running';
    trainingRun.finalLoss = trainingRun.finalLoss || (
      Array.isArray(trainingRun.history) && trainingRun.history.length
        ? trainingRun.history[trainingRun.history.length - 1]
        : null
    );
    trainingRun.checkpoint = {
      taskId: job.taskId,
      completedEpochs: Number(job?.checkpoint?.completedEpochs || trainingRun.history?.length || 0),
      totalEpochs: Number(job?.epochs || trainingRun.epochs || 0),
      checkpointedAt,
    };

    job.updatedAt = checkpointedAt;
    job.status = options.jobStatus || trainingRun.status || 'running';
    job.checkpoint = {
      ...(job.checkpoint || {}),
      completedEpochs: Number(job?.checkpoint?.completedEpochs || trainingRun.history?.length || 0),
      totalEpochs: Number(job?.epochs || trainingRun.epochs || 0),
      checkpointedAt,
      lastLoss: trainingRun.finalLoss ? deepClone(trainingRun.finalLoss) : null,
    };

    this.state.activeJobs.training = deepClone(job);
    this.upsertTrainingRunRecord(trainingRun);

    const mongoPersistence = await this.persistTrainingRunToMongo({
      ...trainingRun,
      checkpoint: {
        ...deepClone(trainingRun.checkpoint || {}),
        modelBundle: deepClone(job?.checkpoint?.modelBundle || null),
        optimizerState: deepClone(job?.checkpoint?.optimizerState || null),
      },
    }, {
      includeCheckpointArtifacts: options.includeCheckpointArtifacts === true,
    });
    trainingRun.persistence = {
      ...(trainingRun.persistence || {}),
      mongo: mongoPersistence,
    };
    await this.save();
  }

  resumeTrainingJob(jobRecord) {
    const job = jobRecord || this.state.activeJobs?.training;
    if (!job?.taskId || !job?.trainingRunId) return;
    if (this.trainingTasks.has(job.taskId)) return;
    const taskState = {
      id: job.taskId,
      status: 'running',
    };
    this.trainingTasks.set(job.taskId, taskState);
    this.runTrainingJob(taskState).catch((err) => {
      console.error('[ml-runtime] training background job failed', err);
    });
  }

  async startTrainingJob(options = {}) {
    await this.ensureLoaded();
    const activeJob = this.state.activeJobs?.training || null;
    if (activeJob && String(activeJob.status || '').toLowerCase() === 'running') {
      const err = new Error('A training run is already active');
      err.statusCode = 409;
      err.code = 'TRAINING_ALREADY_RUNNING';
      throw err;
    }

    const baseSnapshot = this.resolveSnapshot(options.snapshotId);
    if (!baseSnapshot) {
      const err = new Error('Snapshot not found for training');
      err.code = 'SNAPSHOT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    const epochs = clampPositiveInt(options.epochs, 2, 1, 50);
    const learningRate = normalizeFloat(options.learningRate, 0.01, 0.0001, 0.5);
    const simulationIds = Array.isArray(options.simulationIds)
      ? options.simulationIds.filter(Boolean)
      : null;
    const samples = await this.collectTrainingSamples(baseSnapshot.id, simulationIds);
    if (!samples.policySamples.length && !samples.valueSamples.length && !samples.identitySamples.length) {
      const err = new Error(
        'No training samples found for the selected snapshot/simulations. '
        + 'Select runs where that snapshot actually played (not builtin-vs-builtin only).',
      );
      err.code = 'NO_TRAINING_SAMPLES';
      err.statusCode = 400;
      err.details = {
        snapshotId: baseSnapshot.id,
        simulationIds: simulationIds || [],
        sourceSimulations: samples.sourceSimulations,
        sourceGames: samples.sourceGames,
      };
      throw err;
    }

    const sampleCounts = {
      policy: samples.policySamples.length,
      value: samples.valueSamples.length,
      identity: samples.identitySamples.length,
    };
    const trainingRunId = this.nextId('training');
    const taskId = `training:${trainingRunId}`;
    const checkpointBundle = cloneModelBundle(baseSnapshot.modelBundle);
    const checkpointOptimizer = createOptimizerState(checkpointBundle);
    const createdAt = nowIso();
    const trainingRun = {
      id: trainingRunId,
      createdAt,
      updatedAt: createdAt,
      status: 'running',
      label: options.label || '',
      notes: options.notes || '',
      baseSnapshotId: baseSnapshot.id,
      newSnapshotId: null,
      epochs,
      learningRate,
      sourceSimulationIds: simulationIds || [],
      sourceGames: samples.sourceGames,
      sourceSimulations: samples.sourceSimulations,
      sampleCounts,
      history: [],
      finalLoss: null,
      checkpoint: {
        taskId,
        completedEpochs: 0,
        totalEpochs: epochs,
        checkpointedAt: createdAt,
      },
    };
    const job = {
      type: 'training',
      taskId,
      trainingRunId,
      status: 'running',
      createdAt,
      updatedAt: createdAt,
      baseSnapshotId: baseSnapshot.id,
      epochs,
      learningRate,
      sourceSimulationIds: simulationIds || [],
      sourceGames: samples.sourceGames,
      sourceSimulations: samples.sourceSimulations,
      sampleCounts,
      label: trainingRun.label,
      notes: trainingRun.notes,
      checkpoint: {
        completedEpochs: 0,
        totalEpochs: epochs,
        checkpointedAt: createdAt,
        modelBundle: checkpointBundle,
        optimizerState: checkpointOptimizer,
      },
    };

    this.state.activeJobs.training = deepClone(job);
    this.upsertTrainingRunRecord(trainingRun);
    await this.persistTrainingRunToMongo({
      ...trainingRun,
      checkpoint: {
        ...deepClone(trainingRun.checkpoint || {}),
        modelBundle: checkpointBundle,
        optimizerState: checkpointOptimizer,
      },
    }, {
      includeCheckpointArtifacts: true,
    });
    await this.save();
    this.emitTrainingJobProgress(job, 'start', {
      sourceGames: samples.sourceGames,
      sourceSimulations: samples.sourceSimulations,
      history: [],
    });
    this.resumeTrainingJob(job);
    return {
      taskId,
      trainingRun: this.summarizeTrainingRun(trainingRun),
      live: this.buildTrainingJobPayload(job, 'start'),
    };
  }

  async runTrainingJob(taskState) {
    const job = this.state.activeJobs?.training || null;
    if (!job || job.taskId !== taskState?.id) {
      this.trainingTasks.delete(taskState?.id);
      return;
    }

    const trainingRun = this.getInMemoryTrainingRun(job.trainingRunId);
    if (!trainingRun) {
      throw new Error(`Training run ${job.trainingRunId} not found for resume`);
    }

    const baseSnapshot = this.getSnapshotById(job.baseSnapshotId);
    if (!baseSnapshot) {
      throw new Error(`Base snapshot ${job.baseSnapshotId} is missing`);
    }

    const samples = await this.collectTrainingSamples(baseSnapshot.id, job.sourceSimulationIds || null);
    if (!samples.policySamples.length && !samples.valueSamples.length && !samples.identitySamples.length) {
      throw new Error('Training samples disappeared before the run could resume');
    }

    let trainedBundle = job?.checkpoint?.modelBundle
      ? cloneModelBundle(job.checkpoint.modelBundle)
      : cloneModelBundle(baseSnapshot.modelBundle);
    let optimizerState = job?.checkpoint?.optimizerState
      ? deepClone(job.checkpoint.optimizerState)
      : createOptimizerState(trainedBundle);
    let completedEpochs = Number(job?.checkpoint?.completedEpochs || trainingRun.history.length || 0);

    this.emitTrainingJobProgress(job, completedEpochs > 0 ? 'epoch' : 'start', {
      epoch: completedEpochs,
      totalEpochs: job.epochs,
      history: deepClone(trainingRun.history || []),
      loss: trainingRun.finalLoss || null,
    });

    try {
      for (let epoch = completedEpochs; epoch < job.epochs; epoch += 1) {
        const policy = trainPolicyModel(trainedBundle, samples.policySamples, {
          learningRate: job.learningRate,
          optimizerState: optimizerState.policy,
        });
        const value = trainValueModel(trainedBundle, samples.valueSamples, {
          learningRate: job.learningRate,
          optimizerState: optimizerState.value,
        });
        const identity = trainIdentityModel(trainedBundle, samples.identitySamples, {
          learningRate: job.learningRate,
          optimizerState: optimizerState.identity,
        });
        optimizerState = {
          policy: policy.optimizerState || optimizerState.policy,
          value: value.optimizerState || optimizerState.value,
          identity: identity.optimizerState || optimizerState.identity,
        };

        const epochLoss = {
          epoch: epoch + 1,
          policyLoss: policy.loss,
          valueLoss: value.loss,
          identityLoss: identity.loss,
          identityAccuracy: identity.accuracy,
          policySamples: policy.samples,
          valueSamples: value.samples,
          identitySamples: identity.samples,
        };
        trainingRun.history.push(epochLoss);
        trainingRun.finalLoss = epochLoss;
        trainingRun.updatedAt = nowIso();
        trainingRun.status = 'running';
        completedEpochs = epoch + 1;
        job.updatedAt = trainingRun.updatedAt;
        job.checkpoint = {
          ...(job.checkpoint || {}),
          completedEpochs,
          totalEpochs: job.epochs,
          checkpointedAt: trainingRun.updatedAt,
          modelBundle: cloneModelBundle(trainedBundle),
          optimizerState: deepClone(optimizerState),
        };

        await this.checkpointTrainingJob(job, trainingRun, {
          includeCheckpointArtifacts: true,
        });
        this.emitTrainingJobProgress(job, 'epoch', {
          epoch: completedEpochs,
          totalEpochs: job.epochs,
          history: deepClone(trainingRun.history),
          loss: epochLoss,
        });
        await new Promise((resolve) => setImmediate(resolve));
      }

      const latestLoss = trainingRun.finalLoss || (trainingRun.history.length
        ? trainingRun.history[trainingRun.history.length - 1]
        : null);
      const lossRecord = {
        timestamp: nowIso(),
        learningRate: job.learningRate,
        epochs: job.epochs,
        sourceSimulations: trainingRun.sourceSimulations,
        sourceGames: trainingRun.sourceGames,
        history: trainingRun.history.map((entry) => ({ ...entry })),
        ...(latestLoss || {}),
      };

      const newSnapshot = this.createSnapshotRecord({
        label: trainingRun.label || `${baseSnapshot.label} -> trained`,
        generation: (baseSnapshot.generation || 0) + 1,
        parentSnapshotId: baseSnapshot.id,
        modelBundle: trainedBundle,
        notes: trainingRun.notes || `Trained from ${trainingRun.sourceGames} game(s)`,
        stats: {
          ...baseSnapshot.stats,
          trainingRuns: (baseSnapshot.stats?.trainingRuns || 0) + 1,
        },
        losses: [
          ...(baseSnapshot.losses || []),
          lossRecord,
        ],
      });
      this.state.snapshots.unshift(newSnapshot);
      baseSnapshot.stats = baseSnapshot.stats || {};
      baseSnapshot.stats.trainingRuns = (baseSnapshot.stats.trainingRuns || 0) + 1;
      baseSnapshot.updatedAt = nowIso();

      trainingRun.newSnapshotId = newSnapshot.id;
      trainingRun.status = 'completed';
      trainingRun.updatedAt = nowIso();
      trainingRun.finalLoss = latestLoss;
      trainingRun.checkpoint = {
        taskId: job.taskId,
        completedEpochs: completedEpochs,
        totalEpochs: job.epochs,
        checkpointedAt: trainingRun.updatedAt,
      };
      this.upsertTrainingRunRecord(trainingRun);
      await this.persistTrainingRunToMongo(trainingRun, {
        includeCheckpointArtifacts: false,
      });
      this.state.activeJobs.training = null;
      await this.save();

      this.emitTrainingJobProgress(job, 'complete', {
        epoch: completedEpochs,
        totalEpochs: job.epochs,
        trainingRunId: trainingRun.id,
        newSnapshotId: newSnapshot.id,
        history: deepClone(trainingRun.history),
        loss: latestLoss,
      });
    } catch (err) {
      trainingRun.status = 'error';
      trainingRun.updatedAt = nowIso();
      await this.checkpointTrainingJob(job, trainingRun, {
        includeCheckpointArtifacts: true,
        status: 'error',
        jobStatus: 'error',
      }).catch(() => {});
      this.state.activeJobs.training = null;
      await this.save().catch(() => {});
      this.emitTrainingJobProgress(job, 'error', {
        epoch: completedEpochs,
        totalEpochs: job.epochs,
        history: deepClone(trainingRun.history || []),
        loss: trainingRun.finalLoss || null,
        message: err.message || 'Training failed',
      });
      throw err;
    } finally {
      this.trainingTasks.delete(taskState?.id);
    }
  }

  async trainSnapshot(options = {}) {
    await this.ensureLoaded();
    const baseSnapshot = this.resolveSnapshot(options.snapshotId);
    if (!baseSnapshot) {
      const err = new Error('Snapshot not found for training');
      err.code = 'SNAPSHOT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    const epochs = clampPositiveInt(options.epochs, 2, 1, 50);
    const learningRate = normalizeFloat(options.learningRate, 0.01, 0.0001, 0.5);
    const simulationIds = Array.isArray(options.simulationIds)
      ? options.simulationIds.filter(Boolean)
      : null;

    const samples = await this.collectTrainingSamples(baseSnapshot.id, simulationIds);
    if (!samples.policySamples.length && !samples.valueSamples.length && !samples.identitySamples.length) {
      const err = new Error(
        'No training samples found for the selected snapshot/simulations. '
        + 'Select runs where that snapshot actually played (not builtin-vs-builtin only).',
      );
      err.code = 'NO_TRAINING_SAMPLES';
      err.statusCode = 400;
      err.details = {
        snapshotId: baseSnapshot.id,
        simulationIds: simulationIds || [],
        sourceSimulations: samples.sourceSimulations,
        sourceGames: samples.sourceGames,
      };
      throw err;
    }
    const sampleCounts = {
      policy: samples.policySamples.length,
      value: samples.valueSamples.length,
      identity: samples.identitySamples.length,
    };
    const taskId = `training-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const emitTrainingProgress = (phase, payload = {}) => {
      eventBus.emit('ml:trainingProgress', {
        phase,
        taskId,
        timestamp: nowIso(),
        baseSnapshotId: baseSnapshot.id,
        epochs,
        learningRate,
        sourceSimulationIds: simulationIds || [],
        sampleCounts,
        ...payload,
      });
    };

    emitTrainingProgress('start', {
      sourceGames: samples.sourceGames,
      sourceSimulations: samples.sourceSimulations,
    });

    try {
      const trainedBundle = cloneModelBundle(baseSnapshot.modelBundle);
      const optimizerState = createOptimizerState(trainedBundle);
      const lossEntries = [];

      for (let epoch = 0; epoch < epochs; epoch += 1) {
        const policy = trainPolicyModel(trainedBundle, samples.policySamples, {
          learningRate,
          optimizerState: optimizerState.policy,
        });
        const value = trainValueModel(trainedBundle, samples.valueSamples, {
          learningRate,
          optimizerState: optimizerState.value,
        });
        const identity = trainIdentityModel(trainedBundle, samples.identitySamples, {
          learningRate,
          optimizerState: optimizerState.identity,
        });
        optimizerState.policy = policy.optimizerState || optimizerState.policy;
        optimizerState.value = value.optimizerState || optimizerState.value;
        optimizerState.identity = identity.optimizerState || optimizerState.identity;
        const epochLoss = {
          epoch: epoch + 1,
          policyLoss: policy.loss,
          valueLoss: value.loss,
          identityLoss: identity.loss,
          identityAccuracy: identity.accuracy,
          policySamples: policy.samples,
          valueSamples: value.samples,
          identitySamples: identity.samples,
        };
        lossEntries.push(epochLoss);
        emitTrainingProgress('epoch', {
          epoch: epoch + 1,
          totalEpochs: epochs,
          loss: epochLoss,
        });
      }

      const latestLoss = lossEntries[lossEntries.length - 1];
      const lossRecord = {
        timestamp: nowIso(),
        learningRate,
        epochs,
        sourceSimulations: samples.sourceSimulations,
        sourceGames: samples.sourceGames,
        history: lossEntries.map((entry) => ({ ...entry })),
        ...latestLoss,
      };
      const newSnapshot = this.createSnapshotRecord({
        label: options.label || `${baseSnapshot.label} -> trained`,
        generation: (baseSnapshot.generation || 0) + 1,
        parentSnapshotId: baseSnapshot.id,
        modelBundle: trainedBundle,
        notes: options.notes || `Trained from ${samples.sourceGames} game(s)`,
        stats: {
          ...baseSnapshot.stats,
          trainingRuns: (baseSnapshot.stats?.trainingRuns || 0) + 1,
        },
        losses: [
          ...(baseSnapshot.losses || []),
          lossRecord,
        ],
      });

      this.state.snapshots.unshift(newSnapshot);
      const trainingRun = {
        id: this.nextId('training'),
        createdAt: nowIso(),
        baseSnapshotId: baseSnapshot.id,
        newSnapshotId: newSnapshot.id,
        epochs,
        learningRate,
        sourceSimulationIds: simulationIds || [],
        sourceGames: samples.sourceGames,
        sourceSimulations: samples.sourceSimulations,
        sampleCounts,
        history: lossEntries.map((entry) => ({ ...entry })),
        finalLoss: latestLoss,
      };
      this.state.trainingRuns.unshift(trainingRun);
      if (this.state.trainingRuns.length > 500) {
        this.state.trainingRuns.length = 500;
      }

      baseSnapshot.stats = baseSnapshot.stats || {};
      baseSnapshot.stats.trainingRuns = (baseSnapshot.stats.trainingRuns || 0) + 1;
      baseSnapshot.updatedAt = nowIso();

      await this.save();

      emitTrainingProgress('complete', {
        epoch: epochs,
        totalEpochs: epochs,
        trainingRunId: trainingRun.id,
        newSnapshotId: newSnapshot.id,
        loss: latestLoss,
      });

      return {
        trainingRun,
        snapshot: this.summarizeSnapshot(newSnapshot),
        lossHistory: lossEntries,
        sampleCounts,
      };
    } catch (err) {
      emitTrainingProgress('error', {
        message: err.message || 'Training failed',
      });
      throw err;
    }
  }

  async getLossHistory(options = {}) {
    await this.ensureLoaded();
    const snapshotId = options.snapshotId || null;
    if (snapshotId) {
      const snapshot = this.getSnapshotById(snapshotId);
      if (!snapshot) return [];
      return deepClone(snapshot.losses || []);
    }
    return deepClone((this.state.snapshots || []).map((snapshot) => ({
      snapshotId: snapshot.id,
      label: snapshot.label,
      losses: snapshot.losses || [],
    })));
  }

  async getLiveStatus() {
    await this.ensureLoaded();
    const simulationJob = this.state.activeJobs?.simulation || null;
    const trainingJob = this.state.activeJobs?.training || null;
    const simulation = simulationJob
      ? this.buildSimulationJobPayload(simulationJob)
      : this.getRecentRememberedLiveStatus('simulation');
    const training = trainingJob
      ? this.buildTrainingJobPayload(trainingJob)
      : this.getRecentRememberedLiveStatus('training');
    return {
      serverTime: nowIso(),
      simulation,
      training,
    };
  }

  async listTrainingRuns(options = {}) {
    await this.ensureLoaded();
    const runs = await this.listStoredTrainingRuns({ limit: options.limit });
    return runs.map((run) => this.summarizeTrainingRun(run));
  }
}

let defaultRuntime = null;

function getMlRuntime() {
  if (!defaultRuntime) {
    defaultRuntime = new MlRuntime();
    defaultRuntime.ensureLoaded().catch((err) => {
      console.error('[ml-runtime] failed to initialize default runtime', err);
    });
  }
  return defaultRuntime;
}

module.exports = {
  MlRuntime,
  getMlRuntime,
};
