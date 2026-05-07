function resolveTooltipsEnabled(userLike) {
  if (!userLike || typeof userLike !== 'object') {
    return true;
  }
  return userLike.tooltipsEnabled !== false;
}

function normalizeBooleanPreferenceInput(value) {
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

function normalizeTooltipsEnabledInput(value) {
  return normalizeBooleanPreferenceInput(value);
}

function resolveToastNotificationsEnabled(userLike) {
  if (!userLike || typeof userLike !== 'object') {
    return true;
  }
  return userLike.toastNotificationsEnabled !== false;
}

function normalizeToastNotificationsEnabledInput(value) {
  return normalizeBooleanPreferenceInput(value);
}

module.exports = {
  resolveTooltipsEnabled,
  normalizeTooltipsEnabledInput,
  resolveToastNotificationsEnabled,
  normalizeToastNotificationsEnabledInput,
};
