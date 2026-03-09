const ANNOTATION_STROKE = 'rgba(196, 151, 255, 0.8)';
const ANNOTATION_FILL = 'rgba(196, 151, 255, 0.3)';
const SVG_NS = 'http://www.w3.org/2000/svg';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isSquareOnBoard(square, rows, cols) {
  return Boolean(
    square
    && Number.isFinite(square.row)
    && Number.isFinite(square.col)
    && square.row >= 0
    && square.row < rows
    && square.col >= 0
    && square.col < cols
  );
}

function squaresEqual(a, b) {
  return Boolean(a && b && a.row === b.row && a.col === b.col);
}

function squaredDistance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const dr = a.row - b.row;
  const dc = a.col - b.col;
  return (dr * dr) + (dc * dc);
}

function isKnightMove(origin, target) {
  if (!origin || !target) return false;
  const dr = Math.abs(target.row - origin.row);
  const dc = Math.abs(target.col - origin.col);
  return (dr === 2 && dc === 1) || (dr === 1 && dc === 2);
}

function isLinearMove(origin, target) {
  if (!origin || !target) return false;
  if (squaresEqual(origin, target)) return false;
  const dr = Math.abs(target.row - origin.row);
  const dc = Math.abs(target.col - origin.col);
  return dr === 0 || dc === 0 || dr === dc;
}

function createSvgElement(name) {
  return document.createElementNS(SVG_NS, name);
}

function getSquareCenter(square, squareSize) {
  return {
    x: (square.col + 0.5) * squareSize,
    y: (square.row + 0.5) * squareSize,
  };
}

function getArrowMetrics(squareSize) {
  return {
    strokeWidth: Math.max(10, Math.floor(squareSize * 0.28)),
    headLength: Math.max(21, Math.floor(squareSize * 0.42)),
    headWidth: Math.max(36, Math.floor(squareSize * 0.63)),
  };
}

function trimPoint(start, end, amount) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (!distance || amount <= 0) {
    return { ...end };
  }
  const trimRatio = Math.max(0, (distance - Math.min(amount, distance)) / distance);
  return {
    x: start.x + (dx * trimRatio),
    y: start.y + (dy * trimRatio),
  };
}

function getUnitVector(fromPoint, toPoint) {
  const dx = toPoint.x - fromPoint.x;
  const dy = toPoint.y - fromPoint.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) {
    return { x: 0, y: 0 };
  }
  return {
    x: dx / distance,
    y: dy / distance,
  };
}

function getPerpendicular(vector) {
  return {
    x: -vector.y,
    y: vector.x,
  };
}

function offsetPoint(point, normal, amount) {
  return {
    x: point.x + (normal.x * amount),
    y: point.y + (normal.y * amount),
  };
}

function intersectOffsetLines(pointA, directionA, pointB, directionB) {
  const determinant = (directionA.x * directionB.y) - (directionA.y * directionB.x);
  if (Math.abs(determinant) < 0.0001) {
    return {
      x: (pointA.x + pointB.x) / 2,
      y: (pointA.y + pointB.y) / 2,
    };
  }
  const deltaX = pointB.x - pointA.x;
  const deltaY = pointB.y - pointA.y;
  const t = ((deltaX * directionB.y) - (deltaY * directionB.x)) / determinant;
  return {
    x: pointA.x + (directionA.x * t),
    y: pointA.y + (directionA.y * t),
  };
}

function createStraightArrow(svg, start, end, squareSize) {
  const direction = getUnitVector(start, end);
  if (!direction.x && !direction.y) return;

  const { strokeWidth, headLength, headWidth } = getArrowMetrics(squareSize);
  const normal = getPerpendicular(direction);
  const shaftHalfWidth = strokeWidth / 2;
  const halfHeadWidth = headWidth / 2;
  const basePoint = trimPoint(start, end, headLength);

  const arrow = createSvgElement('polygon');
  arrow.setAttribute('points', [
    `${start.x + (normal.x * shaftHalfWidth)},${start.y + (normal.y * shaftHalfWidth)}`,
    `${basePoint.x + (normal.x * shaftHalfWidth)},${basePoint.y + (normal.y * shaftHalfWidth)}`,
    `${basePoint.x + (normal.x * halfHeadWidth)},${basePoint.y + (normal.y * halfHeadWidth)}`,
    `${end.x},${end.y}`,
    `${basePoint.x - (normal.x * halfHeadWidth)},${basePoint.y - (normal.y * halfHeadWidth)}`,
    `${basePoint.x - (normal.x * shaftHalfWidth)},${basePoint.y - (normal.y * shaftHalfWidth)}`,
    `${start.x - (normal.x * shaftHalfWidth)},${start.y - (normal.y * shaftHalfWidth)}`,
  ].join(' '));
  arrow.setAttribute('fill', ANNOTATION_STROKE);
  svg.appendChild(arrow);
}

function createKnightArrowShape(svg, start, corner, end, squareSize) {
  const { strokeWidth, headLength, headWidth } = getArrowMetrics(squareSize);
  const shaftHalfWidth = strokeWidth / 2;
  const halfHeadWidth = headWidth / 2;
  const firstDirection = getUnitVector(start, corner);
  const finalDirection = getUnitVector(corner, end);
  if ((!firstDirection.x && !firstDirection.y) || (!finalDirection.x && !finalDirection.y)) {
    return;
  }

  const firstNormal = getPerpendicular(firstDirection);
  const finalNormal = getPerpendicular(finalDirection);
  const basePoint = trimPoint(corner, end, headLength);
  const leftJoin = intersectOffsetLines(
    offsetPoint(corner, firstNormal, shaftHalfWidth),
    firstDirection,
    offsetPoint(corner, finalNormal, shaftHalfWidth),
    finalDirection
  );
  const rightJoin = intersectOffsetLines(
    offsetPoint(corner, firstNormal, -shaftHalfWidth),
    firstDirection,
    offsetPoint(corner, finalNormal, -shaftHalfWidth),
    finalDirection
  );

  const arrow = createSvgElement('polygon');
  arrow.setAttribute('points', [
    `${start.x + (firstNormal.x * shaftHalfWidth)},${start.y + (firstNormal.y * shaftHalfWidth)}`,
    `${leftJoin.x},${leftJoin.y}`,
    `${basePoint.x + (finalNormal.x * shaftHalfWidth)},${basePoint.y + (finalNormal.y * shaftHalfWidth)}`,
    `${basePoint.x + (finalNormal.x * halfHeadWidth)},${basePoint.y + (finalNormal.y * halfHeadWidth)}`,
    `${end.x},${end.y}`,
    `${basePoint.x - (finalNormal.x * halfHeadWidth)},${basePoint.y - (finalNormal.y * halfHeadWidth)}`,
    `${basePoint.x - (finalNormal.x * shaftHalfWidth)},${basePoint.y - (finalNormal.y * shaftHalfWidth)}`,
    `${rightJoin.x},${rightJoin.y}`,
    `${start.x - (firstNormal.x * shaftHalfWidth)},${start.y - (firstNormal.y * shaftHalfWidth)}`,
  ].join(' '));
  arrow.setAttribute('fill', ANNOTATION_STROKE);
  svg.appendChild(arrow);
}

export function getKnightCorner(origin, target) {
  if (!isKnightMove(origin, target)) return null;
  const dr = Math.abs(target.row - origin.row);
  const dc = Math.abs(target.col - origin.col);
  if (dr > dc) {
    return { row: target.row, col: origin.col };
  }
  return { row: origin.row, col: target.col };
}

export function getAnnotationShape(origin, target) {
  if (!origin || !target || squaresEqual(origin, target)) {
    return 'circle';
  }
  if (isKnightMove(origin, target)) {
    return 'knight';
  }
  if (isLinearMove(origin, target)) {
    return 'line';
  }
  return null;
}

export function getAnnotationCandidates(origin, rows, cols) {
  if (!isSquareOnBoard(origin, rows, cols)) return [];
  const candidates = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const target = { row, col };
      if (squaresEqual(origin, target)) continue;
      if (isLinearMove(origin, target) || isKnightMove(origin, target)) {
        candidates.push(target);
      }
    }
  }
  return candidates;
}

export function getSnappedAnnotationSquare(origin, hovered, rows, cols) {
  if (!isSquareOnBoard(origin, rows, cols)) return null;
  if (!isSquareOnBoard(hovered, rows, cols)) return { ...origin };
  if (isLinearMove(origin, hovered) || isKnightMove(origin, hovered) || squaresEqual(origin, hovered)) {
    return { row: hovered.row, col: hovered.col };
  }

  const candidates = getAnnotationCandidates(origin, rows, cols);
  if (!candidates.length) {
    return { ...origin };
  }

  let best = candidates[0];
  let bestDistance = squaredDistance(best, hovered);

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const distance = squaredDistance(candidate, hovered);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      continue;
    }
    if (distance === bestDistance) {
      const currentShape = getAnnotationShape(origin, best);
      const nextShape = getAnnotationShape(origin, candidate);
      if (currentShape === 'knight' && nextShape !== 'knight') {
        best = candidate;
      }
    }
  }

  return { ...best };
}

function createCircle(svg, square, squareSize) {
  const circle = createSvgElement('circle');
  const { x: cx, y: cy } = getSquareCenter(square, squareSize);
  const radius = Math.max(8, Math.floor(squareSize * 0.34));
  circle.setAttribute('cx', `${cx}`);
  circle.setAttribute('cy', `${cy}`);
  circle.setAttribute('r', `${radius}`);
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke', ANNOTATION_STROKE);
  circle.setAttribute('stroke-width', `${Math.max(4, Math.floor(squareSize * 0.11))}`);
  circle.setAttribute('stroke-linecap', 'round');
  circle.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(circle);
}

function createLineArrow(svg, origin, target, squareSize) {
  const start = getSquareCenter(origin, squareSize);
  const end = getSquareCenter(target, squareSize);
  createStraightArrow(svg, start, end, squareSize);
}

function createKnightArrow(svg, origin, target, squareSize) {
  const corner = getKnightCorner(origin, target);
  if (!corner) {
    createLineArrow(svg, origin, target, squareSize);
    return;
  }

  const start = getSquareCenter(origin, squareSize);
  const middle = getSquareCenter(corner, squareSize);
  const end = getSquareCenter(target, squareSize);
  createKnightArrowShape(svg, start, middle, end, squareSize);
}

function createAnnotationSvg(svg, annotation, squareSize) {
  if (!annotation || !annotation.origin) return;
  const target = annotation.target || annotation.origin;
  const shape = getAnnotationShape(annotation.origin, target);
  if (shape === 'circle') {
    createCircle(svg, annotation.origin, squareSize);
    return;
  }
  if (shape === 'knight') {
    createKnightArrow(svg, annotation.origin, target, squareSize);
    return;
  }
  if (shape === 'line') {
    createLineArrow(svg, annotation.origin, target, squareSize);
  }
}

function buildAnnotationKey(annotation) {
  if (!annotation || !annotation.origin) return '';
  const target = annotation.target || annotation.origin;
  return [
    annotation.origin.row,
    annotation.origin.col,
    target.row,
    target.col,
  ].join(':');
}

function dedupeAnnotations(annotations) {
  const seen = new Set();
  return annotations.filter((annotation) => {
    const key = buildAnnotationKey(annotation);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createBoardAnnotations({
  container,
  enabled = false,
} = {}) {
  if (!container) {
    throw new Error('createBoardAnnotations requires a container');
  }

  let isEnabled = Boolean(enabled);
  let rows = 0;
  let cols = 0;
  let squareSize = 0;
  let svg = null;
  let active = null;
  let annotations = [];

  const onContextMenu = (event) => {
    if (!isEnabled) return;
    if (!rows || !cols || !squareSize) return;
    const square = getSquareFromPointer(event);
    if (!square) return;
    event.preventDefault();
  };

  const onMouseDown = (event) => {
    if (!isEnabled || event.button !== 2) return;
    const origin = getSquareFromPointer(event);
    if (!origin) return;
    event.preventDefault();
    active = {
      origin,
      target: origin,
      hasDragged: false,
    };
    render();
  };

  const onMouseMove = (event) => {
    if (!active) return;
    const hovered = getSquareFromPointer(event);
    if (hovered) {
      active.target = getSnappedAnnotationSquare(active.origin, hovered, rows, cols) || active.origin;
      active.hasDragged = !squaresEqual(active.origin, active.target);
      render();
    }
  };

  const onMouseUp = (event) => {
    if (!active || event.button !== 2) return;
    event.preventDefault();
    const next = {
      origin: active.origin,
      target: active.target || active.origin,
    };
    annotations = dedupeAnnotations([...annotations, next]);
    active = null;
    render();
  };

  const onDocumentLeftMouseDown = (event) => {
    if (!isEnabled || event.button !== 0) return;
    if (!annotations.length && !active) return;
    annotations = [];
    active = null;
    render();
  };

  function ensureSvg() {
    if (svg && svg.parentNode === container) {
      return svg;
    }
    if (svg && svg.parentNode) {
      svg.parentNode.removeChild(svg);
    }
    svg = createSvgElement('svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.overflow = 'visible';
    svg.style.zIndex = '8';
    container.appendChild(svg);
    return svg;
  }

  function getSquareFromPointer(event) {
    if (!rows || !cols || !squareSize) return null;
    const bounds = container.getBoundingClientRect();
    const clientX = event.clientX;
    const clientY = event.clientY;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    if (localX < 0 || localY < 0 || localX > bounds.width || localY > bounds.height) {
      return null;
    }
    const col = clamp(Math.floor(localX / squareSize), 0, cols - 1);
    const row = clamp(Math.floor(localY / squareSize), 0, rows - 1);
    return { row, col };
  }

  function render() {
    if (!isEnabled || !rows || !cols || !squareSize) {
      if (svg && svg.parentNode) {
        svg.parentNode.removeChild(svg);
      }
      return;
    }
    const nextSvg = ensureSvg();
    while (nextSvg.firstChild) {
      nextSvg.removeChild(nextSvg.lastChild);
    }
    annotations.forEach((annotation) => {
      createAnnotationSvg(nextSvg, annotation, squareSize);
    });
    if (active) {
      createAnnotationSvg(nextSvg, active, squareSize);
    }
  }

  function sync(next = {}) {
    rows = Number(next.rows) || 0;
    cols = Number(next.cols) || 0;
    squareSize = Number(next.squareSize) || 0;
    render();
  }

  function setEnabled(value) {
    isEnabled = Boolean(value);
    if (!isEnabled) {
      active = null;
      annotations = [];
    }
    render();
  }

  function clear() {
    active = null;
    annotations = [];
    render();
  }

  function attach() {
    container.addEventListener('contextmenu', onContextMenu);
    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousedown', onDocumentLeftMouseDown, true);
  }

  function detach() {
    container.removeEventListener('contextmenu', onContextMenu);
    container.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('mousedown', onDocumentLeftMouseDown, true);
  }

  attach();

  return {
    sync,
    setEnabled,
    clear,
    destroy() {
      detach();
      clear();
      if (svg && svg.parentNode) {
        svg.parentNode.removeChild(svg);
      }
      svg = null;
    },
  };
}
