import { normalizeId } from '../history/dashboard.js';
import { createGameView } from '../gameView/view.js';
import { PIECE_IMAGES, ACTIONS, WIN_REASONS } from '../constants.js';
import { computeBoardMetrics } from '../layout.js';
import { formatClock, describeTimeControl } from '../utils/timeControl.js';
import {
  computeGameClockState,
  normalizeClockSnapshot,
  advanceClockSnapshot,
} from '../utils/clockState.js';
import { setBannerState, applyBannerVariant } from '../ui/banners.js';
import { createButton } from '../ui/buttons.js';
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
    titleEl,
    closeButtonEl,
    socket,
    getUsername = (id) => id || 'Unknown',
    setUsername = () => {},
    onPlayerClick = () => {},
    shouldAllowPlayerClick = () => true,
    onOpen = () => {},
    onClose = () => {},
  } = options || {};

  const spectateRefs = { boardCells: [], activeBubbles: [] };
  let spectateGameBannerOverlay = null;

  if (bannerEl) {
    applyBannerVariant(bannerEl, ['spectate']);
    bannerEl.hidden = true;
  }

  const gameView = playAreaEl
    ? createGameView({
        container: playAreaEl,
        boardEl,
        topBarEl,
        bottomBarEl,
        identityMap: PIECE_IMAGES,
        refs: spectateRefs,
        alwaysAttachGameRefs: true,
        annotationsEnabled: true,
      })
    : null;

  const boardView = gameView ? gameView.boardView : null;

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
    spectateState.clockDisplay = advanceClockSnapshot(spectateState.clockBase, Date.now());
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
    const matchActive = snapshot?.match?.isActive !== false;
    const now = Date.now();
    const fallbackLabel = describeTimeControl(game.timeControlStart, game.increment) || null;
    const serverSnapshot = normalizeClockSnapshot(snapshot?.clocks, {
      receivedAt: now,
      fallbackLabel,
    });

    if (serverSnapshot) {
      spectateState.clockBase = serverSnapshot;
      updateSpectateClockDisplay();
      stopSpectateClockTimer();
      if (serverSnapshot.tickingWhite || serverSnapshot.tickingBlack) {
        spectateState.clockTimer = setInterval(updateSpectateClockDisplay, 200);
      }
      return;
    }

    if (!Number.isFinite(baseTime) || baseTime <= 0) {
      resetSpectateClockState();
      return;
    }

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

    spectateState.clockBase = normalizeClockSnapshot({
      ...computed,
      label: fallbackLabel,
    }, {
      receivedAt: now,
      fallbackLabel,
    });
    updateSpectateClockDisplay();
    stopSpectateClockTimer();
    if (spectateState.clockBase?.tickingWhite || spectateState.clockBase?.tickingBlack) {
      spectateState.clockTimer = setInterval(updateSpectateClockDisplay, 200);
    }
  }

  function clearSpectateBubbles() {
    if (gameView) {
      gameView.clearBubbleOverlays();
    }
  }

  function applySpectateMoveOverlay(overlay) {
    clearSpectateBubbles();
    if (!overlay || !gameView) return;
    gameView.setBubbleOverlays([{
      uiR: overlay.uiR,
      uiC: overlay.uiC,
      types: overlay.types,
      interactive: false,
    }]);
  }

  function clearSpectateVisuals() {
    if (statusEl) statusEl.textContent = '';
    if (scoreEl) scoreEl.textContent = '';
    if (bannerEl) {
      setBannerState(bannerEl, { text: '', variant: ['spectate'], hidden: true });
    }
    if (titleEl) titleEl.textContent = 'Spectating Match';
    if (metaEl) metaEl.textContent = '';
    if (gameView) gameView.destroy();
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
    if (!id) return { name: fallbackLabel, elo: 800, showBadge: false };
    const key = String(id);
    if (!key) return { name: fallbackLabel, elo: 800, showBadge: false };
    const playersMap = snapshot?.players || {};
    const entry = playersMap[key] || playersMap[id] || null;
    const registeredUsername = getUsername(key);
    const hasTournamentAlias = Boolean(
      registeredUsername
      && registeredUsername !== key
      && registeredUsername !== 'Unknown',
    );
    const username = hasTournamentAlias
      ? registeredUsername
      : (entry?.username || registeredUsername || fallbackLabel);
    setUsername(key, username, { priority: hasTournamentAlias ? 20 : 0 });
    const elo = Number.isFinite(entry?.elo) ? entry.elo : 800;
    return { name: username, elo, showBadge: !entry?.isBot && !entry?.isGuest };
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

  function renderSpectateTitle(snapshot) {
    if (!titleEl) return;
    const matchTypeLabel = formatMatchTypeLabel(snapshot?.match?.type);
    if (matchTypeLabel && matchTypeLabel !== 'Match') {
      titleEl.textContent = `Spectating ${matchTypeLabel} Match`;
      return;
    }
    titleEl.textContent = 'Spectating Match';
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
    scoreEl.classList.add('cg-spectate-score');
    const player1Label = document.createElement('span');
    player1Label.className = 'cg-spectate-score__player';
    player1Label.textContent = player1.name;
    const scoreValue = document.createElement('span');
    scoreValue.className = 'cg-spectate-score__value';
    scoreValue.textContent = `${Number(match.player1Score || 0)} - ${Number(match.player2Score || 0)}`;
    const player2Label = document.createElement('span');
    player2Label.className = 'cg-spectate-score__player';
    player2Label.textContent = player2.name;
    frag.appendChild(player1Label);
    frag.appendChild(scoreValue);
    frag.appendChild(player2Label);
    const draws = Number(match.drawCount || 0);
    if (draws > 0) {
      const drawSpan = document.createElement('span');
      drawSpan.className = 'cg-spectate-score__draws';
      drawSpan.textContent = `Draws: ${draws}`;
      frag.appendChild(drawSpan);
    }
    scoreEl.appendChild(frag);
  }

  function renderSpectateBanner(snapshot) {
    if (!bannerEl) return;
    setBannerState(bannerEl, { text: '', variant: ['spectate'], hidden: true });
    const match = snapshot?.match;
    if (!match) return;
    if (match.isActive === false) {
      return;
    }
    if (snapshot?.game && snapshot.game.isActive === false) {
      setBannerState(bannerEl, {
        text: 'Awaiting the next game in this match…',
        variant: ['spectate', 'info'],
        hidden: false
      });
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
      baseClass: 'cg-overlay cg-overlay--banner cg-overlay--spectate-result',
      dialogClass: 'cg-overlay__dialog cg-overlay__dialog--banner cg-overlay__dialog--spectate-result',
      contentClass: 'cg-overlay__content cg-overlay__content--banner cg-overlay__content--spectate-result',
      backdropClass: 'cg-overlay__backdrop cg-overlay__backdrop--banner',
      closeButtonClass: 'cg-overlay__close cg-overlay__close--banner',
      openClass: 'cg-overlay--open cg-overlay--banner-open',
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
      if (spectateGameBannerOverlay.content) {
        spectateGameBannerOverlay.content.innerHTML = '';
      }
      spectateGameBannerOverlay.hide();
    } catch (err) {
      console.warn('Failed to hide spectate banner overlay', err);
    }
  }

  function acknowledgeSpectateCompletedGame() {
    if (spectateState.lastCompletedGame) {
      spectateState.lastCompletedGame.acknowledged = true;
    }
    hideSpectateGameBanner();
  }

  function showSpectateGameBanner(snapshot) {
    if (!snapshot) {
      hideSpectateGameBanner();
      return;
    }
    const overlay = ensureSpectateGameBannerOverlay();
    if (!overlay) return;
    const { content } = overlay;
    if (content) {
      content.innerHTML = '';
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
    card.className = 'cg-spectate-result-card';
    if (isDraw) {
      card.classList.add('cg-spectate-result-card--draw');
    }

    const title = document.createElement('div');
    title.className = 'cg-spectate-result-card__title';
    if (isDraw) {
      title.textContent = 'Draw';
    } else {
      const colorLabel = winnerColor === 0 ? 'White' : 'Black';
      title.textContent = `${winnerLabel || colorLabel} Victory`;
    }

    const desc = document.createElement('div');
    desc.className = 'cg-spectate-result-card__desc';
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
    desc.id = 'spectateGameOverDesc';

    const footer = document.createElement('div');
    footer.className = 'cg-spectate-result-card__footer';
    footer.textContent = match?.isActive === false
      ? 'Match complete. Close the spectate view to exit.'
      : 'Awaiting the next game…';

    footer.textContent = match?.isActive === false
      ? 'Match complete.'
      : 'Click Next when you are ready to move on.';

    const nextBtn = createButton({
      label: match?.isActive === false ? 'Close' : 'Next',
      variant: 'primary',
      position: 'relative',
    });
    nextBtn.style.setProperty('--cg-button-padding', '8px 18px');
    nextBtn.style.setProperty('--cg-button-border', '2px solid var(--CG-deep-gold)');
    nextBtn.style.margin = '10px auto 0';
    nextBtn.addEventListener('click', () => {
      acknowledgeSpectateCompletedGame();
    });

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(footer);
    card.appendChild(nextBtn);
    if (content) {
      content.appendChild(card);
    }
    overlay.show({ initialFocus: nextBtn });
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
      if (
        spectateState.lastCompletedGame
        && spectateState.lastCompletedGame.acknowledged !== true
        && (!matchId || !spectateState.lastCompletedGame.matchId || spectateState.lastCompletedGame.matchId === matchId)
      ) {
        showSpectateGameBanner(spectateState.lastCompletedGame.snapshot);
        return;
      }
      spectateState.lastCompletedGame = null;
      hideSpectateGameBanner();
      return;
    }

    if (rawSnapshot?.game && rawSnapshot.game.isActive === false) {
      const snapshotForDisplay = displaySnapshot || rawSnapshot;
      const currentCompletedGameId = normalizeId(snapshotForDisplay?.game?._id || rawSnapshot?.game?._id);
      const previousCompletedGameId = normalizeId(spectateState.lastCompletedGame?.snapshot?.game?._id);
      spectateState.lastCompletedGame = {
        matchId,
        snapshot: snapshotForDisplay,
        acknowledged: currentCompletedGameId && currentCompletedGameId === previousCompletedGameId
          ? Boolean(spectateState.lastCompletedGame?.acknowledged)
          : false,
      };
      showSpectateGameBanner(snapshotForDisplay);
      return;
    }

    if (!rawSnapshot?.game) {
      if (
        spectateState.lastCompletedGame
        && spectateState.lastCompletedGame.acknowledged !== true
        && (!matchId || !spectateState.lastCompletedGame.matchId || spectateState.lastCompletedGame.matchId === matchId)
      ) {
        showSpectateGameBanner(spectateState.lastCompletedGame.snapshot);
        return;
      }
      if (displaySnapshot?.game && displaySnapshot.game.isActive === false) {
        spectateState.lastCompletedGame = {
          matchId,
          snapshot: displaySnapshot,
          acknowledged: false,
        };
        showSpectateGameBanner(displaySnapshot);
        return;
      }
    }

    if (match?.isActive === false && displaySnapshot?.game && displaySnapshot.game.isActive === false) {
      spectateState.lastCompletedGame = {
        matchId,
        snapshot: displaySnapshot,
        acknowledged: false,
      };
      showSpectateGameBanner(displaySnapshot);
      return;
    }

    hideSpectateGameBanner();
  }

  function buildSpectateBarsState(snapshot) {
    if (!snapshot) return null;
    const game = snapshot.game;
    if (!game) return null;
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

    const topPlayerId = normalizeId(blackId);
    const bottomPlayerId = normalizeId(whiteId);
    return {
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
      showEloTop: Boolean(black.showBadge),
      showEloBottom: Boolean(white.showBadge),
      playerIdTop: topPlayerId,
      playerIdBottom: bottomPlayerId,
    };
  }

  function renderSpectateBoard(snapshot) {
    if (!gameView || !boardView || !playAreaEl) return;
    const game = snapshot?.game;
    if (!game || !Array.isArray(game.board) || !game.board.length) {
      gameView.destroy();
      spectateRefs.boardCells = [];
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
    const bars = gameView.render({
      sizes: {
        rows,
        cols,
        squareSize: metrics.squareSize,
        boardLeft: metrics.boardLeft,
        boardTop: metrics.boardTop,
      },
      boardState: {
        currentBoard: boardForRender,
        currentIsWhite: true,
        selected: null,
        isInSetup: false,
        workingRank: new Array(cols).fill(null),
        pendingCapture,
        pendingMoveFrom,
        challengeRemoved,
      },
      barsState: buildSpectateBarsState(snapshot),
      viewMode: 'spectator',
      labelFont: Math.max(10, Math.floor(0.024 * playAreaEl.clientHeight)),
      fileLetters: ['A', 'B', 'C', 'D', 'E'],
      readOnly: true,
      deploymentLines: true,
      onNameClick: (info) => {
        if (!info || !info.userId) return;
        try {
          onPlayerClick({
            userId: info.userId,
            username: info.name,
            elo: info.elo,
            position: info.position || 'top',
            source: 'spectate'
          });
        } catch (_) {}
      },
      shouldAllowPlayerClick: (id, context) => {
        try {
          return shouldAllowPlayerClick(id, context);
        } catch (err) {
          console.warn('Error evaluating spectate player click allowance', err);
          return false;
        }
      },
    });
    spectateState.clockRefs = {
      top: bars?.topClockEl || null,
      bottom: bars?.bottomClockEl || null,
    };
    updateSpectateClockElements();
    applySpectateMoveOverlay(overlay);
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
    renderSpectateTitle(displaySnapshot);
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
    if (!overlayEl || !gameView || !socket) return;
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
    if (titleEl) titleEl.textContent = 'Spectating Match';
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
      setBannerState(bannerEl, {
        text: payload?.message || 'Unable to spectate match.',
        variant: ['spectate', 'info'],
        hidden: false
      });
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
