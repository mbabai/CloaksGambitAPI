import { WIN_REASONS } from '../constants.js';

const WIN_REASON_LABELS = {
  [WIN_REASONS.CAPTURED_KING]: 'Captured King',
  [WIN_REASONS.THRONE]: 'Throne Victory',
  [WIN_REASONS.TRUE_KING]: 'True King Revealed',
  [WIN_REASONS.DAGGERS]: 'Daggers Victory',
  [WIN_REASONS.TIME_CONTROL]: 'Time Control',
  [WIN_REASONS.DISCONNECT]: 'Disconnect',
  [WIN_REASONS.RESIGN]: 'Resignation',
  [WIN_REASONS.DRAW]: 'Draw'
};

function normalizeId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const candidateKeys = ['_id', 'id', 'userId', 'playerId'];
    for (const key of candidateKeys) {
      if (!(key in value)) continue;
      const candidate = value[key];
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) return trimmed;
      }
      if (candidate && typeof candidate.toString === 'function') {
        const str = candidate.toString();
        if (str && str !== '[object Object]') return str;
      }
    }
    if (typeof value.toString === 'function') {
      const str = value.toString();
      if (str && str !== '[object Object]') return str;
    }
  }
  return null;
}

function formatWinReasonLabel(reason) {
  if (reason === null || reason === undefined) return '';
  return WIN_REASON_LABELS[reason] || 'Unknown';
}

import { createThroneIcon, createDrawIcon } from '../ui/icons.js';
import { createDaggerCounter } from '../ui/banners.js';

function computeWinPercentage(wins, total) {
  if (!total) return 0;
  return Math.round((wins / total) * 100);
}

function getMatchResult(match, userId) {
  const matchId = normalizeId(match?._id || match?.id);
  const player1Id = normalizeId(match?.player1);
  const player2Id = normalizeId(match?.player2);
  const winnerId = normalizeId(match?.winner);
  const type = typeof match?.type === 'string' ? match.type.toUpperCase() : '';
  const endedAt = match?.endTime ? new Date(match.endTime) : (match?.startTime ? new Date(match.startTime) : null);

  const p1Score = Number.isFinite(match?.player1Score) ? match.player1Score : 0;
  const p2Score = Number.isFinite(match?.player2Score) ? match.player2Score : 0;

  let player1Result = 'draw';
  let player2Result = 'draw';

  if (winnerId && (winnerId === player1Id || winnerId === player2Id)) {
    if (winnerId === player1Id) {
      player1Result = 'win';
      player2Result = 'loss';
    } else {
      player1Result = 'loss';
      player2Result = 'win';
    }
  } else if (p1Score !== p2Score) {
    if (p1Score > p2Score) {
      player1Result = 'win';
      player2Result = 'loss';
    } else {
      player1Result = 'loss';
      player2Result = 'win';
    }
  }

  const normalizedUserId = normalizeId(userId);
  let userResult = null;
  if (normalizedUserId) {
    if (normalizedUserId === player1Id) {
      userResult = player1Result;
    } else if (normalizedUserId === player2Id) {
      userResult = player2Result;
    }
  }

  return {
    matchId,
    type,
    endedAt,
    player1Id,
    player2Id,
    player1Score: p1Score,
    player2Score: p2Score,
    player1Result,
    player2Result,
    winnerId,
    userResult
  };
}

function computeHistorySummary(matches, games, { userId } = {}) {
  const summary = {
    games: { total: 0, wins: 0, draws: 0, losses: 0 },
    quickplayGames: { total: 0, wins: 0, draws: 0, losses: 0 },
    matches: { total: 0, wins: 0, draws: 0, losses: 0, winPct: 0 },
    customMatches: { total: 0, wins: 0, draws: 0, losses: 0, winPct: 0 },
    rankedMatches: { total: 0, wins: 0, draws: 0, losses: 0, winPct: 0 },
    botMatches: { total: 0, wins: 0, draws: 0, losses: 0, winPct: 0 },
    matchIndex: new Map()
  };

  const normalizedUserId = normalizeId(userId);
  const allMatches = Array.isArray(matches) ? matches : [];
  const allGames = Array.isArray(games) ? games : [];

  allMatches.forEach(match => {
    const id = normalizeId(match?._id || match?.id);
    if (id) {
      summary.matchIndex.set(id, match);
    }
  });

  const relevantMatches = allMatches.filter(match => {
    if (!match || match.isActive) return false;
    if (!normalizedUserId) return true;
    const p1 = normalizeId(match.player1);
    const p2 = normalizeId(match.player2);
    return p1 === normalizedUserId || p2 === normalizedUserId;
  });

  relevantMatches.forEach(match => {
    const result = getMatchResult(match, normalizedUserId);
    const isDraw = result.player1Result === 'draw' && result.player2Result === 'draw';
    const isRanked = result.type === 'RANKED';
    const isCustom = result.type === 'CUSTOM';
    const isBot = result.type === 'AI';

    if (normalizedUserId) {
      if (!result.userResult) return;
      summary.matches.total += 1;
      if (result.userResult === 'win') {
        summary.matches.wins += 1;
      } else if (result.userResult === 'loss') {
        summary.matches.losses += 1;
      } else {
        summary.matches.draws += 1;
      }
      if (isCustom) {
        summary.customMatches.total += 1;
        if (result.userResult === 'win') {
          summary.customMatches.wins += 1;
        } else if (result.userResult === 'loss') {
          summary.customMatches.losses += 1;
        } else {
          summary.customMatches.draws += 1;
        }
      }
      if (isRanked) {
        summary.rankedMatches.total += 1;
        if (result.userResult === 'win') {
          summary.rankedMatches.wins += 1;
        } else if (result.userResult === 'loss') {
          summary.rankedMatches.losses += 1;
        } else {
          summary.rankedMatches.draws += 1;
        }
      }
      if (isBot) {
        summary.botMatches.total += 1;
        if (result.userResult === 'win') {
          summary.botMatches.wins += 1;
        } else if (result.userResult === 'loss') {
          summary.botMatches.losses += 1;
        } else {
          summary.botMatches.draws += 1;
        }
      }
    } else {
      summary.matches.total += 1;
      if (isDraw) {
        summary.matches.draws += 1;
      } else {
        summary.matches.wins += 1;
        summary.matches.losses += 1;
      }
      if (isRanked) {
        summary.rankedMatches.total += 1;
        if (isDraw) {
          summary.rankedMatches.draws += 1;
        } else {
          summary.rankedMatches.wins += 1;
          summary.rankedMatches.losses += 1;
        }
      }
      if (isCustom) {
        summary.customMatches.total += 1;
        if (isDraw) {
          summary.customMatches.draws += 1;
        } else {
          summary.customMatches.wins += 1;
          summary.customMatches.losses += 1;
        }
      }
      if (isBot) {
        summary.botMatches.total += 1;
        if (isDraw) {
          summary.botMatches.draws += 1;
        } else {
          summary.botMatches.wins += 1;
          summary.botMatches.losses += 1;
        }
      }
    }
  });

  const relevantGames = allGames.filter(game => {
    if (!game || game.isActive) return false;
    const matchId = normalizeId(game.match);
    if (!matchId) return false;
    if (!summary.matchIndex.has(matchId)) return false;
    if (!normalizedUserId) return true;
    const players = Array.isArray(game.players) ? game.players.map(normalizeId) : [];
    return players.includes(normalizedUserId);
  });

  relevantGames.forEach(game => {
    const players = Array.isArray(game.players) ? game.players.map(normalizeId) : [];
    const matchId = normalizeId(game.match);
    const match = matchId ? summary.matchIndex.get(matchId) : null;
    const matchType = typeof match?.type === 'string' ? match.type.toUpperCase() : '';
    const winnerIdx = Number.isInteger(game.winner) ? game.winner : null;
    const winReason = game.winReason;
    const isDraw = winReason === WIN_REASONS.DRAW || winnerIdx === null || winnerIdx === undefined;

    if (normalizedUserId) {
      const playerIdx = players.findIndex(id => id === normalizedUserId);
      if (playerIdx === -1) return;
      summary.games.total += 1;
      if (matchType === 'QUICKPLAY') {
        summary.quickplayGames.total += 1;
      }

      if (isDraw) {
        summary.games.draws += 1;
        if (matchType === 'QUICKPLAY') {
          summary.quickplayGames.draws += 1;
        }
      } else if (playerIdx === winnerIdx) {
        summary.games.wins += 1;
        if (matchType === 'QUICKPLAY') {
          summary.quickplayGames.wins += 1;
        }
      } else {
        summary.games.losses += 1;
        if (matchType === 'QUICKPLAY') {
          summary.quickplayGames.losses += 1;
        }
      }
    } else {
      summary.games.total += 1;
      if (matchType === 'QUICKPLAY') {
        summary.quickplayGames.total += 1;
      }
      if (isDraw) {
        summary.games.draws += 1;
        if (matchType === 'QUICKPLAY') {
          summary.quickplayGames.draws += 1;
        }
      } else {
        summary.games.wins += 1;
        summary.games.losses += 1;
        if (matchType === 'QUICKPLAY') {
          summary.quickplayGames.wins += 1;
          summary.quickplayGames.losses += 1;
        }
      }
    }
  });

  summary.matches.winPct = computeWinPercentage(summary.matches.wins, summary.matches.total);
  summary.customMatches.winPct = computeWinPercentage(summary.customMatches.wins, summary.customMatches.total);
  summary.rankedMatches.winPct = computeWinPercentage(summary.rankedMatches.wins, summary.rankedMatches.total);
  summary.botMatches.winPct = computeWinPercentage(summary.botMatches.wins, summary.botMatches.total);

  return summary;
}

function createStatusIcon(status, { size = 20 } = {}) {
  if (status === 'win') {
    const icon = createThroneIcon({ size, alt: 'Win' });
    icon.className = 'cg-status-icon cg-status-icon--win';
    return icon;
  }
  if (status === 'loss') {
    const tokenGroup = createDaggerCounter({ count: 1, size, gap: 0, alt: 'Loss' });
    tokenGroup.className = 'cg-status-icon cg-status-icon--loss';
    return tokenGroup;
  }
  if (status === 'draw') {
    const icon = createDrawIcon({ size, alt: 'Draw' });
    icon.className = 'cg-status-icon cg-status-icon--draw';
    return icon;
  }
  return null;
}

function describeMatch(match, { usernameLookup = id => id, userId } = {}) {
  const result = getMatchResult(match, userId);
  const normalizedUserId = normalizeId(userId);
  const players = [];

  const playerEntries = [
    {
      id: result.player1Id,
      score: result.player1Score,
      result: result.player1Result,
      startElo: Number.isFinite(match?.player1StartElo) ? match.player1StartElo : null,
      endElo: Number.isFinite(match?.player1EndElo) ? match.player1EndElo : null
    },
    {
      id: result.player2Id,
      score: result.player2Score,
      result: result.player2Result,
      startElo: Number.isFinite(match?.player2StartElo) ? match.player2StartElo : null,
      endElo: Number.isFinite(match?.player2EndElo) ? match.player2EndElo : null
    }
  ];

  playerEntries.forEach(entry => {
    if (!entry.id) return;
    const name = usernameLookup(entry.id) || entry.id;
    const isUser = normalizedUserId && entry.id === normalizedUserId;
    const start = entry.startElo;
    const end = entry.endElo !== null ? entry.endElo : entry.startElo;
    const delta = (start !== null && end !== null) ? (end - start) : null;
    players.push({
      id: entry.id,
      name,
      score: entry.score,
      result: entry.result,
      startElo: start,
      endElo: end,
      delta,
      isUser
    });
  });

  return {
    id: result.matchId,
    type: result.type,
    endedAt: result.endedAt,
    players,
    winnerId: result.winnerId,
    userResult: result.userResult,
    draw: result.player1Result === 'draw' && result.player2Result === 'draw'
  };
}

function buildMatchDetailGrid(match, {
  usernameLookup = id => id,
  squareSize = 34,
  iconSize = 24,
  maxGameCount = null,
  onPlayerClick = null,
  currentUserId = null,
  shouldAllowPlayerClick = null
} = {}) {
  const lookupName = (id, fallback) => {
    if (!id) return fallback;
    const name = usernameLookup(id);
    if (name && typeof name === 'string') return name;
    return fallback || id;
  };

  const normalizedSquareSize = Number.isFinite(squareSize) ? Math.max(20, squareSize) : 34;
  const minimumSquareSize = Math.max(16, Math.round(normalizedSquareSize * 0.6));
  const gameIconSize = Math.max(12, Math.min(iconSize, Math.round(normalizedSquareSize * 0.7)));
  const playerStatusIconSize = Math.max(24, Math.round(normalizedSquareSize * 0.75));
  const normalizedViewerId = normalizeId(currentUserId);

  const container = document.createElement('div');
  container.className = 'history-match-table';
  container.setAttribute('role', 'table');
  container.setAttribute('aria-label', 'Match breakdown');

  const result = getMatchResult(match);

  const players = [
    {
      id: result.player1Id,
      name: lookupName(result.player1Id, 'Player 1'),
      score: Number.isFinite(match?.player1Score) ? match.player1Score : 0,
      result: result.player1Result,
      startElo: Number.isFinite(match?.player1StartElo) ? match.player1StartElo : null,
      endElo: Number.isFinite(match?.player1EndElo) ? match.player1EndElo : null
    },
    {
      id: result.player2Id,
      name: lookupName(result.player2Id, 'Player 2'),
      score: Number.isFinite(match?.player2Score) ? match.player2Score : 0,
      result: result.player2Result,
      startElo: Number.isFinite(match?.player2StartElo) ? match.player2StartElo : null,
      endElo: Number.isFinite(match?.player2EndElo) ? match.player2EndElo : null
    }
  ];

  players.forEach(player => {
    if (player.startElo !== null && player.endElo === null) {
      player.endElo = player.startElo;
    }
    if (player.startElo === null && player.endElo !== null) {
      player.startElo = player.endElo;
    }
    if (player.startElo !== null && player.endElo !== null) {
      player.delta = player.endElo - player.startElo;
    } else {
      player.delta = null;
    }
  });

  const games = Array.isArray(match?.games) ? match.games.slice() : [];
  games.sort((a, b) => {
    const aTime = new Date(a?.endTime || a?.startTime || a?.createdAt || 0).getTime();
    const bTime = new Date(b?.endTime || b?.startTime || b?.createdAt || 0).getTime();
    return aTime - bTime;
  });

  players.forEach((player, playerIndex) => {
    const row = document.createElement('div');
    row.className = 'history-match-row';
    row.setAttribute('role', 'row');

    const info = document.createElement('div');
    info.className = 'history-match-player-info';
    info.setAttribute('role', 'cell');
    if (player.name) {
      info.setAttribute('aria-label', `${player.name} match summary`);
    }

    const statusIcon = createStatusIcon(player.result, { size: playerStatusIconSize });
    if (statusIcon) {
      info.appendChild(statusIcon);
    }

    const details = document.createElement('div');
    details.className = 'history-match-player-details';

    const labelRow = document.createElement('div');
    labelRow.className = 'history-player-label-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'history-player-name';
    nameEl.textContent = player.name;
    if (player.name) {
      nameEl.title = player.name;
    }
    const normalizedPlayerId = normalizeId(player.id);
    const allowInteraction = typeof shouldAllowPlayerClick === 'function'
      ? (() => {
          try {
            return shouldAllowPlayerClick(normalizedPlayerId, { match, playerIndex });
          } catch (err) {
            console.warn('Error evaluating history player click allowance', err);
            return false;
          }
        })()
      : true;
    if (typeof onPlayerClick === 'function'
      && normalizedPlayerId
      && normalizedPlayerId !== normalizedViewerId
      && allowInteraction) {
      nameEl.classList.add('history-player-name--interactive');
      nameEl.setAttribute('role', 'button');
      nameEl.setAttribute('tabindex', '0');
      const payload = {
        id: normalizedPlayerId,
        name: player.name,
        elo: Number.isFinite(player.endElo)
          ? player.endElo
          : (Number.isFinite(player.startElo) ? player.startElo : null)
      };
      nameEl.addEventListener('click', (event) => {
        event.stopPropagation();
        onPlayerClick(payload, event);
      });
      nameEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPlayerClick(payload, event);
        }
      });
    }
    labelRow.appendChild(nameEl);

    const scoreEl = document.createElement('span');
    scoreEl.className = 'history-player-score';
    scoreEl.textContent = String(player.score ?? 0);
    labelRow.appendChild(scoreEl);

    details.appendChild(labelRow);

    if (player.startElo !== null && player.endElo !== null) {
      const eloEl = document.createElement('span');
      eloEl.className = 'history-player-elo';
      const delta = player.delta;
      const deltaText = delta === null || delta === undefined
        ? ''
        : delta > 0
          ? ` (+${delta})`
          : delta < 0
            ? ` (${delta})`
            : ' (±0)';
      eloEl.textContent = `${player.startElo} → ${player.endElo}${deltaText}`;
      details.appendChild(eloEl);
    }

    info.appendChild(details);
    row.appendChild(info);

    const gamesWrap = document.createElement('div');
    gamesWrap.className = 'history-match-games';
    gamesWrap.setAttribute('role', 'cell');
    if (player.name) {
      gamesWrap.setAttribute('aria-label', `${player.name} game results`);
    } else {
      gamesWrap.setAttribute('aria-label', 'Game results');
    }

    const totalGames = Math.max(1, games.length);
    const maxSquares = Number.isFinite(maxGameCount) && maxGameCount > 0
      ? Math.max(totalGames, Math.round(maxGameCount))
      : totalGames;
    gamesWrap.style.setProperty('--history-match-game-count', String(totalGames));
    gamesWrap.style.setProperty('--history-match-max-game-count', String(maxSquares));
    gamesWrap.style.setProperty('--history-match-square-base', `${normalizedSquareSize}px`);
    gamesWrap.style.setProperty('--history-match-square-min', `${minimumSquareSize}px`);

    if (games.length === 0) {
      if (playerIndex === 0) {
        const empty = document.createElement('div');
        empty.className = 'history-match-empty';
        empty.textContent = 'No games recorded for this match yet.';
        gamesWrap.appendChild(empty);
      }
    } else {
      games.forEach((game, index) => {
        const square = document.createElement('div');
        square.className = 'history-match-square';

        const playersInGame = Array.isArray(game?.players) ? game.players.map(normalizeId) : [];
        const colorByPlayer = new Map();
        if (playersInGame[0]) colorByPlayer.set(playersInGame[0], 'white');
        if (playersInGame[1]) colorByPlayer.set(playersInGame[1], 'black');
        const color = player.id ? colorByPlayer.get(player.id) : null;
        if (color === 'white') {
          square.classList.add('color-white');
        } else if (color === 'black') {
          square.classList.add('color-black');
        } else {
          square.classList.add('color-unknown');
        }

        const winnerIdx = Number.isInteger(game?.winner) ? game.winner : null;
        let status = 'draw';
        if (winnerIdx === 0 && color === 'white') {
          status = 'win';
        } else if (winnerIdx === 0 && color === 'black') {
          status = 'loss';
        } else if (winnerIdx === 1 && color === 'black') {
          status = 'win';
        } else if (winnerIdx === 1 && color === 'white') {
          status = 'loss';
        }

        if (game?.winReason === WIN_REASONS.DRAW || winnerIdx === null || winnerIdx === undefined) {
          status = 'draw';
        }

        const icon = createStatusIcon(status, { size: gameIconSize });
        if (icon) {
          square.appendChild(icon);
        }

        const hoverParts = [`Game ${index + 1}`];
        if (player.id) {
          hoverParts.push(player.name);
        }
        if (color) {
          hoverParts.push(color === 'white' ? 'White' : 'Black');
        }
        const statusLabel = status === 'draw' ? 'Draw' : (status === 'win' ? 'Win' : 'Loss');
        hoverParts.push(`Result: ${statusLabel}`);
        const winReasonLabel = formatWinReasonLabel(game?.winReason);
        if (winReasonLabel && status !== 'draw') {
          hoverParts.push(`Reason: ${winReasonLabel}`);
        } else if (winReasonLabel && status === 'draw') {
          hoverParts.push(winReasonLabel);
        }
        square.title = hoverParts.join('\n');
        square.setAttribute('aria-label', hoverParts.join(', '));

        gamesWrap.appendChild(square);
      });
    }

    row.appendChild(gamesWrap);
    container.appendChild(row);
  });

  return container;
}

export {
  normalizeId,
  formatWinReasonLabel,
  computeHistorySummary,
  createStatusIcon,
  describeMatch,
  buildMatchDetailGrid,
  getMatchResult
};
