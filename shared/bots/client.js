const { io } = require('socket.io-client');
const { BaseBotController, GAME_CONSTANTS } = require('./baseBot');
const { EasyBotController } = require('./easyBot');
const { MediumBotController } = require('./mediumBot');
const { HardBotController } = require('./hardBot');

const CONTROLLER_MAP = {
  easy: EasyBotController,
  medium: MediumBotController,
  hard: HardBotController,
};

function toId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value.toString === 'function') {
    const normalized = value.toString();
    return normalized === '[object Object]' ? null : normalized;
  }
  return null;
}

function normalizeGamePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const gameId = toId(payload.gameId ?? payload._id ?? payload.id);
  if (!gameId) return null;
  const matchId = toId(payload.matchId ?? payload.match);
  return {
    ...payload,
    gameId,
    ...(matchId ? { matchId } : {}),
  };
}

async function postAuthedJSON(serverUrl, path, token, body) {
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      message = data?.message || message;
    } catch (_) {}
    throw new Error(message);
  }
  return res;
}

function resolveController(difficulty) {
  const normalized = typeof difficulty === 'string' ? difficulty.toLowerCase() : 'easy';
  const Controller = CONTROLLER_MAP[normalized] || EasyBotController;
  if (Controller.prototype instanceof BaseBotController || Controller === BaseBotController) {
    return Controller;
  }
  return EasyBotController;
}

class BotClient {
  constructor(serverUrl, token, userId, difficulty = 'easy') {
    this.serverUrl = serverUrl;
    this.token = token;
    this.userId = userId;
    this.difficulty = difficulty;
    this.socket = null;
    this.games = new Map();
    this.ControllerClass = resolveController(difficulty);
  }

  start() {
    this.socket = io(this.serverUrl, {
      auth: { token: this.token, userId: this.userId },
      transports: ['websocket'],
    });
    this.socket.on('connect', () => console.log('[bot] connected', { userId: this.userId, difficulty: this.difficulty }));
    this.socket.on('disconnect', reason => console.log('[bot] disconnected', { reason }));
    this.socket.on('connect_error', (err) => {
      console.error('[bot] connect_error', err?.message || err);
    });
    this.socket.on('initialState', (payload) => {
      const normalizedGames = Array.isArray(payload?.games)
        ? payload.games.map((game) => normalizeGamePayload(game)).filter(Boolean)
        : [];
      console.log('[bot] initialState received', {
        games: normalizedGames.map((game) => game.gameId || game.matchId),
      });
      normalizedGames.forEach((game) => this.handleUpdate(game));
    });
    this.socket.on('game:update', (payload) => {
      const normalizedPayload = normalizeGamePayload(payload);
      console.log('[bot] game:update received', {
        gameId: normalizedPayload?.gameId,
        playerTurn: normalizedPayload?.playerTurn,
        setupComplete: normalizedPayload?.setupComplete,
        playersReady: normalizedPayload?.playersReady,
      });
      this.handleUpdate(normalizedPayload);
    });
    this.socket.on('game:finished', (payload) => {
      this.handleGameFinished(payload).catch((err) => {
        console.error('Failed to handle finished game', err);
      });
    });
    this.socket.on('players:bothNext', (payload) => {
      this.handleBothNext(payload).catch((err) => {
        console.error('Failed to handle players:bothNext', err);
      });
    });
  }

  async handleGameFinished(payload) {
    const gameId = toId(payload?.gameId ?? payload?._id ?? payload?.id);
    if (!gameId) return;
    const keyPrefix = `${gameId}:`;
    const controllers = Array.from(this.games.entries()).filter(([key]) => String(key).startsWith(keyPrefix));
    if (payload?.matchIsActive) {
      const submittedColors = new Set();
      for (const [, controller] of controllers) {
        const color = Number.isInteger(controller?.color) ? controller.color : null;
        if (color === null || submittedColors.has(color)) continue;
        submittedColors.add(color);
        try {
          await postAuthedJSON(this.serverUrl, '/api/v1/gameAction/next', this.token, {
            gameId,
            color,
          });
        } catch (err) {
          console.error('Failed to queue next game for bot', {
            gameId,
            color,
            message: err?.message || err,
          });
        }
      }
    }
    controllers.forEach(([key]) => {
      this.games.delete(key);
    });
    console.log('[bot] game finished', { gameId, matchIsActive: Boolean(payload?.matchIsActive) });
  }

  async handleBothNext(payload) {
    const gameId = payload?.gameId;
    const color = Number.isInteger(payload?.color) ? payload.color : null;
    if (!gameId || color === null) return;
    try {
      await postAuthedJSON(this.serverUrl, '/api/v1/gameAction/ready', this.token, {
        gameId,
        color,
      });
      console.log('[bot] accepted next game', {
        gameId,
        color,
        requiresAccept: Boolean(payload?.requiresAccept),
      });
    } catch (err) {
      console.error('Failed to accept next game for bot', {
        gameId,
        color,
        message: err?.message || err,
      });
    }
  }

  handleUpdate(payload) {
    const normalizedPayload = normalizeGamePayload(payload);
    if (!normalizedPayload?.gameId) return;
    const normalizedPlayers = Array.isArray(normalizedPayload.players)
      ? normalizedPayload.players.map(id => (id != null ? id.toString() : ''))
      : [];
    const myUserId = this.userId != null ? this.userId.toString() : '';
    const myColors = normalizedPlayers.reduce((acc, id, idx) => {
      if (id && id === myUserId) acc.push(idx);
      return acc;
    }, []);
    const targetColors = myColors.length ? myColors : [null];

    targetColors.forEach((forcedColor) => {
      const key = `${normalizedPayload.gameId}:${forcedColor === null ? 'auto' : forcedColor}`;
      let controller = this.games.get(key);
      if (!controller) {
        if (!this.socket) return;
        controller = new this.ControllerClass(
          this.serverUrl,
          normalizedPayload.gameId,
          this.userId,
          this.token,
          this.socket,
          forcedColor,
        );
        this.games.set(key, controller);
      }
      controller.handleUpdate(normalizedPayload).catch(err => console.error('Failed update', err));
    });
  }
}

async function registerBot(serverUrl, difficulty, secret) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (secret) {
    headers['x-bot-secret'] = secret;
  }
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/bots/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ difficulty }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to register bot: ${res.status} ${text}`);
  }
  return res.json();
}

async function startBotClient({
  serverUrl,
  difficulty = 'easy',
  secret = '',
  userId = null,
  token = null,
} = {}) {
  let registration = null;
  if (!userId || !token) {
    registration = await registerBot(serverUrl, difficulty, secret);
    console.log('[bot] registered as', registration.username);
  }
  const resolvedUserId = userId || registration?.userId;
  const resolvedToken = token || registration?.token;
  const client = new BotClient(serverUrl, resolvedToken, resolvedUserId, difficulty);
  client.start();
  return client;
}

module.exports = {
  GAME_CONSTANTS,
  BotClient,
  startBotClient,
};
