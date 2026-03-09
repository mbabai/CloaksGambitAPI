const { isProduction } = require('../config/loadEnv');

const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;

function normalizeSameSite(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'strict' || normalized === 'lax' || normalized === 'none') {
    return normalized;
  }
  return null;
}

function parseBooleanEnv(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function buildAuthCookieOptions() {
  const configuredSameSite = normalizeSameSite(process.env.AUTH_COOKIE_SAME_SITE);
  const sameSite = configuredSameSite || (isProduction ? 'none' : 'lax');
  const configuredSecure = parseBooleanEnv(process.env.AUTH_COOKIE_SECURE);
  let secure = configuredSecure === null ? isProduction : configuredSecure;

  if (sameSite === 'none') {
    secure = true;
  }

  const options = {
    maxAge: ONE_YEAR_MS,
    sameSite,
    path: '/',
  };

  if (secure) {
    options.secure = true;
  }

  const configuredDomain = typeof process.env.AUTH_COOKIE_DOMAIN === 'string'
    ? process.env.AUTH_COOKIE_DOMAIN.trim()
    : '';
  if (configuredDomain) {
    options.domain = configuredDomain;
  }

  return options;
}

module.exports = {
  ONE_YEAR_MS,
  buildAuthCookieOptions,
  normalizeSameSite,
  parseBooleanEnv,
};
