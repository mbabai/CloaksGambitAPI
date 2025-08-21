export function computePlayAreaBounds(vw, vh) {
  const target = 1.618; // height / width
  const parentRatio = vh / vw;
  let width, height;
  if (parentRatio < target) {
    height = vh;
    width = Math.floor(height / target);
  } else {
    width = vw;
    height = Math.floor(width * target);
  }
  const left = Math.floor((vw - width) / 2);
  const top = Math.floor((vh - height) / 2);
  return { left, top, width, height };
}

export function computeBoardMetrics(clientWidth, clientHeight, cols, rows) {
  const widthLimit = clientWidth / (cols + 1);
  const heightLimit = (0.6 * clientHeight) / rows;
  const s = Math.max(1, Math.floor(Math.min(widthLimit, heightLimit)));
  const bW = s * cols;
  const bH = s * rows;
  const leftPx = Math.floor((clientWidth - bW) / 2);
  const desiredCenterY = clientHeight * 0.40;
  let topPx = Math.floor(desiredCenterY - (bH / 2));
  if (topPx < 0) topPx = 0;
  if (topPx > clientHeight - bH) topPx = clientHeight - bH;
  return { squareSize: s, boardWidth: bW, boardHeight: bH, boardLeft: leftPx, boardTop: topPx };
}


