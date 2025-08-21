export function getPieceAt(workingRank, workingOnDeck, workingStash, target) {
  if (!target) return null;
  if (target.type === 'board') return workingRank[target.index] || null;
  if (target.type === 'deck') return workingOnDeck || null;
  if (target.type === 'stash') return workingStash[target.index] || null;
  return null;
}

export function setPieceAt(workingRank, workingOnDeckRef, workingStash, target, piece) {
  if (target.type === 'board') { workingRank[target.index] = piece; return; }
  if (target.type === 'deck') { workingOnDeckRef.value = piece; return; }
  if (target.type === 'stash') { workingStash[target.index] = piece; return; }
}

export function performMove(workingRank, workingOnDeckRef, workingStash, origin, dest) {
  const pieceFrom = getPieceAt(workingRank, workingOnDeckRef.value, workingStash, origin);
  if (!pieceFrom) return false;
  const pieceTo = getPieceAt(workingRank, workingOnDeckRef.value, workingStash, dest);
  setPieceAt(workingRank, workingOnDeckRef, workingStash, origin, pieceTo || null);
  setPieceAt(workingRank, workingOnDeckRef, workingStash, dest, pieceFrom);
  return true;
}


