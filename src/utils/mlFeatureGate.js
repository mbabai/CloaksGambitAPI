const { isProduction } = require('../config/loadEnv');

function normalizeBooleanEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return null;
}

function isMlWorkflowEnabled() {
  const explicit = normalizeBooleanEnv(process.env.ENABLE_ML_WORKFLOW);
  if (explicit !== null) {
    return explicit;
  }
  return !isProduction;
}

module.exports = {
  isMlWorkflowEnabled,
};
