import { pieceGlyph as makePieceGlyph } from './pieceGlyph.js';

export function renderStash({
  container,
  sizes,
  state,
  refs,
  identityMap,
  onAttachHandlers
}) {
  const { squareSize: s, boardWidth: bW, boardHeight: bH, boardLeft: leftPx, boardTop: topPx, playAreaHeight: H } = sizes;
  const { currentIsWhite, isInSetup, workingStash, workingOnDeck, currentStashes, currentOnDecks, selected, dragging, currentOnDeckingPlayer } = state;

  if (!container) return;

  // Recompute bar metrics to place stash beneath bottom bar
  const gap = 6;
  const bottomGap = 2;
  const nameBarH = Math.max(18, Math.floor(0.045 * H));
  const rowH = Math.max(16, Math.floor(0.040 * H));
  const contH = nameBarH + rowH + gap;
  const boardBottom = topPx + bH;
  let bottomBarTop = boardBottom + bottomGap;
  if (bottomBarTop + contH > H) bottomBarTop = Math.max(0, H - contH);

  // Place stash block just under the bottom player's name bar
  const yStart = bottomBarTop + contH + 4;
  // Nudges: move top row up slightly; bottom row up twice that amount
  const verticalNudge = Math.max(2, Math.floor(0.04 * s));
  const yTop = yStart - verticalNudge;

  // Make stash slots the same size as board squares so pieces (90% of slot) match board piece size
  const slot = s;
  // Slight horizontal overlap (5%) to tighten spacing
  const overlapRatio = 0.05;
  const topSpace = -Math.round(overlapRatio * slot);
  const bottomSpace = -Math.round(overlapRatio * slot);

  // rows: top has 5, bottom has 4; bottom is offset by half the (slot + spacing)
  const topCols = 5;
  const bottomCols = 4;

  // Clear render
  while (container.firstChild) container.removeChild(container.firstChild);

  function makeSlot(x, y, isOnDeck, exactLeft, content) {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    // on-deck uses full board-square size s; others use reduced slot size
    const w = isOnDeck ? s : slot;
    const h = isOnDeck ? s : slot;
    // For on-deck, if exactLeft is true, use x as the exact left edge; otherwise center over nominal slot
    const leftAdj = isOnDeck
      ? (exactLeft ? x : Math.round(x - (w - slot) / 2))
      : x;
    const topAdj = isOnDeck ? Math.round(y - (h - slot)) : y;      // bottom-align
    el.style.left = leftAdj + 'px';
    el.style.top = topAdj + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.boxSizing = 'border-box';
    el.style.border = isOnDeck ? '3px solid #DAA520' : '0px solid transparent';
    el.style.background = isOnDeck ? '#3d2e88' : 'transparent';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    if (content) el.appendChild(content);
    return el;
  }

  // Compute board center for stable centering
  const blockCenterX = leftPx + Math.floor(bW / 2);

  // Top row with exact-width layout to keep all gaps = space
  const widthsTop = [slot, slot, s, slot, slot];
  const topTotal = widthsTop.reduce((a, b) => a + b, 0) + (widthsTop.length - 1) * topSpace;
  let xCursor = Math.round(blockCenterX - topTotal / 2);
  const bottomColor = currentIsWhite ? 0 : 1;
  const isOnDeckTurn = (!isInSetup && currentOnDeckingPlayer === bottomColor);
  const stash = isInSetup
    ? workingStash
    : (Array.isArray(currentStashes?.[bottomColor]) ? currentStashes[bottomColor] : []);
  // Map UI slots (excluding center on-deck) to sequential stash pieces
  const uiToOrdinal = { 0: 0, 1: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7 };
  for (let i = 0; i < widthsTop.length; i++) {
    const isOnDeck = (i === 2);
    const ord = uiToOrdinal[i];
    let content = null;
    if (isOnDeck) {
      const deck = isInSetup ? (workingOnDeck || null) : (currentOnDecks?.[bottomColor] || null);
      if (deck) content = makePieceGlyph(deck, isOnDeck ? s : slot, identityMap);
    } else {
      if (ord !== undefined && stash[ord]) content = makePieceGlyph(stash[ord], isOnDeck ? s : slot, identityMap);
    }
    // Fade the origin piece while dragging
    if (content && dragging && dragging.origin) {
      if (isOnDeck && dragging.origin.type === 'deck') {
        content.style.opacity = '0.1';
      } else if (!isOnDeck && dragging.origin.type === 'stash' && dragging.origin.index === ord) {
        content.style.opacity = '0.1';
      }
    }
    const el = makeSlot(xCursor, yTop, isOnDeck, true, content);
    if (isOnDeck) {
      refs.deckEl = el;
      el.style.zIndex = '10'; // ensure on-deck sits above other stash slots/pieces
      if (isOnDeckTurn) el.classList.add('onDeckGlow');
      if ((isInSetup || isOnDeckTurn) && onAttachHandlers) onAttachHandlers(el, { type: 'deck', index: 0 });
      if (selected && selected.type === 'deck') {
        el.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 0, 0.9))';
      }
    } else {
      const ord = uiToOrdinal[i];
      if ((isInSetup || isOnDeckTurn) && onAttachHandlers) onAttachHandlers(el, { type: 'stash', index: ord });
      refs.stashSlots[ord] = { el, ordinal: ord };
      if (selected && selected.type === 'stash' && selected.index === ord) {
        el.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 0, 0.9))';
      }
    }
    container.appendChild(el);
    xCursor += widthsTop[i] + topSpace;
  }

  // Bottom row content width and left
  const bottomContentWidth = bottomCols * slot + (bottomCols - 1) * bottomSpace;
  const bottomLeft = Math.round(blockCenterX - bottomContentWidth / 2 );

  for (let i = 0; i < bottomCols; i++) {
    const x = bottomLeft + i * (slot + bottomSpace);
    // Bottom row touches the top row (no gap) and is nudged up twice as much as the top row
    const y = yStart + slot - (verticalNudge * 2);
    const ord = uiToOrdinal[5 + i];
    const piece = (ord !== undefined) ? stash[ord] : null;
    const content = piece ? makePieceGlyph(piece, slot, identityMap) : null;
    if (content && dragging && dragging.origin && dragging.origin.type === 'stash' && dragging.origin.index === ord) {
      content.style.opacity = '0.5';
    }
    const el = makeSlot(x, y, false, false, content);
    if ((isInSetup || isOnDeckTurn) && onAttachHandlers) onAttachHandlers(el, { type: 'stash', index: ord });
    refs.stashSlots[ord] = { el, ordinal: ord };
    if (selected && selected.type === 'stash' && selected.index === ord) {
      el.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 0, 0.9))';
    }
    container.appendChild(el);
  }
}


