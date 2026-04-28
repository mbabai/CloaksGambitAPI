import { pieceGlyph as makePieceGlyph } from './pieceGlyph.js';
import {
  createNameRow,
  createClockPanel,
  createDaggerCounter,
  createChallengeBubbleElement
} from '../ui/banners.js';
import { TOOLTIP_TEXT } from '../ui/tooltipContent.js';
import { applyTooltipAttributes } from '../ui/tooltips.js';
import { groupCapturedPiecesByColor } from '../utils/captured.js';

export function renderBars({
  topBar,
  bottomBar,
  sizes,
  state,
  identityMap,
  onNameClick,
  shouldAllowPlayerClick
}) {
  const { squareSize: s, boardWidth: bW, boardHeight: bH, boardLeft: leftPx, boardTop: topPx, playAreaHeight: H } = sizes;
  const {
    currentIsWhite,
    currentCaptured,
    currentDaggers,
    activeColor = null,
    showChallengeTop = false,
    showChallengeBottom = false,
    clockTop = '5:00',
    clockBottom = '5:00',
    clockLabel = null,
    nameTop = 'Opponent Name',
    nameBottom = 'My Name',
    winsTop = 0,
    winsBottom = 0,
    connectionTop = null,
    connectionBottom = null,
    isRankedMatch = false,
    eloTop = null,
    eloBottom = null,
    showEloTop = false,
    showEloBottom = false,
    pulsingDaggerColors = [],
    pulsingCapturedByColor = [[], []],
  } = state;

  if (!topBar || !bottomBar) return;

  const capturedByColor = groupCapturedPiecesByColor(currentCaptured);

  const gap = 6;
  const topGap = 10;
  const bottomGap = 2;
  const nameBarH = Math.max(18, Math.floor(0.045 * H));
  const rowH = Math.max(16, Math.floor(0.040 * H));
  const contH = nameBarH + rowH + gap;

  let topBarTop = Math.min(Math.floor(0.05 * H), topPx - topGap - contH);
  topBarTop = Math.max(0, topBarTop);

  const boardBottom = topPx + bH;
  let bottomBarTop = boardBottom + bottomGap;
  if (bottomBarTop + contH > H) bottomBarTop = Math.max(0, H - contH);

  const nameFont = Math.max(14, Math.floor(0.030 * H));
  const clockFont = Math.max(12, Math.floor(0.026 * H));
  const iconFont = Math.max(12, Math.floor(0.024 * H));
  const topColor = currentIsWhite ? 1 : 0;
  const bottomColor = currentIsWhite ? 0 : 1;
  const pulsingDaggerColorSet = new Set(
    Array.isArray(pulsingDaggerColors) ? pulsingDaggerColors : []
  );
  const pulsingCapturedIndexSets = [0, 1].map((colorIdx) => new Set(
    Array.isArray(pulsingCapturedByColor?.[colorIdx]) ? pulsingCapturedByColor[colorIdx] : []
  ));

  function buildNameRow({ isTopBar, showChallengeBubble, winCount, connection, eloValue, nameText }) {
    const row = createNameRow({
      name: nameText,
      orientation: isTopBar ? 'top' : 'bottom',
      height: nameBarH,
      fontSize: nameFont,
      isRankedMatch,
      showEloBadge: isTopBar ? showEloTop : showEloBottom,
      elo: eloValue,
      eloVariant: 'light',
      isActive: activeColor === (isTopBar ? topColor : bottomColor),
      wins: {
        count: winCount,
        size: Math.floor(nameBarH * 0.9),
        gap: 2,
        margin: 6
      },
      connection: connection && Number.isFinite(connection.displaySeconds)
        ? {
            ...connection,
            size: Math.max(12, Math.floor(nameBarH * 0.75)),
            fontSize: Math.max(12, Math.floor(nameFont * 0.9)),
            color: 'var(--CG-white)'
          }
        : null
    });

    if (showChallengeBubble) {
      const bubble = createChallengeBubbleElement({
        position: isTopBar ? 'top' : 'bottom',
        size: 3 * nameBarH,
        offsetY: isTopBar ? '60%' : '-30%',
        zIndex: 20
      });
      if (bubble) {
        row.appendChild(bubble);
      }
    }

    if (typeof onNameClick === 'function') {
      const playerId = isTopBar ? state.playerIdTop : state.playerIdBottom;
      const allowInteraction = () => {
        if (!playerId) return false;
        if (typeof shouldAllowPlayerClick === 'function') {
          try {
            return shouldAllowPlayerClick(playerId, { position: isTopBar ? 'top' : 'bottom' });
          } catch (err) {
            console.warn('Error evaluating player click allowance', err);
            return false;
          }
        }
        return true;
      };
      if (playerId && allowInteraction()) {
        const label = row.querySelector('.cg-name-row__label');
        if (label) {
          label.classList.add('cg-name-row__label--interactive');
          label.setAttribute('role', 'button');
          label.setAttribute('tabindex', '0');
          const payload = {
            userId: playerId,
            name: nameText,
            elo: eloValue,
            position: isTopBar ? 'top' : 'bottom'
          };
          label.addEventListener('click', (event) => {
            event.stopPropagation();
            onNameClick(payload, event);
          });
          label.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onNameClick(payload, event);
            }
          });
        }
      }
    }

    return row;
  }

  function buildClock({ isWhite, text }) {
    return createClockPanel({
      text,
      height: rowH,
      fontSize: clockFont,
      isLight: isWhite,
      label: clockLabel
    });
  }

  function buildDaggers(count, colorIdx) {
    const counter = createDaggerCounter({
      count,
      size: Math.floor(rowH),
      gap: 6,
      alt: 'Dagger token'
    });
    counter.style.fontSize = iconFont + 'px';
    applyTooltipAttributes(counter, TOOLTIP_TEXT.daggerToken);
    if (pulsingDaggerColorSet.has(colorIdx)) {
      Array.from(counter.children || []).forEach((token) => {
        token.classList.add('cg-feedback-pulse-target', 'cg-feedback-pulse-target--active');
      });
    }
    return counter;
  }

  function makeCapturedForColor(colorIdx) {
    const strip = document.createElement('div');
    strip.classList.add('cg-captured-strip');
    strip.style.display = 'flex';
    strip.style.alignItems = 'center';
    strip.style.gap = '0px';
    applyTooltipAttributes(strip, TOOLTIP_TEXT.capturedPieces);
    const pieces = (capturedByColor?.[colorIdx] || []);
    const pulsingIndexes = pulsingCapturedIndexSets[colorIdx] || new Set();
    pieces.forEach((piece, idx) => {
      const cap = Math.floor(0.6 * s);
      const img = makePieceGlyph(piece, cap, identityMap, { showLabel: false });
      if (img) {
        const wrap = document.createElement('div');
        wrap.classList.add('cg-captured-strip__piece');
        const overlap = Math.floor(0.1 * cap);
        wrap.style.width = cap + 'px';
        wrap.style.height = cap + 'px';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.justifyContent = 'center';
        applyTooltipAttributes(wrap, TOOLTIP_TEXT.capturedPieces);
        if (idx > 0) {
          wrap.style.marginLeft = (-overlap) + 'px';
        }
        if (pulsingIndexes.has(idx)) {
          wrap.classList.add('cg-feedback-pulse-target', 'cg-feedback-pulse-target--active');
        }
        wrap.appendChild(img);
        strip.appendChild(wrap);
      }
    });
    return strip;
  }

  // Layout containers
  topBar.style.left = leftPx + 'px';
  topBar.style.top = topBarTop + 'px';
  topBar.style.width = bW + 'px';
  topBar.style.height = contH + 'px';
  topBar.style.display = 'flex';
  topBar.style.flexDirection = 'column';
  topBar.style.gap = gap + 'px';

  bottomBar.style.left = leftPx + 'px';
  bottomBar.style.top = bottomBarTop + 'px';
  bottomBar.style.width = bW + 'px';
  bottomBar.style.height = contH + 'px';
  bottomBar.style.display = 'flex';
  bottomBar.style.flexDirection = 'column';
  bottomBar.style.gap = gap + 'px';

  function fillBar(barEl, isTopBar) {
    while (barEl.firstChild) barEl.removeChild(barEl.firstChild);
    const showBubble = isTopBar ? showChallengeTop : showChallengeBottom;
    const nameRow = buildNameRow({
      isTopBar,
      showChallengeBubble: showBubble,
      winCount: isTopBar ? winsTop : winsBottom,
      connection: isTopBar ? connectionTop : connectionBottom,
      eloValue: isTopBar ? eloTop : eloBottom,
      nameText: isTopBar ? nameTop : nameBottom
    });
    const row = document.createElement('div');
    row.style.height = rowH + 'px';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    if (isTopBar) {
      row.appendChild(makeCapturedForColor(topColor));
      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '6px';
      right.appendChild(buildDaggers(currentDaggers?.[topColor] || 0, topColor));
      const clock = buildClock({ isWhite: topColor === 0, text: clockTop });
      right.appendChild(clock);
      row.appendChild(right);
      barEl.appendChild(nameRow);
      barEl.appendChild(row);
      topClockEl = clock;
    } else {
      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '6px';
      const clock = buildClock({ isWhite: bottomColor === 0, text: clockBottom });
      left.appendChild(clock);
      left.appendChild(buildDaggers(currentDaggers?.[bottomColor] || 0, bottomColor));
      row.appendChild(left);
      row.appendChild(makeCapturedForColor(bottomColor));
      const spacer = Math.max(4, Math.floor(0.012 * H));
      row.style.marginTop = spacer + 'px';
      nameRow.style.marginTop = (-spacer) + 'px';
      barEl.appendChild(row);
      barEl.appendChild(nameRow);
      bottomClockEl = clock;
    }
  }

  let topClockEl = null;
  let bottomClockEl = null;

  fillBar(topBar, true);
  fillBar(bottomBar, false);

  return { topClockEl, bottomClockEl };
}


