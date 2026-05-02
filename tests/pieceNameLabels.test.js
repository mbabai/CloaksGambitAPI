const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const labelsUrl = pathToFileURL(
  path.join(ROOT, 'public', 'js', 'modules', 'render', 'pieceLabels.js')
).href;
const PIECE_GLYPH_PATH = path.join(ROOT, 'public', 'js', 'modules', 'render', 'pieceGlyph.js');
const BOARD_VIEW_PATH = path.join(ROOT, 'public', 'js', 'modules', 'components', 'boardView.js');
const BARS_PATH = path.join(ROOT, 'public', 'js', 'modules', 'render', 'bars.js');
const TOOLTIPS_PATH = path.join(ROOT, 'public', 'js', 'modules', 'ui', 'tooltips.js');
const UI_CSS_PATH = path.join(ROOT, 'public', 'ui.css');

describe('piece name labels', () => {
  let labels;

  beforeAll(async () => {
    labels = await import(labelsUrl);
  });

  test('maps piece identities to public identity names', () => {
    expect(labels.PIECE_DISPLAY_NAMES).toMatchObject({
      0: 'Unknown',
      1: 'Heart',
      2: 'Poison',
      3: 'Spear',
      4: 'Sword',
      5: 'Scythe'
    });
  });

  test('shared DOM glyph and board overlays render labels', () => {
    const glyphSource = fs.readFileSync(PIECE_GLYPH_PATH, 'utf8');
    const boardSource = fs.readFileSync(BOARD_VIEW_PATH, 'utf8');

    expect(glyphSource).toContain('cg-piece-name-label');
    expect(glyphSource).toContain('getPieceDisplayName');
    expect(boardSource).toContain('cg-board-piece-name-label');
    expect(boardSource).toContain('appendBoardPieceLabel');
  });

  test('captured strips keep labels disabled', () => {
    const barsSource = fs.readFileSync(BARS_PATH, 'utf8');

    expect(barsSource).toContain('showLabel: false');
  });

  test('piece labels are hidden until hover or keyboard focus', () => {
    const cssSource = fs.readFileSync(UI_CSS_PATH, 'utf8');

    expect(cssSource).toContain('opacity: 0;');
    expect(cssSource).toContain('.cg-piece-glyph:hover .cg-piece-name-label');
    expect(cssSource).toContain('.cg-board-hit-cell:hover .cg-board-piece-name-label');
    expect(cssSource).toContain('.cg-board-hit-cell:focus-visible .cg-board-piece-name-label');
  });

  test('tooltip preference disables piece name hover labels', () => {
    const cssSource = fs.readFileSync(UI_CSS_PATH, 'utf8');
    const tooltipSource = fs.readFileSync(TOOLTIPS_PATH, 'utf8');

    expect(tooltipSource).toContain('cg-tooltips-disabled');
    expect(tooltipSource).toContain('syncTooltipDocumentState');
    expect(cssSource).toContain('.cg-tooltips-disabled .cg-piece-glyph:hover .cg-piece-name-label');
    expect(cssSource).toContain('.cg-tooltips-disabled .cg-board-hit-cell:hover .cg-board-piece-name-label');
  });
});
