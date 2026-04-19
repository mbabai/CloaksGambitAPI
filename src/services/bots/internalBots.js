const User = require('../../models/User');
const { startBotClient } = require('../../../shared/bots');
const { createAuthToken } = require('../../utils/authTokens');
const { normalizeDifficulty } = require('./registry');
const { DEFAULT_DEV_PORT } = require('../../config/defaults');

let started = false;
let startPromise = null;
const activeDifficultyClients = new Map();
const activeInstanceClients = new Map();
let runtimeServerUrl = '';

const DEFAULT_DIFFICULTIES = ['easy', 'medium'];

function findDifficultyClientByUserId(userId) {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  if (!normalizedUserId) return null;
  for (const client of activeDifficultyClients.values()) {
    const candidateId = typeof client?.userId === 'string' ? client.userId.trim() : '';
    if (candidateId && candidateId === normalizedUserId) {
      return client;
    }
  }
  return null;
}

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
  const targetPort = Number(process.env.PORT || port || DEFAULT_DEV_PORT);
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
  runtimeServerUrl = serverUrl;
  const difficulties = parseDifficulties();
  const secret = process.env.BOT_SERVICE_SECRET || '';
  console.log('[bot-runtime] starting internal bot clients', { serverUrl, difficulties });
  startPromise = Promise.all(
    difficulties.map(async (difficulty) => {
      try {
        const client = await startBotClient({
          serverUrl,
          difficulty,
          secret,
        });
        activeDifficultyClients.set(difficulty, client);
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
    runtimeServerUrl = '';
    activeDifficultyClients.clear();
    activeInstanceClients.clear();
    return [];
  });
  return startPromise;
}

async function ensureInternalBotClient({ difficulty = 'easy', userId, token = null } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    return null;
  }
  if (!shouldEnable()) {
    return null;
  }

  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  if (!normalizedUserId) {
    return null;
  }

  if (activeInstanceClients.has(normalizedUserId)) {
    return activeInstanceClients.get(normalizedUserId);
  }

  if (startPromise) {
    await startPromise.catch(() => null);
  }

  const sharedClient = findDifficultyClientByUserId(normalizedUserId);
  if (sharedClient) {
    if (!sharedClient?.socket?.connected && typeof sharedClient?.socket?.connect === 'function') {
      try {
        sharedClient.socket.connect();
      } catch (err) {
        console.error('[bot-runtime] failed to reconnect shared bot client', err);
      }
    }
    return sharedClient;
  }

  const serverUrl = runtimeServerUrl || resolveServerUrl();
  if (!serverUrl) {
    return null;
  }

  let authToken = token;
  if (!authToken) {
    const user = await User.findById(normalizedUserId).lean().catch(() => null);
    if (!user) {
      return null;
    }
    authToken = createAuthToken(user);
  }

  const clientPromise = startBotClient({
    serverUrl,
    difficulty: normalizeDifficulty(difficulty),
    userId: normalizedUserId,
    token: authToken,
  }).catch((err) => {
    activeInstanceClients.delete(normalizedUserId);
    throw err;
  });

  activeInstanceClients.set(normalizedUserId, clientPromise);
  return clientPromise;
}

module.exports = {
  startInternalBots,
  ensureInternalBotClient,
};
