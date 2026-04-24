const Game = require('../../models/Game');
const User = require('../../models/User');
const eventBus = require('../../eventBus');
const { appendLocalDebugLog } = require('../../utils/localDebugLogger');
const { ensureInternalBotClient } = require('./internalBots');

const BOT_TURN_FAILSAFE_MS = 5000;

function toId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value?.toString === 'function') {
    const normalized = value.toString();
    return normalized === '[object Object]' ? null : normalized;
  }
  return null;
}

function toTimestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value.getTime === 'function') {
    const result = value.getTime();
    return Number.isFinite(result) ? result : null;
  }
  return null;
}

function extractLatestTimestamp(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const timestamp = toTimestampMs(entries[index]?.timestamp);
    if (timestamp !== null) return timestamp;
  }
  return null;
}

function getGameProgressTimestamp(game) {
  const actionMs = extractLatestTimestamp(game?.actions);
  const moveMs = extractLatestTimestamp(game?.moves);
  const createdAtMs = toTimestampMs(game?.createdAt);
  const startTimeMs = toTimestampMs(game?.startTime);
  const candidates = [actionMs, moveMs, createdAtMs, startTimeMs].filter((value) => value !== null);
  if (!candidates.length) return null;
  return Math.max(...candidates);
}

function normalizeBoolPair(value) {
  if (!Array.isArray(value)) return [false, false];
  return [Boolean(value[0]), Boolean(value[1])];
}

function collectActionableColors(game) {
  if (!game?.isActive) return [];

  const setupComplete = normalizeBoolPair(game.setupComplete);
  const playersReady = normalizeBoolPair(game.playersReady);
  const colors = new Set();

  for (let color = 0; color < 2; color += 1) {
    if (!setupComplete[color]) {
      colors.add(color);
      continue;
    }
    if (!playersReady[color]) {
      colors.add(color);
    }
  }

  const onDeckingPlayer = Number.isInteger(game?.onDeckingPlayer)
    ? game.onDeckingPlayer
    : null;
  if (
    onDeckingPlayer === 0 || onDeckingPlayer === 1
  ) {
    const hasOnDeckPiece = Boolean(game?.onDecks?.[onDeckingPlayer]);
    if (!hasOnDeckPiece) {
      colors.add(onDeckingPlayer);
    }
  }

  const playerTurn = Number.isInteger(game?.playerTurn) ? game.playerTurn : null;
  if (playerTurn === 0 || playerTurn === 1) {
    colors.add(playerTurn);
  }

  return Array.from(colors).sort();
}

async function executeQuery(query, { select = '', lean = true } = {}) {
  let current = query;
  if (select && current && typeof current.select === 'function') {
    current = current.select(select);
  }
  if (lean && current && typeof current.lean === 'function') {
    current = current.lean();
  }
  return current;
}

async function resolveActionableBotTargets(game, { UserModel = User } = {}) {
  if (game?.isTutorial) {
    return [];
  }

  const players = Array.isArray(game?.players)
    ? game.players.map((entry) => toId(entry))
    : [];
  const candidateColors = collectActionableColors(game)
    .filter((color) => Boolean(players[color]));
  if (!candidateColors.length) {
    return [];
  }

  const userIds = candidateColors
    .map((color) => players[color])
    .filter(Boolean);
  if (!userIds.length) {
    return [];
  }

  const users = await executeQuery(
    UserModel.find({ _id: { $in: userIds } }),
    { select: '_id isBot botDifficulty', lean: true },
  );
  const userMap = new Map(
    (Array.isArray(users) ? users : [])
      .map((user) => [toId(user?._id), user]),
  );

  return candidateColors
    .map((color) => {
      const userId = players[color];
      const user = userMap.get(userId);
      if (!user?.isBot) return null;
      return {
        color,
        userId,
        difficulty: typeof user?.botDifficulty === 'string' && user.botDifficulty.trim()
          ? user.botDifficulty.trim()
          : 'easy',
      };
    })
    .filter(Boolean);
}

function buildWatchSignature(game, targets = []) {
  const gameId = toId(game?._id || game?.gameId);
  const setupComplete = normalizeBoolPair(game?.setupComplete).map((value) => (value ? '1' : '0')).join('');
  const playersReady = normalizeBoolPair(game?.playersReady).map((value) => (value ? '1' : '0')).join('');
  const playerTurn = Number.isInteger(game?.playerTurn) ? game.playerTurn : 'n';
  const onDeckingPlayer = Number.isInteger(game?.onDeckingPlayer) ? game.onDeckingPlayer : 'n';
  const onDecks = [Boolean(game?.onDecks?.[0]), Boolean(game?.onDecks?.[1])]
    .map((value) => (value ? '1' : '0'))
    .join('');
  const progressMs = getGameProgressTimestamp(game) ?? 'none';
  const botTargets = targets
    .map((target) => `${target.color}:${target.userId}:${target.difficulty}`)
    .sort()
    .join('|');
  return [
    gameId || 'unknown',
    game?.isActive ? 'active' : 'inactive',
    setupComplete,
    playersReady,
    playerTurn,
    onDeckingPlayer,
    onDecks,
    progressMs,
    botTargets,
  ].join(':');
}

async function loadGameById(GameModel, gameId) {
  return executeQuery(GameModel.findById(gameId), { lean: false });
}

async function loadActiveGames(GameModel) {
  const result = await executeQuery(GameModel.find({ isActive: true }), { lean: false });
  return Array.isArray(result) ? result : [];
}

function buildAffectedUsers(game) {
  return Array.isArray(game?.players)
    ? game.players.map((playerId) => toId(playerId)).filter(Boolean)
    : [];
}

function createBotTurnFailsafe({
  GameModel = Game,
  UserModel = User,
  eventBusRef = eventBus,
  ensureBotClient = ensureInternalBotClient,
  hasConnectedUser = () => false,
  debugLog = appendLocalDebugLog,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  delayMs = BOT_TURN_FAILSAFE_MS,
} = {}) {
  const timers = new Map();

  function clearWatch(gameId, reason = 'replaced') {
    const id = toId(gameId);
    if (!id) return false;
    const existing = timers.get(id);
    if (!existing) return false;
    clearTimer(existing.handle);
    timers.delete(id);
    if (typeof debugLog === 'function') {
      debugLog('bot-turn-failsafe-cleared', {
        gameId: id,
        reason,
        signature: existing.signature,
      });
    }
    return true;
  }

  async function scheduleGame(game, { anchorMs = null, reason = 'gameChanged' } = {}) {
    const gameId = toId(game?._id || game?.gameId);
    if (!gameId) return null;

    clearWatch(gameId, 'rescheduled');

    const targets = await resolveActionableBotTargets(game, { UserModel });
    if (!targets.length) {
      if (typeof debugLog === 'function') {
        debugLog('bot-turn-failsafe-cleared', {
          gameId,
          reason: 'no-actionable-bot',
        });
      }
      return null;
    }

    const progressMs = anchorMs ?? getGameProgressTimestamp(game) ?? now();
    const elapsedMs = Math.max(0, now() - progressMs);
    const scheduledDelayMs = Math.max(0, delayMs - elapsedMs);
    const signature = buildWatchSignature(game, targets);
    const botPlayers = targets.map((target) => target.userId);

    const handle = setTimer(() => {
      runRecovery(gameId, signature).catch((err) => {
        console.error('Error running bot-turn failsafe recovery:', err);
      });
    }, scheduledDelayMs);
    if (typeof handle?.unref === 'function') {
      handle.unref();
    }

    timers.set(gameId, {
      handle,
      signature,
    });

    if (typeof debugLog === 'function') {
      debugLog('bot-turn-failsafe-scheduled', {
        gameId,
        reason,
        signature,
        botPlayers,
        progressMs,
        scheduledDelayMs,
      });
    }

    return {
      gameId,
      signature,
      botPlayers,
      scheduledDelayMs,
    };
  }

  async function runRecovery(gameId, signature) {
    const id = toId(gameId);
    if (!id) return false;
    const currentTimer = timers.get(id);
    if (!currentTimer || currentTimer.signature !== signature) {
      return false;
    }
    timers.delete(id);

    const game = await loadGameById(GameModel, id);
    if (!game?.isActive) {
      if (typeof debugLog === 'function') {
        debugLog('bot-turn-failsafe-cleared', {
          gameId: id,
          reason: 'game-inactive',
        });
      }
      return false;
    }

    const targets = await resolveActionableBotTargets(game, { UserModel });
    if (!targets.length) {
      if (typeof debugLog === 'function') {
        debugLog('bot-turn-failsafe-cleared', {
          gameId: id,
          reason: 'state-progressed',
        });
      }
      return false;
    }

    const currentSignature = buildWatchSignature(game, targets);
    if (currentSignature !== signature) {
      await scheduleGame(game, { reason: 'state-progressed-before-recovery' });
      return false;
    }

    const botPlayers = targets.map((target) => target.userId);
    for (const target of targets) {
      if (hasConnectedUser(target.userId)) continue;
      await ensureBotClient({
        difficulty: target.difficulty,
        userId: target.userId,
      });
    }

    if (typeof debugLog === 'function') {
      debugLog('bot-turn-failsafe-triggered', {
        gameId: id,
        signature,
        botPlayers,
      });
    }

    const payloadGame = typeof game?.toObject === 'function' ? game.toObject() : game;
    eventBusRef.emit('gameChanged', {
      game: payloadGame,
      affectedUsers: buildAffectedUsers(game),
      initiator: {
        action: 'bot-turn-failsafe',
      },
      botPlayers,
    });
    return true;
  }

  async function bootstrapActiveGames() {
    const games = await loadActiveGames(GameModel);
    const results = [];
    for (const game of games) {
      const scheduled = await scheduleGame(game, { reason: 'bootstrap' });
      if (scheduled) {
        results.push(scheduled);
      }
    }
    return results;
  }

  function dispose() {
    Array.from(timers.keys()).forEach((gameId) => {
      clearWatch(gameId, 'dispose');
    });
  }

  return {
    scheduleGame,
    bootstrapActiveGames,
    clearWatch,
    dispose,
    _timers: timers,
  };
}

module.exports = {
  BOT_TURN_FAILSAFE_MS,
  createBotTurnFailsafe,
  _private: {
    toId,
    toTimestampMs,
    getGameProgressTimestamp,
    collectActionableColors,
    resolveActionableBotTargets,
    buildWatchSignature,
  },
};
