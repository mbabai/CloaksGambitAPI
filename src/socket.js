const { Server } = require('socket.io');
const { randomUUID } = require('crypto');
const { lobbies, rankedQueue, quickplayQueue, matches, games } = require('./state');
const maskGameForColor = require('./utils/gameView');
const eventBus = require('./eventBus');
const ensureUser = require('./utils/ensureUser');
const { resolveUserFromToken, extractTokenFromRequest } = require('./utils/authTokens');
const User = require('./models/User');
const GameModel = require('./models/Game');
const MatchModel = require('./models/Match');
const getServerConfig = require('./utils/getServerConfig');
const { GAME_CONSTANTS } = require('../shared/constants');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });
  const clients = new Map();
  const userIdToUsername = new Map();
  const connectedUsernames = new Map();
  const pendingCustomInvites = new Map();
  const matchDisconnectState = new Map();
  const playerMatches = new Map();
  const DISCONNECT_LIMIT_MS = 30000;
  const MIN_DISCONNECT_GRACE_MS = 10000;

  function toId(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value.toString === 'function') return value.toString();
    return null;
  }

  function getMatchState(matchId) {
    const id = toId(matchId);
    if (!id) return null;
    let state = matchDisconnectState.get(id);
    if (!state) {
      state = { players: {} };
      matchDisconnectState.set(id, state);
    }
    return state;
  }

  function addPlayerMatch(playerId, matchId) {
    const pid = toId(playerId);
    const mid = toId(matchId);
    if (!pid || !mid) return;
    let set = playerMatches.get(pid);
    if (!set) {
      set = new Set();
      playerMatches.set(pid, set);
    }
    set.add(mid);
  }

  function removePlayerMatch(playerId, matchId) {
    const pid = toId(playerId);
    const mid = toId(matchId);
    if (!pid || !mid) return;
    const set = playerMatches.get(pid);
    if (!set) return;
    set.delete(mid);
    if (set.size === 0) {
      playerMatches.delete(pid);
    }
  }

  function cleanupMatchTracking(matchId) {
    const mid = toId(matchId);
    if (!mid) return;
    const state = matchDisconnectState.get(mid);
    if (!state) return;
    Object.entries(state.players).forEach(([pid, info]) => {
      if (info.timer) {
        clearInterval(info.timer);
        info.timer = null;
      }
      removePlayerMatch(pid, mid);
    });
    matchDisconnectState.delete(mid);
  }

  function normalizeUsername(name) {
    if (typeof name !== 'string') return '';
    return name.trim().toLowerCase();
  }

  function setConnectedUsername(userId, username) {
    const pid = toId(userId);
    if (!pid) return;
    const previous = userIdToUsername.get(pid);
    if (previous) {
      const prevKey = normalizeUsername(previous);
      const existing = connectedUsernames.get(prevKey);
      if (existing === pid) {
        connectedUsernames.delete(prevKey);
      }
    }
    const normalized = normalizeUsername(username);
    if (normalized) {
      userIdToUsername.set(pid, username);
      connectedUsernames.set(normalized, pid);
    } else {
      userIdToUsername.delete(pid);
    }
  }

  function removeConnectedUsername(userId) {
    const pid = toId(userId);
    if (!pid) return;
    const previous = userIdToUsername.get(pid);
    if (previous) {
      const prevKey = normalizeUsername(previous);
      const existing = connectedUsernames.get(prevKey);
      if (existing === pid) {
        connectedUsernames.delete(prevKey);
      }
    }
    userIdToUsername.delete(pid);
  }

  function resolveConnectedUserIdByName(username) {
    const normalized = normalizeUsername(username);
    if (!normalized) return null;
    const id = connectedUsernames.get(normalized);
    return id || null;
  }

  function generateInviteId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function ensureLobby() {
    if (!lobbies.default) {
      lobbies.default = { quickplayQueue, rankedQueue, inGame: [] };
    }
    if (!Array.isArray(lobbies.default.inGame)) {
      lobbies.default.inGame = [];
    }
    lobbies.default.quickplayQueue = quickplayQueue;
    lobbies.default.rankedQueue = rankedQueue;
    return lobbies.default;
  }

  function replaceArrayContents(target, values = []) {
    if (!Array.isArray(target)) return;
    target.splice(0, target.length, ...(values || []));
  }

  function clonePlainObject(value) {
    if (!value) return null;
    const plain = typeof value.toObject === 'function'
      ? value.toObject({ depopulate: false })
      : value;
    try {
      return JSON.parse(JSON.stringify(plain));
    } catch (err) {
      console.error('Failed to clone object for socket state:', err);
      return { ...plain };
    }
  }

  function sanitizeGameForPersistence(rawGame, fallbackMatchId) {
    const plain = clonePlainObject(rawGame);
    if (!plain) return null;

    const gameId = toId(plain._id) || toId(plain.id);
    const sanitized = { ...plain };
    delete sanitized._id;
    delete sanitized.id;
    delete sanitized.__v;

    const normalizedMatch = toId(plain.match) || toId(fallbackMatchId);
    if (normalizedMatch) {
      sanitized.match = normalizedMatch;
    }

    if (Array.isArray(plain.players)) {
      sanitized.players = plain.players.map(player => toId(player)).filter(Boolean);
    }

    return { gameId, update: sanitized };
  }

  async function persistCompletedMatch(matchId, gameIds = [], payload = {}) {
    const normalizedMatchId = toId(matchId);
    if (!normalizedMatchId) return;

    const uniqueGameIds = Array.from(new Set((gameIds || []).map(toId).filter(Boolean)));

    let gamesPersisted = true;

    for (const gameId of uniqueGameIds) {
      const memoryGame = games.get(gameId);
      if (!memoryGame) {
        console.warn('No in-memory game found to persist for match', normalizedMatchId, 'game', gameId);
        gamesPersisted = false;
        continue;
      }

      const sanitized = sanitizeGameForPersistence(memoryGame, normalizedMatchId);
      if (!sanitized || !sanitized.update?.match) {
        console.warn('Unable to sanitize game for persistence', { matchId: normalizedMatchId, gameId });
        gamesPersisted = false;
        continue;
      }

      try {
        await GameModel.findByIdAndUpdate(
          gameId,
          { $set: sanitized.update },
          { upsert: true, setDefaultsOnInsert: true },
        );
      } catch (err) {
        gamesPersisted = false;
        console.error('Failed to persist game history', { matchId: normalizedMatchId, gameId }, err);
      }
    }

    let statsUpdated = true;
    let matchDoc = null;
    try {
      matchDoc = await MatchModel.findById(normalizedMatchId).lean();
    } catch (err) {
      statsUpdated = false;
      console.error('Failed to load match for persistence', { matchId: normalizedMatchId }, err);
    }

    if (matchDoc) {
      const winnerId = toId(payload?.winner) || (matchDoc.winner ? matchDoc.winner.toString() : null);
      const playerData = [
        {
          id: matchDoc.player1 ? matchDoc.player1.toString() : null,
          startElo: matchDoc.player1StartElo,
          endElo: matchDoc.player1EndElo,
        },
        {
          id: matchDoc.player2 ? matchDoc.player2.toString() : null,
          startElo: matchDoc.player2StartElo,
          endElo: matchDoc.player2EndElo,
        },
      ].filter(player => Boolean(player.id));

      await Promise.all(playerData.map(async ({ id, startElo, endElo }) => {
        const isRankedMatch = matchDoc.type === GAME_CONSTANTS.gameModes.RANKED;
        const delta = (Number.isFinite(endElo) && Number.isFinite(startElo))
          ? endElo - startElo
          : 0;

        const inc = { 'stats.matchesPlayed': 1 };
        if (winnerId) {
          if (winnerId === id) {
            inc['stats.matchesWon'] = 1;
          } else {
            inc['stats.matchesLost'] = 1;
          }
        } else {
          inc['stats.matchesDrawn'] = 1;
        }
        if (delta !== 0) {
          inc['stats.totalEloDelta'] = delta;
        }

        const set = { 'stats.lastEloDelta': delta };
        if (isRankedMatch && Number.isFinite(endElo)) {
          set.elo = endElo;
        }

        try {
          await User.updateOne(
            { _id: id },
            { $inc: inc, $set: set },
          );
        } catch (err) {
          statsUpdated = false;
          console.error('Failed to update user stats after match', { matchId: normalizedMatchId, userId: id }, err);
        }
      }));
    } else {
      statsUpdated = false;
    }

    if (gamesPersisted && statsUpdated) {
      uniqueGameIds.forEach((gameId) => {
        games.delete(gameId);
      });
      matches.delete(normalizedMatchId);
    }
  }

  function normalizeGameState(rawGame) {
    const cloned = clonePlainObject(rawGame);
    if (!cloned) return null;
    const gameId = toId(cloned._id) || toId(cloned.id);
    if (!gameId) return null;
    const matchId = toId(cloned.match);
    const players = Array.isArray(cloned.players)
      ? cloned.players.map(p => toId(p)).filter(Boolean)
      : [];

    return {
      ...cloned,
      _id: gameId,
      id: cloned.id || gameId,
      match: matchId,
      players,
      playersReady: Array.isArray(cloned.playersReady) ? cloned.playersReady : [false, false],
      playersNext: Array.isArray(cloned.playersNext) ? cloned.playersNext : [false, false],
    };
  }

  function upsertGameState(rawGame) {
    const normalized = normalizeGameState(rawGame);
    if (!normalized) return null;
    games.set(normalized._id, normalized);
    return normalized;
  }

  async function createCustomMatch(player1Id, player2Id) {
    const players = [toId(player1Id), toId(player2Id)].filter(Boolean);
    if (players.length !== 2) {
      throw new Error('Two valid players are required for a custom match');
    }

    const config = await getServerConfig();
    const lobby = ensureLobby();

    const customSettings = config?.gameModeSettings?.get
      ? (config.gameModeSettings.get('CUSTOM') || config.gameModeSettings.get('QUICKPLAY') || {})
      : (config?.gameModeSettings?.CUSTOM || config?.gameModeSettings?.QUICKPLAY || {});
    const quickplaySettings = config?.gameModeSettings?.get
      ? (config.gameModeSettings.get('QUICKPLAY') || {})
      : (config?.gameModeSettings?.QUICKPLAY || {});
    const fallbackBase = Number(quickplaySettings?.TIME_CONTROL) || 300000;
    const timeControl = Number(customSettings?.TIME_CONTROL ?? fallbackBase) || fallbackBase;
    const incrementSetting = customSettings?.INCREMENT ?? (config?.gameModeSettings?.get
      ? config.gameModeSettings.get('INCREMENT')
      : config?.gameModeSettings?.INCREMENT);
    const increment = Number(incrementSetting) || 0;

    const typeValue = config?.gameModes?.get
      ? (config.gameModes.get('CUSTOM') || 'CUSTOM')
      : (config?.gameModes?.CUSTOM || 'CUSTOM');

    const removeFromQueue = (queue, id) => {
      const idx = queue.indexOf(id);
      if (idx !== -1) {
        queue.splice(idx, 1);
      }
    };

    const affected = new Set();
    players.forEach((pid) => {
      const id = pid.toString();
      removeFromQueue(quickplayQueue, id);
      removeFromQueue(rankedQueue, id);
      if (!lobby.inGame.includes(id)) {
        lobby.inGame.push(id);
      }
      affected.add(id);
    });

    eventBus.emit('queueChanged', {
      quickplayQueue: [...quickplayQueue],
      rankedQueue: [...rankedQueue],
      affectedUsers: Array.from(affected),
    });

    const matchId = randomUUID();
    const match = {
      _id: matchId,
      id: matchId,
      player1: players[0],
      player2: players[1],
      type: typeValue,
      player1Score: 0,
      player2Score: 0,
      games: [],
      isActive: true,
      createdAt: new Date(),
    };
    matches.set(matchId, match);

    const gameId = randomUUID();
    const game = {
      _id: gameId,
      id: gameId,
      match: matchId,
      players: players.map(id => id.toString()),
      playersReady: [false, false],
      playersNext: [false, false],
      playerTurn: null,
      winner: null,
      winReason: null,
      createdAt: new Date(),
      startTime: null,
      endTime: null,
      isActive: true,
      timeControlStart: timeControl,
      increment,
    };

    games.set(gameId, game);
    match.games.push(gameId);

    const affectedList = Array.from(affected);
    eventBus.emit('gameChanged', {
      game,
      affectedUsers: affectedList,
    });
    eventBus.emit('players:bothNext', {
      game,
      affectedUsers: affectedList,
    });
    eventBus.emit('match:created', {
      matchId,
      players: affectedList,
      type: match.type,
    });

    return { match, game };
  }

  function clearPendingInvitesForUser(userId, reason = 'disconnect') {
    const pid = toId(userId);
    if (!pid) return;
    pendingCustomInvites.forEach((invite, inviteId) => {
      if (invite.fromId !== pid && invite.toId !== pid) return;
      pendingCustomInvites.delete(inviteId);
      const otherId = invite.fromId === pid ? invite.toId : invite.fromId;
      const otherSocket = clients.get(otherId);
      if (!otherSocket) return;
      if (invite.fromId === pid) {
        otherSocket.emit('custom:inviteCancel', { inviteId });
      } else {
        otherSocket.emit('custom:inviteResult', {
          inviteId,
          status: 'cancelled',
          username: userIdToUsername.get(pid) || null,
          reason,
        });
      }
    });
  }

  function computeElapsed(matchId, playerId) {
    const state = matchDisconnectState.get(matchId);
    if (!state) return null;
    const playerState = state.players[playerId];
    if (!playerState) return null;
    const now = Date.now();
    const disconnectedDuration = playerState.disconnectedSince ? (now - playerState.disconnectedSince) : 0;
    const elapsedMs = Math.min(DISCONNECT_LIMIT_MS, playerState.cumulativeMs + disconnectedDuration);
    const remainingSeconds = Math.max(0, Math.ceil((DISCONNECT_LIMIT_MS - elapsedMs) / 1000));
    const cumulativeSeconds = Math.floor(elapsedMs / 1000);
    return {
      elapsedMs,
      remainingSeconds,
      cumulativeSeconds,
      isDisconnected: Boolean(playerState.disconnectedSince),
    };
  }

  function broadcastStatus(matchId, playerId) {
    const mid = toId(matchId);
    const pid = toId(playerId);
    if (!mid || !pid) return;
    const state = matchDisconnectState.get(mid);
    if (!state) return;
    const status = computeElapsed(mid, pid);
    if (!status) return;
    const payload = {
      matchId: mid,
      playerId: pid,
      isDisconnected: status.isDisconnected,
      remainingSeconds: status.remainingSeconds,
      cumulativeSeconds: status.cumulativeSeconds,
    };
    Object.keys(state.players).forEach((otherId) => {
      const socket = clients.get(otherId);
      if (socket) {
        socket.emit('match:connectionStatus', payload);
      }
    });
  }

  function stopDisconnectTimer(playerState) {
    if (playerState?.timer) {
      clearInterval(playerState.timer);
      playerState.timer = null;
    }
  }

  function markPlayerConnected(playerId, matchId, { broadcast = true } = {}) {
    const mid = toId(matchId);
    const pid = toId(playerId);
    if (!mid || !pid) return;
    const state = matchDisconnectState.get(mid);
    if (!state) return;
    const playerState = state.players[pid];
    if (!playerState) return;
    if (playerState.disconnectedSince) {
      playerState.cumulativeMs = Math.min(
        DISCONNECT_LIMIT_MS,
        playerState.cumulativeMs + (Date.now() - playerState.disconnectedSince)
      );
      playerState.disconnectedSince = null;
    }
    playerState.handled = false;
    stopDisconnectTimer(playerState);
    if (broadcast) {
      broadcastStatus(mid, pid);
    }
  }

  function startDisconnectTimer(matchId, playerId) {
    const state = matchDisconnectState.get(matchId);
    if (!state) return;
    const playerState = state.players[playerId];
    if (!playerState) return;
    if (playerState.timer) return;
    playerState.timer = setInterval(() => {
      checkDisconnectStatus(matchId, playerId).catch((err) => {
        console.error('Error checking disconnect timeout', err);
      });
    }, 1000);
    checkDisconnectStatus(matchId, playerId).catch((err) => {
      console.error('Error checking disconnect timeout', err);
    });
  }

  function markPlayerDisconnected(playerId, matchId, { broadcast = true } = {}) {
    const mid = toId(matchId);
    const pid = toId(playerId);
    if (!mid || !pid) return;
    const state = getMatchState(mid);
    let playerState = state.players[pid];
    if (!playerState) {
      playerState = { cumulativeMs: 0, disconnectedSince: null, timer: null, handled: false };
      state.players[pid] = playerState;
    }
    if (playerState.disconnectedSince) return;
    const minGrace = Math.min(DISCONNECT_LIMIT_MS, MIN_DISCONNECT_GRACE_MS);
    const targetCumulative = DISCONNECT_LIMIT_MS - minGrace;
    if ((DISCONNECT_LIMIT_MS - playerState.cumulativeMs) < minGrace) {
      playerState.cumulativeMs = Math.max(0, targetCumulative);
    }
    playerState.disconnectedSince = Date.now();
    playerState.handled = false;
    startDisconnectTimer(mid, pid);
    if (broadcast) {
      broadcastStatus(mid, pid);
    }
  }

  function markPlayerConnectedToAllMatches(playerId) {
    const pid = toId(playerId);
    if (!pid) return;
    const matches = playerMatches.get(pid);
    if (!matches) return;
    matches.forEach((matchId) => markPlayerConnected(pid, matchId));
  }

  function markPlayerDisconnectedFromAllMatches(playerId) {
    const pid = toId(playerId);
    if (!pid) return;
    const matches = playerMatches.get(pid);
    if (!matches) return;
    matches.forEach((matchId) => markPlayerDisconnected(pid, matchId));
  }

  function registerMatch(matchId, players = []) {
    const mid = toId(matchId);
    if (!mid) return;
    const state = getMatchState(mid);
    players.forEach((player) => {
      const pid = toId(player);
      if (!pid) return;
      if (!state.players[pid]) {
        state.players[pid] = { cumulativeMs: 0, disconnectedSince: null, timer: null, handled: false };
      }
      addPlayerMatch(pid, mid);
      if (clients.has(pid)) {
        markPlayerConnected(pid, mid);
      } else {
        markPlayerDisconnected(pid, mid);
      }
    });
  }

  async function checkDisconnectStatus(matchId, playerId) {
    const status = computeElapsed(matchId, playerId);
    if (!status) return;
    if (status.elapsedMs >= DISCONNECT_LIMIT_MS) {
      await handleDisconnectTimeout(matchId, playerId);
    } else {
      broadcastStatus(matchId, playerId);
    }
  }

  async function handleDisconnectTimeout(matchId, playerId) {
    const state = matchDisconnectState.get(matchId);
    if (!state) return;
    const playerState = state.players[playerId];
    if (!playerState || playerState.handled) return;
    playerState.handled = true;
    stopDisconnectTimer(playerState);
    playerState.cumulativeMs = DISCONNECT_LIMIT_MS;

    const loserId = toId(playerId);

    try {
      const match = matches.get(matchId);
      if (!match || !match.isActive) {
        cleanupMatchTracking(matchId);
        return;
      }

      const config = await getServerConfig();
      const winReasonValue = config?.winReasons?.get
        ? config.winReasons.get('DISCONNECT')
        : config?.winReasons?.DISCONNECT ?? GAME_CONSTANTS.winReasons.DISCONNECT;
      const settings = config?.gameModeSettings?.get
        ? config.gameModeSettings.get(match.type)
        : config?.gameModeSettings?.[match.type];
      const defaultMatchSettings = GAME_CONSTANTS.gameModeSettings[match.type] || {};
      const winScore = settings?.WIN_SCORE
        ?? defaultMatchSettings.WIN_SCORE
        ?? GAME_CONSTANTS.gameModeSettings.QUICKPLAY.WIN_SCORE;

      const player1Id = match.player1?.toString();
      const player2Id = match.player2?.toString();
      const winnerId = player1Id === loserId ? player2Id : player1Id;

      if (!winnerId) {
        cleanupMatchTracking(matchId);
        return;
      }

      if (winnerId === player1Id) {
        match.player1Score = Math.max(match.player1Score || 0, winScore);
      } else if (winnerId === player2Id) {
        match.player2Score = Math.max(match.player2Score || 0, winScore);
      }

      match.isActive = false;
      match.endedAt = new Date();

      const activeGames = (match.games || [])
        .map(id => games.get(toId(id)))
        .filter(game => game?.isActive);

      for (const game of activeGames) {
        const winnerIdx = game.players.findIndex(p => p.toString() === winnerId);
        if (winnerIdx === -1) continue;
        game.isActive = false;
        game.winner = winnerIdx;
        game.winReason = winReasonValue;
        game.endTime = new Date();
        eventBus.emit('gameChanged', {
          game,
          affectedUsers: (game.players || []).map(id => id.toString()),
        });
      }
    } catch (err) {
      console.error('Error handling disconnect timeout', err);
      playerState.handled = false;
      if (!playerState.disconnectedSince) {
        playerState.disconnectedSince = Date.now();
      }
      startDisconnectTimer(matchId, playerId);
      return;
    }

    cleanupMatchTracking(matchId);
  }

  // Admin namespace for dashboard metrics
  const adminNamespace = io.of('/admin');

  const lobbyState = {
    quickplayQueue: [...quickplayQueue],
    rankedQueue: [...rankedQueue],
  };

  eventBus.on('queueChanged', (payload = {}) => {
    const newQuick = Array.isArray(payload.quickplayQueue)
      ? payload.quickplayQueue.map(id => id.toString())
      : [...quickplayQueue];
    const newRanked = Array.isArray(payload.rankedQueue)
      ? payload.rankedQueue.map(id => id.toString())
      : [...rankedQueue];

    const affected = new Set((payload.affectedUsers || []).map(id => id.toString()));

    replaceArrayContents(quickplayQueue, newQuick);
    replaceArrayContents(rankedQueue, newRanked);
    const lobby = ensureLobby();
    lobby.quickplayQueue = quickplayQueue;
    lobby.rankedQueue = rankedQueue;

    const collectDiff = (prev, next) => {
      prev.forEach((id) => {
        if (!next.includes(id)) affected.add(id);
      });
      next.forEach((id) => {
        if (!prev.includes(id)) affected.add(id);
      });
    };

    collectDiff(lobbyState.quickplayQueue, newQuick);
    collectDiff(lobbyState.rankedQueue, newRanked);

    lobbyState.quickplayQueue = [...quickplayQueue];
    lobbyState.rankedQueue = [...rankedQueue];

    affected.forEach((id) => {
      const socket = clients.get(id);
      if (socket) {
        socket.emit('queue:update', {
          quickplay: newQuick.includes(id),
          ranked: newRanked.includes(id),
        });
      }
    });

    // Emit updated metrics to admin dashboard
    emitAdminMetrics();
  });

  eventBus.on('match:created', (payload) => {
    if (!payload) return;
    const matchId = toId(payload.matchId);
    if (!matchId) return;

    const players = (payload.players || [])
      .map(id => toId(id))
      .filter(Boolean);

    let record = matches.get(matchId) || {
      _id: matchId,
      id: matchId,
      games: [],
      isActive: true,
    };

    if (payload.match) {
      const normalizedMatch = clonePlainObject(payload.match) || {};
      record = {
        ...record,
        ...normalizedMatch,
        _id: matchId,
        id: matchId,
        player1: toId(normalizedMatch.player1) || record.player1,
        player2: toId(normalizedMatch.player2) || record.player2,
        games: Array.isArray(normalizedMatch.games)
          ? normalizedMatch.games.map(id => toId(id)).filter(Boolean)
          : record.games,
        type: normalizedMatch.type ?? record.type,
        isActive: normalizedMatch.isActive ?? record.isActive ?? true,
      };
    }

    if (players[0]) record.player1 = players[0];
    if (players[1]) record.player2 = players[1];

    if (Array.isArray(payload.games)) {
      record.games = payload.games.map(id => toId(id)).filter(Boolean);
    }

    if (payload.type !== undefined) {
      record.type = payload.type;
    }

    if (payload.isActive !== undefined) {
      record.isActive = Boolean(payload.isActive);
    } else if (record.isActive === undefined) {
      record.isActive = true;
    }

    matches.set(matchId, record);

    const lobby = ensureLobby();
    lobby.inGame = lobby.inGame || [];
    players.forEach((playerId) => {
      if (!playerId) return;
      if (!lobby.inGame.includes(playerId)) {
        lobby.inGame.push(playerId);
      }
    });

    registerMatch(matchId, players);
  });

  eventBus.on('match:ended', async (payload) => {
    if (!payload) return;
    const matchId = toId(payload.matchId);
    if (!matchId) return;

    const record = matches.get(matchId) || { _id: matchId, id: matchId, games: [] };
    record.isActive = false;
    if (payload.winner !== undefined) {
      record.winner = payload.winner;
    }
    record.endedAt = new Date();
    matches.set(matchId, record);

    const endedPlayers = new Set((payload.players || []).map(id => toId(id)).filter(Boolean));
    if (endedPlayers.size > 0) {
      const lobby = ensureLobby();
      lobby.inGame = (lobby.inGame || []).filter(id => !endedPlayers.has(toId(id)));
    }

    const gamesForMatch = Array.isArray(record.games)
      ? record.games.map(id => toId(id)).filter(Boolean)
      : [];

    cleanupMatchTracking(matchId);

    try {
      await persistCompletedMatch(matchId, gamesForMatch, payload);
    } catch (err) {
      console.error('Failed to persist completed match data', { matchId }, err);
    }
  });

  eventBus.on('gameChanged', async (payload) => {
    let game = null;
    if (payload?.game) {
      game = upsertGameState(payload.game);
    }

    if (!game) {
      const fallbackId = toId(payload?.documentKey?._id || payload?.gameId);
      if (fallbackId) {
        game = games.get(fallbackId) || null;
      }
    }

    if (!game) return;

    const matchId = toId(game.match);
    const gameIdStr = toId(game._id) || toId(game.id);

    if (gameIdStr && !games.has(gameIdStr)) {
      games.set(gameIdStr, game);
    }

    if (matchId) {
      const record = matches.get(matchId) || { _id: matchId, id: matchId, games: [] };
      record.games = Array.isArray(record.games) ? record.games : [];
      if (gameIdStr && !record.games.includes(gameIdStr)) {
        record.games.push(gameIdStr);
      }
      if (Array.isArray(game.players)) {
        if (game.players[0]) record.player1 = toId(game.players[0]);
        if (game.players[1]) record.player2 = toId(game.players[1]);
      }
      if (typeof game.isActive === 'boolean' && record.isActive === undefined) {
        record.isActive = game.isActive;
      }
      matches.set(matchId, record);
      registerMatch(matchId, game.players || []);
    }

    const players = (payload?.affectedUsers && payload.affectedUsers.length)
      ? payload.affectedUsers.map(id => id.toString())
      : (game.players || []).map(p => p.toString());

    players.forEach((playerId) => {
      const socket = clients.get(playerId);
      if (!socket) return;
      const idx = (game.players || []).findIndex(p => p.toString() === playerId);
      const maskedSource = JSON.parse(JSON.stringify(game));
      const masked = maskGameForColor(maskedSource, idx);
      socket.emit('game:update', {
        matchId,
        gameId: gameIdStr,
        board: masked.board,
        actions: masked.actions,
        moves: masked.moves,
        captured: masked.captured,
        stashes: masked.stashes,
        onDecks: masked.onDecks,
        players: masked.players,
        daggers: masked.daggers,
        playerTurn: masked.playerTurn,
        onDeckingPlayer: masked.onDeckingPlayer,
        drawOffer: masked.drawOffer,
        drawOfferCooldowns: game.drawOfferCooldowns,
        setupComplete: game.setupComplete,
        isActive: masked.isActive,
        winner: masked.winner,
        winReason: masked.winReason,
        playersReady: game.playersReady,
        startTime: game.startTime,
        timeControlStart: game.timeControlStart,
        increment: game.increment,
      });
    });

    // If the game has ended, send the full unmasked state to both players
    if (!game.isActive) {
      players.forEach((playerId) => {
        const socket = clients.get(playerId);
        if (!socket) return;
        socket.emit('game:finished', {
          matchId,
          gameId: gameIdStr,
          board: game.board,
          actions: game.actions,
          moves: game.moves,
          captured: game.captured,
          stashes: game.stashes,
          onDecks: game.onDecks,
          players: (game.players || []).map(p => p.toString()),
          daggers: game.daggers,
          playerTurn: game.playerTurn,
          onDeckingPlayer: game.onDeckingPlayer,
          setupComplete: game.setupComplete,
          isActive: game.isActive,
          winner: game.winner,
          winReason: game.winReason,
          playersReady: game.playersReady,
          startTime: game.startTime,
          timeControlStart: game.timeControlStart,
          increment: game.increment,
        });
      });

      // Log final game details for debugging/analytics
      console.log('Game finished:', {
        gameId: gameIdStr,
        winner: game.winner,
        winReason: game.winReason,
        game,
      });
    }
  });

  // Relay explicit both-ready signal to affected users
  eventBus.on('players:bothReady', (payload) => {
    const gameId = payload?.gameId?.toString?.() || payload?.gameId
    if (gameId) {
      const storedGame = games.get(toId(gameId));
      if (storedGame) {
        storedGame.playersReady = [true, true];
        games.set(toId(gameId), storedGame);
      }
    }
    const users = (payload?.affectedUsers || []).map(id => id.toString())
    console.log('[server] relaying players:bothReady', { gameId, users })
    users.forEach((playerId) => {
      const socket = clients.get(playerId)
      if (socket) {
        socket.emit('players:bothReady', { gameId })
      } else {
        console.warn('[server] players:bothReady user not connected:', playerId)
      }
    })
  })

  // Notify a single player that opponent clicked Next and countdown started
  eventBus.on('nextCountdown', (payload) => {
    const gameId = payload?.gameId?.toString?.() || payload?.gameId;
    const color = payload?.color;
    const seconds = payload?.seconds;
    (payload?.affectedUsers || []).forEach(id => {
      const socket = clients.get(id.toString());
      if (socket) {
        socket.emit('next:countdown', { gameId, color, seconds });
      }
    });
  });

  // Relay both-next signal to affected users with their color
  eventBus.on('players:bothNext', (payload) => {
    let game = null;
    if (payload?.game) {
      game = upsertGameState(payload.game);
    }
    if (!game) {
      const gameId = toId(payload?.gameId);
      if (gameId) {
        game = games.get(gameId) || null;
      }
    }
    if (!game) return;

    const gameIdStr = toId(game._id) || toId(game.id);
    if (gameIdStr) {
      game.playersNext = [true, true];
      games.set(gameIdStr, game);
    }

    const recipients = (payload?.affectedUsers && payload.affectedUsers.length)
      ? payload.affectedUsers.map(id => id.toString())
      : (game.players || []).map(p => p.toString());

    recipients.forEach((id, idx) => {
      const socket = clients.get(id.toString());
      if (socket) {
        socket.emit('players:bothNext', { gameId: gameIdStr, color: idx });
      }
    });
  });

  // Change streams are no longer used when operating purely in memory.

  // Allow other parts of the app to request an on-demand admin metrics refresh
  eventBus.on('adminRefresh', () => emitAdminMetrics());

  io.on('connection', async (socket) => {
    const { token: authTokenFromHandshake, userId: providedUserId } = socket.handshake.auth || {};
    let userId = providedUserId;
    let userInfo = null;
    let authenticated = false;

    let token = authTokenFromHandshake;

    if (!token) {
      const requestLike = {
        headers: socket.handshake.headers,
        url: socket.handshake.url,
        originalUrl: socket.handshake.url,
        ip: socket.handshake.address,
      };
      token = extractTokenFromRequest(requestLike);
    }

    if (token) {
      try {
        userInfo = await resolveUserFromToken(token);
        if (userInfo && userInfo.userId) {
          userId = userInfo.userId;
          authenticated = !userInfo.isGuest;
        }
      } catch (err) {
        console.warn('[socket] Failed to resolve user from token', { socketId: socket.id, message: err?.message });
      }
    }

    if (!userInfo) {
      try {
        userInfo = await ensureUser(userId);
        userId = userInfo.userId;
      } catch (err) {
        console.error('Failed to ensure user account:', err);
        return socket.disconnect(true);
      }
    }

    const connectionLabel = authenticated ? 'logged-in' : 'anonymous';
    console.log(`[socket] Connection ${socket.id} authenticated=${authenticated} (${connectionLabel}) user=${userId}`);
    // If a user reconnects quickly, keep the most recent socket only
    const prev = clients.get(userId);
    if (prev && prev.id !== socket.id) {
      try { prev.disconnect(true) } catch (_) {}
    }
    clients.set(userId, socket);
    setConnectedUsername(userId, userInfo.username);
    markPlayerConnectedToAllMatches(userId);
    socket.emit('user:init', { userId, username: userInfo.username, guest: userInfo.isGuest });
    console.log('Client connected', socket.id);

    // Emit updated metrics to admin dashboard on new connection
    emitAdminMetrics();

    try {
      const lobby = ensureLobby();
      const userIdStr = userId.toString();
      const queued = {
        quickplay: quickplayQueue.includes(userIdStr),
        ranked: rankedQueue.includes(userIdStr),
      };

      const activeGames = Array.from(games.values()).filter((game) => {
        if (!game?.isActive) return false;
        return (game.players || []).some(p => p.toString() === userIdStr);
      });

      const matchPlayers = new Map();
      activeGames.forEach((game) => {
        const matchId = toId(game?.match);
        if (!matchId) return;
        if (!matchPlayers.has(matchId)) {
          matchPlayers.set(matchId, new Set());
        }
        (game.players || []).forEach((p) => {
          const pid = toId(p);
          if (pid) {
            matchPlayers.get(matchId).add(pid);
          }
        });
      });
      matchPlayers.forEach((playersSet, matchId) => {
        registerMatch(matchId, Array.from(playersSet));
      });

      const maskedGames = activeGames.map((game) => {
        const color = (game.players || []).findIndex(p => p.toString() === userIdStr);
        const clonedGame = JSON.parse(JSON.stringify(game));
        const masked = maskGameForColor(clonedGame, color);
        return {
          ...masked,
          _id: game._id || game.id,
          players: (game.players || []).map(p => p.toString()),
          playersReady: game.playersReady,
          startTime: game.startTime,
          timeControlStart: game.timeControlStart,
          increment: game.increment,
        };
      });

      socket.emit('initialState', { queued, games: maskedGames });

      // Previously we sent a `game:finished` event for all completed games
      // whenever a user connected. This caused stale victory/defeat banners
      // to appear when the page was refreshed between games. To avoid this
      // confusing behavior, no `game:finished` events are emitted during
      // initial connection. Finished games are only broadcast at the moment
      // they conclude.
    } catch (err) {
      console.error('Error fetching initial state:', err);
    }

    socket.on('user:updateName', (payload) => {
      if (!payload) return;
      const nextName = typeof payload === 'string' ? payload : payload.username;
      if (typeof nextName !== 'string') return;
      setConnectedUsername(userId, nextName);
    });

    socket.on('custom:invite', async (payload) => {
      try {
        if (!userId) return;
        const targetName = typeof payload === 'string' ? payload : payload?.username || payload?.target;
        const trimmed = typeof targetName === 'string' ? targetName.trim() : '';
        if (!trimmed) {
          socket.emit('custom:inviteResult', { status: 'error', message: 'Username is required.' });
          return;
        }
        const targetId = resolveConnectedUserIdByName(trimmed);
        if (!targetId || !clients.has(targetId)) {
          socket.emit('custom:inviteResult', { status: 'offline', username: trimmed });
          return;
        }
        const inviterId = toId(userId);
        if (targetId === inviterId) {
          socket.emit('custom:inviteResult', { status: 'error', message: 'You cannot invite yourself.' });
          return;
        }

        for (const invite of pendingCustomInvites.values()) {
          if (invite.fromId === inviterId && invite.status === 'pending') {
            socket.emit('custom:inviteResult', { status: 'error', message: 'You already have a pending invite.' });
            return;
          }
        }

        const inviteId = generateInviteId();
        pendingCustomInvites.set(inviteId, {
          id: inviteId,
          fromId: inviterId,
          toId: targetId,
          status: 'pending',
          createdAt: Date.now(),
        });

        const targetSocket = clients.get(targetId);
        const targetUsername = userIdToUsername.get(targetId) || trimmed;
        const inviterName = userIdToUsername.get(inviterId) || userInfo.username;

        socket.emit('custom:inviteResult', {
          inviteId,
          status: 'pending',
          username: targetUsername,
        });

        if (targetSocket) {
          targetSocket.emit('custom:inviteRequest', {
            inviteId,
            fromUserId: inviterId,
            fromUsername: inviterName,
          });
        }
      } catch (err) {
        console.error('Failed to send custom invite:', err);
        socket.emit('custom:inviteResult', { status: 'error', message: 'Failed to send invite.' });
      }
    });

    socket.on('custom:inviteResponse', async (payload) => {
      try {
        const inviteId = payload?.inviteId;
        if (!inviteId || typeof inviteId !== 'string') return;
        const invite = pendingCustomInvites.get(inviteId);
        if (!invite || invite.status !== 'pending') return;
        const responderId = toId(userId);
        if (invite.toId !== responderId) return;

        pendingCustomInvites.delete(inviteId);

        const inviterSocket = clients.get(invite.fromId);
        const inviterName = userIdToUsername.get(invite.fromId) || null;
        const inviteeName = userIdToUsername.get(invite.toId) || null;

        const accepted = Boolean(payload?.accepted);
        if (!accepted) {
          if (inviterSocket) {
            inviterSocket.emit('custom:inviteResult', {
              inviteId,
              status: 'declined',
              username: inviteeName,
            });
          }
          return;
        }

        try {
          await createCustomMatch(invite.fromId, invite.toId);
          if (inviterSocket) {
            inviterSocket.emit('custom:inviteResult', {
              inviteId,
              status: 'accepted',
              username: inviteeName,
            });
          }
        } catch (matchErr) {
          console.error('Failed to create custom match:', matchErr);
          if (inviterSocket) {
            inviterSocket.emit('custom:inviteResult', {
              inviteId,
              status: 'error',
              message: 'Failed to start custom game.',
              username: inviteeName,
            });
          }
          const inviteeSocket = clients.get(invite.toId);
          if (inviteeSocket) {
            inviteeSocket.emit('custom:inviteResult', {
              inviteId,
              status: 'error',
              message: 'Failed to start custom game.',
            });
          }
        }
      } catch (err) {
        console.error('Failed to process custom invite response:', err);
      }
    });

    socket.on('disconnect', async () => {
      console.log('Client disconnected', socket.id);
      if (userId) {
        const current = clients.get(userId);
        const isCurrent = !current || current.id === socket.id;
        if (isCurrent) {
          // Grace period: remove mapping now, but defer queue cleanup
          clearPendingInvitesForUser(userId, 'disconnect');
          clients.delete(userId);
          markPlayerDisconnectedFromAllMatches(userId);
          removeConnectedUsername(userId);
        }
        setTimeout(() => {
          // If user reconnected, skip cleanup
          if (clients.has(userId)) return;
          const lobby = ensureLobby();
          const id = userId.toString();
          const beforeQuick = quickplayQueue.length;
          const beforeRanked = rankedQueue.length;
          const removeFromQueue = (queue) => {
            const idx = queue.indexOf(id);
            if (idx !== -1) {
              queue.splice(idx, 1);
            }
          };
          removeFromQueue(quickplayQueue);
          removeFromQueue(rankedQueue);
          lobby.inGame = (lobby.inGame || []).filter(entry => entry !== id);

          if (quickplayQueue.length !== beforeQuick || rankedQueue.length !== beforeRanked) {
            eventBus.emit('queueChanged', {
              quickplayQueue: [...quickplayQueue],
              rankedQueue: [...rankedQueue],
              affectedUsers: [id],
            });
          }
        }, 3000);
      }
      // Emit updated metrics to admin dashboard
      emitAdminMetrics();
    });
  });

  // Admin namespace connections
  adminNamespace.on('connection', (socket) => {
    console.log('Admin connected', socket.id);
    // Send initial metrics snapshot
    emitAdminMetrics();

    socket.on('disconnect', () => {
      console.log('Admin disconnected', socket.id);
    });
  });

  async function emitAdminMetrics() {
    try {
      const connectedIds = Array.from(clients.keys());
      // Build in-game user list from active games
      const inGameSet = new Set();
      const gamesList = [];
      Array.from(games.values())
        .filter(game => game?.isActive)
        .forEach((game) => {
          const gameId = toId(game._id) || toId(game.id);
          const players = (game.players || []).map(p => p.toString());
          players.forEach(p => inGameSet.add(p));
          gamesList.push({ id: gameId, players });
        });
      const inGameIds = Array.from(inGameSet);

      const matchesList = Array.from(matches.values())
        .filter(match => match?.isActive)
        .map(match => ({
          id: toId(match._id) || toId(match.id),
          players: [match.player1?.toString(), match.player2?.toString()].filter(Boolean),
        }));

      const allIds = new Set([
        ...connectedIds,
        ...lobbyState.quickplayQueue,
        ...lobbyState.rankedQueue,
        ...inGameIds,
      ]);
      const users = await User.find({ _id: { $in: Array.from(allIds) } })
        .select('_id username')
        .lean();
      const usernames = {};
      users.forEach(u => {
        usernames[u._id.toString()] = u.username;
      });

      adminNamespace.emit('admin:metrics', {
        connectedUsers: connectedIds.length,
        quickplayQueue: lobbyState.quickplayQueue.length,
        rankedQueue: lobbyState.rankedQueue.length,
        inGameUsers: inGameIds.length,
        connectedUserIds: connectedIds,
        quickplayQueueUserIds: lobbyState.quickplayQueue,
        rankedQueueUserIds: lobbyState.rankedQueue,
        inGameUserIds: inGameIds,
        games: gamesList,
        matches: matchesList,
        usernames,
      });
    } catch (err) {
      console.error('Error emitting admin metrics:', err);
    }
  }

  return io;
}

module.exports = initSocket;
