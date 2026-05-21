const TOURNAMENT_MATCH_TYPES = Object.freeze({
  ROUND_ROBIN: 'TOURNAMENT_ROUND_ROBIN',
  ELIMINATION: 'TOURNAMENT_ELIMINATION',
});

const TOURNAMENT_ACCEPT_WINDOWS_SECONDS = Object.freeze({
  ROUND_ROBIN: 30,
  ELIMINATION: 120,
});

function normalizeMatchType(match) {
  return String(match?.type || '').toUpperCase();
}

function shouldRequireTournamentMatchAccept(match) {
  const matchType = normalizeMatchType(match);
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

function getTournamentAcceptWindowSeconds(match, requiresAccept = shouldRequireTournamentMatchAccept(match)) {
  if (!requiresAccept) return 0;
  const matchType = normalizeMatchType(match);
  if (matchType === TOURNAMENT_MATCH_TYPES.ELIMINATION) {
    return TOURNAMENT_ACCEPT_WINDOWS_SECONDS.ELIMINATION;
  }
  return TOURNAMENT_ACCEPT_WINDOWS_SECONDS.ROUND_ROBIN;
}

module.exports = {
  TOURNAMENT_ACCEPT_WINDOWS_SECONDS,
  TOURNAMENT_MATCH_TYPES,
  getTournamentAcceptWindowSeconds,
  shouldRequireTournamentMatchAccept,
};
