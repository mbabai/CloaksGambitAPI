const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ICONS_PATH = path.join(ROOT, 'public', 'js', 'modules', 'ui', 'icons.js');
const BOARD_VIEW_PATH = path.join(ROOT, 'public', 'js', 'modules', 'components', 'boardView.js');
const TOOLTIP_URL = require('url').pathToFileURL(
  path.join(ROOT, 'public', 'js', 'modules', 'ui', 'tooltipContent.js')
).href;

describe('procedural declaration bubbles', () => {
  test('bubble icons compose procedural backgrounds with identity art', () => {
    const source = fs.readFileSync(ICONS_PATH, 'utf8');

    expect(source).toContain('/assets/images/UI/Procedural');
    expect(source).toContain('BubbleSpeechLeft.svg');
    expect(source).toContain('BubbleThoughtLeft.svg');
    expect(source).toContain('BubbleThoughtRight.svg');
    expect(source).toContain('HeartIdentity.svg');
    expect(source).toContain('SwordIdentity.svg');
    expect(source).toContain('SpearIdentity.svg');
    expect(source).toContain('ScytheIdentity.svg');
    expect(source).toContain('PoisonIdentity.svg');
    expect(source).toContain('kind: \'proceduralBubble\'');
    expect(source).toContain('PROCEDURAL_BUBBLE_ICON_PLACEMENTS');
    expect(source).toContain('PROCEDURAL_BUBBLE_ICON_ADJUSTMENTS');
    expect(source).toContain('PROCEDURAL_BUBBLE_ICON_BOUNDS');
    expect(source).toContain('DECLARATION_BUBBLE_ICONS');
    expect(source).toContain('getVisualThemeConfig');
    expect(source).not.toContain('POISON_SPEECH_FILL');
    expect(source).not.toContain('drawSpeechLeftPathBackground');
    expect(source).not.toContain('iconTint');
    expect(source).not.toContain('backgroundTint');
    expect(source).not.toContain('drawTintedCanvasImage');
    expect(source).not.toContain('drawColorizedCanvasImage');
    expect(source).not.toContain('ctx.globalCompositeOperation = \'source-in\'');
    expect(source).not.toContain('ctx.globalCompositeOperation = \'destination-in\'');
    expect(source).toContain('applyBubbleIconFit');
    expect(source).toContain('drawProceduralBubbleCanvas');
    expect(source).toContain('document.createElement(\'canvas\')');
    expect(source).not.toContain('translate(-50%, -50%)');
  });

  test('board bubbles use the shared composed bubble visual', () => {
    const source = fs.readFileSync(BOARD_VIEW_PATH, 'utf8');

    expect(source).toContain('createBubbleVisual');
    expect(source).toContain('getCapturedBubbleAnchor');
    expect(source).toContain('overlay.attachToCaptured');
    expect(source).not.toContain('img.src = src');
  });

  test('fox mode renames declaration and challenge tooltip text', async () => {
    const { getThoughtBubbleTooltipText, getTooltipText } = await import(TOOLTIP_URL);

    expect(getThoughtBubbleTooltipText('kingThoughtRight', 'fox')).toBe('Declare this piece as a Fox.');
    expect(getThoughtBubbleTooltipText('bishopThoughtLeft', 'fox')).toBe('Declare this piece as a Hawk.');
    expect(getTooltipText('challengeButton', 'fox')).toContain('Investigate your opponent');
    expect(getTooltipText('daggerToken', 'fox')).toContain('"strike"');
    expect(getTooltipText('capturedPieces', 'fox')).toContain('1 Fox, 1 Poison Mushroom, 2 Vipers, 2 Hawks, 2 Bears');
  });
});
