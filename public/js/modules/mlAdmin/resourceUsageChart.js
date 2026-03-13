function getCanvasSize(canvas) {
  const width = Math.max(120, Math.floor(canvas?.clientWidth || canvas?.width || 240));
  const height = Math.max(54, Math.floor(canvas?.clientHeight || canvas?.height || 72));
  return { width, height };
}

function drawEmptyState(ctx, width, height, colors) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height - 1);
  ctx.lineTo(width, height - 1);
  ctx.stroke();
}

export function createResourceUsageChart({ canvas, colors = {} } = {}) {
  const ctx = canvas?.getContext?.('2d');
  const palette = {
    background: colors.background || 'rgba(6, 18, 23, 0)',
    grid: colors.grid || 'rgba(133, 184, 175, 0.14)',
    fill: colors.fill || 'rgba(127, 210, 222, 0.18)',
    stroke: colors.stroke || '#7fd2de',
  };
  let history = [];

  function redraw() {
    if (!ctx || !canvas) return;
    const { width, height } = getCanvasSize(canvas);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    drawEmptyState(ctx, width, height, palette);
    const points = Array.isArray(history)
      ? history.filter((entry) => Number.isFinite(Number(entry?.percent)))
      : [];
    if (!points.length) {
      return;
    }

    const graphWidth = Math.max(1, width - 2);
    const graphHeight = Math.max(1, height - 10);
    const yForPercent = (percent) => {
      const normalized = Math.max(0, Math.min(100, Number(percent || 0)));
      return 4 + ((100 - normalized) / 100) * graphHeight;
    };

    ctx.beginPath();
    points.forEach((entry, index) => {
      const x = points.length === 1
        ? 1
        : 1 + (index / Math.max(1, points.length - 1)) * graphWidth;
      const y = yForPercent(entry.percent);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    const lastPoint = points[points.length - 1];
    const lastX = points.length === 1
      ? 1
      : 1 + graphWidth;
    const lastY = yForPercent(lastPoint.percent);

    ctx.lineTo(lastX, height - 1);
    ctx.lineTo(1, height - 1);
    ctx.closePath();
    ctx.fillStyle = palette.fill;
    ctx.fill();

    ctx.beginPath();
    points.forEach((entry, index) => {
      const x = points.length === 1
        ? 1
        : 1 + (index / Math.max(1, points.length - 1)) * graphWidth;
      const y = yForPercent(entry.percent);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = palette.stroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = palette.stroke;
    ctx.fill();
  }

  return {
    setHistory(nextHistory = []) {
      history = Array.isArray(nextHistory) ? nextHistory.slice() : [];
      redraw();
    },
    redraw,
    clear() {
      history = [];
      redraw();
    },
  };
}
