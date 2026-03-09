const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const {
  WHITE,
  BLACK,
  otherColor,
  createRng,
  getLegalActions,
  applyAction,
  actionKey,
} = require('./engine');
const {
  createDefaultModelBundle,
  cloneModelBundle,
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

function nowIso() {
  return new Date().toISOString();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDirSync(targetDir) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
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
    version: 1,
    counters: {
      snapshot: 1,
      simulation: 1,
      game: 1,
      training: 1,
    },
    snapshots: [],
    simulations: [],
    trainingRuns: [],
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

async function callPostHandler(handler, body = {}) {
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
      headers: {},
      body: deepClone(body),
      query: {},
      params: {},
    };

    const res = {
      statusCode: 200,
      headersSent: false,
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

    Promise.resolve(handler(req, res, next))
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
  });
  liveGame = await loadGameLean(gameId);
  const blackSetup = buildRandomSetupFromGame(liveGame, BLACK, rng, config);
  await callPostHandler(ROUTE_HANDLERS.setup, {
    gameId,
    color: BLACK,
    pieces: blackSetup.pieces,
    onDeck: blackSetup.onDeck,
  });

  await callPostHandler(ROUTE_HANDLERS.ready, { gameId, color: WHITE });
  await callPostHandler(ROUTE_HANDLERS.ready, { gameId, color: BLACK });

  const readyGame = await loadGameLean(gameId);
  if (!readyGame) {
    throw new Error('Game disappeared after setup');
  }

  return {
    gameId,
    matchId,
    game: readyGame,
  };
}

async function cleanupApiBackedGame({ gameId, matchId }) {
  if (gameId) {
    try {
      await Game.deleteMany({ _id: gameId });
    } catch (_) {}
    try {
      if (Game.historyModel && typeof Game.historyModel.deleteOne === 'function') {
        await Game.historyModel.deleteOne({ _id: gameId });
      }
    } catch (_) {}
  }
  if (matchId) {
    try {
      await Match.deleteMany({ _id: matchId });
    } catch (_) {}
    try {
      if (Match.historyModel && typeof Match.historyModel.deleteOne === 'function') {
        await Match.historyModel.deleteOne({ _id: matchId });
      }
    } catch (_) {}
  }
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
          this.state = {
            ...createEmptyState(),
            ...parsed,
            counters: {
              ...createEmptyState().counters,
              ...(parsed.counters || {}),
            },
          };
          if (Array.isArray(this.state.simulations)) {
            this.state.simulations = this.state.simulations
              .map((simulation) => compactSimulationForState(simulation))
              .slice(0, this.maxSimulationHistory);
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
    const tmpPath = `${this.dataFilePath}.tmp`;
    this.savePromise = this.savePromise
      .then(async () => {
        await fs.promises.writeFile(tmpPath, payload, 'utf8');
        await fs.promises.rename(tmpPath, this.dataFilePath);
      })
      .catch((err) => {
        console.error('[ml-runtime] failed to persist state', err);
      });
    await this.savePromise;
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
        const gameOperations = gamePayloads
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

        const chunks = chunkArray(gameOperations, 10);
        for (let idx = 0; idx < chunks.length; idx += 1) {
          await SimulationGameModel.bulkWrite(chunks[idx], { ordered: false });
        }

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
      stats,
    };
  }

  async getSummary() {
    await this.ensureLoaded();
    const snapshots = (this.state.snapshots || []).map((snapshot) => this.summarizeSnapshot(snapshot));
    const simulations = await this.listStoredSimulations({ limit: this.maxSimulationHistory });
    const totalGames = simulations.reduce((acc, simulation) => (
      acc + ((simulation.stats && simulation.stats.games) || 0)
    ), 0);
    const totalTrainingRuns = (this.state.trainingRuns || []).length;
    const latestSimulation = simulations.length ? this.summarizeSimulation(simulations[0]) : null;
    const latestTraining = this.state.trainingRuns.length ? this.state.trainingRuns[0] : null;

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
            featureByIdentity: deepClone(sample.featureByIdentity),
            probabilities: deepClone(sample.probabilities),
          });
        });
      }
    });

    return { policySamples, valueSamples, identitySamples };
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

    let gameId = '';
    let matchId = '';
    let game = null;
    const replay = [];
    const decisions = [];
    let forcedStopReason = null;

    const applyApiAction = async (action, color, observationState, gameDoc) => {
      const type = normalizeActionType(action?.type);
      if (type === 'MOVE') {
        return callPostHandler(ROUTE_HANDLERS.move, {
          gameId,
          color,
          from: action.from,
          to: action.to,
          declaration: action.declaration,
        });
      }
      if (type === 'CHALLENGE') {
        return callPostHandler(ROUTE_HANDLERS.challenge, { gameId, color });
      }
      if (type === 'BOMB') {
        return callPostHandler(ROUTE_HANDLERS.bomb, { gameId, color });
      }
      if (type === 'PASS') {
        return callPostHandler(ROUTE_HANDLERS.pass, { gameId, color });
      }
      if (type === 'ON_DECK') {
        let identity = Number.isFinite(action.identity) ? action.identity : null;
        if (!Number.isFinite(identity) && action.pieceId && observationState?.pieces?.[action.pieceId]) {
          identity = observationState.pieces[action.pieceId].identity;
        }
        if (!Number.isFinite(identity)) {
          const stashPiece = Array.isArray(gameDoc?.stashes?.[color]) ? gameDoc.stashes[color][0] : null;
          identity = Number.isFinite(stashPiece?.identity) ? stashPiece.identity : null;
        }
        if (!Number.isFinite(identity)) {
          throw new Error('No valid on-deck identity available');
        }
        return callPostHandler(ROUTE_HANDLERS.onDeck, {
          gameId,
          color,
          piece: { identity },
        });
      }
      throw new Error(`Unsupported action type: ${type}`);
    };

    const forceDrawOrResign = async (fallbackColor) => {
      const color = Number.isFinite(fallbackColor) ? fallbackColor : WHITE;
      try {
        await callPostHandler(ROUTE_HANDLERS.draw, {
          gameId,
          color,
          action: 'offer',
        });
        await callPostHandler(ROUTE_HANDLERS.draw, {
          gameId,
          color: otherColor(color),
          action: 'accept',
        });
      } catch (_) {
        try {
          await callPostHandler(ROUTE_HANDLERS.resign, {
            gameId,
            color,
          });
        } catch (_) {}
      }
    };

    try {
      const created = await createApiBackedGame(seed);
      gameId = created.gameId;
      matchId = created.matchId;
      game = created.game;
      const observationConfig = {
        seed,
        maxPlies,
        rows: Number(game?.board?.length) || 6,
        cols: Number(game?.board?.[0]?.length) || 5,
      };
      let observationState = buildMlStateFromGame(game, observationConfig);
      replay.push(toReplayFrameFromGame(game, { note: 'start' }));

      for (let step = 0; step < maxDecisionSafety; step += 1) {
        if (!game || !game.isActive) break;
        const currentPlayer = Number.isFinite(game.playerTurn) ? game.playerTurn : WHITE;
        const participant = currentPlayer === WHITE ? whiteParticipant : blackParticipant;
        if (!participant) {
          forcedStopReason = 'missing_participant';
          await callPostHandler(ROUTE_HANDLERS.resign, { gameId, color: currentPlayer }).catch(() => {});
          game = await loadGameLean(gameId);
          if (game) replay.push(toReplayFrameFromGame(game, { note: forcedStopReason }));
          break;
        }

        if (
          !observationState
          || !observationState.isActive
          || observationState.playerTurn !== currentPlayer
        ) {
          observationState = buildMlStateFromGame(game, observationConfig);
        }
        const legalActions = getLegalActions(observationState, currentPlayer);
        if (!legalActions.length) {
          forcedStopReason = 'no_legal_actions';
          await callPostHandler(ROUTE_HANDLERS.resign, { gameId, color: currentPlayer }).catch(() => {});
          game = await loadGameLean(gameId);
          if (game) replay.push(toReplayFrameFromGame(game, { note: forcedStopReason }));
          break;
        }

        const participantId = this.getDisplayParticipantId(participant);
        const participantLabel = this.getDisplayParticipantLabel(participant, participantId);
        const search = this.chooseActionForParticipant(participant, observationState, {
          ...mctsOptions,
          seed: seed + (observationState.ply * 104729),
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
        let lastActionError = null;
        for (let idx = 0; idx < candidates.length; idx += 1) {
          const candidate = candidates[idx];
          try {
            await applyApiAction(candidate, currentPlayer, observationState, game);
            executedAction = candidate;
            break;
          } catch (err) {
            lastActionError = err;
          }
        }

        if (!executedAction) {
          forcedStopReason = lastActionError?.message || 'all_legal_actions_rejected';
          await callPostHandler(ROUTE_HANDLERS.resign, { gameId, color: currentPlayer }).catch(() => {});
          game = await loadGameLean(gameId);
          if (game) {
            replay.push(toReplayFrameFromGame(game, {
              note: forcedStopReason,
              decision: {
                player: currentPlayer,
                participantId,
                participantLabel,
                snapshotId: participant.snapshotId || null,
                action: { type: 'RESIGN', player: currentPlayer },
                move: { type: 'RESIGN', player: currentPlayer },
                valueEstimate: 0,
                trace: { reason: forcedStopReason },
              },
            }));
          }
          break;
        }

        const nextGame = await loadGameLean(gameId);
        if (!nextGame) {
          forcedStopReason = 'game_missing_after_action';
          break;
        }

        const executedKey = actionKey(executedAction);
        const useTrainingRecord = Boolean(requestedKey && executedKey === requestedKey);
        const decision = {
          ply: observationState.ply,
          player: currentPlayer,
          participantId,
          participantLabel,
          snapshotId: participant.snapshotId || null,
          action: deepClone(executedAction),
          move: deepClone(executedAction),
          trace: deepClone(search?.trace || {}),
          valueEstimate: Number.isFinite(search?.valueEstimate) ? search.valueEstimate : 0,
          trainingRecord: useTrainingRecord && search?.trainingRecord
            ? {
                ...deepClone(search.trainingRecord),
                snapshotId: participant.snapshotId || null,
              }
            : null,
        };
        decisions.push(decision);
        const predictedObservation = applyAction(observationState, executedAction);
        const apiWinner = Number.isFinite(nextGame.winner) ? nextGame.winner : null;
        const predictedWinner = Number.isFinite(predictedObservation?.winner)
          ? predictedObservation.winner
          : null;
        const apiTurn = Number.isFinite(nextGame.playerTurn) ? nextGame.playerTurn : WHITE;
        const predictedTurn = Number.isFinite(predictedObservation?.playerTurn)
          ? predictedObservation.playerTurn
          : null;
        const shouldResyncObservation = (
          !predictedObservation
          || Boolean(predictedObservation.isActive) !== Boolean(nextGame.isActive)
          || (predictedTurn !== null && predictedTurn !== apiTurn)
          || predictedWinner !== apiWinner
        );
        if (shouldResyncObservation) {
          observationState = buildMlStateFromGame(nextGame, observationConfig);
          decision.trace = {
            ...(decision.trace || {}),
            observationResync: true,
          };
        } else {
          observationState = predictedObservation;
        }
        game = nextGame;
        replay.push(toReplayFrameFromGame(game, { decision }));

        if (decisions.length >= maxPlies && game.isActive) {
          forcedStopReason = 'max_plies';
          await forceDrawOrResign(Number.isFinite(game.playerTurn) ? game.playerTurn : currentPlayer);
          game = await loadGameLean(gameId);
          if (game) {
            replay.push(toReplayFrameFromGame(game, { note: forcedStopReason }));
          }
          break;
        }
      }

      if (game && game.isActive) {
        forcedStopReason = forcedStopReason || 'safety_stop';
        await forceDrawOrResign(Number.isFinite(game.playerTurn) ? game.playerTurn : WHITE);
        game = await loadGameLean(gameId);
        if (game) {
          replay.push(toReplayFrameFromGame(game, { note: forcedStopReason }));
        }
      }

      const winner = Number.isFinite(game?.winner) ? game.winner : null;
      const winReason = game?.winReason ?? forcedStopReason ?? null;
      const training = this.buildTrainingSamplesFromDecisions(decisions, winner);
      const plies = Number.isFinite(game?.actions?.length) ? game.actions.length : decisions.length;

      return {
        id: this.nextId('game'),
        createdAt: nowIso(),
        seed,
        setupMode: 'random',
        whiteParticipantId,
        blackParticipantId,
        whiteParticipantLabel,
        blackParticipantLabel,
        winner,
        winReason,
        plies,
        actionHistory: Array.isArray(game?.actions) ? deepClone(game.actions) : [],
        moveHistory: Array.isArray(game?.moves) ? deepClone(game.moves) : [],
        replay,
        decisions,
        training,
        result: {
          whiteValue: winner === null ? 0 : (winner === WHITE ? 1 : -1),
          blackValue: winner === null ? 0 : (winner === BLACK ? 1 : -1),
        },
      };
    } finally {
      await cleanupApiBackedGame({ gameId, matchId });
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
    const task = this.simulationTasks.get(id);
    if (!task || task.status !== 'running') {
      return { stopped: false, reason: 'not_running', taskId: id };
    }
    task.cancelRequested = true;
    task.cancelRequestedAt = nowIso();
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
      const lossEntries = [];

      for (let epoch = 0; epoch < epochs; epoch += 1) {
        const policy = trainPolicyModel(trainedBundle, samples.policySamples, learningRate);
        const value = trainValueModel(trainedBundle, samples.valueSamples, learningRate);
        const identity = trainIdentityModel(trainedBundle, samples.identitySamples, learningRate);
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
          {
            timestamp: nowIso(),
            ...latestLoss,
            learningRate,
            epochs,
            sourceSimulations: samples.sourceSimulations,
            sourceGames: samples.sourceGames,
          },
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

  async listTrainingRuns(options = {}) {
    await this.ensureLoaded();
    const limit = clampPositiveInt(options.limit, 20, 1, 500);
    return deepClone((this.state.trainingRuns || []).slice(0, limit));
  }
}

let defaultRuntime = null;

function getMlRuntime() {
  if (!defaultRuntime) {
    defaultRuntime = new MlRuntime();
  }
  return defaultRuntime;
}

module.exports = {
  MlRuntime,
  getMlRuntime,
};
