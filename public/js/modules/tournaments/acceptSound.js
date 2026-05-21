export function normalizeAcceptSoundGameId(gameId) {
  if (gameId === null || gameId === undefined) return null;
  const normalized = String(gameId);
  return normalized ? normalized : null;
}

export function isTournamentAcceptSoundAllowed({
  activeBannerKind = null,
  activeBannerGameId = null,
  gameId = null,
  isBannerVisible = () => false,
} = {}) {
  const normalizedGameId = normalizeAcceptSoundGameId(gameId);
  const normalizedActiveGameId = normalizeAcceptSoundGameId(activeBannerGameId);
  return Boolean(
    activeBannerKind === 'tournament-accept'
    && normalizedGameId
    && normalizedActiveGameId === normalizedGameId
    && isBannerVisible()
  );
}
