const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const SIZE_PRESETS = {
  auto: {
    width: { ratio: 0.32, min: 80, max: 160 },
    height: { ratio: 0.6, min: 48, max: 96, basis: 'width' },
    fontSize: { ratio: 0.28, min: 13, max: 20, basis: 'height' }
  },
  action: {
    width: { ratio: 0.4, min: 72, max: 160 },
    height: { ratio: 0.6, min: 44, max: 96, basis: 'width' },
    fontSize: { ratio: 0.28, min: 13, max: 20, basis: 'height' }
  },
  secondary: {
    width: { ratio: 0.26, min: 56, max: 140 },
    height: { ratio: 0.6, min: 40, max: 84, basis: 'width' },
    fontSize: { ratio: 0.3, min: 12, max: 18, basis: 'height' }
  },
  large: {
    width: { fixed: 160 },
    height: { fixed: 96 },
    fontSize: { fixed: 20 }
  }
};

const PALETTE_VARIANTS = {
  primary: 'var(--CG-purple-pressed)',
  danger: 'var(--CG-dark-red)',
  neutral: 'var(--CG-gray)',
  dark: 'var(--CG-black)'
};

function resolvePreset(name) {
  if (typeof name === 'string' && SIZE_PRESETS[name]) return SIZE_PRESETS[name];
  return SIZE_PRESETS.auto;
}

function resolvePalette(variant, background) {
  if (background) return background;
  if (variant && PALETTE_VARIANTS[variant]) return PALETTE_VARIANTS[variant];
  return PALETTE_VARIANTS.primary;
}

function resolveMeasurement(spec, { baseRef, width, height }) {
  if (!spec) return null;
  if (typeof spec.fixed === 'number') return spec.fixed;
  const basisValue = spec.basis === 'height' ? height : spec.basis === 'width' ? width : baseRef;
  if (!basisValue || !Number.isFinite(basisValue)) return null;
  const computed = Math.round(basisValue * (spec.ratio || 1));
  const min = typeof spec.min === 'number' ? spec.min : computed;
  const max = typeof spec.max === 'number' ? spec.max : computed;
  return clamp(computed, min, max);
}

export function createButton({
  id,
  label,
  variant,
  background,
  width,
  height,
  fontSize,
  left,
  top,
  zIndex = 5,
  onClick
}) {
  const btn = document.createElement('button');
  if (id) btn.id = id;
  btn.type = 'button';
  btn.textContent = label ?? '';
  btn.classList.add('cg-button');
  if (variant) {
    btn.classList.add(`cg-button--${variant}`);
  }
  btn.style.position = 'absolute';
  if (typeof left === 'number') btn.style.left = Math.floor(left) + 'px';
  if (typeof top === 'number') btn.style.top = Math.floor(top) + 'px';
  if (typeof width === 'number') btn.style.width = Math.round(width) + 'px';
  if (typeof height === 'number') btn.style.height = Math.round(height) + 'px';
  const palette = resolvePalette(variant, background);
  const hasVariant = Boolean(variant && PALETTE_VARIANTS[variant]);
  if (!hasVariant || background) {
    btn.style.setProperty('--cg-button-background', palette);
  }
  if (typeof fontSize === 'number') btn.style.fontSize = Math.round(fontSize) + 'px';
  btn.style.zIndex = String(zIndex);
  btn.dataset.cgButtonVariant = variant || '';
  if (typeof onClick === 'function') btn.addEventListener('click', onClick);
  return btn;
}

export function renderButton({
  id,
  root,
  label,
  variant,
  background,
  visible = true,
  onClick,
  boardLeft = 0,
  boardTop = 0,
  boardWidth = 0,
  boardHeight = 0,
  size = 'auto',
  sizeBasis,
  width,
  height,
  fontSize,
  zIndex
}) {
  const existing = id ? document.getElementById(id) : null;
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  if (!visible) return null;
  if (!root) return null;

  const preset = resolvePreset(size);
  const dims = [];
  if (typeof sizeBasis === 'number' && sizeBasis > 0) {
    dims.push(sizeBasis);
  } else {
    if (typeof boardWidth === 'number' && boardWidth > 0) dims.push(boardWidth);
    if (typeof boardHeight === 'number' && boardHeight > 0) dims.push(boardHeight);
    if (root) {
      const rootWidth = root.clientWidth || 0;
      const rootHeight = root.clientHeight || 0;
      if (rootWidth) dims.push(rootWidth);
      if (rootHeight) dims.push(rootHeight);
    }
  }
  const baseRef = dims.length ? Math.max(...dims) : 320;

  const resolvedWidth = typeof width === 'number' && !Number.isNaN(width)
    ? width
    : resolveMeasurement(preset.width, { baseRef });

  const resolvedHeight = typeof height === 'number' && !Number.isNaN(height)
    ? height
    : resolveMeasurement(preset.height, { baseRef, width: resolvedWidth });

  const resolvedFontSize = typeof fontSize === 'number' && !Number.isNaN(fontSize)
    ? fontSize
    : resolveMeasurement(preset.fontSize, { baseRef, width: resolvedWidth, height: resolvedHeight });

  const left = Math.floor(boardLeft + (boardWidth / 2) - (resolvedWidth / 2));
  const top = Math.floor(boardTop + (boardHeight / 2) - (resolvedHeight / 2));

  const button = createButton({
    id,
    label,
    variant,
    background,
    width: resolvedWidth,
    height: resolvedHeight,
    fontSize: resolvedFontSize,
    left,
    top,
    zIndex,
    onClick
  });

  root.appendChild(button);
  return button;
}

export const BUTTON_PRESETS = Object.freeze({ ...SIZE_PRESETS });
export const BUTTON_VARIANTS = Object.freeze({ ...PALETTE_VARIANTS });
