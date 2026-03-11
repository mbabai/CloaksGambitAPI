export function createLossChart({ canvas, tooltip, legend, runList }) {
  const state = {
    series: [],
    runs: [],
    plot: null,
    hoverIndex: null,
  };

  function hideTooltip() {
    if (tooltip) {
      tooltip.hidden = true;
    }
  }

  function updateTooltip(event, hoverIndex) {
    const entry = state.series[hoverIndex];
    if (!entry || !tooltip) {
      hideTooltip();
      return;
    }
    tooltip.innerHTML = `
      <div><strong>Run ${entry.runIndex + 1} / Epoch ${entry.epoch}</strong></div>
      <div style="color:#f0b658;">Policy ${entry.policyLoss.toFixed(3)}</div>
      <div style="color:#7fd2de;">Value ${entry.valueLoss.toFixed(3)}</div>
      <div style="color:#ef8787;">Identity ${entry.identityLoss.toFixed(3)}</div>
      <div>Identity accuracy ${(entry.identityAccuracy * 100).toFixed(1)}%</div>
    `;

    const wrapRect = canvas?.parentElement?.getBoundingClientRect();
    if (!wrapRect) return;
    let left = event.clientX - wrapRect.left + 12;
    let top = event.clientY - wrapRect.top + 10;
    tooltip.hidden = false;
    const tipW = tooltip.offsetWidth || 180;
    const tipH = tooltip.offsetHeight || 90;
    left = Math.max(6, Math.min(wrapRect.width - tipW - 6, left));
    top = Math.max(6, Math.min(wrapRect.height - tipH - 6, top));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const safeHistory = state.series || [];

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#08161b';
    ctx.fillRect(0, 0, width, height);

    if (!safeHistory.length) {
      state.plot = null;
      state.hoverIndex = null;
      ctx.fillStyle = '#93afa8';
      ctx.font = '24px Aptos';
      ctx.fillText('No loss history yet', 28, 46);
      if (legend) {
        legend.textContent = 'Train a snapshot to populate policy, value, and identity losses.';
      }
      if (runList) {
        runList.innerHTML = '';
      }
      hideTooltip();
      return;
    }

    const margin = { top: 22, right: 20, bottom: 48, left: 62 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const values = safeHistory.flatMap((entry) => [entry.policyLoss, entry.valueLoss, entry.identityLoss]);
    const rawMax = Math.max(...values);
    const rawMin = Math.min(...values);
    const spread = Math.max(0.2, rawMax - rawMin);
    const pad = spread * 0.14;
    const maxValue = rawMax + pad;
    const minValue = rawMin - pad;
    const range = Math.max(0.01, maxValue - minValue);
    const xForIndex = (idx) => margin.left + ((plotW * idx) / Math.max(1, safeHistory.length - 1));
    const yForValue = (value) => margin.top + (((maxValue - value) / range) * plotH);

    ctx.strokeStyle = 'rgba(147, 175, 168, 0.2)';
    ctx.lineWidth = 1;
    ctx.font = '12px Aptos';
    ctx.fillStyle = '#93afa8';
    for (let tick = 0; tick <= 5; tick += 1) {
      const ratio = tick / 5;
      const y = margin.top + (plotH * ratio);
      const value = maxValue - (range * ratio);
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(width - margin.right, y);
      ctx.stroke();
      ctx.fillText(value.toFixed(3), 12, y + 4);
    }

    const xTickCount = Math.min(8, safeHistory.length);
    ctx.textAlign = 'center';
    for (let tick = 0; tick < xTickCount; tick += 1) {
      const idx = Math.round((tick * (safeHistory.length - 1)) / Math.max(1, xTickCount - 1));
      const x = xForIndex(idx);
      const entry = safeHistory[idx];
      ctx.beginPath();
      ctx.moveTo(x, margin.top + plotH);
      ctx.lineTo(x, margin.top + plotH + 5);
      ctx.stroke();
      ctx.fillText(`R${entry.runIndex + 1}E${entry.epoch}`, x, margin.top + plotH + 18);
    }
    ctx.textAlign = 'left';
    ctx.fillText('Loss', 12, 16);
    ctx.textAlign = 'center';
    ctx.fillText('Training Step', margin.left + (plotW / 2), height - 10);
    ctx.textAlign = 'left';

    ctx.strokeStyle = 'rgba(147, 175, 168, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + plotH);
    ctx.lineTo(margin.left + plotW, margin.top + plotH);
    ctx.stroke();

    const seriesDefs = [
      { field: 'policyLoss', color: '#f0b658' },
      { field: 'valueLoss', color: '#7fd2de' },
      { field: 'identityLoss', color: '#ef8787' },
    ];

    seriesDefs.forEach((item) => {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      safeHistory.forEach((entry, idx) => {
        const x = xForIndex(idx);
        const y = yForValue(Number(entry[item.field] || 0));
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.fillStyle = item.color;
      safeHistory.forEach((entry, idx) => {
        const x = xForIndex(idx);
        const y = yForValue(Number(entry[item.field] || 0));
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    if (Number.isFinite(state.hoverIndex)) {
      const hoverIndex = Math.max(0, Math.min(safeHistory.length - 1, state.hoverIndex));
      const x = xForIndex(hoverIndex);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      hideTooltip();
    }

    state.plot = { margin, plotW, xForIndex };
    if (legend) {
      const latest = safeHistory[safeHistory.length - 1];
      legend.innerHTML = `
        <span style="color:#f0b658;">Policy ${latest.policyLoss.toFixed(3)}</span>
        |
        <span style="color:#7fd2de;">Value ${latest.valueLoss.toFixed(3)}</span>
        |
        <span style="color:#ef8787;">Identity ${latest.identityLoss.toFixed(3)}</span>
        |
        Accuracy ${(latest.identityAccuracy * 100).toFixed(1)}%
      `;
    }
    if (runList) {
      runList.innerHTML = '';
      state.runs.forEach((run) => {
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.textContent = `Run ${run.runIndex + 1} | ${run.epochs} ep | LR ${run.learningRate.toFixed(4)} | ${run.sourceGames} games`;
        runList.appendChild(chip);
      });
    }
  }

  function onPointerMove(event) {
    const history = state.series || [];
    const plot = state.plot;
    if (!history.length || !plot || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const canvasX = (event.clientX - rect.left) * scaleX;
    const minX = plot.margin.left;
    const maxX = plot.margin.left + plot.plotW;
    if (canvasX < minX || canvasX > maxX) {
      if (state.hoverIndex !== null) {
        state.hoverIndex = null;
        draw();
      }
      hideTooltip();
      return;
    }
    const ratio = (canvasX - minX) / Math.max(1, plot.plotW);
    const hoverIndex = Math.max(0, Math.min(history.length - 1, Math.round(ratio * Math.max(1, history.length - 1))));
    if (state.hoverIndex !== hoverIndex) {
      state.hoverIndex = hoverIndex;
      draw();
    }
    updateTooltip(event, hoverIndex);
  }

  function onPointerLeave() {
    if (state.hoverIndex !== null) {
      state.hoverIndex = null;
      draw();
    }
    hideTooltip();
  }

  canvas?.addEventListener('pointermove', onPointerMove);
  canvas?.addEventListener('pointerleave', onPointerLeave);

  return {
    setData({ series = [], runs = [] } = {}) {
      state.series = Array.isArray(series) ? series : [];
      state.runs = Array.isArray(runs) ? runs : [];
      state.hoverIndex = null;
      draw();
    },
    clear() {
      state.series = [];
      state.runs = [];
      state.hoverIndex = null;
      draw();
    },
    redraw: draw,
  };
}
