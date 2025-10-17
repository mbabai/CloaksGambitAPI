const { Server } = require('socket.io');
const Game = require('./models/Game');
const Match = require('./models/Match');
const maskGameForColor = require('./utils/gameView');
const eventBus = require('./eventBus');
const ensureUser = require('./utils/ensureUser');
const { resolveUserFromToken } = require('./utils/authTokens');
const User = require('./models/User');
const getServerConfig = require('./utils/getServerConfig');
const { GAME_CONSTANTS } = require('../shared/constants');
const lobbyStore = require('./state/lobby');
const { buildSpectateSnapshot } = require('./utils/spectatorSnapshot');
const { normalizeActiveMatch, fetchMatchList } = require('./services/matches/activeMatches');

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

  async function createCustomMatch(player1Id, player2Id) {
    const players = [toId(player1Id), toId(player2Id)].filter(Boolean);
    if (players.length !== 2) {
      throw new Error('Two valid players are required for a custom match');
    }

    const config = await getServerConfig();
    let lobbyChanged = false;

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

    players.forEach((pid) => {
      const quickResult = lobbyStore.removeFromQueue('quickplay', pid);
      const rankedResult = lobbyStore.removeFromQueue('ranked', pid);
      if (quickResult.removed || rankedResult.removed) {
        lobbyChanged = true;
      }
    });

    const gamePlayers = Math.random() < 0.5
      ? [players[0], players[1]]
      : [players[1], players[0]];

    const { added: addedInGame } = lobbyStore.addInGame(players);
    if (addedInGame) {
      lobbyChanged = true;
    }

    if (lobbyChanged) {
      lobbyStore.emitQueueChanged(players);
    }

    const match = await Match.create({
      player1: players[0],
      player2: players[1],
      type: typeValue,
      player1Score: 0,
      player2Score: 0,
      games: [],
    });

    const game = await Game.create({
      players: gamePlayers,
      match: match._id,
      timeControlStart: timeControl,
      increment,
    });

    match.games.push(game._id);
    await match.save();

    const affected = gamePlayers.map(id => id.toString());
    eventBus.emit('gameChanged', {
      game: typeof game.toObject === 'function' ? game.toObject() : game,
      affectedUsers: affected,
    });
    eventBus.emit('players:bothNext', {
      game: typeof game.toObject === 'function' ? game.toObject() : game,
      affectedUsers: affected,
    });
    eventBus.emit('match:created', {
      matchId: match._id.toString(),
      players: affected,
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

  function registerMatch(matchId, players = [], options = {}) {
    const mid = toId(matchId);
    if (!mid) return;
    const state = getMatchState(mid);
    const forceConnectedIds = new Set();
    const { forceConnected } = options || {};
    if (forceConnected instanceof Set) {
      forceConnected.forEach((value) => {
        const id = toId(value);
        if (id) forceConnectedIds.add(id);
      });
    } else if (Array.isArray(forceConnected)) {
      forceConnected.forEach((value) => {
        const id = toId(value);
        if (id) forceConnectedIds.add(id);
      });
    } else if (forceConnected) {
      const id = toId(forceConnected);
      if (id) forceConnectedIds.add(id);
    }

    players.forEach((player) => {
      const pid = toId(player);
      if (!pid) return;
      if (!state.players[pid]) {
        state.players[pid] = { cumulativeMs: 0, disconnectedSince: null, timer: null, handled: false };
      }
      addPlayerMatch(pid, mid);
      if (forceConnectedIds.has(pid) || clients.has(pid)) {
        markPlayerConnected(pid, mid);
        console.log('[match] tracking player connected', {
          matchId: mid,
          playerId: pid,
          forced: forceConnectedIds.has(pid),
          hasSocket: clients.has(pid),
        });
      } else {
        markPlayerDisconnected(pid, mid);
        console.log('[match] tracking player disconnected', {
          matchId: mid,
          playerId: pid,
          forced: forceConnectedIds.has(pid),
          hasSocket: clients.has(pid),
        });
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
      const match = await Match.findById(matchId);
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

      const games = await Game.find({ match: match._id, isActive: true });

      await match.endMatch(winnerId);

      for (const game of games) {
        const winnerIdx = game.players.findIndex(p => p.toString() === winnerId);
        if (winnerIdx === -1) continue;
        await game.endGame(winnerIdx, winReasonValue);
        const updatedGame = await Game.findById(game._id).lean();
        if (updatedGame) {
          eventBus.emit('gameChanged', {
            game: updatedGame,
            affectedUsers: (updatedGame.players || []).map(id => id.toString()),
          });
        }
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

  const defaultNamespace = io.of('/');
  // Admin namespace for dashboard metrics
  const adminNamespace = io.of('/admin');

  function getRoomSize(adapter, roomName) {
    if (!adapter || !roomName) return 0;
    const { rooms } = adapter;
    if (!rooms) return 0;
    if (typeof rooms.get === 'function') {
      const room = rooms.get(roomName);
      return room && typeof room.size === 'number' ? room.size : 0;
    }
    const room = rooms[roomName];
    if (!room) return 0;
    if (typeof room.size === 'number') return room.size;
    if (typeof room.length === 'number') return room.length;
    if (typeof room === 'object') {
      return Object.keys(room).length;
    }
    return 0;
  }

  function emitSpectateEvent(roomName, event, payload) {
    if (!roomName || !event) return;
    try {
      defaultNamespace.to(roomName).emit(event, payload);
    } catch (err) {
      console.error(`Error emitting ${event} to default spectate room:`, err);
    }
    try {
      adminNamespace.to(roomName).emit(event, payload);
    } catch (err) {
      console.error(`Error emitting ${event} to admin spectate room:`, err);
    }
  }

  async function joinSpectateRoom(socket, payload = {}) {
    const matchId = payload.matchId || payload.id;
    const id = toId(matchId);
    if (!id) {
      socket.emit('spectate:error', { matchId: null, message: 'matchId is required' });
      return;
    }

    const roomName = `spectate:${id}`;
    try {
      socket.join(roomName);
      if (socket.data && socket.data.spectating && typeof socket.data.spectating.add === 'function') {
        socket.data.spectating.add(id);
      }
      const snapshot = await buildSpectateSnapshot(id);
      if (!snapshot) {
        socket.emit('spectate:error', { matchId: id, message: 'Match not found' });
        socket.leave(roomName);
        if (socket.data && socket.data.spectating && typeof socket.data.spectating.delete === 'function') {
          socket.data.spectating.delete(id);
        }
        return;
      }
      socket.emit('spectate:snapshot', snapshot);
    } catch (err) {
      console.error('Error handling spectate:join:', err);
      socket.emit('spectate:error', { matchId: id, message: 'Failed to load match' });
      socket.leave(roomName);
      if (socket.data && socket.data.spectating && typeof socket.data.spectating.delete === 'function') {
        socket.data.spectating.delete(id);
      }
    }
  }

  function leaveSpectateRoom(socket, payload = {}) {
    const matchId = payload.matchId || payload.id;
    const id = toId(matchId);
    if (!id) return;
    const roomName = `spectate:${id}`;
    socket.leave(roomName);
    if (socket.data && socket.data.spectating && typeof socket.data.spectating.delete === 'function') {
      socket.data.spectating.delete(id);
    }
  }

  const lobbyState = lobbyStore.getState();

  eventBus.on('queueChanged', (payload) => {
    let newQuick = [];
    let newRanked = [];
    let newBots = [];
    const affected = new Set();

    if (payload.fullDocument) {
      const { quickplayQueue = [], rankedQueue = [], botQueue = [] } = payload.fullDocument;
      newQuick = quickplayQueue.map(id => id.toString());
      newRanked = rankedQueue.map(id => id.toString());
      newBots = botQueue.map(id => id.toString());

      const added = new Set();
      const removed = new Set();

      newQuick.forEach(id => { if (!lobbyState.quickplayQueue.includes(id)) added.add(id); });
      lobbyState.quickplayQueue.forEach(id => { if (!newQuick.includes(id)) removed.add(id); });
      newRanked.forEach(id => { if (!lobbyState.rankedQueue.includes(id)) added.add(id); });
      lobbyState.rankedQueue.forEach(id => { if (!newRanked.includes(id)) removed.add(id); });
      newBots.forEach(id => { if (!lobbyState.botQueue.includes(id)) added.add(id); });
      lobbyState.botQueue.forEach(id => { if (!newBots.includes(id)) removed.add(id); });

      [...added, ...removed].forEach(id => affected.add(id));
    } else {
      newQuick = (payload.quickplayQueue || []).map(id => id.toString());
      newRanked = (payload.rankedQueue || []).map(id => id.toString());
      newBots = (payload.botQueue || []).map(id => id.toString());
      (payload.affectedUsers || []).forEach(id => affected.add(id.toString()));
    }

    affected.forEach((id) => {
      const socket = clients.get(id);
      if (socket) {
        socket.emit('queue:update', {
          quickplay: newQuick.includes(id),
          ranked: newRanked.includes(id),
          bots: newBots.includes(id),
        });
      }
    });

    lobbyState.quickplayQueue = newQuick;
    lobbyState.rankedQueue = newRanked;
    lobbyState.botQueue = newBots;

    // Emit updated metrics to admin dashboard
    emitAdminMetrics();
  });

  eventBus.on('match:created', (payload) => {
    if (!payload) return;
    const forceConnected = new Set(payload.forceConnected || payload.botPlayers || []);
    console.log('[match] created event', {
      matchId: payload.matchId,
      players: payload.players,
      type: payload.type,
      botPlayers: payload.botPlayers,
      forceConnected: Array.from(forceConnected),
    });
    registerMatch(payload.matchId, payload.players || [], { forceConnected });
  });

  eventBus.on('match:ended', (payload) => {
    if (!payload) return;
    cleanupMatchTracking(payload.matchId);
    emitAdminMetrics();
    if (payload.matchId) {
      emitSpectateUpdate(payload.matchId).catch((err) => {
        console.error('Error emitting spectate update after match end:', err);
      });
    }
  });

  async function emitSpectateUpdate(matchId) {
    const id = toId(matchId);
    if (!id) return;
    const roomName = `spectate:${id}`;
    const hasListeners =
      getRoomSize(defaultNamespace?.adapter, roomName) > 0 ||
      getRoomSize(adminNamespace?.adapter, roomName) > 0;
    if (!hasListeners) return;

    try {
      const snapshot = await buildSpectateSnapshot(id);
      if (!snapshot) {
        emitSpectateEvent(roomName, 'spectate:error', {
          matchId: id,
          message: 'Match not found',
        });
        return;
      }
      emitSpectateEvent(roomName, 'spectate:update', snapshot);
    } catch (err) {
      console.error('Error emitting spectate update:', err);
    }
  }

  function buildAdminMatchPayload(payload = {}) {
    try {
      return normalizeActiveMatch(payload);
    } catch (err) {
      console.error('Error normalizing admin match payload:', err);
      return null;
    }
  }

  eventBus.on('match:updated', (payload) => {
    emitAdminMetrics();
    try {
      const normalized = buildAdminMatchPayload(payload || {});
      if (normalized) {
        adminNamespace.emit('admin:matchUpdated', normalized);
        const targetMatchId = toId(payload?.matchId || normalized.id);
        if (targetMatchId) {
          emitSpectateUpdate(targetMatchId).catch((err) => {
            console.error('Error emitting spectate update after match change:', err);
          });
        }
      }
    } catch (err) {
      console.error('Error emitting admin match update:', err);
    }
  });

  eventBus.on('user:updated', (payload) => {
    try {
      if (!payload) return;
      const id = toId(payload.userId);
      if (!id) return;
      const username = typeof payload.username === 'string' ? payload.username : null;
      setConnectedUsername(id, username);
      const message = { userId: id, username };
      io.emit('user:nameUpdated', message);
      adminNamespace.emit('user:nameUpdated', message);
      emitAdminMetrics();
    } catch (err) {
      console.error('Error broadcasting user update:', err);
    }
  });

  eventBus.on('gameChanged', (payload) => {
    let game = payload?.game;
    if (game && typeof game.toObject === 'function') {
      game = game.toObject();
    }

    if (!game) {
      const gameId = payload?.documentKey?._id || payload?.gameId;
      if (gameId) {
        const inMemory = Game._getRawDocument(gameId);
        if (inMemory) {
          game = JSON.parse(JSON.stringify(inMemory));
        }
      }
    }

    if (!game) return;

    const matchId = game.match?.toString();
    const gameIdStr = game._id.toString();
    const players = (payload.affectedUsers || game.players || []).map(id => id.toString());

    const initiator = payload?.initiator || {};
    const botTargets = Array.isArray(payload?.botPlayers)
      ? payload.botPlayers.map(id => id.toString())
      : [];
    console.log('[socket] gameChanged broadcast', {
      gameId: gameIdStr,
      matchId,
      players,
      initiator,
      botTargets,
      setupComplete: game.setupComplete,
      playersReady: game.playersReady,
      playerTurn: game.playerTurn,
    });

    players.forEach((playerId) => {
      const socket = clients.get(playerId);
      if (!socket) {
        console.warn('[socket] gameChanged target missing socket', { playerId, gameId: gameIdStr });
        return;
      }
      const idx = game.players.findIndex(p => p.toString() === playerId);
      const masked = maskGameForColor(JSON.parse(JSON.stringify(game)), idx);
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
        setupComplete: game.setupComplete,
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

    if (matchId) {
      emitSpectateUpdate(matchId).catch((err) => {
        console.error('Error emitting spectate update after game change:', err);
      });
    }
  });

  // Relay explicit both-ready signal to affected users
  eventBus.on('players:bothReady', (payload) => {
    const gameId = payload?.gameId?.toString?.() || payload?.gameId
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
  eventBus.on('players:bothNext', async (payload) => {
    console.log('[socket] players:bothNext event', {
      gameId: payload?.gameId?.toString?.() || payload?.gameId,
      affectedUsers: (payload?.affectedUsers || []).map(id => id.toString()),
      botPlayers: payload?.botPlayers,
    });
    let game = payload.game;
    if (!game) {
      const gameId = payload?.gameId;
      if (gameId) {
        try {
          game = await Game.findById(gameId).lean();
        } catch (_) {}
      }
    }
    if (!game) return;
    const gameIdStr = game._id.toString();
    (payload?.affectedUsers || game.players || []).forEach((id, idx) => {
      const userId = id.toString();
      const socket = clients.get(userId);
      if (socket) {
        socket.emit('players:bothNext', { gameId: gameIdStr, color: idx });
      } else {
        console.warn('[socket] players:bothNext target not connected', { userId, gameId: gameIdStr });
      }
    });
  });

  // Allow other parts of the app to request an on-demand admin metrics refresh
  eventBus.on('adminRefresh', () => emitAdminMetrics());

  io.on('connection', async (socket) => {
    const { token, userId: providedUserId } = socket.handshake.auth || {};
    let userId = providedUserId;
    let userInfo = null;
    let authenticated = false;

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

    const userRecord = await User.findById(userId).lean().catch(() => null);
    const isBotUser = Boolean(userRecord?.isBot);
    const isGuestUser = Boolean(userInfo?.isGuest ?? userRecord?.isGuest);
    const usernameForLog = userRecord?.username || userInfo?.username;
    const connectionLabel = authenticated ? 'logged-in' : 'anonymous';
    console.log('[socket] connection established', {
      socketId: socket.id,
      userId,
      username: usernameForLog,
      authenticated,
      label: connectionLabel,
      isBot: isBotUser,
      isGuest: isGuestUser,
    });
    // If a user reconnects quickly, keep the most recent socket only
    const prev = clients.get(userId);
    if (prev && prev.id !== socket.id) {
      try { prev.disconnect(true) } catch (_) {}
    }
    clients.set(userId, socket);
    setConnectedUsername(userId, userInfo.username);
    markPlayerConnectedToAllMatches(userId);
    socket.emit('user:init', { userId, username: userInfo.username, guest: Boolean(userInfo.isGuest) });
    socket.data = socket.data || {};
    socket.data.isBot = isBotUser;
    socket.data.isGuest = isGuestUser;
    socket.data.username = usernameForLog;
    console.log('Client connected', socket.id);

    if (isGuestUser && !isBotUser) {
      try {
        await User.updateOne({ _id: userId }, { $set: { lastDisconnectedAt: null } });
      } catch (err) {
        console.error('Failed to clear guest disconnect timestamp on connect:', err);
      }
    }

    socket.data.spectating = new Set();

    // Emit updated metrics to admin dashboard on new connection
    emitAdminMetrics();

    try {
      const lobby = lobbyStore.getState();
      const queued = {
        quickplay: lobby.quickplayQueue.some(id => id === userId),
        ranked: lobby.rankedQueue.some(id => id === userId),
        bots: lobby.botQueue.some(id => id === userId),
      };

      const games = await Game.find({ players: userId, isActive: true }).lean();

      const matchPlayers = new Map();
      const uniquePlayerIds = new Set();
      games.forEach((game) => {
        const matchId = toId(game?.match);
        if (!matchId) return;
        if (!matchPlayers.has(matchId)) {
          matchPlayers.set(matchId, new Set());
        }
        (game.players || []).forEach((p) => {
          const pid = toId(p);
          if (pid) {
            matchPlayers.get(matchId).add(pid);
            uniquePlayerIds.add(pid);
          }
        });
      });
      let botIds = new Set();
      if (uniquePlayerIds.size > 0) {
        try {
          const users = await User.find({ _id: { $in: Array.from(uniquePlayerIds) } }, { _id: 1, isBot: 1 }).lean();
          botIds = new Set(users.filter(user => user && user.isBot).map(user => user._id.toString()));
        } catch (err) {
          console.error('Failed to resolve bot users for connection status:', err);
        }
      }
      matchPlayers.forEach((playersSet, matchId) => {
        const forceConnected = new Set();
        playersSet.forEach((pid) => {
          if (botIds.has(pid)) {
            forceConnected.add(pid);
          }
        });
        registerMatch(matchId, Array.from(playersSet), { forceConnected });
      });

      const maskedGames = games.map((game) => {
        const color = game.players.findIndex(p => p.toString() === userId);
        const masked = maskGameForColor(game, color);
        return {
          ...masked,
          _id: game._id,
          players: game.players.map(p => p.toString()),
          playersReady: game.playersReady,
          startTime: game.startTime,
          timeControlStart: game.timeControlStart,
          increment: game.increment,
        };
      });

      if (socket.data?.isBot) {
        console.log('[socket] bot initialState snapshot', {
          userId,
          username: socket.data?.username,
          activeGames: maskedGames.map(g => g?._id?.toString?.() || g?._id),
        });
      }

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

    socket.on('spectate:join', (payload = {}) => {
      joinSpectateRoom(socket, payload);
    });

    socket.on('spectate:leave', (payload = {}) => {
      leaveSpectateRoom(socket, payload);
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

    socket.on('disconnect', async (reason) => {
      const disconnectLog = {
        socketId: socket.id,
        userId,
        username: socket.data?.username,
        isBot: socket.data?.isBot || false,
        reason: reason || null,
      };
      console.log('[socket] disconnect', disconnectLog);
      if (socket.data?.spectating) {
        socket.data.spectating.clear();
      }
      if (userId) {
        const current = clients.get(userId);
        const isCurrent = !current || current.id === socket.id;
        if (isCurrent) {
          // Grace period: remove mapping now, but defer queue cleanup
          clearPendingInvitesForUser(userId, 'disconnect');
          clients.delete(userId);
          markPlayerDisconnectedFromAllMatches(userId);
          removeConnectedUsername(userId);

          if (socket.data?.isGuest && !socket.data?.isBot) {
            try {
              await User.updateOne({ _id: userId }, { $set: { lastDisconnectedAt: new Date() } });
            } catch (err) {
              console.error('Failed to record guest disconnect timestamp:', err);
            }
          }
        }
        setTimeout(() => {
          // If user reconnected, skip cleanup
          if (clients.has(userId)) return;
          try {
            const quickRemoved = lobbyStore.removeFromQueue('quickplay', userId).removed;
            const rankedRemoved = lobbyStore.removeFromQueue('ranked', userId).removed;
            if (quickRemoved || rankedRemoved) {
              lobbyStore.emitQueueChanged([userId]);
            }
          } catch (err) {
            console.error('Error cleaning up queue after disconnect:', err);
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

    socket.data = socket.data || {};
    socket.data.spectating = new Set();

    socket.on('spectate:join', (payload = {}) => {
      joinSpectateRoom(socket, payload);
    });

    socket.on('spectate:leave', (payload = {}) => {
      leaveSpectateRoom(socket, payload);
    });

    socket.on('disconnect', () => {
      console.log('Admin disconnected', socket.id);
      if (socket.data?.spectating) {
        socket.data.spectating.clear();
      }
    });
  });

  async function emitAdminMetrics() {
    try {
      const connectedEntries = Array.from(clients.entries());
      const connectedIds = [];
      let connectedUserCount = 0;
      connectedEntries.forEach(([id, socket]) => {
        if (socket?.data?.isBot) {
          return;
        }
        connectedUserCount += 1;
        connectedIds.push(id);
      });
      const allConnectedIds = connectedEntries.map(([id]) => id);
      // Build in-game user list from active games
      let inGameIds = [];
      let matchesList = [];
      try {
        const activeGames = await Game.find({ isActive: true }).select('players _id').lean();
        const set = new Set();
        activeGames.forEach(g => {
          (g.players || []).forEach(p => set.add(p.toString()));
        });
        inGameIds = Array.from(set);
      } catch (err) {
        console.error('Error fetching active games for admin metrics:', err);
      }

      try {
        const results = await fetchMatchList({ status: 'active' });
        matchesList = Array.isArray(results) ? results : [];
      } catch (err) {
        console.error('Error fetching active matches for admin metrics:', err);
      }

      const allIds = new Set([
        ...allConnectedIds,
        ...lobbyState.quickplayQueue,
        ...lobbyState.botQueue,
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
        connectedUsers: connectedUserCount,
        quickplayQueue: lobbyState.quickplayQueue.length,
        botQueue: lobbyState.botQueue.length,
        rankedQueue: lobbyState.rankedQueue.length,
        inGameUsers: inGameIds.length,
        connectedUserIds: connectedIds,
        quickplayQueueUserIds: lobbyState.quickplayQueue,
        botQueueUserIds: lobbyState.botQueue,
        rankedQueueUserIds: lobbyState.rankedQueue,
        inGameUserIds: inGameIds,
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
