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

function compareNumberDesc(left, right) {
  const delta = toFiniteNumber(right) - toFiniteNumber(left);
  if (delta < 0) return -1;
  if (delta > 0) return 1;
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

  const ranked = entries.slice().sort((left, right) => compareNumberDesc(left?.points, right?.points));

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
  buildRoundRobinStandings,
  toOptionalFiniteNumber,
};
