function toIdString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    if (value && Object.prototype.hasOwnProperty.call(value, 'userId')) {
      return toIdString(value.userId);
    }
    if (value && Object.prototype.hasOwnProperty.call(value, '_id')) {
      return toIdString(value._id);
    }
    if (typeof value.toString === 'function') {
      try {
        const rendered = value.toString();
        return rendered === '[object Object]' ? '' : rendered;
      } catch (_) {
        return '';
      }
    }
  }
  return '';
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toOptionalFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function computeArenaPoints(entry) {
  return toFiniteNumber(entry?.wins) + (toFiniteNumber(entry?.draws) * 0.5);
}

function compareFiniteNumberAsc(left, right, fallback = 0) {
  const leftValue = toFiniteNumber(left, fallback);
  const rightValue = toFiniteNumber(right, fallback);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function compareFiniteNumberDesc(left, right, fallback = 0) {
  return compareFiniteNumberAsc(right, left, fallback);
}

function toTimestamp(value) {
  const timestamp = Date.parse(value || 0);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function compareStandingsEntries(left, right) {
  const byPoints = compareFiniteNumberDesc(left?.points, right?.points);
  if (byPoints !== 0) return byPoints;

  const byGamesPlayed = compareFiniteNumberAsc(left?.totalGames, right?.totalGames);
  if (byGamesPlayed !== 0) return byGamesPlayed;

  const byElo = compareFiniteNumberDesc(left?.preTournamentElo, right?.preTournamentElo, 800);
  if (byElo !== 0) return byElo;

  const byJoinTime = compareFiniteNumberAsc(toTimestamp(left?.joinedAt), toTimestamp(right?.joinedAt));
  if (byJoinTime !== 0) return byJoinTime;

  const leftRandom = toOptionalFiniteNumber(left?.seedTieBreaker);
  const rightRandom = toOptionalFiniteNumber(right?.seedTieBreaker);
  if (leftRandom < rightRandom) return -1;
  if (leftRandom > rightRandom) return 1;
  return 0;
}

function buildRoundRobinStandings(players = [], games = []) {
  const byUserId = new Map();
  const roster = Array.isArray(players) ? players : [];

  roster.forEach((player) => {
    const userId = toIdString(player?.userId);
    if (!userId) return;
    byUserId.set(userId, {
      entryId: player?.entryId || null,
      userId,
      username: player?.username || 'Player',
      type: player?.type || 'human',
      difficulty: player?.difficulty || null,
      preTournamentElo: toFiniteNumber(player?.preTournamentElo, 800),
      storedSeed: toOptionalFiniteNumber(player?.seed),
      joinedAt: player?.joinedAt || null,
      seedTieBreaker: toOptionalFiniteNumber(player?.seedTieBreaker) ?? Math.random(),
      wins: 0,
      losses: 0,
      draws: 0,
      totalGames: 0,
      points: 0,
    });
  });

  const finishedRoundRobinGames = (Array.isArray(games) ? games : []).filter((game) => {
    return game?.phase === 'round_robin' && game?.status === 'completed';
  });

  finishedRoundRobinGames.forEach((game) => {
    const playersInGame = Array.isArray(game?.players) ? game.players : [];
    const firstId = toIdString(playersInGame[0]?.userId);
    const secondId = toIdString(playersInGame[1]?.userId);
    const first = firstId ? byUserId.get(firstId) : null;
    const second = secondId ? byUserId.get(secondId) : null;
    if (!first || !second) return;

    first.totalGames += 1;
    second.totalGames += 1;

    const isDoubleNoShowLoss = String(game?.tournamentScoreOutcome || '') === 'double_no_show_loss';

    if (game?.winner === 0) {
      first.wins += 1;
      second.losses += 1;
    } else if (game?.winner === 1) {
      second.wins += 1;
      first.losses += 1;
    } else if (isDoubleNoShowLoss) {
      first.losses += 1;
      second.losses += 1;
    } else {
      first.draws += 1;
      second.draws += 1;
    }
  });

  const entries = Array.from(byUserId.values());
  entries.forEach((entry) => {
    entry.points = computeArenaPoints(entry);
  });

  const ranked = entries.slice().sort(compareStandingsEntries);

  ranked.forEach((entry, index) => {
    entry.computedSeed = index + 1;
  });

  return {
    entries,
    ranked,
    byUserId,
  };
}

module.exports = {
  toIdString,
  computeArenaPoints,
  compareStandingsEntries,
  buildRoundRobinStandings,
  toOptionalFiniteNumber,
};
