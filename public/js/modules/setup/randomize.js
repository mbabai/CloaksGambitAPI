// Generate a legal setup given the current workingStash and server/player color.
// Constraints: 5 pieces on bottom rank, includes a King; on-deck filled with one piece; pieces drawn from current
// workingStash and any already-placed rank pieces; never exceed available counts.

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomizeSetup({ workingRank, workingOnDeck, workingStash, myColor }) {
  // Collect pool: move any current rank pieces back to stash pool first
  const pool = [];
  for (let i = 0; i < 5; i++) {
    if (workingRank[i]) { pool.push(workingRank[i]); workingRank[i] = null; }
  }
  for (let i = 0; i < workingStash.length; i++) {
    if (workingStash[i]) pool.push(workingStash[i]);
    workingStash[i] = null;
  }
  if (workingOnDeck) { pool.push(workingOnDeck); workingOnDeck = null; }

  // Filter to only our color
  const myPool = pool.filter(p => p && p.color === myColor);
  shuffleInPlace(myPool);

  // Ensure we have a king
  const kingIdx = myPool.findIndex(p => p.identity === 1);
  if (kingIdx === -1) return { workingRank, workingOnDeck, workingStash, ok: false };
  const king = myPool.splice(kingIdx, 1)[0];

  // Choose 4 more pieces for the rank
  const rankPieces = [king];
  while (rankPieces.length < 5 && myPool.length > 0) {
    rankPieces.push(myPool.shift());
  }
  if (rankPieces.length < 5) return { workingRank, workingOnDeck, workingStash, ok: false };

  // Choose 1 on-deck piece
  if (myPool.length === 0) return { workingRank, workingOnDeck, workingStash, ok: false };
  const deckPiece = myPool.shift();

  // Place rank pieces randomly across 5 columns
  const cols = [0,1,2,3,4];
  shuffleInPlace(cols);
  for (let i = 0; i < 5; i++) {
    workingRank[cols[i]] = rankPieces[i];
  }
  workingOnDeck = deckPiece;

  // Put the rest back into the stash (first 8 only)
  for (let i = 0; i < 8 && i < myPool.length; i++) {
    workingStash[i] = myPool[i];
  }

  return { workingRank, workingOnDeck, workingStash, ok: true };
}


