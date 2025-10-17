const { startBotClient } = require('../../../shared/bots');
const { normalizeDifficulty } = require('./registry');

let started = false;
let startPromise = null;
const activeClients = new Map();

const DEFAULT_DIFFICULTIES = ['easy', 'medium'];

function parseDifficulties() {
  const configured = process.env.BOT_DIFFICULTIES || process.env.BOT_DIFFICULTY;
  if (!configured) {
    return [...DEFAULT_DIFFICULTIES];
  }

  const values = configured
    .split(',')
    .map(value => normalizeDifficulty(value))
    .filter(Boolean);

  const unique = [];
  for (const value of values) {
    if (!unique.includes(value)) {
      unique.push(value);
    }
  }

  return unique.length ? unique : [...DEFAULT_DIFFICULTIES];
}

function resolveServerUrl(port) {
  if (process.env.BOT_SERVER_URL) return process.env.BOT_SERVER_URL;
  if (process.env.BOT_INTERNAL_SERVER_URL) return process.env.BOT_INTERNAL_SERVER_URL;
  const targetPort = Number(process.env.PORT || port || 3000);
  return `http://127.0.0.1:${targetPort}`;
}

function shouldEnable() {
  if (process.env.DISABLE_INTERNAL_BOTS === 'true') return false;
  if (process.env.DISABLE_INTERNAL_BOTS === '1') return false;
  return true;
}

async function startInternalBots({ port } = {}) {
  if (!shouldEnable()) {
    console.log('[bot-runtime] internal bots disabled by environment flag');
    return null;
  }
  if (started) return startPromise;
  started = true;
  const serverUrl = resolveServerUrl(port);
  const difficulties = parseDifficulties();
  const secret = process.env.BOT_SERVICE_SECRET || '';
  const heartbeatInterval = Number(process.env.BOT_STATUS_INTERVAL ?? '10000');
  console.log('[bot-runtime] starting internal bot clients', { serverUrl, difficulties });
  startPromise = Promise.all(
    difficulties.map(async (difficulty) => {
      try {
        const client = await startBotClient({
          serverUrl,
          difficulty,
          secret,
          heartbeatInterval,
        });
        activeClients.set(difficulty, client);
        return client;
      } catch (err) {
        console.error(`[bot-runtime] failed to start bot client (${difficulty})`, err);
        return null;
      }
    }),
  ).catch((err) => {
    console.error('[bot-runtime] failed to start internal bot clients', err);
    started = false;
    startPromise = null;
    activeClients.clear();
    return [];
  });
  return startPromise;
}

module.exports = {
  startInternalBots,
};
