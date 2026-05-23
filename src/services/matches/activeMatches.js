const mongoose = require('mongoose');
const Match = require('../../models/Match');
const Tournament = require('../../models/Tournament');
const User = require('../../models/User');
const { toIdString } = require('../../models/inMemoryUtils');

const DEFAULT_ELO = 800;
const BOT_FALLBACK_NAME = 'Cloak Bot';
const ANONYMOUS_FALLBACK_NAME = 'Anonymous';
const OBJECT_ID_STRING_REGEX = /^[a-f\d]{24}$/i;

function normalizeId(value, seen = null) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'object') {
    const refs = seen || new WeakSet();
    if (refs.has(value)) {
      return null;
    }
    refs.add(value);
    if (Buffer.isBuffer(value)) {
      const hex = value.toString('hex').trim();
      return hex || null;
    }
    try {
      const direct = toIdString(value);
      if (direct) {
        const trimmedDirect = String(direct).trim();
        if (trimmedDirect && trimmedDirect !== '[object Object]') {
          return trimmedDirect;
        }
      }
    } catch (err) {
      // Fall through to candidate key extraction.
    }
    const candidateKeys = ['_id', 'id', 'userId', 'playerId'];
    for (const key of candidateKeys) {
      if (!(key in value)) continue;
      const normalizedCandidate = normalizeId(value[key], refs);
      if (normalizedCandidate) {
        return normalizedCandidate;
      }
    }
  }
  try {
    const str = toIdString(value);
    if (!str) return null;
    const trimmed = String(str).trim();
    if (!trimmed || trimmed === '[object Object]') {
      return null;
    }
    return trimmed;
  } catch (err) {
    return null;
  }
}

function parseNumericCandidate(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (typeof value === 'object') {
    if ('wins' in value) {
      const parsed = parseNumericCandidate(value.wins);
      if (parsed !== null) return parsed;
    }
    if ('count' in value) {
      const parsed = parseNumericCandidate(value.count);
      if (parsed !== null) return parsed;
    }
    if ('value' in value) {
      const parsed = parseNumericCandidate(value.value);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function resolveScoreValue(...values) {
  const candidates = [];
  values.forEach((value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('wins' in value) {
        const parsedWins = parseNumericCandidate(value.wins);
        if (parsedWins !== null) candidates.push(parsedWins);
      }
      if ('count' in value) {
        const parsedCount = parseNumericCandidate(value.count);
        if (parsedCount !== null) candidates.push(parsedCount);
      }
      if ('value' in value) {
        const parsedValue = parseNumericCandidate(value.value);
        if (parsedValue !== null) candidates.push(parsedValue);
      }
    }
    const parsed = parseNumericCandidate(value);
    if (parsed !== null) candidates.push(parsed);
  });

  if (candidates.length === 0) return 0;
  return Math.max(...candidates);
}

function resolveMatchType(source = {}) {
  const candidates = [
    source.type,
    source.matchType,
    source.mode,
    source.matchMode,
    source.gameMode,
    source?.settings?.type,
    source?.settings?.mode,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toUpperCase();
    }
  }
  return null;
}

function normalizeDisplayName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isObjectIdLikeString(value) {
  return typeof value === 'string' && OBJECT_ID_STRING_REGEX.test(value.trim());
}

function normalizeBotInstanceName(username) {
  const normalized = normalizeDisplayName(username);
  if (!normalized || isObjectIdLikeString(normalized)) return null;
  const match = normalized.match(/^(easy|medium|hard)bot_[a-f\d]+$/i);
  if (!match) return normalized;
  const difficulty = match[1].toLowerCase();
  return `${difficulty.charAt(0).toUpperCase()}${difficulty.slice(1)}Bot`;
}

function normalizeBotTypeLabel(value) {
  const normalized = normalizeDisplayName(value);
  if (!normalized) return null;
  const difficultyMatch = normalized.match(/^(easy|medium|hard)$/i);
  if (difficultyMatch) {
    const difficulty = difficultyMatch[1].toLowerCase();
    return `${difficulty.charAt(0).toUpperCase()}${difficulty.slice(1)}Bot`;
  }
  const botNameMatch = normalized.match(/^(easy|medium|hard)bot(?:_[a-f\d]+)?$/i);
  if (botNameMatch) {
    const difficulty = botNameMatch[1].toLowerCase();
    return `${difficulty.charAt(0).toUpperCase()}${difficulty.slice(1)}Bot`;
  }
  return null;
}

function compactNameForCompare(value) {
  return normalizeDisplayName(value)?.replace(/[^a-z\d]/gi, '').toLowerCase() || '';
}

function appendBotTypeLabel(displayName, botTypeLabel) {
  const name = normalizeDisplayName(displayName);
  const label = normalizeDisplayName(botTypeLabel);
  if (!name) return label || BOT_FALLBACK_NAME;
  if (!label || compactNameForCompare(name) === compactNameForCompare(label)) {
    return name;
  }
  return `${name} (${label})`;
}

function isBotMatchSlot(match, playerIndex) {
  const type = resolveMatchType(match);
  return type === 'AI' && playerIndex === 1;
}

function resolvePlayerDisplayName({ user = null, match = null, playerIndex = null, participant = null } = {}) {
  const participantName = normalizeDisplayName(participant?.username);
  const username = normalizeDisplayName(user?.username);
  const isBot = Boolean(user?.isBot) || participant?.type === 'bot' || isBotMatchSlot(match, playerIndex);

  if (isBot) {
    const botTypeLabel = normalizeBotTypeLabel(participant?.difficulty)
      || normalizeBotTypeLabel(user?.botDifficulty)
      || normalizeBotTypeLabel(username)
      || normalizeBotInstanceName(username)
      || BOT_FALLBACK_NAME;
    const displayName = participantName && !isObjectIdLikeString(participantName)
      ? participantName
      : botTypeLabel;
    return appendBotTypeLabel(displayName, botTypeLabel);
  }

  if (username && !isObjectIdLikeString(username)) {
    return username;
  }

  if (!user || user?.isGuest) {
    return ANONYMOUS_FALLBACK_NAME;
  }

  return null;
}

function extractPlayerIds(source = {}) {
  const ids = [];
  if (Array.isArray(source.players)) {
    source.players.forEach((playerId) => {
      const normalized = normalizeId(playerId);
      if (normalized) {
        ids.push(normalized);
      }
    });
  }

  if (ids.length === 0) {
    const p1 = normalizeId(source.player1);
    const p2 = normalizeId(source.player2);
    if (p1) ids.push(p1);
    if (p2) ids.push(p2);
  }

  const unique = [];
  ids.forEach((id) => {
    if (id && !unique.includes(id)) {
      unique.push(id);
    }
  });
  return unique;
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime());
  }
  if (value && typeof value.toDate === 'function') {
    const result = value.toDate();
    if (result instanceof Date && !Number.isNaN(result.getTime())) {
      return new Date(result.getTime());
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeActiveMatch(source = {}) {
  const id = normalizeId(source.id || source._id || source.matchId);
  if (!id) return null;

  const players = extractPlayerIds(source);
  const normalized = {
    id,
    type: resolveMatchType(source),
    players,
    player1Score: resolveScoreValue(
      source.player1Score,
      source.player1_score,
      source.scores?.[0],
      source.scores?.player1,
      source.results?.player1?.wins,
    ),
    player2Score: resolveScoreValue(
      source.player2Score,
      source.player2_score,
      source.scores?.[1],
      source.scores?.player2,
      source.results?.player2?.wins,
    ),
    drawCount: resolveScoreValue(
      source.drawCount,
      source.draws,
      source.scores?.[2],
      source.scores?.draws,
      source.results?.draws,
    ),
  };

  if (source.isActive !== undefined) {
    normalized.isActive = Boolean(source.isActive);
  }

  normalized.startTime = normalizeDate(source.startTime || source.startedAt);
  normalized.endTime = normalizeDate(source.endTime || source.endedAt);

  const player1Id = normalizeId(source.player1) || players[0] || null;
  const player2Id = normalizeId(source.player2) || players[1] || null;

  normalized.player1 = player1Id;
  normalized.player2 = player2Id;

  if (source.winner === null) {
    normalized.winner = null;
  } else {
    const winnerId = normalizeId(source.winner);
    if (winnerId) {
      normalized.winner = winnerId;
    }
  }

  const player1Start = parseNumericCandidate(source.player1StartElo);
  const player2Start = parseNumericCandidate(source.player2StartElo);
  const player1End = parseNumericCandidate(source.player1EndElo);
  const player2End = parseNumericCandidate(source.player2EndElo);

  normalized.player1StartElo = player1Start !== null ? player1Start : null;
  normalized.player2StartElo = player2Start !== null ? player2Start : null;
  normalized.player1EndElo = player1End !== null ? player1End : null;
  normalized.player2EndElo = player2End !== null ? player2End : null;
  normalized.isTutorial = Boolean(source.isTutorial);
  normalized.tournamentId = normalizeId(source.tournamentId) || null;
  normalized.tournamentPhase = typeof source.tournamentPhase === 'string' ? source.tournamentPhase : null;

  if (Array.isArray(source.games)) {
    normalized.games = source.games.slice();
  }

  return normalized;
}

function collectMatchUserIds(matches = []) {
  const ids = new Set();
  matches.forEach((match) => {
    if (!match) return;
    if (Array.isArray(match.players)) {
      match.players.forEach((id) => {
        const normalized = normalizeId(id);
        if (normalized) ids.add(normalized);
      });
    }
  });
  return Array.from(ids);
}

function collectTournamentIds(matches = []) {
  const ids = new Set();
  matches.forEach((match) => {
    const id = normalizeId(match?.tournamentId);
    if (id) ids.add(id);
  });
  return Array.from(ids);
}

function buildTournamentPlayerMap(tournaments = []) {
  const map = new Map();
  tournaments.forEach((tournament) => {
    const tournamentId = normalizeId(tournament?._id || tournament?.id);
    if (!tournamentId) return;
    const players = Array.isArray(tournament?.historicalPlayers) && tournament.historicalPlayers.length > 0
      ? tournament.historicalPlayers
      : (Array.isArray(tournament?.players) ? tournament.players : []);
    const playerMap = new Map();
    players.forEach((entry) => {
      const userId = normalizeId(entry?.userId);
      if (userId) playerMap.set(userId, entry);
    });
    map.set(tournamentId, playerMap);
  });
  return map;
}

function resolveEloValue(user, participant) {
  if (Number.isFinite(user?.elo)) return user.elo;
  if (Number.isFinite(participant?.preTournamentElo)) return participant.preTournamentElo;
  return DEFAULT_ELO;
}

function attachPlayerDetails(matches, userMap, tournamentPlayerMap = new Map()) {
  matches.forEach((match) => {
    if (!match) return;
    const players = Array.isArray(match.players) ? match.players : [];
    const player1Id = players[0] || null;
    const player2Id = players[1] || null;

    const player1User = player1Id ? userMap.get(player1Id) : null;
    const player2User = player2Id ? userMap.get(player2Id) : null;
    const tournamentId = normalizeId(match.tournamentId);
    const participantMap = tournamentId ? tournamentPlayerMap.get(tournamentId) : null;
    const player1Participant = player1Id && participantMap ? participantMap.get(player1Id) : null;
    const player2Participant = player2Id && participantMap ? participantMap.get(player2Id) : null;

    match.playerDetails = {
      player1: player1Id
        ? {
            id: player1Id,
            username: resolvePlayerDisplayName({ user: player1User, match, playerIndex: 0, participant: player1Participant }),
            elo: resolveEloValue(player1User, player1Participant),
            isBot: Boolean(player1User?.isBot) || player1Participant?.type === 'bot' || isBotMatchSlot(match, 0),
            botDifficulty: player1Participant?.difficulty || player1User?.botDifficulty || null,
            isGuest: Boolean(player1User?.isGuest) || !player1User,
          }
        : null,
      player2: player2Id
        ? {
            id: player2Id,
            username: resolvePlayerDisplayName({ user: player2User, match, playerIndex: 1, participant: player2Participant }),
            elo: resolveEloValue(player2User, player2Participant),
            isBot: Boolean(player2User?.isBot) || player2Participant?.type === 'bot' || isBotMatchSlot(match, 1),
            botDifficulty: player2Participant?.difficulty || player2User?.botDifficulty || null,
            isGuest: Boolean(player2User?.isGuest) || !player2User,
          }
        : null,
    };
  });
}

function normalizeStatus(status) {
  if (typeof status !== 'string') return 'completed';
  const value = status.trim().toLowerCase();
  if (!value) return 'completed';
  if (value === 'active' || value === 'live' || value === 'current') return 'active';
  if (value === 'all') return 'all';
  if (value === 'history' || value === 'finished' || value === 'complete') return 'completed';
  return value;
}

function normalizeMatchTypeFilter(type) {
  if (typeof type !== 'string') return null;
  const value = type.trim();
  if (!value) return null;
  const upper = value.toUpperCase();
  if (upper === 'BOT') return 'AI';
  return upper;
}

function buildMatchTypeCriteria(normalizedType) {
  if (!normalizedType) return null;
  return {
    $or: [
      { type: normalizedType },
      { matchType: normalizedType },
      { mode: normalizedType },
      { matchMode: normalizedType },
      { gameMode: normalizedType },
      { 'settings.type': normalizedType },
      { 'settings.mode': normalizedType },
    ],
  };
}

function buildMatchQuery({ status, userId, type }) {
  const normalizedStatus = normalizeStatus(status);
  const query = {};

  if (normalizedStatus === 'active') {
    query.isActive = true;
  } else if (normalizedStatus === 'all') {
    // no-op, include both active and completed
  } else {
    query.isActive = false;
  }

  const normalizedUserId = normalizeId(userId);
  if (normalizedUserId) {
    const values = [normalizedUserId];
    if (mongoose.Types.ObjectId.isValid(normalizedUserId)) {
      values.push(new mongoose.Types.ObjectId(normalizedUserId));
    }
    query.$or = [
      { player1: { $in: values } },
      { player2: { $in: values } },
    ];
  }

  const normalizedType = normalizeMatchTypeFilter(type);
  const typeCriteria = buildMatchTypeCriteria(normalizedType);
  if (typeCriteria) {
    if (!query.$and) {
      query.$and = [];
    }
    query.$and.push(typeCriteria);
  }

  return { query, normalizedStatus, normalizedType };
}

function buildSort(normalizedStatus) {
  if (normalizedStatus === 'active') {
    return { startTime: -1 };
  }
  if (normalizedStatus === 'all') {
    return { isActive: -1, endTime: -1, startTime: -1 };
  }
  return { endTime: -1, startTime: -1 };
}

async function fetchMatchList(options = {}) {
  const {
    status = 'completed',
    userId = null,
    includeUsers = false,
    limit = 50,
    page = 1,
    type = null,
  } = options;

  const { query, normalizedStatus } = buildMatchQuery({ status, userId, type });
  const sort = buildSort(normalizedStatus);

  const numericLimit = Number(limit);
  const safeLimit = Number.isFinite(numericLimit) && numericLimit > 0
    ? Math.min(Math.floor(numericLimit), 200)
    : 50;

  const numericPage = Number(page);
  const safePage = Number.isFinite(numericPage) && numericPage > 0
    ? Math.floor(numericPage)
    : 1;

  const skip = (safePage - 1) * safeLimit;

  let totalItems = 0;
  let rawMatches;

  if (normalizedStatus === 'active') {
    const activeMatches = await Match.find(query)
      .sort(sort)
      .lean();
    totalItems = Array.isArray(activeMatches) ? activeMatches.length : 0;
    rawMatches = Array.isArray(activeMatches)
      ? activeMatches.slice(skip, skip + safeLimit)
      : [];
  } else {
    const historyQuery = Match.historyModel.find(query)
      .sort(sort);

    if (safeLimit > 0) {
      historyQuery.skip(skip).limit(safeLimit);
    }

    const [historyMatches, count] = await Promise.all([
      historyQuery.lean(),
      Match.historyModel.countDocuments(query),
    ]);

    rawMatches = historyMatches;
    totalItems = count;
  }

  const totalPages = safeLimit > 0
    ? Math.ceil(totalItems / safeLimit) || (totalItems > 0 ? 1 : 0)
    : 1;

  const normalizedMatches = Array.isArray(rawMatches)
    ? rawMatches
        .map((match) => normalizeActiveMatch(match))
        .filter((match) => Boolean(match) && !match.isTutorial)
    : [];

  if (!includeUsers || normalizedMatches.length === 0) {
    return {
      items: normalizedMatches,
      pagination: {
        page: safePage,
        perPage: safeLimit,
        totalItems,
        totalPages,
      },
    };
  }

  const userIds = collectMatchUserIds(normalizedMatches);
  const validObjectIds = userIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

  let userMap = new Map();
  if (validObjectIds.length > 0) {
    const users = await User.find({ _id: { $in: validObjectIds } })
      .select('_id username elo isBot botDifficulty isGuest')
      .lean();
    userMap = new Map(users.map((user) => [user._id.toString(), user]));
  }

  const tournamentIds = collectTournamentIds(normalizedMatches);
  const validTournamentIds = tournamentIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  let tournamentPlayerMap = new Map();
  if (validTournamentIds.length > 0) {
    const tournaments = await Tournament.find({ _id: { $in: validTournamentIds } })
      .select('_id players historicalPlayers')
      .lean();
    tournamentPlayerMap = buildTournamentPlayerMap(tournaments);
  }

  attachPlayerDetails(normalizedMatches, userMap, tournamentPlayerMap);

  return {
    items: normalizedMatches,
    pagination: {
      page: safePage,
      perPage: safeLimit,
      totalItems,
      totalPages,
    },
  };
}

module.exports = {
  normalizeId,
  resolveScoreValue,
  resolveMatchType,
  normalizeActiveMatch,
  resolvePlayerDisplayName,
  buildTournamentPlayerMap,
  fetchMatchList,
  buildMatchQuery,
  normalizeStatus,
  normalizeMatchTypeFilter,
};
