import { normalizeId } from '../history/dashboard.js';

function normalizeScoreValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function resolveMatchType(source) {
  if (!source) return null;
  const candidates = [
    source.type,
    source.matchType,
    source.mode,
    source.matchMode,
    source.gameMode,
    source?.settings?.type,
    source?.settings?.mode,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toUpperCase();
    }
  }
  return null;
}

function resolveScoreValue(...values) {
  const candidates = [];
  values.forEach((value) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'object') {
      if ('wins' in value) {
        const parsed = normalizeScoreValue(value.wins);
        if (Number.isFinite(parsed)) candidates.push(parsed);
      }
      if ('count' in value) {
        const parsed = normalizeScoreValue(value.count);
        if (Number.isFinite(parsed)) candidates.push(parsed);
      }
      if ('value' in value) {
        const parsed = normalizeScoreValue(value.value);
        if (Number.isFinite(parsed)) candidates.push(parsed);
      }
    }
    const parsed = normalizeScoreValue(value);
    if (Number.isFinite(parsed)) candidates.push(parsed);
  });
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function normalizeActiveMatchRecord(match) {
  if (!match) return null;
  const id = normalizeId(match.id || match._id || match.matchId);
  if (!id) return null;
  const primaryPlayers = Array.isArray(match.players)
    ? match.players.map((playerId) => normalizeId(playerId)).filter(Boolean)
    : [];
  const fallbackPlayers = [match.player1, match.player2]
    .map((playerId) => normalizeId(playerId))
    .filter(Boolean);
  const players = primaryPlayers.length > 0 ? primaryPlayers : fallbackPlayers;
  const normalized = {
    id,
    type: resolveMatchType(match),
    players,
    player1Score: resolveScoreValue(
      match.player1Score,
      match.player1_score,
      match.scores?.[0],
      match.scores?.player1,
      match.results?.player1?.wins,
    ),
    player2Score: resolveScoreValue(
      match.player2Score,
      match.player2_score,
      match.scores?.[1],
      match.scores?.player2,
      match.results?.player2?.wins,
    ),
    drawCount: resolveScoreValue(
      match.drawCount,
      match.draws,
      match.scores?.[2],
      match.scores?.draws,
      match.results?.draws,
    ),
  };
  if (match.isActive !== undefined) {
    normalized.isActive = Boolean(match.isActive);
  }
  if (match.playerDetails) {
    normalized.playerDetails = match.playerDetails;
  }
  return normalized;
}

function formatMatchTypeLabel(type) {
  if (!type) return 'Match';
  const upper = String(type).trim().toUpperCase();
  if (upper === 'RANKED') return 'Ranked';
  if (upper === 'QUICKPLAY') return 'Quickplay';
  if (upper === 'CUSTOM') return 'Custom';
  return `${String(type).charAt(0).toUpperCase()}${String(type).slice(1).toLowerCase()}`;
}

function renderActiveMatchesList(targetEl, items, options = {}) {
  if (!targetEl) return;
  targetEl.innerHTML = '';
  if (!Array.isArray(items) || items.length === 0) return;

  const {
    getUsername = (id) => id || 'Unknown',
    onSpectate = () => {},
    buttonLabel = 'Spectate',
  } = options;

  const frag = document.createDocumentFragment();

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '12px';

    const typePill = document.createElement('span');
    typePill.className = 'matchTypePill';
    typePill.textContent = formatMatchTypeLabel(item?.type);
    row.appendChild(typePill);

    const players = Array.isArray(item?.players) ? item.players : [];
    const player1Id = players[0] || null;
    const player2Id = players[1] || null;
    const player1Name = getUsername(player1Id);
    const player2Name = getUsername(player2Id);

    const player1Score = normalizeScoreValue(item?.player1Score);
    const player2Score = normalizeScoreValue(item?.player2Score);
    const drawCount = normalizeScoreValue(item?.drawCount);

    const scoreLine = document.createElement('div');
    scoreLine.className = 'matchScoreLine';
    scoreLine.style.flex = '1 1 auto';
    scoreLine.style.minWidth = '0';
    const opponentLine = [player1Name || player1Id || 'Player 1', 'vs', player2Name || player2Id || 'Player 2']
      .filter(Boolean)
      .join(' ');
    scoreLine.title = opponentLine;

    const player1Label = document.createElement('span');
    player1Label.className = 'matchPlayerName';
    player1Label.textContent = player1Name || player1Id || 'Player 1';
    scoreLine.appendChild(player1Label);

    const player1ScoreEl = document.createElement('span');
    player1ScoreEl.className = 'matchScoreValue';
    player1ScoreEl.textContent = player1Score;
    scoreLine.appendChild(player1ScoreEl);

    const separatorEl = document.createElement('span');
    separatorEl.className = 'matchScoreSeparator';
    separatorEl.textContent = '-';
    scoreLine.appendChild(separatorEl);

    const player2ScoreEl = document.createElement('span');
    player2ScoreEl.className = 'matchScoreValue';
    player2ScoreEl.textContent = player2Score;
    scoreLine.appendChild(player2ScoreEl);

    const player2Label = document.createElement('span');
    player2Label.className = 'matchPlayerName';
    player2Label.textContent = player2Name || player2Id || 'Player 2';
    scoreLine.appendChild(player2Label);

    row.appendChild(scoreLine);

    const drawLine = document.createElement('div');
    drawLine.className = 'matchDrawLine';
    drawLine.title = `Draws: ${drawCount}`;

    const drawIcon = document.createElement('img');
    drawIcon.src = 'assets/images/draw.png';
    drawIcon.alt = 'Draws';
    drawIcon.className = 'matchDrawIcon';
    drawLine.appendChild(drawIcon);

    const drawValue = document.createElement('span');
    drawValue.className = 'matchScoreValue';
    drawValue.textContent = drawCount;
    drawLine.appendChild(drawValue);

    row.appendChild(drawLine);

    const spectateBtn = document.createElement('button');
    spectateBtn.type = 'button';
    spectateBtn.className = 'spectateBtn';
    spectateBtn.textContent = buttonLabel;
    spectateBtn.setAttribute('aria-label', `Spectate match ${item?.id || ''}`.trim());
    if (item?.id) {
      spectateBtn.addEventListener('click', () => {
        onSpectate(item);
      });
    } else {
      spectateBtn.disabled = true;
    }
    row.appendChild(spectateBtn);

    frag.appendChild(row);
  });

  targetEl.appendChild(frag);
}

async function fetchActiveMatchesList(options = {}) {
  const {
    fetchImpl,
    includeUsers = true,
    status = 'active',
    userId = null,
    signal,
    credentials,
    headers: customHeaders,
  } = options || {};

  const fetchFn = typeof fetchImpl === 'function'
    ? fetchImpl
    : (input, init) => fetch(input, init);

  const payload = {};
  const trimmedStatus = typeof status === 'string' ? status.trim() : '';
  if (trimmedStatus) {
    payload.status = trimmedStatus;
  }
  const trimmedUserId = typeof userId === 'string' ? userId.trim() : userId;
  if (trimmedUserId) {
    payload.userId = trimmedUserId;
  }
  if (includeUsers) {
    payload.includeUsers = true;
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(customHeaders || {}),
  };

  const requestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  };

  if (signal) {
    requestInit.signal = signal;
  }

  if (credentials !== undefined) {
    requestInit.credentials = credentials;
  } else if (!fetchImpl) {
    requestInit.credentials = 'include';
  }

  const response = await fetchFn('/api/v1/matches/getList', requestInit);

  if (!response || !response.ok) {
    const statusCode = response ? response.status : 0;
    const error = new Error(`Failed to load matches (${statusCode || 'network'})`);
    error.status = statusCode;
    throw error;
  }

  const data = await response.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

function createActiveMatchesStore(options = {}) {
  const { onChange } = options;
  const state = new Map();
  const subscribers = new Set();

  function emitChange() {
    const items = Array.from(state.values());
    if (typeof onChange === 'function') {
      try {
        onChange(items);
      } catch (err) {
        console.error('Active matches onChange handler failed', err);
      }
    }
    subscribers.forEach((listener) => {
      try {
        listener(items);
      } catch (err) {
        console.error('Active matches subscriber failed', err);
      }
    });
  }

  function storeNormalizedMatch(normalized, existing) {
    if (!normalized) return false;

    if (normalized.isActive === false) {
      const removed = state.delete(normalized.id);
      if (removed) {
        emitChange();
      }
      return removed;
    }

    const next = {
      id: normalized.id,
      type: normalized.type || existing?.type || null,
      players: normalized.players.length > 0 ? normalized.players : (existing?.players || []),
      player1Score: Number.isFinite(normalized.player1Score)
        ? normalized.player1Score
        : (existing?.player1Score ?? 0),
      player2Score: Number.isFinite(normalized.player2Score)
        ? normalized.player2Score
        : (existing?.player2Score ?? 0),
      drawCount: Number.isFinite(normalized.drawCount)
        ? normalized.drawCount
        : (existing?.drawCount ?? 0),
    };

    if (normalized.playerDetails !== undefined) {
      next.playerDetails = normalized.playerDetails;
    } else if (existing?.playerDetails !== undefined) {
      next.playerDetails = existing.playerDetails;
    }

    const changed =
      !existing
      || existing.type !== next.type
      || existing.player1Score !== next.player1Score
      || existing.player2Score !== next.player2Score
      || existing.drawCount !== next.drawCount
      || existing.players.length !== next.players.length
      || existing.players.some((value, idx) => value !== next.players[idx])
      || existing.playerDetails !== next.playerDetails;

    if (changed || !existing) {
      state.set(next.id, next);
      emitChange();
      return true;
    }

    return false;
  }

  function replaceAll(matches) {
    const hadMatches = state.size > 0;
    state.clear();
    let storedAny = false;
    if (Array.isArray(matches)) {
      matches.forEach((match) => {
        const normalized = normalizeActiveMatchRecord(match);
        if (!normalized || normalized.isActive === false) return;
        const record = {
          id: normalized.id,
          type: normalized.type || null,
          players: Array.isArray(normalized.players) ? normalized.players : [],
          player1Score: Number.isFinite(normalized.player1Score) ? normalized.player1Score : 0,
          player2Score: Number.isFinite(normalized.player2Score) ? normalized.player2Score : 0,
          drawCount: Number.isFinite(normalized.drawCount) ? normalized.drawCount : 0,
        };
        if (normalized.playerDetails !== undefined) {
          record.playerDetails = normalized.playerDetails;
        }
        state.set(record.id, record);
        storedAny = true;
      });
    }
    if (hadMatches || storedAny || state.size === 0) {
      emitChange();
    }
    return storedAny || hadMatches;
  }

  function applyUpdate(match) {
    const normalized = normalizeActiveMatchRecord(match);
    const existing = normalized ? state.get(normalized.id) : null;
    return storeNormalizedMatch(normalized, existing);
  }

  function clear() {
    if (state.size === 0) return false;
    state.clear();
    emitChange();
    return true;
  }

  function getItems() {
    return Array.from(state.values());
  }

  function getState() {
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }

  return {
    replaceAll,
    applyUpdate,
    clear,
    getItems,
    getState,
    subscribe,
  };
}

export {
  normalizeScoreValue,
  resolveMatchType,
  resolveScoreValue,
  normalizeActiveMatchRecord,
  formatMatchTypeLabel,
  renderActiveMatchesList,
  fetchActiveMatchesList,
  createActiveMatchesStore,
};
