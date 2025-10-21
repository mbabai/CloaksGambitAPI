const { winReasons: WIN_REASONS } = require('../../../shared/constants');
const { normalizeId } = require('../matches/activeMatches');

function computeWinPercentage(wins, total) {
  if (!total) return 0;
  return Math.round((wins / total) * 100);
}

function getMatchResult(match, userId) {
  const matchId = normalizeId(match?._id || match?.id);
  const player1Id = normalizeId(match?.player1);
  const player2Id = normalizeId(match?.player2);
  const winnerId = normalizeId(match?.winner);
  const type = typeof match?.type === 'string' ? match.type.toUpperCase() : '';
  const endedAt = match?.endTime
    ? new Date(match.endTime)
    : (match?.startTime ? new Date(match.startTime) : null);

  const p1Score = Number.isFinite(match?.player1Score) ? match.player1Score : 0;
  const p2Score = Number.isFinite(match?.player2Score) ? match.player2Score : 0;

  let player1Result = 'draw';
  let player2Result = 'draw';

  if (winnerId && (winnerId === player1Id || winnerId === player2Id)) {
    if (winnerId === player1Id) {
      player1Result = 'win';
      player2Result = 'loss';
    } else {
      player1Result = 'loss';
      player2Result = 'win';
    }
  } else if (p1Score !== p2Score) {
    if (p1Score > p2Score) {
      player1Result = 'win';
      player2Result = 'loss';
    } else {
      player1Result = 'loss';
      player2Result = 'win';
    }
  }

  const normalizedUserId = normalizeId(userId);
  let userResult = null;
  if (normalizedUserId) {
    if (normalizedUserId === player1Id) {
      userResult = player1Result;
    } else if (normalizedUserId === player2Id) {
      userResult = player2Result;
    }
  }

  return {
    matchId,
    type,
    endedAt,
    player1Id,
    player2Id,
    player1Score: p1Score,
    player2Score: p2Score,
    player1Result,
    player2Result,
    winnerId,
    userResult,
  };
}

function computeHistorySummary(matches, games, { userId } = {}) {
  const summary = {
    games: { total: 0, wins: 0, draws: 0, losses: 0 },
    quickplayGames: { total: 0, wins: 0, draws: 0, losses: 0 },
    matches: { total: 0, wins: 0, draws: 0, losses: 0, winPct: 0 },
    customMatches: { total: 0, wins: 0, draws: 0, losses: 0, winPct: 0 },
    rankedMatches: { total: 0, wins: 0, draws: 0, losses: 0, winPct: 0 },
    botMatches: { total: 0, wins: 0, draws: 0, losses: 0, winPct: 0 },
  };

  const normalizedUserId = normalizeId(userId);
  const allMatches = Array.isArray(matches) ? matches : [];
  const allGames = Array.isArray(games) ? games : [];

  const matchById = new Map();
  allMatches.forEach((match) => {
    const id = normalizeId(match?._id || match?.id);
    if (id) {
      matchById.set(id, match);
    }
  });

  const relevantMatches = allMatches.filter((match) => {
    if (!match || match.isActive) return false;
    if (!normalizedUserId) return true;
    const p1 = normalizeId(match.player1);
    const p2 = normalizeId(match.player2);
    return p1 === normalizedUserId || p2 === normalizedUserId;
  });

  relevantMatches.forEach((match) => {
    const result = getMatchResult(match, normalizedUserId);
    const isDraw = result.player1Result === 'draw' && result.player2Result === 'draw';
    const isRanked = result.type === 'RANKED';
    const isCustom = result.type === 'CUSTOM';
    const isBot = result.type === 'AI';

    if (normalizedUserId) {
      if (!result.userResult) return;
      summary.matches.total += 1;
      if (result.userResult === 'win') {
        summary.matches.wins += 1;
      } else if (result.userResult === 'loss') {
        summary.matches.losses += 1;
      } else {
        summary.matches.draws += 1;
      }

      if (isCustom) {
        summary.customMatches.total += 1;
        if (result.userResult === 'win') {
          summary.customMatches.wins += 1;
        } else if (result.userResult === 'loss') {
          summary.customMatches.losses += 1;
        } else {
          summary.customMatches.draws += 1;
        }
      }

      if (isRanked) {
        summary.rankedMatches.total += 1;
        if (result.userResult === 'win') {
          summary.rankedMatches.wins += 1;
        } else if (result.userResult === 'loss') {
          summary.rankedMatches.losses += 1;
        } else {
          summary.rankedMatches.draws += 1;
        }
      }

      if (isBot) {
        summary.botMatches.total += 1;
        if (result.userResult === 'win') {
          summary.botMatches.wins += 1;
        } else if (result.userResult === 'loss') {
          summary.botMatches.losses += 1;
        } else {
          summary.botMatches.draws += 1;
        }
      }
    } else {
      summary.matches.total += 1;
      if (isDraw) {
        summary.matches.draws += 1;
      } else {
        summary.matches.wins += 1;
        summary.matches.losses += 1;
      }

      if (isCustom) {
        summary.customMatches.total += 1;
        if (isDraw) {
          summary.customMatches.draws += 1;
        } else {
          summary.customMatches.wins += 1;
          summary.customMatches.losses += 1;
        }
      }

      if (isRanked) {
        summary.rankedMatches.total += 1;
        if (isDraw) {
          summary.rankedMatches.draws += 1;
        } else {
          summary.rankedMatches.wins += 1;
          summary.rankedMatches.losses += 1;
        }
      }

      if (isBot) {
        summary.botMatches.total += 1;
        if (isDraw) {
          summary.botMatches.draws += 1;
        } else {
          summary.botMatches.wins += 1;
          summary.botMatches.losses += 1;
        }
      }
    }
  });

  const relevantGames = allGames.filter((game) => {
    if (!game || game.isActive) return false;
    const matchId = normalizeId(game.match);
    if (!matchId) return false;
    if (!matchById.has(matchId)) return false;
    if (!normalizedUserId) return true;
    const players = Array.isArray(game.players) ? game.players.map((id) => normalizeId(id)) : [];
    return players.includes(normalizedUserId);
  });

  relevantGames.forEach((game) => {
    const players = Array.isArray(game.players) ? game.players.map((id) => normalizeId(id)) : [];
    const matchId = normalizeId(game.match);
    const match = matchId ? matchById.get(matchId) : null;
    const matchType = typeof match?.type === 'string' ? match.type.toUpperCase() : '';
    const winnerIdx = Number.isInteger(game?.winner) ? game.winner : null;
    const winReason = game?.winReason;
    const isDraw = winReason === WIN_REASONS.DRAW
      || winnerIdx === null
      || winnerIdx === undefined;

    if (normalizedUserId) {
      const playerIdx = players.findIndex((id) => id === normalizedUserId);
      if (playerIdx === -1) return;
      summary.games.total += 1;
      if (matchType === 'QUICKPLAY') {
        summary.quickplayGames.total += 1;
      }

      if (isDraw) {
        summary.games.draws += 1;
        if (matchType === 'QUICKPLAY') {
          summary.quickplayGames.draws += 1;
        }
      } else if (playerIdx === winnerIdx) {
        summary.games.wins += 1;
        if (matchType === 'QUICKPLAY') {
          summary.quickplayGames.wins += 1;
        }
      } else {
        summary.games.losses += 1;
        if (matchType === 'QUICKPLAY') {
          summary.quickplayGames.losses += 1;
        }
      }
    } else {
      summary.games.total += 1;
      if (matchType === 'QUICKPLAY') {
        summary.quickplayGames.total += 1;
      }

      if (isDraw) {
        summary.games.draws += 1;
        if (matchType === 'QUICKPLAY') {
          summary.quickplayGames.draws += 1;
        }
      } else {
        summary.games.wins += 1;
        summary.games.losses += 1;
        if (matchType === 'QUICKPLAY') {
          summary.quickplayGames.wins += 1;
          summary.quickplayGames.losses += 1;
        }
      }
    }
  });

  summary.matches.winPct = computeWinPercentage(summary.matches.wins, summary.matches.total);
  summary.customMatches.winPct = computeWinPercentage(summary.customMatches.wins, summary.customMatches.total);
  summary.rankedMatches.winPct = computeWinPercentage(summary.rankedMatches.wins, summary.rankedMatches.total);
  summary.botMatches.winPct = computeWinPercentage(summary.botMatches.wins, summary.botMatches.total);

  return summary;
}

module.exports = {
  computeHistorySummary,
  getMatchResult,
};
