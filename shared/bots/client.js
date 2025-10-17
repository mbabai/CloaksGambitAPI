const { io } = require('socket.io-client');
const { BaseBotController, GAME_CONSTANTS } = require('./baseBot');
const { EasyBotController } = require('./easyBot');
const { MediumBotController } = require('./mediumBot');

const CONTROLLER_MAP = {
  easy: EasyBotController,
  medium: MediumBotController,
};

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
      console.log('[bot] initialState received', {
        games: payload?.games?.map(game => game?.gameId || game?.matchId) || [],
      });
      payload?.games?.forEach(game => this.handleUpdate(game));
    });
    this.socket.on('game:update', (payload) => {
      console.log('[bot] game:update received', {
        gameId: payload?.gameId,
        playerTurn: payload?.playerTurn,
        setupComplete: payload?.setupComplete,
        playersReady: payload?.playersReady,
      });
      this.handleUpdate(payload);
    });
    this.socket.on('game:finished', (payload) => {
      if (payload?.gameId) {
        this.games.delete(payload.gameId);
        console.log('[bot] game finished', payload.gameId);
      }
    });
  }

  handleUpdate(payload) {
    if (!payload?.gameId) return;
    let controller = this.games.get(payload.gameId);
    if (!controller) {
      if (!this.socket) return;
      controller = new this.ControllerClass(
        this.serverUrl,
        payload.gameId,
        this.userId,
        this.token,
        this.socket,
      );
      this.games.set(payload.gameId, controller);
    }
    controller.handleUpdate(payload).catch(err => console.error('Failed update', err));
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

async function startBotClient({ serverUrl, difficulty = 'easy', secret = '', heartbeatInterval = 10000 } = {}) {
  const registration = await registerBot(serverUrl, difficulty, secret);
  console.log('[bot] registered as', registration.username);
  const client = new BotClient(serverUrl, registration.token, registration.userId, difficulty);
  client.start();
  if (heartbeatInterval > 0) {
    setInterval(() => console.log('[bot] heartbeat', new Date().toISOString()), heartbeatInterval);
  }
  return client;
}

module.exports = {
  GAME_CONSTANTS,
  BotClient,
  startBotClient,
};
