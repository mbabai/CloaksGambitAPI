export function dimOriginEl(origin, refs, opacity = 0.2) {
  let originEl = null;
  try {
    if (origin.type === 'board') originEl = refs.bottomCells?.[origin.index]?.el || null;
    else if (origin.type === 'boardAny') {
      const r = origin.uiR, c = origin.uiC;
      originEl = refs.boardCells?.[r]?.[c]?.el || null;
    }
    else if (origin.type === 'stash') originEl = refs.stashSlots?.[origin.index]?.el || null;
    else if (origin.type === 'deck') originEl = refs.deckEl || null;
    if (originEl) originEl.style.opacity = String(opacity);
  } catch (_) {}
  return originEl;
}

export function restoreOriginEl(dragging) {
  try {
    if (dragging && dragging.originEl) dragging.originEl.style.opacity = '';
  } catch (_) {}
}
