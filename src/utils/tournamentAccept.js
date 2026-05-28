const TOURNAMENT_MATCH_TYPES = Object.freeze({
  ROUND_ROBIN: 'TOURNAMENT_ROUND_ROBIN',
  ELIMINATION: 'TOURNAMENT_ELIMINATION',
});

const TOURNAMENT_ACCEPT_WINDOWS_SECONDS = Object.freeze({
  ROUND_ROBIN: 30,
  ELIMINATION: 120,
});

function normalizePositiveSeconds(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Math.max(1, Math.ceil(Number(fallback) || 1));
  }
  return Math.max(1, Math.ceil(numeric));
}

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
  if (Number.isFinite(Number(match?.acceptWindowSeconds)) && Number(match.acceptWindowSeconds) > 0) {
    return normalizePositiveSeconds(match.acceptWindowSeconds, TOURNAMENT_ACCEPT_WINDOWS_SECONDS.ROUND_ROBIN);
  }
  const matchType = normalizeMatchType(match);
  if (matchType === TOURNAMENT_MATCH_TYPES.ELIMINATION) {
    return TOURNAMENT_ACCEPT_WINDOWS_SECONDS.ELIMINATION;
  }
  return TOURNAMENT_ACCEPT_WINDOWS_SECONDS.ROUND_ROBIN;
}

function getTournamentAcceptDeadlineMs(game, match = null, now = Date.now()) {
  const explicitDeadline = Date.parse(game?.acceptDeadlineAt || '');
  if (Number.isFinite(explicitDeadline)) {
    return explicitDeadline;
  }

  const requiresAccept = typeof game?.requiresAccept === 'boolean'
    ? Boolean(game.requiresAccept)
    : shouldRequireTournamentMatchAccept(match);
  if (!requiresAccept) {
    return null;
  }

  const acceptWindowSeconds = Number.isFinite(Number(game?.acceptWindowSeconds)) && Number(game.acceptWindowSeconds) > 0
    ? normalizePositiveSeconds(game.acceptWindowSeconds, getTournamentAcceptWindowSeconds(match, true))
    : getTournamentAcceptWindowSeconds(match, true);
  const createdAtMs = Date.parse(game?.createdAt || '');
  if (!Number.isFinite(createdAtMs)) {
    return null;
  }
  return createdAtMs + (acceptWindowSeconds * 1000);
}

function getTournamentAcceptRemainingSeconds(game, match = null, now = Date.now()) {
  const deadlineMs = getTournamentAcceptDeadlineMs(game, match, now);
  if (!Number.isFinite(deadlineMs)) {
    return 0;
  }
  return Math.max(0, Math.ceil((deadlineMs - now) / 1000));
}

module.exports = {
  TOURNAMENT_ACCEPT_WINDOWS_SECONDS,
  TOURNAMENT_MATCH_TYPES,
  getTournamentAcceptDeadlineMs,
  getTournamentAcceptRemainingSeconds,
  getTournamentAcceptWindowSeconds,
  shouldRequireTournamentMatchAccept,
};
