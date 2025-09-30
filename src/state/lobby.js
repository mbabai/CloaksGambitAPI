const eventBus = require('../eventBus');

function toId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return null;
}

const state = {
  quickplayQueue: [],
  rankedQueue: [],
  inGame: [],
};

function cloneState() {
  return {
    quickplayQueue: [...state.quickplayQueue],
    rankedQueue: [...state.rankedQueue],
    inGame: [...state.inGame],
  };
}

function emitQueueChanged(affectedUsers = []) {
  const unique = Array.from(new Set(affectedUsers.map(toId).filter(Boolean)));
  const snapshot = cloneState();
  eventBus.emit('queueChanged', {
    quickplayQueue: snapshot.quickplayQueue,
    rankedQueue: snapshot.rankedQueue,
    affectedUsers: unique,
  });
  return snapshot;
}

function isInQueue(queueName, userId) {
  const id = toId(userId);
  if (!id) return false;
  const queueKey = queueName === 'ranked' ? 'rankedQueue' : 'quickplayQueue';
  return state[queueKey].includes(id);
}

function isInAnyQueue(userId) {
  return isInQueue('quickplay', userId) || isInQueue('ranked', userId);
}

function isInGame(userId) {
  const id = toId(userId);
  if (!id) return false;
  return state.inGame.includes(id);
}

function addToQueue(queueName, userId, { allowDuplicate = false, toFront = false } = {}) {
  const id = toId(userId);
  if (!id) return { added: false, state: cloneState() };
  const queueKey = queueName === 'ranked' ? 'rankedQueue' : 'quickplayQueue';
  const queue = state[queueKey];
  if (!allowDuplicate && queue.includes(id)) {
    return { added: false, state: cloneState() };
  }
  if (toFront) {
    const existingIndex = queue.indexOf(id);
    if (existingIndex !== -1) {
      queue.splice(existingIndex, 1);
    }
    queue.unshift(id);
  } else {
    queue.push(id);
  }
  return { added: true, state: cloneState() };
}

function removeFromQueue(queueName, userId) {
  const id = toId(userId);
  if (!id) return { removed: false, state: cloneState() };
  const queueKey = queueName === 'ranked' ? 'rankedQueue' : 'quickplayQueue';
  const queue = state[queueKey];
  const initialLength = queue.length;
  const filtered = queue.filter(item => item !== id);
  if (filtered.length === initialLength) {
    return { removed: false, state: cloneState() };
  }
  state[queueKey] = filtered;
  return { removed: true, state: cloneState() };
}

function removeFromAllQueues(userId) {
  const id = toId(userId);
  if (!id) return { removed: false, state: cloneState() };
  const beforeQuick = state.quickplayQueue.length;
  state.quickplayQueue = state.quickplayQueue.filter(item => item !== id);
  const beforeRanked = state.rankedQueue.length;
  state.rankedQueue = state.rankedQueue.filter(item => item !== id);
  const changed = beforeQuick !== state.quickplayQueue.length || beforeRanked !== state.rankedQueue.length;
  return { removed: changed, state: cloneState() };
}

function addInGame(userIds = []) {
  const ids = Array.isArray(userIds) ? userIds.map(toId).filter(Boolean) : [toId(userIds)].filter(Boolean);
  if (ids.length === 0) {
    return { added: false, state: cloneState() };
  }
  let changed = false;
  ids.forEach((id) => {
    if (!state.inGame.includes(id)) {
      state.inGame.push(id);
      changed = true;
    }
  });
  return { added: changed, state: cloneState() };
}

function removeInGame(userIds = []) {
  const ids = Array.isArray(userIds) ? userIds.map(toId).filter(Boolean) : [toId(userIds)].filter(Boolean);
  if (ids.length === 0) {
    return { removed: false, state: cloneState() };
  }
  const before = state.inGame.length;
  state.inGame = state.inGame.filter(id => !ids.includes(id));
  return { removed: before !== state.inGame.length, state: cloneState() };
}

function clear() {
  state.quickplayQueue = [];
  state.rankedQueue = [];
  state.inGame = [];
  return cloneState();
}

function clearInGame() {
  if (state.inGame.length === 0) {
    return { cleared: false, state: cloneState() };
  }
  state.inGame = [];
  return { cleared: true, state: cloneState() };
}

module.exports = {
  getState: cloneState,
  isInQueue,
  isInAnyQueue,
  isInGame,
  addToQueue,
  removeFromQueue,
  removeFromAllQueues,
  addInGame,
  removeInGame,
  clearInGame,
  clear,
  emitQueueChanged,
  toId,
};
