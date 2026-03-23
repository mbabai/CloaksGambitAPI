import { ACTIONS, PIECE_IMAGES } from '/js/modules/constants.js';
import { createGameView } from '/js/modules/gameView/view.js';
import { renderStash } from '/js/modules/render/stash.js';
import { computeBoardMetrics } from '/js/modules/layout.js';
import { deriveSpectateView } from '/js/modules/spectate/viewModel.js';
import { pieceGlyph } from '/js/modules/render/pieceGlyph.js';
import {
  colorToText,
  formatActionRecord,
  formatDate,
  formatDuration,
  identityToSymbol,
  normalizeActionTypeConstant,
  winReasonToText,
} from './utils.js';

function normalizeReplayBoard(board) {
  if (!Array.isArray(board)) return [];
  return board.map((row) => (
    Array.isArray(row)
      ? row.map((piece) => (piece ? { ...piece } : null))
      : []
  ));
}

function buildReplayHistoryFallback(decisions = []) {
  const actions = [];
  const moves = [];
  decisions.forEach((decision, idx) => {
    const action = decision?.action || decision?.move || null;
    if (!action) return;
    const type = normalizeActionTypeConstant(action.type);
    if (!Number.isFinite(type)) return;
    const player = Number.isFinite(decision?.player)
      ? decision.player
      : (Number.isFinite(action?.player) ? action.player : null);
    const details = {};
    if (action.from && action.to) {
      details.from = { row: action.from.row, col: action.from.col };
      details.to = { row: action.to.row, col: action.to.col };
    }
    if (Number.isFinite(action.declaration)) details.declaration = action.declaration;
    if (Number.isFinite(action.identity)) details.identity = action.identity;
    actions.push({
      type,
      player,
      details,
      timestamp: Number.isFinite(decision?.ply) ? decision.ply : idx,
    });
    if (type === ACTIONS.MOVE && action.from && action.to) {
      moves.push({
        player,
        from: { row: action.from.row, col: action.from.col },
        to: { row: action.to.row, col: action.to.col },
        declaration: action.declaration,
      });
    }
  });
  return { actions, moves };
}

export function createReplayWorkbench(elements = {}) {
  const MOVE_LOG_WINDOW = 80;
  const state = {
    replayPayload: null,
    timer: null,
    speedMs: 600,
    renderer: null,
  };

  function stopPlayback() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    if (elements.playPauseBtn) {
      elements.playPauseBtn.textContent = 'Play';
    }
  }

  function clearBubbles() {
    state.renderer?.gameView?.clearBubbleOverlays();
  }

  function applyOverlay(overlay) {
    clearBubbles();
    if (!overlay || !state.renderer?.gameView) return;
    state.renderer.gameView.setBubbleOverlays([{
      uiR: overlay.uiR,
      uiC: overlay.uiC,
      types: overlay.types,
      interactive: false,
    }]);
  }

  function ensureRenderer() {
    if (state.renderer?.gameView) return;
    const refs = {
      boardCells: [],
      activeBubbles: [],
      stashSlots: [],
      deckEl: null,
    };
    const gameView = createGameView({
      container: elements.playArea,
      boardEl: elements.boardLayer,
      topBarEl: elements.topBar,
      bottomBarEl: elements.bottomBar,
      identityMap: PIECE_IMAGES,
      refs,
      alwaysAttachGameRefs: true,
    });
    gameView.boardView.setReadOnly(true);
    state.renderer = { gameView, refs };
  }

  function renderDeckCard(container, title, piece) {
    if (!container) return;
    container.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'subtle';
    label.textContent = title;
    container.appendChild(label);
    if (!piece) {
      const empty = document.createElement('span');
      empty.className = 'subtle';
      empty.textContent = 'None';
      container.appendChild(empty);
      return;
    }
    const glyph = pieceGlyph(piece, 56, PIECE_IMAGES);
    if (glyph) container.appendChild(glyph);
    const text = document.createElement('span');
    text.className = 'subtle';
    text.textContent = `${colorToText(piece.color)} ${identityToSymbol(piece.identity)}`;
    container.appendChild(text);
  }

  function getReplayHistories() {
    const replayGame = state.replayPayload?.game || {};
    const fallbackHistory = buildReplayHistoryFallback(replayGame.decisions || []);
    return {
      replayGame,
      actionHistory: Array.isArray(replayGame.actionHistory) && replayGame.actionHistory.length
        ? replayGame.actionHistory
        : fallbackHistory.actions,
      moveHistory: Array.isArray(replayGame.moveHistory) && replayGame.moveHistory.length
        ? replayGame.moveHistory
        : fallbackHistory.moves,
    };
  }

  function renderMoveLog(actionHistory, actionCount, labels = {}) {
    if (!elements.moveLog) return;
    if (!Array.isArray(actionHistory) || !actionHistory.length) {
      elements.moveLog.innerHTML = '<div class="subtle">No actions recorded.</div>';
      return;
    }
    const safeCount = Math.max(0, Math.min(actionHistory.length, Number.parseInt(actionCount, 10) || 0));
    const activeIndex = Math.max(0, safeCount - 1);
    const windowStart = Math.max(0, activeIndex - Math.floor(MOVE_LOG_WINDOW * 0.6));
    const windowEnd = Math.min(actionHistory.length, Math.max(safeCount, windowStart + MOVE_LOG_WINDOW));
    const visibleActions = actionHistory.slice(windowStart, windowEnd);
    elements.moveLog.innerHTML = '';
    if (windowStart > 0 || windowEnd < actionHistory.length) {
      const summary = document.createElement('div');
      summary.className = 'subtle';
      summary.textContent = `Showing actions ${windowStart + 1}-${windowEnd} of ${actionHistory.length}`;
      elements.moveLog.appendChild(summary);
    }
    visibleActions.forEach((action, offset) => {
      const idx = windowStart + offset;
      const row = document.createElement('div');
      row.className = 'move-line';
      if ((idx + 1) === safeCount) {
        row.style.color = 'var(--accent-strong)';
        row.style.fontWeight = '700';
      }
      const player = Number.isFinite(action?.player) ? action.player : null;
      const actorLabel = player === 0
        ? (labels.white || 'White')
        : player === 1
          ? (labels.black || 'Black')
          : 'System';
      const actor = Number.isFinite(player)
        ? `${colorToText(player)} (${actorLabel})`
        : actorLabel;
      row.textContent = `#${idx + 1} ${actor} ${formatActionRecord(action)}`;
      elements.moveLog.appendChild(row);
    });
  }

  function renderDecisionInspector(frame) {
    if (!elements.decisionInspector) return;
    const decision = frame?.decision || null;
    if (!decision) {
      elements.decisionInspector.innerHTML = '<div class="subtle">No model decision attached to this frame.</div>';
      return;
    }

    const stats = decision?.trace?.actionStats || decision?.trace?.moveStats || [];
    const rankedStats = Array.isArray(stats)
      ? stats.slice().sort((a, b) => Number(b.visits || 0) - Number(a.visits || 0)).slice(0, 8)
      : [];
    const trace = decision.trace || {};
    const rootVisits = Number(trace.rootVisits || 0);
    const fallbackUsed = Boolean(trace?.liveRoute?.fallbackUsed);
    const parityMismatches = Array.isArray(trace?.liveRoute?.parityMismatches)
      ? trace.liveRoute.parityMismatches
      : [];
    const selectedActionKey = decision?.trainingRecord?.policy?.selectedActionKey || '';

    elements.decisionInspector.innerHTML = `
      <div class="decision-stat-grid">
        <div class="decision-stat">
          <div class="subtle">Actor</div>
          <strong>${decision.participantLabel || colorToText(decision.player)}</strong>
        </div>
        <div class="decision-stat">
          <div class="subtle">Action</div>
          <strong>${formatActionRecord(decision.action)}</strong>
        </div>
        <div class="decision-stat">
          <div class="subtle">Value Estimate</div>
          <strong>${Number(decision.valueEstimate || 0).toFixed(3)}</strong>
        </div>
        <div class="decision-stat">
          <div class="subtle">Root Visits</div>
          <strong>${rootVisits}</strong>
        </div>
      </div>
      <div class="subtle">
        ${fallbackUsed ? 'Live route fallback was used. ' : ''}
        ${parityMismatches.length ? `Parity mismatches: ${parityMismatches.join(', ')}.` : 'Live route matched shadow state.'}
      </div>
    `;

    if (!rankedStats.length) {
      return;
    }

    const list = document.createElement('div');
    list.className = 'decision-actions';
    rankedStats.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'decision-action';
      if (selectedActionKey && selectedActionKey === entry.actionKey) {
        row.style.borderColor = 'rgba(240, 182, 88, 0.4)';
        row.style.background = 'rgba(31, 52, 56, 0.82)';
      }
      row.innerHTML = `
        <span>${entry.actionKey}</span>
        <span>Visits ${Number(entry.visits || 0)}</span>
        <span>Prior ${Number(entry.prior || 0).toFixed(3)}</span>
        <span>Q ${Number(entry.q || 0).toFixed(3)}</span>
      `;
      list.appendChild(row);
    });
    elements.decisionInspector.appendChild(list);
  }

  function renderBoardFrame(frame) {
    ensureRenderer();
    if (!state.renderer?.gameView || !frame || !Array.isArray(frame.board)) {
      clearBubbles();
      if (elements.boardLayer) {
        elements.boardLayer.innerHTML = '';
      }
      if (elements.topBar) {
        elements.topBar.innerHTML = '';
      }
      if (elements.bottomBar) {
        elements.bottomBar.innerHTML = '';
      }
      renderDeckCard(elements.whiteDeck, 'White On-Deck', null);
      renderDeckCard(elements.blackDeck, 'Black On-Deck', null);
      if (elements.stashLayer) {
        elements.stashLayer.innerHTML = '';
      }
      return;
    }

    const { actionHistory, moveHistory } = getReplayHistories();
    const actionCount = Number.isFinite(frame?.actionCount) ? frame.actionCount : frame.ply;
    const moveCount = Number.isFinite(frame?.moveCount) ? frame.moveCount : moveHistory.length;

    const frameActions = actionHistory.slice(0, Math.max(0, Math.min(actionHistory.length, actionCount || 0)));
    const frameMoves = moveHistory
      .slice(0, Math.max(0, Math.min(moveHistory.length, moveCount || 0)))
      .map((move) => ({ ...move }));
    if (frame.lastMove) {
      if (frameMoves.length) frameMoves[frameMoves.length - 1] = { ...frameMoves[frameMoves.length - 1], ...frame.lastMove };
      else frameMoves.push({ ...frame.lastMove });
    }

    const gameLike = {
      board: normalizeReplayBoard(frame.board),
      actions: frameActions,
      moves: frameMoves,
    };
    const viewState = deriveSpectateView(gameLike);
    const rows = viewState.rows;
    const cols = viewState.cols;
    if (!rows || !cols) return;

    const metrics = computeBoardMetrics(
      elements.playArea.clientWidth,
      elements.playArea.clientHeight,
      cols,
      rows,
    );

    state.renderer.refs.stashSlots = [];
    state.renderer.gameView.render({
      sizes: {
        rows,
        cols,
        squareSize: metrics.squareSize,
        boardLeft: metrics.boardLeft,
        boardTop: metrics.boardTop,
      },
      boardState: {
        currentBoard: viewState.board,
        currentIsWhite: true,
        selected: null,
        isInSetup: false,
        workingRank: new Array(cols).fill(null),
        pendingCapture: viewState.pendingCapture,
        pendingMoveFrom: viewState.pendingMoveFrom,
        challengeRemoved: viewState.challengeRemoved,
      },
      barsState: {
        currentIsWhite: true,
        currentCaptured: Array.isArray(frame.captured) ? frame.captured : [[], []],
        currentDaggers: Array.isArray(frame.daggers) ? frame.daggers : [0, 0],
        showChallengeTop: frame.lastAction?.type === ACTIONS.CHALLENGE && frame.lastAction?.player === 1,
        showChallengeBottom: frame.lastAction?.type === ACTIONS.CHALLENGE && frame.lastAction?.player === 0,
        clockTop: '--:--',
        clockBottom: '--:--',
        clockLabel: 'Replay',
        nameTop: state.replayPayload?.game?.blackParticipantLabel || state.replayPayload?.simulation?.participantBLabel || 'Black',
        nameBottom: state.replayPayload?.game?.whiteParticipantLabel || state.replayPayload?.simulation?.participantALabel || 'White',
        winsTop: 0,
        winsBottom: 0,
        connectionTop: null,
        connectionBottom: null,
        isRankedMatch: false,
      },
      viewMode: 'god',
      labelFont: Math.max(10, Math.floor(0.024 * elements.playArea.clientHeight)),
      fileLetters: ['A', 'B', 'C', 'D', 'E'],
      readOnly: true,
      deploymentLines: true,
    });

    renderStash({
      container: elements.stashLayer,
      sizes: {
        squareSize: metrics.squareSize,
        boardWidth: metrics.boardWidth,
        boardHeight: metrics.boardHeight,
        boardLeft: metrics.boardLeft,
        boardTop: metrics.boardTop,
        playAreaHeight: elements.playArea.clientHeight,
      },
      state: {
        currentIsWhite: true,
        isInSetup: false,
        workingStash: [],
        workingOnDeck: null,
        currentStashes: Array.isArray(frame.stashes) ? frame.stashes : [[], []],
        currentOnDecks: Array.isArray(frame.onDecks) ? frame.onDecks : [null, null],
        selected: null,
        dragging: null,
        currentOnDeckingPlayer: frame.onDeckingPlayer,
        gameFinished: frame.isActive === false,
      },
      refs: state.renderer.refs,
      identityMap: PIECE_IMAGES,
    });

    renderDeckCard(elements.whiteDeck, 'White On-Deck', Array.isArray(frame.onDecks) ? frame.onDecks[0] : null);
    renderDeckCard(elements.blackDeck, 'Black On-Deck', Array.isArray(frame.onDecks) ? frame.onDecks[1] : null);
    applyOverlay(viewState.overlay);
  }

  function renderFrame(index = 0) {
    const replay = state.replayPayload?.game?.replay || [];
    const { replayGame, actionHistory } = getReplayHistories();
    const whiteName = replayGame.whiteParticipantLabel || state.replayPayload?.simulation?.participantALabel || 'White';
    const blackName = replayGame.blackParticipantLabel || state.replayPayload?.simulation?.participantBLabel || 'Black';

    if (!replay.length) {
      renderBoardFrame(null);
      if (elements.frameLabel) elements.frameLabel.textContent = '0 / 0';
      if (elements.meta) elements.meta.textContent = 'No replay loaded.';
      renderMoveLog([], 0, { white: whiteName, black: blackName });
      renderDecisionInspector(null);
      return;
    }

    const safeIndex = Math.max(0, Math.min(replay.length - 1, index));
    const frame = replay[safeIndex];
    renderBoardFrame(frame);
    if (elements.frameLabel) {
      elements.frameLabel.textContent = `${safeIndex} / ${replay.length - 1}`;
    }
    if (elements.range) {
      elements.range.value = String(safeIndex);
    }
    if (elements.meta) {
      const actionText = frame.lastAction ? ` | Last action: ${formatActionRecord(frame.lastAction)}` : '';
      const decisionText = frame?.decision
        ? ` | ${frame.decision.participantLabel || colorToText(frame.decision.player)} ${formatActionRecord(frame.decision.action)} | value ${Number(frame.decision.valueEstimate || 0).toFixed(3)}`
        : '';
      const replayGame = state.replayPayload?.game || {};
      const replayRun = state.replayPayload?.run || {};
      const timingText = [
        Number.isFinite(replayGame?.durationMs) ? `Game ${formatDuration(replayGame.durationMs)}` : '',
        Number.isFinite(replayRun?.averageSelfPlayGameDurationMs) ? `Avg sim ${formatDuration(replayRun.averageSelfPlayGameDurationMs)}` : '',
        Number.isFinite(replayRun?.averageEvaluationGameDurationMs) ? `Avg eval ${formatDuration(replayRun.averageEvaluationGameDurationMs)}` : '',
        Number.isFinite(replayRun?.elapsedMs) ? `Run ${formatDuration(replayRun.elapsedMs)}` : '',
      ].filter(Boolean).join(' | ');
      const timingSuffix = timingText ? ` | ${timingText}` : '';
      elements.meta.textContent = `Frame ${safeIndex} | Ply ${frame.ply} | To move ${colorToText(frame.toMove)} | Winner ${frame.winner === null || frame.winner === undefined ? 'None' : colorToText(frame.winner)} | Reason ${winReasonToText(frame.winReason)}${actionText}${decisionText}${timingSuffix}`;
    }
    renderMoveLog(actionHistory, frame.actionCount || frame.ply, { white: whiteName, black: blackName });
    renderDecisionInspector(frame);
  }

  function togglePlayback() {
    const replay = state.replayPayload?.game?.replay || [];
    if (!replay.length) return;
    if (state.timer) {
      stopPlayback();
      return;
    }
    if (elements.playPauseBtn) {
      elements.playPauseBtn.textContent = 'Pause';
    }
    state.timer = setInterval(() => {
      const current = Number.parseInt(elements.range?.value || '0', 10) || 0;
      if (current >= replay.length - 1) {
        stopPlayback();
        return;
      }
      renderFrame(current + 1);
    }, state.speedMs);
  }

  function step(delta) {
    const replay = state.replayPayload?.game?.replay || [];
    if (!replay.length) return;
    const current = Number.parseInt(elements.range?.value || '0', 10) || 0;
    const next = Math.max(0, Math.min(replay.length - 1, current + delta));
    renderFrame(next);
  }

  function setReplayPayload(payload) {
    state.replayPayload = payload || null;
    stopPlayback();
    const replay = state.replayPayload?.game?.replay || [];
    if (elements.range) {
      elements.range.max = String(Math.max(0, replay.length - 1));
      elements.range.value = '0';
    }
    renderFrame(0);
  }

  function setSpeed(nextSpeedMs) {
    state.speedMs = Math.max(100, Number(nextSpeedMs) || 600);
    if (state.timer) {
      stopPlayback();
      togglePlayback();
    }
  }

  return {
    setReplayPayload,
    setSpeed,
    renderFrame,
    step,
    togglePlayback,
    stopPlayback,
    clear() {
      setReplayPayload(null);
    },
    getReplayPayload() {
      return state.replayPayload;
    },
  };
}
