const { TOURNAMENT_MATCH_TYPES } = require('./tournamentAccept');

function toFiniteScore(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeWinScoreTarget(match, override = null) {
  const source = override ?? match?.winScoreTarget;
  const numeric = Number(source);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function isTournamentEliminationMatch(match) {
  return String(match?.type || '').toUpperCase() === TOURNAMENT_MATCH_TYPES.ELIMINATION;
}

function getTournamentEliminationDrawCapWinner(match, winScoreTarget = null) {
  const target = normalizeWinScoreTarget(match, winScoreTarget);
  if (!isTournamentEliminationMatch(match) || !Number.isFinite(target)) {
    return null;
  }

  const drawCount = toFiniteScore(match?.drawCount);
  if (drawCount < target) {
    return null;
  }

  const player1Score = toFiniteScore(match?.player1Score);
  const player2Score = toFiniteScore(match?.player2Score);
  if (player1Score > player2Score) {
    return match?.player1 || null;
  }
  if (player2Score > player1Score) {
    return match?.player2 || null;
  }
  return null;
}

function isTournamentEliminationSuddenDeath(match, winScoreTarget = null) {
  const target = normalizeWinScoreTarget(match, winScoreTarget);
  if (!isTournamentEliminationMatch(match) || !Number.isFinite(target)) {
    return false;
  }

  const drawCount = toFiniteScore(match?.drawCount);
  if (drawCount < target) {
    return false;
  }

  return toFiniteScore(match?.player1Score) === toFiniteScore(match?.player2Score);
}

module.exports = {
  TOURNAMENT_MATCH_TYPES,
  getTournamentEliminationDrawCapWinner,
  isTournamentEliminationMatch,
  isTournamentEliminationSuddenDeath,
};
