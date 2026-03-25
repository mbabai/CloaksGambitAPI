function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function isSelfPlayActuallyActive(progress = null) {
  if (!progress || progress.active === false) {
    return false;
  }
  return progress.inFlight === true || toFiniteNumber(progress.activeGames) > 0;
}

export function isEvaluationActuallyActive(progress = null) {
  if (!progress || progress.active === false) {
    return false;
  }
  return progress.inFlight === true || toFiniteNumber(progress.activeGames) > 0;
}

export function isTrainingActuallyActive(progress = null) {
  if (!progress || progress.active === false) {
    return false;
  }
  return progress.inFlight === true;
}

export function getRunStatActivity(progress = {}) {
  return {
    selfPlayActive: isSelfPlayActuallyActive(progress.selfPlayProgress || null),
    evaluationActive: isEvaluationActuallyActive(progress.evaluationProgress || null),
    trainingActive: isTrainingActuallyActive(progress.trainingProgress || null),
  };
}
