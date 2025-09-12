import { pieceGlyph as makePieceGlyph } from './pieceGlyph.js';

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
    showChallengeBottom = false
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

  function makeNameRow(text, isTopBar, showChallengeBubble) {
    const row = document.createElement('div');
    row.style.height = nameBarH + 'px';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = isTopBar ? 'flex-end' : 'flex-start';
    row.style.position = 'relative';
    row.style.width = '100%';

    const nameWrap = document.createElement('div');
    nameWrap.style.display = 'inline-block';
    nameWrap.style.color = '#fff';
    nameWrap.style.fontSize = nameFont + 'px';
    nameWrap.style.fontWeight = 'bold';
    nameWrap.style.zIndex = '0';
    nameWrap.textContent = text;
    row.appendChild(nameWrap);

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
      bubble.style.zIndex = '1';
      bubble.style.pointerEvents = 'none';
      row.appendChild(bubble);
    }

    return row;
  }

  function makeClock(colorIsWhite) {
    const box = document.createElement('div');
    box.style.width = Math.floor(2.9 * rowH) + 'px';
    box.style.height = rowH + 'px';
    box.style.display = 'flex';
    box.style.alignItems = 'center';
    box.style.justifyContent = 'center';
    box.style.fontFamily = 'Courier New, monospace';
    box.style.fontWeight = 'bold';
    box.style.fontSize = clockFont + 'px';
    box.style.background = colorIsWhite ? '#fff' : '#000';
    box.style.color = colorIsWhite ? '#000' : '#fff';
    box.style.border = '2px solid #DAA520';
    box.style.borderRadius = '0px';
    box.textContent = '5:00';
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
      token.style.border = '2px solid #fff';
      token.style.borderRadius = '50%';
      token.style.background = '#dc2626';
      token.style.color = '#fff';
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
    const nameRow = makeNameRow(
      isTopBar ? 'Opponent Name' : 'My Name',
      isTopBar,
      showBubble
    );
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
      right.appendChild(makeClock(topColor === 0));
      row.appendChild(right);
      barEl.appendChild(nameRow);
      barEl.appendChild(row);
    } else {
      const bottomColor = currentIsWhite ? 0 : 1;
      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '6px';
      left.appendChild(makeClock(bottomColor === 0));
      left.appendChild(makeDaggers(currentDaggers?.[bottomColor] || 0));
      row.appendChild(left);
      row.appendChild(makeCapturedForColor(bottomColor));
      const spacer = Math.max(4, Math.floor(0.012 * H));
      row.style.marginTop = spacer + 'px';
      nameRow.style.marginTop = (-spacer) + 'px';
      barEl.appendChild(row);
      barEl.appendChild(nameRow);
    }
  }

  fillBar(topBar, true);
  fillBar(bottomBar, false);
}


