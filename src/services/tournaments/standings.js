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

function nearlyEqual(left, right, epsilon = 1e-9) {
  return Math.abs(toFiniteNumber(left) - toFiniteNumber(right)) <= epsilon;
}

function compareNumberDesc(left, right) {
  const delta = toFiniteNumber(right) - toFiniteNumber(left);
  if (delta < 0) return -1;
  if (delta > 0) return 1;
  return 0;
}

function compareNumberAsc(left, right) {
  const delta = toFiniteNumber(left) - toFiniteNumber(right);
  if (delta < 0) return -1;
  if (delta > 0) return 1;
  return 0;
}

function computePerformanceRating(entry) {
  const totalGames = toFiniteNumber(entry?.totalGames);
  if (totalGames <= 0) {
    return toFiniteNumber(entry?.preTournamentElo, 800);
  }
  const avgOpponentElo = toFiniteNumber(entry?._opponentRatingTotal) / Math.max(1, toFiniteNumber(entry?._opponentGameCount));
  const scoreFraction = toFiniteNumber(entry?.points) / totalGames;
  return avgOpponentElo + ((scoreFraction - 0.5) * 800);
}

function comparePrimaryStandingMetrics(left, right) {
  return compareNumberDesc(left?.points, right?.points)
    || compareNumberDesc(left?.buchholz, right?.buchholz)
    || compareNumberDesc(left?.sonnebornBerger, right?.sonnebornBerger)
    || compareNumberDesc(left?.wins, right?.wins);
}

function compareFinalStandingMetrics(left, right) {
  return comparePrimaryStandingMetrics(left, right)
    || compareNumberAsc(left?.totalGames, right?.totalGames)
    || compareNumberDesc(left?.preTournamentElo, right?.preTournamentElo)
    || (Date.parse(left?.joinedAt || 0) - Date.parse(right?.joinedAt || 0))
    || String(left?.entryId || '').localeCompare(String(right?.entryId || ''))
    || (toFiniteNumber(left?.rosterIndex) - toFiniteNumber(right?.rosterIndex))
    || String(left?.userId || '').localeCompare(String(right?.userId || ''));
}

function arePrimaryMetricsTied(left, right) {
  return nearlyEqual(left?.points, right?.points)
    && nearlyEqual(left?.buchholz, right?.buchholz)
    && nearlyEqual(left?.sonnebornBerger, right?.sonnebornBerger)
    && nearlyEqual(left?.wins, right?.wins);
}

function buildRoundRobinStandings(players = [], games = []) {
  const byUserId = new Map();
  const roster = Array.isArray(players) ? players : [];

  roster.forEach((player, index) => {
    const userId = toIdString(player?.userId);
    if (!userId) return;
    byUserId.set(userId, {
      entryId: player?.entryId || null,
      userId,
      username: player?.username || 'Player',
      type: player?.type || 'human',
      difficulty: player?.difficulty || null,
      joinedAt: player?.joinedAt || null,
      preTournamentElo: toFiniteNumber(player?.preTournamentElo, 800),
      storedSeed: toOptionalFiniteNumber(player?.seed),
      wins: 0,
      losses: 0,
      draws: 0,
      totalGames: 0,
      points: 0,
      buchholz: 0,
      sonnebornBerger: 0,
      headToHeadPoints: 0,
      performanceRating: toFiniteNumber(player?.preTournamentElo, 800),
      rosterIndex: index,
      _opponentResults: new Map(),
      _opponentRatingTotal: 0,
      _opponentGameCount: 0,
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

    let firstScoreAgainst = 0;
    let secondScoreAgainst = 0;

    const isDoubleNoShowLoss = String(game?.tournamentScoreOutcome || '') === 'double_no_show_loss';

    if (game?.winner === 0) {
      first.wins += 1;
      second.losses += 1;
      firstScoreAgainst = 1;
      secondScoreAgainst = 0;
    } else if (game?.winner === 1) {
      second.wins += 1;
      first.losses += 1;
      firstScoreAgainst = 0;
      secondScoreAgainst = 1;
    } else if (isDoubleNoShowLoss) {
      first.losses += 1;
      second.losses += 1;
      firstScoreAgainst = 0;
      secondScoreAgainst = 0;
    } else {
      first.draws += 1;
      second.draws += 1;
      firstScoreAgainst = 0.5;
      secondScoreAgainst = 0.5;
    }

    const firstVsSecond = first._opponentResults.get(secondId) || { pointsAgainst: 0, games: 0 };
    firstVsSecond.pointsAgainst += firstScoreAgainst;
    firstVsSecond.games += 1;
    first._opponentResults.set(secondId, firstVsSecond);

    const secondVsFirst = second._opponentResults.get(firstId) || { pointsAgainst: 0, games: 0 };
    secondVsFirst.pointsAgainst += secondScoreAgainst;
    secondVsFirst.games += 1;
    second._opponentResults.set(firstId, secondVsFirst);

    first._opponentRatingTotal += toFiniteNumber(second.preTournamentElo, 800);
    first._opponentGameCount += 1;
    second._opponentRatingTotal += toFiniteNumber(first.preTournamentElo, 800);
    second._opponentGameCount += 1;
  });

  const entries = Array.from(byUserId.values());
  entries.forEach((entry) => {
    entry.points = computeArenaPoints(entry);
  });

  entries.forEach((entry) => {
    let buchholz = 0;
    let sonnebornBerger = 0;
    entry._opponentResults.forEach((result, opponentUserId) => {
      const opponent = byUserId.get(opponentUserId);
      const opponentPoints = computeArenaPoints(opponent);
      buchholz += opponentPoints;
      sonnebornBerger += opponentPoints * toFiniteNumber(result?.pointsAgainst);
    });
    entry.buchholz = buchholz;
    entry.sonnebornBerger = sonnebornBerger;
    entry.performanceRating = computePerformanceRating(entry);
  });

  const preliminary = entries.slice().sort((left, right) => {
    return comparePrimaryStandingMetrics(left, right)
      || compareNumberDesc(left?.preTournamentElo, right?.preTournamentElo)
      || (Date.parse(left?.joinedAt || 0) - Date.parse(right?.joinedAt || 0))
      || (toFiniteNumber(left?.rosterIndex) - toFiniteNumber(right?.rosterIndex))
      || String(left?.userId || '').localeCompare(String(right?.userId || ''));
  });

  const ranked = [];
  for (let index = 0; index < preliminary.length; ) {
    const group = [preliminary[index]];
    index += 1;
    while (index < preliminary.length && arePrimaryMetricsTied(group[0], preliminary[index])) {
      group.push(preliminary[index]);
      index += 1;
    }

    const tiedIds = new Set(group.map((entry) => entry.userId));
    group.forEach((entry) => {
      let headToHeadPoints = 0;
      entry._opponentResults.forEach((result, opponentUserId) => {
        if (!tiedIds.has(opponentUserId)) return;
        headToHeadPoints += toFiniteNumber(result?.pointsAgainst);
      });
      entry.headToHeadPoints = headToHeadPoints;
    });

    group.sort(compareFinalStandingMetrics);
    ranked.push(...group);
  }

  ranked.forEach((entry, index) => {
    entry.computedSeed = index + 1;
    delete entry._opponentResults;
    delete entry._opponentRatingTotal;
    delete entry._opponentGameCount;
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
  buildRoundRobinStandings,
  toOptionalFiniteNumber,
};
