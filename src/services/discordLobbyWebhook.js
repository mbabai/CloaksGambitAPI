const User = require('../models/User');

const QUEUE_DISPLAY_NAMES = {
  quickplayQueue: 'quickplay queue',
  rankedQueue: 'ranked queue',
  botQueue: 'bot queue',
};
const LOBBY_JOIN_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;
const lobbyJoinNotificationTimes = new Map();

function toId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return null;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getWebhookUrl() {
  return cleanText(
    process.env.DISCORD_LOBBY_WEBHOOK_URL
    || process.env.DiscordLobbyWebhookURL
    || process.env.DISCORD_WEBHOOK_URL
    || '',
  );
}

async function sendDiscordMessage(content, {
  webhookUrl = getWebhookUrl(),
  fetchFn = global.fetch,
} = {}) {
  const url = cleanText(webhookUrl);
  if (!url) {
    return { sent: false, reason: 'missing-webhook-url' };
  }
  if (typeof fetchFn !== 'function') {
    console.warn('[discordWebhook] fetch is unavailable; lobby notification skipped.');
    return { sent: false, reason: 'missing-fetch' };
  }

  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (response && response.ok === false) {
      console.error('[discordWebhook] Discord webhook rejected lobby notification.', {
        status: response.status || null,
        statusText: response.statusText || null,
      });
      return { sent: false, reason: 'discord-error', status: response.status || null };
    }
    return { sent: true };
  } catch (err) {
    console.error('[discordWebhook] Failed to send lobby notification:', err);
    return { sent: false, reason: 'send-error' };
  }
}

async function resolveUsername(userId, {
  username = null,
  UserModel = User,
} = {}) {
  const provided = cleanText(username);
  if (provided) return provided;

  const id = toId(userId);
  if (!id) return 'Unknown user';

  try {
    let query = UserModel.findById(id);
    if (query && typeof query.select === 'function') {
      query = query.select('username displayName name');
    }
    const user = query && typeof query.lean === 'function'
      ? await query.lean()
      : await query;
    return cleanText(user?.username || user?.displayName || user?.name) || id;
  } catch (err) {
    console.error('[discordWebhook] Failed to resolve username for lobby notification:', err);
    return id;
  }
}

async function notifyLobbyJoined(payload = {}, deps = {}) {
  const userId = toId(payload.userId);
  const now = typeof deps.nowFn === 'function' ? deps.nowFn() : Date.now();
  const cooldownMs = Number.isFinite(Number(deps.cooldownMs))
    ? Math.max(0, Number(deps.cooldownMs))
    : LOBBY_JOIN_NOTIFICATION_COOLDOWN_MS;
  const notificationTimes = deps.notificationTimes || lobbyJoinNotificationTimes;
  const usesCooldown = userId && cooldownMs > 0 && notificationTimes instanceof Map;

  if (usesCooldown) {
    const previousNotificationAt = notificationTimes.get(userId);
    if (Number.isFinite(previousNotificationAt) && now - previousNotificationAt < cooldownMs) {
      return { sent: false, reason: 'join-cooldown' };
    }
  }

  const username = await resolveUsername(payload.userId, {
    username: payload.username,
    UserModel: deps.UserModel || User,
  });
  const result = await (deps.sendMessageFn || sendDiscordMessage)(`${username} has joined the lobby`, deps);
  if (usesCooldown && result?.sent) {
    notificationTimes.set(userId, now);
  }
  return result;
}

async function notifyLobbyLeft(payload = {}, deps = {}) {
  return { sent: false, reason: 'lobby-leave-disabled' };
}

async function notifyQueueTransition({ userId, queueName, action }, deps = {}) {
  const username = await resolveUsername(userId, {
    username: deps.username,
    UserModel: deps.UserModel || User,
  });
  return (deps.sendMessageFn || sendDiscordMessage)(`${username} has ${action} the ${queueName}`, deps);
}

function normalizeQueueState(state = {}) {
  return {
    quickplayQueue: Array.isArray(state.quickplayQueue) ? state.quickplayQueue.map(toId).filter(Boolean) : [],
    rankedQueue: Array.isArray(state.rankedQueue) ? state.rankedQueue.map(toId).filter(Boolean) : [],
    botQueue: Array.isArray(state.botQueue) ? state.botQueue.map(toId).filter(Boolean) : [],
  };
}

function getQueueTransitions(previousState = {}, nextState = {}, affectedUsers = []) {
  const previous = normalizeQueueState(previousState);
  const next = normalizeQueueState(nextState);
  const affected = new Set((affectedUsers || []).map(toId).filter(Boolean));
  const shouldInclude = affected.size > 0
    ? (id) => affected.has(id)
    : () => true;
  const transitions = [];

  Object.keys(QUEUE_DISPLAY_NAMES).forEach((queueKey) => {
    const queueName = QUEUE_DISPLAY_NAMES[queueKey];
    const previousIds = new Set(previous[queueKey]);
    const nextIds = new Set(next[queueKey]);

    next[queueKey].forEach((id) => {
      if (!previousIds.has(id) && shouldInclude(id)) {
        transitions.push({ userId: id, queueName, action: 'joined' });
      }
    });

    previous[queueKey].forEach((id) => {
      if (!nextIds.has(id) && shouldInclude(id)) {
        transitions.push({ userId: id, queueName, action: 'left' });
      }
    });
  });

  return transitions;
}

async function notifyQueueTransitions(previousState = {}, nextState = {}, {
  affectedUsers = [],
  UserModel = User,
  sendMessageFn = sendDiscordMessage,
} = {}) {
  const transitions = getQueueTransitions(previousState, nextState, affectedUsers);
  const usernameCache = new Map();

  for (const transition of transitions) {
    if (!usernameCache.has(transition.userId)) {
      usernameCache.set(transition.userId, await resolveUsername(transition.userId, { UserModel }));
    }
    await notifyQueueTransition(transition, {
      UserModel,
      username: usernameCache.get(transition.userId),
      sendMessageFn,
    });
  }

  return transitions;
}

module.exports = {
  getWebhookUrl,
  sendDiscordMessage,
  resolveUsername,
  notifyLobbyJoined,
  notifyLobbyLeft,
  notifyQueueTransition,
  notifyQueueTransitions,
  getQueueTransitions,
  QUEUE_DISPLAY_NAMES,
  LOBBY_JOIN_NOTIFICATION_COOLDOWN_MS,
};
