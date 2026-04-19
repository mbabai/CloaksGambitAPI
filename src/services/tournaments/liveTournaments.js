const crypto = require('crypto');
const mongoose = require('mongoose');
const eventBus = require('../../eventBus');
const Match = require('../../models/Match');
const Game = require('../../models/Game');
const Tournament = require('../../models/Tournament');
const User = require('../../models/User');
const getServerConfig = require('../../utils/getServerConfig');
const { getClockSettingsForMatchType } = require('../../utils/gameModeClock');
const ensureUser = require('../../utils/ensureUser');
const { appendNamedLocalDebugLog } = require('../../utils/localDebugLogger');
const { buildRoundRobinStandings, toIdString, toOptionalFiniteNumber } = require('./standings');
const { buildSingleEliminationBracket, buildDoubleEliminationBracket, getRoundLabel } = require('./bracket');
const {
  ensureBotUserInstance,
  listBuiltinBotCatalog,
  getBuiltinBotDefinition,
  normalizeBuiltinBotId,
} = require('../bots/registry');
const { ensureInternalBotClient } = require('../bots/internalBots');

const TOURNAMENTS = new Map();
const TOURNAMENT_ALERTS = new Map();
const ROUND_ROBIN_SCHEDULING = new Set();
const ELIMINATION_BREAK_SCHEDULING = new Map();

function logTournamentFlow(event, payload = {}) {
  appendNamedLocalDebugLog('tournaments/flow.jsonl', event, payload);
  if (process.env.NODE_ENV !== 'test') {
    console.info('[tournament]', event, payload);
  }
}

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
  return Boolean(tournament?.startedAt)
    || tournament?.state === 'active'
    || tournament?.phase === 'round_robin'
    || tournament?.phase === 'round_robin_complete'
    || tournament?.phase === 'elimination';
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

function getTournamentMembershipRole(tournament, userId) {
  const normalized = String(userId || '');
  if (!normalized) return null;
  const isHost = String(tournament?.host?.userId || '') === normalized;
  const isPlayer = Array.isArray(tournament?.players)
    && tournament.players.some((entry) => String(entry?.userId || '') === normalized);
  const isViewer = Array.isArray(tournament?.viewers)
    && tournament.viewers.some((entry) => String(entry?.userId || '') === normalized);
  if (isHost && isPlayer) return 'host_player';
  if (isHost) return 'host';
  if (isPlayer) return 'player';
  if (isViewer) return 'viewer';
  return null;
}

function getTournamentCreator(tournament) {
  if (tournament?.createdBy?.userId) {
    return {
      userId: String(tournament.createdBy.userId),
      username: normalizeDisplayName(tournament.createdBy.username, 'Tournament Host'),
      isGuest: Boolean(tournament.createdBy.isGuest),
    };
  }
  if (tournament?.host?.userId) {
    return {
      userId: String(tournament.host.userId),
      username: normalizeDisplayName(tournament.host.username, 'Tournament Host'),
      isGuest: Boolean(tournament.host.isGuest),
    };
  }
  return null;
}

function didUserCreateTournament(tournament, userId) {
  const creatorId = String(getTournamentCreator(tournament)?.userId || '');
  const targetId = String(userId || '');
  return Boolean(creatorId && targetId && creatorId === targetId);
}

function didUserCompeteInTournament(tournament, userId) {
  const targetId = String(userId || '');
  if (!targetId) return false;
  const entries = Array.isArray(tournament?.historicalPlayers) && tournament.historicalPlayers.length > 0
    ? tournament.historicalPlayers
    : (Array.isArray(tournament?.players) ? tournament.players : []);
  return entries.some((entry) => String(entry?.userId || '') === targetId);
}

function getTournamentHistoricalPlayers(tournament) {
  if (Array.isArray(tournament?.historicalPlayers) && tournament.historicalPlayers.length > 0) {
    return tournament.historicalPlayers;
  }
  return Array.isArray(tournament?.players) ? tournament.players : [];
}

function upsertHistoricalTournamentPlayer(tournament, playerEntry) {
  if (!tournament || !playerEntry?.userId) return;
  tournament.historicalPlayers = Array.isArray(tournament.historicalPlayers) ? tournament.historicalPlayers : [];
  const targetUserId = String(playerEntry.userId);
  const existingIndex = tournament.historicalPlayers.findIndex((entry) => String(entry?.userId || '') === targetUserId);
  if (existingIndex >= 0) {
    tournament.historicalPlayers[existingIndex] = {
      ...tournament.historicalPlayers[existingIndex],
      ...playerEntry,
    };
    return;
  }
  tournament.historicalPlayers.push({ ...playerEntry });
}

function removeHistoricalTournamentPlayer(tournament, userId) {
  const targetUserId = String(userId || '');
  if (!targetUserId || !Array.isArray(tournament?.historicalPlayers)) return;
  tournament.historicalPlayers = tournament.historicalPlayers.filter((entry) => String(entry?.userId || '') !== targetUserId);
}

function canAccessCompletedTournamentHistory(tournament, userId) {
  const targetId = String(userId || '');
  if (!targetId) return false;
  const isCompleted = tournament?.state === 'completed' || tournament?.phase === 'completed';
  if (!isCompleted) return false;
  return didUserCompeteInTournament(tournament, targetId) || didUserCreateTournament(tournament, targetId);
}

function getOrdinalLabel(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return String(value || '');
  const tens = number % 100;
  if (tens >= 11 && tens <= 13) return `${number}th`;
  const ones = number % 10;
  if (ones === 1) return `${number}st`;
  if (ones === 2) return `${number}nd`;
  if (ones === 3) return `${number}rd`;
  return `${number}th`;
}

function getMatchLoser(match) {
  const winnerId = String(match?.winner?.userId || '');
  const playerA = match?.playerA || null;
  const playerB = match?.playerB || null;
  const playerAId = String(playerA?.userId || '');
  const playerBId = String(playerB?.userId || '');
  if (!winnerId || !playerAId || !playerBId) return null;
  if (winnerId === playerAId) return playerB;
  if (winnerId === playerBId) return playerA;
  return null;
}

function normalizeCompletedPlacementCollections(bracket = {}) {
  return {
    winnersRounds: Array.isArray(bracket?.winnersRounds)
      ? bracket.winnersRounds
      : (Array.isArray(bracket?.rounds) ? bracket.rounds : []),
    losersRounds: Array.isArray(bracket?.losersRounds) ? bracket.losersRounds : [],
    finalsRounds: Array.isArray(bracket?.finalsRounds) ? bracket.finalsRounds : [],
  };
}

function buildCompletedPlacements(participants = [], bracket = null) {
  const allParticipants = Array.isArray(participants) ? participants.filter((entry) => entry?.userId) : [];
  if (!allParticipants.length) return [];

  const participantByUserId = new Map(allParticipants.map((entry) => [String(entry.userId), entry]));
  const progressByUserId = new Map();
  const ensureProgress = (userId) => {
    const key = String(userId || '');
    if (!key) {
      return {
        maxWinnersRound: -1,
        maxLosersRound: -1,
        maxFinalsRound: -1,
      };
    }
    if (!progressByUserId.has(key)) {
      progressByUserId.set(key, {
        maxWinnersRound: -1,
        maxLosersRound: -1,
        maxFinalsRound: -1,
      });
    }
    return progressByUserId.get(key);
  };

  const { winnersRounds, losersRounds, finalsRounds } = normalizeCompletedPlacementCollections(bracket);
  winnersRounds.forEach((round, roundIndex) => {
    (Array.isArray(round?.matches) ? round.matches : []).forEach((match) => {
      [match?.playerA, match?.playerB].forEach((player) => {
        const progress = ensureProgress(player?.userId);
        progress.maxWinnersRound = Math.max(progress.maxWinnersRound, roundIndex);
      });
    });
  });
  losersRounds.forEach((round, roundIndex) => {
    (Array.isArray(round?.matches) ? round.matches : []).forEach((match) => {
      [match?.playerA, match?.playerB].forEach((player) => {
        const progress = ensureProgress(player?.userId);
        progress.maxLosersRound = Math.max(progress.maxLosersRound, roundIndex);
      });
    });
  });
  finalsRounds.forEach((round, roundIndex) => {
    (Array.isArray(round?.matches) ? round.matches : []).forEach((match) => {
      [match?.playerA, match?.playerB].forEach((player) => {
        const progress = ensureProgress(player?.userId);
        progress.maxFinalsRound = Math.max(progress.maxFinalsRound, roundIndex);
      });
    });
  });

  const decidingFinal = (() => {
    if (finalsRounds.length > 0) {
      for (let index = finalsRounds.length - 1; index >= 0; index -= 1) {
        const match = finalsRounds[index]?.matches?.[0] || null;
        if (match?.winner?.userId) return match;
      }
    }
    const finalRound = winnersRounds[winnersRounds.length - 1] || null;
    return finalRound?.matches?.[0] || null;
  })();

  const championId = String(decidingFinal?.winner?.userId || '');
  const runnerUpId = String(getMatchLoser(decidingFinal)?.userId || '');
  const buildEntry = (participant) => {
    const progress = ensureProgress(participant?.userId);
    const points = Number.isFinite(Number(participant?.points)) ? Number(participant.points) : null;
    return {
      participant,
      deepestLosersRound: progress.maxLosersRound,
      deepestWinnersRound: progress.maxWinnersRound,
      deepestFinalsRound: progress.maxFinalsRound,
      points,
    };
  };

  const ordered = [];
  if (championId && participantByUserId.has(championId)) {
    ordered.push(buildEntry(participantByUserId.get(championId)));
  }
  if (runnerUpId && participantByUserId.has(runnerUpId) && runnerUpId !== championId) {
    ordered.push(buildEntry(participantByUserId.get(runnerUpId)));
  }

  const remaining = allParticipants
    .filter((entry) => {
      const userId = String(entry.userId || '');
      return userId && userId !== championId && userId !== runnerUpId;
    })
    .map(buildEntry)
    .sort((left, right) => {
      if (left.deepestFinalsRound !== right.deepestFinalsRound) {
        return right.deepestFinalsRound - left.deepestFinalsRound;
      }
      if (left.deepestLosersRound !== right.deepestLosersRound) {
        return right.deepestLosersRound - left.deepestLosersRound;
      }
      if (left.deepestWinnersRound !== right.deepestWinnersRound) {
        return right.deepestWinnersRound - left.deepestWinnersRound;
      }
      const leftPoints = Number.isFinite(left.points) ? left.points : Number.NEGATIVE_INFINITY;
      const rightPoints = Number.isFinite(right.points) ? right.points : Number.NEGATIVE_INFINITY;
      if (leftPoints !== rightPoints) return rightPoints - leftPoints;
      return 0;
    });

  const ranked = ordered.concat(remaining);
  let lastComparable = null;
  let lastPlacement = 0;
  return ranked.map((entry, index) => {
    const comparable = {
      deepestFinalsRound: entry.deepestFinalsRound,
      deepestLosersRound: entry.deepestLosersRound,
      deepestWinnersRound: entry.deepestWinnersRound,
      points: entry.points,
    };
    const isTie = Boolean(
      lastComparable
      && comparable.deepestFinalsRound === lastComparable.deepestFinalsRound
      && comparable.deepestLosersRound === lastComparable.deepestLosersRound
      && comparable.deepestWinnersRound === lastComparable.deepestWinnersRound
      && comparable.points === lastComparable.points
    );
    const position = isTie ? lastPlacement : index + 1;
    lastComparable = comparable;
    lastPlacement = position;
    return {
      position,
      label: getOrdinalLabel(position),
      participant: entry.participant,
      deepestFinalsRound: entry.deepestFinalsRound,
      deepestLosersRound: entry.deepestLosersRound,
      deepestWinnersRound: entry.deepestWinnersRound,
      points: entry.points,
    };
  });
}

function isTournamentStillJoinable(tournament) {
  return tournament?.state !== 'cancelled';
}

async function findTournamentForUser(userId, { excludeTournamentId = null } = {}) {
  const normalizedUserId = String(userId || '');
  if (!normalizedUserId) return null;

  if (TOURNAMENTS.size === 0) {
    await hydrateActiveFromDatabase();
  }

  const skipId = excludeTournamentId ? String(excludeTournamentId) : '';
  const cached = Array.from(TOURNAMENTS.values())
    .filter((entry) => String(entry?.id || '') !== skipId)
    .filter((entry) => isTournamentStillJoinable(entry))
    .sort((a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0))
    .find((entry) => getTournamentMembershipRole(entry, normalizedUserId));
  if (cached) return cached;

  if (!isMongoConnected() || process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    return null;
  }

  const docs = await Tournament.find({ state: { $in: ['active', 'completed'] } }).sort({ createdAt: -1 }).lean();
  for (const doc of docs) {
    const normalized = fromTournamentDocument(doc);
    if (!normalized?.id || String(normalized.id) === skipId) continue;
    if (getTournamentMembershipRole(normalized, normalizedUserId)) {
      TOURNAMENTS.set(normalized.id, normalized);
      return normalized;
    }
  }
  return null;
}

async function assertNoConcurrentTournamentMembership(userId, { excludeTournamentId = null } = {}) {
  const existing = await findTournamentForUser(userId, { excludeTournamentId });
  if (!existing) return;
  const err = new Error(`Leave "${existing.label}" before joining another tournament.`);
  err.statusCode = 409;
  throw err;
}

const TOURNAMENT_MATCH_TYPES = Match.TOURNAMENT_MATCH_TYPES || Object.freeze({
  ROUND_ROBIN: 'TOURNAMENT_ROUND_ROBIN',
  ELIMINATION: 'TOURNAMENT_ELIMINATION',
});

function isTournamentTestModeEnabled() {
  return process.env.NODE_ENV !== 'production';
}

function nowIso() {
  return new Date(Date.now()).toISOString();
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

function normalizeTournamentPhaseLabel(phase) {
  return phase === 'elimination' ? 'elimination' : 'round_robin';
}

function shouldRequireTournamentAccept(match) {
  const matchType = String(match?.type || '').toUpperCase();
  if (matchType === TOURNAMENT_MATCH_TYPES.ROUND_ROBIN) {
    return true;
  }
  if (matchType !== TOURNAMENT_MATCH_TYPES.ELIMINATION) {
    return false;
  }
  const player1Score = Number(match?.player1Score || 0);
  const player2Score = Number(match?.player2Score || 0);
  const drawCount = Number(match?.drawCount || 0);
  return (player1Score + player2Score + drawCount) === 0;
}

function findMemberIndex(entries, userId) {
  const target = String(userId || '');
  if (!target) return -1;
  return entries.findIndex((entry) => String(entry.userId || '') === target);
}

function hasPlayerWithId(tournament, userId) {
  return findMemberIndex(tournament.players, userId) >= 0;
}

function getActiveTournamentPlayers(tournament) {
  return (Array.isArray(tournament?.players) ? tournament.players : []).filter((entry) => entry && !entry.withdrawnAt);
}

function getHostTransferCandidates(tournament, currentHostUserId) {
  const currentHostId = String(currentHostUserId || tournament?.host?.userId || '');
  return getActiveTournamentPlayers(tournament).filter((entry) => String(entry?.userId || '') !== currentHostId);
}

async function resolveUserPreTournamentElo(userId) {
  const normalizedUserId = String(userId || '');
  if (!normalizedUserId || !mongoose.Types.ObjectId.isValid(normalizedUserId) || !isMongoConnected()) {
    return 800;
  }
  try {
    const user = await User.findById(normalizedUserId).lean();
    return Number.isFinite(Number(user?.elo)) ? Number(user.elo) : 800;
  } catch (_) {
    return 800;
  }
}

function summarizeTournament(tournament) {
  return {
    id: tournament.id,
    label: tournament.label,
    state: tournament.state,
    phase: tournament.phase,
    hostUsername: tournament?.host?.username || 'Autopilot',
    playerCount: tournament.players.length,
    viewerCount: tournament.viewers.length,
    createdAt: tournament.createdAt,
    startedAt: tournament.startedAt,
    completedAt: tournament.completedAt,
  };
}

function queueTournamentAlert(userId, message) {
  const id = String(userId || '');
  if (!id || !message) return;
  const current = TOURNAMENT_ALERTS.get(id) || [];
  current.push(String(message));
  TOURNAMENT_ALERTS.set(id, current.slice(-5));
}

function consumeTournamentAlerts(userId) {
  const id = String(userId || '');
  if (!id) return [];
  const alerts = TOURNAMENT_ALERTS.get(id) || [];
  TOURNAMENT_ALERTS.delete(id);
  return alerts;
}

function isKickedFromTournament(tournament, userId) {
  const target = String(userId || '');
  if (!target) return false;
  const removed = Array.isArray(tournament?.removedPlayers) ? tournament.removedPlayers : [];
  return removed.some((entry) => String(entry?.userId || '') === target);
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
    host: tournament?.host?.userId
      ? {
          userId: mongoose.Types.ObjectId.isValid(tournament.host?.userId)
            ? new mongoose.Types.ObjectId(tournament.host.userId)
            : undefined,
          username: tournament.host?.username || 'Tournament Host',
          isGuest: Boolean(tournament.host?.isGuest),
        }
      : null,
    createdBy: tournament?.createdBy?.userId
      ? {
          userId: mongoose.Types.ObjectId.isValid(tournament.createdBy?.userId)
            ? new mongoose.Types.ObjectId(tournament.createdBy.userId)
            : undefined,
          username: tournament.createdBy?.username || 'Tournament Host',
          isGuest: Boolean(tournament.createdBy?.isGuest),
        }
      : (tournament?.host?.userId
        ? {
            userId: mongoose.Types.ObjectId.isValid(tournament.host?.userId)
              ? new mongoose.Types.ObjectId(tournament.host.userId)
              : undefined,
            username: tournament.host?.username || 'Tournament Host',
            isGuest: Boolean(tournament.host?.isGuest),
          }
        : null),
    config: {
      roundRobinMinutes: Number(tournament.config?.roundRobinMinutes) || 15,
      breakMinutes: Number.isFinite(Number(tournament.config?.breakMinutes))
        ? Math.max(0, Math.min(30, Number(tournament.config.breakMinutes)))
        : 5,
      eliminationStyle: tournament.config?.eliminationStyle === 'double' ? 'double' : 'single',
      victoryPoints: [3, 4, 5].includes(Number(tournament.config?.victoryPoints))
        ? Number(tournament.config.victoryPoints)
        : 3,
    },
    players: Array.isArray(tournament.players) ? tournament.players : [],
    historicalPlayers: Array.isArray(tournament.historicalPlayers) ? tournament.historicalPlayers : [],
    viewers: Array.isArray(tournament.viewers) ? tournament.viewers : [],
    removedPlayers: Array.isArray(tournament.removedPlayers) ? tournament.removedPlayers : [],
    message: typeof tournament.message === 'string' ? tournament.message : '',
    roundRobinRounds: Array.isArray(tournament.roundRobinRounds) ? tournament.roundRobinRounds : [],
    currentRoundRobinRound: Number.isFinite(tournament.currentRoundRobinRound) ? tournament.currentRoundRobinRound : 0,
    roundRobinRoundsStartedAt: tournament.roundRobinRoundsStartedAt ? new Date(tournament.roundRobinRoundsStartedAt) : null,
    roundRobinCompletedAt: tournament.roundRobinCompletedAt ? new Date(tournament.roundRobinCompletedAt) : null,
    eliminationStartsAt: tournament.eliminationStartsAt ? new Date(tournament.eliminationStartsAt) : null,
    eliminationBracket: tournament.eliminationBracket || null,
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
    host: doc.host?.userId
      ? {
          userId: String(doc.host.userId),
          username: normalizeDisplayName(doc.host?.username, 'Tournament Host'),
          isGuest: Boolean(doc.host?.isGuest),
        }
      : null,
    createdBy: (doc.createdBy?.userId || doc.host?.userId)
      ? {
          userId: String(doc.createdBy?.userId || doc.host?.userId),
          username: normalizeDisplayName(doc.createdBy?.username || doc.host?.username, 'Tournament Host'),
          isGuest: Boolean(doc.createdBy?.isGuest ?? doc.host?.isGuest),
        }
      : null,
    config: {
      roundRobinMinutes: Number(doc.config?.roundRobinMinutes) || 15,
      breakMinutes: Number.isFinite(Number(doc.config?.breakMinutes))
        ? Math.max(0, Math.min(30, Number(doc.config.breakMinutes)))
        : 5,
      eliminationStyle: doc.config?.eliminationStyle === 'double' ? 'double' : 'single',
      victoryPoints: [3, 4, 5].includes(Number(doc.config?.victoryPoints)) ? Number(doc.config.victoryPoints) : 3,
    },
    players: Array.isArray(doc.players) ? doc.players : [],
    historicalPlayers: Array.isArray(doc.historicalPlayers)
      ? doc.historicalPlayers
      : (Array.isArray(doc.players) ? doc.players : []),
    viewers: Array.isArray(doc.viewers) ? doc.viewers : [],
    removedPlayers: Array.isArray(doc.removedPlayers) ? doc.removedPlayers : [],
    message: typeof doc.message === 'string' ? doc.message : '',
    roundRobinRounds: Array.isArray(doc.roundRobinRounds) ? doc.roundRobinRounds : [],
    currentRoundRobinRound: Number.isFinite(doc.currentRoundRobinRound) ? doc.currentRoundRobinRound : 0,
    roundRobinRoundsStartedAt: doc.roundRobinRoundsStartedAt ? new Date(doc.roundRobinRoundsStartedAt).toISOString() : null,
    roundRobinCompletedAt: doc.roundRobinCompletedAt ? new Date(doc.roundRobinCompletedAt).toISOString() : null,
    eliminationStartsAt: doc.eliminationStartsAt ? new Date(doc.eliminationStartsAt).toISOString() : null,
    eliminationBracket: doc.eliminationBracket || null,
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
  const docs = await Tournament.find({ state: { $in: ['active', 'completed'] } }).lean();
  docs.forEach((doc) => {
    const normalized = fromTournamentDocument(doc);
    if (normalized?.id) {
      TOURNAMENTS.set(normalized.id, normalized);
      scheduleTournamentEliminationBreak(normalized);
    }
  });
}

async function listLiveTournaments({ session } = {}) {
  if (TOURNAMENTS.size === 0) {
    await hydrateActiveFromDatabase();
  }
  const viewerUserId = String(session?.userId || '');
  const rows = Array.from(TOURNAMENTS.values())
    .filter((entry) => entry.state === 'starting' || entry.state === 'active')
    .filter((entry) => !viewerUserId || !isKickedFromTournament(entry, viewerUserId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return rows.map((entry) => summarizeTournament(entry));
}

async function getTournamentOrThrow(tournamentId, { skipLifecycleAdvance = false } = {}) {
  const id = String(tournamentId || '').trim();
  if (!id) {
    const err = new Error('Tournament not found.');
    err.statusCode = 404;
    throw err;
  }

  const cached = TOURNAMENTS.get(id);
  if (cached) {
    if (!skipLifecycleAdvance) {
      await maybeAdvanceTournamentRoundRobin(id);
      await maybeAdvanceTournamentEliminationBreak(id);
    }
    return TOURNAMENTS.get(id) || cached;
  }

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
  scheduleTournamentEliminationBreak(normalized);
  if (!skipLifecycleAdvance) {
    await maybeAdvanceTournamentRoundRobin(normalized.id);
    await maybeAdvanceTournamentEliminationBreak(normalized.id);
  }
  return TOURNAMENTS.get(normalized.id) || normalized;
}

function canManageTournament(tournament, actingUserId) {
  return Boolean(tournament?.host?.userId) && String(tournament.host.userId) === String(actingUserId || '');
}

function requireStartingState(tournament, actionLabel) {
  if (tournament.state !== 'starting') {
    const err = new Error(`${actionLabel} is only available while tournament is starting.`);
    err.statusCode = 400;
    throw err;
  }
}

function normalizeTournamentConfig(config = {}) {
  return {
    roundRobinMinutes: Number.isFinite(Number(config.roundRobinMinutes))
      ? Math.max(1, Math.min(30, Number(config.roundRobinMinutes)))
      : 15,
    breakMinutes: Number.isFinite(Number(config.breakMinutes))
      ? Math.max(0, Math.min(30, Number(config.breakMinutes)))
      : 5,
    eliminationStyle: String(config.eliminationStyle || 'single').toLowerCase() === 'double'
      ? 'double'
      : 'single',
    victoryPoints: [3, 4, 5].includes(Number(config.victoryPoints)) ? Number(config.victoryPoints) : 3,
  };
}

function getEliminationBreakDeadlineMs(tournament) {
  const explicitStartAt = Date.parse(tournament?.eliminationStartsAt || '');
  if (Number.isFinite(explicitStartAt)) {
    return explicitStartAt;
  }
  const completedAt = Date.parse(tournament?.roundRobinCompletedAt || '');
  if (!Number.isFinite(completedAt)) return null;
  const minutes = Number.isFinite(Number(tournament?.config?.breakMinutes))
    ? Math.max(0, Math.min(30, Number(tournament.config.breakMinutes)))
    : 5;
  return completedAt + (minutes * 60 * 1000);
}

function clearTournamentEliminationBreakTimer(tournamentId) {
  const id = String(tournamentId || '');
  if (!id) return;
  const existing = ELIMINATION_BREAK_SCHEDULING.get(id);
  if (existing) {
    clearTimeout(existing);
    ELIMINATION_BREAK_SCHEDULING.delete(id);
  }
}

function scheduleTournamentEliminationBreak(tournament) {
  const id = String(tournament?.id || '');
  if (!id) return;
  clearTournamentEliminationBreakTimer(id);
  if (tournament?.state !== 'active' || tournament?.phase !== 'round_robin_complete') return;
  const deadlineMs = getEliminationBreakDeadlineMs(tournament);
  if (!Number.isFinite(deadlineMs)) return;
  const delayMs = Math.max(0, deadlineMs - Date.now());
  const handle = setTimeout(() => {
    ELIMINATION_BREAK_SCHEDULING.delete(id);
    maybeAdvanceTournamentEliminationBreak(id).catch((err) => {
      console.error('Failed to auto-start tournament elimination after break:', err);
    });
  }, delayMs);
  ELIMINATION_BREAK_SCHEDULING.set(id, handle);
}

function collectTournamentMemberIds(tournament) {
  const ids = new Set();
  const hostId = String(tournament?.host?.userId || '');
  if (hostId) ids.add(hostId);
  (Array.isArray(tournament?.players) ? tournament.players : []).forEach((entry) => {
    const userId = String(entry?.userId || '');
    if (userId) ids.add(userId);
  });
  (Array.isArray(tournament?.viewers) ? tournament.viewers : []).forEach((entry) => {
    const userId = String(entry?.userId || '');
    if (userId) ids.add(userId);
  });
  return Array.from(ids);
}

function emitTournamentUpdated(tournament) {
  if (!tournament?.id) return;
  eventBus.emit('tournament:updated', {
    tournamentId: String(tournament.id),
    userIds: collectTournamentMemberIds(tournament),
  });
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
  const createdBy = { ...host };
  await assertNoConcurrentTournamentMembership(host.userId);
  const id = makeId('trn');
  const normalizedLabel = normalizeDisplayName(label, `Tournament ${new Date().toISOString().slice(0, 10)}`);
  const createdAt = nowIso();

  const tournament = {
    id,
    label: normalizedLabel,
    state: 'starting',
    phase: 'lobby',
    host,
    createdBy,
    config: normalizeTournamentConfig(config),
    players: [],
    historicalPlayers: [],
    viewers: [],
    removedPlayers: [],
    message: '',
    roundRobinCompletedAt: null,
    eliminationStartsAt: null,
    eliminationBracket: null,
    matchIds: [],
    gameIds: [],
    createdAt,
    startedAt: null,
    completedAt: null,
  };

  TOURNAMENTS.set(id, tournament);
  return cloneTournament(tournament);
}

async function updateTournamentConfig({ tournamentId, session, config = {} }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!canManageTournament(tournament, session.userId)) {
    const err = new Error('Only host can update tournament settings.');
    err.statusCode = 403;
    throw err;
  }
  const canEditAllSettings = tournament.state === 'starting';
  const canEditBreakOnly = tournament.state === 'active' && tournament.phase === 'round_robin';
  if (!canEditAllSettings && !canEditBreakOnly) {
    const err = new Error('Tournament settings can no longer be changed.');
    err.statusCode = 400;
    throw err;
  }

  const nextConfig = canEditAllSettings
    ? { ...(tournament.config || {}), ...(config || {}) }
    : { ...(tournament.config || {}), breakMinutes: config?.breakMinutes };
  tournament.config = normalizeTournamentConfig(nextConfig);
  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
  return cloneTournament(tournament);
}

async function joinTournamentAsPlayer({ tournamentId, session }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  requireStartingState(tournament, 'Join');
  await assertNoConcurrentTournamentMembership(session.userId, { excludeTournamentId: tournament.id });

  const ensured = await ensureUser(session.userId);
  const userId = String(ensured.userId || session.userId);

  if (hasPlayerWithId(tournament, userId)) {
    return cloneTournament(tournament);
  }

  if (isKickedFromTournament(tournament, userId)) {
    const err = new Error('You were removed from this tournament by the host.');
    err.statusCode = 403;
    throw err;
  }

  const existingViewerIndex = findMemberIndex(tournament.viewers, userId);
  if (existingViewerIndex >= 0) {
    tournament.viewers.splice(existingViewerIndex, 1);
  }

  const preTournamentElo = await resolveUserPreTournamentElo(userId);
  const playerEntry = {
    entryId: makeId('ply'),
    type: 'human',
    userId,
    username: normalizeDisplayName(session.username || ensured.username),
    isGuest: Boolean(session.isGuest),
    preTournamentElo,
    seed: null,
    joinedAt: nowIso(),
  };
  tournament.players.push(playerEntry);
  upsertHistoricalTournamentPlayer(tournament, playerEntry);

  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
  return cloneTournament(tournament);
}

async function joinTournamentAsViewer({ tournamentId, session }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  await assertNoConcurrentTournamentMembership(session.userId, { excludeTournamentId: tournament.id });
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

  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
  return cloneTournament(tournament);
}

async function removeTournamentViewerOnDisconnect({ userId }) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return [];

  const removedTournamentIds = [];
  for (const tournament of TOURNAMENTS.values()) {
    const viewerIndex = findMemberIndex(tournament?.viewers, targetUserId);
    if (viewerIndex < 0) continue;
    tournament.viewers.splice(viewerIndex, 1);
    removedTournamentIds.push(String(tournament.id));
    await persistTournamentSnapshot(tournament);
    emitTournamentUpdated(tournament);
  }

  return removedTournamentIds;
}

async function leaveTournament({ tournamentId, session }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  const hasStarted = hasStartedTournament(tournament);
  const isCompletedTournament = tournament.state === 'completed' || tournament.state === 'cancelled';
  if (canManageTournament(tournament, session.userId)) {
    const hostUserId = String(session.userId || '');
    const hostPlayerIndex = findMemberIndex(tournament.players, hostUserId);
    if (hostPlayerIndex >= 0) {
      tournament.players.splice(hostPlayerIndex, 1);
    }
    const hostViewerIndex = findMemberIndex(tournament.viewers, hostUserId);
    if (hostViewerIndex >= 0) {
      tournament.viewers.splice(hostViewerIndex, 1);
    }
    tournament.host = null;
    if (!hasStarted) {
      removeHistoricalTournamentPlayer(tournament, hostUserId);
      if (tournament.players.length === 0 && tournament.viewers.length === 0) {
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
      emitTournamentUpdated(tournament);
      return cloneTournament(tournament);
    }

    if (isCompletedTournament) {
      clearTournamentEliminationBreakTimer(tournament.id);
      await persistTournamentSnapshot(tournament);
      emitTournamentUpdated(tournament);
      return cloneTournament(tournament);
    }

    await persistTournamentSnapshot(tournament);
    emitTournamentUpdated(tournament);
    return cloneTournament(tournament);
  }

  const playerIndex = findMemberIndex(tournament.players, session.userId);
  if (playerIndex >= 0) {
    tournament.players.splice(playerIndex, 1);
  }

  const viewerIndex = findMemberIndex(tournament.viewers, session.userId);
  const removedViewer = viewerIndex >= 0;
  if (viewerIndex >= 0) {
    tournament.viewers.splice(viewerIndex, 1);
  }

  if (!hasStarted) {
    removeHistoricalTournamentPlayer(tournament, session.userId);
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

  if (isCompletedTournament) {
    await persistTournamentSnapshot(tournament);
    emitTournamentUpdated(tournament);
    return cloneTournament(tournament);
  }

  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
  return cloneTournament(tournament);
}

async function cancelTournament({ tournamentId, session }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!canManageTournament(tournament, session.userId)) {
    const err = new Error('Only host can cancel the tournament.');
    err.statusCode = 403;
    throw err;
  }
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
  tournament.state = 'cancelled';
  tournament.phase = 'completed';
  tournament.completedAt = nowIso();
  clearTournamentEliminationBreakTimer(tournament.id);
  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
  return cloneTournament(tournament);
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

  const entryId = makeId('bot');
  const ensuredBot = await ensureBotUserInstance({
    difficulty: definition.id,
    instanceKey: `${tournament.id}_${entryId}`,
  });
  const botUserId = String(ensuredBot?.user?._id || '');
  if (!botUserId) {
    const err = new Error('Unable to register bot participant.');
    err.statusCode = 500;
    throw err;
  }

  const name = normalizeDisplayName(botName, `${definition.label} Bot`);
  const preTournamentElo = await resolveUserPreTournamentElo(botUserId);

  const botPlayerEntry = {
    entryId,
    type: 'bot',
    userId: botUserId,
    username: name,
    difficulty: definition.id,
    preTournamentElo,
    seed: null,
    joinedAt: nowIso(),
  };
  tournament.players.push(botPlayerEntry);
  upsertHistoricalTournamentPlayer(tournament, botPlayerEntry);
  tournament.viewers = (Array.isArray(tournament.viewers) ? tournament.viewers : [])
    .filter((entry) => String(entry.userId || '') !== botUserId);

  await ensureInternalBotClient({
    difficulty: definition.id,
    userId: botUserId,
    token: ensuredBot?.token || null,
  });

  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
  return cloneTournament(tournament);
}

async function kickTournamentPlayer({ tournamentId, session, targetUserId }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!canManageTournament(tournament, session.userId)) {
    const err = new Error('Only host can kick players.');
    err.statusCode = 403;
    throw err;
  }
  requireStartingState(tournament, 'Kick Player');
  const target = String(targetUserId || '').trim();
  if (!target) {
    const err = new Error('Player not found.');
    err.statusCode = 404;
    throw err;
  }
  if (String(tournament.host?.userId || '') === target) {
    const err = new Error('Host cannot be kicked.');
    err.statusCode = 400;
    throw err;
  }
  const playerIndex = findMemberIndex(tournament.players, target);
  if (playerIndex < 0) {
    const err = new Error('Player not found.');
    err.statusCode = 404;
    throw err;
  }
  const [removed] = tournament.players.splice(playerIndex, 1);
  removeHistoricalTournamentPlayer(tournament, target);
  tournament.viewers = (Array.isArray(tournament.viewers) ? tournament.viewers : [])
    .filter((entry) => String(entry.userId || '') !== target);
  tournament.removedPlayers = Array.isArray(tournament.removedPlayers) ? tournament.removedPlayers : [];
  const existing = tournament.removedPlayers.findIndex((entry) => String(entry.userId || '') === target);
  const removedEntry = {
    userId: target,
    username: removed?.username || 'Player',
    kickedAt: nowIso(),
  };
  if (existing >= 0) {
    tournament.removedPlayers[existing] = removedEntry;
  } else {
    tournament.removedPlayers.push(removedEntry);
  }
  queueTournamentAlert(target, `You were removed from tournament "${tournament.label}".`);
  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
  return cloneTournament(tournament);
}

async function reallowTournamentPlayer({ tournamentId, session, targetUserId }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!canManageTournament(tournament, session.userId)) {
    const err = new Error('Only host can re-allow players.');
    err.statusCode = 403;
    throw err;
  }
  requireStartingState(tournament, 'Re-allow Player');
  const target = String(targetUserId || '').trim();
  if (!target) {
    const err = new Error('Player not found.');
    err.statusCode = 404;
    throw err;
  }
  const existing = Array.isArray(tournament.removedPlayers)
    ? tournament.removedPlayers.findIndex((entry) => String(entry.userId || '') === target)
    : -1;
  if (existing < 0) {
    const err = new Error('Player not found.');
    err.statusCode = 404;
    throw err;
  }
  tournament.removedPlayers.splice(existing, 1);
  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
  return cloneTournament(tournament);
}

function buildMatchLabelFromPlayers(p1, p2) {
  const includesBot = p1.type === 'bot' || p2.type === 'bot';
  return { includesBot };
}

function getRoundRobinStartMs(tournament) {
  const startedAt = Date.parse(tournament?.roundRobinRoundsStartedAt || tournament?.startedAt || '');
  return Number.isFinite(startedAt) ? startedAt : null;
}

function getRoundRobinDeadlineMs(tournament) {
  const startedAt = getRoundRobinStartMs(tournament);
  if (!Number.isFinite(startedAt)) return null;
  const minutes = Number(tournament?.config?.roundRobinMinutes) || 15;
  return startedAt + (minutes * 60 * 1000);
}

function buildRoundRobinPairKey(userIdA, userIdB) {
  const left = String(userIdA || '');
  const right = String(userIdB || '');
  if (!left || !right) return '';
  return left < right ? `${left}::${right}` : `${right}::${left}`;
}

function compareRoundRobinPlayerOrder(left, right, gamesByUserId) {
  const leftGames = gamesByUserId.get(String(left?.userId || '')) || 0;
  const rightGames = gamesByUserId.get(String(right?.userId || '')) || 0;
  if (leftGames !== rightGames) return leftGames - rightGames;
  const leftJoined = Date.parse(left?.joinedAt || 0);
  const rightJoined = Date.parse(right?.joinedAt || 0);
  if (leftJoined !== rightJoined) return leftJoined - rightJoined;
  return String(left?.username || '').localeCompare(String(right?.username || ''));
}

function compareRoundRobinOpponentOrder(player, left, right, pairCounts, gamesByUserId) {
  const leftPairCount = pairCounts.get(buildRoundRobinPairKey(player?.userId, left?.userId)) || 0;
  const rightPairCount = pairCounts.get(buildRoundRobinPairKey(player?.userId, right?.userId)) || 0;
  if (leftPairCount !== rightPairCount) return leftPairCount - rightPairCount;

  const leftGames = gamesByUserId.get(String(left?.userId || '')) || 0;
  const rightGames = gamesByUserId.get(String(right?.userId || '')) || 0;
  if (leftGames !== rightGames) return leftGames - rightGames;

  const leftJoined = Date.parse(left?.joinedAt || 0);
  const rightJoined = Date.parse(right?.joinedAt || 0);
  if (leftJoined !== rightJoined) return leftJoined - rightJoined;

  return String(left?.username || '').localeCompare(String(right?.username || ''));
}

function buildRollingRoundRobinPairings(tournament, games = []) {
  const players = getActiveTournamentPlayers(tournament);
  const roundRobinGames = (Array.isArray(games) ? games : []).filter((game) => game?.phase === 'round_robin');
  const activeUserIds = new Set();
  const pairCounts = new Map();
  const gamesByUserId = new Map();

  roundRobinGames.forEach((game) => {
    const playersInGame = Array.isArray(game?.players) ? game.players : [];
    const userIds = playersInGame.map((player) => String(player?.userId || '')).filter(Boolean);
    if (userIds.length < 2) return;

    const pairKey = buildRoundRobinPairKey(userIds[0], userIds[1]);
    if (pairKey) {
      pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
    }

    userIds.forEach((userId) => {
      gamesByUserId.set(userId, (gamesByUserId.get(userId) || 0) + 1);
      if (game?.status !== 'completed') {
        activeUserIds.add(userId);
      }
    });
  });

  const available = players.filter((player) => !activeUserIds.has(String(player?.userId || '')));
  const pairings = [];
  const remaining = available.slice();

  while (remaining.length >= 2) {
    remaining.sort((left, right) => compareRoundRobinPlayerOrder(left, right, gamesByUserId));
    const player = remaining.shift();
    if (!player || remaining.length === 0) break;

    remaining.sort((left, right) => compareRoundRobinOpponentOrder(player, left, right, pairCounts, gamesByUserId));
    const opponent = remaining.shift();
    if (!opponent) break;

    pairings.push([player, opponent]);
    const pairKey = buildRoundRobinPairKey(player.userId, opponent.userId);
    if (pairKey) {
      pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
    }
    gamesByUserId.set(String(player.userId || ''), (gamesByUserId.get(String(player.userId || '')) || 0) + 1);
    gamesByUserId.set(String(opponent.userId || ''), (gamesByUserId.get(String(opponent.userId || '')) || 0) + 1);
  }

  return {
    pairings,
    activeGameCount: activeUserIds.size / 2,
  };
}

async function resolveTournamentGameSettings() {
  const config = await getServerConfig();
  const rankedClock = getClockSettingsForMatchType(config, 'RANKED');
  return {
    timeControl: rankedClock.timeControl,
    increment: rankedClock.increment,
  };
}

async function createTournamentMatch({ tournament, playerA, playerB, phase, gameSettings }) {
  const { includesBot } = buildMatchLabelFromPlayers(playerA, playerB);
  const type = phase === 'elimination'
    ? TOURNAMENT_MATCH_TYPES.ELIMINATION
    : TOURNAMENT_MATCH_TYPES.ROUND_ROBIN;
  const winScoreTarget = phase === 'elimination'
    ? (Number(tournament?.config?.victoryPoints) || 3)
    : 1;

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
    winScoreTarget,
  });

  const players = Math.random() < 0.5
    ? [playerA.userId, playerB.userId]
    : [playerB.userId, playerA.userId];
  const requiresAccept = shouldRequireTournamentAccept(match);
  const acceptWindowSeconds = requiresAccept ? 30 : 0;
  const game = await Game.create({
    players,
    match: match._id,
    timeControlStart: gameSettings.timeControl,
    increment: gameSettings.increment,
    playersReady: [false, false],
    requiresAccept,
    acceptWindowSeconds,
  });

  match.games = Array.isArray(match.games) ? match.games : [];
  match.games.push(String(game._id));
  await match.save();

  const gamePayload = typeof game.toObject === 'function' ? game.toObject() : game;
  const affectedUsers = players.map((id) => String(id));
  eventBus.emit('gameChanged', {
    game: gamePayload,
    affectedUsers,
  });
  eventBus.emit('players:bothNext', {
    game: gamePayload,
    affectedUsers,
    currentGameNumber: 1,
    tournamentId: tournament.id,
    tournamentPhase: normalizeTournamentPhaseLabel(phase),
    requiresAccept,
    acceptWindowSeconds,
  });
  eventBus.emit('match:created', {
    matchId: String(match._id),
    players: affectedUsers,
    type: match.type,
  });

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
    status: requiresAccept ? 'pending_accept' : 'live',
    includesBot,
  };
}

async function launchRoundRobinPairings(tournament, pairings, gameSettings) {
  if (!Array.isArray(pairings) || pairings.length === 0) return [];
  const generated = [];
  for (const pair of pairings) {
    const [playerA, playerB] = Array.isArray(pair) ? pair : [];
    if (!playerA || !playerB) continue;
    generated.push(await createTournamentMatch({
      tournament,
      playerA,
      playerB,
      phase: 'round_robin',
      gameSettings,
    }));
  }
  return generated;
}

async function maybeAdvanceTournamentRoundRobin(tournamentId) {
  const id = String(tournamentId || '');
  if (!id) return;
  if (ROUND_ROBIN_SCHEDULING.has(id)) return;
  ROUND_ROBIN_SCHEDULING.add(id);
  try {
  const tournament = TOURNAMENTS.get(id);
  if (!tournament || tournament.state !== 'active' || tournament.phase !== 'round_robin') return;
  const games = await listTournamentGames(tournament.id, { skipLifecycleAdvance: true });
  const roundRobinGames = games.filter((game) => game?.phase === 'round_robin');
  const activeGames = roundRobinGames.filter((game) => game?.status !== 'completed').length;
  const deadlineMs = getRoundRobinDeadlineMs(tournament);
  const pairingWindowClosed = Number.isFinite(deadlineMs) ? Date.now() >= deadlineMs : false;
  logTournamentFlow('round-robin-evaluate', {
    tournamentId: id,
    phase: tournament.phase,
    state: tournament.state,
    activeGames,
    roundRobinGameCount: roundRobinGames.length,
    pairingWindowClosed,
    deadlineMs: Number.isFinite(deadlineMs) ? deadlineMs : null,
  });

  if (pairingWindowClosed) {
    if (activeGames === 0) {
      tournament.phase = 'round_robin_complete';
      tournament.roundRobinCompletedAt = nowIso();
      tournament.eliminationStartsAt = new Date(getEliminationBreakDeadlineMs({
        ...tournament,
        roundRobinCompletedAt: tournament.roundRobinCompletedAt,
      }) || Date.now()).toISOString();
      await persistTournamentSnapshot(tournament);
      emitTournamentUpdated(tournament);
      scheduleTournamentEliminationBreak(tournament);
      await maybeAdvanceTournamentEliminationBreak(tournament.id);
      logTournamentFlow('round-robin-complete', {
        tournamentId: id,
        roundRobinCompletedAt: tournament.roundRobinCompletedAt,
        eliminationStartsAt: tournament.eliminationStartsAt,
      });
    }
    return;
  }

  const { pairings } = buildRollingRoundRobinPairings(tournament, roundRobinGames);
  if (!pairings.length) {
    logTournamentFlow('round-robin-no-pairings', {
      tournamentId: id,
      activeGames,
      roundRobinGameCount: roundRobinGames.length,
    });
    return;
  }

  const gameSettings = await resolveTournamentGameSettings();
  const generatedMatches = await launchRoundRobinPairings(tournament, pairings, gameSettings);
  tournament.matchIds = [
    ...(Array.isArray(tournament.matchIds) ? tournament.matchIds : []),
    ...generatedMatches.map((item) => item.matchId),
  ];
  tournament.gameIds = [
    ...(Array.isArray(tournament.gameIds) ? tournament.gameIds : []),
    ...generatedMatches.map((item) => item.gameId).filter(Boolean),
  ];
  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
  logTournamentFlow('round-robin-pairings-created', {
    tournamentId: id,
    createdMatchIds: generatedMatches.map((item) => item.matchId),
    createdGameIds: generatedMatches.map((item) => item.gameId),
  });
  } finally {
    ROUND_ROBIN_SCHEDULING.delete(id);
  }
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
  tournament.currentRoundRobinRound = 0;
  tournament.roundRobinRounds = [];
  tournament.roundRobinRoundsStartedAt = tournament.startedAt;
  tournament.roundRobinCompletedAt = null;
  tournament.eliminationStartsAt = null;
  tournament.eliminationBracket = null;
  clearTournamentEliminationBreakTimer(tournament.id);
  await ensureTournamentBotClients(tournament);
  const gameSettings = await resolveTournamentGameSettings();
  const { pairings } = buildRollingRoundRobinPairings(tournament, []);
  const generatedMatches = await launchRoundRobinPairings(tournament, pairings, gameSettings);

  tournament.matchIds = generatedMatches.map((item) => item.matchId);
  tournament.gameIds = generatedMatches.map((item) => item.gameId).filter(Boolean);

  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
  return cloneTournament(tournament);
}

async function ensureTournamentBotClients(tournament) {
  const players = Array.isArray(tournament?.players) ? tournament.players : [];
  for (const player of players) {
    if (player?.type !== 'bot' || !player?.userId) continue;
    await ensureInternalBotClient({
      difficulty: player.difficulty || 'easy',
      userId: String(player.userId),
    });
  }
}

async function transferTournamentHost({ tournamentId, session, targetUserId }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!canManageTournament(tournament, session.userId)) {
    const err = new Error('Only host can transfer the tournament.');
    err.statusCode = 403;
    throw err;
  }

  const target = String(targetUserId || '').trim();
  const successor = getHostTransferCandidates(tournament, session.userId)
    .find((entry) => String(entry?.userId || '') === target);
  if (!successor) {
    const err = new Error('Select an active tournament player as the next host.');
    err.statusCode = 400;
    throw err;
  }

  tournament.host = {
    userId: String(successor.userId),
    username: successor.username || 'Tournament Host',
    isGuest: Boolean(successor.isGuest),
  };
  await persistTournamentSnapshot(tournament);
  return cloneTournament(tournament);
}

async function updateTournamentMessage({ tournamentId, session, message }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!canManageTournament(tournament, session.userId)) {
    const err = new Error('Only host can update the tournament message.');
    err.statusCode = 403;
    throw err;
  }
  tournament.message = normalizeDisplayName(message, '').slice(0, 500);
  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
  return cloneTournament(tournament);
}

function buildParticipantView(tournament, games = []) {
  const participantSource = (tournament?.state === 'completed' || tournament?.phase === 'completed')
    ? getTournamentHistoricalPlayers(tournament)
    : (Array.isArray(tournament?.players) ? tournament.players : []);
  const standings = buildRoundRobinStandings(participantSource, games);
  const activeGameByUserId = new Map();

  (Array.isArray(games) ? games : [])
    .filter((game) => game && game.status !== 'completed')
    .forEach((game) => {
      const players = Array.isArray(game.players) ? game.players : [];
      players.forEach((player, index) => {
        const userId = String(player?.userId || '');
        if (!userId || activeGameByUserId.has(userId)) return;
        const opponent = players[index === 0 ? 1 : 0] || null;
        activeGameByUserId.set(userId, {
          gameId: game.gameId,
          matchId: game.matchId,
          phase: game.phase,
          status: game.status,
          color: index,
          requiresAccept: Boolean(game?.requiresAccept && game?.playersReady?.[index] === false),
          acceptWindowSeconds: Number.isFinite(Number(game?.acceptWindowSeconds))
            ? Math.max(0, Number(game.acceptWindowSeconds))
            : 0,
          isReady: Boolean(game?.playersReady?.[index]),
          opponentUserId: opponent?.userId || null,
          opponentUsername: opponent?.username || 'Opponent',
        });
      });
    });

  const byUserId = standings.byUserId;
  const participants = participantSource.map((player) => {
    const userId = String(player?.userId || '');
    const standing = byUserId.get(userId) || {
      wins: 0,
      losses: 0,
      draws: 0,
      totalGames: 0,
      points: 0,
      buchholz: 0,
      sonnebornBerger: 0,
      headToHeadPoints: 0,
      performanceRating: Number.isFinite(Number(player?.preTournamentElo)) ? Number(player.preTournamentElo) : 800,
      computedSeed: null,
      preTournamentElo: Number.isFinite(Number(player?.preTournamentElo)) ? Number(player.preTournamentElo) : 800,
    };
    return {
      entryId: player?.entryId || null,
      userId,
      username: player?.username || 'Player',
      type: player?.type || 'human',
      difficulty: player?.difficulty || null,
      seed: toOptionalFiniteNumber(player?.seed) ?? standing.computedSeed ?? null,
      wins: Number(standing.wins || 0),
      losses: Number(standing.losses || 0),
      draws: Number(standing.draws || 0),
      totalGames: Number(standing.totalGames || 0),
      points: Number.isFinite(Number(standing.points)) ? Number(standing.points) : 0,
      buchholz: Number.isFinite(Number(standing.buchholz)) ? Number(standing.buchholz) : 0,
      sonnebornBerger: Number.isFinite(Number(standing.sonnebornBerger)) ? Number(standing.sonnebornBerger) : 0,
      headToHeadPoints: Number.isFinite(Number(standing.headToHeadPoints)) ? Number(standing.headToHeadPoints) : 0,
      performanceRating: Number.isFinite(Number(standing.performanceRating)) ? Number(standing.performanceRating) : 800,
      preTournamentElo: Number.isFinite(Number(standing.preTournamentElo)) ? Number(standing.preTournamentElo) : 800,
      activeGame: activeGameByUserId.get(userId) || null,
    };
  });

  participants.sort((left, right) => {
    const leftSeed = toOptionalFiniteNumber(left?.seed) ?? Number.MAX_SAFE_INTEGER;
    const rightSeed = toOptionalFiniteNumber(right?.seed) ?? Number.MAX_SAFE_INTEGER;
    if (leftSeed !== rightSeed) return leftSeed - rightSeed;
    return String(left?.username || '').localeCompare(String(right?.username || ''));
  });

  return participants;
}

function getBracketCollections(bracket) {
  if (!bracket) return [];
  const winnersRounds = Array.isArray(bracket?.winnersRounds)
    ? bracket.winnersRounds
    : (Array.isArray(bracket?.rounds) ? bracket.rounds : []);
  const collections = [];
  if (winnersRounds.length) {
    collections.push({ key: 'winnersRounds', rounds: winnersRounds });
  }
  if (Array.isArray(bracket?.losersRounds) && bracket.losersRounds.length) {
    collections.push({ key: 'losersRounds', rounds: bracket.losersRounds });
  }
  if (Array.isArray(bracket?.finalsRounds) && bracket.finalsRounds.length) {
    collections.push({ key: 'finalsRounds', rounds: bracket.finalsRounds });
  }
  return collections;
}

function iterateBracketMatches(bracket, visitor) {
  getBracketCollections(bracket).forEach(({ key, rounds }) => {
    rounds.forEach((round, roundIndex) => {
      (Array.isArray(round?.matches) ? round.matches : []).forEach((match, matchIndex) => {
        visitor(match, { key, round, roundIndex, matchIndex });
      });
    });
  });
}

function findBracketMatchByRef(bracket, source) {
  if (!source?.section) return null;
  const rounds = Array.isArray(bracket?.[source.section]) ? bracket[source.section] : [];
  return rounds?.[Number(source.roundIndex)]?.matches?.[Number(source.matchIndex)] || null;
}

function resolveLoserFromBracketMatch(match) {
  if (!match?.winner?.userId) return null;
  const winnerId = String(match.winner.userId);
  const playerAId = String(match?.playerA?.userId || '');
  const playerBId = String(match?.playerB?.userId || '');
  if (playerAId && playerBId) {
    return winnerId === playerAId ? match.playerB : (winnerId === playerBId ? match.playerA : null);
  }
  return null;
}

function resolveBracketSourceEntrant(bracket, source) {
  if (!source) {
    return { resolved: true, entrant: null };
  }
  const upstreamMatch = findBracketMatchByRef(bracket, source);
  if (!upstreamMatch) {
    return { resolved: true, entrant: null };
  }
  if (!upstreamMatch?.winner?.userId) {
    return { resolved: false, entrant: null };
  }
  if (source.outcome === 'winner') {
    return { resolved: true, entrant: cloneBracketEntrantFromPlayer(upstreamMatch.winner) };
  }
  if (source.outcome === 'loser') {
    const loser = resolveLoserFromBracketMatch(upstreamMatch);
    return { resolved: true, entrant: loser ? cloneBracketEntrantFromPlayer(loser) : null };
  }
  return { resolved: true, entrant: null };
}

function isEntrantInMatch(match, entrant) {
  const entrantId = String(entrant?.userId || '');
  if (!entrantId) return false;
  return String(match?.playerA?.userId || '') === entrantId || String(match?.playerB?.userId || '') === entrantId;
}

function syncEliminationBracket(tournament) {
  const bracket = tournament?.eliminationBracket;
  if (!bracket) return;

  iterateBracketMatches(bracket, (match, { round }) => {
    if (!match) return;

    const sourceA = resolveBracketSourceEntrant(bracket, match.sourceA);
    const sourceB = resolveBracketSourceEntrant(bracket, match.sourceB);
    if (match.sourceA) {
      match.playerA = sourceA.resolved ? cloneBracketEntrantFromPlayer(sourceA.entrant) : null;
    }
    if (match.sourceB) {
      match.playerB = sourceB.resolved ? cloneBracketEntrantFromPlayer(sourceB.entrant) : null;
    }

    const sourcesResolved = (!match.sourceA || sourceA.resolved) && (!match.sourceB || sourceB.resolved);
    const hasA = Boolean(match?.playerA?.userId);
    const hasB = Boolean(match?.playerB?.userId);

    if (match?.winner?.userId && !isEntrantInMatch(match, match.winner)) {
      match.winner = null;
    }

    if (match.finalStage === 'reset_final' && round?.active === false && !match.winner?.userId) {
      match.status = 'waiting';
      match.matchId = null;
      match.gameId = null;
      return;
    }

    if (match?.winner?.userId) {
      match.status = 'completed';
      return;
    }

    if (!sourcesResolved) {
      match.status = 'waiting';
      match.matchId = null;
      match.gameId = null;
      return;
    }

    if ((hasA && !hasB) || (!hasA && hasB)) {
      match.winner = cloneBracketEntrantFromPlayer(hasA ? match.playerA : match.playerB);
      match.status = 'bye';
      match.matchId = null;
      match.gameId = null;
      return;
    }

    if (hasA && hasB) {
      match.status = match.matchId ? 'series' : 'pending';
      return;
    }

    match.status = 'waiting';
    match.matchId = null;
    match.gameId = null;
  });
}

function buildBracketView(tournament, games = []) {
  const sourceBracket = tournament?.eliminationBracket;
  if (!sourceBracket) {
    return null;
  }

  const bracket = JSON.parse(JSON.stringify(sourceBracket));
  const activeGameByMatchId = new Map();
  (Array.isArray(games) ? games : [])
    .filter((game) => game?.phase === 'elimination')
    .forEach((game) => {
      const matchId = String(game?.matchId || '');
      if (!matchId) return;
      const existing = activeGameByMatchId.get(matchId);
      if (game?.status !== 'completed') {
        activeGameByMatchId.set(matchId, game);
        return;
      }
      if (!existing) {
        activeGameByMatchId.set(matchId, game);
      }
    });

  iterateBracketMatches(bracket, (match) => {
    const liveGame = match?.matchId ? activeGameByMatchId.get(String(match.matchId)) : null;
    let status = match?.status || 'waiting';
    if (match?.winner?.userId) {
      status = 'completed';
    } else if (liveGame?.status && liveGame.status !== 'completed') {
      status = 'active';
    } else if (match?.playerA?.userId && match?.playerB?.userId && match?.matchId) {
      status = 'series';
    } else if (match?.playerA?.userId && match?.playerB?.userId) {
      status = 'pending';
    }
    match.status = status;
    match.playerAScore = Number(liveGame?.player1Score || 0);
    match.playerBScore = Number(liveGame?.player2Score || 0);
    match.winScoreTarget = Number(liveGame?.winScoreTarget || tournament?.config?.victoryPoints || 0);
    match.gameId = liveGame?.gameId || match?.gameId || null;
  });

  if (Array.isArray(bracket.winnersRounds)) {
    bracket.rounds = bracket.winnersRounds;
  } else if (Array.isArray(bracket.rounds)) {
    bracket.winnersRounds = bracket.rounds;
  }

  return bracket;
}

function computeTournamentRoundLabel(tournament, bracket) {
  if (tournament?.state === 'starting') {
    return 'Lobby';
  }
  if (tournament?.phase === 'round_robin') {
    return 'Rolling Pairings';
  }
  if (tournament?.phase === 'round_robin_complete') {
    return tournament?.eliminationStartsAt ? 'Break' : 'Awaiting Elimination';
  }
  if (tournament?.phase === 'elimination') {
    const rounds = [
      ...(Array.isArray(bracket?.finalsRounds) ? bracket.finalsRounds.filter((round) => round?.active !== false || round?.matches?.some((match) => match?.winner || match?.playerA || match?.playerB)) : []),
      ...(Array.isArray(bracket?.winnersRounds) ? bracket.winnersRounds : []),
      ...(Array.isArray(bracket?.losersRounds) ? bracket.losersRounds : []),
      ...(!Array.isArray(bracket?.winnersRounds) && Array.isArray(bracket?.rounds) ? bracket.rounds : []),
    ];
    const activeRound = rounds.find((round) => (Array.isArray(round.matches) ? round.matches : []).some((match) => match?.status !== 'completed'));
    return activeRound?.label || getRoundLabel(0, rounds.length || 1);
  }
  if (tournament?.phase === 'completed' || tournament?.state === 'completed') {
    return 'Tournament Complete';
  }
  return 'Tournament';
}

function isRoundRobinWaitingForGames(tournament, games = []) {
  if (tournament?.phase !== 'round_robin') return false;
  const deadlineMs = getRoundRobinDeadlineMs(tournament);
  if (!Number.isFinite(deadlineMs) || Date.now() < deadlineMs) return false;
  return (Array.isArray(games) ? games : []).some((game) => (
    game?.phase === 'round_robin' && game?.status !== 'completed'
  ));
}

function buildTournamentClientState(tournament, games = [], { session } = {}) {
  const cloned = cloneTournament(tournament);
  const role = getTournamentMembershipRole(tournament, session?.userId);
  const participants = buildParticipantView(tournament, games);
  const bracket = buildBracketView(tournament, games);
  const currentUserGame = participants.find((entry) => String(entry.userId || '') === String(session?.userId || ''))?.activeGame || null;
  const roundRobinWaitingForGames = isRoundRobinWaitingForGames(tournament, games);

  return {
    tournament: {
      ...cloned,
      participants,
      viewerCount: Array.isArray(tournament?.viewers) ? tournament.viewers.length : 0,
      canStartElimination: canManageTournament(tournament, session?.userId) && tournament?.phase === 'round_robin_complete',
      canEditBreakTime: canManageTournament(tournament, session?.userId)
        && (tournament?.state === 'starting' || tournament?.phase === 'round_robin'),
      settingsLocked: tournament?.state !== 'starting',
      currentRoundLabel: computeTournamentRoundLabel(tournament, bracket),
      currentUserGame,
      roundRobinWaitingForGames,
      bracket,
    },
    games,
    role,
    serverNowMs: Date.now(),
  };
}

function cloneBracketEntrantFromPlayer(player, fallbackSeed = null) {
  if (!player?.userId) return null;
  const seed = toOptionalFiniteNumber(player.seed);
  const fallback = toOptionalFiniteNumber(fallbackSeed);
  const preTournamentElo = Number.isFinite(Number(player?.preTournamentElo))
    ? Number(player.preTournamentElo)
    : null;
  return {
    entryId: player.entryId || null,
    userId: String(player.userId),
    username: player.username || 'Player',
    seed: seed ?? fallback ?? null,
    preTournamentElo,
    type: player.type || 'human',
    difficulty: player.difficulty || null,
  };
}

function findBracketMatchById(bracket, matchId) {
  const target = String(matchId || '');
  if (!target) return null;
  let found = null;
  iterateBracketMatches(bracket, (match) => {
    if (found) return;
    if (String(match?.matchId || '') === target) {
      found = match;
    }
  });
  return found;
}

async function launchPendingEliminationMatches(tournament) {
  if (!tournament?.eliminationBracket) return;
  const gameSettings = await resolveTournamentGameSettings();
  const pendingMatches = [];
  iterateBracketMatches(tournament.eliminationBracket, (bracketMatch, { round }) => {
    if (!bracketMatch) return;
    if (bracketMatch.finalStage === 'reset_final' && round?.active === false) return;
    pendingMatches.push(bracketMatch);
  });

  for (const bracketMatch of pendingMatches) {
    if (bracketMatch?.winner?.userId) continue;
    if (bracketMatch?.matchId) continue;
    if (!bracketMatch?.playerA?.userId || !bracketMatch?.playerB?.userId) continue;
    const generated = await createTournamentMatch({
      tournament,
      playerA: bracketMatch.playerA,
      playerB: bracketMatch.playerB,
      phase: 'elimination',
      gameSettings,
    });
    bracketMatch.matchId = generated.matchId;
    bracketMatch.gameId = generated.gameId;
    bracketMatch.status = 'active';
    tournament.matchIds = Array.isArray(tournament.matchIds) ? tournament.matchIds : [];
    tournament.gameIds = Array.isArray(tournament.gameIds) ? tournament.gameIds : [];
    if (!tournament.matchIds.includes(generated.matchId)) tournament.matchIds.push(generated.matchId);
    if (generated.gameId && !tournament.gameIds.includes(generated.gameId)) tournament.gameIds.push(generated.gameId);
  }
}

function completeTournamentIfBracketFinished(tournament) {
  const bracket = tournament?.eliminationBracket;
  if (!bracket) return false;

  let champion = null;
  if (bracket.type === 'double') {
    const grandFinal = bracket?.finalsRounds?.[0]?.matches?.[0] || null;
    const resetRound = bracket?.finalsRounds?.[1] || null;
    const resetFinal = resetRound?.matches?.[0] || null;
    if (resetRound?.active === true) {
      if (!resetFinal?.winner?.userId) return false;
      champion = resetFinal.winner;
    } else {
      if (!grandFinal?.winner?.userId) return false;
      const lowerSource = resolveBracketSourceEntrant(bracket, grandFinal.sourceB);
      const grandWinnerId = toIdString(grandFinal.winner?.userId);
      const lowerId = toIdString(lowerSource?.entrant?.userId);
      if (lowerId && grandWinnerId === lowerId) {
        return false;
      }
      champion = grandFinal.winner;
    }
  } else {
    const rounds = Array.isArray(bracket?.winnersRounds) ? bracket.winnersRounds : (Array.isArray(bracket?.rounds) ? bracket.rounds : []);
    if (!rounds.length) return false;
    const finalRound = rounds[rounds.length - 1];
    const finalMatch = Array.isArray(finalRound?.matches) ? finalRound.matches[0] : null;
    if (!finalMatch?.winner?.userId) return false;
    champion = finalMatch.winner;
  }

  if (!champion?.userId) return false;
  clearTournamentEliminationBreakTimer(tournament.id);
  tournament.state = 'completed';
  tournament.phase = 'completed';
  tournament.completedAt = nowIso();
  return true;
}

async function startEliminationInternal(tournament) {
  if (!tournament || tournament.state !== 'active' || tournament.phase !== 'round_robin_complete') {
    return cloneTournament(tournament);
  }

  const games = await listTournamentGames(tournament.id, { skipLifecycleAdvance: true });
  const standings = buildRoundRobinStandings(tournament.players, games);
  const seedByUserId = new Map();
  standings.ranked.forEach((entry, index) => {
    seedByUserId.set(String(entry.userId), index + 1);
  });

  tournament.players = (Array.isArray(tournament.players) ? tournament.players : []).map((player) => ({
    ...player,
    seed: seedByUserId.get(String(player?.userId || '')) || null,
  }));

  const seededEntrants = tournament.players
    .map((player) => cloneBracketEntrantFromPlayer(player))
    .filter(Boolean)
    .sort((left, right) => Number(left.seed || 999) - Number(right.seed || 999));

  clearTournamentEliminationBreakTimer(tournament.id);
  tournament.phase = 'elimination';
  tournament.eliminationStartsAt = null;
  tournament.eliminationBracket = tournament.config?.eliminationStyle === 'double'
    ? buildDoubleEliminationBracket(seededEntrants)
    : buildSingleEliminationBracket(seededEntrants);
  syncEliminationBracket(tournament);
  await ensureTournamentBotClients(tournament);
  await launchPendingEliminationMatches(tournament);
  completeTournamentIfBracketFinished(tournament);
  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
  return cloneTournament(tournament);
}

async function maybeAdvanceTournamentEliminationBreak(tournamentId) {
  const id = String(tournamentId || '');
  if (!id) return null;
  const tournament = TOURNAMENTS.get(id);
  if (!tournament || tournament.state !== 'active' || tournament.phase !== 'round_robin_complete') {
    clearTournamentEliminationBreakTimer(id);
    return null;
  }
  const deadlineMs = getEliminationBreakDeadlineMs(tournament);
  if (!Number.isFinite(deadlineMs)) {
    clearTournamentEliminationBreakTimer(id);
    return null;
  }
  if (Date.now() < deadlineMs) {
    scheduleTournamentEliminationBreak(tournament);
    return cloneTournament(tournament);
  }
  return startEliminationInternal(tournament);
}

async function startElimination({ tournamentId, session }) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (!canManageTournament(tournament, session.userId)) {
    const err = new Error('Only host can move the tournament into elimination.');
    err.statusCode = 403;
    throw err;
  }
  if (tournament.state !== 'active' || tournament.phase !== 'round_robin_complete') {
    const err = new Error('Elimination can only start after round robin is complete.');
    err.statusCode = 400;
    throw err;
  }
  return startEliminationInternal(tournament);
}

async function updateTournamentAfterEliminationMatchEnd(tournamentId, matchId) {
  const tournament = TOURNAMENTS.get(String(tournamentId || ''));
  if (!tournament || tournament.phase !== 'elimination' || !tournament.eliminationBracket) return;

  const bracketMatch = findBracketMatchById(tournament.eliminationBracket, matchId);
  if (!bracketMatch) return;

  const match = await Match.findById(matchId);
  if (!match || match.isActive) return;

  const winnerId = toIdString(match.winner);
  if (!winnerId) {
    return;
  }

  const winnerPlayer = (Array.isArray(tournament.players) ? tournament.players : []).find((entry) => String(entry?.userId || '') === winnerId);
  if (!winnerPlayer) return;

  bracketMatch.winner = cloneBracketEntrantFromPlayer(winnerPlayer);
  bracketMatch.status = 'completed';
  if (tournament.eliminationBracket?.type === 'double' && bracketMatch.finalStage === 'grand_final') {
    const grandFinal = bracketMatch;
    const upperSource = resolveBracketSourceEntrant(tournament.eliminationBracket, grandFinal.sourceA);
    const lowerSource = resolveBracketSourceEntrant(tournament.eliminationBracket, grandFinal.sourceB);
    const upperId = toIdString(upperSource?.entrant?.userId);
    const lowerId = toIdString(lowerSource?.entrant?.userId);
    const resetRound = tournament.eliminationBracket?.finalsRounds?.[1] || null;
    const resetMatch = resetRound?.matches?.[0] || null;
    if (resetRound && resetMatch && lowerId && upperId && winnerId === lowerId) {
      resetRound.active = true;
      resetMatch.active = true;
      resetMatch.playerA = cloneBracketEntrantFromPlayer(upperSource.entrant);
      resetMatch.playerB = cloneBracketEntrantFromPlayer(lowerSource.entrant);
      resetMatch.winner = null;
      resetMatch.matchId = null;
      resetMatch.gameId = null;
      resetMatch.status = 'pending';
    }
  }
  syncEliminationBracket(tournament);
  await launchPendingEliminationMatches(tournament);
  completeTournamentIfBracketFinished(tournament);
  await persistTournamentSnapshot(tournament);
  emitTournamentUpdated(tournament);
}

async function getTournamentDetails(tournamentId, { session, accessMode = 'member' } = {}) {
  const tournament = await getTournamentOrThrow(tournamentId);
  if (accessMode === 'admin') {
    return cloneTournament(tournament);
  }
  if (session?.userId && isKickedFromTournament(tournament, session.userId)) {
    const err = new Error('You were removed from this tournament by the host.');
    err.statusCode = 403;
    throw err;
  }
  if (session?.userId && isTournamentMember(tournament, session.userId)) {
    return cloneTournament(tournament);
  }
  if (accessMode === 'history' && canAccessCompletedTournamentHistory(tournament, session?.userId)) {
    return cloneTournament(tournament);
  }
  if (accessMode === 'history') {
    const err = new Error('You can only open completed tournaments that you played in or hosted.');
    err.statusCode = 403;
    throw err;
  }
  if (session?.userId) {
    const err = new Error('You must join this tournament as player or viewer before opening details.');
    err.statusCode = 403;
    throw err;
  }
  const err = new Error('Tournament not found.');
  err.statusCode = 404;
  throw err;
}

async function getTournamentClientState(tournamentId, { session, accessMode = 'member' } = {}) {
  const tournament = await getTournamentDetails(tournamentId, { session, accessMode });
  const games = await listTournamentGames(tournamentId, { skipLifecycleAdvance: true });
  return buildTournamentClientState(tournament, games, { session });
}

async function getCurrentTournamentForSession({ session } = {}) {
  if (!session?.userId) {
    return { tournament: null, games: [], role: null };
  }
  const tournament = await findTournamentForUser(session.userId);
  if (!tournament) {
    return { tournament: null, games: [], role: null };
  }
  return getTournamentClientState(tournament.id, { session });
}

async function listTournamentGames(tournamentId, { skipLifecycleAdvance = false } = {}) {
  const tournament = await getTournamentOrThrow(tournamentId, { skipLifecycleAdvance });
  const items = [];
  const gameIds = new Set(Array.isArray(tournament.gameIds) ? tournament.gameIds.map((id) => String(id)) : []);
  const matchesById = new Map();
  if (Array.isArray(tournament.matchIds)) {
    for (const matchId of tournament.matchIds) {
      const match = await Match.findById(matchId);
      if (!match) continue;
      matchesById.set(String(match._id || matchId), match);
      if (!Array.isArray(match.games)) continue;
      match.games.forEach((id) => {
        if (id) gameIds.add(String(id));
      });
    }
  }
  for (const gameId of Array.from(gameIds)) {
    const game = await Game.findById(gameId);
    if (!game) continue;
    const matchId = game.match ? String(game.match) : '';
    const match = matchesById.get(matchId) || (game.match ? await Match.findById(game.match) : null);
    if (!match) continue;
    matchesById.set(String(match._id || matchId), match);
    const type = String(match.type || '').toUpperCase();
    const isElimination = type === TOURNAMENT_MATCH_TYPES.ELIMINATION;
    const requiresAccept = typeof game?.requiresAccept === 'boolean'
      ? Boolean(game.requiresAccept)
      : shouldRequireTournamentAccept(match);
    const playerIds = Array.isArray(game.players) ? game.players.map((id) => String(id)) : [];
    const p1 = tournament.players.find((entry) => String(entry.userId) === String(playerIds[0]));
    const p2 = tournament.players.find((entry) => String(entry.userId) === String(playerIds[1]));
    const includesBot = Boolean(p1?.type === 'bot' || p2?.type === 'bot');
    items.push({
      gameId: String(game._id),
      matchId: String(match._id),
      phase: isElimination ? 'elimination' : 'round_robin',
      status: game.isActive ? (requiresAccept ? 'pending_accept' : 'live') : 'completed',
      player1Score: Number(match.player1Score || 0),
      player2Score: Number(match.player2Score || 0),
      winScoreTarget: Number(match.winScoreTarget || 0),
      players: [
        {
          entryId: p1?.entryId || null,
          userId: p1?.userId ? String(p1.userId) : (playerIds[0] || null),
          username: p1?.username || 'Player 1',
          type: p1?.type || 'human',
          difficulty: p1?.difficulty || null,
        },
        {
          entryId: p2?.entryId || null,
          userId: p2?.userId ? String(p2.userId) : (playerIds[1] || null),
          username: p2?.username || 'Player 2',
          type: p2?.type || 'human',
          difficulty: p2?.difficulty || null,
        },
      ],
      eloImpact: isElimination ? Boolean(match.eloEligible) : false,
      reason: isElimination
        ? (match.eloEligible ? 'Elimination between human players affects ELO once per matchup.' : 'Elimination against bots never affects ELO.')
        : 'Round robin never affects ELO.',
      includesBot,
      requiresAccept,
      acceptWindowSeconds: Number.isFinite(Number(game.acceptWindowSeconds))
        ? Math.max(0, Number(game.acceptWindowSeconds))
        : (requiresAccept ? 30 : 0),
      startedAt: game.startTime ? new Date(game.startTime).toISOString() : null,
      endedAt: game.endTime ? new Date(game.endTime).toISOString() : null,
      winner: typeof game.winner === 'number' ? game.winner : null,
      winReason: game.winReason || null,
      playersReady: Array.isArray(game.playersReady) ? game.playersReady.map((entry) => Boolean(entry)) : [false, false],
    });
  }
  return items.sort((left, right) => {
    const leftStarted = Date.parse(left?.startedAt || 0);
    const rightStarted = Date.parse(right?.startedAt || 0);
    return rightStarted - leftStarted;
  });
}

async function listAllTournamentsForAdmin() {
  const cachedRows = Array.from(TOURNAMENTS.values()).map((entry) => cloneTournament(entry));
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    return cachedRows.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }
  if (!isMongoConnected()) {
    return cachedRows.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }
  const docs = await Tournament.find({}).sort({ createdAt: -1 }).lean();
  const byId = new Map();
  docs.forEach((doc) => {
    const normalized = fromTournamentDocument(doc);
    if (normalized?.id) byId.set(normalized.id, normalized);
  });
  cachedRows.forEach((row) => {
    if (row?.id) byId.set(String(row.id), row);
  });
  return Array.from(byId.values())
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
}

async function deleteTournamentForAdmin(tournamentId) {
  const normalizedId = String(tournamentId || '').trim();
  if (!normalizedId) {
    const err = new Error('Tournament not found.');
    err.statusCode = 404;
    throw err;
  }

  const cached = TOURNAMENTS.get(normalizedId);
  let tournament = cached || null;

  if (!tournament && process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID && isMongoConnected()) {
    const doc = await Tournament.findById(normalizedId).lean();
    if (doc) {
      tournament = fromTournamentDocument(doc);
    }
  }

  if (!tournament) {
    const err = new Error('Tournament not found.');
    err.statusCode = 404;
    throw err;
  }

  const matchIds = new Set(Array.isArray(tournament.matchIds) ? tournament.matchIds.map((id) => String(id)) : []);
  const gameIds = new Set(Array.isArray(tournament.gameIds) ? tournament.gameIds.map((id) => String(id)) : []);

  if (matchIds.size > 0) {
    const matchDocs = await Match.find({ _id: { $in: Array.from(matchIds) } }).select({ games: 1 }).lean();
    matchDocs.forEach((match) => {
      if (!Array.isArray(match?.games)) return;
      match.games.forEach((gameId) => {
        if (gameId) gameIds.add(String(gameId));
      });
    });
  }

  if (gameIds.size > 0) {
    await Game.deleteMany({ _id: { $in: Array.from(gameIds) } });
  }
  if (matchIds.size > 0) {
    await Match.deleteMany({ _id: { $in: Array.from(matchIds) } });
  }

  clearTournamentEliminationBreakTimer(normalizedId);
  TOURNAMENTS.delete(normalizedId);
  await removeTournamentSnapshot(normalizedId);
  return { id: normalizedId, deleted: true };
}

async function listCompletedTournamentsForUser({ session } = {}) {
  const userId = String(session?.userId || '');
  if (!userId) {
    return [];
  }

  const cachedRows = Array.from(TOURNAMENTS.values())
    .filter((entry) => entry?.state === 'completed' || entry?.phase === 'completed')
    .map((entry) => cloneTournament(entry));

  let rows = cachedRows;
  if (!(process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) && isMongoConnected()) {
    const docs = await Tournament.find({ state: 'completed' }).sort({ completedAt: -1, createdAt: -1 }).lean();
    const byId = new Map();
    docs.forEach((doc) => {
      const normalized = fromTournamentDocument(doc);
      if (normalized?.id) byId.set(normalized.id, normalized);
    });
    cachedRows.forEach((row) => {
      if (row?.id) byId.set(String(row.id), row);
    });
    rows = Array.from(byId.values());
  }

  const visibleRows = rows
    .filter((row) => canAccessCompletedTournamentHistory(row, userId))
    .sort((left, right) => {
      const leftCompleted = Date.parse(left?.completedAt || left?.createdAt || 0);
      const rightCompleted = Date.parse(right?.completedAt || right?.createdAt || 0);
      return rightCompleted - leftCompleted;
    });

  const historyRows = [];
  for (const row of visibleRows) {
    const clientState = await getTournamentClientState(row.id, { session, accessMode: 'history' });
    const placements = buildCompletedPlacements(clientState?.tournament?.participants, clientState?.tournament?.bracket);
    const placement = placements.find((entry) => String(entry?.participant?.userId || '') === userId) || null;
    const hosted = didUserCreateTournament(row, userId);
    const competed = didUserCompeteInTournament(row, userId);
    historyRows.push({
      id: row.id,
      label: row.label,
      state: row.state,
      phase: row.phase,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      hosted,
      competed,
      placement: Number.isInteger(placement?.position) ? placement.position : null,
      placementLabel: placement?.label || (hosted && !competed ? 'Hosted' : null),
    });
  }

  return historyRows;
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
  ELIMINATION_BREAK_SCHEDULING.forEach((handle) => clearTimeout(handle));
  ELIMINATION_BREAK_SCHEDULING.clear();
  TOURNAMENTS.clear();
  TOURNAMENT_ALERTS.clear();
}

eventBus.on('gameChanged', async (payload) => {
  try {
    let game = payload?.game;
    if (game && typeof game.toObject === 'function') {
      game = game.toObject();
    }
    if (!game || game.isActive) return;
    const matchId = String(game.match || '');
    if (!matchId) return;
    const match = await Match.findById(matchId).lean();
    if (!match?.tournamentId) return;
    logTournamentFlow('round-robin-game-changed', {
      tournamentId: String(match.tournamentId),
      matchId,
      gameId: String(game._id || ''),
      isActive: Boolean(game.isActive),
      winner: game.winner ?? null,
      winReason: game.winReason ?? null,
    });
    await maybeAdvanceTournamentRoundRobin(String(match.tournamentId));
  } catch (err) {
    console.error('Failed to advance tournament round robin after game change:', err);
  }
});

eventBus.on('match:ended', async (payload) => {
  try {
    const matchId = String(payload?.matchId || '');
    if (!matchId) return;
    const match = await Match.findById(matchId);
    if (!match?.tournamentId) return;
    await updateTournamentAfterEliminationMatchEnd(String(match.tournamentId), matchId);
  } catch (err) {
    console.error('Failed to advance tournament elimination after match end:', err);
  }
});

module.exports = {
  TOURNAMENT_MATCH_TYPES,
  isTournamentTestModeEnabled,
  listLiveTournaments,
  consumeTournamentAlerts,
  getTournamentDetails,
  getTournamentClientState,
  getCurrentTournamentForSession,
  isTournamentMember,
  createTournament,
  updateTournamentConfig,
  joinTournamentAsPlayer,
  joinTournamentAsViewer,
  removeTournamentViewerOnDisconnect,
  leaveTournament,
  cancelTournament,
  addBotToTournament,
  kickTournamentPlayer,
  reallowTournamentPlayer,
  startTournament,
  maybeAdvanceTournamentRoundRobin,
  maybeAdvanceTournamentEliminationBreak,
  startElimination,
  transferTournamentHost,
  updateTournamentMessage,
  listTournamentGames,
  listAllTournamentsForAdmin,
  listCompletedTournamentsForUser,
  deleteTournamentForAdmin,
  getTournamentBotDifficultyOptions,
  resetForTests,
};
