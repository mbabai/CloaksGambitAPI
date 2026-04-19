function normalizeGameId(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function shouldPreserveClockSnapshot({
  incomingClockSnapshot = null,
  currentClockSnapshot = null,
  currentClockGameId = null,
  incomingGameId = null,
  gameFinished = false,
  setupComplete = [false, false],
  actionCount = 0,
  moveCount = 0,
  playerTurn = null,
} = {}) {
  if (incomingClockSnapshot && typeof incomingClockSnapshot === 'object') {
    return false;
  }
  if (gameFinished || !currentClockSnapshot || typeof currentClockSnapshot !== 'object') {
    return false;
  }

  const existingGameId = normalizeGameId(currentClockGameId);
  const nextGameId = normalizeGameId(incomingGameId);
  if (!existingGameId || !nextGameId || existingGameId !== nextGameId) {
    return false;
  }

  const setupFlags = Array.isArray(setupComplete) ? setupComplete : [false, false];
  const hasSetupProgress = Boolean(setupFlags[0]) || Boolean(setupFlags[1]);
  const hasHistory = Number.isFinite(actionCount) && actionCount > 0;
  const hasMoves = Number.isFinite(moveCount) && moveCount > 0;
  const hasActiveTurn = playerTurn === 0 || playerTurn === 1;

  return hasSetupProgress || hasHistory || hasMoves || hasActiveTurn;
}
