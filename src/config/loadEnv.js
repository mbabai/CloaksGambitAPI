const path = require('path');

function logLocalGoogleClientId() {
  const localGoogleId = process.env.GOOGLE_CLIENT_ID;
  const preview = localGoogleId ? `${localGoogleId.slice(0, 6)}…` : 'MISSING';
  console.debug('[env] Loaded local environment variables');
  console.debug('[env] GOOGLE_CLIENT_ID preview:', preview);
}

function applyLocalEnvIfNeeded(state) {
  if (state.isProduction) {
    return;
  }

  const envPath = path.resolve(__dirname, '..', '..', '.env');
  const result = require('dotenv').config({ path: envPath });

  if (result.error) {
    console.warn('[env] Failed to load local .env file:', result.error.message);
    return;
  }

  logLocalGoogleClientId();
}

function loadEnvironment() {
  if (global.__APP_ENV__) {
    return global.__APP_ENV__;
  }

  const NODE_ENV = process.env.NODE_ENV || 'development';
  const isProduction = NODE_ENV === 'production';

  process.env.NODE_ENV = NODE_ENV;

  const state = { NODE_ENV, isProduction };
  applyLocalEnvIfNeeded(state);

  global.__APP_ENV__ = state;
  return state;
}

module.exports = loadEnvironment();
