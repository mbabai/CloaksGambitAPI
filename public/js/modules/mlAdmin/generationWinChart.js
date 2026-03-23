export function createGenerationWinChart({ canvas, tooltip, legend } = {}) {
  const DEFAULT_HIT_RADIUS = 26;
  const DEFAULT_STICKY_RADIUS = 42;
  const baselinePalette = ['#ef8787', '#f0b658', '#ffd89a', '#8ed18e', '#7fd2de', '#b998ff'];
  const prePromotionColor = '#f2f5f7';
  const promotionColor = '#9aa7ad';
  const fallbackPalette = ['#f0b658', '#7fd2de', '#8ed18e', '#ef8787', '#ffd89a', '#c1f0f7'];
  const state = {
    series: [],
    plot: null,
    hover: null,
    title: '',
    canvasSize: {
      width: 0,
      height: 0,
    },
  };

  function renderEmptyTooltip() {
    if (!tooltip) return;
    tooltip.classList.add('is-empty');
    tooltip.innerHTML = `
      <div class="chart-tooltip-title"><strong>&nbsp;</strong></div>
      <div class="chart-tooltip-grid">
        <div class="chart-tooltip-placeholder" style="padding:6px 8px;border-radius:10px;border:1px solid rgba(240,182,88,0.38);">.</div>
        <div class="chart-tooltip-placeholder" style="padding:6px 8px;border-radius:10px;border:1px solid rgba(142,209,142,0.34);">.</div>
        <div class="chart-tooltip-placeholder" style="padding:6px 8px;border-radius:10px;border:1px solid rgba(127,210,222,0.18);">.</div>
      </div>
      <div class="chart-tooltip-footer">&nbsp;</div>
    `;
    tooltip.style.minHeight = '168px';
    tooltip.style.display = 'flex';
  }

  function hideTooltip() {
    renderEmptyTooltip();
  }

  function formatPercent(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : '--';
  }

  function formatTimestamp(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function colorWithAlpha(color, alpha) {
    const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
    const value = String(color || '').trim();
    const hexMatch = value.match(/^#([0-9a-f]{6})$/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
    }
    const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(',').map((entry) => entry.trim());
      if (parts.length >= 3) {
        return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${safeAlpha})`;
      }
    }
    return value;
  }

  function getSeriesColor(entry, index = 0) {
    return entry?.color || fallbackPalette[index % fallbackPalette.length];
  }

  function getSeriesType(entry) {
    const label = String(entry?.label || '').toLowerCase();
    if (label === 'pre-promo gate' || /pre-promotion/.test(label)) return 'pre-promotion';
    if (/^promotion vs g\d+$/.test(label)) return 'promotion';
    if (/^baseline vs g\d+$/.test(label)) return 'baseline';
    return 'other';
  }

  function getSeriesGeneration(entry) {
    const match = String(entry?.label || '').match(/g(\d+)/i);
    return match ? Number.parseInt(match[1], 10) : Number.NaN;
  }

  function assignSeriesColors(series = []) {
    const baselineSeries = series
      .filter((entry) => getSeriesType(entry) === 'baseline')
      .sort((left, right) => getSeriesGeneration(left) - getSeriesGeneration(right));
    const baselineColors = new Map(
      baselineSeries.map((entry, index) => [String(entry.label || ''), baselinePalette[index % baselinePalette.length]])
    );
    return series.map((entry, index) => {
      const type = getSeriesType(entry);
      let color = fallbackPalette[index % fallbackPalette.length];
      if (type === 'baseline') color = baselineColors.get(String(entry.label || '')) || baselinePalette[0];
      else if (type === 'pre-promotion') color = prePromotionColor;
      else if (type === 'promotion') color = promotionColor;
      return {
        ...entry,
        color,
      };
    });
  }

  function getCanvasCssSize() {
    const rect = canvas?.getBoundingClientRect();
    const attrWidth = Number.parseInt(canvas?.getAttribute('width') || '', 10);
    const attrHeight = Number.parseInt(canvas?.getAttribute('height') || '', 10);
    const fallbackWidth = state.canvasSize.width || attrWidth || 1200;
    const fallbackHeight = state.canvasSize.height || attrHeight || 460;
    return {
      width: Math.max(320, Math.round(rect?.width || fallbackWidth)),
      height: Math.max(280, Math.round(rect?.height || fallbackHeight)),
    };
  }

  function prepareCanvas(ctx) {
    if (!canvas || !ctx) return { width: 0, height: 0 };
    const { width, height } = getCanvasCssSize();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== pixelWidth) {
      canvas.width = pixelWidth;
    }
    if (canvas.height !== pixelHeight) {
      canvas.height = pixelHeight;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.canvasSize.width = width;
    state.canvasSize.height = height;
    return { width, height };
  }

  function selectGenerationTicks(generations = [], maxTicks = 10) {
    if (generations.length <= maxTicks) {
      return generations;
    }
    const ticks = [];
    const lastIndex = generations.length - 1;
    for (let index = 0; index < maxTicks; index += 1) {
      const sampleIndex = Math.round((index / Math.max(1, maxTicks - 1)) * lastIndex);
      const generation = generations[sampleIndex];
      if (ticks[ticks.length - 1] !== generation) {
        ticks.push(generation);
      }
    }
    return ticks;
  }

  function drawMarker(ctx, x, y, shape, color, radius) {
    const safeRadius = Math.max(6, Number(radius) || 6);
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(4, 12, 16, 0.9)';
    ctx.lineWidth = 2;

    if (shape === 'star') {
      const outerRadius = safeRadius + 1.5;
      const innerRadius = Math.max(4, safeRadius * 0.58);
      ctx.beginPath();
      for (let point = 0; point < 10; point += 1) {
        const angle = (-Math.PI / 2) + (point * Math.PI / 5);
        const currentRadius = point % 2 === 0 ? outerRadius : innerRadius;
        const px = x + (Math.cos(angle) * currentRadius);
        const py = y + (Math.sin(angle) * currentRadius);
        if (point === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }

    if (shape === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(x, y - safeRadius - 1);
      ctx.lineTo(x + safeRadius + 1, y);
      ctx.lineTo(x, y + safeRadius + 1);
      ctx.lineTo(x - safeRadius - 1, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }

    ctx.beginPath();
    ctx.arc(x, y, safeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function getHoverKey(entry) {
    const hover = entry?.point ? entry : { point: entry, label: entry?.label };
    const point = hover?.point || {};
    return [
      String(hover?.label || ''),
      Number(point?.candidateGeneration || 0),
      Number(point?.generation || 0),
      Number(point?.games || 0),
      point?.promoted ? 'promoted' : 'pending',
    ].join(':');
  }

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = prepareCanvas(ctx);

    ctx.fillStyle = '#08161b';
    ctx.fillRect(0, 0, width, height);

    const allPoints = state.series.flatMap((entry) => entry.points || []);
    if (!allPoints.length) {
      state.plot = null;
      ctx.fillStyle = '#93afa8';
      ctx.font = '600 24px Aptos';
      ctx.fillText('No generation evaluation history yet', 28, 52);
      if (legend) {
        legend.textContent = state.title
          ? `${state.title}: evaluations will appear after checkpoint matches complete.`
          : 'Evaluations will appear after checkpoint matches complete.';
      }
      renderEmptyTooltip();
      return;
    }

    const generations = Array.from(new Set(allPoints.map((point) => Number(point.candidateGeneration || 0))))
      .sort((left, right) => left - right);
    const margin = { top: 40, right: 34, bottom: 72, left: 70 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const minGeneration = Math.min(...generations);
    const maxGeneration = Math.max(...generations);
    const generationRange = Math.max(1, maxGeneration - minGeneration);
    const xForGeneration = (generation) => (
      margin.left + (((Number(generation || 0) - minGeneration) / generationRange) * plotW)
    );
    const yForWinRate = (winRate) => margin.top + ((1 - Math.max(0, Math.min(1, Number(winRate || 0)))) * plotH);

    ctx.strokeStyle = 'rgba(147, 175, 168, 0.22)';
    ctx.lineWidth = 1;
    ctx.font = '12px Aptos';
    ctx.fillStyle = '#93afa8';
    for (let tick = 0; tick <= 4; tick += 1) {
      const ratio = tick / 4;
      const y = margin.top + (plotH * ratio);
      const value = 1 - ratio;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(width - margin.right, y);
      ctx.stroke();
      ctx.fillText(`${Math.round(value * 100)}%`, 12, y + 4);
    }

    const xTicks = selectGenerationTicks(generations, 10);
    ctx.textAlign = 'center';
    xTicks.forEach((generation) => {
      const x = xForGeneration(generation);
      ctx.beginPath();
      ctx.moveTo(x, margin.top + plotH);
      ctx.lineTo(x, margin.top + plotH + 5);
      ctx.stroke();
      ctx.fillText(`G${generation}`, x, margin.top + plotH + 20);
    });
    ctx.textAlign = 'left';
    ctx.fillText('Win Rate', 12, 18);
    ctx.textAlign = 'center';
    ctx.fillText('Candidate Generation', margin.left + (plotW / 2), height - 18);
    ctx.textAlign = 'left';
    if (state.title) {
      ctx.fillStyle = '#edf4ef';
      ctx.font = '600 17px Aptos';
      ctx.fillText(state.title, margin.left, 22);
      ctx.fillStyle = '#93afa8';
      ctx.font = '12px Aptos';
    }

    const hoverPoints = [];

    state.series.forEach((entry, seriesIndex) => {
      const color = getSeriesColor(entry, seriesIndex);
      const markerFill = entry.lineStyle === 'none' ? colorWithAlpha(color, 0.72) : color;
      const points = (entry.points || [])
        .filter((point) => Number.isFinite(point?.candidateGeneration))
        .sort((left, right) => Number(left.candidateGeneration || 0) - Number(right.candidateGeneration || 0));
      if (!points.length) return;
      const shouldDrawLine = entry.lineStyle !== 'none';

      points.forEach((point, pointIndex) => {
        const x = xForGeneration(point.candidateGeneration);
        const y = yForWinRate(point.winRate);
        if (shouldDrawLine) {
          if (pointIndex === 0) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        const markerShape = point.markerShape || (point.promoted ? 'star' : 'circle');
        const radius = markerShape === 'star' ? 7 : (markerShape === 'diamond' ? 7 : 6);
        hoverPoints.push({
          key: getHoverKey({ point, label: entry.label }),
          x,
          y,
          point,
          color: markerFill,
          label: entry.label,
          radius,
          hitRadius: Math.max(DEFAULT_HIT_RADIUS, radius + 14),
          stickyRadius: Math.max(DEFAULT_STICKY_RADIUS, radius + 22),
        });
      });
      if (shouldDrawLine && points.length > 1) {
        ctx.stroke();
      }

      points.forEach((point) => {
        const x = xForGeneration(point.candidateGeneration);
        const y = yForWinRate(point.winRate);
        const markerShape = point.markerShape || (point.promoted ? 'star' : 'circle');
        const radius = markerShape === 'star' ? 7 : (markerShape === 'diamond' ? 7 : 6);
        drawMarker(ctx, x, y, markerShape, markerFill, radius);
      });
    });

    if (state.hover) {
      const currentHover = hoverPoints.find((entry) => entry.key === state.hover.key) || null;
      state.hover = currentHover;
    }

    if (state.hover) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(state.hover.x, margin.top);
      ctx.lineTo(state.hover.x, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(state.hover.x, state.hover.y, (state.hover.radius || 6) + 4, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      hideTooltip();
    }

    if (legend) {
      legend.innerHTML = state.series
        .map((entry, index) => {
          const color = getSeriesColor(entry, index);
          return `<span style="color:${color};">${entry.label}</span>`;
        })
        .join(' | ');
    }

    state.plot = {
      hoverPoints,
      margin,
      plotW,
      plotH,
    };
  }

  function showTooltip(hover) {
    if (!tooltip || !hover) {
      hideTooltip();
      return;
    }
    const seriesColors = new Map(
      (state.series || []).map((entry, index) => {
        const key = String(entry?.label || '');
        return [key, getSeriesColor(entry, index)];
      })
    );
    const sections = Array.isArray(hover.point.tooltipSections) && hover.point.tooltipSections.length
      ? hover.point.tooltipSections
      : [{
        title: hover.label,
        generation: hover.point.generation,
        winRate: hover.point.winRate,
        wins: hover.point.wins,
        losses: hover.point.losses,
        draws: hover.point.draws,
        games: hover.point.games,
        passed: hover.point.promoted ? true : null,
        requiredWinRate: null,
      }];
    const renderSection = (section) => {
      const title = String(section?.title || '');
      const isBaselineInfo = /(baseline|gen0)/i.test(title);
      const isPrePromotion = /pre-promotion/i.test(title);
      const generation = Number(section?.generation);
      const seriesLabel = isBaselineInfo
        ? `baseline vs G${generation}`
        : (isPrePromotion ? 'pre-promo gate' : `promotion vs G${generation}`);
      const sectionColor = seriesColors.get(seriesLabel)
        || (isBaselineInfo
          ? baselinePalette[0]
          : (isPrePromotion ? prePromotionColor : promotionColor));
      const bodyColor = '#d7efef';
      const sectionStyle = [
        'margin-top:6px',
        'padding:6px 8px',
        'border-radius:10px',
        `border:2px solid ${sectionColor}`,
        `background:${colorWithAlpha(sectionColor, 0.08)}`,
        `color:${bodyColor}`,
      ].join(';');
      const titleStyle = `color:${sectionColor};`;
      return `
        <div style="${sectionStyle}">
          <div style="${titleStyle}"><strong>${section.title}</strong>${Number.isFinite(Number(section.generation)) ? ` vs G${Number(section.generation)}` : ''}</div>
          <div>Win rate ${formatPercent(section.winRate)}</div>
          <div>${Number(section.wins || 0)}-${Number(section.losses || 0)}-${Number(section.draws || 0)} over ${Number(section.games || 0)} game(s)</div>
          ${section.passed === null ? '' : `<div>${section.passed ? 'Passed' : 'Failed'}${Number.isFinite(section.requiredWinRate) ? ` (need ${formatPercent(section.requiredWinRate)})` : ''}</div>`}
        </div>
      `;
    };
    tooltip.classList.remove('is-empty');
    const finishedAt = formatTimestamp(hover.point?.timestamp || null);
    tooltip.innerHTML = `
      <div class="chart-tooltip-title"><strong>Candidate G${hover.point.candidateGeneration}</strong></div>
      <div class="chart-tooltip-grid">${sections.map((section) => renderSection(section)).join('')}</div>
      <div class="chart-tooltip-footer">${[
        hover.point.promoted ? 'Promoted' : 'Not promoted',
        finishedAt ? `Finished ${finishedAt}` : '',
      ].filter(Boolean).join(' | ')}</div>
    `;
    tooltip.style.minHeight = '168px';
    tooltip.style.display = 'flex';
  }

  function onPointerMove(event) {
    if (!state.plot?.hoverPoints?.length || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    state.plot.hoverPoints.forEach((point) => {
      const dx = point.x - x;
      const dy = point.y - y;
      const distance = Math.sqrt((dx * dx) + (dy * dy));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    });
    if (!best || bestDistance > (best.hitRadius || DEFAULT_HIT_RADIUS)) {
      const stickyHover = state.hover
        ? state.plot.hoverPoints.find((point) => point.key === state.hover.key) || null
        : null;
      if (stickyHover) {
        const dx = stickyHover.x - x;
        const dy = stickyHover.y - y;
        const stickyDistance = Math.sqrt((dx * dx) + (dy * dy));
        if (stickyDistance <= (stickyHover.stickyRadius || stickyHover.hitRadius || DEFAULT_HIT_RADIUS)) {
          if (state.hover.key !== stickyHover.key) {
            state.hover = stickyHover;
            draw();
          }
          showTooltip(stickyHover);
          return;
        }
      }
      if (state.hover) {
        state.hover = null;
        draw();
      }
      hideTooltip();
      return;
    }
    if (!state.hover || state.hover.key !== best.key) {
      state.hover = best;
      draw();
    }
    showTooltip(best);
  }

  function onPointerLeave() {
    if (state.hover) {
      state.hover = null;
      draw();
    }
    hideTooltip();
  }

  canvas?.addEventListener('pointermove', onPointerMove);
  canvas?.addEventListener('pointerleave', onPointerLeave);
  renderEmptyTooltip();

  return {
    setData({ series = [], title = '' } = {}) {
      const nextSeries = assignSeriesColors(Array.isArray(series) ? series : []);
      const nextTitle = title || '';
      state.series = nextSeries;
      state.title = nextTitle;
      draw();
      if (!state.hover) {
        renderEmptyTooltip();
      }
    },
    clear() {
      state.series = [];
      state.title = '';
      state.hover = null;
      draw();
      renderEmptyTooltip();
    },
    redraw: draw,
  };
}
