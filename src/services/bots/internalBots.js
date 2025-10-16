const { startBotClient } = require('../../../shared/bots/easyBotRuntime');

let started = false;
let startPromise = null;

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
  const difficulty = (process.env.BOT_DIFFICULTY || 'easy').toLowerCase();
  const secret = process.env.BOT_SERVICE_SECRET || '';
  const heartbeatInterval = Number(process.env.BOT_STATUS_INTERVAL ?? '10000');
  console.log('[bot-runtime] starting internal bot client', { serverUrl, difficulty });
  startPromise = startBotClient({
    serverUrl,
    difficulty,
    secret,
    heartbeatInterval,
  }).catch((err) => {
    console.error('[bot-runtime] failed to start bot client', err);
    started = false;
    startPromise = null;
    return null;
  });
  return startPromise;
}

module.exports = {
  startInternalBots,
};
