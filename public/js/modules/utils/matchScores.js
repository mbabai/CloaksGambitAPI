export function toMatchPlayerId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'object') {
    if (value._id !== undefined) {
      return toMatchPlayerId(value._id);
    }
    if (value.userId !== undefined) {
      return toMatchPlayerId(value.userId);
    }
    if (typeof value.toHexString === 'function') {
      return value.toHexString();
    }
    if (typeof value.id === 'string' || typeof value.id === 'number') {
      return toMatchPlayerId(value.id);
    }
    if (typeof value.toString === 'function') {
      const str = value.toString();
      return str === '[object Object]' ? '' : str;
    }
  }
  return '';
}

function toScore(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function getMatchWinsForPlayer(match, playerId) {
  const idStr = toMatchPlayerId(playerId);
  if (!idStr) return 0;

  const player1Id = toMatchPlayerId(match?.player1?._id ?? match?.player1);
  const player2Id = toMatchPlayerId(match?.player2?._id ?? match?.player2);
  if (player1Id && idStr === player1Id) {
    return toScore(match?.player1Score);
  }
  if (player2Id && idStr === player2Id) {
    return toScore(match?.player2Score);
  }
  return 0;
}

export function getVisibleMatchWinCounts({
  match,
  currentPlayerIds,
  currentIsWhite,
} = {}) {
  const ids = Array.isArray(currentPlayerIds) ? currentPlayerIds : [];
  const topIdx = currentIsWhite ? 1 : 0;
  const bottomIdx = currentIsWhite ? 0 : 1;

  return {
    winsTop: getMatchWinsForPlayer(match, ids[topIdx]),
    winsBottom: getMatchWinsForPlayer(match, ids[bottomIdx]),
  };
}
