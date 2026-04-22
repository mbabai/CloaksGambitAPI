function resolveTooltipsEnabled(userLike) {
  if (!userLike || typeof userLike !== 'object') {
    return true;
  }
  return userLike.tooltipsEnabled !== false;
}

function normalizeTooltipsEnabledInput(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === true || value === false) {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return null;
}

module.exports = {
  resolveTooltipsEnabled,
  normalizeTooltipsEnabledInput,
};
