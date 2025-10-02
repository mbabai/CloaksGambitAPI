import { normalizeId } from '../history/dashboard.js';
import { createBoardView } from '../components/boardView.js';
import { PIECE_IMAGES, ACTIONS, WIN_REASONS } from '../constants.js';
import { renderBars } from '../render/bars.js';
import { computeBoardMetrics } from '../layout.js';
import { formatClock, describeTimeControl } from '../utils/timeControl.js';
import { computeGameClockState } from '../utils/clockState.js';
import { getBubbleAsset } from '../ui/icons.js';
import { createOverlay } from '../ui/overlays.js';
import { deriveSpectateView } from './viewModel.js';
import { formatMatchTypeLabel } from './activeMatches.js';

function createDocumentFragment() {
  return document.createDocumentFragment();
}

function toIdString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'object') {
    if (value && Object.prototype.hasOwnProperty.call(value, '_id')) {
      return toIdString(value._id);
    }
    if (typeof value.toHexString === 'function') {
      try {
        return value.toHexString();
      } catch (_) {
        // ignore errors from BSON helpers
      }
    }
    if (typeof value.toString === 'function') {
      try {
        const str = value.toString();
        return str === '[object Object]' ? '' : str;
      } catch (_) {
        // ignore toString errors
      }
    }
    if (typeof value.valueOf === 'function') {
      try {
        const primitive = value.valueOf();
        if (primitive !== value) {
          return toIdString(primitive);
        }
      } catch (_) {
        // ignore valueOf errors
      }
    }
  }
  return '';
}

function resolvePlayerIndexFromId(value, playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    return null;
  }
  const target = toIdString(value);
  if (!target) {
    return null;
  }
  for (let i = 0; i < playerIds.length; i += 1) {
    const candidate = toIdString(playerIds[i]);
    if (candidate && candidate === target) {
      return i;
    }
  }
  return null;
}

function normalizeActionPlayer(value, playerIds) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
    const resolved = resolvePlayerIndexFromId(trimmed, playerIds);
    return resolved === null ? null : resolved;
  }
  const resolved = resolvePlayerIndexFromId(value, playerIds);
  if (resolved !== null) {
    return resolved;
  }
  return null;
}

export function createSpectateController(options) {
  const {
    overlayEl,
    playAreaEl,
    boardEl,
    topBarEl,
    bottomBarEl,
    statusEl,
    scoreEl,
    bannerEl,
    metaEl,
    closeButtonEl,
    socket,
    getUsername = (id) => id || 'Unknown',
    setUsername = () => {},
    onOpen = () => {},
    onClose = () => {},
  } = options || {};

  const spectateRefs = { boardCells: [], activeBubbles: [] };
  let spectateGameBannerOverlay = null;

  const boardView = boardEl
    ? createBoardView({
        container: boardEl,
        identityMap: PIECE_IMAGES,
        refs: spectateRefs,
        alwaysAttachGameRefs: true,
      })
    : null;

  if (boardView) {
    boardView.setReadOnly(true);
  }

  const spectateState = {
    matchId: null,
    data: null,
    loading: false,
    resizeHandler: null,
    clockTimer: null,
    clockBase: null,
    clockDisplay: { whiteMs: 0, blackMs: 0, label: null },
    clockRefs: { top: null, bottom: null },
    lastBoardGame: null,
    lastCompletedGame: null,
  };

  function stopSpectateClockTimer() {
    if (spectateState.clockTimer) {
      clearInterval(spectateState.clockTimer);
      spectateState.clockTimer = null;
    }
  }

  function updateSpectateClockElements() {
    const topEl = spectateState.clockRefs?.top;
    const bottomEl = spectateState.clockRefs?.bottom;
    const display = spectateState.clockDisplay || { whiteMs: 0, blackMs: 0 };
    if (topEl) {
      topEl.textContent = formatClock(display.blackMs || 0);
    }
    if (bottomEl) {
      bottomEl.textContent = formatClock(display.whiteMs || 0);
    }
  }

  function updateSpectateClockDisplay() {
    const base = spectateState.clockBase;
    if (!base) {
      spectateState.clockDisplay = { whiteMs: 0, blackMs: 0, label: null };
      updateSpectateClockElements();
      return;
    }
    const now = Date.now();
    const elapsed = Math.max(0, now - base.receivedAt);
    let white = base.whiteMs;
    let black = base.blackMs;
    if (base.tickingWhite) {
      white -= elapsed;
    }
    if (base.tickingBlack) {
      black -= elapsed;
    }
    spectateState.clockDisplay = {
      whiteMs: Math.max(0, Math.round(white)),
      blackMs: Math.max(0, Math.round(black)),
      label: base.label || null,
    };
    updateSpectateClockElements();
  }

  function resetSpectateClockState() {
    stopSpectateClockTimer();
    spectateState.clockBase = null;
    spectateState.clockDisplay = { whiteMs: 0, blackMs: 0, label: null };
    updateSpectateClockElements();
  }

  function syncSpectateClocks(snapshot) {
    const game = snapshot?.game || null;
    if (!game) {
      resetSpectateClockState();
      return;
    }

    const baseTime = Number(game.timeControlStart);
    if (!Number.isFinite(baseTime) || baseTime <= 0) {
      resetSpectateClockState();
      return;
    }

    const matchActive = snapshot?.match?.isActive !== false;
    const now = Date.now();
    const computed = computeGameClockState({
      baseTime,
      increment: game.increment,
      startTime: game.startTime,
      endTime: game.endTime,
      actions: game.actions,
      setupComplete: game.setupComplete,
      playerTurn: game.playerTurn ?? snapshot?.clocks?.activeColor,
      isActive: Boolean(game.isActive && matchActive),
      now,
    });

    const setupFlags = Array.isArray(computed.setupComplete)
      ? computed.setupComplete
      : [false, false];
    const whiteSetupComplete = setupFlags[0] ?? false;
    const blackSetupComplete = setupFlags[1] ?? false;
    const bothSetupComplete = whiteSetupComplete && blackSetupComplete;
    const clocksActive = Boolean(game.isActive && matchActive);
    const tickWhite = clocksActive && (bothSetupComplete ? computed.activeColor === 0 : !whiteSetupComplete);
    const tickBlack = clocksActive && (bothSetupComplete ? computed.activeColor === 1 : !blackSetupComplete);

    const whiteMs = Number.isFinite(computed.whiteMs) ? computed.whiteMs : 0;
    const blackMs = Number.isFinite(computed.blackMs) ? computed.blackMs : 0;
    const label = snapshot?.clocks?.label
      || describeTimeControl(game.timeControlStart, game.increment)
      || null;

    spectateState.clockBase = {
      whiteMs,
      blackMs,
      activeColor: computed.activeColor,
      label,
      receivedAt: now,
      tickingWhite: tickWhite,
      tickingBlack: tickBlack,
    };
    updateSpectateClockDisplay();
    stopSpectateClockTimer();
    if (tickWhite || tickBlack) {
      spectateState.clockTimer = setInterval(updateSpectateClockDisplay, 200);
    }
  }

  function clearSpectateBubbles() {
    if (!Array.isArray(spectateRefs.activeBubbles)) {
      spectateRefs.activeBubbles = [];
      return;
    }
    spectateRefs.activeBubbles.forEach((img) => {
      try {
        if (img && img.parentNode) {
          img.parentNode.removeChild(img);
        }
      } catch (_) {}
    });
    spectateRefs.activeBubbles = [];
  }

  function makeSpectateBubbleImg(type, squareSize) {
    const src = getBubbleAsset(type);
    if (!src) return null;
    const img = document.createElement('img');
    img.dataset.bubble = '1';
    img.dataset.bubbleType = type;
    img.draggable = false;
    img.style.position = 'absolute';
    img.style.pointerEvents = 'none';
    img.style.zIndex = '1001';
    const size = Math.max(0, Math.floor(squareSize * 1.08));
    img.style.width = `${size}px`;
    img.style.height = 'auto';
    const offsetX = Math.floor(squareSize * 0.6);
    const offsetY = Math.floor(squareSize * 0.5);
    if (typeof type === 'string' && type.endsWith('Right')) {
      img.style.right = `${-offsetX}px`;
      img.style.left = 'auto';
    } else {
      img.style.left = `${-offsetX}px`;
      img.style.right = 'auto';
    }
    img.style.top = `${-offsetY}px`;
    img.src = src;
    img.alt = '';
    return img;
  }

  function applySpectateMoveOverlay(squareSize, overlay) {
    if (!spectateRefs.boardCells) return;
    clearSpectateBubbles();
    if (!overlay) return;
    const cellRef = spectateRefs.boardCells?.[overlay.uiR]?.[overlay.uiC];
    if (!cellRef || !cellRef.el) return;
    overlay.types.forEach((type) => {
      const img = makeSpectateBubbleImg(type, squareSize);
      if (!img) return;
      try { cellRef.el.style.position = 'relative'; } catch (_) {}
      cellRef.el.appendChild(img);
      spectateRefs.activeBubbles.push(img);
    });
  }

  function clearSpectateVisuals() {
    if (statusEl) statusEl.textContent = '';
    if (scoreEl) scoreEl.textContent = '';
    if (bannerEl) {
      bannerEl.textContent = '';
      bannerEl.hidden = true;
      bannerEl.className = 'spectate-banner';
    }
    if (metaEl) metaEl.textContent = '';
    if (topBarEl) topBarEl.innerHTML = '';
    if (bottomBarEl) bottomBarEl.innerHTML = '';
    if (boardView) boardView.destroy();
    spectateRefs.boardCells = [];
    clearSpectateBubbles();
    resetSpectateClockState();
    spectateState.clockRefs = { top: null, bottom: null };
    spectateState.data = null;
    spectateState.lastBoardGame = null;
    spectateState.lastCompletedGame = null;
    hideSpectateGameBanner();
  }

  function resolveSpectatePlayer(snapshot, id, fallbackLabel) {
    if (!id) return { name: fallbackLabel, elo: null };
    const key = String(id);
    if (!key) return { name: fallbackLabel, elo: null };
    const playersMap = snapshot?.players || {};
    const entry = playersMap[key] || playersMap[id] || null;
    const username = entry?.username || getUsername(key) || fallbackLabel;
    setUsername(key, username);
    const elo = Number.isFinite(entry?.elo) ? entry.elo : null;
    return { name: username, elo };
  }

  function renderSpectateMeta(snapshot) {
    if (!metaEl) return;
    metaEl.textContent = '';
    const match = snapshot?.match || {};
    const pieces = [];
    if (match.type) pieces.push(`Type: ${formatMatchTypeLabel(match.type)}`);
    if (snapshot?.game?.id) pieces.push(`Game ID: ${snapshot.game.id}`);
    if (match.isActive === false) {
      pieces.push('Match complete');
    } else if (snapshot?.game && snapshot.game.isActive === false) {
      pieces.push('Game complete');
    }
    metaEl.textContent = pieces.join(' • ');
  }

  function renderSpectateScore(snapshot) {
    if (!scoreEl) return;
    scoreEl.innerHTML = '';
    const match = snapshot?.match;
    if (!match) return;
    const player1Id = match.player1Id || match.player1?.id || match.player1?._id;
    const player2Id = match.player2Id || match.player2?.id || match.player2?._id;
    const player1 = resolveSpectatePlayer(snapshot, player1Id, 'Player 1');
    const player2 = resolveSpectatePlayer(snapshot, player2Id, 'Player 2');
    const frag = createDocumentFragment();
    const span1 = document.createElement('span');
    span1.textContent = player1.name;
    span1.style.fontWeight = '700';
    const scoreSpan = document.createElement('span');
    scoreSpan.textContent = `${Number(match.player1Score || 0)} - ${Number(match.player2Score || 0)}`;
    const span2 = document.createElement('span');
    span2.textContent = player2.name;
    span2.style.fontWeight = '700';
    frag.appendChild(span1);
    frag.appendChild(scoreSpan);
    frag.appendChild(span2);
    const draws = Number(match.drawCount || 0);
    if (draws > 0) {
      const drawSpan = document.createElement('span');
      drawSpan.textContent = `Draws: ${draws}`;
      frag.appendChild(drawSpan);
    }
    scoreEl.appendChild(frag);
  }

  function renderSpectateBanner(snapshot) {
    if (!bannerEl) return;
    bannerEl.hidden = true;
    bannerEl.textContent = '';
    bannerEl.className = 'spectate-banner';
    const match = snapshot?.match;
    if (!match) return;
    if (match.isActive === false) {
      return;
    }
    if (snapshot?.game && snapshot.game.isActive === false) {
      bannerEl.textContent = 'Awaiting the next game in this match…';
      bannerEl.classList.add('spectate-banner--info');
      bannerEl.hidden = false;
    }
  }

  function getSpectatePlayerNameForColor(snapshot, colorIdx) {
    const fallback = colorIdx === 0 ? 'White' : 'Black';
    if (!snapshot || typeof snapshot !== 'object') return fallback;
    const game = snapshot.game || {};
    const match = snapshot.match || {};
    const players = Array.isArray(game.players) ? game.players : [];
    let playerId = players[colorIdx];
    if (!playerId) {
      if (colorIdx === 0) {
        playerId = match.player1Id || match.player1?._id || match.player1?.id;
      } else {
        playerId = match.player2Id || match.player2?._id || match.player2?.id;
      }
    }
    const resolved = resolveSpectatePlayer(snapshot, playerId, fallback);
    return resolved?.name || fallback;
  }

  function ensureSpectateGameBannerOverlay() {
    if (spectateGameBannerOverlay) return spectateGameBannerOverlay;
    spectateGameBannerOverlay = createOverlay({
      baseClass: 'cg-overlay banner-overlay',
      dialogClass: 'banner-overlay__dialog',
      contentClass: 'banner-overlay__content',
      backdropClass: 'cg-overlay__backdrop banner-overlay-backdrop',
      closeButtonClass: 'banner-overlay__close',
      openClass: 'cg-overlay--open banner-overlay--open',
      bodyOpenClass: 'cg-overlay-open',
      showCloseButton: false,
      closeOnBackdrop: false,
      closeOnEscape: false,
      trapFocus: false,
    });
    return spectateGameBannerOverlay;
  }

  function hideSpectateGameBanner() {
    if (!spectateGameBannerOverlay) {
      return;
    }
    try {
      if (spectateGameBannerOverlay.element) {
        spectateGameBannerOverlay.element.style.pointerEvents = '';
      }
      if (spectateGameBannerOverlay.backdrop) {
        spectateGameBannerOverlay.backdrop.style.pointerEvents = '';
      }
      if (spectateGameBannerOverlay.dialog) {
        spectateGameBannerOverlay.dialog.style.pointerEvents = '';
      }
      if (spectateGameBannerOverlay.content) {
        spectateGameBannerOverlay.content.style.pointerEvents = '';
      }
      if (spectateGameBannerOverlay.content) {
        spectateGameBannerOverlay.content.innerHTML = '';
      }
      spectateGameBannerOverlay.hide();
    } catch (err) {
      console.warn('Failed to hide spectate banner overlay', err);
    }
  }

  function showSpectateGameBanner(snapshot) {
    if (!snapshot) {
      hideSpectateGameBanner();
      return;
    }
    const overlay = ensureSpectateGameBannerOverlay();
    if (!overlay) return;
    const { content, dialog } = overlay;
    if (overlay.element) {
      overlay.element.style.pointerEvents = 'none';
    }
    if (overlay.backdrop) {
      overlay.backdrop.style.pointerEvents = 'none';
    }
    if (dialog) {
      dialog.style.alignItems = 'center';
      dialog.style.justifyContent = 'flex-end';
      dialog.style.pointerEvents = 'none';
    }
    if (content) {
      content.innerHTML = '';
      content.style.alignItems = 'center';
      content.style.justifyContent = 'flex-end';
      content.style.width = '100%';
      content.style.minHeight = '100%';
      content.style.pointerEvents = 'none';
    }

    const match = snapshot.match || {};
    const game = snapshot.game || {};
    const winnerIdx = Number.isInteger(game.winner) ? game.winner : -1;
    const winnerColor = winnerIdx === 0 || winnerIdx === 1 ? winnerIdx : null;
    const loserColor = winnerColor === 0 ? 1 : winnerColor === 1 ? 0 : null;
    const isDraw = winnerColor === null;
    const winnerName = isDraw ? null : getSpectatePlayerNameForColor(snapshot, winnerColor);
    const loserName = isDraw || loserColor === null ? null : getSpectatePlayerNameForColor(snapshot, loserColor);
    const whiteName = getSpectatePlayerNameForColor(snapshot, 0);
    const blackName = getSpectatePlayerNameForColor(snapshot, 1);
    const winnerLabel = winnerColor === null
      ? null
      : (winnerName || (winnerColor === 0 ? whiteName : blackName) || (winnerColor === 0 ? 'White' : 'Black'));
    const loserLabel = loserColor === null
      ? null
      : (loserName || (loserColor === 0 ? whiteName : blackName) || 'their opponent');

    const card = document.createElement('div');
    card.style.width = '100%';
    card.style.maxWidth = '100%';
    card.style.height = '160px';
    card.style.padding = '18px 26px';
    card.style.borderRadius = '0';
    card.style.borderTop = '2px solid var(--CG-deep-gold)';
    card.style.borderBottom = '2px solid var(--CG-deep-gold)';
    card.style.marginTop = 'auto';
    card.style.marginBottom = 'clamp(12px, 2vh, 40px)';
    card.style.marginLeft = 'auto';
    card.style.marginRight = 'auto';
    card.style.background = isDraw ? 'var(--CG-gray)' : 'var(--CG-dark-red)';
    card.style.color = 'var(--CG-white)';
    card.style.boxShadow = '0 10px 30px var(--CG-black)';
    card.style.textAlign = 'center';
    card.style.position = 'relative';
    card.style.pointerEvents = 'auto';

    const title = document.createElement('div');
    if (isDraw) {
      title.textContent = 'Draw';
    } else {
      const colorLabel = winnerColor === 0 ? 'White' : 'Black';
      title.textContent = `${winnerLabel || colorLabel} Victory`;
    }
    title.style.fontSize = '32px';
    title.style.fontWeight = '800';
    title.style.marginBottom = '10px';

    const desc = document.createElement('div');
    const reason = Number(game.winReason);
    let descText;
    if (isDraw || reason === WIN_REASONS.DRAW) {
      descText = `${whiteName} and ${blackName} agreed to a draw.`;
    } else {
      switch (reason) {
        case WIN_REASONS.KING_CAPTURE:
        case 0:
          descText = `${winnerLabel} (${winnerColor === 0 ? 'White' : 'Black'}) won by capturing ${loserLabel}'s king.`;
          break;
        case WIN_REASONS.KING_ADVANCE:
        case 1:
          descText = `${winnerLabel} (${winnerColor === 0 ? 'White' : 'Black'}) won by advancing their king to the final rank.`;
          break;
        case WIN_REASONS.TRUE_KING:
        case 2:
          descText = `${winnerLabel} (${winnerColor === 0 ? 'White' : 'Black'}) won because ${loserLabel} challenged the true king.`;
          break;
        case WIN_REASONS.DAGGER_PENALTY:
        case 3:
          descText = `${winnerLabel} (${winnerColor === 0 ? 'White' : 'Black'}) won because ${loserLabel} accumulated 3 dagger tokens.`;
          break;
        case WIN_REASONS.TIME:
        case 4:
          descText = `${winnerLabel} (${winnerColor === 0 ? 'White' : 'Black'}) won because ${loserLabel} ran out of time.`;
          break;
        case WIN_REASONS.DISCONNECT:
        case 5:
          descText = `${winnerLabel} (${winnerColor === 0 ? 'White' : 'Black'}) won because ${loserLabel} disconnected.`;
          break;
        case WIN_REASONS.RESIGNATION:
        case 6:
          descText = `${winnerLabel} (${winnerColor === 0 ? 'White' : 'Black'}) won by resignation.`;
          break;
        default:
          descText = `${winnerLabel || 'The winner'} prevailed.`;
      }
    }
    desc.textContent = descText;
    desc.style.fontSize = '20px';
    desc.style.fontWeight = '500';
    desc.id = 'spectateGameOverDesc';

    const footer = document.createElement('div');
    footer.textContent = match?.isActive === false
      ? 'Match complete. Close the spectate view to exit.'
      : 'Awaiting the next game…';
    footer.style.fontSize = '14px';
    footer.style.fontWeight = '600';
    footer.style.position = 'absolute';
    footer.style.bottom = '12px';
    footer.style.left = '50%';
    footer.style.transform = 'translateX(-50%)';
    footer.style.opacity = '0.85';

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(footer);
    if (content) {
      content.appendChild(card);
    }
    overlay.show();
  }

  function updateSpectateGameBanner(rawSnapshot, displaySnapshot) {
    const match = (displaySnapshot && displaySnapshot.match)
      || (rawSnapshot && rawSnapshot.match)
      || {};
    const matchId = normalizeId(match?._id || match?.id || rawSnapshot?.matchId || displaySnapshot?.matchId);
    const storedMatchId = spectateState.lastCompletedGame?.matchId || null;
    if (storedMatchId && matchId && storedMatchId !== matchId) {
      spectateState.lastCompletedGame = null;
    }

    if (rawSnapshot?.game && rawSnapshot.game.isActive) {
      spectateState.lastCompletedGame = null;
      hideSpectateGameBanner();
      return;
    }

    if (rawSnapshot?.game && rawSnapshot.game.isActive === false) {
      const snapshotForDisplay = displaySnapshot || rawSnapshot;
      spectateState.lastCompletedGame = {
        matchId,
        snapshot: snapshotForDisplay,
      };
      showSpectateGameBanner(snapshotForDisplay);
      return;
    }

    if (!rawSnapshot?.game) {
      if (
        spectateState.lastCompletedGame
        && (!matchId || !spectateState.lastCompletedGame.matchId || spectateState.lastCompletedGame.matchId === matchId)
      ) {
        showSpectateGameBanner(spectateState.lastCompletedGame.snapshot);
        return;
      }
      if (displaySnapshot?.game && displaySnapshot.game.isActive === false) {
        spectateState.lastCompletedGame = {
          matchId,
          snapshot: displaySnapshot,
        };
        showSpectateGameBanner(displaySnapshot);
        return;
      }
    }

    if (match?.isActive === false && displaySnapshot?.game && displaySnapshot.game.isActive === false) {
      spectateState.lastCompletedGame = {
        matchId,
        snapshot: displaySnapshot,
      };
      showSpectateGameBanner(displaySnapshot);
      return;
    }

    hideSpectateGameBanner();
  }

  function renderSpectateBarsForSnapshot(snapshot, baseSizes) {
    if (!boardView || !topBarEl || !bottomBarEl) return;
    topBarEl.innerHTML = '';
    bottomBarEl.innerHTML = '';
    if (!snapshot) return;
    const game = snapshot.game;
    if (!game) return;
    const match = snapshot.match || {};
    const rawPlayers = Array.isArray(game.players) ? game.players : [];
    const whiteId = rawPlayers[0] || match.player1Id || match.player1?.id || match.player1?._id;
    const blackId = rawPlayers[1] || match.player2Id || match.player2?.id || match.player2?._id;
    const playerIdRefs = [whiteId, blackId];
    const white = resolveSpectatePlayer(snapshot, whiteId, 'White');
    const black = resolveSpectatePlayer(snapshot, blackId, 'Black');
    const isRankedMatch = String(match.type || '').toUpperCase() === 'RANKED';
    const p1Score = Number(match.player1Score || 0);
    const p2Score = Number(match.player2Score || 0);
    const daggers = Array.isArray(game.daggers) ? game.daggers : [0, 0];
    const captured = Array.isArray(game.captured) ? game.captured : [[], []];
    const lastAction = Array.isArray(game.actions) ? game.actions[game.actions.length - 1] : null;
    const challengeActive = lastAction?.type === ACTIONS.CHALLENGE;
    const lastActionPlayer = normalizeActionPlayer(lastAction?.player, playerIdRefs);
    const showChallengeTop = challengeActive && lastActionPlayer === 1;
    const showChallengeBottom = challengeActive && lastActionPlayer === 0;
    const displayClocks = spectateState.clockDisplay || {};
    const clockLabel = displayClocks.label
      || snapshot?.clocks?.label
      || describeTimeControl(game.timeControlStart, game.increment);
    const whiteMs = Number.isFinite(displayClocks.whiteMs) ? displayClocks.whiteMs : 0;
    const blackMs = Number.isFinite(displayClocks.blackMs) ? displayClocks.blackMs : 0;

    const bars = renderBars({
      topBar: topBarEl,
      bottomBar: bottomBarEl,
      sizes: {
        squareSize: baseSizes.squareSize,
        boardWidth: baseSizes.boardWidth,
        boardHeight: baseSizes.boardHeight,
        boardLeft: baseSizes.boardLeft,
        boardTop: baseSizes.boardTop,
        playAreaHeight: playAreaEl?.clientHeight || (baseSizes.boardHeight * 2),
      },
      state: {
        currentIsWhite: true,
        currentCaptured: captured,
        currentDaggers: daggers,
        showChallengeTop,
        showChallengeBottom,
        clockTop: formatClock(blackMs),
        clockBottom: formatClock(whiteMs),
        clockLabel,
        nameTop: black.name,
        nameBottom: white.name,
        winsTop: p2Score,
        winsBottom: p1Score,
        connectionTop: null,
        connectionBottom: null,
        isRankedMatch,
        eloTop: black.elo,
        eloBottom: white.elo,
      },
      identityMap: PIECE_IMAGES,
    });
    spectateState.clockRefs = {
      top: bars?.topClockEl || null,
      bottom: bars?.bottomClockEl || null,
    };
    updateSpectateClockElements();
  }

  function renderSpectateBoard(snapshot) {
    if (!boardView || !playAreaEl) return;
    const game = snapshot?.game;
    if (!game || !Array.isArray(game.board) || !game.board.length) {
      boardView.destroy();
      spectateRefs.boardCells = [];
      if (topBarEl) topBarEl.innerHTML = '';
      if (bottomBarEl) bottomBarEl.innerHTML = '';
      return;
    }
    const viewState = deriveSpectateView(game);
    const rows = viewState.rows;
    const cols = viewState.cols;
    if (!rows || !cols) return;
    const boardForRender = viewState.board;
    const pendingMoveFrom = viewState.pendingMoveFrom;
    const pendingCapture = viewState.pendingCapture;
    const challengeRemoved = viewState.challengeRemoved;
    const overlay = viewState.overlay;
    const metrics = computeBoardMetrics(
      playAreaEl.clientWidth,
      playAreaEl.clientHeight,
      cols,
      rows,
    );
    spectateRefs.boardCells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
    boardView.render({
      sizes: {
        rows,
        cols,
        squareSize: metrics.squareSize,
        boardLeft: metrics.boardLeft,
        boardTop: metrics.boardTop,
      },
      state: {
        currentBoard: boardForRender,
        currentIsWhite: true,
        selected: null,
        isInSetup: false,
        workingRank: new Array(cols).fill(null),
        pendingCapture,
        pendingMoveFrom,
        challengeRemoved,
      },
      onAttachGameHandlers: (cell, uiR, uiC) => {
        if (!spectateRefs.boardCells[uiR]) {
          spectateRefs.boardCells[uiR] = [];
        }
        spectateRefs.boardCells[uiR][uiC] = { el: cell, uiR, uiC };
      },
      labelFont: Math.max(10, Math.floor(0.024 * playAreaEl.clientHeight)),
      fileLetters: ['A', 'B', 'C', 'D', 'E'],
      readOnly: true,
      deploymentLines: true,
    });
    renderSpectateBarsForSnapshot(snapshot, {
      squareSize: metrics.squareSize,
      boardWidth: metrics.boardWidth,
      boardHeight: metrics.boardHeight,
      boardLeft: metrics.boardLeft,
      boardTop: metrics.boardTop,
    });
    applySpectateMoveOverlay(metrics.squareSize, overlay);
  }

  function getSpectateDisplaySnapshot(snapshot) {
    const isObject = snapshot && typeof snapshot === 'object';
    const game = isObject ? snapshot.game : null;
    if (game && Array.isArray(game.board) && game.board.length) {
      spectateState.lastBoardGame = game;
      return snapshot;
    }

    const fallbackGame = spectateState.lastBoardGame;
    if (!fallbackGame) {
      return snapshot;
    }

    const base = { ...(snapshot || {}) };
    base.game = fallbackGame;
    return base;
  }

  function renderSpectateContent(snapshot) {
    if (!overlayEl || overlayEl.hidden) return;
    const displaySnapshot = getSpectateDisplaySnapshot(snapshot);
    spectateState.data = displaySnapshot;
    syncSpectateClocks(snapshot);
    renderSpectateMeta(displaySnapshot);
    renderSpectateScore(displaySnapshot);
    renderSpectateBanner(displaySnapshot);
    if (statusEl) {
      const match = displaySnapshot?.match;
      const game = displaySnapshot?.game;
      if (!game) {
        statusEl.textContent = match?.isActive ? 'No active game for this match.' : 'Match complete.';
      } else if (game.isActive) {
        statusEl.textContent = 'Live game in progress';
      } else {
        statusEl.textContent = match?.isActive ? 'Game finished. Awaiting next game.' : 'Final game complete.';
      }
    }
    renderSpectateBoard(displaySnapshot);
    updateSpectateGameBanner(snapshot, displaySnapshot);
  }

  function openSpectateModal(matchId) {
    if (!overlayEl || !boardView || !socket) return;
    const normalizedId = normalizeId(matchId);
    if (!normalizedId) return;
    if (spectateState.matchId && spectateState.matchId !== normalizedId) {
      socket.emit('spectate:leave', { matchId: spectateState.matchId });
    }
    spectateState.matchId = normalizedId;
    spectateState.loading = true;
    spectateState.data = null;
    clearSpectateVisuals();
    overlayEl.hidden = false;
    if (statusEl) statusEl.textContent = 'Loading live game state…';
    socket.emit('spectate:join', { matchId: normalizedId });
    if (spectateState.resizeHandler) {
      window.removeEventListener('resize', spectateState.resizeHandler);
    }
    spectateState.resizeHandler = () => {
      if (!overlayEl.hidden && spectateState.data) {
        renderSpectateBoard(spectateState.data);
      }
    };
    window.addEventListener('resize', spectateState.resizeHandler);
    onOpen(normalizedId);
  }

  function closeSpectateModal() {
    if (!overlayEl || overlayEl.hidden) return;
    const currentId = spectateState.matchId;
    if (socket && currentId) {
      socket.emit('spectate:leave', { matchId: currentId });
    }
    overlayEl.hidden = true;
    spectateState.matchId = null;
    spectateState.data = null;
    spectateState.loading = false;
    clearSpectateVisuals();
    if (spectateState.resizeHandler) {
      window.removeEventListener('resize', spectateState.resizeHandler);
      spectateState.resizeHandler = null;
    }
    onClose();
  }

  function handleSpectateSnapshot(payload) {
    const payloadId = normalizeId(payload?.matchId || payload?.match?.id || payload?.match?._id);
    if (!payloadId || payloadId !== spectateState.matchId) return;
    spectateState.loading = false;
    renderSpectateContent({ ...payload, matchId: payloadId });
  }

  function handleSpectateError(payload) {
    const payloadId = normalizeId(payload?.matchId || payload?.match?.id || payload?.match?._id);
    if (!payloadId || payloadId !== spectateState.matchId) return;
    spectateState.loading = false;
    if (statusEl) {
      statusEl.textContent = payload?.message || 'Unable to spectate match.';
    }
    if (bannerEl) {
      bannerEl.textContent = payload?.message || 'Unable to spectate match.';
      bannerEl.className = 'spectate-banner spectate-banner--info';
      bannerEl.hidden = false;
    }
  }

  if (overlayEl) {
    overlayEl.addEventListener('mousedown', (event) => {
      if (event.target === overlayEl) {
        closeSpectateModal();
      }
    });
  }

  if (closeButtonEl) {
    closeButtonEl.addEventListener('click', () => closeSpectateModal());
  }

  document.addEventListener('keydown', (event) => {
    if ((event.key === 'Escape' || event.key === 'Esc') && overlayEl && !overlayEl.hidden) {
      closeSpectateModal();
    }
  });

  return {
    open: openSpectateModal,
    close: closeSpectateModal,
    handleSnapshot: handleSpectateSnapshot,
    handleUpdate: handleSpectateSnapshot,
    handleError: handleSpectateError,
    isOpen: () => Boolean(overlayEl && !overlayEl.hidden),
    getMatchId: () => spectateState.matchId,
    getState: () => ({ ...spectateState }),
  };
}
