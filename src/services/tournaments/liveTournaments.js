const crypto = require('crypto');
const mongoose = require('mongoose');
const Match = require('../../models/Match');
const Game = require('../../models/Game');
const Tournament = require('../../models/Tournament');
const getServerConfig = require('../../utils/getServerConfig');
const eventBus = require('../../eventBus');
const ensureUser = require('../../utils/ensureUser');
const {
  ensureBotUser,
  listBuiltinBotCatalog,
  getBuiltinBotDefinition,
  normalizeBuiltinBotId,
} = require('../bots/registry');

const TOURNAMENTS = new Map();
const isTestRuntime = () => process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

function isMongoConnected() {
  return mongoose?.connection?.readyState === 1;
}

function requireMongoPersistence() {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    return;
  }
  if (!isMongoConnected()) {
    const err = new Error('Tournament persistence requires an active MongoDB connection.');
    err.statusCode = 503;
    throw err;
  }
}

function hasStartedTournament(tournament) {
  return Boolean(tournament?.startedAt) || tournament?.state === 'active' || tournament?.phase === 'round_robin' || tournament?.phase === 'elimination';
}

function shouldPersistTournament(tournament) {
  return hasStartedTournament(tournament)
    || tournament?.state === 'completed'
    || tournament?.state === 'cancelled';
}

function isTournamentMember(tournament, userId) {
  const normalized = String(userId || '');
  if (!normalized) return false;
  if (String(tournament?.host?.userId || '') === normalized) return true;
  if (Array.isArray(tournament?.players) && tournament.players.some((entry) => String(entry.userId || '') === normalized)) return true;
  if (Array.isArray(tournament?.viewers) && tournament.viewers.some((entry) => String(entry.userId || '') === normalized)) return true;
  return false;
}

const TOURNAMENT_MATCH_TYPES = Match.TOURNAMENT_MATCH_TYPES || Object.freeze({
  ROUND_ROBIN: 'TOURNAMENT_ROUND_ROBIN',
  ELIMINATION: 'TOURNAMENT_ELIMINATION',
});

function isTournamentTestModeEnabled() {
  return process.env.NODE_ENV !== 'production';
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  if (prefix === 'trn') {
    return new mongoose.Types.ObjectId().toString();
  }
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeDisplayName(name, fallback = 'Tournament Host') {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || fallback;
}

function cloneTournament(tournament) {
  return JSON.parse(JSON.stringify(tournament));
}

function findMemberIndex(entries, userId) {
  const target = String(userId || '');
  if (!target) return -1;
  return entries.findIndex((entry) => String(entry.userId || '') === target);
}

function hasPlayerWithId(tournament, userId) {
  return findMemberIndex(tournament.players, userId) >= 0;
}

function summarizeTournament(tournament) {
  return {
    id: tournament.id,
    label: tournament.label,
    state: tournament.state,
    phase: tournament.phase,
    hostUsername: tournament.host.username,
    playerCount: tournament.players.length,
    viewerCount: tournament.viewers.length,
    createdAt: tournament.createdAt,
    startedAt: tournament.startedAt,
    completedAt: tournament.completedAt,
  };
}

function toTournamentModelPayload(tournament) {
  const matchIds = Array.isArray(tournament.matchIds)
    ? tournament.matchIds
        .map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null))
        .filter(Boolean)
    : [];

  return {
    label: tournament.label,
    state: tournament.state,
    phase: tournament.phase,
    host: {
      userId: mongoose.Types.ObjectId.isValid(tournament.host?.userId)
        ? new mongoose.Types.ObjectId(tournament.host.userId)
        : undefined,
      username: tournament.host?.username || 'Tournament Host',
      isGuest: Boolean(tournament.host?.isGuest),
    },
    config: {
      roundRobinMinutes: Number(tournament.config?.roundRobinMinutes) || 15,
      eliminationStyle: tournament.config?.eliminationStyle === 'double' ? 'double' : 'single',
      victoryPoints: [3, 4, 5].includes(Number(tournament.config?.victoryPoints))
        ? Number(tournament.config.victoryPoints)
        : 3,
    },
    players: Array.isArray(tournament.players) ? tournament.players : [],
    viewers: Array.isArray(tournament.viewers) ? tournament.viewers : [],
    matchIds,
    gameIds: Array.isArray(tournament.gameIds)
      ? tournament.gameIds
          .map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null))
          .filter(Boolean)
      : [],
    createdAt: tournament.createdAt ? new Date(tournament.createdAt) : new Date(),
    startedAt: tournament.startedAt ? new Date(tournament.startedAt) : null,
    completedAt: tournament.completedAt ? new Date(tournament.completedAt) : null,
  };
}

function fromTournamentDocument(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    label: normalizeDisplayName(doc.label, 'Tournament'),
    state: doc.state || 'starting',
    phase: doc.phase || 'lobby',
    host: {
      userId: doc.host?.userId ? String(doc.host.userId) : '',
      username: normalizeDisplayName(doc.host?.username, 'Tournament Host'),
      isGuest: Boolean(doc.host?.isGuest),
    },
    config: {
      roundRobinMinutes: Number(doc.config?.roundRobinMinutes) || 15,
      eliminationStyle: doc.config?.eliminationStyle === 'double' ? 'double' : 'single',
      victoryPoints: [3, 4, 5].includes(Number(doc.config?.victoryPoints)) ? Number(doc.config.victoryPoints) : 3,
    },
    players: Array.isArray(doc.players) ? doc.players : [],
    viewers: Array.isArray(doc.viewers) ? doc.viewers : [],
    matchIds: Array.isArray(doc.matchIds) ? doc.matchIds.map((id) => String(id)) : [],
    gameIds: Array.isArray(doc.gameIds) ? doc.gameIds.map((id) => String(id)) : [],
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : nowIso(),
    startedAt: doc.startedAt ? new Date(doc.startedAt).toISOString() : null,
    completedAt: doc.completedAt ? new Date(doc.completedAt).toISOString() : null,
  };
}

async function persistTournamentSnapshot(tournament) {
  if (!shouldPersistTournament(tournament)) {
    return;
  }
  requireMongoPersistence();
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    return;
  }
  const payload = toTournamentModelPayload(tournament);
  const objectId = new mongoose.Types.ObjectId(String(tournament.id));
  await Tournament.updateOne(
    { _id: objectId },
    { $set: payload },
    { upsert: true, setDefaultsOnInsert: true },
  );
}

async function removeTournamentSnapshot(tournamentId) {
  if (!mongoose.Types.ObjectId.isValid(tournamentId)) return;
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
  if (!isMongoConnected()) return;
  await Tournament.deleteOne({ _id: new mongoose.Types.ObjectId(String(tournamentId)) });
}

async function hydrateActiveFromDatabase() {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
  if (!isMongoConnected()) return;
  const docs = await Tournament.find({ state: { $in: ['active'] } }).lean();
  docs.forEach((doc) => {
    const normalized = fromTournamentDocument(doc);
    if (normalized?.id) {
      TOURNAMENTS.set(normalized.id, normalized);
    }
  });
}

async function listLiveTournaments() {
  if (TOURNAMENTS.size === 0) {
    await hydrateActiveFromDatabase();
  }
  const rows = Array.from(TOURNAMENTS.values())
    .filter((entry) => entry.state === 'starting' || entry.state === 'active')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return rows.map((entry) => summarizeTournament(entry));
}

function summarizeTournamentForAdmin(tournament) {
  return {
    id: tournament.id,
    label: tournament.label,
    state: tournament.state,
    phase: tournament.phase,
    hostUsername: tournament.host?.username || 'Unknown',
    playerCount: Array.isArray(tournament.players) ? tournament.players.length : 0,
    viewerCount: Array.isArray(tournament.viewers) ? tournament.viewers.length : 0,
    matchCount: Array.isArray(tournament.matchIds) ? tournament.matchIds.length : 0,
    gameCount: Array.isArray(tournament.gameIds) ? tournament.gameIds.length : 0,
    createdAt: tournament.createdAt || null,
    startedAt: tournament.startedAt || null,
    completedAt: tournament.completedAt || null,
  };
}

async function listTournamentsForAdmin({ status = 'all' } = {}) {
  const statusFilter = String(status || 'all').trim().toLowerCase();
  const isValidState = (state) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'active') return state === 'active' || state === 'starting';
    if (statusFilter === 'historic') return state === 'completed' || state === 'cancelled';
    return true;
  };

  const merged = new Map();
  TOURNAMENTS.forEach((entry) => {
    if (!entry?.id) return;
    if (!isValidState(entry.state)) return;
    merged.set(String(entry.id), cloneTournament(entry));
  });

  if (isMongoConnected() && !isTestRuntime()) {
    const query = statusFilter === 'active'
      ? { state: { $in: ['starting', 'active'] } }
      : statusFilter === 'historic'
        ? { state: { $in: ['completed', 'cancelled'] } }
        : {};
    const docs = await Tournament.find(query).lean();
    docs.forEach((doc) => {
      const normalized = fromTournamentDocument(doc);
      if (!normalized?.id) return;
      if (!isValidState(normalized.state)) return;
      if (!merged.has(normalized.id)) {
        merged.set(normalized.id, normalized);
      }
    });
  }

  return Array.from(merged.values())
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .map(summarizeTournamentForAdmin);
}

async function deleteTournamentCascade({ tournamentId }) {
  const id = String(tournamentId || '').trim();
  if (!id) {
    const err = new Error('tournamentId is required.');
    err.statusCode = 400;
    throw err;
  }

  let tournament = TOURNAMENTS.get(id) || null;
  if (!tournament && isMongoConnected() && mongoose.Types.ObjectId.isValid(id)) {
    const doc = await Tournament.findById(id).lean();
    tournament = fromTournamentDocument(doc);
  }
  if (!tournament) {
    const err = new Error('Tournament not found.');
    err.statusCode = 404;
    throw err;
  }

  const matchIdSet = new Set(Array.isArray(tournament.matchIds) ? tournament.matchIds.map((value) => String(value)) : []);
  const gameIdSet = new Set(Array.isArray(tournament.gameIds) ? tournament.gameIds.map((value) => String(value)) : []);

  const activeMatches = await Match.find({ tournamentId: id }).lean();
  const completedMatches = isTestRuntime()
    ? []
    : await Match.find({ tournamentId: id, isActive: false }).lean();
  [...activeMatches, ...completedMatches].forEach((match) => {
    if (match?._id) matchIdSet.add(String(match._id));
    if (Array.isArray(match?.games)) {
      match.games.forEach((gameId) => {
        if (gameId) gameIdSet.add(String(gameId));
      });
    }
  });

  const matchIds = Array.from(matchIdSet);
  const gameIds = Array.from(gameIdSet);

  let deletedGames = 0;
  let deletedMatches = 0;

  if (matchIds.length > 0) {
    const activeGamesByMatch = await Game.deleteMany({ match: { $in: matchIds } });
    const completedGamesByMatch = isTestRuntime()
      ? { deletedCount: 0 }
      : await Game.deleteMany({ match: { $in: matchIds }, isActive: false });
    deletedGames += Number(activeGamesByMatch?.deletedCount || 0);
    deletedGames += Number(completedGamesByMatch?.deletedCount || 0);
  }

  if (gameIds.length > 0) {
    const activeGamesById = await Game.deleteMany({ _id: { $in: gameIds } });
    const completedGamesById = isTestRuntime()
      ? { deletedCount: 0 }
      : await Game.deleteMany({ _id: { $in: gameIds }, isActive: false });
    deletedGames += Number(activeGamesById?.deletedCount || 0);
    deletedGames += Number(completedGamesById?.deletedCount || 0);
  }

  if (matchIds.length > 0) {
    const activeMatchesDeleted = await Match.deleteMany({ _id: { $in: matchIds } });
    const completedMatchesDeleted = isTestRuntime()
      ? { deletedCount: 0 }
      : await Match.deleteMany({ _id: { $in: matchIds }, isActive: false });
    deletedMatches += Number(activeMatchesDeleted?.deletedCount || 0);
    deletedMatches += Number(completedMatchesDeleted?.deletedCount || 0);
  }

  const activeMatchesByTournament = await Match.deleteMany({ tournamentId: id });
  const completedMatchesByTournament = isTestRuntime()
    ? { deletedCount: 0 }
    : await Match.deleteMany({ tournamentId: id, isActive: false });
  deletedMatches += Number(activeMatchesByTournament?.deletedCount || 0);
  deletedMatches += Number(completedMatchesByTournament?.deletedCount || 0);

  TOURNAMENTS.delete(id);
  if (mongoose.Types.ObjectId.isValid(id) && isMongoConnected()) {
    await Tournament.deleteOne({ _id: new mongoose.Types.ObjectId(id) });
  }

  eventBus.emit('adminRefresh');

  return {
    tournamentId: id,
    deletedMatches,
    deletedGames,
  };
}

async function getTournamentOrThrow(tournamentId) {
  const id = String(tournamentId || '').trim();
  if (!id) {
    const err = new Error('Tournament not found.');
    err.statusCode = 404;
    throw err;
  }

  const cached = TOURNAMENTS.get(id);
  if (cached) return cached;

  requireMongoPersistence();
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    const err = new Error('Tournament not found.');
    err.statusCode = 404;
    throw err;
  }
  const doc = await Tournament.findById(id).lean();
  if (!doc) {
    const err = new Error('Tournament not found.');
    err.statusCode = 404;
    throw err;
  }
  const normalized = fromTournamentDocument(doc);
  TOURNAMENTS.set(normalized.id, normalized);
  return normalized;
}

function canManageTournament(tournament, actingUserId) {
  return String(tournament.host.userId) === String(actingUserId || '');
}

function requireStartingState(tournament, actionLabel) {
  if (tournament.state !== 'starting') {
    const err = new Error(`${actionLabel} is only available while tournament is starting.`);
    err.statusCode = 400;
    throw err;
  }
}

async function buildHost(hostSession) {
  const ensuredHost = await ensureUser(hostSession.userId);
  return {
    userId: String(ensuredHost.userId || hostSession.userId),
    username: normalizeDisplayName(hostSession.username || ensuredHost.username),
    isGuest: Boolean(hostSession.isGuest),
  };
}

async function createTournament({ hostSession, label, config = {} }) {
  const host = await buildHost(hostSession);
  const id = makeId('trn');
  const normalizedLabel = normalizeDisplayName(label, `Tournament ${new Date().toISOString().slice(0, 10)}`);
  const createdAt = nowIso();

  const tournament = {
    id,
    label: normalizedLabel,
    state: 'starting',
    phase: 'lobby',
    host,
    config: {
      roundRobinMinutes: Number.isFinite(Number(config.roundRobinMinutes))
        ? Math.max(1, Math.min(30, Number(config.roundRobinMinutes)))
        : 15,
      eliminationStyle: String(config.eliminationStyle || 'single').toLowerCase() === 'double'
        ? 'double'
        : 'single',
      victoryPoints: [3, 4, 5].includes(Number(config.victoryPoints)) ? Number(config.victoryPoints) : 3,
    },
    players: [],
    viewers: [],
    matchIds: [],
    gameIds: [],
    createdAt,
    startedAt: null,
    completedAt: null,
  };

  TOURNAMENTS.set(id, tournament);
  return cloneTournament(tournament);
}

async function joinTournamentAsPlayer({ tournamentId, session }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  requireStartingState(tournament, 'Join');

  const ensured = await ensureUser(session.userId);
  const userId = String(ensured.userId || session.userId);

  if (hasPlayerWithId(tournament, userId)) {
    return cloneTournament(tournament);
  }

  const existingViewerIndex = findMemberIndex(tournament.viewers, userId);
  if (existingViewerIndex >= 0) {
    tournament.viewers.splice(existingViewerIndex, 1);
  }

  tournament.players.push({
    entryId: makeId('ply'),
    type: 'human',
    userId,
    username: normalizeDisplayName(session.username || ensured.username),
    isGuest: Boolean(session.isGuest),
    joinedAt: nowIso(),
  });

  return cloneTournament(tournament);
}

async function joinTournamentAsViewer({ tournamentId, session }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  const ensured = await ensureUser(session.userId);
  const userId = String(ensured.userId || session.userId);

  if (findMemberIndex(tournament.viewers, userId) >= 0) {
    return cloneTournament(tournament);
  }

  if (hasPlayerWithId(tournament, userId)) {
    return cloneTournament(tournament);
  }

  tournament.viewers.push({
    entryId: makeId('viw'),
    type: 'viewer',
    userId,
    username: normalizeDisplayName(session.username || ensured.username),
    isGuest: Boolean(session.isGuest),
    joinedAt: nowIso(),
  });

  return cloneTournament(tournament);
}

async function leaveTournament({ tournamentId, session }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (canManageTournament(tournament, session.userId)) {
    if (!hasStartedTournament(tournament)) {
      TOURNAMENTS.delete(String(tournament.id));
      await removeTournamentSnapshot(tournament.id);
      return {
        ...cloneTournament(tournament),
        state: 'cancelled',
        phase: 'completed',
        completedAt: nowIso(),
      };
    }

    if (tournament.state !== 'completed' && tournament.state !== 'cancelled') {
      tournament.state = 'cancelled';
      tournament.phase = 'completed';
      tournament.completedAt = nowIso();
      await persistTournamentSnapshot(tournament);
    }
    return cloneTournament(tournament);
  }

  const playerIndex = findMemberIndex(tournament.players, session.userId);
  if (playerIndex >= 0) {
    tournament.players.splice(playerIndex, 1);
  }

  const viewerIndex = findMemberIndex(tournament.viewers, session.userId);
  if (viewerIndex >= 0) {
    tournament.viewers.splice(viewerIndex, 1);
  }

  if (tournament.players.length === 0 && tournament.state === 'starting') {
    TOURNAMENTS.delete(String(tournament.id));
    await removeTournamentSnapshot(tournament.id);
    return {
      ...cloneTournament(tournament),
      state: 'cancelled',
      phase: 'completed',
      completedAt: nowIso(),
    };
  }

  await persistTournamentSnapshot(tournament);
  return cloneTournament(tournament);
}

async function cancelTournament({ tournamentId, session }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!canManageTournament(tournament, session.userId)) {
    const err = new Error('Only host can cancel the tournament.');
    err.statusCode = 403;
    throw err;
  }
  return leaveTournament({ tournamentId, session });
}

async function addBotToTournament({ tournamentId, session, botName, difficulty }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!canManageTournament(tournament, session.userId)) {
    const err = new Error('Only host can add bots.');
    err.statusCode = 403;
    throw err;
  }

  requireStartingState(tournament, 'Add Bot');

  const normalizedDifficulty = normalizeBuiltinBotId(difficulty);
  const definition = getBuiltinBotDefinition(normalizedDifficulty);
  if (!definition || definition.playable === false) {
    const err = new Error('Selected bot difficulty is not available.');
    err.statusCode = 400;
    throw err;
  }

  const ensuredBot = await ensureBotUser(definition.id);
  const botUserId = String(ensuredBot?.user?._id || '');
  if (!botUserId) {
    const err = new Error('Unable to register bot participant.');
    err.statusCode = 500;
    throw err;
  }

  const name = normalizeDisplayName(botName, `${definition.label} Bot`);

  tournament.players.push({
    entryId: makeId('bot'),
    type: 'bot',
    userId: botUserId,
    username: name,
    difficulty: definition.id,
    joinedAt: nowIso(),
  });

  await persistTournamentSnapshot(tournament);
  return cloneTournament(tournament);
}

function buildMatchLabelFromPlayers(p1, p2) {
  const includesBot = p1.type === 'bot' || p2.type === 'bot';
  return { includesBot };
}

async function resolveTournamentGameSettings() {
  const config = await getServerConfig();
  const quickplaySettings = config?.gameModeSettings?.get
    ? (config.gameModeSettings.get('QUICKPLAY') || {})
    : (config?.gameModeSettings?.QUICKPLAY || {});
  const incrementSetting = config?.gameModeSettings?.get
    ? config.gameModeSettings.get('INCREMENT')
    : config?.gameModeSettings?.INCREMENT;
  return {
    timeControl: Number(quickplaySettings?.TIME_CONTROL) || 300000,
    increment: Number(incrementSetting) || 0,
  };
}

async function createTournamentMatch({ tournament, playerA, playerB, phase, gameSettings }) {
  const { includesBot } = buildMatchLabelFromPlayers(playerA, playerB);
  const type = phase === 'elimination'
    ? TOURNAMENT_MATCH_TYPES.ELIMINATION
    : TOURNAMENT_MATCH_TYPES.ROUND_ROBIN;

  const match = await Match.create({
    type,
    player1: playerA.userId,
    player2: playerB.userId,
    player1Score: 0,
    player2Score: 0,
    drawCount: 0,
    games: [],
    tournamentId: tournament.id,
    tournamentPhase: phase,
    eloEligible: phase === 'elimination' && !includesBot,
  });

  const players = Math.random() < 0.5
    ? [playerA.userId, playerB.userId]
    : [playerB.userId, playerA.userId];
  const game = await Game.create({
    players,
    match: match._id,
    timeControlStart: gameSettings.timeControl,
    increment: gameSettings.increment,
  });

  match.games = Array.isArray(match.games) ? match.games : [];
  match.games.push(String(game._id));
  await match.save();

  const affectedUsers = players.map((id) => String(id));
  const botPlayers = [playerA, playerB]
    .filter((entry) => entry?.type === 'bot' && entry?.userId)
    .map((entry) => String(entry.userId));
  const gamePayload = typeof game.toObject === 'function' ? game.toObject() : game;

  eventBus.emit('gameChanged', {
    game: gamePayload,
    affectedUsers,
    botPlayers,
    initiator: {
      action: 'tournament-match-created',
      tournamentId: tournament.id,
    },
  });
  eventBus.emit('players:bothNext', {
    game: gamePayload,
    affectedUsers,
    botPlayers,
  });
  eventBus.emit('match:created', {
    matchId: String(match._id),
    players: affectedUsers,
    type,
    botPlayers,
  });

  await Game.updateOne(
    { _id: game._id, playersReady: { $exists: false } },
    { $set: { playersReady: [false, false] } }
  );

  return {
    matchId: String(match._id),
    gameId: String(game._id),
    type,
    phase,
    players: [
      { userId: playerA.userId, username: playerA.username, type: playerA.type, difficulty: playerA.difficulty || null },
      { userId: playerB.userId, username: playerB.username, type: playerB.type, difficulty: playerB.difficulty || null },
    ],
    eloImpact: phase === 'elimination' ? !includesBot : false,
    reason: phase === 'elimination'
      ? (!includesBot
          ? 'Elimination between human players affects ELO once per matchup.'
          : 'Elimination against bots never affects ELO.')
      : 'Round robin never affects ELO.',
    status: phase === 'elimination' ? 'pending_accept' : 'live',
    includesBot,
  };
}

async function startTournament({ tournamentId, session }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!canManageTournament(tournament, session.userId)) {
    const err = new Error('Only host can start the tournament.');
    err.statusCode = 403;
    throw err;
  }

  requireStartingState(tournament, 'Start Tournament');
  if (tournament.players.length < 2) {
    const err = new Error('At least 2 players are required to start.');
    err.statusCode = 400;
    throw err;
  }

  tournament.state = 'active';
  tournament.phase = 'round_robin';
  tournament.startedAt = nowIso();
  const gameSettings = await resolveTournamentGameSettings();

  const generatedMatches = [];
  for (let i = 0; i + 1 < tournament.players.length; i += 2) {
    generatedMatches.push(await createTournamentMatch({
      tournament,
      playerA: tournament.players[i],
      playerB: tournament.players[i + 1],
      phase: 'round_robin',
      gameSettings,
    }));
  }

  tournament.matchIds = generatedMatches.map((item) => item.matchId);
  tournament.gameIds = generatedMatches.map((item) => item.gameId).filter(Boolean);

  await persistTournamentSnapshot(tournament);
  return cloneTournament(tournament);
}

async function getTournamentDetails(tournamentId, { session } = {}) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (session?.userId && !isTournamentMember(tournament, session.userId)) {
    const err = new Error('You must join this tournament as player or viewer before opening details.');
    err.statusCode = 403;
    throw err;
  }
  return cloneTournament(tournament);
}

async function listTournamentGames(tournamentId) {
  const tournament = await getTournamentOrThrow(tournamentId);
  const items = [];
  const explicitGameIds = Array.isArray(tournament.gameIds) ? tournament.gameIds : [];
  const gameIds = explicitGameIds.length > 0
    ? explicitGameIds
    : [];
  if (gameIds.length === 0 && Array.isArray(tournament.matchIds)) {
    for (const matchId of tournament.matchIds) {
      const match = await Match.findById(matchId);
      if (!match || !Array.isArray(match.games)) continue;
      match.games.forEach((id) => {
        if (id) gameIds.push(String(id));
      });
    }
  }
  for (const gameId of gameIds) {
    const game = await Game.findById(gameId);
    if (!game) continue;
    const match = game.match ? await Match.findById(game.match) : null;
    if (!match) continue;
    const type = String(match.type || '').toUpperCase();
    const isElimination = type === TOURNAMENT_MATCH_TYPES.ELIMINATION;
    const playerIds = Array.isArray(game.players) ? game.players.map((id) => String(id)) : [];
    const p1 = tournament.players.find((entry) => String(entry.userId) === String(playerIds[0]));
    const p2 = tournament.players.find((entry) => String(entry.userId) === String(playerIds[1]));
    const includesBot = Boolean(p1?.type === 'bot' || p2?.type === 'bot');
    items.push({
      gameId: String(game._id),
      matchId: String(match._id),
      phase: isElimination ? 'elimination' : 'round_robin',
      status: game.isActive ? (isElimination ? 'pending_accept' : 'live') : 'completed',
      players: [
        {
          entryId: p1?.entryId || null,
          userId: p1?.userId || playerIds[0] || null,
          username: p1?.username || 'Player 1',
          type: p1?.type || 'human',
          difficulty: p1?.difficulty || null
        },
        {
          entryId: p2?.entryId || null,
          userId: p2?.userId || playerIds[1] || null,
          username: p2?.username || 'Player 2',
          type: p2?.type || 'human',
          difficulty: p2?.difficulty || null
        },
      ],
      eloImpact: isElimination ? Boolean(match.eloEligible) : false,
      reason: isElimination
        ? (match.eloEligible ? 'Elimination between human players affects ELO once per matchup.' : 'Elimination against bots never affects ELO.')
        : 'Round robin never affects ELO.',
      includesBot,
      startedAt: game.startTime ? new Date(game.startTime).toISOString() : null,
    });
  }
  return items;
}

function getTournamentBotDifficultyOptions() {
  return listBuiltinBotCatalog()
    .filter((entry) => entry.playable)
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
    }));
}

function resetForTests() {
  TOURNAMENTS.clear();
}

module.exports = {
  TOURNAMENT_MATCH_TYPES,
  isTournamentTestModeEnabled,
  listLiveTournaments,
  listTournamentsForAdmin,
  getTournamentDetails,
  isTournamentMember,
  createTournament,
  joinTournamentAsPlayer,
  joinTournamentAsViewer,
  leaveTournament,
  cancelTournament,
  addBotToTournament,
  startTournament,
  listTournamentGames,
  deleteTournamentCascade,
  getTournamentBotDifficultyOptions,
  resetForTests,
};
