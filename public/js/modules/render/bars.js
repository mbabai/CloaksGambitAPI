import { pieceGlyph as makePieceGlyph } from './pieceGlyph.js';
import { createEloBadge } from './eloBadge.js';

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

  function makeNameRow({ text, isTopBar, showChallengeBubble, winCount, connection, elo }) {
    const row = document.createElement('div');
    row.style.height = nameBarH + 'px';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = isTopBar ? 'flex-end' : 'flex-start';
    row.style.position = 'relative';
    row.style.width = '100%';

    const nameWrap = document.createElement('div');
    nameWrap.style.display = 'inline-block';
    nameWrap.style.color = 'var(--CG-white)';
    nameWrap.style.fontSize = nameFont + 'px';
    nameWrap.style.fontWeight = 'bold';
    nameWrap.style.zIndex = '0';
    nameWrap.textContent = text;

    const nameContent = document.createElement('div');
    nameContent.style.display = 'flex';
    nameContent.style.alignItems = 'center';
    nameContent.style.gap = '6px';

    let badge = null;
    if (isRankedMatch) {
      const badgeSize = Math.max(16, Math.floor(nameBarH * 0.9));
      badge = createEloBadge({ elo, size: badgeSize });
    }

    if (badge) {
      if (isTopBar) {
        nameContent.appendChild(nameWrap);
        nameContent.appendChild(badge);
      } else {
        nameContent.appendChild(badge);
        nameContent.appendChild(nameWrap);
      }
    } else {
      nameContent.appendChild(nameWrap);
    }

    if (connection && Number.isFinite(connection.displaySeconds)) {
      const indicator = document.createElement('div');
      indicator.style.display = 'flex';
      indicator.style.alignItems = 'center';
      indicator.style.gap = '4px';

      const indicatorSize = Math.max(12, Math.floor(nameBarH * 0.75));
      const img = document.createElement('img');
      img.src = '/assets/images/loading.gif';
      img.alt = 'Opponent reconnecting';
      img.style.width = indicatorSize + 'px';
      img.style.height = indicatorSize + 'px';
      img.style.objectFit = 'contain';

      const countdown = document.createElement('span');
      countdown.textContent = String(Math.max(0, connection.displaySeconds)).padStart(2, '0');
      countdown.style.fontFamily = 'Courier New, monospace';
      countdown.style.fontWeight = 'bold';
      countdown.style.fontSize = Math.max(12, Math.floor(nameFont * 0.9)) + 'px';
      countdown.style.color = 'var(--CG-white)';

      indicator.appendChild(img);
      indicator.appendChild(countdown);
      nameContent.appendChild(indicator);
    }

    let winsWrap = null;
    const nWins = Math.max(0, Number(winCount || 0));
    if (nWins > 0) {
      winsWrap = document.createElement('div');
      winsWrap.style.display = 'flex';
      winsWrap.style.alignItems = 'center';
      winsWrap.style.gap = '2px';
      const throneSize = Math.floor(nameBarH * 0.9);
      for (let i = 0; i < nWins; i++) {
        const img = document.createElement('img');
        img.src = '/assets/images/GoldThrone.svg';
        img.style.width = throneSize + 'px';
        img.style.height = throneSize + 'px';
        winsWrap.appendChild(img);
      }
      if (isTopBar) {
        winsWrap.style.marginRight = '6px';
        row.appendChild(winsWrap);
        row.appendChild(nameContent);
      } else {
        winsWrap.style.marginLeft = '6px';
        row.appendChild(nameContent);
        row.appendChild(winsWrap);
      }
    } else {
      row.appendChild(nameContent);
    }

    if (showChallengeBubble) {
      const bubbleSize = 3 * nameBarH;
      const bubble = document.createElement('img');
      bubble.src = isTopBar
        ? '/assets/images/UI/BubbleSpeechTopChallenge.svg'
        : '/assets/images/UI/BubbleSpeechBottomChallenge.svg';
      bubble.style.position = 'absolute';
      bubble.style.left = '50%';
      bubble.style.top = '50%';
      bubble.style.transform = `translate(-50%, -50%) translateY(${isTopBar ? '60%' : '-30%'})`;
      bubble.style.width = bubbleSize + 'px';
      bubble.style.height = bubbleSize + 'px';
      // Ensure the challenge bubble appears above board pieces
      bubble.style.zIndex = '20';
      bubble.style.pointerEvents = 'none';
      row.appendChild(bubble);
    }

    return row;
  }

  function makeClock(colorIsWhite, text) {
    const box = document.createElement('div');
    box.style.width = Math.floor(2.9 * rowH) + 'px';
    box.style.height = rowH + 'px';
    box.style.display = 'flex';
    box.style.alignItems = 'center';
    box.style.justifyContent = 'center';
    box.style.fontFamily = 'Courier New, monospace';
    box.style.fontWeight = 'bold';
    box.style.fontSize = clockFont + 'px';
    box.style.background = colorIsWhite ? 'var(--CG-white)' : 'var(--CG-black)';
    box.style.color = colorIsWhite ? 'var(--CG-black)' : 'var(--CG-white)';
    box.style.border = '2px solid var(--CG-deep-gold)';
    box.style.borderRadius = '0px';
    box.textContent = text;
    return box;
  }

  function makeDaggers(count) {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '6px';
    const n = Math.max(0, Number(count || 0));
    for (let i = 0; i < n; i++) {
      const token = document.createElement('div');
      const sz = Math.floor(rowH);
      token.style.width = sz + 'px';
      token.style.height = sz + 'px';
      token.style.border = '2px solid var(--CG-white)';
      token.style.borderRadius = '50%';
      token.style.background = 'var(--CG-dark-red)';
      token.style.color = 'var(--CG-white)';
      token.style.display = 'flex';
      token.style.alignItems = 'center';
      token.style.justifyContent = 'center';
      token.style.fontWeight = 'bold';
      token.style.fontSize = iconFont + 'px';
      token.textContent = '⚔';
      wrap.appendChild(token);
    }
    return wrap;
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
    const nameRow = makeNameRow({
      text: isTopBar ? nameTop : nameBottom,
      isTopBar,
      showChallengeBubble: showBubble,
      winCount: isTopBar ? winsTop : winsBottom,
      connection: isTopBar ? connectionTop : connectionBottom,
      elo: isTopBar ? eloTop : eloBottom
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
      right.appendChild(makeDaggers(currentDaggers?.[topColor] || 0));
      const clock = makeClock(topColor === 0, clockTop);
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
      const clock = makeClock(bottomColor === 0, clockBottom);
      left.appendChild(clock);
      left.appendChild(makeDaggers(currentDaggers?.[bottomColor] || 0));
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


