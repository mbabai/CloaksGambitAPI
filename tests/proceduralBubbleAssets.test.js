const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ICONS_PATH = path.join(ROOT, 'public', 'js', 'modules', 'ui', 'icons.js');
const BOARD_VIEW_PATH = path.join(ROOT, 'public', 'js', 'modules', 'components', 'boardView.js');

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
    expect(source).toContain('POISON_SPEECH_FILL');
    expect(source).toContain('drawSpeechLeftPathBackground');
    expect(source).toContain('backgroundFill: declarationKey === \'bomb\' && placementKey === \'speechLeft\'');
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
});
