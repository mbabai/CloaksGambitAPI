export function groupCapturedPiecesByColor(rawCaptured) {
  const grouped = [[], []];
  if (!Array.isArray(rawCaptured)) {
    return grouped;
  }

  for (let bucketIdx = 0; bucketIdx < rawCaptured.length; bucketIdx += 1) {
    const bucket = rawCaptured[bucketIdx];
    if (!Array.isArray(bucket)) {
      continue;
    }

    bucket.forEach((piece) => {
      if (!piece || typeof piece !== 'object') {
        return;
      }
      const color = piece.color;
      const colorIdx = color === 1 ? 1 : color === 0 ? 0 : null;
      if (colorIdx === null) {
        return;
      }
      grouped[colorIdx].push(piece);
    });
  }

  return grouped;
}
