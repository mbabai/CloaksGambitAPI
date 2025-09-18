import { pieceGlyph as makePieceGlyph } from './pieceGlyph.js';
import {
  createNameRow,
  createClockPanel,
  createDaggerCounter,
  createChallengeBubbleElement
} from '../ui/banners.js';

export function renderBars({
  topBar,
  bottomBar,
  sizes,
  state,
  identityMap
}) {
  const { squareSize: s, boardWidth: bW, boardHeight: bH, boardLeft: leftPx, boardTop: topPx, playAreaHeight: H } = sizes;
  const {
    currentIsWhite,
    currentCaptured,
    currentDaggers,
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
    eloBottom = null
  } = state;

  if (!topBar || !bottomBar) return;

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

  function buildNameRow({ isTopBar, showChallengeBubble, winCount, connection, eloValue, nameText }) {
    const row = createNameRow({
      name: nameText,
      orientation: isTopBar ? 'top' : 'bottom',
      height: nameBarH,
      fontSize: nameFont,
      isRankedMatch,
      elo: eloValue,
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

  function buildDaggers(count) {
    const counter = createDaggerCounter({
      count,
      size: Math.floor(rowH),
      gap: 6,
      alt: 'Dagger token'
    });
    counter.style.fontSize = iconFont + 'px';
    return counter;
  }

  function makeCapturedForColor(colorIdx) {
    const strip = document.createElement('div');
    strip.style.display = 'flex';
    strip.style.alignItems = 'center';
    strip.style.gap = '0px';
    const pieces = (currentCaptured?.[colorIdx] || []);
    pieces.forEach((piece, idx) => {
      const cap = Math.floor(0.6 * s);
      const img = makePieceGlyph(piece, cap, identityMap);
      if (img) {
        const wrap = document.createElement('div');
        const overlap = Math.floor(0.1 * cap);
        wrap.style.width = cap + 'px';
        wrap.style.height = cap + 'px';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.justifyContent = 'center';
        if (idx > 0) {
          wrap.style.marginLeft = (-overlap) + 'px';
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
      const topColor = currentIsWhite ? 1 : 0;
      row.appendChild(makeCapturedForColor(topColor));
      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '6px';
      right.appendChild(buildDaggers(currentDaggers?.[topColor] || 0));
      const clock = buildClock({ isWhite: topColor === 0, text: clockTop });
      right.appendChild(clock);
      row.appendChild(right);
      barEl.appendChild(nameRow);
      barEl.appendChild(row);
      topClockEl = clock;
    } else {
      const bottomColor = currentIsWhite ? 0 : 1;
      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '6px';
      const clock = buildClock({ isWhite: bottomColor === 0, text: clockBottom });
      left.appendChild(clock);
      left.appendChild(buildDaggers(currentDaggers?.[bottomColor] || 0));
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


