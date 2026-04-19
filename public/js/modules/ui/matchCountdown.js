export function getMatchCountdownBannerTitle(gameNumber) {
  return Number.isFinite(Number(gameNumber)) && Number(gameNumber) > 1
    ? 'Game Starting'
    : 'Match Found';
}

export function shouldPreserveMatchCountdownBanner({
  activeBannerKind = null,
  activeBannerGameId = null,
  incomingGameId = null,
  playersReady = [],
} = {}) {
  if (activeBannerKind !== 'match-found') {
    return false;
  }

  const normalizedActiveGameId = activeBannerGameId != null ? String(activeBannerGameId) : '';
  const normalizedIncomingGameId = incomingGameId != null ? String(incomingGameId) : '';
  if (!normalizedActiveGameId || !normalizedIncomingGameId) {
    return false;
  }
  if (normalizedActiveGameId !== normalizedIncomingGameId) {
    return false;
  }

  const readyFlags = Array.isArray(playersReady) ? playersReady : [];
  const bothPlayersReady = readyFlags[0] === true && readyFlags[1] === true;
  return !bothPlayersReady;
}
