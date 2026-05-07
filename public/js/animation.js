import { ASSET_MANIFEST } from '/js/shared/assetManifest.js';
import { IDENTITIES, PIECE_IMAGES } from '/js/modules/constants.js';
import { pieceGlyph } from '/js/modules/render/pieceGlyph.js';
import { createBubbleVisual, createChallengeBubble, createDaggerToken, createThroneIcon, createDrawIcon } from '/js/modules/ui/icons.js';

const PIECE_COUNT = 5;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ARROW_FILL = 'rgba(196, 151, 255, 0.8)';
const UNKNOWN_IDENTITY = Number.isInteger(IDENTITIES?.UNKNOWN) ? IDENTITIES.UNKNOWN : 0;
const WHITE = 0;
const BLACK = 1;
const KING_ARROW_DIRECTIONS = Object.freeze([
  { row: -1, col: 0 },
  { row: -1, col: 1 },
  { row: 0, col: 1 },
  { row: 1, col: 1 },
  { row: 1, col: 0 },
  { row: 1, col: -1 },
  { row: 0, col: -1 },
  { row: -1, col: -1 },
]);
const STRAIGHT_DIRECTIONS = Object.freeze([
  { row: -1, col: 0 },
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
]);
const DIAGONAL_DIRECTIONS = Object.freeze([
  { row: -1, col: 1 },
  { row: 1, col: 1 },
  { row: 1, col: -1 },
  { row: -1, col: -1 },
]);
const KNIGHT_DIRECTIONS = Object.freeze([
  { row: -2, col: 1 },
  { row: -1, col: 2 },
  { row: 1, col: 2 },
  { row: 2, col: 1 },
  { row: 2, col: -1 },
  { row: 1, col: -2 },
  { row: -1, col: -2 },
  { row: -2, col: -1 },
]);
const SCYTHE_WHITE_DIRECTION = Object.freeze({ row: -1, col: 2 });
const SCYTHE_BLACK_DIRECTION = Object.freeze({ row: -2, col: -1 });
const SCYTHE_ROW_BLOCKERS = Object.freeze([
  { row: -1, col: -1 },
  { row: -1, col: 0 },
  { row: -1, col: 1 },
]);
const DECLARED_MOVE_SEQUENCE = Object.freeze([
  {
    key: 'sword',
    declaration: IDENTITIES.ROOK,
    bubbleType: 'rookSpeechLeft',
    direction: { row: -2, col: 0 },
  },
  {
    key: 'scythe',
    declaration: IDENTITIES.KNIGHT,
    bubbleType: 'knightSpeechLeft',
    direction: { row: -2, col: 1 },
  },
  {
    key: 'spear',
    declaration: IDENTITIES.BISHOP,
    bubbleType: 'bishopSpeechLeft',
    direction: { row: -2, col: -2 },
  },
]);
const THOUGHT_MOVE_SEQUENCE = Object.freeze([
  {
    key: 'heartSpear',
    initialBubbleTypes: [],
    bubbleTypes: ['kingThoughtRight', 'bishopThoughtLeft'],
    bubbleSwitchProgress: 0.5,
    fromDirection: { row: 0, col: 0 },
    toDirection: { row: -1, col: 1 },
  },
  {
    key: 'heartSword',
    bubbleTypes: ['kingThoughtRight', 'rookThoughtLeft'],
    initialBubbleTypes: ['kingThoughtRight', 'bishopThoughtLeft'],
    bubbleSwitchProgress: 0.5,
    fromDirection: { row: -1, col: 1 },
    toDirection: { row: -1, col: 0 },
  },
  {
    key: 'scythe',
    initialBubbleTypes: ['kingThoughtRight', 'rookThoughtLeft'],
    bubbleTypes: ['knightThoughtLeft'],
    bubbleSwitchProgress: 0.5,
    fromDirection: { row: -1, col: 0 },
    toDirection: { row: -2, col: -1 },
  },
  {
    key: 'spearHeart',
    bubbleTypes: ['kingThoughtRight', 'bishopThoughtLeft'],
    initialBubbleTypes: ['knightThoughtLeft'],
    bubbleSwitchProgress: 0.5,
    fromDirection: { row: -2, col: -1 },
    toDirection: { row: -1, col: -1 },
  },
]);
const CHAPTERS = Object.freeze([
  { key: 'identities', label: 'Identities' },
  { key: 'cloakMovement', label: 'Cloak Movement' },
  { key: 'capturesPoison', label: 'Captures & Poison' },
  { key: 'setup', label: 'Set Up' },
  { key: 'samplePlay', label: 'Sample Play' },
  { key: 'winning', label: 'Winning' },
]);
const REVEAL_IDENTITIES = [
  IDENTITIES.KING,
  IDENTITIES.ROOK,
  IDENTITIES.BISHOP,
  IDENTITIES.KNIGHT,
  IDENTITIES.BOMB,
];
const SETUP_ORIGINAL_IDENTITIES = Object.freeze([
  IDENTITIES.KING,
  IDENTITIES.ROOK,
  IDENTITIES.BISHOP,
  IDENTITIES.KNIGHT,
  IDENTITIES.BOMB,
]);
const SETUP_EXPANDED_IDENTITIES = Object.freeze([
  IDENTITIES.KING,
  IDENTITIES.ROOK,
  IDENTITIES.BISHOP,
  IDENTITIES.KNIGHT,
  IDENTITIES.BOMB,
  IDENTITIES.ROOK,
  IDENTITIES.BISHOP,
  IDENTITIES.KNIGHT,
]);
const SETUP_BOARD_SLOT_IDENTITIES = Object.freeze([
  IDENTITIES.BISHOP,
  IDENTITIES.BISHOP,
  IDENTITIES.KING,
  IDENTITIES.ROOK,
  IDENTITIES.ROOK,
]);
const SETUP_SHUFFLE_SWAPS = Object.freeze([
  [2, 1],
  [0, 6],
  [3, 7],
  [1, 4],
  [5, 6],
  [4, 0],
  [7, 3],
  [1, 2],
  [6, 5],
  [2, 4],
]);
const WINNING_WHITE_PIECES = Object.freeze([
  { id: 'w0', identity: IDENTITIES.KING, row: 5, col: 0 },
  { id: 'w6', identity: IDENTITIES.BISHOP, row: 5, col: 1 },
  { id: 'w3', identity: IDENTITIES.KNIGHT, row: 5, col: 2 },
  { id: 'w1', identity: IDENTITIES.ROOK, row: 5, col: 3 },
  { id: 'w5', identity: IDENTITIES.ROOK, row: 5, col: 4 },
  { id: 'w4', identity: IDENTITIES.BOMB, location: 'deck' },
  { id: 'w2', identity: IDENTITIES.BISHOP, location: 'stash', stashIndex: 0 },
  { id: 'w7', identity: IDENTITIES.KNIGHT, location: 'stash', stashIndex: 1 },
]);
const WINNING_BLACK_PIECES = Object.freeze([
  { id: 'b0', identity: IDENTITIES.ROOK, row: 0, col: 0 },
  { id: 'b1', identity: IDENTITIES.BISHOP, row: 0, col: 1 },
  { id: 'b2', identity: IDENTITIES.KNIGHT, row: 0, col: 2 },
  { id: 'b3', identity: IDENTITIES.ROOK, row: 0, col: 3 },
  { id: 'b4', identity: IDENTITIES.BOMB, row: 0, col: 4 },
]);
const WINNING_MOVE_SEQUENCE = Object.freeze([
  { pieceId: 'w0', to: { row: 4, col: 0 }, declaration: IDENTITIES.KING },
  { pieceId: 'b0', to: { row: 2, col: 0 }, declaration: IDENTITIES.ROOK },
  {
    pieceId: 'w6',
    to: { row: 4, col: 2 },
    declaration: IDENTITIES.BISHOP,
    challenge: { challenger: BLACK, failed: true, deckIn: 'w4', deckOut: 'w2' },
  },
  { pieceId: 'b1', to: { row: 1, col: 2 }, declaration: IDENTITIES.BISHOP },
  { pieceId: 'w0', to: { row: 3, col: 0 }, declaration: IDENTITIES.KING },
  { pieceId: 'b2', to: { row: 2, col: 1 }, declaration: IDENTITIES.KNIGHT },
  {
    pieceId: 'w1',
    to: { row: 3, col: 3 },
    declaration: IDENTITIES.ROOK,
    challenge: { challenger: BLACK, failed: true, deckIn: 'w2', deckOut: 'w6' },
  },
  { pieceId: 'b4', to: { row: 1, col: 4 }, declaration: IDENTITIES.KING },
  { pieceId: 'w0', to: { row: 2, col: 0 }, declaration: IDENTITIES.KING, capture: true },
  { pieceId: 'b2', to: { row: 3, col: 3 }, declaration: IDENTITIES.KNIGHT, capture: true },
  { pieceId: 'w0', to: { row: 1, col: 0 }, declaration: IDENTITIES.KING },
  { pieceId: 'b1', to: { row: 3, col: 4 }, declaration: IDENTITIES.BISHOP },
  { pieceId: 'w5', to: { row: 3, col: 4 }, declaration: IDENTITIES.ROOK, capture: true },
  { pieceId: 'b3', to: { row: 1, col: 1 }, declaration: IDENTITIES.KNIGHT },
]);
const WINNING_DRAW_MOVE_SEQUENCE = Object.freeze([
  { pieceId: 'b4', to: { row: 2, col: 4 }, declaration: IDENTITIES.KING },
  { pieceId: 'w4', to: { row: 4, col: 1 }, declaration: IDENTITIES.ROOK },
  { pieceId: 'b3', to: { row: 2, col: 3 }, declaration: IDENTITIES.KNIGHT },
  { pieceId: 'w0', to: { row: 2, col: 0 }, declaration: IDENTITIES.KING },
  { pieceId: 'b2', to: { row: 4, col: 3 }, declaration: IDENTITIES.ROOK },
  { pieceId: 'w5', to: { row: 3, col: 2 }, declaration: IDENTITIES.ROOK },
  { pieceId: 'b4', to: { row: 3, col: 4 }, declaration: IDENTITIES.ROOK },
  { pieceId: 'w3', to: { row: 4, col: 4 }, declaration: IDENTITIES.KNIGHT },
  { pieceId: 'b3', to: { row: 0, col: 2 }, declaration: IDENTITIES.KNIGHT },
  { pieceId: 'w4', to: { row: 3, col: 1 }, declaration: IDENTITIES.ROOK },
  { pieceId: 'b2', to: { row: 4, col: 2 }, declaration: IDENTITIES.ROOK },
  { pieceId: 'w0', to: { row: 2, col: 1 }, declaration: IDENTITIES.KING },
  { pieceId: 'b4', to: { row: 2, col: 4 }, declaration: IDENTITIES.ROOK },
  { pieceId: 'w5', to: { row: 2, col: 2 }, declaration: IDENTITIES.ROOK },
  { pieceId: 'b3', to: { row: 1, col: 4 }, declaration: IDENTITIES.KNIGHT },
  { pieceId: 'w3', to: { row: 5, col: 4 }, declaration: IDENTITIES.KING },
  { pieceId: 'b2', to: { row: 4, col: 3 }, declaration: IDENTITIES.ROOK },
  { pieceId: 'w4', to: { row: 4, col: 0 }, declaration: IDENTITIES.BISHOP },
  { pieceId: 'b4', to: { row: 2, col: 3 }, declaration: IDENTITIES.ROOK },
  { pieceId: 'w0', to: { row: 1, col: 0 }, declaration: IDENTITIES.KING },
]);
const TIMELINE = Object.freeze({
  fadeStartDelay: 240,
  fadeStagger: 300,
  fadeDuration: 780,
  pauseAfterFade: 900,
  flipStagger: 280,
  flipHalfDuration: 260,
  pauseAfterFlip: 700,
  spreadDuration: 1300,
  pauseBeforeKingArrows: 250,
  arrowStagger: 210,
  arrowDuration: 420,
  pauseAfterKingArrows: 450,
  whiteSlideDuration: 760,
  heartProbeDuration: 420,
  heartReturnDuration: 420,
  heartShakeDuration: 520,
  blackSlideDuration: 720,
  pauseBeforeCapture: 520,
  captureSlideDuration: 760,
  captureHoldDuration: 620,
  blackFadeDuration: 500,
  finalResetDuration: 920,
  swapToLinePieceDelay: 360,
  linePieceSwapDuration: 900,
  lineArrowDelay: 420,
  lineArrowDirectionStagger: 170,
  lineArrowStepDuration: 220,
  lineArrowStepPause: 70,
  lineBlockerDelay: 520,
  lineBlockerSlideDuration: 760,
  lineBlockerHoldDuration: 720,
  lineClearDuration: 820,
  poisonFlipPause: 1000,
  declaredMoveDuration: 760,
  declaredMoveHoldDuration: 700,
  declaredMoveFadeDuration: 420,
  declaredMoveResetDuration: 520,
  thoughtMoveDuration: 720,
  thoughtMoveHoldDuration: 760,
  cursorApproachDelay: 220,
  cursorApproachDuration: 900,
  cursorClickDuration: 280,
  cursorExitDuration: 500,
  finalSpeechHoldDuration: 760,
  challengeButtonDelay: 520,
  challengeButtonSlideDuration: 620,
  challengeButtonHoldDuration: 560,
  challengeCursorApproachDuration: 760,
  challengeCursorClickDuration: 260,
  challengeCursorExitDuration: 360,
  challengeBubbleFadeDuration: 980,
  challengeFlipDuration: 520,
  challengeTiltDuration: 420,
  challengeFadeDuration: 1200,
  rewindDelay: 650,
  rewindRestoreDuration: 900,
  rewindFlipDuration: 520,
  rewindHoldDuration: 800,
  secondChallengeDelay: 520,
  secondRevealHoldDuration: 760,
  finalPieceSlideDuration: 900,
  swordSlideDuration: 900,
  swordFlipDuration: 520,
  finalBubbleFadeDuration: 420,
  daggerSlotsLeadDuration: 900,
  daggerSlideDuration: 760,
  daggerFlashDuration: 900,
  finalSwordHoldDuration: 700,
  captureClearFadeDuration: 640,
  captureReturnDuration: 900,
  captureRevealPause: 300,
  captureBlackSlideDuration: 760,
  captureBlackHoldDuration: 720,
  captureAttackSlideDuration: 920,
  captureThoughtHoldDuration: 620,
  captureDeclareDuration: 420,
  captureDeclareHoldDuration: 640,
  captureChallengeDelay: 520,
  captureChallengeHoverDuration: 640,
  capturePoisonButtonDelay: 420,
  capturePoisonButtonSlideDuration: 420,
  capturePoisonButtonHoldDuration: 520,
  captureCursorMoveDuration: 620,
  capturePoisonOutcomeDuration: 520,
  capturePoisonOutcomeHoldDuration: 1000,
  captureButtonSwapDelay: 360,
  capturePassButtonSlideDuration: 520,
  capturePassHoldDuration: 560,
  capturePassFadeDuration: 900,
  capturePostRewindHoldDuration: 620,
  captureChallengeResolveDuration: 720,
  captureDaggerSlotsLeadDuration: 680,
  captureDaggerHoldDuration: 800,
  captureDaggerRewindDuration: 900,
  captureScytheResolveDuration: 760,
  captureScytheHoldDuration: 720,
  captureScytheFadeDuration: 620,
  captureFinalDaggerHoldDuration: 900,
  captureFinalRewindDuration: 900,
  captureHeartRecaptureHoldDuration: 1200,
  captureHeartDeclareDuration: 420,
  captureHeartDeclareHoldDuration: 680,
  captureHeartPoisonFadeDuration: 900,
  setupWipeDuration: 900,
  setupOriginalSlideDuration: 1000,
  setupDuplicateDuration: 820,
  setupBoardMorphDuration: 1200,
  setupDeckGrowDuration: 520,
  setupLinesDuration: 620,
  setupPlacementPause: 520,
  setupHeartPlaceDuration: 720,
  setupPiecePlaceDuration: 520,
  setupPiecePlaceStagger: 130,
  setupPoisonPlaceDuration: 620,
  setupShufflePause: 600,
  setupShuffleSwapDuration: 620,
  setupShuffleSwapPause: 90,
  setupHoldDuration: 900,
  winningFadeDuration: 520,
  winningStashSlideDuration: 860,
  winningDaggerSlotsDelay: 180,
  winningDaggerSlotsFadeDuration: 520,
  winningMoveSequenceDelay: 520,
  winningMoveDuration: 580,
  winningMoveHoldDuration: 220,
  winningMovePause: 130,
  winningCaptureTiltDuration: 260,
  winningCapturePauseDuration: 340,
  winningCaptureDisplayDuration: 520,
  winningChallengeDelay: 260,
  winningChallengeRevealDuration: 420,
  winningOnDeckSwapDuration: 640,
  winningOnDeckReplaceDelay: 360,
  winningOnDeckReplaceDuration: 560,
  winningStashReflowDuration: 420,
  winningDaggerFillDuration: 520,
  winningHoldDuration: 900,
  winningFinaleIntroDelay: 420,
  winningFinaleChallengeHoldDuration: 760,
  winningFinaleRevealDuration: 520,
  winningFinaleRevealHoldDuration: 360,
  winningFinaleCaptureSlideDuration: 720,
  winningFinaleThroneDelay: 260,
  winningFinaleThroneDuration: 620,
  winningFinaleHoldDuration: 1200,
  winningFinaleRewindDuration: 980,
  winningFinaleRewindHoldDuration: 700,
  winningFinaleSecondMoveDelay: 520,
  winningFinaleSecondMoveDuration: 620,
  winningFinaleSecondChallengeHoldDuration: 760,
  winningFinaleSecondRevealDuration: 520,
  winningFinaleThirdDaggerDuration: 520,
  winningFinaleThirdMoveDelay: 520,
  winningFinaleThirdMoveDuration: 620,
  winningFinaleThirdChallengeHoldDuration: 760,
  winningFinaleThirdRevealDuration: 520,
  winningFinaleThirdSwapDelay: 280,
  winningFinaleThirdSwapDuration: 740,
  winningFinaleCrownMoveDelay: 520,
  winningFinaleCrownMoveDuration: 720,
  winningFinaleCrownHoldDuration: 1400,
  winningFinaleDrawMoveDelay: 620,
  winningFinaleDrawMoveHoldDuration: 120,
  winningFinaleDrawIconDelay: 560,
  winningFinaleDrawIconDuration: 620,
  winningFinaleDrawHoldDuration: 1300,
});

const canvas = document.getElementById('animationBoard');
let arrowSvg = document.getElementById('animationArrows');
let topArrowSvg = document.getElementById('animationTopArrows');
let underArrowActorStage = document.getElementById('animationUnderArrowActors');
let actorStage = document.getElementById('animationActors');
const pieceStage = document.getElementById('animationPieces');
let speedInput = document.getElementById('animationSpeed');
let speedValue = document.getElementById('animationSpeedValue');
let zoomInput = document.getElementById('animationZoom');
let zoomValue = document.getElementById('animationZoomValue');
let playPauseButton = document.getElementById('animationPlayPause');
let chapterControls = document.getElementById('animationChapters');
const textureSrc = ASSET_MANIFEST?.textures?.boardMarble || '/assets/images/MarbleTexture.svg';
const textureImage = new Image();
let textureLoaded = false;
let layout = null;
ensureArrowLayer();
ensureTopArrowLayer();
ensureUnderArrowActorLayer();
ensureActorLayer();
ensureHudControls();
let animationSpeed = readSpeed();
let animationZoom = readZoom();
let virtualTime = 0;
let lastFrameAt = performance.now();
let animationFrameId = null;
let lastRenderedTime = -1;
let isPlaying = true;
let activeChapterKey = getInitialChapterKey();

textureImage.onload = () => {
  textureLoaded = true;
  drawBoard();
};
textureImage.src = textureSrc;

function ensureArrowLayer() {
  if (arrowSvg) {
    arrowSvg.classList.add('animation-arrows');
    arrowSvg.setAttribute('aria-hidden', 'true');
    return arrowSvg;
  }
  arrowSvg = createSvgElement('svg');
  arrowSvg.id = 'animationArrows';
  arrowSvg.classList.add('animation-arrows');
  arrowSvg.setAttribute('aria-hidden', 'true');
  const scene = document.querySelector('.animation-scene');
  if (scene) {
    const pieces = document.getElementById('animationPieces');
    scene.insertBefore(arrowSvg, pieces || null);
  } else {
    document.body.appendChild(arrowSvg);
  }
  return arrowSvg;
}

function ensureTopArrowLayer() {
  if (topArrowSvg) {
    topArrowSvg.classList.add('animation-top-arrows');
    topArrowSvg.setAttribute('aria-hidden', 'true');
    return topArrowSvg;
  }
  topArrowSvg = createSvgElement('svg');
  topArrowSvg.id = 'animationTopArrows';
  topArrowSvg.classList.add('animation-top-arrows');
  topArrowSvg.setAttribute('aria-hidden', 'true');
  const scene = document.querySelector('.animation-scene');
  if (scene) {
    const pieces = document.getElementById('animationPieces');
    scene.insertBefore(topArrowSvg, pieces || null);
  } else {
    document.body.appendChild(topArrowSvg);
  }
  return topArrowSvg;
}

function ensureActorLayer() {
  if (actorStage) {
    actorStage.classList.add('animation-actors');
    actorStage.setAttribute('aria-hidden', 'true');
    return actorStage;
  }
  actorStage = document.createElement('div');
  actorStage.id = 'animationActors';
  actorStage.className = 'animation-actors';
  actorStage.setAttribute('aria-hidden', 'true');
  const scene = document.querySelector('.animation-scene');
  if (scene) {
    const pieces = document.getElementById('animationPieces');
    scene.insertBefore(actorStage, pieces || null);
  } else {
    document.body.appendChild(actorStage);
  }
  return actorStage;
}

function ensureUnderArrowActorLayer() {
  if (underArrowActorStage) {
    underArrowActorStage.classList.add('animation-under-arrow-actors');
    underArrowActorStage.setAttribute('aria-hidden', 'true');
    return underArrowActorStage;
  }
  underArrowActorStage = document.createElement('div');
  underArrowActorStage.id = 'animationUnderArrowActors';
  underArrowActorStage.className = 'animation-under-arrow-actors';
  underArrowActorStage.setAttribute('aria-hidden', 'true');
  const scene = document.querySelector('.animation-scene');
  if (scene) {
    const topArrows = document.getElementById('animationTopArrows');
    scene.insertBefore(underArrowActorStage, topArrows || null);
  } else {
    document.body.appendChild(underArrowActorStage);
  }
  return underArrowActorStage;
}

function ensureHudControls() {
  let hud = document.querySelector('.animation-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.className = 'animation-hud';
    document.body.appendChild(hud);
  }

  if (!chapterControls) {
    chapterControls = document.createElement('div');
    chapterControls.id = 'animationChapters';
    chapterControls.className = 'animation-chapters';
    chapterControls.setAttribute('aria-label', 'Animation chapters');
  }
  CHAPTERS.forEach((chapter) => {
    let button = chapterControls.querySelector(`[data-chapter="${chapter.key}"]`);
    if (!button) {
      button = document.createElement('button');
      button.className = 'animation-chapter-button';
      button.type = 'button';
      button.dataset.chapter = chapter.key;
    }
    button.textContent = chapter.label;
    chapterControls.appendChild(button);
  });
  if (chapterControls.parentElement !== hud) {
    hud.prepend(chapterControls);
  }

  if (!playPauseButton) {
    playPauseButton = document.createElement('button');
    playPauseButton.id = 'animationPlayPause';
    playPauseButton.className = 'animation-play-pause';
    playPauseButton.type = 'button';
    playPauseButton.setAttribute('aria-label', 'Pause animation');
  }
  if (playPauseButton.parentElement !== hud) {
    hud.prepend(playPauseButton);
  }

  let controls = document.querySelector('.animation-controls');
  if (!controls) {
    controls = document.createElement('div');
    controls.className = 'animation-controls';
  }

  const zoomGroup = ensureControlGroup(controls, 'animationZoomGroup', 'animationZoom', 'Zoom');
  if (!zoomInput) {
    zoomInput = document.createElement('input');
    zoomInput.id = 'animationZoom';
    zoomInput.className = 'animation-slider animation-zoom';
    zoomInput.type = 'range';
    zoomInput.min = '0.55';
    zoomInput.max = '1.2';
    zoomInput.step = '0.05';
    zoomInput.value = '0.8';
    zoomInput.setAttribute('aria-label', 'Animation zoom');
  }
  if (zoomInput.parentElement !== zoomGroup) {
    zoomGroup.appendChild(zoomInput);
  }

  if (!zoomValue) {
    zoomValue = document.createElement('output');
    zoomValue.id = 'animationZoomValue';
    zoomValue.className = 'animation-slider-value';
    zoomValue.htmlFor = 'animationZoom';
    zoomValue.textContent = '0.8x';
  }
  if (zoomValue.parentElement !== zoomGroup) {
    zoomGroup.appendChild(zoomValue);
  }

  const speedGroup = ensureControlGroup(controls, 'animationSpeedGroup', 'animationSpeed', 'Speed');
  if (!speedInput) {
    speedInput = document.createElement('input');
    speedInput.id = 'animationSpeed';
    speedInput.className = 'animation-slider animation-speed';
    speedInput.type = 'range';
    speedInput.min = '0.25';
    speedInput.max = '3';
    speedInput.step = '0.05';
    speedInput.value = '1';
    speedInput.setAttribute('aria-label', 'Animation speed');
  }
  if (speedInput.parentElement !== speedGroup) {
    speedGroup.appendChild(speedInput);
  }

  if (!speedValue) {
    speedValue = document.createElement('output');
    speedValue.id = 'animationSpeedValue';
    speedValue.className = 'animation-slider-value animation-speed-value';
    speedValue.htmlFor = 'animationSpeed';
    speedValue.textContent = '1x';
  }
  if (speedValue.parentElement !== speedGroup) {
    speedGroup.appendChild(speedValue);
  }

  if (controls.parentElement !== hud) {
    hud.appendChild(controls);
  }
}

function ensureControlGroup(controls, id, inputId, labelText) {
  let group = document.getElementById(id);
  if (!group) {
    group = document.createElement('label');
    group.id = id;
    group.className = 'animation-control-group';
    group.htmlFor = inputId;
    const label = document.createElement('span');
    label.className = 'animation-control-label';
    label.textContent = labelText;
    group.appendChild(label);
  }
  if (group.parentElement !== controls) {
    controls.appendChild(group);
  }
  return group;
}

function readSpeed() {
  const value = Number(speedInput?.value);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function readZoom() {
  const value = Number(zoomInput?.value);
  return Number.isFinite(value) && value > 0 ? value : 0.8;
}

function getInitialChapterKey() {
  try {
    const candidate = new URLSearchParams(window.location.search).get('chapter');
    return CHAPTERS.some((chapter) => chapter.key === candidate) ? candidate : CHAPTERS[0].key;
  } catch (_) {
    return CHAPTERS[0].key;
  }
}

function applyInitialSpeedFromUrl() {
  if (!speedInput) return;
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('speed')) return;
    const raw = Number(params.get('speed'));
    if (!Number.isFinite(raw)) return;
    const min = Number(speedInput.min) || 0.25;
    const max = Number(speedInput.max) || 3;
    speedInput.value = String(Math.min(max, Math.max(min, raw)));
  } catch (_) {
    // Ignore malformed browser URLs and keep the HUD default.
  }
}

function applyInitialZoomFromUrl() {
  if (!zoomInput) return;
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('zoom')) return;
    const raw = Number(params.get('zoom'));
    if (!Number.isFinite(raw)) return;
    const min = Number(zoomInput.min) || 0.55;
    const max = Number(zoomInput.max) || 1.2;
    zoomInput.value = String(Math.min(max, Math.max(min, raw)));
  } catch (_) {
    // Ignore malformed browser URLs and keep the HUD default.
  }
}

function formatSpeed(value) {
  return `${Number(value).toFixed(2).replace(/\.?0+$/, '')}x`;
}

function updateSpeed() {
  animationSpeed = readSpeed();
  if (speedValue) {
    speedValue.value = formatSpeed(animationSpeed);
    speedValue.textContent = speedValue.value;
  }
}

function updateZoom() {
  animationZoom = readZoom();
  if (zoomValue) {
    zoomValue.value = formatSpeed(animationZoom);
    zoomValue.textContent = zoomValue.value;
  }
  render();
}

if (speedInput) {
  applyInitialSpeedFromUrl();
  speedInput.addEventListener('input', updateSpeed);
  updateSpeed();
}

if (zoomInput) {
  applyInitialZoomFromUrl();
  zoomInput.addEventListener('input', updateZoom);
  animationZoom = readZoom();
  if (zoomValue) {
    zoomValue.value = formatSpeed(animationZoom);
    zoomValue.textContent = zoomValue.value;
  }
}

function updatePlayPauseButton() {
  if (!playPauseButton) return;
  playPauseButton.setAttribute('aria-label', isPlaying ? 'Pause animation' : 'Play animation');
  playPauseButton.replaceChildren();
  const icon = document.createElement('span');
  icon.className = isPlaying ? 'animation-pause-icon' : 'animation-play-icon';
  icon.setAttribute('aria-hidden', 'true');
  playPauseButton.appendChild(icon);
}

function pauseAnimation() {
  if (!isPlaying) return;
  isPlaying = false;
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  updatePlayPauseButton();
}

function playAnimation() {
  if (isPlaying) return;
  isPlaying = true;
  updatePlayPauseButton();
  startAnimation();
}

function togglePlayback() {
  if (isPlaying) {
    pauseAnimation();
  } else {
    playAnimation();
  }
}

if (playPauseButton) {
  playPauseButton.addEventListener('click', togglePlayback);
  updatePlayPauseButton();
}

function updateChapterButtons() {
  if (!chapterControls) return;
  chapterControls.querySelectorAll('[data-chapter]').forEach((button) => {
    const isActive = button.dataset.chapter === activeChapterKey;
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function setActiveChapter(chapterKey) {
  if (!CHAPTERS.some((chapter) => chapter.key === chapterKey)) return;
  activeChapterKey = chapterKey;
  virtualTime = getChapterStartTime(chapterKey);
  lastRenderedTime = -1;
  renderAnimationFrame(virtualTime);
  updateChapterButtons();
  if (isPlaying) {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    startAnimation();
  }
}

if (chapterControls) {
  chapterControls.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-chapter]');
    if (!button) return;
    setActiveChapter(button.dataset.chapter);
  });
  updateChapterButtons();
}

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return;
  event.preventDefault();
  togglePlayback();
});

function cssColor(name, fallback) {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    return value && value.trim() ? value.trim() : fallback;
  } catch (_) {
    return fallback;
  }
}

function clamp(min, value, max) {
  return Math.max(min, Math.min(value, max));
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function easeOutCubic(progress) {
  const t = clamp(0, progress, 1);
  return 1 - ((1 - t) ** 3);
}

function easeInCubic(progress) {
  const t = clamp(0, progress, 1);
  return t ** 3;
}

function easeInOutCubic(progress) {
  const t = clamp(0, progress, 1);
  return t < 0.5
    ? 4 * t * t * t
    : 1 - (((-2 * t) + 2) ** 3) / 2;
}

function createSvgElement(name) {
  return document.createElementNS(SVG_NS, name);
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

function getArrowMetrics(squareSize) {
  return {
    strokeWidth: Math.max(10, Math.floor(squareSize * 0.28)),
    headLength: Math.max(21, Math.floor(squareSize * 0.42)),
    headWidth: Math.max(36, Math.floor(squareSize * 0.63)),
  };
}

function appendStraightArrow(svg, start, end, squareSize, opacity = 1) {
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
  arrow.setAttribute('fill', ARROW_FILL);
  arrow.setAttribute('opacity', `${clamp(0, opacity, 1)}`);
  svg.appendChild(arrow);
}

function appendPathArrow(svg, points, squareSize, opacity = 1) {
  if (!Array.isArray(points) || points.length < 2) return;
  const end = points[points.length - 1];
  const previous = points[points.length - 2];
  const direction = getUnitVector(previous, end);
  if (!direction.x && !direction.y) return;

  const { strokeWidth, headLength, headWidth } = getArrowMetrics(squareSize);
  const normal = getPerpendicular(direction);
  const basePoint = trimPoint(previous, end, headLength);
  const pathPoints = points.slice(0, -1).concat(basePoint);
  const path = createSvgElement('path');
  path.setAttribute('d', pathPoints.map((point, index) => (
    `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
  )).join(' '));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', ARROW_FILL);
  path.setAttribute('stroke-width', `${strokeWidth}`);
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('opacity', `${clamp(0, opacity, 1)}`);
  svg.appendChild(path);

  const halfHeadWidth = headWidth / 2;
  const head = createSvgElement('polygon');
  head.setAttribute('points', [
    `${basePoint.x + (normal.x * halfHeadWidth)},${basePoint.y + (normal.y * halfHeadWidth)}`,
    `${end.x},${end.y}`,
    `${basePoint.x - (normal.x * halfHeadWidth)},${basePoint.y - (normal.y * halfHeadWidth)}`,
  ].join(' '));
  head.setAttribute('fill', ARROW_FILL);
  head.setAttribute('opacity', `${clamp(0, opacity, 1)}`);
  svg.appendChild(head);
}

function appendCircle(svg, center, squareSize, opacity = 1) {
  const circle = createSvgElement('circle');
  circle.setAttribute('cx', `${center.x}`);
  circle.setAttribute('cy', `${center.y}`);
  circle.setAttribute('r', `${Math.max(12, Math.floor(squareSize * 0.42))}`);
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke', ARROW_FILL);
  circle.setAttribute('stroke-width', `${Math.max(6, Math.floor(squareSize * 0.16))}`);
  circle.setAttribute('stroke-linecap', 'round');
  circle.setAttribute('stroke-linejoin', 'round');
  circle.setAttribute('opacity', `${clamp(0, opacity, 1)}`);
  svg.appendChild(circle);
}

function measureLayout() {
  const width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  const height = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
  const maxByWidth = Math.max(42, Math.floor((width - 24) / PIECE_COUNT));
  const baseSquareSize = clamp(58, Math.min(width, height) / 6.2, Math.min(118, maxByWidth));
  const squareSize = Math.floor(baseSquareSize * animationZoom);
  const groupWidth = squareSize * PIECE_COUNT;
  const rowLeft = Math.round((width - groupWidth) / 2);
  const rowTop = Math.round((height - squareSize) / 2);
  const cameraY = Math.round(squareSize * 0.5);
  document.documentElement.style.setProperty('--animation-camera-y', `${cameraY}px`);

  return {
    width,
    height,
    squareSize,
    cameraY,
    rowLeft,
    rowTop,
    originX: rowLeft,
    originY: rowTop,
    pieceSize: Math.floor(squareSize * 0.9),
  };
}

function configureCanvas({ width, height }) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const targetWidth = Math.max(1, Math.round(width * dpr));
  const targetHeight = Math.max(1, Math.round(height * dpr));

  if (canvas.width !== targetWidth) {
    canvas.width = targetWidth;
  }
  if (canvas.height !== targetHeight) {
    canvas.height = targetHeight;
  }

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  return dpr;
}

function drawTexture(ctx, { width, height }, offsetY = 0) {
  ctx.save();
  ctx.globalAlpha = 0.56;
  if (textureLoaded) {
    ctx.drawImage(textureImage, 0, offsetY, width, height - offsetY);
  } else {
    ctx.fillStyle = 'rgba(224, 224, 224, 0.16)';
    ctx.fillRect(0, offsetY, width, height - offsetY);
  }
  ctx.restore();
}

function drawBoard() {
  if (!canvas || !layout) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const setupMilestones = getSetupMilestones();
  if (virtualTime >= setupMilestones.boardMorphStart) {
    drawSetupBoard(ctx, setupMilestones, virtualTime);
    return;
  }
  if (virtualTime >= setupMilestones.start) {
    drawSetupInfiniteBoard(ctx);
    return;
  }

  drawInfiniteBoard(ctx);
}

function drawInfiniteBoard(ctx, grid = layout) {
  const { width, height } = layout;
  const { squareSize, originX, originY } = grid;
  const dpr = configureCanvas(layout);
  const cameraY = layout.cameraY || 0;
  const lightSquare = cssColor('--CG-white', '#ffffff');
  const darkSquare = cssColor('--CG-black', '#000000');
  const gridColor = cssColor('--CG-gray', '#707070');
  const startX = -positiveModulo(-originX, squareSize);
  const startY = -positiveModulo(-originY, squareSize);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, cameraY * dpr);

  for (let y = startY; y < height + squareSize; y += squareSize) {
    const row = Math.floor((y - originY) / squareSize);
    for (let x = startX; x < width + squareSize; x += squareSize) {
      const col = Math.floor((x - originX) / squareSize);
      ctx.fillStyle = positiveModulo(row + col, 2) === 1 ? lightSquare : darkSquare;
      ctx.fillRect(x, y, squareSize, squareSize);
    }
  }

  drawTexture(ctx, { width, height: height + cameraY }, -cameraY);

  ctx.save();
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let y = startY; y < height + squareSize; y += squareSize) {
    for (let x = startX; x < width + squareSize; x += squareSize) {
      ctx.strokeRect(x + 0.5, y + 0.5, squareSize - 1, squareSize - 1);
    }
  }
  ctx.restore();
}

function drawSetupInfiniteBoard(ctx) {
  const geometry = getSetupBoardGeometry();
  drawInfiniteBoard(ctx, {
    squareSize: geometry.square,
    originX: geometry.left,
    originY: geometry.top,
  });
}

function getSetupBoardGeometry() {
  const square = layout.squareSize;
  const boardWidth = square * 5;
  const boardHeight = square * 6;
  const left = layout.rowLeft;
  const desiredTop = Math.max(0, Math.round((layout.height - boardHeight - (square * 3.1)) / 2));
  const gridSteps = Math.round((desiredTop - layout.originY) / square);
  const top = layout.originY + (gridSteps * square);
  const deckTop = top + boardHeight + Math.round(square * 0.34);
  return {
    square,
    boardWidth,
    boardHeight,
    left,
    top,
    right: left + boardWidth,
    bottom: top + boardHeight,
    centerX: left + (boardWidth / 2),
    centerY: top + (boardHeight / 2),
    deckLeft: Math.round(layout.width / 2 - square / 2),
    deckTop,
    deckCenter: {
      x: layout.width / 2,
      y: deckTop + (square / 2),
    },
  };
}

function drawSetupBoard(ctx, milestones, time) {
  const { width, height } = layout;
  drawSetupInfiniteBoard(ctx);
  const maskProgress = easeInOutCubic((time - milestones.boardMorphStart) / TIMELINE.setupBoardMorphDuration);
  const geometry = getSetupBoardGeometry();
  const deckColor = cssColor('--CG-indigo', '#3d2e88');
  const gold = cssColor('--CG-deep-gold', '#b8860b');
  const cameraY = layout.cameraY || 0;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const visualTop = clamp(0, geometry.top + cameraY, height);
  const visualBottom = clamp(0, geometry.bottom + cameraY, height);

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#354a45';
  ctx.fillRect(0, 0, width, visualTop * maskProgress);
  ctx.fillRect(0, height - ((height - visualBottom) * maskProgress), width, (height - visualBottom) * maskProgress);
  ctx.fillRect(0, 0, geometry.left * maskProgress, height);
  ctx.fillRect(width - ((width - geometry.right) * maskProgress), 0, (width - geometry.right) * maskProgress, height);
  ctx.restore();

  const deckProgress = easeOutCubic((time - milestones.deckStart) / TIMELINE.setupDeckGrowDuration);
  if (deckProgress > 0) {
    const deckSize = geometry.square * deckProgress;
    const deckLeft = geometry.deckCenter.x - (deckSize / 2);
    const deckTop = geometry.deckCenter.y - (deckSize / 2);
    ctx.save();
    ctx.globalAlpha = deckProgress;
    ctx.fillStyle = deckColor;
    ctx.strokeStyle = gold;
    ctx.lineWidth = 3;
    ctx.fillRect(deckLeft, deckTop, deckSize, deckSize);
    ctx.strokeRect(deckLeft + 1.5, deckTop + 1.5, Math.max(0, deckSize - 3), Math.max(0, deckSize - 3));
    ctx.restore();
  }

  const lineProgress = easeOutCubic((time - milestones.linesStart) / TIMELINE.setupLinesDuration);
  if (lineProgress > 0) {
    const lineWidth = geometry.boardWidth * lineProgress;
    const x = geometry.centerX - (lineWidth / 2);
    const firstRankY = geometry.top + geometry.square;
    const lastRankY = geometry.bottom - geometry.square;
    ctx.save();
    ctx.fillStyle = gold;
    ctx.shadowColor = gold;
    ctx.shadowBlur = 8;
    ctx.globalAlpha = lineProgress;
    ctx.fillRect(x, firstRankY - 2, lineWidth, 4);
    ctx.fillRect(x, lastRankY - 2, lineWidth, 4);
    ctx.restore();
  }
}

function ensurePieces() {
  if (!pieceStage) return [];
  const pieces = Array.from(pieceStage.querySelectorAll('.animation-piece--primary'));

  while (pieces.length < PIECE_COUNT) {
    const index = pieces.length;
    const piece = document.createElement('div');
    piece.className = 'animation-piece animation-piece--primary';
    piece.dataset.index = String(index);
    pieceStage.appendChild(piece);
    pieces.push(piece);
  }

  while (pieces.length > PIECE_COUNT) {
    const piece = pieces.pop();
    piece.remove();
  }

  return pieces;
}

function ensureActor(id, className = '') {
  const stage = ensureActorLayer();
  if (!stage) return null;
  let actor = document.getElementById(id);
  if (!actor) {
    actor = document.createElement('div');
    actor.id = id;
    stage.appendChild(actor);
  }
  actor.className = `animation-piece animation-piece--actor ${className}`.trim();
  return actor;
}

function ensureUnderArrowActor(id, className = '') {
  const stage = ensureUnderArrowActorLayer();
  if (!stage) return null;
  let actor = document.getElementById(id);
  if (!actor) {
    actor = document.createElement('div');
    actor.id = id;
    stage.appendChild(actor);
  } else if (actor.parentElement !== stage) {
    stage.appendChild(actor);
  }
  actor.className = `animation-piece animation-piece--actor ${className}`.trim();
  return actor;
}

function ensureOverlayElement(id, className) {
  const stage = ensureActorLayer();
  if (!stage) return null;
  let element = document.getElementById(id);
  if (!element) {
    element = document.createElement('div');
    element.id = id;
    stage.appendChild(element);
  }
  element.className = className;
  return element;
}

function ensureMoveBubble(type) {
  return ensureMoveBubbleAt(type, 0);
}

function ensureMoveBubbleAt(type, index) {
  const bubbleId = index === 0 ? 'animationMoveBubble' : `animationMoveBubble${index}`;
  const bubble = ensureOverlayElement(bubbleId, 'animation-move-bubble');
  if (!bubble || !layout) return null;
  bubble.classList.toggle('animation-move-bubble--poison', type.startsWith('bomb'));
  const size = Math.floor(layout.squareSize * 1.08);
  if (bubble.dataset.bubbleType !== type || bubble.dataset.renderSize !== String(size)) {
    const visual = createBubbleVisual({ type, size, alt: '' });
    bubble.replaceChildren(visual || document.createTextNode(''));
    bubble.dataset.bubble = '1';
    bubble.dataset.bubbleType = type;
    bubble.dataset.renderSize = String(size);
  }
  return bubble;
}

function ensureChallengeSpeechBubble(sizeMultiplier = 1) {
  const bubble = ensureOverlayElement('animationChallengeSpeechBubble', 'animation-challenge-bubble');
  if (!bubble || !layout) return null;
  const size = Math.floor(layout.squareSize * 1.02 * sizeMultiplier);
  if (bubble.dataset.renderSize !== String(size)) {
    const visual = createChallengeBubble({ position: 'left', size, alt: 'Challenge' });
    bubble.replaceChildren(visual || document.createTextNode(''));
    bubble.dataset.renderSize = String(size);
  }
  bubble.style.width = `${size}px`;
  bubble.style.height = `${size}px`;
  return bubble;
}

function hideChallengeSpeechBubble() {
  const bubble = document.getElementById('animationChallengeSpeechBubble');
  if (bubble) bubble.style.opacity = '0';
}

function ensureFakeCursor() {
  const cursor = ensureOverlayElement('animationFakeCursor', 'animation-fake-cursor');
  if (!cursor || !layout) return null;
  if (!cursor.firstChild) {
    cursor.innerHTML = [
      '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">',
      '<path d="M5 3 L5 25 L11.4 18.8 L15.1 28.6 L20.1 26.7 L16.3 17.1 L25.4 17.1 Z" fill="#ffffff" stroke="#111111" stroke-width="2" stroke-linejoin="round"/>',
      '</svg>',
    ].join('');
  }
  cursor.style.setProperty('--cursor-size', `${Math.floor(layout.squareSize * 0.44)}px`);
  return cursor;
}

function ensureChallengeButton() {
  const stage = ensureActorLayer();
  if (!stage) return null;
  let button = document.getElementById('animationChallengeButton');
  if (!button || button.tagName.toLowerCase() !== 'button') {
    if (button) button.remove();
    button = document.createElement('button');
    button.id = 'animationChallengeButton';
    button.type = 'button';
    stage.appendChild(button);
  }
  button.className = 'cg-button cg-button--primary animation-challenge-button';
  if (!button) return null;
  button.textContent = 'Challenge';
  button.disabled = false;
  button.style.setProperty('--cg-button-position', 'absolute');
  return button;
}

function ensureSetupReadyButton() {
  const stage = ensureActorLayer();
  if (!stage) return null;
  let button = document.getElementById('animationSetupReadyButton');
  if (!button || button.tagName.toLowerCase() !== 'button') {
    if (button) button.remove();
    button = document.createElement('button');
    button.id = 'animationSetupReadyButton';
    button.type = 'button';
    stage.appendChild(button);
  }
  button.className = 'cg-button cg-button--primary cg-ready-button--highlighted animation-setup-ready-button';
  button.textContent = 'Ready!';
  button.disabled = false;
  button.style.setProperty('--cg-button-position', 'absolute');
  return button;
}

function ensurePoisonButton() {
  const stage = ensureActorLayer();
  if (!stage) return null;
  let button = document.getElementById('animationPoisonButton');
  if (!button || button.tagName.toLowerCase() !== 'button') {
    if (button) button.remove();
    button = document.createElement('button');
    button.id = 'animationPoisonButton';
    button.type = 'button';
    stage.appendChild(button);
  }
  button.className = 'cg-button cg-button--danger animation-poison-button';
  button.textContent = 'Poison';
  button.disabled = false;
  button.style.setProperty('--cg-button-position', 'absolute');
  return button;
}

function ensurePassButton() {
  const stage = ensureActorLayer();
  if (!stage) return null;
  let button = document.getElementById('animationPassButton');
  if (!button || button.tagName.toLowerCase() !== 'button') {
    if (button) button.remove();
    button = document.createElement('button');
    button.id = 'animationPassButton';
    button.type = 'button';
    stage.appendChild(button);
  }
  button.className = 'cg-button cg-button--primary animation-pass-button';
  button.textContent = 'Pass';
  button.disabled = false;
  button.style.setProperty('--cg-button-position', 'absolute');
  return button;
}

function ensureRewindIndicator() {
  const indicator = ensureOverlayElement('animationRewindIndicator', 'animation-rewind-indicator');
  if (!indicator) return null;
  if (!indicator.firstChild) {
    const first = document.createElement('span');
    const second = document.createElement('span');
    first.className = 'animation-rewind-triangle';
    second.className = 'animation-rewind-triangle';
    indicator.append(first, second);
  }
  return indicator;
}

function ensureDaggerToken() {
  const stage = ensureActorLayer();
  if (!stage) return null;
  let token = document.getElementById('animationDaggerToken');
  if (!token) {
    token = createDaggerToken({
      size: getDaggerSlotSize(),
      alt: 'Dagger token',
      label: '⚔',
    });
    token.id = 'animationDaggerToken';
    token.classList.add('animation-dagger-token');
    stage.appendChild(token);
  }
  const size = getDaggerSlotSize();
  token.style.width = `${size}px`;
  token.style.height = `${size}px`;
  token.style.fontSize = `${Math.max(10, Math.round(size * 0.74))}px`;
  return token;
}

function ensureDaggerSlots() {
  const slots = ensureOverlayElement('animationDaggerSlots', 'animation-dagger-slots');
  if (!slots || !layout) return null;
  while (slots.children.length < 3) {
    const slot = document.createElement('span');
    slot.className = 'animation-dagger-slot';
    slots.appendChild(slot);
  }
  while (slots.children.length > 3) {
    slots.removeChild(slots.lastChild);
  }
  const size = getDaggerSlotSize();
  slots.style.setProperty('--dagger-slot-size', `${size}px`);
  slots.style.setProperty('--dagger-slot-gap', `${Math.max(5, Math.floor(size * 0.16))}px`);
  return slots;
}

function ensureWinningDaggerSlots(id) {
  const slots = ensureOverlayElement(id, 'animation-dagger-slots animation-winning-dagger-slots');
  if (!slots || !layout) return null;
  while (slots.children.length < 3) {
    const slot = document.createElement('span');
    slot.className = 'animation-dagger-slot animation-winning-dagger-slot';
    slots.appendChild(slot);
  }
  while (slots.children.length > 3) {
    slots.removeChild(slots.lastChild);
  }
  const size = getDaggerSlotSize();
  slots.style.setProperty('--dagger-slot-size', `${size}px`);
  slots.style.setProperty('--dagger-slot-gap', `${Math.max(5, Math.floor(size * 0.16))}px`);
  return slots;
}

function renderPieceContent(pieceEl, identity, color = WHITE, targetSize = layout?.squareSize) {
  if (!pieceEl || !layout) return;
  const renderSize = Number.isFinite(targetSize) ? targetSize : layout.squareSize;
  const sizeKey = String(Math.round(renderSize));
  const identityKey = String(identity);
  const colorKey = String(color);
  if (
    pieceEl.dataset.identity === identityKey
    && pieceEl.dataset.renderSize === sizeKey
    && pieceEl.dataset.color === colorKey
  ) {
    return;
  }

  const glyph = pieceGlyph(
    { color, identity },
    renderSize,
    PIECE_IMAGES,
    { showLabel: false }
  );
  pieceEl.replaceChildren(glyph || document.createTextNode(''));
  pieceEl.dataset.identity = identityKey;
  pieceEl.dataset.renderSize = sizeKey;
  pieceEl.dataset.color = colorKey;
}

function positionPieces() {
  if (!layout || !pieceStage) return;

  const pieces = ensurePieces();
  pieces.forEach((piece, index) => {
    const centerX = layout.rowLeft + ((index + 0.5) * layout.squareSize);
    const centerY = layout.rowTop + (layout.squareSize / 2);
    piece.style.left = `${centerX}px`;
    piece.style.top = `${centerY}px`;
    piece.style.setProperty('--piece-size', `${layout.pieceSize}px`);
    renderPieceContent(piece, UNKNOWN_IDENTITY);
  });
}

function getSequenceEndTime() {
  return getChapterEndTime(CHAPTERS[CHAPTERS.length - 1].key);
}

function getChapterKeyForTime(time) {
  const match = CHAPTERS.find((chapter) => time < getChapterEndTime(chapter.key));
  return match?.key || CHAPTERS[CHAPTERS.length - 1].key;
}

function syncActiveChapterToTime(time) {
  const chapterKey = getChapterKeyForTime(time);
  if (chapterKey === activeChapterKey) return;
  activeChapterKey = chapterKey;
  updateChapterButtons();
}

function getChapterStartTime(chapterKey) {
  const scytheMilestones = getScytheMilestones();
  const captureMilestones = getCapturesPoisonMilestones();
  const setupMilestones = getSetupMilestones();
  const samplePlayMilestones = getWinningMilestones();
  const winningMilestones = getWinningChapterMilestones();
  if (chapterKey === 'winning') {
    return winningMilestones.start;
  }
  if (chapterKey === 'samplePlay') {
    return samplePlayMilestones.start;
  }
  if (chapterKey === 'setup') {
    return setupMilestones.start;
  }
  if (chapterKey === 'capturesPoison') {
    return captureMilestones.start;
  }
  if (chapterKey === 'cloakMovement') {
    return scytheMilestones.flipStart;
  }
  return 0;
}

function getChapterEndTime(chapterKey) {
  const scytheMilestones = getScytheMilestones();
  const captureMilestones = getCapturesPoisonMilestones();
  const setupMilestones = getSetupMilestones();
  const samplePlayMilestones = getWinningMilestones();
  const winningMilestones = getWinningChapterMilestones();
  if (chapterKey === 'winning') {
    return winningMilestones.end;
  }
  if (chapterKey === 'samplePlay') {
    return samplePlayMilestones.end;
  }
  if (chapterKey === 'setup') {
    return setupMilestones.end;
  }
  if (chapterKey === 'capturesPoison') {
    return captureMilestones.end;
  }
  if (chapterKey === 'cloakMovement') {
    return scytheMilestones.moveSequenceEnd;
  }
  return scytheMilestones.poisonEnd;
}

function getArrowSequenceStartTime() {
  const fadeEnd = TIMELINE.fadeStartDelay
    + ((PIECE_COUNT - 1) * TIMELINE.fadeStagger)
    + TIMELINE.fadeDuration;
  const flipEnd = fadeEnd
    + TIMELINE.pauseAfterFade
    + ((PIECE_COUNT - 1) * TIMELINE.flipStagger)
    + (TIMELINE.flipHalfDuration * 2);
  return flipEnd
    + TIMELINE.pauseAfterFlip
    + TIMELINE.spreadDuration
    + TIMELINE.pauseBeforeKingArrows;
}

function getArrowSequenceEndTime() {
  return getArrowSequenceStartTime()
    + ((KING_ARROW_DIRECTIONS.length - 1) * TIMELINE.arrowStagger)
    + TIMELINE.arrowDuration;
}

function getInteractionStartTime() {
  return getArrowSequenceEndTime() + TIMELINE.pauseAfterKingArrows;
}

function getInteractionMilestones() {
  const interactionStart = getInteractionStartTime();
  const whiteSlideEnd = interactionStart + TIMELINE.whiteSlideDuration;
  const probeEnd = whiteSlideEnd + TIMELINE.heartProbeDuration;
  const returnEnd = probeEnd + TIMELINE.heartReturnDuration;
  const shakeEnd = returnEnd + TIMELINE.heartShakeDuration;
  const blackSlideEnd = shakeEnd + TIMELINE.blackSlideDuration;
  const captureStart = blackSlideEnd + TIMELINE.pauseBeforeCapture;
  const captureEnd = captureStart + TIMELINE.captureSlideDuration;
  const blackFadeStart = captureEnd + TIMELINE.captureHoldDuration;
  const blackFadeEnd = blackFadeStart + TIMELINE.blackFadeDuration;
  const finalResetEnd = blackFadeEnd + TIMELINE.finalResetDuration;
  return {
    interactionStart,
    whiteSlideEnd,
    probeEnd,
    returnEnd,
    shakeEnd,
    blackSlideEnd,
    captureStart,
    captureEnd,
    blackFadeStart,
    blackFadeEnd,
    finalResetEnd,
  };
}

function getLineArrowTotalDuration() {
  return ((STRAIGHT_DIRECTIONS.length - 1) * TIMELINE.lineArrowDirectionStagger)
    + (3 * TIMELINE.lineArrowStepDuration)
    + (2 * TIMELINE.lineArrowStepPause);
}

function getLineSequenceDuration() {
  return TIMELINE.swapToLinePieceDelay
    + TIMELINE.linePieceSwapDuration
    + TIMELINE.lineArrowDelay
    + getLineArrowTotalDuration()
    + TIMELINE.lineBlockerDelay
    + TIMELINE.lineBlockerSlideDuration
    + TIMELINE.lineBlockerHoldDuration
    + TIMELINE.lineClearDuration;
}

function getLineSequenceMilestones(sequenceIndex) {
  const previous = getInteractionMilestones().finalResetEnd;
  const start = previous + (sequenceIndex * getLineSequenceDuration());
  const swapStart = start + TIMELINE.swapToLinePieceDelay;
  const swapEnd = swapStart + TIMELINE.linePieceSwapDuration;
  const arrowStart = swapEnd + TIMELINE.lineArrowDelay;
  const arrowEnd = arrowStart + getLineArrowTotalDuration();
  const blockerStart = arrowEnd + TIMELINE.lineBlockerDelay;
  const blockerEnd = blockerStart + TIMELINE.lineBlockerSlideDuration;
  const blockerHoldEnd = blockerEnd + TIMELINE.lineBlockerHoldDuration;
  const clearEnd = blockerHoldEnd + TIMELINE.lineClearDuration;
  return {
    start,
    swapStart,
    swapEnd,
    arrowStart,
    arrowEnd,
    blockerStart,
    blockerEnd,
    blockerHoldEnd,
    clearEnd,
  };
}

function getSwordMilestones() {
  return getLineSequenceMilestones(0);
}

function getSpearMilestones() {
  return getLineSequenceMilestones(1);
}

function getScytheArrowTotalDuration() {
  return ((KNIGHT_DIRECTIONS.length - 1) * TIMELINE.lineArrowDirectionStagger)
    + TIMELINE.arrowDuration;
}

function getScytheMilestones() {
  const start = getSpearMilestones().clearEnd;
  const swapStart = start + TIMELINE.swapToLinePieceDelay;
  const swapEnd = swapStart + TIMELINE.linePieceSwapDuration;
  const arrowStart = swapEnd + TIMELINE.lineArrowDelay;
  const arrowEnd = arrowStart + getScytheArrowTotalDuration();
  const targetStart = arrowEnd + TIMELINE.lineBlockerDelay;
  const targetEnd = targetStart + TIMELINE.lineBlockerSlideDuration;
  const rowStart = targetEnd + TIMELINE.lineBlockerHoldDuration;
  const rowEnd = rowStart + TIMELINE.lineBlockerSlideDuration;
  const rowHoldEnd = rowEnd + TIMELINE.lineBlockerHoldDuration;
  const clearEnd = rowHoldEnd + TIMELINE.lineClearDuration;
  const poisonStart = clearEnd + TIMELINE.swapToLinePieceDelay;
  const poisonEnd = poisonStart + TIMELINE.linePieceSwapDuration;
  const flipStart = poisonEnd;
  const flipMid = flipStart + TIMELINE.flipHalfDuration;
  const flipEnd = flipMid + TIMELINE.flipHalfDuration;
  const moveSequenceStart = flipEnd + TIMELINE.poisonFlipPause;
  const declaredMoveSequenceEnd = moveSequenceStart + (DECLARED_MOVE_SEQUENCE.length * getDeclaredMoveDuration());
  const thoughtMoveSequenceStart = declaredMoveSequenceEnd;
  const thoughtMoveSequenceEnd = thoughtMoveSequenceStart + (THOUGHT_MOVE_SEQUENCE.length * getThoughtMoveDuration());
  const cursorStart = thoughtMoveSequenceEnd + TIMELINE.cursorApproachDelay;
  const cursorClickStart = cursorStart + TIMELINE.cursorApproachDuration;
  const cursorClickEnd = cursorClickStart + TIMELINE.cursorClickDuration;
  const cursorExitEnd = cursorClickEnd + TIMELINE.cursorExitDuration;
  const finalSpeechEnd = cursorExitEnd + TIMELINE.finalSpeechHoldDuration;
  const challengeButtonStart = finalSpeechEnd + TIMELINE.challengeButtonDelay;
  const challengeButtonEnd = challengeButtonStart + TIMELINE.challengeButtonSlideDuration;
  const challengeCursorStart = challengeButtonEnd + TIMELINE.challengeButtonHoldDuration;
  const challengeCursorClickStart = challengeCursorStart + TIMELINE.challengeCursorApproachDuration;
  const challengeCursorClickEnd = challengeCursorClickStart + TIMELINE.challengeCursorClickDuration;
  const challengeCursorExitEnd = challengeCursorClickEnd + TIMELINE.challengeCursorExitDuration;
  const challengeFlipStart = challengeCursorClickStart;
  const challengeFlipMid = challengeFlipStart + (TIMELINE.challengeFlipDuration / 2);
  const challengeFlipEnd = challengeFlipStart + TIMELINE.challengeFlipDuration;
  const challengeTiltEnd = challengeFlipEnd + TIMELINE.challengeTiltDuration;
  const challengeFadeEnd = challengeTiltEnd + TIMELINE.challengeFadeDuration;
  const rewindStart = challengeFadeEnd + TIMELINE.rewindDelay;
  const rewindRestoreEnd = rewindStart + TIMELINE.rewindRestoreDuration;
  const rewindFlipMid = rewindRestoreEnd + (TIMELINE.rewindFlipDuration / 2);
  const rewindFlipEnd = rewindRestoreEnd + TIMELINE.rewindFlipDuration;
  const rewindHoldEnd = rewindFlipEnd + TIMELINE.rewindHoldDuration;
  const secondChallengeButtonStart = rewindHoldEnd + TIMELINE.secondChallengeDelay;
  const secondChallengeButtonEnd = secondChallengeButtonStart + TIMELINE.challengeButtonSlideDuration;
  const secondChallengeCursorStart = secondChallengeButtonEnd + TIMELINE.challengeButtonHoldDuration;
  const secondChallengeCursorClickStart = secondChallengeCursorStart + TIMELINE.challengeCursorApproachDuration;
  const secondChallengeCursorClickEnd = secondChallengeCursorClickStart + TIMELINE.challengeCursorClickDuration;
  const secondChallengeCursorExitEnd = secondChallengeCursorClickEnd + TIMELINE.challengeCursorExitDuration;
  const secondChallengeFlipStart = secondChallengeCursorClickStart;
  const secondChallengeFlipMid = secondChallengeFlipStart + (TIMELINE.challengeFlipDuration / 2);
  const secondChallengeFlipEnd = secondChallengeFlipStart + TIMELINE.challengeFlipDuration;
  const secondRevealHoldEnd = secondChallengeFlipEnd + TIMELINE.secondRevealHoldDuration;
  const finalPieceSlideEnd = secondRevealHoldEnd + TIMELINE.finalPieceSlideDuration;
  const swordSlideEnd = finalPieceSlideEnd + TIMELINE.swordSlideDuration;
  const swordFlipMid = swordSlideEnd + (TIMELINE.swordFlipDuration / 2);
  const swordFlipEnd = swordSlideEnd + TIMELINE.swordFlipDuration;
  const finalBubbleFadeEnd = swordSlideEnd + TIMELINE.finalBubbleFadeDuration;
  const daggerSlotsStart = swordFlipEnd + 220;
  const daggerSlideStart = daggerSlotsStart + TIMELINE.daggerSlotsLeadDuration;
  const daggerSlideEnd = daggerSlideStart + TIMELINE.daggerSlideDuration;
  const daggerFlashEnd = daggerSlideEnd + TIMELINE.daggerFlashDuration;
  const moveSequenceEnd = daggerFlashEnd + TIMELINE.finalSwordHoldDuration;
  return {
    start,
    swapStart,
    swapEnd,
    arrowStart,
    arrowEnd,
    targetStart,
    targetEnd,
    rowStart,
    rowEnd,
    rowHoldEnd,
    clearEnd,
    poisonStart,
    poisonEnd,
    flipStart,
    flipMid,
    flipEnd,
    moveSequenceStart,
    declaredMoveSequenceEnd,
    thoughtMoveSequenceStart,
    thoughtMoveSequenceEnd,
    cursorStart,
    cursorClickStart,
    cursorClickEnd,
    cursorExitEnd,
    finalSpeechEnd,
    challengeButtonStart,
    challengeButtonEnd,
    challengeCursorStart,
    challengeCursorClickStart,
    challengeCursorClickEnd,
    challengeCursorExitEnd,
    challengeFlipStart,
    challengeFlipMid,
    challengeFlipEnd,
    challengeTiltEnd,
    challengeFadeEnd,
    rewindStart,
    rewindRestoreEnd,
    rewindFlipMid,
    rewindFlipEnd,
    rewindHoldEnd,
    secondChallengeButtonStart,
    secondChallengeButtonEnd,
    secondChallengeCursorStart,
    secondChallengeCursorClickStart,
    secondChallengeCursorClickEnd,
    secondChallengeCursorExitEnd,
    secondChallengeFlipStart,
    secondChallengeFlipMid,
    secondChallengeFlipEnd,
    secondRevealHoldEnd,
    finalPieceSlideEnd,
    swordSlideEnd,
    swordFlipMid,
    swordFlipEnd,
    finalBubbleFadeEnd,
    daggerSlotsStart,
    daggerSlideStart,
    daggerSlideEnd,
    daggerFlashEnd,
    moveSequenceEnd,
  };
}

function getCapturesPoisonMilestones() {
  const previous = getScytheMilestones();
  const start = previous.moveSequenceEnd;
  const clearEnd = start + TIMELINE.captureClearFadeDuration;
  const returnEnd = clearEnd + TIMELINE.captureReturnDuration;
  const revealStart = returnEnd + TIMELINE.captureRevealPause;
  const revealMid = revealStart + TIMELINE.flipHalfDuration;
  const revealEnd = revealMid + TIMELINE.flipHalfDuration;
  const blackSlideStart = revealEnd + TIMELINE.captureRevealPause;
  const blackSlideEnd = blackSlideStart + TIMELINE.captureBlackSlideDuration;
  const attackStart = blackSlideEnd + TIMELINE.captureBlackHoldDuration;
  const attackEnd = attackStart + TIMELINE.captureAttackSlideDuration;
  const thoughtHoldEnd = attackEnd + TIMELINE.captureThoughtHoldDuration;
  const declareEnd = thoughtHoldEnd + TIMELINE.captureDeclareDuration;
  const declareHoldEnd = declareEnd + TIMELINE.captureDeclareHoldDuration;
  const challengeButtonStart = declareHoldEnd + TIMELINE.captureChallengeDelay;
  const challengeButtonEnd = challengeButtonStart + TIMELINE.challengeButtonSlideDuration;
  const challengeCursorStart = challengeButtonEnd + TIMELINE.challengeButtonHoldDuration;
  const challengeCursorArrive = challengeCursorStart + TIMELINE.challengeCursorApproachDuration;
  const poisonButtonStart = challengeCursorArrive + TIMELINE.capturePoisonButtonDelay;
  const poisonButtonEnd = poisonButtonStart + TIMELINE.capturePoisonButtonSlideDuration;
  const poisonCursorStart = Math.max(
    poisonButtonEnd + TIMELINE.capturePoisonButtonHoldDuration,
    challengeCursorArrive + TIMELINE.captureChallengeHoverDuration
  );
  const poisonCursorClickStart = poisonCursorStart + TIMELINE.captureCursorMoveDuration;
  const poisonCursorClickEnd = poisonCursorClickStart + TIMELINE.challengeCursorClickDuration;
  const poisonCursorExitEnd = poisonCursorClickEnd + TIMELINE.challengeCursorExitDuration;
  const poisonOutcomeEnd = poisonCursorClickEnd + TIMELINE.capturePoisonOutcomeDuration;
  const passButtonStart = poisonOutcomeEnd + TIMELINE.captureButtonSwapDelay;
  const passButtonEnd = passButtonStart + TIMELINE.capturePassButtonSlideDuration;
  const passCursorStart = passButtonEnd + TIMELINE.capturePassHoldDuration;
  const passCursorClickStart = passCursorStart + TIMELINE.captureCursorMoveDuration;
  const passCursorClickEnd = passCursorClickStart + TIMELINE.challengeCursorClickDuration;
  const passFadeEnd = passCursorClickEnd + TIMELINE.capturePassFadeDuration;
  const passRewindStart = passFadeEnd + TIMELINE.rewindDelay;
  const passRewindEnd = passRewindStart + TIMELINE.rewindRestoreDuration;
  const passRewindHoldEnd = passRewindEnd + TIMELINE.capturePostRewindHoldDuration;
  const firstChallengeCursorStart = passRewindHoldEnd + TIMELINE.challengeButtonHoldDuration;
  const firstChallengeCursorClickStart = firstChallengeCursorStart + TIMELINE.captureCursorMoveDuration;
  const firstChallengeCursorClickEnd = firstChallengeCursorClickStart + TIMELINE.challengeCursorClickDuration;
  const firstChallengeResolveEnd = firstChallengeCursorClickEnd + TIMELINE.captureChallengeResolveDuration;
  const firstChallengeHoldEnd = firstChallengeResolveEnd + TIMELINE.capturePoisonOutcomeHoldDuration;
  const firstDaggerSlotsStart = firstChallengeHoldEnd;
  const firstDaggerSlideStart = firstDaggerSlotsStart + TIMELINE.captureDaggerSlotsLeadDuration;
  const firstDaggerSlideEnd = firstDaggerSlideStart + TIMELINE.daggerSlideDuration;
  const firstDaggerHoldEnd = firstDaggerSlideEnd + TIMELINE.captureDaggerHoldDuration;
  const daggerRewindStart = firstDaggerHoldEnd;
  const daggerRewindEnd = daggerRewindStart + TIMELINE.captureDaggerRewindDuration;
  const daggerRewindHoldEnd = daggerRewindEnd + TIMELINE.capturePostRewindHoldDuration;
  const secondChallengeCursorStart = daggerRewindHoldEnd + TIMELINE.challengeButtonHoldDuration;
  const secondChallengeCursorClickStart = secondChallengeCursorStart + TIMELINE.captureCursorMoveDuration;
  const secondChallengeCursorClickEnd = secondChallengeCursorClickStart + TIMELINE.challengeCursorClickDuration;
  const secondChallengeResolveEnd = secondChallengeCursorClickEnd + TIMELINE.captureScytheResolveDuration;
  const secondChallengeHoldEnd = secondChallengeResolveEnd + TIMELINE.captureScytheHoldDuration;
  const scytheFadeEnd = secondChallengeHoldEnd + TIMELINE.captureScytheFadeDuration;
  const finalDaggerSlotsStart = scytheFadeEnd + TIMELINE.captureButtonSwapDelay;
  const finalDaggerSlideStart = finalDaggerSlotsStart + TIMELINE.captureDaggerSlotsLeadDuration;
  const finalDaggerSlideEnd = finalDaggerSlideStart + TIMELINE.daggerSlideDuration;
  const finalDaggerHoldEnd = finalDaggerSlideEnd + TIMELINE.captureFinalDaggerHoldDuration;
  const finalRewindStart = finalDaggerHoldEnd;
  const finalRewindEnd = finalRewindStart + TIMELINE.captureFinalRewindDuration;
  const finalRewindHoldEnd = finalRewindEnd + TIMELINE.capturePostRewindHoldDuration;
  const heartCaptureStart = finalRewindHoldEnd;
  const heartCaptureEnd = heartCaptureStart + TIMELINE.captureAttackSlideDuration;
  const heartCaptureHoldEnd = heartCaptureEnd + TIMELINE.captureHeartRecaptureHoldDuration;
  const heartThoughtCursorStart = heartCaptureHoldEnd;
  const heartThoughtCursorClickStart = heartThoughtCursorStart + TIMELINE.cursorApproachDuration;
  const heartThoughtCursorClickEnd = heartThoughtCursorClickStart + TIMELINE.cursorClickDuration;
  const heartThoughtCursorExitEnd = heartThoughtCursorClickEnd + TIMELINE.cursorExitDuration;
  const heartDeclareEnd = heartThoughtCursorClickEnd + TIMELINE.captureHeartDeclareDuration;
  const heartDeclareHoldEnd = heartDeclareEnd + TIMELINE.captureHeartDeclareHoldDuration;
  const heartButtonsStart = heartDeclareHoldEnd + TIMELINE.captureChallengeDelay;
  const heartButtonsEnd = heartButtonsStart + TIMELINE.challengeButtonSlideDuration;
  const heartPoisonFadeEnd = heartButtonsEnd + TIMELINE.captureHeartPoisonFadeDuration;
  const end = heartPoisonFadeEnd + TIMELINE.capturePoisonOutcomeHoldDuration;
  return {
    start,
    clearEnd,
    returnEnd,
    revealStart,
    revealMid,
    revealEnd,
    blackSlideStart,
    blackSlideEnd,
    attackStart,
    attackEnd,
    thoughtHoldEnd,
    declareEnd,
    declareHoldEnd,
    challengeButtonStart,
    challengeButtonEnd,
    challengeCursorStart,
    challengeCursorArrive,
    poisonButtonStart,
    poisonButtonEnd,
    poisonCursorStart,
    poisonCursorClickStart,
    poisonCursorClickEnd,
    poisonCursorExitEnd,
    poisonOutcomeEnd,
    passButtonStart,
    passButtonEnd,
    passCursorStart,
    passCursorClickStart,
    passCursorClickEnd,
    passFadeEnd,
    passRewindStart,
    passRewindEnd,
    passRewindHoldEnd,
    firstChallengeCursorStart,
    firstChallengeCursorClickStart,
    firstChallengeCursorClickEnd,
    firstChallengeResolveEnd,
    firstChallengeHoldEnd,
    firstDaggerSlotsStart,
    firstDaggerSlideStart,
    firstDaggerSlideEnd,
    firstDaggerHoldEnd,
    daggerRewindStart,
    daggerRewindEnd,
    daggerRewindHoldEnd,
    secondChallengeCursorStart,
    secondChallengeCursorClickStart,
    secondChallengeCursorClickEnd,
    secondChallengeResolveEnd,
    secondChallengeHoldEnd,
    scytheFadeEnd,
    finalDaggerSlotsStart,
    finalDaggerSlideStart,
    finalDaggerSlideEnd,
    finalDaggerHoldEnd,
    finalRewindStart,
    finalRewindEnd,
    finalRewindHoldEnd,
    heartCaptureStart,
    heartCaptureEnd,
    heartCaptureHoldEnd,
    heartThoughtCursorStart,
    heartThoughtCursorClickStart,
    heartThoughtCursorClickEnd,
    heartThoughtCursorExitEnd,
    heartDeclareEnd,
    heartDeclareHoldEnd,
    heartButtonsStart,
    heartButtonsEnd,
    heartPoisonFadeEnd,
    end,
  };
}

function getSetupMilestones() {
  const start = getCapturesPoisonMilestones().end;
  const wipeEnd = start + TIMELINE.setupWipeDuration;
  const originalsStart = wipeEnd + 160;
  const originalsEnd = originalsStart + TIMELINE.setupOriginalSlideDuration;
  const duplicateStart = originalsEnd + 240;
  const duplicateEnd = duplicateStart + TIMELINE.setupDuplicateDuration;
  const boardMorphStart = duplicateEnd + 280;
  const boardMorphEnd = boardMorphStart + TIMELINE.setupBoardMorphDuration;
  const deckStart = boardMorphEnd + 180;
  const deckEnd = deckStart + TIMELINE.setupDeckGrowDuration;
  const linesStart = deckEnd + 180;
  const linesEnd = linesStart + TIMELINE.setupLinesDuration;
  const placementStart = linesEnd + TIMELINE.setupPlacementPause;
  const heartPlaceEnd = placementStart + TIMELINE.setupHeartPlaceDuration;
  const remainingPlaceStart = heartPlaceEnd + TIMELINE.setupPlacementPause;
  const remainingPlaceEnd = remainingPlaceStart
    + (TIMELINE.setupPiecePlaceStagger * 3)
    + TIMELINE.setupPiecePlaceDuration;
  const poisonPlaceStart = remainingPlaceEnd + TIMELINE.setupPlacementPause;
  const poisonPlaceEnd = poisonPlaceStart + TIMELINE.setupPoisonPlaceDuration;
  const shuffleStart = poisonPlaceEnd + TIMELINE.setupShufflePause;
  const shuffleStepDuration = TIMELINE.setupShuffleSwapDuration + TIMELINE.setupShuffleSwapPause;
  const shuffleEnd = shuffleStart + (SETUP_SHUFFLE_SWAPS.length * shuffleStepDuration);
  const end = shuffleEnd + TIMELINE.setupHoldDuration;
  return {
    start,
    wipeEnd,
    originalsStart,
    originalsEnd,
    duplicateStart,
    duplicateEnd,
    boardMorphStart,
    boardMorphEnd,
    deckStart,
    deckEnd,
    linesStart,
    linesEnd,
    placementStart,
    heartPlaceEnd,
    remainingPlaceStart,
    remainingPlaceEnd,
    poisonPlaceStart,
    poisonPlaceEnd,
    shuffleStart,
    shuffleEnd,
    shuffleStepDuration,
    end,
  };
}

function getWinningMoveStepDuration(move) {
  let duration = TIMELINE.winningMoveDuration
    + TIMELINE.winningMoveHoldDuration
    + TIMELINE.winningMovePause;
  if (move?.challenge) {
    duration += TIMELINE.winningChallengeDelay
      + TIMELINE.winningChallengeRevealDuration
      + TIMELINE.winningOnDeckSwapDuration
      + TIMELINE.winningOnDeckReplaceDelay
      + TIMELINE.winningOnDeckReplaceDuration
      + TIMELINE.winningStashReflowDuration;
  }
  if (move?.capture) {
    duration += TIMELINE.winningCaptureTiltDuration
      + TIMELINE.winningCapturePauseDuration
      + TIMELINE.winningCaptureDisplayDuration;
  }
  return duration;
}

function getWinningMoveSequenceDuration() {
  return WINNING_MOVE_SEQUENCE.reduce(
    (total, move) => total + getWinningMoveStepDuration(move),
    0
  );
}

function getWinningDrawMoveSequenceDuration() {
  return WINNING_DRAW_MOVE_SEQUENCE.reduce(
    (total, move) => total + getWinningMoveStepDuration(move),
    0
  );
}

function getWinningMilestones() {
  const start = getSetupMilestones().end;
  const fadeEnd = start + TIMELINE.winningFadeDuration;
  const slideEnd = start + TIMELINE.winningStashSlideDuration;
  const daggerSlotsStart = slideEnd + TIMELINE.winningDaggerSlotsDelay;
  const daggerSlotsEnd = daggerSlotsStart + TIMELINE.winningDaggerSlotsFadeDuration;
  const moveSequenceStart = daggerSlotsEnd + TIMELINE.winningMoveSequenceDelay;
  const moveSequenceEnd = moveSequenceStart + getWinningMoveSequenceDuration();
  const end = moveSequenceEnd + TIMELINE.winningHoldDuration;
  return {
    start,
    fadeEnd,
    slideEnd,
    daggerSlotsStart,
    daggerSlotsEnd,
    moveSequenceStart,
    moveSequenceEnd,
    end,
  };
}

function getWinningChapterMilestones() {
  const samplePlay = getWinningMilestones();
  const start = samplePlay.end;
  const challengeStart = start + TIMELINE.winningFinaleIntroDelay;
  const revealStart = challengeStart + TIMELINE.winningFinaleChallengeHoldDuration;
  const revealEnd = revealStart + TIMELINE.winningFinaleRevealDuration;
  const captureSlideStart = revealEnd + TIMELINE.winningFinaleRevealHoldDuration;
  const captureSlideEnd = captureSlideStart + TIMELINE.winningFinaleCaptureSlideDuration;
  const throneStart = captureSlideEnd + TIMELINE.winningFinaleThroneDelay;
  const throneEnd = throneStart + TIMELINE.winningFinaleThroneDuration;
  const rewindStart = throneEnd + TIMELINE.winningFinaleHoldDuration;
  const rewindEnd = rewindStart + TIMELINE.winningFinaleRewindDuration;
  const secondMoveStart = rewindEnd + TIMELINE.winningFinaleRewindHoldDuration + TIMELINE.winningFinaleSecondMoveDelay;
  const secondMoveEnd = secondMoveStart + TIMELINE.winningFinaleSecondMoveDuration;
  const secondChallengeStart = secondMoveEnd;
  const secondRevealStart = secondChallengeStart + TIMELINE.winningFinaleSecondChallengeHoldDuration;
  const secondRevealEnd = secondRevealStart + TIMELINE.winningFinaleSecondRevealDuration;
  const secondDaggerStart = secondRevealEnd;
  const secondDaggerEnd = secondDaggerStart + TIMELINE.winningFinaleThirdDaggerDuration;
  const secondThroneStart = secondDaggerEnd + TIMELINE.winningFinaleThroneDelay;
  const secondThroneEnd = secondThroneStart + TIMELINE.winningFinaleThroneDuration;
  const secondRewindStart = secondThroneEnd + TIMELINE.winningFinaleHoldDuration;
  const secondRewindEnd = secondRewindStart + TIMELINE.winningFinaleRewindDuration;
  const thirdMoveStart = secondRewindEnd + TIMELINE.winningFinaleRewindHoldDuration + TIMELINE.winningFinaleThirdMoveDelay;
  const thirdMoveEnd = thirdMoveStart + TIMELINE.winningFinaleThirdMoveDuration;
  const thirdChallengeStart = thirdMoveEnd;
  const thirdRevealStart = thirdChallengeStart + TIMELINE.winningFinaleThirdChallengeHoldDuration;
  const thirdRevealEnd = thirdRevealStart + TIMELINE.winningFinaleThirdRevealDuration;
  const thirdSwapStart = thirdRevealEnd + TIMELINE.winningFinaleThirdSwapDelay;
  const thirdSwapEnd = thirdSwapStart + TIMELINE.winningFinaleThirdSwapDuration;
  const thirdThroneStart = thirdSwapEnd;
  const thirdThroneEnd = thirdThroneStart + TIMELINE.winningFinaleThroneDuration;
  const thirdRewindStart = thirdThroneEnd + TIMELINE.winningFinaleHoldDuration;
  const thirdRewindEnd = thirdRewindStart + TIMELINE.winningFinaleRewindDuration;
  const crownMoveStart = thirdRewindEnd + TIMELINE.winningFinaleRewindHoldDuration + TIMELINE.winningFinaleCrownMoveDelay;
  const crownMoveEnd = crownMoveStart + TIMELINE.winningFinaleCrownMoveDuration;
  const crownThroneStart = crownMoveEnd;
  const crownThroneEnd = crownThroneStart + TIMELINE.winningFinaleThroneDuration;
  const crownHoldEnd = crownThroneEnd + TIMELINE.winningFinaleCrownHoldDuration;
  const drawRewindStart = crownHoldEnd;
  const drawRewindEnd = drawRewindStart + TIMELINE.winningFinaleRewindDuration;
  const drawMoveStart = drawRewindEnd + TIMELINE.winningFinaleRewindHoldDuration + TIMELINE.winningFinaleDrawMoveDelay;
  const drawMoveEnd = drawMoveStart + getWinningDrawMoveSequenceDuration();
  const drawIconStart = drawMoveEnd + TIMELINE.winningFinaleDrawIconDelay;
  const drawIconEnd = drawIconStart + TIMELINE.winningFinaleDrawIconDuration;
  const end = drawIconEnd + TIMELINE.winningFinaleDrawHoldDuration;
  return {
    start,
    challengeStart,
    revealStart,
    revealEnd,
    captureSlideStart,
    captureSlideEnd,
    throneStart,
    throneEnd,
    rewindStart,
    rewindEnd,
    secondMoveStart,
    secondMoveEnd,
    secondChallengeStart,
    secondRevealStart,
    secondRevealEnd,
    secondDaggerStart,
    secondDaggerEnd,
    secondThroneStart,
    secondThroneEnd,
    secondRewindStart,
    secondRewindEnd,
    thirdMoveStart,
    thirdMoveEnd,
    thirdChallengeStart,
    thirdRevealStart,
    thirdRevealEnd,
    thirdSwapStart,
    thirdSwapEnd,
    thirdThroneStart,
    thirdThroneEnd,
    thirdRewindStart,
    thirdRewindEnd,
    crownMoveStart,
    crownMoveEnd,
    crownThroneStart,
    crownThroneEnd,
    crownHoldEnd,
    drawRewindStart,
    drawRewindEnd,
    drawMoveStart,
    drawMoveEnd,
    drawIconStart,
    drawIconEnd,
    end,
  };
}

function getDeclaredMoveDuration() {
  return TIMELINE.declaredMoveDuration
    + TIMELINE.declaredMoveHoldDuration
    + TIMELINE.declaredMoveFadeDuration
    + TIMELINE.declaredMoveResetDuration;
}

function getDeclaredMoveMilestones(index) {
  const scytheMilestones = getScytheMilestones();
  const start = scytheMilestones.moveSequenceStart + (index * getDeclaredMoveDuration());
  const moveEnd = start + TIMELINE.declaredMoveDuration;
  const holdEnd = moveEnd + TIMELINE.declaredMoveHoldDuration;
  const fadeEnd = holdEnd + TIMELINE.declaredMoveFadeDuration;
  const resetEnd = fadeEnd + TIMELINE.declaredMoveResetDuration;
  return {
    start,
    moveEnd,
    holdEnd,
    fadeEnd,
    resetEnd,
  };
}

function getThoughtMoveDuration() {
  return TIMELINE.thoughtMoveDuration + TIMELINE.thoughtMoveHoldDuration;
}

function getThoughtMoveMilestones(index) {
  const scytheMilestones = getScytheMilestones();
  const start = scytheMilestones.thoughtMoveSequenceStart + (index * getThoughtMoveDuration());
  const moveEnd = start + TIMELINE.thoughtMoveDuration;
  const holdEnd = moveEnd + TIMELINE.thoughtMoveHoldDuration;
  return {
    start,
    moveEnd,
    holdEnd,
  };
}

function getThoughtBubbleTypes(move, rawProgress) {
  if (!move) return [];
  const switchProgress = Number.isFinite(move.bubbleSwitchProgress)
    ? move.bubbleSwitchProgress
    : 0;
  if (Array.isArray(move.initialBubbleTypes) && rawProgress < switchProgress) {
    return move.initialBubbleTypes;
  }
  return Array.isArray(move.bubbleTypes) ? move.bubbleTypes : [];
}

function getFinalThoughtPosition(points) {
  const lastThoughtMove = THOUGHT_MOVE_SEQUENCE[THOUGHT_MOVE_SEQUENCE.length - 1];
  return getPointFromDirection(points.center, lastThoughtMove.toDirection, 1);
}

function getSpearBubbleCursorPoint(piecePosition) {
  const bubbleSize = Math.floor(layout.squareSize * 1.08);
  const offsetX = Math.floor(layout.squareSize * 0.6);
  const offsetY = Math.floor(layout.squareSize * 0.5);
  const cellLeft = piecePosition.x - (layout.squareSize / 2);
  const cellTop = piecePosition.y - (layout.squareSize / 2);
  return {
    x: cellLeft - offsetX + (bubbleSize * 0.58),
    y: cellTop - offsetY + (bubbleSize * 0.54),
  };
}

function getHeartThoughtBubbleCursorPoint(piecePosition) {
  const bubbleSize = Math.floor(layout.squareSize * 1.08);
  const offsetX = Math.floor(layout.squareSize * 0.6);
  const offsetY = Math.floor(layout.squareSize * 0.5);
  const cellLeft = piecePosition.x - (layout.squareSize / 2);
  const cellTop = piecePosition.y - (layout.squareSize / 2);
  const bubbleLeft = cellLeft + layout.squareSize - bubbleSize + offsetX;
  return {
    x: bubbleLeft + (bubbleSize * 0.54),
    y: cellTop - offsetY + (bubbleSize * 0.54),
  };
}

function getChallengeButtonPoint(points) {
  return {
    x: points.center.x + (layout.squareSize * 1.85),
    y: points.center.y - (layout.squareSize * 2.2),
  };
}

function getCapturesChallengeButtonPoint(points) {
  return {
    x: points.center.x + (layout.squareSize * 1.9),
    y: points.center.y - (layout.squareSize * 1.25),
  };
}

function getCapturesPoisonButtonPoint(points) {
  const challenge = getCapturesChallengeButtonPoint(points);
  return {
    x: challenge.x,
    y: challenge.y + (layout.squareSize * 1.08),
  };
}

function getCapturedTiltOffset(progress = 1) {
  const amount = clamp(0, progress, 1);
  return {
    x: layout.squareSize * 0.22 * amount,
    y: -layout.squareSize * 0.08 * amount,
  };
}

function getCapturedTiltedPoint(anchor, progress = 1) {
  const offset = getCapturedTiltOffset(progress);
  return {
    x: anchor.x + offset.x,
    y: anchor.y + offset.y,
  };
}

function getDaggerSlotSize() {
  return Math.max(44, Math.floor((layout?.squareSize || 100) * 0.56));
}

function getDaggerSlotGap() {
  return Math.max(5, Math.floor(getDaggerSlotSize() * 0.16));
}

function getDaggerSlotsCenter(points) {
  return getChallengeButtonPoint(points);
}

function getDaggerSlotPoint(points, index) {
  const center = getDaggerSlotsCenter(points);
  const spacing = getDaggerSlotSize() + getDaggerSlotGap();
  return {
    x: center.x + ((index - 1) * spacing),
    y: center.y,
  };
}

function getBoardPoints() {
  if (!layout) return null;
  const center = {
    x: layout.width / 2,
    y: layout.height / 2,
  };
  return {
    center,
    upperRight: {
      x: center.x + layout.squareSize,
      y: center.y - layout.squareSize,
    },
    left: {
      x: center.x - layout.squareSize,
      y: center.y,
    },
    whiteOffscreen: {
      x: layout.width + layout.pieceSize,
      y: -layout.pieceSize,
    },
    blackOffscreen: {
      x: -layout.pieceSize,
      y: center.y,
    },
  };
}

function getLineSequenceConfigs() {
  return [
    {
      key: 'sword',
      identity: IDENTITIES.ROOK,
      directions: STRAIGHT_DIRECTIONS,
      whiteDirection: { row: 1, col: 0 },
      blackDirection: { row: -1, col: 0 },
      milestones: getSwordMilestones(),
    },
    {
      key: 'spear',
      identity: IDENTITIES.BISHOP,
      directions: DIAGONAL_DIRECTIONS,
      whiteDirection: { row: 1, col: 1 },
      blackDirection: { row: -1, col: -1 },
      milestones: getSpearMilestones(),
    },
  ];
}

function getPointFromDirection(origin, direction, distanceSquares) {
  return {
    x: origin.x + (direction.col * layout.squareSize * distanceSquares),
    y: origin.y + (direction.row * layout.squareSize * distanceSquares),
  };
}

function getBlockerOffscreenPoint(target, direction) {
  if (!layout) return { x: target.x, y: target.y };
  if (direction.row > 0) {
    return { x: target.x, y: layout.height + layout.pieceSize };
  }
  if (direction.row < 0) {
    return { x: target.x, y: -layout.pieceSize };
  }
  if (direction.col > 0) {
    return { x: layout.width + layout.pieceSize, y: target.y };
  }
  return { x: -layout.pieceSize, y: target.y };
}

function getKnightOffscreenPoint(target, direction) {
  if (!layout) return { x: target.x, y: target.y };
  if (Math.abs(direction.col) > Math.abs(direction.row)) {
    return {
      x: direction.col > 0 ? layout.width + layout.pieceSize : -layout.pieceSize,
      y: target.y,
    };
  }
  return {
    x: target.x,
    y: direction.row > 0 ? layout.height + layout.pieceSize : -layout.pieceSize,
  };
}

function interpolatePoint(start, end, progress) {
  return {
    x: start.x + ((end.x - start.x) * progress),
    y: start.y + ((end.y - start.y) * progress),
  };
}

function getLineArrowDistance(elapsed) {
  if (elapsed <= 0) return 0;
  const stepSpan = TIMELINE.lineArrowStepDuration + TIMELINE.lineArrowStepPause;
  for (let step = 0; step < 3; step += 1) {
    const stepStart = step * stepSpan;
    const growEnd = stepStart + TIMELINE.lineArrowStepDuration;
    if (elapsed < growEnd) {
      return step + easeOutCubic((elapsed - stepStart) / TIMELINE.lineArrowStepDuration);
    }
    if (step < 2 && elapsed < growEnd + TIMELINE.lineArrowStepPause) {
      return step + 1;
    }
  }
  return 3;
}

function getKnightCornerPoint(origin, direction) {
  if (Math.abs(direction.row) > Math.abs(direction.col)) {
    return getPointFromDirection(origin, { row: direction.row, col: 0 }, 1);
  }
  return getPointFromDirection(origin, { row: 0, col: direction.col }, 1);
}

function getKnightArrowPoints(origin, direction, progress) {
  const corner = getKnightCornerPoint(origin, direction);
  const target = getPointFromDirection(origin, direction, 1);
  const visibleDistance = clamp(0, progress, 1) * 3;
  if (visibleDistance <= 0) return null;
  if (visibleDistance < 2) {
    const firstLegProgress = visibleDistance / 2;
    return [origin, interpolatePoint(origin, corner, firstLegProgress)];
  }
  return [origin, corner, interpolatePoint(corner, target, visibleDistance - 2)];
}

function getPieceVisualState(index, time) {
  const fadeStart = TIMELINE.fadeStartDelay + (index * TIMELINE.fadeStagger);
  const fadeProgress = clamp(0, (time - fadeStart) / TIMELINE.fadeDuration, 1);
  const fadeEase = easeOutCubic(fadeProgress);
  const fadeEnd = TIMELINE.fadeStartDelay
    + ((PIECE_COUNT - 1) * TIMELINE.fadeStagger)
    + TIMELINE.fadeDuration;
  const flipStart = fadeEnd + TIMELINE.pauseAfterFade + (index * TIMELINE.flipStagger);
  const flipElapsed = time - flipStart;
  const flipDuration = TIMELINE.flipHalfDuration * 2;
  const lastFlipEnd = fadeEnd
    + TIMELINE.pauseAfterFade
    + ((PIECE_COUNT - 1) * TIMELINE.flipStagger)
    + flipDuration;
  const spreadStart = lastFlipEnd + TIMELINE.pauseAfterFlip;
  const spreadProgress = easeInOutCubic((time - spreadStart) / TIMELINE.spreadDuration);
  let identity = UNKNOWN_IDENTITY;
  let scaleX = 1;
  let shiftX = 0;
  let shiftY = 0;
  let opacity = fadeEase;
  let shakeX = 0;

  if (flipElapsed >= 0) {
    if (flipElapsed < TIMELINE.flipHalfDuration) {
      scaleX = Math.max(0.02, 1 - easeInCubic(flipElapsed / TIMELINE.flipHalfDuration));
    } else {
      identity = REVEAL_IDENTITIES[index] || UNKNOWN_IDENTITY;
      scaleX = Math.max(0.02, easeOutCubic((flipElapsed - TIMELINE.flipHalfDuration) / TIMELINE.flipHalfDuration));
    }
  }

  if (flipElapsed >= flipDuration) {
    identity = REVEAL_IDENTITIES[index] || UNKNOWN_IDENTITY;
    scaleX = 1;
  }

  if (layout && time >= spreadStart) {
    const originalCenterX = layout.rowLeft + ((index + 0.5) * layout.squareSize);
    const targetCenterX = index === 0
      ? layout.width / 2
      : (layout.width / 2) + (index * layout.squareSize * 8);
    shiftX = (targetCenterX - originalCenterX) * spreadProgress;
    if (index > 0) {
      opacity = fadeEase * (1 - spreadProgress);
    }
  }

  if (index === 0 && layout) {
    const points = getBoardPoints();
    const milestones = getInteractionMilestones();
    if (points && time >= milestones.whiteSlideEnd && time < milestones.probeEnd) {
      const progress = easeInOutCubic((time - milestones.whiteSlideEnd) / TIMELINE.heartProbeDuration);
      shiftX += (points.upperRight.x - points.center.x) * 0.2 * progress;
      shiftY += (points.upperRight.y - points.center.y) * 0.2 * progress;
    } else if (points && time >= milestones.probeEnd && time < milestones.returnEnd) {
      const progress = easeInOutCubic((time - milestones.probeEnd) / TIMELINE.heartReturnDuration);
      shiftX += (points.upperRight.x - points.center.x) * 0.2 * (1 - progress);
      shiftY += (points.upperRight.y - points.center.y) * 0.2 * (1 - progress);
    } else if (time >= milestones.returnEnd && time < milestones.shakeEnd) {
      const raw = (time - milestones.returnEnd) / TIMELINE.heartShakeDuration;
      const decay = 1 - clamp(0, raw, 1);
      shakeX = Math.sin(raw * Math.PI * 8) * layout.squareSize * 0.045 * decay;
    } else if (points && time >= milestones.captureStart && time < milestones.captureEnd) {
      const progress = easeInOutCubic((time - milestones.captureStart) / TIMELINE.captureSlideDuration);
      shiftX += (points.left.x - points.center.x) * progress;
    } else if (points && time >= milestones.captureEnd && time < milestones.blackFadeEnd) {
      shiftX += points.left.x - points.center.x;
    } else if (points && time >= milestones.blackFadeEnd) {
      const progress = easeInOutCubic((time - milestones.blackFadeEnd) / TIMELINE.finalResetDuration);
      shiftX += (points.left.x - points.center.x) * (1 - progress);
    }

    const swordMilestones = getSwordMilestones();
    if (points && time >= swordMilestones.swapStart) {
      const progress = easeInOutCubic((time - swordMilestones.swapStart) / TIMELINE.linePieceSwapDuration);
      shiftX += ((-layout.pieceSize) - points.center.x) * progress;
      opacity *= 1 - progress;
    }
  }

  return {
    identity,
    opacity,
    shiftX,
    shiftY,
    shakeX,
    yPercent: -42 - (fadeEase * 8),
    scale: 0.86 + (fadeEase * 0.14),
    scaleX,
    blur: 2 * (1 - fadeEase),
    shadowAlpha: 0.2 + (fadeEase * 0.22),
  };
}

function renderAnimationFrame(time) {
  drawBoard();
  renderSetupWipeTransform(time);
  const pieces = ensurePieces();
  pieces.forEach((piece, index) => {
    const state = getPieceVisualState(index, time);
    if (layout) {
      const centerX = layout.rowLeft + ((index + 0.5) * layout.squareSize) + state.shiftX + state.shakeX;
      const centerY = layout.rowTop + (layout.squareSize / 2) + state.shiftY;
      piece.style.left = `${centerX}px`;
      piece.style.top = `${centerY}px`;
    }
    renderPieceContent(piece, state.identity);
    piece.style.opacity = String(state.opacity);
    piece.style.transform = `translate(-50%, ${state.yPercent}%) scale(${state.scale}) scaleX(${state.scaleX})`;
    piece.style.filter = `blur(${state.blur}px) drop-shadow(0 14px 14px rgba(0, 0, 0, ${state.shadowAlpha}))`;
  });
  renderInteractionActors(time);
  renderLineSequenceActors(time);
  renderScytheActors(time);
  renderDeclaredMoveDemo(time);
  renderCapturesPoisonDemo(time);
  renderSetupActors(time);
  renderKingArrows(time);
  renderTopArrows(time);
  renderWinningMoveSequence(time);
  renderWinningFinale(time);
}

function renderSetupWipeTransform(time) {
  if (!layout) return;
  const milestones = getSetupMilestones();
  let offsetX = 0;

  if (time >= milestones.start && time < milestones.wipeEnd) {
    const progress = easeInOutCubic((time - milestones.start) / TIMELINE.setupWipeDuration);
    offsetX = -layout.width * progress;
  }

  const transform = offsetX ? `translateX(${offsetX}px)` : '';
  if (actorStage) actorStage.style.transform = transform;
  if (pieceStage) {
    pieceStage.style.transform = transform;
    pieceStage.style.opacity = time >= milestones.wipeEnd ? '0' : '1';
  }
}

function renderKingArrows(time) {
  const svg = ensureArrowLayer();
  if (!svg || !layout) return;
  while (svg.firstChild) {
    svg.removeChild(svg.lastChild);
  }
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute('width', `${layout.width}`);
  svg.setAttribute('height', `${layout.height}`);

  const sequenceStart = getArrowSequenceStartTime();
  const milestones = getInteractionMilestones();
  const finalFadeProgress = easeInOutCubic((time - milestones.blackFadeEnd) / TIMELINE.finalResetDuration);
  const origin = {
    x: layout.width / 2,
    y: layout.height / 2,
  };
  KING_ARROW_DIRECTIONS.forEach((direction, index) => {
    const progress = easeOutCubic((time - sequenceStart - (index * TIMELINE.arrowStagger)) / TIMELINE.arrowDuration);
    if (progress <= 0) return;
    let opacity = progress * (1 - finalFadeProgress);
    if (index === 1 && time >= milestones.interactionStart) {
      const vanishProgress = easeInOutCubic((time - milestones.interactionStart) / TIMELINE.whiteSlideDuration);
      opacity *= 1 - vanishProgress;
    }
    if (opacity <= 0) return;
    const target = {
      x: origin.x + (direction.col * layout.squareSize * progress),
      y: origin.y + (direction.row * layout.squareSize * progress),
    };
    appendStraightArrow(svg, origin, target, layout.squareSize, opacity);
  });
  renderInteractionMarks(svg, time);
  renderLineSequenceAnnotations(svg, time);
  renderCloakThoughtMoveTargets(svg, time);
}

function renderTopArrows(time) {
  const svg = ensureTopArrowLayer();
  if (!svg || !layout) return;
  while (svg.firstChild) {
    svg.removeChild(svg.lastChild);
  }
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute('width', `${layout.width}`);
  svg.setAttribute('height', `${layout.height}`);
  renderScytheAnnotations(svg, time);
}

function renderScytheAnnotations(svg, time) {
  const points = getBoardPoints();
  if (!points) return;
  const milestones = getScytheMilestones();
  if (time < milestones.arrowStart || time >= milestones.clearEnd) return;

  const clearFade = time >= milestones.rowHoldEnd
    ? easeInOutCubic((time - milestones.rowHoldEnd) / TIMELINE.lineClearDuration)
    : 0;
  const whiteVanish = easeInOutCubic((time - milestones.targetStart) / TIMELINE.lineBlockerSlideDuration);
  const opacityMultiplier = 1 - clearFade;

  KNIGHT_DIRECTIONS.forEach((direction, index) => {
    const progress = easeOutCubic((time - milestones.arrowStart - (index * TIMELINE.lineArrowDirectionStagger)) / TIMELINE.arrowDuration);
    if (progress <= 0) return;
    let opacity = Math.min(1, progress * 1.35) * opacityMultiplier;
    if (directionsEqual(direction, SCYTHE_WHITE_DIRECTION)) {
      opacity *= 1 - whiteVanish;
    }
    if (opacity <= 0) return;
    const arrowPoints = getKnightArrowPoints(points.center, direction, progress);
    appendPathArrow(svg, arrowPoints, layout.squareSize, opacity);
  });

  if (time >= milestones.targetStart && opacityMultiplier > 0) {
    const circleOpacity = Math.min(
      opacityMultiplier,
      easeOutCubic((time - milestones.targetStart) / TIMELINE.lineBlockerSlideDuration)
    );
    appendCircle(svg, getPointFromDirection(points.center, SCYTHE_BLACK_DIRECTION, 1), layout.squareSize, circleOpacity);
  }
}

function renderInteractionMarks(svg, time) {
  const points = getBoardPoints();
  if (!points) return;
  const milestones = getInteractionMilestones();
  if (time < milestones.shakeEnd || time >= milestones.blackFadeEnd) return;

  let opacity = 0;
  if (time < milestones.blackSlideEnd) {
    opacity = easeOutCubic((time - milestones.shakeEnd) / TIMELINE.blackSlideDuration);
  } else if (time < milestones.blackFadeStart) {
    opacity = 1;
  } else {
    opacity = 1 - easeInOutCubic((time - milestones.blackFadeStart) / TIMELINE.blackFadeDuration);
  }
  if (opacity > 0) {
    appendCircle(svg, points.left, layout.squareSize, opacity);
  }
}

function appendMoveTargetDot(svg, center, squareSize, opacity = 0.4) {
  const dot = createSvgElement('circle');
  dot.setAttribute('cx', `${center.x}`);
  dot.setAttribute('cy', `${center.y}`);
  dot.setAttribute('r', `${squareSize * 0.14}`);
  dot.setAttribute('fill', `rgba(0, 0, 0, ${clamp(0, opacity, 1)})`);
  dot.setAttribute('pointer-events', 'none');
  svg.appendChild(dot);
}

function getCloakThoughtMoveTargetPoints(origin) {
  const targets = new Map();
  const addTarget = (direction, distance = 1) => {
    const point = getPointFromDirection(origin, direction, distance);
    const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
    targets.set(key, point);
  };

  KING_ARROW_DIRECTIONS.forEach((direction) => addTarget(direction, 1));
  STRAIGHT_DIRECTIONS.forEach((direction) => {
    for (let distance = 1; distance <= 3; distance += 1) addTarget(direction, distance);
  });
  DIAGONAL_DIRECTIONS.forEach((direction) => {
    for (let distance = 1; distance <= 3; distance += 1) addTarget(direction, distance);
  });
  KNIGHT_DIRECTIONS.forEach((direction) => addTarget(direction, 1));

  return Array.from(targets.values()).filter((point) => (
    point.x >= 0
    && point.x <= layout.width
    && point.y >= 0
    && point.y <= layout.height
  ));
}

function renderCloakThoughtMoveTargets(svg, time) {
  const points = getBoardPoints();
  if (!points) return;
  const milestones = getScytheMilestones();
  if (time < milestones.thoughtMoveSequenceStart || time >= milestones.thoughtMoveSequenceEnd) return;

  const fadeIn = easeOutCubic((time - milestones.thoughtMoveSequenceStart) / 180);
  const fadeOut = 1 - easeInOutCubic((time - (milestones.thoughtMoveSequenceEnd - 260)) / 260);
  const opacity = 0.4 * clamp(0, Math.min(fadeIn, fadeOut), 1);
  if (opacity <= 0) return;

  getCloakThoughtMoveTargetPoints(points.center).forEach((point) => {
    appendMoveTargetDot(svg, point, layout.squareSize, opacity);
  });
}

function renderInteractionActors(time) {
  if (!layout) return;
  const points = getBoardPoints();
  const milestones = getInteractionMilestones();
  if (!points) return;

  const whiteActor = ensureActor('animationWhiteIntruder');
  const blackActor = ensureActor('animationBlackTarget', 'animation-piece--captured');

  renderPieceContent(whiteActor, UNKNOWN_IDENTITY, WHITE);
  renderPieceContent(blackActor, UNKNOWN_IDENTITY, BLACK);
  whiteActor.style.setProperty('--piece-size', `${layout.pieceSize}px`);
  blackActor.style.setProperty('--piece-size', `${layout.pieceSize}px`);

  let whiteX = points.whiteOffscreen.x;
  let whiteY = points.whiteOffscreen.y;
  let whiteOpacity = 0;
  if (time >= milestones.interactionStart && time < milestones.blackFadeEnd) {
    const progress = easeInOutCubic((time - milestones.interactionStart) / TIMELINE.whiteSlideDuration);
    whiteX = points.whiteOffscreen.x + ((points.upperRight.x - points.whiteOffscreen.x) * progress);
    whiteY = points.whiteOffscreen.y + ((points.upperRight.y - points.whiteOffscreen.y) * progress);
    whiteOpacity = progress;
  } else if (time >= milestones.blackFadeEnd) {
    const progress = easeInOutCubic((time - milestones.blackFadeEnd) / TIMELINE.finalResetDuration);
    whiteX = points.upperRight.x + ((points.whiteOffscreen.x - points.upperRight.x) * progress);
    whiteY = points.upperRight.y + ((points.whiteOffscreen.y - points.upperRight.y) * progress);
    whiteOpacity = 1 - progress;
  }

  whiteActor.style.left = `${whiteX}px`;
  whiteActor.style.top = `${whiteY}px`;
  whiteActor.style.opacity = `${clamp(0, whiteOpacity, 1)}`;
  whiteActor.style.transform = 'translate(-50%, -50%) scale(1)';
  whiteActor.style.filter = 'drop-shadow(0 14px 14px rgba(0, 0, 0, 0.42))';

  let blackX = points.blackOffscreen.x;
  let blackY = points.blackOffscreen.y;
  let blackOpacity = 0;
  let blackRotation = 0;
  if (time >= milestones.shakeEnd && time < milestones.blackSlideEnd) {
    const progress = easeInOutCubic((time - milestones.shakeEnd) / TIMELINE.blackSlideDuration);
    blackX = points.blackOffscreen.x + ((points.left.x - points.blackOffscreen.x) * progress);
    blackY = points.left.y;
    blackOpacity = progress;
  } else if (time >= milestones.blackSlideEnd && time < milestones.blackFadeStart) {
    blackX = points.left.x;
    blackY = points.left.y;
    blackOpacity = 1;
    if (time >= milestones.captureStart) {
      const tiltProgress = easeInOutCubic((time - milestones.captureStart) / TIMELINE.captureSlideDuration);
      const tilted = getCapturedTiltedPoint(points.left, tiltProgress);
      blackX = tilted.x;
      blackY = tilted.y;
      blackRotation = 30 * tiltProgress;
    }
  } else if (time >= milestones.blackFadeStart && time < milestones.blackFadeEnd) {
    const progress = easeInOutCubic((time - milestones.blackFadeStart) / TIMELINE.blackFadeDuration);
    const tilted = getCapturedTiltedPoint(points.left, 1);
    blackX = tilted.x;
    blackY = tilted.y;
    blackOpacity = 1 - progress;
    blackRotation = 30;
  }

  blackActor.style.left = `${blackX}px`;
  blackActor.style.top = `${blackY}px`;
  blackActor.style.opacity = `${clamp(0, blackOpacity, 1)}`;
  blackActor.style.transform = `translate(-50%, -50%) rotate(${blackRotation}deg) scale(1)`;
  blackActor.style.filter = 'drop-shadow(0 14px 14px rgba(0, 0, 0, 0.42))';
}

function renderLineSequenceActors(time) {
  if (!layout) return;
  const points = getBoardPoints();
  if (!points) return;

  getLineSequenceConfigs().forEach((config, index) => {
    renderLineActiveActor(config, index, time, points);
    renderLineBlockerActors(config, time, points);
  });
}

function renderLineActiveActor(config, index, time, points) {
  const actor = ensureActor(`animation${config.key}Active`);
  const milestones = config.milestones;
  const rightOffscreen = { x: layout.width + layout.pieceSize, y: points.center.y };
  const leftOffscreen = { x: -layout.pieceSize, y: points.center.y };
  let position = { ...rightOffscreen };
  let opacity = 0;

  if (time >= milestones.swapStart && time < milestones.swapEnd) {
    const progress = easeInOutCubic((time - milestones.swapStart) / TIMELINE.linePieceSwapDuration);
    position = interpolatePoint(rightOffscreen, points.center, progress);
    opacity = progress;
  } else if (time >= milestones.swapEnd) {
    position = { ...points.center };
    opacity = 1;
  }

  const exitMilestones = index === 0
    ? getSpearMilestones()
    : (index === 1 ? getScytheMilestones() : null);
  if (exitMilestones && time >= exitMilestones.swapStart) {
    const progress = easeInOutCubic((time - exitMilestones.swapStart) / TIMELINE.linePieceSwapDuration);
    position = interpolatePoint(points.center, leftOffscreen, progress);
    opacity = 1 - progress;
  }

  if (time >= milestones.clearEnd && !exitMilestones) {
    position = { ...points.center };
    opacity = 1;
  }

  renderPieceContent(actor, config.identity, WHITE);
  actor.style.setProperty('--piece-size', `${layout.pieceSize}px`);
  actor.style.left = `${position.x}px`;
  actor.style.top = `${position.y}px`;
  actor.style.opacity = `${clamp(0, opacity, 1)}`;
  actor.style.transform = 'translate(-50%, -50%) scale(1)';
  actor.style.filter = 'drop-shadow(0 14px 14px rgba(0, 0, 0, 0.42))';
}

function renderScytheActors(time) {
  if (!layout) return;
  const points = getBoardPoints();
  if (!points) return;

  const milestones = getScytheMilestones();
  const scytheActor = ensureActor('animationScytheActive');
  const poisonActor = ensureActor('animationPoisonActive');
  const rightOffscreen = { x: layout.width + layout.pieceSize, y: points.center.y };
  const leftOffscreen = { x: -layout.pieceSize, y: points.center.y };

  let scythePosition = { ...rightOffscreen };
  let scytheOpacity = 0;
  if (time >= milestones.swapStart && time < milestones.swapEnd) {
    const progress = easeInOutCubic((time - milestones.swapStart) / TIMELINE.linePieceSwapDuration);
    scythePosition = interpolatePoint(rightOffscreen, points.center, progress);
    scytheOpacity = progress;
  } else if (time >= milestones.swapEnd && time < milestones.rowHoldEnd) {
    scythePosition = { ...points.center };
    scytheOpacity = 1;
  } else if (time >= milestones.rowHoldEnd && time < milestones.clearEnd) {
    const progress = easeInOutCubic((time - milestones.rowHoldEnd) / TIMELINE.lineClearDuration);
    scythePosition = interpolatePoint(points.center, leftOffscreen, progress);
    scytheOpacity = 1 - progress;
  }
  renderPositionedActor(scytheActor, IDENTITIES.KNIGHT, WHITE, scythePosition, scytheOpacity);

  let poisonPosition = { ...rightOffscreen };
  let poisonOpacity = 0;
  if (time >= milestones.poisonStart && time < milestones.poisonEnd) {
    const progress = easeInOutCubic((time - milestones.poisonStart) / TIMELINE.linePieceSwapDuration);
    poisonPosition = interpolatePoint(rightOffscreen, points.center, progress);
    poisonOpacity = progress;
  } else if (time >= milestones.poisonEnd) {
    poisonPosition = { ...points.center };
    poisonOpacity = 1;
  }
  renderPositionedActor(poisonActor, IDENTITIES.BOMB, WHITE, poisonPosition, poisonOpacity);

  renderScytheTargetActor(
    ensureActor('animationScytheWhiteBlocker'),
    WHITE,
    getPointFromDirection(points.center, SCYTHE_WHITE_DIRECTION, 1),
    getKnightOffscreenPoint(getPointFromDirection(points.center, SCYTHE_WHITE_DIRECTION, 1), SCYTHE_WHITE_DIRECTION),
    time,
    milestones
  );
  renderScytheTargetActor(
    ensureActor('animationScytheBlackTarget'),
    BLACK,
    getPointFromDirection(points.center, SCYTHE_BLACK_DIRECTION, 1),
    getKnightOffscreenPoint(getPointFromDirection(points.center, SCYTHE_BLACK_DIRECTION, 1), SCYTHE_BLACK_DIRECTION),
    time,
    milestones
  );

  SCYTHE_ROW_BLOCKERS.forEach((direction, index) => {
    const target = getPointFromDirection(points.center, direction, 1);
    renderScytheRowActor(
      ensureUnderArrowActor(`animationScytheRowBlocker${index}`),
      target,
      getBlockerOffscreenPoint(target, { row: -1, col: 0 }),
      time,
      milestones
    );
  });
}

function renderPositionedActor(actor, identity, color, position, opacity) {
  renderPieceContent(actor, identity, color);
  actor.style.setProperty('--piece-size', `${layout.pieceSize}px`);
  actor.style.left = `${position.x}px`;
  actor.style.top = `${position.y}px`;
  actor.style.opacity = `${clamp(0, opacity, 1)}`;
  actor.style.transform = 'translate(-50%, -50%) scale(1)';
  actor.style.filter = 'drop-shadow(0 14px 14px rgba(0, 0, 0, 0.42))';
}

function renderDeclaredMoveDemo(time) {
  if (!layout) return;
  const points = getBoardPoints();
  if (!points) return;

  const milestones = getScytheMilestones();
  if (time < milestones.flipStart) {
    hideDeclaredMoveOverlays();
    return;
  }

  const actor = ensureActor('animationPoisonActive');
  let identity = IDENTITIES.BOMB;
  let position = { ...points.center };
  let opacity = 1;
  let scaleX = 1;
  let activeMove = null;
  let activeThoughtMove = null;
  let moveOpacity = 0;
  let overlayOrigin = points.center;
  let bubblePosition = null;
  let showCursor = false;
  let cursorMode = 'spear';
  let challengeTiltOffset = { x: 0, y: 0 };

  if (time < milestones.flipMid) {
    scaleX = Math.max(0.02, 1 - easeInCubic((time - milestones.flipStart) / TIMELINE.flipHalfDuration));
  } else {
    identity = UNKNOWN_IDENTITY;
    if (time < milestones.flipEnd) {
      scaleX = Math.max(0.02, easeOutCubic((time - milestones.flipMid) / TIMELINE.flipHalfDuration));
    }
  }

  DECLARED_MOVE_SEQUENCE.forEach((move, index) => {
    if (activeMove) return;
    const moveMilestones = getDeclaredMoveMilestones(index);
    if (time < moveMilestones.start || time >= moveMilestones.resetEnd) return;
    activeMove = {
      ...move,
      bubbleTypes: [move.bubbleType],
      milestones: moveMilestones,
    };
  });

  if (activeMove) {
    const target = getPointFromDirection(points.center, activeMove.direction, 1);
    const moveMilestones = activeMove.milestones;
    if (time < moveMilestones.moveEnd) {
      const progress = easeInOutCubic((time - moveMilestones.start) / TIMELINE.declaredMoveDuration);
      position = interpolatePoint(points.center, target, progress);
      moveOpacity = 1;
    } else if (time < moveMilestones.holdEnd) {
      position = { ...target };
      moveOpacity = 1;
    } else if (time < moveMilestones.fadeEnd) {
      const progress = easeInOutCubic((time - moveMilestones.holdEnd) / TIMELINE.declaredMoveFadeDuration);
      position = { ...target };
      opacity = 1 - progress;
      moveOpacity = opacity;
    } else {
      const progress = easeInOutCubic((time - moveMilestones.fadeEnd) / TIMELINE.declaredMoveResetDuration);
      position = { ...points.center };
      opacity = progress;
      moveOpacity = 0;
    }
  } else {
    THOUGHT_MOVE_SEQUENCE.forEach((move, index) => {
      if (activeThoughtMove) return;
      const moveMilestones = getThoughtMoveMilestones(index);
      if (time < moveMilestones.start || time >= moveMilestones.holdEnd) return;
      activeThoughtMove = { ...move, milestones: moveMilestones };
    });

    if (activeThoughtMove) {
      const moveMilestones = activeThoughtMove.milestones;
      const start = getPointFromDirection(points.center, activeThoughtMove.fromDirection, 1);
      const target = getPointFromDirection(points.center, activeThoughtMove.toDirection, 1);
      const rawProgress = clamp(0, (time - moveMilestones.start) / TIMELINE.thoughtMoveDuration, 1);
      activeThoughtMove.bubbleTypes = getThoughtBubbleTypes(activeThoughtMove, rawProgress);
      overlayOrigin = points.center;
      if (time < moveMilestones.moveEnd) {
        position = interpolatePoint(start, target, easeInOutCubic(rawProgress));
      } else {
        position = { ...target };
      }
      moveOpacity = 1;
    } else if (time >= milestones.declaredMoveSequenceEnd) {
      position = getFinalThoughtPosition(points);
      bubblePosition = position;
      if (time < milestones.challengeCursorClickStart) {
        activeThoughtMove = {
          bubbleTypes: time < milestones.cursorClickEnd
            ? ['kingThoughtRight', 'bishopThoughtLeft']
            : ['bishopSpeechLeft'],
        };
        moveOpacity = 1;
      } else {
        activeThoughtMove = {
          bubbleTypes: ['bishopSpeechLeft'],
        };
        moveOpacity = 1;
      }
      showCursor = time >= milestones.cursorStart && time < milestones.cursorExitEnd;
    }
  }

  if (time >= milestones.challengeFlipStart) {
    activeThoughtMove = {
      bubbleTypes: ['bishopSpeechLeft'],
    };
    moveOpacity = 1;
    if (time >= milestones.rewindFlipMid) {
      identity = UNKNOWN_IDENTITY;
      scaleX = Math.max(0.02, easeOutCubic((time - milestones.rewindFlipMid) / (TIMELINE.rewindFlipDuration / 2)));
      opacity = 1;
      actor.style.setProperty('--challenge-rotation', '0deg');
    } else if (time >= milestones.rewindRestoreEnd) {
      identity = IDENTITIES.BOMB;
      scaleX = Math.max(0.02, 1 - easeInCubic((time - milestones.rewindRestoreEnd) / (TIMELINE.rewindFlipDuration / 2)));
      opacity = 1;
      actor.style.setProperty('--challenge-rotation', '0deg');
    } else if (time >= milestones.rewindStart) {
      identity = IDENTITIES.BOMB;
      const progress = easeInOutCubic((time - milestones.rewindStart) / TIMELINE.rewindRestoreDuration);
      opacity = progress;
      challengeTiltOffset = getCapturedTiltOffset(1 - progress);
      actor.style.setProperty('--challenge-rotation', `${30 * (1 - progress)}deg`);
    } else if (time < milestones.challengeFlipMid) {
      scaleX = Math.max(0.02, 1 - easeInCubic((time - milestones.challengeFlipStart) / (TIMELINE.challengeFlipDuration / 2)));
    } else {
      identity = IDENTITIES.BOMB;
      if (time < milestones.challengeFlipEnd) {
        scaleX = Math.max(0.02, easeOutCubic((time - milestones.challengeFlipMid) / (TIMELINE.challengeFlipDuration / 2)));
      }
    }
    if (time >= milestones.challengeFlipEnd && time < milestones.challengeTiltEnd) {
      const progress = easeInOutCubic((time - milestones.challengeFlipEnd) / TIMELINE.challengeTiltDuration);
      challengeTiltOffset = getCapturedTiltOffset(progress);
      actor.style.setProperty('--challenge-rotation', `${30 * progress}deg`);
    } else if (time >= milestones.challengeTiltEnd && time < milestones.rewindStart) {
      opacity = 1 - easeInOutCubic((time - milestones.challengeTiltEnd) / TIMELINE.challengeFadeDuration);
      challengeTiltOffset = getCapturedTiltOffset(1);
      actor.style.setProperty('--challenge-rotation', '30deg');
    }
  } else {
    actor.style.setProperty('--challenge-rotation', '0deg');
  }

  if (time >= milestones.challengeCursorStart && time < milestones.challengeCursorExitEnd) {
    showCursor = true;
    cursorMode = 'challenge';
  }

  if (time >= milestones.secondChallengeButtonStart) {
    position = getFinalThoughtPosition(points);
    bubblePosition = getFinalThoughtPosition(points);
    activeThoughtMove = {
      bubbleTypes: time < milestones.finalBubbleFadeEnd ? ['bishopSpeechLeft'] : [],
    };
    moveOpacity = time < milestones.swordSlideEnd
      ? 1
      : 1 - easeInOutCubic((time - milestones.swordSlideEnd) / TIMELINE.finalBubbleFadeDuration);
    actor.style.setProperty('--challenge-rotation', '0deg');
    opacity = 1;
    scaleX = 1;
    identity = UNKNOWN_IDENTITY;

    if (time >= milestones.secondChallengeFlipStart && time < milestones.secondChallengeFlipMid) {
      scaleX = Math.max(0.02, 1 - easeInCubic((time - milestones.secondChallengeFlipStart) / (TIMELINE.challengeFlipDuration / 2)));
    } else if (time >= milestones.secondChallengeFlipMid) {
      identity = IDENTITIES.BISHOP;
      if (time < milestones.secondChallengeFlipEnd) {
        scaleX = Math.max(0.02, easeOutCubic((time - milestones.secondChallengeFlipMid) / (TIMELINE.challengeFlipDuration / 2)));
      }
    }

    if (time >= milestones.secondRevealHoldEnd && time < milestones.finalPieceSlideEnd) {
      const progress = easeInOutCubic((time - milestones.secondRevealHoldEnd) / TIMELINE.finalPieceSlideDuration);
      position = interpolatePoint(getFinalThoughtPosition(points), {
        x: getFinalThoughtPosition(points).x,
        y: layout.height + layout.pieceSize,
      }, progress);
      opacity = 1 - progress;
    } else if (time >= milestones.finalPieceSlideEnd) {
      identity = IDENTITIES.ROOK;
      const progress = easeInOutCubic((time - milestones.finalPieceSlideEnd) / TIMELINE.swordSlideDuration);
      position = interpolatePoint({
        x: getFinalThoughtPosition(points).x,
        y: layout.height + layout.pieceSize,
      }, getFinalThoughtPosition(points), progress);
      opacity = progress;
    }

    if (time >= milestones.swordSlideEnd && time < milestones.swordFlipMid) {
      identity = IDENTITIES.ROOK;
      scaleX = Math.max(0.02, 1 - easeInCubic((time - milestones.swordSlideEnd) / (TIMELINE.swordFlipDuration / 2)));
      position = getFinalThoughtPosition(points);
      opacity = 1;
    } else if (time >= milestones.swordFlipMid) {
      identity = UNKNOWN_IDENTITY;
      scaleX = Math.max(0.02, easeOutCubic((time - milestones.swordFlipMid) / (TIMELINE.swordFlipDuration / 2)));
      position = getFinalThoughtPosition(points);
      opacity = 1;
    }
  }

  if (time >= milestones.secondChallengeCursorStart && time < milestones.secondChallengeCursorExitEnd) {
    showCursor = true;
    cursorMode = 'secondChallenge';
  }

  renderPieceContent(actor, identity, WHITE);
  actor.style.setProperty('--piece-size', `${layout.pieceSize}px`);
  actor.style.left = `${position.x + challengeTiltOffset.x}px`;
  actor.style.top = `${position.y + challengeTiltOffset.y}px`;
  actor.style.opacity = `${clamp(0, opacity, 1)}`;
  actor.style.transform = `translate(-50%, -50%) rotate(var(--challenge-rotation, 0deg)) scale(1) scaleX(${scaleX})`;
  actor.style.filter = 'drop-shadow(0 14px 14px rgba(0, 0, 0, 0.42))';

  renderDeclaredMoveOverlays(activeThoughtMove || activeMove, bubblePosition || position, moveOpacity, overlayOrigin);
  const poisonButton = document.getElementById('animationPoisonButton');
  if (poisonButton) poisonButton.style.opacity = '0';
  const passButton = document.getElementById('animationPassButton');
  if (passButton) passButton.style.opacity = '0';
  renderChallengeButton(time, milestones, points);
  renderChallengeSpeechBubble(time, [
    milestones.challengeCursorClickStart,
    milestones.secondChallengeCursorClickStart,
  ], getChallengeButtonPoint(points));
  renderChallengeRemovedSquare(time, milestones, position);
  renderFakeCursor(showCursor, time, milestones, position, cursorMode, points);
  renderRewindIndicator(time, milestones);
  renderDaggerSlots(time, milestones, points);
  renderDaggerToken(time, milestones, points);
}

function hideDeclaredMoveOverlays() {
  const highlight = document.getElementById('animationMoveOriginHighlight');
  if (highlight) highlight.style.opacity = '0';
  const removed = document.getElementById('animationChallengeRemovedSquare');
  if (removed) removed.style.opacity = '0';
  const challengeButton = document.getElementById('animationChallengeButton');
  if (challengeButton) challengeButton.style.opacity = '0';
  const poisonButton = document.getElementById('animationPoisonButton');
  if (poisonButton) poisonButton.style.opacity = '0';
  document.querySelectorAll('.animation-move-bubble').forEach((bubble) => {
    bubble.style.opacity = '0';
  });
  const cursor = document.getElementById('animationFakeCursor');
  if (cursor) cursor.style.opacity = '0';
  const rewind = document.getElementById('animationRewindIndicator');
  if (rewind) rewind.style.opacity = '0';
  const dagger = document.getElementById('animationDaggerToken');
  if (dagger) dagger.style.opacity = '0';
  const slots = document.getElementById('animationDaggerSlots');
  if (slots) slots.style.opacity = '0';
  hideChallengeSpeechBubble();
}

function renderDeclaredMoveOverlays(activeMove, piecePosition, opacity, origin) {
  const highlight = ensureOverlayElement('animationMoveOriginHighlight', 'animation-origin-highlight');
  if (highlight) {
    highlight.style.setProperty('--square-size', `${layout.squareSize}px`);
    highlight.style.left = `${origin.x}px`;
    highlight.style.top = `${origin.y}px`;
    highlight.style.opacity = `${clamp(0, opacity, 1)}`;
  }

  renderMoveBubbles(activeMove, piecePosition, opacity);
}

function renderMoveBubbles(activeMove, piecePosition, opacity) {
  if (!activeMove) {
    document.querySelectorAll('.animation-move-bubble').forEach((bubble) => {
      bubble.style.opacity = '0';
    });
    return;
  }

  const bubbleTypes = Array.isArray(activeMove.bubbleTypes)
    ? activeMove.bubbleTypes
    : [activeMove.bubbleType].filter(Boolean);
  bubbleTypes.forEach((type, index) => {
    const bubble = ensureMoveBubbleAt(type, index);
    if (!bubble) return;
    const bubbleSize = Math.floor(layout.squareSize * 1.08);
    const offsetX = Math.floor(layout.squareSize * 0.6);
    const offsetY = Math.floor(layout.squareSize * 0.5);
    const cellLeft = piecePosition.x - (layout.squareSize / 2);
    const cellTop = piecePosition.y - (layout.squareSize / 2);
    bubble.style.left = type.endsWith('Right')
      ? `${cellLeft + layout.squareSize - bubbleSize + offsetX}px`
      : `${cellLeft - offsetX}px`;
    bubble.style.top = `${cellTop - offsetY}px`;
    bubble.style.transform = 'none';
    bubble.style.opacity = `${clamp(0, opacity, 1)}`;
  });
  document.querySelectorAll('.animation-move-bubble').forEach((bubble) => {
    if (!bubbleTypes.includes(bubble.dataset.bubbleType)) {
      bubble.style.opacity = '0';
    }
  });
}

function renderChallengeSpeechBubble(time, clickStarts, anchor, options = {}) {
  const sizeMultiplier = Number.isFinite(options.sizeMultiplier) ? options.sizeMultiplier : 1;
  const bubble = ensureChallengeSpeechBubble(sizeMultiplier);
  if (!bubble || !anchor) return;
  const activeClickStart = clickStarts
    .filter((start) => Number.isFinite(start) && time >= start && time < start + TIMELINE.challengeBubbleFadeDuration)
    .sort((a, b) => b - a)[0];

  if (!Number.isFinite(activeClickStart)) {
    bubble.style.opacity = '0';
    return;
  }

  const raw = clamp(0, (time - activeClickStart) / TIMELINE.challengeBubbleFadeDuration, 1);
  const fadeIn = easeOutCubic((time - activeClickStart) / 120);
  const fadeOut = 1 - easeInOutCubic((time - (activeClickStart + 180)) / (TIMELINE.challengeBubbleFadeDuration - 180));
  const opacity = Math.min(fadeIn, fadeOut);
  const lift = layout.squareSize * 0.16 * raw;
  const pulse = 1 + (Math.sin(Math.min(1, raw * 3) * Math.PI) * 0.08);

  bubble.style.left = `${anchor.x - (layout.squareSize * 0.58)}px`;
  bubble.style.top = `${anchor.y - (layout.squareSize * 0.68) - lift}px`;
  bubble.style.opacity = `${clamp(0, opacity, 1)}`;
  bubble.style.setProperty('--challenge-bubble-scale', `${pulse}`);
}

function renderChallengeButton(time, milestones, points) {
  const button = ensureChallengeButton();
  if (!button) return;
  const target = getChallengeButtonPoint(points);
  const offscreenY = -layout.squareSize;
  const width = Math.min(160, Math.max(104, Math.floor(layout.squareSize * 1.38)));
  const height = Math.floor(width * 0.6);
  let opacity = 0;
  let y = offscreenY;

  const buttonStart = time >= milestones.secondChallengeButtonStart
    ? milestones.secondChallengeButtonStart
    : milestones.challengeButtonStart;
  const buttonEnd = time >= milestones.secondChallengeButtonStart
    ? milestones.secondChallengeButtonEnd
    : milestones.challengeButtonEnd;
  const clickEnd = time >= milestones.secondChallengeButtonStart
    ? milestones.secondChallengeCursorClickEnd
    : milestones.challengeCursorClickEnd;
  const exitEnd = time >= milestones.secondChallengeButtonStart
    ? milestones.secondChallengeCursorExitEnd
    : milestones.challengeCursorExitEnd;

  if (time >= buttonStart && time < buttonEnd) {
    const progress = easeInOutCubic((time - buttonStart) / TIMELINE.challengeButtonSlideDuration);
    y = offscreenY + ((target.y - offscreenY) * progress);
    opacity = progress;
  } else if (time >= buttonEnd && time < clickEnd) {
    y = target.y;
    opacity = 1;
  } else if (time >= clickEnd && time < exitEnd) {
    const progress = easeInOutCubic((time - clickEnd) / TIMELINE.challengeCursorExitDuration);
    y = target.y - (layout.squareSize * 0.28 * progress);
    opacity = 1 - progress;
  }

  button.style.left = `${Math.floor(target.x - (width / 2))}px`;
  button.style.top = `${Math.floor(y - (height / 2))}px`;
  button.style.width = `${width}px`;
  button.style.height = `${height}px`;
  button.style.fontSize = `${Math.round(Math.min(20, Math.max(13, height * 0.28)))}px`;
  button.style.opacity = `${clamp(0, opacity, 1)}`;
}

function renderChallengeRemovedSquare(time, milestones, position) {
  const square = ensureOverlayElement('animationChallengeRemovedSquare', 'animation-challenge-removed');
  if (!square) return;
  square.style.setProperty('--square-size', `${layout.squareSize}px`);
  square.style.left = `${position.x}px`;
  square.style.top = `${position.y}px`;
  let opacity = time >= milestones.challengeTiltEnd
    ? easeInOutCubic((time - milestones.challengeTiltEnd) / TIMELINE.challengeFadeDuration)
    : 0;
  if (time >= milestones.rewindStart) {
    opacity = 1 - easeInOutCubic((time - milestones.rewindStart) / TIMELINE.rewindRestoreDuration);
  }
  square.style.opacity = `${clamp(0, opacity, 1)}`;
}

function renderRewindIndicator(time, milestones) {
  const indicator = ensureRewindIndicator();
  if (!indicator) return;
  const visible = time >= milestones.rewindStart && time < milestones.rewindFlipEnd;
  if (!visible) {
    indicator.style.opacity = '0';
    return;
  }
  const fadeIn = easeOutCubic((time - milestones.rewindStart) / 180);
  const fadeOut = 1 - easeInOutCubic((time - (milestones.rewindFlipEnd - 240)) / 240);
  indicator.style.opacity = `${clamp(0, Math.min(fadeIn, fadeOut), 1)}`;
}

function renderDaggerSlots(time, milestones, points) {
  const slots = ensureDaggerSlots();
  if (!slots) return;
  const center = getDaggerSlotsCenter(points);
  const visible = time >= milestones.daggerSlotsStart;
  slots.style.left = `${center.x}px`;
  slots.style.top = `${center.y}px`;
  slots.style.opacity = visible ? `${easeOutCubic((time - milestones.daggerSlotsStart) / 240)}` : '0';
}

function renderDaggerToken(time, milestones, points) {
  const token = ensureDaggerToken();
  if (!token) return;
  const target = getDaggerSlotPoint(points, 0);
  const start = {
    x: layout.width + layout.squareSize,
    y: target.y,
  };
  let position = { ...start };
  let opacity = 0;

  if (time >= milestones.daggerSlideStart && time < milestones.daggerSlideEnd) {
    const progress = easeInOutCubic((time - milestones.daggerSlideStart) / TIMELINE.daggerSlideDuration);
    position = interpolatePoint(start, target, progress);
    opacity = progress;
    token.classList.remove('animation-dagger-token--flash');
  } else if (time >= milestones.daggerSlideEnd) {
    position = { ...target };
    opacity = 1;
    if (time < milestones.daggerFlashEnd) {
      token.classList.add('animation-dagger-token--flash');
    } else {
      token.classList.remove('animation-dagger-token--flash');
    }
  } else {
    token.classList.remove('animation-dagger-token--flash');
  }

  token.style.left = `${position.x - (token.offsetWidth / 2 || 22)}px`;
  token.style.top = `${position.y - (token.offsetHeight / 2 || 22)}px`;
  token.style.opacity = `${clamp(0, opacity, 1)}`;
}

function renderCapturesPoisonDemo(time) {
  if (!layout) return;
  const points = getBoardPoints();
  if (!points) return;
  const milestones = getCapturesPoisonMilestones();
  const setupMilestones = getSetupMilestones();
  if (time >= setupMilestones.wipeEnd) {
    hideCapturesPoisonScene();
    return;
  }
  if (time < milestones.start) {
    const blackActor = document.getElementById('animationCaptureBlack');
    if (blackActor) blackActor.style.opacity = '0';
    const poisonButton = document.getElementById('animationPoisonButton');
    if (poisonButton) poisonButton.style.opacity = '0';
    const passButton = document.getElementById('animationPassButton');
    if (passButton) passButton.style.opacity = '0';
    return;
  }

  renderCapturesDaggerClear(time, milestones);

  const highlight = document.getElementById('animationMoveOriginHighlight');
  if (highlight) highlight.style.opacity = '0';

  const actor = ensureActor('animationPoisonActive', 'animation-piece--capture-front');
  const blackActor = ensureActor('animationCaptureBlack', 'animation-piece--captured animation-piece--capture-back');
  if (!actor || !blackActor) return;

  const previousPosition = getFinalThoughtPosition(points);
  const origin = points.center;
  const target = getPointFromDirection(origin, { row: -1, col: 0 }, 1);
  const topOffscreen = {
    x: target.x,
    y: -layout.pieceSize,
  };

  const whiteState = getCapturesWhiteState(time, milestones, previousPosition, origin, target);
  const blackState = getCapturesBlackState(time, milestones, topOffscreen, target);
  const bubbleTypes = getCapturesBubbleTypes(time, milestones);

  renderPieceContent(actor, whiteState.identity, WHITE);
  actor.style.setProperty('--piece-size', `${layout.pieceSize}px`);
  actor.style.left = `${whiteState.position.x}px`;
  actor.style.top = `${whiteState.position.y}px`;
  actor.style.opacity = `${clamp(0, whiteState.opacity, 1)}`;
  actor.style.zIndex = `${whiteState.zIndex}`;
  actor.style.transform = `translate(-50%, -50%) rotate(${whiteState.rotation}deg) scale(1) scaleX(${whiteState.scaleX})`;
  actor.style.filter = 'drop-shadow(0 14px 14px rgba(0, 0, 0, 0.42))';

  renderPieceContent(blackActor, blackState.identity, BLACK);
  blackActor.style.setProperty('--piece-size', `${layout.pieceSize}px`);
  blackActor.style.left = `${blackState.position.x}px`;
  blackActor.style.top = `${blackState.position.y}px`;
  blackActor.style.opacity = `${clamp(0, blackState.opacity, 1)}`;
  blackActor.style.zIndex = `${blackState.zIndex}`;
  blackActor.style.transform = `translate(-50%, -50%) rotate(${blackState.rotation}deg) scale(${blackState.scale}) scaleX(${blackState.scaleX})`;
  blackActor.style.filter = 'drop-shadow(0 14px 14px rgba(0, 0, 0, 0.42))';

  const bubblePosition = bubbleTypes.includes('bombSpeechLeft')
    ? getCapturesPoisonBubblePosition(blackState.position)
    : whiteState.position;
  renderMoveBubbles({ bubbleTypes }, bubblePosition, bubbleTypes.length ? 1 : 0);
  renderCapturesActionButtons(time, milestones, points);
  renderChallengeSpeechBubble(time, [
    milestones.firstChallengeCursorClickStart,
    milestones.secondChallengeCursorClickStart,
  ], getCapturesChallengeButtonPoint(points));
  renderCapturesCursor(time, milestones, points);
  renderCapturesRewindIndicator(time, milestones);
  renderCapturesDagger(time, milestones, points);
}

function hideCapturesPoisonScene() {
  [
    'animationPoisonActive',
    'animationCaptureBlack',
    'animationChallengeButton',
    'animationPoisonButton',
    'animationPassButton',
    'animationDaggerToken',
    'animationDaggerSlots',
    'animationRewindIndicator',
    'animationFakeCursor',
  ].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.style.opacity = '0';
  });
  document.querySelectorAll('.animation-move-bubble').forEach((bubble) => {
    bubble.style.opacity = '0';
  });
  hideChallengeSpeechBubble();
}

function ensureSetupActors() {
  return SETUP_EXPANDED_IDENTITIES.map((identity, index) => {
    const actor = ensureActor(`animationSetupPiece${index}`, 'animation-setup-piece');
    if (actor) {
      actor.dataset.setupIndex = String(index);
      renderPieceContent(actor, identity, WHITE);
    }
    return actor;
  });
}

function ensureSetupBlackActors() {
  return Array.from({ length: 5 }, (_, index) => {
    const actor = ensureActor(`animationSetupBlackPiece${index}`, 'animation-setup-black-piece');
    if (actor) {
      renderPieceContent(actor, UNKNOWN_IDENTITY, BLACK);
    }
    return actor;
  });
}

function hideSetupActors() {
  document.querySelectorAll('.animation-setup-piece').forEach((piece) => {
    piece.style.opacity = '0';
  });
  document.querySelectorAll('.animation-setup-black-piece').forEach((piece) => {
    piece.style.opacity = '0';
  });
  const ring = document.getElementById('animationSetupKingRing');
  if (ring) ring.style.opacity = '0';
  const ready = document.getElementById('animationSetupReadyButton');
  if (ready) ready.style.opacity = '0';
  document.querySelectorAll('.animation-winning-dagger-slots').forEach((slots) => {
    slots.style.opacity = '0';
  });
}

function getSetupOriginalPositions() {
  const geometry = getSetupBoardGeometry();
  const y = geometry.top + (geometry.square * 4.5);
  return SETUP_ORIGINAL_IDENTITIES.map((identity, index) => ({
    identity,
    x: geometry.left + ((index + 0.5) * geometry.square),
    y,
  }));
}

function getSetupExpandedBoardPositions() {
  const originals = getSetupOriginalPositions();
  const square = getSetupBoardGeometry().square;
  return [
    ...originals,
    {
      identity: IDENTITIES.ROOK,
      x: originals[1].x,
      y: originals[1].y + square,
    },
    {
      identity: IDENTITIES.BISHOP,
      x: originals[2].x,
      y: originals[2].y + square,
    },
    {
      identity: IDENTITIES.KNIGHT,
      x: originals[3].x,
      y: originals[3].y + square,
    },
  ];
}

function getSetupStashPositions() {
  const geometry = getSetupBoardGeometry();
  const square = geometry.square;
  const deck = geometry.deckCenter;
  const spacing = square;
  const topY = deck.y;
  const bottomY = deck.y + square;
  return [
    { x: deck.x - (spacing * 2), y: topY },
    { x: deck.x - spacing, y: topY },
    { x: deck.x + spacing, y: topY },
    { x: deck.x + (spacing * 2), y: topY },
    { x: deck.x - (spacing * 1.5), y: bottomY },
    { x: deck.x - (spacing * 0.5), y: bottomY },
    { x: deck.x + (spacing * 0.5), y: bottomY },
    { x: deck.x + (spacing * 1.5), y: bottomY },
  ];
}

function getSetupBoardSlotPositions() {
  const geometry = getSetupBoardGeometry();
  const y = geometry.top + (geometry.square * 5.5);
  return [0, 1, 2, 3, 4].map((col) => ({
    x: geometry.left + ((col + 0.5) * geometry.square),
    y,
  }));
}

function getSetupTopRankPositions() {
  const geometry = getSetupBoardGeometry();
  const y = geometry.top + (geometry.square * 0.5);
  return [0, 1, 2, 3, 4].map((col) => ({
    x: geometry.left + ((col + 0.5) * geometry.square),
    y,
  }));
}

function getSetupResolvedSlots() {
  const boardSlots = getSetupBoardSlotPositions();
  const geometry = getSetupBoardGeometry();
  const stash = getSetupStashPositions();
  return [
    ...boardSlots,
    { ...geometry.deckCenter },
    stash[3],
    stash[7],
  ];
}

function getSetupAssignmentAtShuffleStep(step) {
  const assignment = [2, 6, 0, 1, 5, 4, 3, 7];
  for (let index = 0; index < step; index += 1) {
    const [a, b] = SETUP_SHUFFLE_SWAPS[index];
    const firstPiece = assignment[a];
    assignment[a] = assignment[b];
    assignment[b] = firstPiece;
  }
  return assignment;
}

function getSetupPostPlacementPosition(index, time, milestones, stashPositions) {
  const slots = getSetupResolvedSlots();
  const boardSlots = getSetupBoardSlotPositions();
  const identity = SETUP_EXPANDED_IDENTITIES[index];
  const boardSlotIndex = SETUP_BOARD_SLOT_IDENTITIES.indexOf(identity);

  if (identity === IDENTITIES.KING) {
    if (time < milestones.placementStart) return stashPositions[index];
    const progress = easeInOutCubic((time - milestones.placementStart) / TIMELINE.setupHeartPlaceDuration);
    return interpolatePoint(stashPositions[index], boardSlots[2], progress);
  }

  const boardTargets = [
    { actorIndex: 2, slotIndex: 0, order: 0 },
    { actorIndex: 6, slotIndex: 1, order: 1 },
    { actorIndex: 1, slotIndex: 3, order: 2 },
    { actorIndex: 5, slotIndex: 4, order: 3 },
  ];
  const targetConfig = boardTargets.find((entry) => entry.actorIndex === index);
  if (targetConfig) {
    const start = milestones.remainingPlaceStart + (targetConfig.order * TIMELINE.setupPiecePlaceStagger);
    if (time < start) return stashPositions[index];
    const progress = easeInOutCubic((time - start) / TIMELINE.setupPiecePlaceDuration);
    return interpolatePoint(stashPositions[index], boardSlots[targetConfig.slotIndex], progress);
  }

  if (identity === IDENTITIES.BOMB) {
    if (time < milestones.poisonPlaceStart) return stashPositions[index];
    const progress = easeInOutCubic((time - milestones.poisonPlaceStart) / TIMELINE.setupPoisonPlaceDuration);
    return interpolatePoint(stashPositions[index], slots[5], progress);
  }

  if (index === 3) return slots[6];
  if (index === 7) return slots[7];
  if (boardSlotIndex >= 0) return boardSlots[boardSlotIndex];
  return stashPositions[index];
}

function getSetupShuffleState(time, milestones) {
  if (time < milestones.shuffleStart) {
    return {
      positions: null,
      kingPosition: null,
      ringOpacity: 0,
    };
  }

  const slots = getSetupResolvedSlots();
  const elapsed = Math.min(time - milestones.shuffleStart, milestones.shuffleEnd - milestones.shuffleStart);
  const rawStep = Math.floor(elapsed / milestones.shuffleStepDuration);
  const step = Math.min(rawStep, SETUP_SHUFFLE_SWAPS.length);
  const stepTime = elapsed - (rawStep * milestones.shuffleStepDuration);
  const isActiveSwap = step < SETUP_SHUFFLE_SWAPS.length && stepTime < TIMELINE.setupShuffleSwapDuration;
  const completedStep = isActiveSwap ? step : Math.min(step + 1, SETUP_SHUFFLE_SWAPS.length);
  const assignment = getSetupAssignmentAtShuffleStep(completedStep);
  const positions = new Array(SETUP_EXPANDED_IDENTITIES.length);

  assignment.forEach((pieceIndex, slotIndex) => {
    positions[pieceIndex] = slots[slotIndex];
  });

  if (isActiveSwap) {
    const [slotA, slotB] = SETUP_SHUFFLE_SWAPS[step];
    const previousAssignment = getSetupAssignmentAtShuffleStep(step);
    const pieceA = previousAssignment[slotA];
    const pieceB = previousAssignment[slotB];
    const progress = easeInOutCubic(stepTime / TIMELINE.setupShuffleSwapDuration);
    positions[pieceA] = interpolatePoint(slots[slotA], slots[slotB], progress);
    positions[pieceB] = interpolatePoint(slots[slotB], slots[slotA], progress);
  }

  return {
    positions,
    kingPosition: positions[0],
    ringOpacity: step >= 1 ? easeOutCubic((time - (milestones.shuffleStart + milestones.shuffleStepDuration)) / 220) : 0,
  };
}

function getWinningActorPositions(time) {
  const milestones = getWinningMilestones();
  if (time < milestones.start) return null;
  const slots = getSetupResolvedSlots();
  const assignment = getSetupAssignmentAtShuffleStep(SETUP_SHUFFLE_SWAPS.length);
  const positions = new Array(SETUP_EXPANDED_IDENTITIES.length);
  assignment.forEach((pieceIndex, slotIndex) => {
    positions[pieceIndex] = slots[slotIndex];
  });

  const geometry = getSetupBoardGeometry();
  const targets = [
    {
      pieceIndex: assignment[6],
      target: {
        x: geometry.deckCenter.x - (geometry.square * 2),
        y: geometry.deckCenter.y,
      },
    },
    {
      pieceIndex: assignment[7],
      target: {
        x: geometry.deckCenter.x - geometry.square,
        y: geometry.deckCenter.y,
      },
    },
  ];
  const progress = easeInOutCubic((time - milestones.start) / TIMELINE.winningStashSlideDuration);
  targets.forEach(({ pieceIndex, target }) => {
    positions[pieceIndex] = interpolatePoint(positions[pieceIndex], target, progress);
  });
  return positions;
}

function getWinningFadeMultiplier(time) {
  const milestones = getWinningMilestones();
  if (time < milestones.start) return 1;
  return 1 - easeInOutCubic((time - milestones.start) / TIMELINE.winningFadeDuration);
}

function getWinningDaggerSlotCenters() {
  const geometry = getSetupBoardGeometry();
  return [
    {
      id: 'animationWinningDaggerSlotsTop',
      x: geometry.right + (geometry.square * 0.92),
      y: geometry.top + (geometry.square * 0.7),
    },
    {
      id: 'animationWinningDaggerSlotsBottom',
      x: geometry.right + (geometry.square * 0.92),
      y: geometry.bottom - (geometry.square * 0.7),
    },
  ];
}

function renderWinningDaggerSlots(time) {
  const milestones = getWinningMilestones();
  const opacity = time >= milestones.daggerSlotsStart
    ? easeOutCubic((time - milestones.daggerSlotsStart) / TIMELINE.winningDaggerSlotsFadeDuration)
    : 0;
  getWinningDaggerSlotCenters().forEach((center) => {
    const slots = ensureWinningDaggerSlots(center.id);
    if (!slots) return;
    slots.style.left = `${center.x}px`;
    slots.style.top = `${center.y}px`;
    slots.style.opacity = `${clamp(0, opacity, 1)}`;
  });
}

function hideSharedDaggerOverlay() {
  const token = document.getElementById('animationDaggerToken');
  if (token) {
    token.classList.remove('animation-dagger-token--flash');
    token.style.opacity = '0';
  }
  const slots = document.getElementById('animationDaggerSlots');
  if (slots) slots.style.opacity = '0';
}

function getWinningDaggerSlotPoint(groupIndex, slotIndex) {
  const center = getWinningDaggerSlotCenters()[groupIndex];
  const spacing = getDaggerSlotSize() + getDaggerSlotGap();
  return {
    x: center.x + ((slotIndex - 1) * spacing),
    y: center.y,
  };
}

function getWinningCellPoint(row, col) {
  const geometry = getSetupBoardGeometry();
  return {
    x: geometry.left + ((col + 0.5) * geometry.square),
    y: geometry.top + ((row + 0.5) * geometry.square),
  };
}

function getWinningStashPoint(index) {
  const geometry = getSetupBoardGeometry();
  return {
    x: geometry.deckCenter.x - (geometry.square * (2 - index)),
    y: geometry.deckCenter.y,
  };
}

function getWinningStashIntakePoint() {
  const geometry = getSetupBoardGeometry();
  return {
    x: geometry.deckCenter.x + geometry.square,
    y: geometry.deckCenter.y,
  };
}

function getWinningCapturedPoint(color, index) {
  const geometry = getSetupBoardGeometry();
  const groupIndex = color === BLACK ? 1 : 0;
  const center = getWinningDaggerSlotCenters()[groupIndex];
  const spacing = geometry.square * 0.5;
  return {
    x: center.x + ((index - 0.5) * spacing),
    y: color === BLACK
      ? center.y - (geometry.square * 0.72)
      : center.y + (geometry.square * 0.72),
  };
}

function getWinningLocationPoint(piece) {
  const geometry = getSetupBoardGeometry();
  if (piece.location === 'board') {
    return getWinningCellPoint(piece.row, piece.col);
  }
  if (piece.location === 'deck') {
    return { ...geometry.deckCenter };
  }
  if (piece.location === 'stash') {
    return getWinningStashPoint(piece.stashIndex || 0);
  }
  if (piece.location === 'captured') {
    return getWinningCapturedPoint(piece.color, piece.capturedIndex || 0);
  }
  return {
    x: -layout.pieceSize,
    y: geometry.deckCenter.y,
  };
}

function createWinningBaseState() {
  const pieces = new Map();
  const board = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => null));
  const captured = {
    [WHITE]: [],
    [BLACK]: [],
  };

  const addPiece = (config, color) => {
    const location = config.location || 'board';
    const piece = {
      id: config.id,
      color,
      identity: config.identity,
      location,
      row: Number.isInteger(config.row) ? config.row : null,
      col: Number.isInteger(config.col) ? config.col : null,
      stashIndex: Number.isInteger(config.stashIndex) ? config.stashIndex : null,
      capturedIndex: null,
    };
    pieces.set(piece.id, piece);
    if (location === 'board') {
      board[piece.row][piece.col] = piece.id;
    }
  };

  WINNING_WHITE_PIECES.forEach((piece) => addPiece(piece, WHITE));
  WINNING_BLACK_PIECES.forEach((piece) => addPiece(piece, BLACK));

  return {
    pieces,
    board,
    captured,
    blackDaggers: 0,
  };
}

function removeWinningPieceFromBoard(state, piece) {
  if (piece?.location !== 'board') return;
  if (state.board[piece.row]?.[piece.col] === piece.id) {
    state.board[piece.row][piece.col] = null;
  }
}

function placeWinningPieceOnBoard(state, piece, square) {
  piece.location = 'board';
  piece.row = square.row;
  piece.col = square.col;
  piece.stashIndex = null;
  piece.capturedIndex = null;
  state.board[square.row][square.col] = piece.id;
}

function commitWinningMove(state, move) {
  const piece = state.pieces.get(move.pieceId);
  if (!piece) return;
  removeWinningPieceFromBoard(state, piece);

  if (move.challenge?.failed) {
    const deckIn = state.pieces.get(move.challenge.deckIn);
    const deckOut = state.pieces.get(move.challenge.deckOut);
    if (deckIn) {
      placeWinningPieceOnBoard(state, deckIn, move.to);
    }
    if (deckOut) {
      deckOut.location = 'deck';
      deckOut.row = null;
      deckOut.col = null;
      deckOut.stashIndex = null;
      deckOut.capturedIndex = null;
    }
    piece.location = 'stash';
    piece.row = null;
    piece.col = null;
    piece.stashIndex = 0;
    piece.capturedIndex = null;
    if (move.challenge.challenger === BLACK) {
      state.blackDaggers += 1;
    }
    return;
  }

  const capturedPieceId = state.board[move.to.row]?.[move.to.col];
  if (capturedPieceId) {
    const capturedPiece = state.pieces.get(capturedPieceId);
    if (capturedPiece) {
      capturedPiece.location = 'captured';
      capturedPiece.row = null;
      capturedPiece.col = null;
      capturedPiece.stashIndex = null;
      capturedPiece.capturedIndex = state.captured[capturedPiece.color].length;
      state.captured[capturedPiece.color].push(capturedPiece.id);
    }
  }
  placeWinningPieceOnBoard(state, piece, move.to);
}

function getWinningStepTiming(move) {
  const moveEnd = TIMELINE.winningMoveDuration;
  const holdEnd = moveEnd + TIMELINE.winningMoveHoldDuration;
  const challengeStart = holdEnd + TIMELINE.winningChallengeDelay;
  const challengeRevealEnd = challengeStart + TIMELINE.winningChallengeRevealDuration;
  const swapEnd = challengeRevealEnd + TIMELINE.winningOnDeckSwapDuration;
  const deckReplaceStart = swapEnd + TIMELINE.winningOnDeckReplaceDelay;
  const deckReplaceEnd = deckReplaceStart + TIMELINE.winningOnDeckReplaceDuration;
  const stashReflowEnd = deckReplaceEnd + TIMELINE.winningStashReflowDuration;
  const captureTiltEnd = holdEnd + TIMELINE.winningCaptureTiltDuration;
  const captureSlideStart = captureTiltEnd + TIMELINE.winningCapturePauseDuration;
  const captureEnd = captureSlideStart + TIMELINE.winningCaptureDisplayDuration;
  return {
    moveEnd,
    holdEnd,
    challengeStart,
    challengeRevealEnd,
    swapEnd,
    deckReplaceStart,
    deckReplaceEnd,
    stashReflowEnd,
    captureTiltEnd,
    captureSlideStart,
    captureEnd,
    end: getWinningMoveStepDuration(move),
  };
}

function getWinningSequenceState(time) {
  const milestones = getWinningMilestones();
  const state = createWinningBaseState();
  let elapsed = time - milestones.moveSequenceStart;
  let stepStart = milestones.moveSequenceStart;

  if (elapsed < 0) {
    return {
      state,
      activeMove: null,
      activeIndex: -1,
      localTime: elapsed,
      stepStart,
    };
  }

  for (let index = 0; index < WINNING_MOVE_SEQUENCE.length; index += 1) {
    const move = WINNING_MOVE_SEQUENCE[index];
    const duration = getWinningMoveStepDuration(move);
    if (elapsed < duration) {
      return {
        state,
        activeMove: move,
        activeIndex: index,
        localTime: elapsed,
        stepStart,
      };
    }
    commitWinningMove(state, move);
    elapsed -= duration;
    stepStart += duration;
  }

  return {
    state,
    activeMove: null,
    activeIndex: WINNING_MOVE_SEQUENCE.length,
    localTime: elapsed,
    stepStart,
  };
}

function ensureWinningPieceActor(pieceId) {
  const actor = ensureActor(`animationWinningPiece${pieceId}`, 'animation-winning-piece');
  if (actor) {
    actor.dataset.winningPieceId = pieceId;
  }
  return actor;
}

function ensureWinningDaggerToken(index) {
  const slots = ensureWinningDaggerSlots('animationWinningDaggerSlotsTop');
  const slot = slots?.children?.[index];
  if (!slot) return null;
  let token = document.getElementById(`animationWinningDaggerToken${index}`);
  if (!token) {
    token = createDaggerToken({
      size: Math.round(getDaggerSlotSize() * 0.82),
      alt: 'Dagger token',
    });
    token.id = `animationWinningDaggerToken${index}`;
    token.classList.add('animation-dagger-token', 'animation-winning-dagger-token');
  }
  if (token.parentElement !== slot) {
    slot.appendChild(token);
  }
  const size = Math.round(getDaggerSlotSize() * 0.82);
  token.style.width = `${size}px`;
  token.style.height = `${size}px`;
  token.style.fontSize = `${Math.max(10, Math.round(size * 0.74))}px`;
  return token;
}

function hideWinningMoveActors() {
  document.querySelectorAll('.animation-winning-piece, .animation-winning-dagger-token, .animation-winning-throne, .animation-winning-draw').forEach((element) => {
    element.style.opacity = '0';
  });
}

function ensureWinningThrone() {
  if (!layout || !actorStage) return null;
  let throne = document.getElementById('animationWinningThrone');
  if (!throne) {
    throne = createThroneIcon({
      size: Math.round(layout.squareSize * 0.72),
      alt: 'White wins',
      title: 'White wins',
    });
    throne.id = 'animationWinningThrone';
    throne.classList.add('animation-winning-throne');
    actorStage.appendChild(throne);
  }
  return throne;
}

function ensureWinningDrawIcon() {
  if (!layout || !actorStage) return null;
  let draw = document.getElementById('animationWinningDrawIcon');
  if (!draw) {
    draw = createDrawIcon({
      size: Math.round(layout.squareSize * 1.12),
      alt: 'Draw',
      title: 'Draw',
    });
    draw.id = 'animationWinningDrawIcon';
    draw.classList.add('animation-winning-draw');
    actorStage.appendChild(draw);
  }
  return draw;
}

function getWinningBubbleType(declaration) {
  if (declaration === IDENTITIES.KING) return 'kingSpeechLeft';
  if (declaration === IDENTITIES.ROOK) return 'rookSpeechLeft';
  if (declaration === IDENTITIES.BISHOP) return 'bishopSpeechLeft';
  if (declaration === IDENTITIES.KNIGHT) return 'knightSpeechLeft';
  if (declaration === IDENTITIES.BOMB) return 'bombSpeechLeft';
  return null;
}

function getWinningPieceVisualIdentity(piece, reveal = false) {
  if (reveal || piece.color === WHITE || piece.location === 'captured') {
    return piece.identity;
  }
  return UNKNOWN_IDENTITY;
}

function getWinningBaseRenderState(piece) {
  return {
    piece,
    position: getWinningLocationPoint(piece),
    visualIdentity: getWinningPieceVisualIdentity(piece),
    opacity: 1,
    scale: piece.location === 'captured' ? 0.5 : 1,
    scaleX: 1,
    rotation: 0,
    zIndex: piece.location === 'captured' ? 4 : 2,
  };
}

function getWinningMoveStartPoint(piece, move) {
  if (piece?.location === 'board') {
    return getWinningCellPoint(piece.row, piece.col);
  }
  return getWinningCellPoint(move.to.row, move.to.col);
}

function applyWinningActiveMove(renderStates, sequenceState) {
  const move = sequenceState.activeMove;
  if (!move) return;

  const piece = sequenceState.state.pieces.get(move.pieceId);
  if (!piece) return;

  const timing = getWinningStepTiming(move);
  const localTime = sequenceState.localTime;
  const startPoint = getWinningMoveStartPoint(piece, move);
  const targetPoint = getWinningCellPoint(move.to.row, move.to.col);
  const moveProgress = easeInOutCubic(localTime / TIMELINE.winningMoveDuration);
  const movingPosition = localTime < timing.moveEnd
    ? interpolatePoint(startPoint, targetPoint, moveProgress)
    : targetPoint;
  let movingScale = 1;
  let movingScaleX = 1;

  if (move.challenge && localTime >= timing.challengeStart && localTime < timing.challengeRevealEnd) {
    const revealProgress = clamp(0, (localTime - timing.challengeStart) / TIMELINE.winningChallengeRevealDuration, 1);
    if (move.challenge.failed) {
      movingScale = 1 + (Math.sin(revealProgress * Math.PI) * 0.08);
    } else {
      movingScaleX = Math.max(0.08, Math.abs(1 - (revealProgress * 2)));
    }
  }

  if (move.challenge && localTime >= timing.challengeRevealEnd) {
    const deckIn = sequenceState.state.pieces.get(move.challenge.deckIn);
    const deckOut = sequenceState.state.pieces.get(move.challenge.deckOut);
    const stashPoint = getWinningStashPoint(0);
    const stashIntakePoint = getWinningStashIntakePoint();
    const deckPoint = getSetupBoardGeometry().deckCenter;
    const swapProgress = easeInOutCubic((localTime - timing.challengeRevealEnd) / TIMELINE.winningOnDeckSwapDuration);
    const clampedSwapProgress = clamp(0, swapProgress, 1);
    const deckReplaceProgress = easeInOutCubic((localTime - timing.deckReplaceStart) / TIMELINE.winningOnDeckReplaceDuration);
    const stashReflowProgress = easeInOutCubic((localTime - timing.deckReplaceEnd) / TIMELINE.winningStashReflowDuration);
    const challengedPiecePosition = localTime < timing.deckReplaceEnd
      ? interpolatePoint(targetPoint, stashIntakePoint, clampedSwapProgress)
      : interpolatePoint(stashIntakePoint, stashPoint, stashReflowProgress);

    renderStates.set(piece.id, {
      piece,
      position: challengedPiecePosition,
      visualIdentity: getWinningPieceVisualIdentity(piece, true),
      opacity: 1,
      scale: 1,
      scaleX: 1,
      rotation: 0,
      zIndex: 4,
    });

    if (deckIn) {
      renderStates.set(deckIn.id, {
        piece: deckIn,
        position: interpolatePoint(deckPoint, targetPoint, clampedSwapProgress),
        visualIdentity: getWinningPieceVisualIdentity(deckIn, true),
        opacity: 1,
        scale: 1,
        scaleX: 1,
        rotation: 0,
        zIndex: 5,
      });
    }

    if (deckOut) {
      const deckOutStartPoint = getWinningLocationPoint(deckOut);
      const deckOutPosition = localTime < timing.deckReplaceStart
        ? deckOutStartPoint
        : interpolatePoint(deckOutStartPoint, deckPoint, deckReplaceProgress);
      renderStates.set(deckOut.id, {
        piece: deckOut,
        position: deckOutPosition,
        visualIdentity: getWinningPieceVisualIdentity(deckOut, true),
        opacity: 1,
        scale: 1,
        scaleX: 1,
        rotation: 0,
        zIndex: 3,
      });
    }
    return;
  }

  renderStates.set(piece.id, {
    piece,
    position: movingPosition,
    visualIdentity: getWinningPieceVisualIdentity(piece, move.challenge?.failed),
    opacity: 1,
    scale: movingScale,
    scaleX: movingScaleX,
    rotation: 0,
    zIndex: 5,
  });

  const capturedPieceId = sequenceState.state.board[move.to.row]?.[move.to.col];
  if (!move.capture || !capturedPieceId || capturedPieceId === piece.id) return;

  const capturedPiece = sequenceState.state.pieces.get(capturedPieceId);
  if (!capturedPiece) return;

  const displayIndex = sequenceState.state.captured[capturedPiece.color].length;
  const displayPoint = getWinningCapturedPoint(capturedPiece.color, displayIndex);
  const tiltProgress = localTime >= timing.holdEnd
    ? easeInOutCubic((localTime - timing.holdEnd) / TIMELINE.winningCaptureTiltDuration)
    : 0;
  const slideProgress = localTime >= timing.captureSlideStart
    ? easeInOutCubic((localTime - timing.captureSlideStart) / TIMELINE.winningCaptureDisplayDuration)
    : 0;
  const tiltedPoint = getCapturedTiltedPoint(targetPoint, tiltProgress);
  const capturedFlipProgress = capturedPiece.color === BLACK
    ? clamp(0, slideProgress / 0.65, 1)
    : 1;
  const revealCapturedIdentity = capturedPiece.color === BLACK
    ? capturedFlipProgress >= 0.5
    : localTime >= timing.holdEnd;
  const capturedScaleX = capturedPiece.color === BLACK && slideProgress > 0 && capturedFlipProgress < 1
    ? Math.max(0.08, Math.abs(1 - (capturedFlipProgress * 2)))
    : 1;
  renderStates.set(capturedPiece.id, {
    piece: capturedPiece,
    position: interpolatePoint(tiltedPoint, displayPoint, slideProgress),
    visualIdentity: getWinningPieceVisualIdentity(capturedPiece, revealCapturedIdentity),
    opacity: 1,
    scale: 1 - (slideProgress * 0.5),
    scaleX: capturedScaleX,
    rotation: (24 * tiltProgress) * (1 - slideProgress),
    zIndex: slideProgress > 0 ? 4 : 1,
  });
}

function getWinningRenderStates(sequenceState) {
  const renderStates = new Map();
  sequenceState.state.pieces.forEach((piece) => {
    renderStates.set(piece.id, getWinningBaseRenderState(piece));
  });
  applyWinningActiveMove(renderStates, sequenceState);
  return renderStates;
}

function renderWinningPieceState(renderState) {
  const actor = ensureWinningPieceActor(renderState.piece.id);
  if (!actor) return;
  const pieceSize = Math.round(layout.pieceSize * renderState.scale);
  renderPieceContent(actor, renderState.visualIdentity, renderState.piece.color, layout.squareSize * renderState.scale);
  actor.style.setProperty('--piece-size', `${pieceSize}px`);
  actor.style.left = `${renderState.position.x}px`;
  actor.style.top = `${renderState.position.y}px`;
  actor.style.opacity = `${clamp(0, renderState.opacity, 1)}`;
  actor.style.zIndex = `${renderState.zIndex}`;
  actor.style.transform = `translate(-50%, -50%) rotate(${renderState.rotation || 0}deg) scaleX(${renderState.scaleX})`;
  actor.style.filter = 'drop-shadow(0 12px 12px rgba(0, 0, 0, 0.40))';
}

function getWinningChallengeClickStarts() {
  const milestones = getWinningMilestones();
  let cursor = milestones.moveSequenceStart;
  return WINNING_MOVE_SEQUENCE.reduce((starts, move) => {
    const timing = getWinningStepTiming(move);
    if (move.challenge) {
      starts.push(cursor + timing.challengeStart);
    }
    cursor += getWinningMoveStepDuration(move);
    return starts;
  }, []);
}

function renderWinningDaggerTokens(sequenceState) {
  const activeMove = sequenceState.activeMove;
  const timing = activeMove ? getWinningStepTiming(activeMove) : null;
  let visibleDaggers = sequenceState.state.blackDaggers;
  let activeProgress = 0;

  if (activeMove?.challenge?.challenger === BLACK && sequenceState.localTime >= timing.challengeStart) {
    activeProgress = easeOutCubic((sequenceState.localTime - timing.challengeStart) / TIMELINE.winningDaggerFillDuration);
  }

  for (let index = 0; index < 3; index += 1) {
    const token = ensureWinningDaggerToken(index);
    if (!token) continue;
    const isCommitted = index < visibleDaggers;
    const isActive = index === visibleDaggers && activeProgress > 0;
    const opacity = isCommitted ? 1 : (isActive ? activeProgress : 0);
    const scale = isActive ? 0.82 + (0.18 * activeProgress) : 1;
    token.classList.toggle('animation-dagger-token--flash', isActive && activeProgress >= 1);
    token.style.left = '50%';
    token.style.top = '50%';
    token.style.opacity = `${clamp(0, opacity, 1)}`;
    token.style.transform = `translate(-50%, -50%) scale(${scale})`;
    token.style.zIndex = '4';
  }
}

function renderWinningMoveBubble(sequenceState, renderStates) {
  const move = sequenceState.activeMove;
  if (!move) {
    renderMoveBubbles(null);
    return;
  }
  const timing = getWinningStepTiming(move);
  const bubbleType = getWinningBubbleType(move.declaration);
  const pieceState = renderStates.get(move.pieceId);
  const visibleEnd = move.challenge?.failed ? timing.challengeRevealEnd : timing.holdEnd;
  if (!bubbleType || !pieceState || sequenceState.localTime > visibleEnd) {
    renderMoveBubbles(null);
    return;
  }
  const fadeOut = move.challenge?.failed
    ? 1
    : 1 - easeInOutCubic((sequenceState.localTime - timing.moveEnd) / TIMELINE.winningMoveHoldDuration);
  const opacity = sequenceState.localTime < timing.moveEnd ? 1 : fadeOut;
  renderMoveBubbles({ bubbleType }, pieceState.position, opacity);
}

function hideSetupActorsForWinningMoves() {
  document.querySelectorAll('.animation-setup-piece, .animation-setup-black-piece').forEach((piece) => {
    piece.style.opacity = '0';
  });
  const ready = document.getElementById('animationSetupReadyButton');
  if (ready) ready.style.opacity = '0';
  const ring = document.getElementById('animationSetupKingRing');
  if (ring) ring.style.opacity = '0';
}

function renderWinningMoveSequence(time) {
  const milestones = getWinningMilestones();
  if (time < milestones.moveSequenceStart) {
    hideWinningMoveActors();
    return;
  }

  hideSharedDaggerOverlay();
  hideSetupActorsForWinningMoves();
  const sequenceState = getWinningSequenceState(time);
  const renderStates = getWinningRenderStates(sequenceState);
  const firstTopDagger = getWinningDaggerSlotPoint(0, 0);
  const challengeAnchor = {
    x: firstTopDagger.x - (layout.squareSize * 0.52),
    y: firstTopDagger.y + (layout.squareSize * 1.23),
  };
  renderStates.forEach((renderState) => renderWinningPieceState(renderState));
  renderWinningDaggerTokens(sequenceState);
  renderWinningMoveBubble(sequenceState, renderStates);
  renderChallengeSpeechBubble(
    time,
    getWinningChallengeClickStarts(),
    challengeAnchor,
    { sizeMultiplier: 2 }
  );
}

function getWinningFinaleBaseState() {
  return getWinningSequenceState(getWinningMilestones().end).state;
}

function renderWinningFinaleThirdDagger(time, fillStart, rewindStart, rewindEnd) {
  const token = ensureWinningDaggerToken(2);
  if (!token) return;
  const fillProgress = easeOutCubic((time - fillStart) / TIMELINE.winningFinaleThirdDaggerDuration);
  const rewindProgress = easeInOutCubic((time - rewindStart) / TIMELINE.winningFinaleRewindDuration);
  const opacity = time >= rewindStart
    ? 1 - rewindProgress
    : fillProgress;
  token.classList.toggle('animation-dagger-token--flash', opacity >= 1 && time < rewindStart);
  token.style.left = '50%';
  token.style.top = '50%';
  token.style.opacity = `${opacity}`;
  token.style.transform = `translate(-50%, -50%) scale(${0.82 + (0.18 * clamp(0, opacity, 1))})`;
  token.style.zIndex = '4';
}

function getWinningDrawSequenceState(time) {
  const milestones = getWinningChapterMilestones();
  const state = getWinningFinaleBaseState();
  let elapsed = time - milestones.drawMoveStart;
  let stepStart = milestones.drawMoveStart;

  if (elapsed < 0) {
    return {
      state,
      activeMove: null,
      activeIndex: -1,
      localTime: elapsed,
      stepStart,
    };
  }

  for (let index = 0; index < WINNING_DRAW_MOVE_SEQUENCE.length; index += 1) {
    const move = WINNING_DRAW_MOVE_SEQUENCE[index];
    const duration = getWinningMoveStepDuration(move);
    if (elapsed < duration) {
      return {
        state,
        activeMove: move,
        activeIndex: index,
        localTime: elapsed,
        stepStart,
      };
    }
    commitWinningMove(state, move);
    elapsed -= duration;
    stepStart += duration;
  }

  return {
    state,
    activeMove: null,
    activeIndex: WINNING_DRAW_MOVE_SEQUENCE.length,
    localTime: elapsed,
    stepStart,
  };
}

function renderWinningDrawIcon(time, milestones) {
  const draw = ensureWinningDrawIcon();
  if (!draw) return;
  const progress = easeOutCubic((time - milestones.drawIconStart) / TIMELINE.winningFinaleDrawIconDuration);
  const topCaptured = getWinningCapturedPoint(WHITE, 0);
  const bottomCaptured = getWinningCapturedPoint(BLACK, 0);
  const size = Math.round(layout.squareSize * 1.12);
  draw.style.width = `${size}px`;
  draw.style.height = `${size}px`;
  draw.style.left = `${getWinningDaggerSlotPoint(0, 1).x}px`;
  draw.style.top = `${(topCaptured.y + bottomCaptured.y) / 2}px`;
  draw.style.opacity = `${clamp(0, progress, 1)}`;
  draw.style.transform = `translate(-50%, -50%) scale(${0.72 + (0.28 * clamp(0, progress, 1))})`;
  draw.style.zIndex = '7';
}

function renderWinningFinale(time) {
  const milestones = getWinningChapterMilestones();
  const throne = document.getElementById('animationWinningThrone');
  if (time < milestones.start) {
    if (throne) throne.style.opacity = '0';
    const draw = document.getElementById('animationWinningDrawIcon');
    if (draw) draw.style.opacity = '0';
    return;
  }

  hideSharedDaggerOverlay();
  hideSetupActorsForWinningMoves();
  if (time < milestones.drawIconStart) {
    const draw = document.getElementById('animationWinningDrawIcon');
    if (draw) draw.style.opacity = '0';
  }

  const state = getWinningFinaleBaseState();
  let renderStates = getWinningRenderStates({
    state,
    activeMove: null,
    activeIndex: WINNING_MOVE_SEQUENCE.length,
    localTime: time - milestones.start,
    stepStart: milestones.start,
  });
  const challengedPiece = state.pieces.get('b3');
  const targetPoint = getWinningCellPoint(1, 1);
  const displayPoint = getWinningCapturedPoint(BLACK, state.captured[BLACK].length);
  const swordPiece = state.pieces.get('w5');
  const swordStartPoint = getWinningCellPoint(3, 4);
  const swordTargetPoint = getWinningCellPoint(3, 3);
  const swordTargetPieceId = state.board[3]?.[3];
  const swordTargetPiece = swordTargetPieceId ? state.pieces.get(swordTargetPieceId) : null;
  const heartPiece = state.pieces.get('w0');
  const heartStartPoint = getWinningCellPoint(1, 0);
  const heartTargetPoint = getWinningCellPoint(1, 1);
  const heartCrownPoint = getWinningCellPoint(0, 0);
  const heartTargetPieceId = state.board[1]?.[1];
  const heartTargetPiece = heartTargetPieceId ? state.pieces.get(heartTargetPieceId) : null;
  const heartExitPoint = getWinningStashIntakePoint();
  const swordMoveProgress = clamp(0, (time - milestones.secondMoveStart) / TIMELINE.winningFinaleSecondMoveDuration, 1);
  const secondRewindProgress = clamp(0, (time - milestones.secondRewindStart) / TIMELINE.winningFinaleRewindDuration, 1);
  const swordPosition = secondRewindProgress > 0
    ? interpolatePoint(swordTargetPoint, swordStartPoint, easeInOutCubic(secondRewindProgress))
    : interpolatePoint(swordStartPoint, swordTargetPoint, easeInOutCubic(swordMoveProgress));
  const swordRevealProgress = clamp(0, (time - milestones.secondRevealStart) / TIMELINE.winningFinaleSecondRevealDuration, 1);
  const swordChallengePulse = time >= milestones.secondRevealStart && time < milestones.secondRevealEnd
    ? 1 + (Math.sin(swordRevealProgress * Math.PI) * 0.08)
    : 1;
  const swordTargetTiltProgress = clamp(0, (time - milestones.secondMoveEnd) / TIMELINE.winningCaptureTiltDuration, 1);
  const swordTargetRewindProgress = clamp(0, (time - milestones.secondRewindStart) / TIMELINE.winningFinaleRewindDuration, 1);
  const effectiveSwordTargetTilt = swordTargetRewindProgress > 0
    ? 1 - swordTargetRewindProgress
    : swordTargetTiltProgress;
  const heartMoveProgress = clamp(0, (time - milestones.thirdMoveStart) / TIMELINE.winningFinaleThirdMoveDuration, 1);
  const heartRevealProgress = clamp(0, (time - milestones.thirdRevealStart) / TIMELINE.winningFinaleThirdRevealDuration, 1);
  const heartSwapProgress = clamp(0, (time - milestones.thirdSwapStart) / TIMELINE.winningFinaleThirdSwapDuration, 1);
  const thirdRewindProgress = clamp(0, (time - milestones.thirdRewindStart) / TIMELINE.winningFinaleRewindDuration, 1);
  const crownMoveProgress = clamp(0, (time - milestones.crownMoveStart) / TIMELINE.winningFinaleCrownMoveDuration, 1);
  const easedHeartMove = easeInOutCubic(heartMoveProgress);
  const easedHeartSwap = easeInOutCubic(heartSwapProgress);
  const easedThirdRewind = easeInOutCubic(thirdRewindProgress);
  const heartPreRewindPosition = heartSwapProgress > 0
    ? interpolatePoint(heartTargetPoint, heartExitPoint, easedHeartSwap)
    : interpolatePoint(heartStartPoint, heartTargetPoint, easedHeartMove);
  const heartPosition = thirdRewindProgress > 0
    ? interpolatePoint(heartExitPoint, heartStartPoint, easedThirdRewind)
    : heartPreRewindPosition;
  const crownHeartPosition = interpolatePoint(heartStartPoint, heartCrownPoint, easeInOutCubic(crownMoveProgress));
  const heartScaleX = 1;
  const heartChallengePulse = time >= milestones.thirdRevealStart && time < milestones.thirdRevealEnd
    ? 1 + (Math.sin(heartRevealProgress * Math.PI) * 0.08)
    : 1;
  const heartTargetTiltProgress = clamp(0, (time - milestones.thirdMoveEnd) / TIMELINE.winningCaptureTiltDuration, 1);
  const heartTargetRewindProgress = clamp(0, (time - milestones.thirdRewindStart) / TIMELINE.winningFinaleRewindDuration, 1);
  const effectiveHeartTargetTilt = heartTargetRewindProgress > 0
    ? 1 - heartTargetRewindProgress
    : heartTargetTiltProgress;
  const heartIdentity = IDENTITIES.KING;
  const revealProgress = clamp(0, (time - milestones.revealStart) / TIMELINE.winningFinaleRevealDuration, 1);
  const slideProgress = clamp(0, (time - milestones.captureSlideStart) / TIMELINE.winningFinaleCaptureSlideDuration, 1);
  const rewindProgress = clamp(0, (time - milestones.rewindStart) / TIMELINE.winningFinaleRewindDuration, 1);
  const isRevealed = time >= milestones.revealStart && revealProgress >= 0.5;
  const flipScaleX = time >= milestones.revealStart && time < milestones.revealEnd
    ? Math.max(0.08, Math.abs(1 - (revealProgress * 2)))
    : 1;
  const easedSlideProgress = easeInOutCubic(slideProgress);
  const easedRewindProgress = easeInOutCubic(rewindProgress);
  const finalePiecePosition = rewindProgress > 0
    ? interpolatePoint(displayPoint, targetPoint, easedRewindProgress)
    : interpolatePoint(targetPoint, displayPoint, easedSlideProgress);
  const finalePieceScale = rewindProgress > 0
    ? 0.5 + (easedRewindProgress * 0.5)
    : 1 - (easedSlideProgress * 0.5);
  const finalePieceIdentity = rewindProgress > 0 && rewindProgress >= 0.5
    ? UNKNOWN_IDENTITY
    : (isRevealed || slideProgress > 0 ? IDENTITIES.KING : UNKNOWN_IDENTITY);
  const finalePieceScaleX = rewindProgress > 0 && rewindProgress < 1
    ? Math.max(0.08, Math.abs(1 - (rewindProgress * 2)))
    : flipScaleX;
  const drawRewindProgress = clamp(0, (time - milestones.drawRewindStart) / TIMELINE.winningFinaleRewindDuration, 1);

  if (time >= milestones.drawMoveStart) {
    const drawSequenceState = getWinningDrawSequenceState(time);
    renderStates = getWinningRenderStates(drawSequenceState);
    renderStates.forEach((renderState) => renderWinningPieceState(renderState));
    renderWinningDaggerTokens({
      state: drawSequenceState.state,
      activeMove: null,
      activeIndex: WINNING_MOVE_SEQUENCE.length,
      localTime: time - milestones.start,
      stepStart: milestones.start,
    });
    renderWinningMoveBubble(drawSequenceState, renderStates);
    renderChallengeSpeechBubble(time, [], getWinningDaggerSlotPoint(0, 0), { sizeMultiplier: 2 });
    const winningThrone = ensureWinningThrone();
    if (winningThrone) winningThrone.style.opacity = '0';
    const rewindIndicator = ensureRewindIndicator();
    if (rewindIndicator) rewindIndicator.style.opacity = '0';
    if (time >= milestones.drawIconStart) {
      renderWinningDrawIcon(time, milestones);
    } else {
      const draw = document.getElementById('animationWinningDrawIcon');
      if (draw) draw.style.opacity = '0';
    }
    return;
  }

  if (challengedPiece) {
    renderStates.set(challengedPiece.id, {
      piece: challengedPiece,
      position: finalePiecePosition,
      visualIdentity: finalePieceIdentity,
      opacity: 1,
      scale: finalePieceScale,
      scaleX: finalePieceScaleX,
      rotation: 0,
      zIndex: slideProgress > 0 && rewindProgress <= 0 ? 4 : 5,
    });
  }

  if (
    swordTargetPiece
    && time >= milestones.secondMoveEnd
    && time < milestones.secondRewindEnd
    && time < milestones.thirdMoveStart
  ) {
    renderStates.set(swordTargetPiece.id, {
      piece: swordTargetPiece,
      position: getCapturedTiltedPoint(swordTargetPoint, effectiveSwordTargetTilt),
      visualIdentity: getWinningPieceVisualIdentity(swordTargetPiece, false),
      opacity: 1,
      scale: 1,
      scaleX: 1,
      rotation: 24 * effectiveSwordTargetTilt,
      zIndex: 3,
    });
  }

  if (
    heartTargetPiece
    && time >= milestones.thirdMoveEnd
    && time < milestones.thirdRewindEnd
  ) {
    renderStates.set(heartTargetPiece.id, {
      piece: heartTargetPiece,
      position: getCapturedTiltedPoint(heartTargetPoint, effectiveHeartTargetTilt),
      visualIdentity: getWinningPieceVisualIdentity(heartTargetPiece, false),
      opacity: 1,
      scale: 1,
      scaleX: 1,
      rotation: 24 * effectiveHeartTargetTilt,
      zIndex: 3,
    });
  }

  if (swordPiece && time >= milestones.secondMoveStart) {
    renderStates.set(swordPiece.id, {
      piece: swordPiece,
      position: swordPosition,
      visualIdentity: IDENTITIES.ROOK,
      opacity: 1,
      scale: swordChallengePulse,
      scaleX: 1,
      rotation: 0,
      zIndex: 6,
    });
  }

  if (heartPiece && time >= milestones.crownMoveStart) {
    const rewindToStartProgress = easeInOutCubic(drawRewindProgress);
    renderStates.set(heartPiece.id, {
      piece: heartPiece,
      position: drawRewindProgress > 0
        ? interpolatePoint(heartCrownPoint, heartStartPoint, rewindToStartProgress)
        : crownHeartPosition,
      visualIdentity: IDENTITIES.KING,
      opacity: 1,
      scale: 1,
      scaleX: 1,
      rotation: 0,
      zIndex: 7,
    });
  } else if (heartPiece && time >= milestones.thirdMoveStart) {
    renderStates.set(heartPiece.id, {
      piece: heartPiece,
      position: heartPosition,
      visualIdentity: heartIdentity,
      opacity: 1,
      scale: heartChallengePulse,
      scaleX: heartScaleX,
      rotation: 0,
      zIndex: 7,
    });
  }

  renderStates.forEach((renderState) => renderWinningPieceState(renderState));
  renderWinningDaggerTokens({
    state,
    activeMove: null,
    activeIndex: WINNING_MOVE_SEQUENCE.length,
    localTime: time - milestones.start,
    stepStart: milestones.start,
  });
  if (time >= milestones.secondDaggerStart && time < milestones.secondRewindEnd) {
    renderWinningFinaleThirdDagger(time, milestones.secondDaggerStart, milestones.secondRewindStart, milestones.secondRewindEnd);
  }

  if (time >= milestones.crownMoveStart && time < milestones.drawRewindStart) {
    renderMoveBubbles({ bubbleType: 'kingSpeechLeft' }, crownHeartPosition, 1);
  } else if (time >= milestones.thirdMoveStart && time < milestones.thirdSwapEnd) {
    renderMoveBubbles({ bubbleType: 'kingSpeechLeft' }, heartPosition, 1);
  } else if (time >= milestones.secondMoveStart && time < milestones.secondRewindStart) {
    renderMoveBubbles({ bubbleType: 'rookSpeechLeft' }, swordPosition, 1);
  } else if (time < milestones.captureSlideStart) {
    renderMoveBubbles({ bubbleType: 'knightSpeechLeft' }, targetPoint, 1);
  } else {
    renderMoveBubbles(null);
  }

  const bottomDagger = getWinningDaggerSlotPoint(1, 0);
  const topDagger = getWinningDaggerSlotPoint(0, 0);
  if (time >= milestones.thirdChallengeStart) {
    renderChallengeSpeechBubble(
      time,
      [milestones.thirdChallengeStart],
      {
        x: topDagger.x - (layout.squareSize * 0.52),
        y: topDagger.y + (layout.squareSize * 1.23),
      },
      { sizeMultiplier: 2 }
    );
  } else if (time >= milestones.secondChallengeStart) {
    renderChallengeSpeechBubble(
      time,
      [milestones.secondChallengeStart],
      {
        x: topDagger.x - (layout.squareSize * 0.52),
        y: topDagger.y + (layout.squareSize * 1.23),
      },
      { sizeMultiplier: 2 }
    );
  } else {
    renderChallengeSpeechBubble(
      time,
      [milestones.challengeStart],
      {
        x: bottomDagger.x + (layout.squareSize * 0.16),
        y: bottomDagger.y + (layout.squareSize * 0.34),
      },
      { sizeMultiplier: 2 }
    );
  }

  const winningThrone = ensureWinningThrone();
  if (!winningThrone) return;
  const throneAppearProgress = easeOutCubic((time - milestones.throneStart) / TIMELINE.winningFinaleThroneDuration);
  const throneRewindProgress = easeInOutCubic((time - milestones.rewindStart) / TIMELINE.winningFinaleRewindDuration);
  const secondThroneAppearProgress = easeOutCubic((time - milestones.secondThroneStart) / TIMELINE.winningFinaleThroneDuration);
  const secondThroneRewindProgress = easeInOutCubic((time - milestones.secondRewindStart) / TIMELINE.winningFinaleRewindDuration);
  const thirdThroneAppearProgress = easeOutCubic((time - milestones.thirdThroneStart) / TIMELINE.winningFinaleThroneDuration);
  const thirdThroneRewindProgress = easeInOutCubic((time - milestones.thirdRewindStart) / TIMELINE.winningFinaleRewindDuration);
  const crownThroneProgress = easeOutCubic((time - milestones.crownThroneStart) / TIMELINE.winningFinaleThroneDuration);
  const firstThroneProgress = Math.min(throneAppearProgress, 1 - throneRewindProgress);
  const secondThroneProgress = Math.min(secondThroneAppearProgress, 1 - secondThroneRewindProgress);
  const thirdThroneProgress = Math.min(thirdThroneAppearProgress, 1 - thirdThroneRewindProgress);
  const finalThroneProgress = Math.min(crownThroneProgress, 1 - drawRewindProgress);
  const throneProgress = Math.max(firstThroneProgress, secondThroneProgress, thirdThroneProgress, finalThroneProgress);
  const throneSize = Math.round(layout.squareSize * 0.72);
  const thronePoint = {
    x: getWinningDaggerSlotPoint(1, 2).x + (layout.squareSize * 0.68),
    y: getWinningDaggerSlotPoint(1, 2).y,
  };
  winningThrone.style.width = `${throneSize}px`;
  winningThrone.style.height = `${throneSize}px`;
  winningThrone.style.left = `${thronePoint.x}px`;
  winningThrone.style.top = `${thronePoint.y}px`;
  winningThrone.style.opacity = `${clamp(0, throneProgress, 1)}`;
  winningThrone.style.transform = `translate(-50%, -50%) scale(${0.7 + (0.3 * throneProgress)})`;

  const rewindIndicator = ensureRewindIndicator();
  if (rewindIndicator) {
    const activeRewindStart = time >= milestones.drawRewindStart
      ? milestones.drawRewindStart
      : (time >= milestones.thirdRewindStart
      ? milestones.thirdRewindStart
      : (time >= milestones.secondRewindStart ? milestones.secondRewindStart : milestones.rewindStart));
    const activeRewindEnd = time >= milestones.drawRewindStart
      ? milestones.drawRewindEnd
      : (time >= milestones.thirdRewindStart
      ? milestones.thirdRewindEnd
      : (time >= milestones.secondRewindStart ? milestones.secondRewindEnd : milestones.rewindEnd));
    const rewindVisible = time >= activeRewindStart && time < activeRewindEnd;
    const rewindFadeIn = easeOutCubic((time - activeRewindStart) / 180);
    const rewindFadeOut = 1 - easeInOutCubic((time - (activeRewindEnd - 240)) / 240);
    rewindIndicator.style.opacity = rewindVisible
      ? `${clamp(0, Math.min(rewindFadeIn, rewindFadeOut), 1)}`
      : '0';
  }
}

function renderSetupKingRing(state, time) {
  const ring = ensureOverlayElement('animationSetupKingRing', 'animation-setup-king-ring');
  if (!ring || !layout) return;
  if (!state?.kingPosition) {
    ring.style.opacity = '0';
    return;
  }
  ring.style.setProperty('--square-size', `${layout.squareSize}px`);
  ring.style.left = `${state.kingPosition.x}px`;
  ring.style.top = `${state.kingPosition.y}px`;
  ring.style.opacity = `${clamp(0, state.ringOpacity * getWinningFadeMultiplier(time), 1)}`;
}

function renderSetupCompletion(time, milestones) {
  const progress = easeOutCubic((time - milestones.shuffleEnd) / 360);
  const blackOpacity = clamp(0, progress, 1);
  const readyOpacity = clamp(0, progress * getWinningFadeMultiplier(time), 1);
  const topRank = getSetupTopRankPositions();
  const blackActors = ensureSetupBlackActors();
  blackActors.forEach((actor, index) => {
    if (!actor) return;
    const position = topRank[index];
    actor.style.setProperty('--piece-size', `${Math.round(layout.pieceSize)}px`);
    actor.style.left = `${position.x}px`;
    actor.style.top = `${position.y}px`;
    actor.style.opacity = `${blackOpacity}`;
    actor.style.zIndex = '2';
    actor.style.transform = 'translate(-50%, -50%) scale(1)';
    actor.style.filter = 'drop-shadow(0 12px 12px rgba(0, 0, 0, 0.40))';
  });

  const button = ensureSetupReadyButton();
  if (!button) return;
  const geometry = getSetupBoardGeometry();
  const width = 160;
  const height = 96;
  button.style.left = `${Math.floor(geometry.centerX - (width / 2))}px`;
  button.style.top = `${Math.floor(geometry.centerY - (height / 2))}px`;
  button.style.width = `${width}px`;
  button.style.height = `${height}px`;
  button.style.fontSize = '20px';
  button.style.opacity = `${readyOpacity}`;
}

function renderSetupActors(time) {
  if (!layout) return;
  const milestones = getSetupMilestones();
  if (time < milestones.wipeEnd) {
    hideSetupActors();
    return;
  }

  const actors = ensureSetupActors();
  const blackActors = document.querySelectorAll('.animation-setup-black-piece');
  blackActors.forEach((piece) => {
    piece.style.opacity = '0';
  });
  const readyButton = document.getElementById('animationSetupReadyButton');
  if (readyButton) readyButton.style.opacity = '0';
  const originals = getSetupOriginalPositions();
  const boardPositions = getSetupExpandedBoardPositions();
  const stashPositions = getSetupStashPositions();
  const pieceSize = layout.pieceSize;
  const shuffleState = getSetupShuffleState(time, milestones);
  const winningPositions = getWinningActorPositions(time);

  actors.forEach((actor, index) => {
    if (!actor) return;
    let position = null;
    let opacity = 0;

    if (index < SETUP_ORIGINAL_IDENTITIES.length) {
      const target = originals[index];
      const offscreen = {
        x: layout.width + layout.squareSize + (index * layout.squareSize * 0.34),
        y: target.y,
      };
      if (time >= milestones.originalsStart && time < milestones.originalsEnd) {
        const progress = easeInOutCubic((time - milestones.originalsStart) / TIMELINE.setupOriginalSlideDuration);
        position = interpolatePoint(offscreen, target, progress);
        opacity = progress;
      } else if (time >= milestones.originalsEnd) {
        position = target;
        opacity = 1;
      }
    } else {
      const sourceIndex = index - 4;
      const source = originals[sourceIndex];
      const target = boardPositions[index];
      if (time >= milestones.duplicateStart && time < milestones.duplicateEnd) {
        const progress = easeInOutCubic((time - milestones.duplicateStart) / TIMELINE.setupDuplicateDuration);
        position = interpolatePoint(source, target, progress);
        opacity = progress;
      } else if (time >= milestones.duplicateEnd) {
        position = target;
        opacity = 1;
      }
    }

    if (position && time >= milestones.boardMorphStart) {
      const progress = easeInOutCubic((time - milestones.boardMorphStart) / TIMELINE.setupBoardMorphDuration);
      position = interpolatePoint(boardPositions[index], stashPositions[index], progress);
    }

    if (position && time >= milestones.placementStart) {
      position = getSetupPostPlacementPosition(index, time, milestones, stashPositions);
    }

    if (shuffleState.positions) {
      position = shuffleState.positions[index];
    }

    if (winningPositions) {
      position = winningPositions[index];
    }

    if (!position) {
      actor.style.opacity = '0';
      return;
    }

    actor.style.setProperty('--piece-size', `${Math.round(pieceSize)}px`);
    actor.style.left = `${position.x}px`;
    actor.style.top = `${position.y}px`;
    actor.style.opacity = `${clamp(0, opacity, 1)}`;
    actor.style.zIndex = '2';
    actor.style.transform = 'translate(-50%, -50%) scale(1)';
    actor.style.filter = 'drop-shadow(0 12px 12px rgba(0, 0, 0, 0.40))';
  });

  renderSetupKingRing(shuffleState, time);
  if (time >= milestones.shuffleEnd) {
    renderSetupCompletion(time, milestones);
  }
  renderWinningDaggerSlots(time);
}

function getCapturesPoisonBubblePosition(blackPosition) {
  return {
    x: blackPosition.x,
    y: blackPosition.y,
  };
}

function renderCapturesDaggerClear(time, milestones) {
  const progress = easeInOutCubic((time - milestones.start) / TIMELINE.captureClearFadeDuration);
  const opacity = `${clamp(0, 1 - progress, 1)}`;
  const dagger = document.getElementById('animationDaggerToken');
  if (dagger) {
    dagger.classList.remove('animation-dagger-token--flash');
    dagger.style.opacity = opacity;
  }
  const slots = document.getElementById('animationDaggerSlots');
  if (slots) {
    slots.style.opacity = opacity;
  }
}

function getCapturesWhiteState(time, milestones, previousPosition, origin, target) {
  let identity = UNKNOWN_IDENTITY;
  let position = { ...previousPosition };
  let scaleX = 1;
  let opacity = 1;
  let rotation = 0;
  let zIndex = 2;

  if (time >= milestones.clearEnd && time < milestones.returnEnd) {
    const progress = easeInOutCubic((time - milestones.clearEnd) / TIMELINE.captureReturnDuration);
    position = interpolatePoint(previousPosition, origin, progress);
  } else if (time >= milestones.returnEnd) {
    position = { ...origin };
  }

  if (time >= milestones.revealStart && time < milestones.revealMid) {
    scaleX = Math.max(0.02, 1 - easeInCubic((time - milestones.revealStart) / TIMELINE.flipHalfDuration));
  } else if (time >= milestones.revealMid) {
    identity = IDENTITIES.ROOK;
    if (time < milestones.revealEnd) {
      scaleX = Math.max(0.02, easeOutCubic((time - milestones.revealMid) / TIMELINE.flipHalfDuration));
    }
  }

  if (time >= milestones.attackStart && time < milestones.attackEnd) {
    const progress = easeInOutCubic((time - milestones.attackStart) / TIMELINE.captureAttackSlideDuration);
    position = interpolatePoint(origin, target, progress);
  } else if (time >= milestones.attackEnd) {
    position = { ...target };
  }

  if (time >= milestones.poisonCursorClickEnd) {
    const progress = easeInOutCubic((time - milestones.poisonCursorClickEnd) / TIMELINE.capturePoisonOutcomeDuration);
    position = getCapturedTiltedPoint(target, progress);
    rotation = 30 * progress;
  }

  if (time >= milestones.passCursorClickEnd && time < milestones.passFadeEnd) {
    const progress = easeInOutCubic((time - milestones.passCursorClickEnd) / TIMELINE.capturePassFadeDuration);
    opacity = 1 - progress;
  } else if (time >= milestones.passFadeEnd && time < milestones.passRewindStart) {
    opacity = 0;
  } else if (time >= milestones.passRewindStart && time < milestones.passRewindEnd) {
    const progress = easeInOutCubic((time - milestones.passRewindStart) / TIMELINE.rewindRestoreDuration);
    opacity = progress;
  }

  if (time >= milestones.firstChallengeCursorClickEnd && time < milestones.daggerRewindStart) {
    const progress = easeInOutCubic((time - milestones.firstChallengeCursorClickEnd) / TIMELINE.captureChallengeResolveDuration);
    opacity = 1 - progress;
  } else if (time >= milestones.daggerRewindStart && time < milestones.daggerRewindEnd) {
    const progress = easeInOutCubic((time - milestones.daggerRewindStart) / TIMELINE.captureDaggerRewindDuration);
    opacity = progress;
  }

  if (time >= milestones.secondChallengeCursorClickEnd) {
    const progress = easeInOutCubic((time - milestones.secondChallengeCursorClickEnd) / TIMELINE.captureScytheResolveDuration);
    position = getCapturedTiltedPoint(target, 1 - progress);
    rotation = 30 * (1 - progress);
    opacity = 1;
  }

  if (time >= milestones.finalRewindStart && time < milestones.finalRewindEnd) {
    const progress = easeInOutCubic((time - milestones.finalRewindStart) / TIMELINE.captureFinalRewindDuration);
    position = interpolatePoint(target, origin, progress);
    rotation = 0;
    opacity = 1;
  } else if (time >= milestones.finalRewindEnd && time < milestones.heartCaptureStart) {
    position = { ...origin };
    rotation = 0;
    opacity = 1;
  } else if (time >= milestones.heartCaptureStart && time < milestones.heartCaptureEnd) {
    const progress = easeInOutCubic((time - milestones.heartCaptureStart) / TIMELINE.captureAttackSlideDuration);
    position = interpolatePoint(origin, target, progress);
    rotation = 0;
    opacity = 1;
  } else if (time >= milestones.heartCaptureEnd) {
    position = { ...target };
    rotation = 0;
    opacity = 1;
  }

  return {
    identity,
    position,
    scaleX,
    opacity,
    rotation,
    zIndex,
  };
}

function getCapturesBlackState(time, milestones, offscreen, target) {
  let position = { ...offscreen };
  let opacity = 0;
  let rotation = 0;
  let zIndex = 1;
  let identity = UNKNOWN_IDENTITY;
  let scale = 1;
  let scaleX = 1;

  if (time >= milestones.blackSlideStart && time < milestones.blackSlideEnd) {
    const progress = easeInOutCubic((time - milestones.blackSlideStart) / TIMELINE.captureBlackSlideDuration);
    position = interpolatePoint(offscreen, target, progress);
    opacity = progress;
  } else if (time >= milestones.blackSlideEnd) {
    position = { ...target };
    opacity = 1;
  }

  if (time >= milestones.thoughtHoldEnd && time < milestones.poisonCursorClickEnd) {
    const progress = easeInOutCubic((time - milestones.thoughtHoldEnd) / TIMELINE.captureDeclareDuration);
    position = getCapturedTiltedPoint(target, progress);
    rotation = 30 * progress;
  } else if (time >= milestones.poisonCursorClickEnd) {
    const progress = easeInOutCubic((time - milestones.poisonCursorClickEnd) / TIMELINE.capturePoisonOutcomeDuration);
    position = getCapturedTiltedPoint(target, 1 - progress);
    rotation = 30 * (1 - progress);
  }

  if (time >= milestones.firstChallengeCursorClickEnd && time < milestones.firstChallengeResolveEnd) {
    const progress = clamp(0, (time - milestones.firstChallengeCursorClickEnd) / TIMELINE.captureChallengeResolveDuration, 1);
    identity = progress >= 0.5 ? IDENTITIES.BOMB : UNKNOWN_IDENTITY;
    scale = 1 + (Math.sin(progress * Math.PI) * 0.08);
  } else if (time >= milestones.firstChallengeResolveEnd && time < milestones.daggerRewindStart) {
    identity = IDENTITIES.BOMB;
  } else if (time >= milestones.daggerRewindStart && time < milestones.daggerRewindEnd) {
    const progress = clamp(0, (time - milestones.daggerRewindStart) / TIMELINE.captureDaggerRewindDuration, 1);
    identity = progress < 0.5 ? IDENTITIES.BOMB : UNKNOWN_IDENTITY;
    scale = 1 + (Math.sin(progress * Math.PI) * 0.08);
  }

  if (time >= milestones.secondChallengeCursorClickEnd) {
    const progress = clamp(0, (time - milestones.secondChallengeCursorClickEnd) / TIMELINE.captureScytheResolveDuration, 1);
    position = getCapturedTiltedPoint(target, progress);
    rotation = 30 * progress;
    zIndex = 3;
    if (progress < 0.5) {
      identity = UNKNOWN_IDENTITY;
      scaleX = Math.max(0.02, 1 - easeInCubic(progress / 0.5));
    } else {
      identity = IDENTITIES.KNIGHT;
      scaleX = Math.max(0.02, easeOutCubic((progress - 0.5) / 0.5));
    }
    if (time >= milestones.secondChallengeResolveEnd) {
      identity = IDENTITIES.KNIGHT;
      scaleX = 1;
    }
    if (time >= milestones.secondChallengeHoldEnd && time < milestones.scytheFadeEnd) {
      const fadeProgress = easeInOutCubic((time - milestones.secondChallengeHoldEnd) / TIMELINE.captureScytheFadeDuration);
      opacity = 1 - fadeProgress;
    } else if (time >= milestones.scytheFadeEnd) {
      opacity = 0;
    }
  }

  if (time >= milestones.finalRewindStart && time < milestones.finalRewindEnd) {
    const progress = easeInOutCubic((time - milestones.finalRewindStart) / TIMELINE.captureFinalRewindDuration);
    const startOffset = getCapturedTiltOffset(1);
    position = {
      x: target.x + (startOffset.x * (1 - progress)),
      y: target.y + (startOffset.y * (1 - progress)),
    };
    identity = UNKNOWN_IDENTITY;
    scaleX = 1;
    rotation = 30 * (1 - progress);
    zIndex = 1;
    opacity = progress;
  } else if (time >= milestones.finalRewindEnd && time < milestones.heartCaptureHoldEnd) {
    position = { ...target };
    identity = UNKNOWN_IDENTITY;
    scaleX = 1;
    rotation = 0;
    zIndex = 1;
    opacity = 1;
  } else if (time >= milestones.heartThoughtCursorClickEnd) {
    const progress = easeInOutCubic((time - milestones.heartThoughtCursorClickEnd) / TIMELINE.captureHeartDeclareDuration);
    position = getCapturedTiltedPoint(target, progress);
    identity = UNKNOWN_IDENTITY;
    scaleX = 1;
    rotation = 30 * progress;
    zIndex = 1;
    opacity = 1;
  }

  return {
    identity,
    position,
    opacity,
    rotation,
    scale,
    scaleX,
    zIndex,
  };
}

function getCapturesBubbleTypes(time, milestones) {
  if (time >= milestones.finalRewindEnd && time < milestones.heartThoughtCursorClickEnd) {
    return ['kingThoughtRight', 'rookThoughtLeft'];
  }
  if (time >= milestones.heartCaptureStart && time < milestones.heartThoughtCursorClickEnd) {
    return ['kingThoughtRight', 'rookThoughtLeft'];
  }
  if (time >= milestones.heartThoughtCursorClickEnd) {
    return ['kingSpeechLeft'];
  }
  if (time >= milestones.secondChallengeCursorClickEnd) {
    return [];
  }
  if (time >= milestones.poisonCursorClickEnd) {
    return ['bombSpeechLeft'];
  }
  if (time >= milestones.thoughtHoldEnd) {
    return ['rookSpeechLeft'];
  }
  if (time >= milestones.attackStart && time < milestones.attackEnd) {
    return ['kingThoughtRight', 'rookThoughtLeft'];
  }
  if (time >= milestones.attackEnd && time < milestones.thoughtHoldEnd) {
    return ['kingThoughtRight', 'rookThoughtLeft'];
  }
  return [];
}

function renderCapturesActionButtons(time, milestones, points) {
  renderCapturesButton({
    button: ensureChallengeButton(),
    target: getCapturesChallengeButtonPoint(points),
    label: 'Challenge',
    start: milestones.challengeButtonStart,
    end: milestones.challengeButtonEnd,
    visibleUntil: milestones.secondChallengeCursorClickEnd,
    className: 'cg-button cg-button--primary animation-challenge-button',
    slideDuration: TIMELINE.challengeButtonSlideDuration,
  }, time);

  if (time >= milestones.heartButtonsStart) {
    renderCapturesButton({
      button: ensureChallengeButton(),
      target: getCapturesChallengeButtonPoint(points),
      label: 'Challenge',
      start: milestones.heartButtonsStart,
      end: milestones.heartButtonsEnd,
      visibleUntil: milestones.end + 1,
      className: 'cg-button cg-button--primary animation-challenge-button',
      slideDuration: TIMELINE.challengeButtonSlideDuration,
    }, time);
  }

  renderCapturesButton({
    button: ensurePoisonButton(),
    target: getCapturesPoisonButtonPoint(points),
    label: 'Poison',
    start: milestones.poisonButtonStart,
    end: milestones.poisonButtonEnd,
    visibleUntil: milestones.passButtonStart,
    className: 'cg-button cg-button--danger animation-poison-button',
    slideDuration: TIMELINE.capturePoisonButtonSlideDuration,
  }, time);

  if (time >= milestones.heartButtonsStart) {
    renderCapturesFadingButton({
      button: ensurePoisonButton(),
      target: getCapturesPoisonButtonPoint(points),
      label: 'Poison',
      start: milestones.heartButtonsStart,
      end: milestones.heartButtonsEnd,
      fadeEnd: milestones.heartPoisonFadeEnd,
      className: 'cg-button cg-button--danger animation-poison-button',
      slideDuration: TIMELINE.challengeButtonSlideDuration,
    }, time);
  }

  renderCapturesButton({
    button: ensurePassButton(),
    target: getCapturesPoisonButtonPoint(points),
    label: 'Pass',
    start: milestones.passButtonStart,
    end: milestones.passButtonEnd,
    visibleUntil: milestones.firstChallengeCursorClickStart,
    className: 'cg-button cg-button--primary animation-pass-button',
    slideDuration: TIMELINE.capturePassButtonSlideDuration,
  }, time);

  renderStaticCapturesButton({
    button: ensurePassButton(),
    target: getCapturesPoisonButtonPoint(points),
    label: 'Pass',
    visibleFrom: milestones.passRewindStart,
    visibleUntil: milestones.firstChallengeCursorStart,
    className: 'cg-button cg-button--primary animation-pass-button',
  }, time);

  renderStaticCapturesButton({
    button: ensurePassButton(),
    target: getCapturesPoisonButtonPoint(points),
    label: 'Pass',
    visibleFrom: milestones.daggerRewindStart,
    visibleUntil: milestones.secondChallengeCursorStart,
    className: 'cg-button cg-button--primary animation-pass-button',
  }, time);

  renderStaticCapturesButton({
    button: ensurePassButton(),
    target: getCapturesPoisonButtonPoint(points),
    label: 'Pass',
    visibleFrom: milestones.finalRewindStart,
    visibleUntil: milestones.heartCaptureStart,
    className: 'cg-button cg-button--primary animation-pass-button',
  }, time);
}

function renderCapturesFadingButton(config, time) {
  const { button, target, label, start, end, fadeEnd, className, slideDuration } = config;
  if (!button) return;
  const { width, height } = getCapturesButtonMetrics();
  const offscreenY = -layout.squareSize;
  let y = offscreenY;
  let opacity = 0;

  if (time >= start && time < end) {
    const progress = easeInOutCubic((time - start) / slideDuration);
    y = offscreenY + ((target.y - offscreenY) * progress);
    opacity = progress;
  } else if (time >= end && time < fadeEnd) {
    y = target.y;
    opacity = 1 - (easeInOutCubic((time - end) / (fadeEnd - end)) * 0.8);
  } else if (time >= fadeEnd) {
    y = target.y;
    opacity = 0.2;
  }

  button.className = className;
  button.textContent = label;
  button.style.left = `${Math.floor(target.x - (width / 2))}px`;
  button.style.top = `${Math.floor(y - (height / 2))}px`;
  button.style.width = `${width}px`;
  button.style.height = `${height}px`;
  button.style.fontSize = `${Math.round(Math.min(20, Math.max(13, height * 0.28)))}px`;
  button.style.opacity = `${clamp(0, opacity, 1)}`;
}

function renderStaticCapturesButton(config, time) {
  const { button, target, label, visibleFrom, visibleUntil, className } = config;
  if (!button || time < visibleFrom || time >= visibleUntil) return;
  const { width, height } = getCapturesButtonMetrics();
  button.className = className;
  button.textContent = label;
  button.style.left = `${Math.floor(target.x - (width / 2))}px`;
  button.style.top = `${Math.floor(target.y - (height / 2))}px`;
  button.style.width = `${width}px`;
  button.style.height = `${height}px`;
  button.style.fontSize = `${Math.round(Math.min(20, Math.max(13, height * 0.28)))}px`;
  button.style.opacity = '1';
}

function getCapturesButtonMetrics() {
  const width = Math.min(160, Math.max(104, Math.floor(layout.squareSize * 1.38)));
  return {
    width,
    height: Math.floor(width * 0.6),
  };
}

function renderCapturesButton(config, time) {
  const { button, target, label, start, end, visibleUntil, className, slideDuration } = config;
  if (!button) return;
  const { width, height } = getCapturesButtonMetrics();
  const offscreenY = -layout.squareSize;
  let y = offscreenY;
  let opacity = 0;

  if (time >= start && time < end) {
    const progress = easeInOutCubic((time - start) / slideDuration);
    y = offscreenY + ((target.y - offscreenY) * progress);
    opacity = progress;
  } else if (time >= end && time < visibleUntil) {
    y = target.y;
    opacity = 1;
  }

  button.className = className;
  button.textContent = label;
  button.style.left = `${Math.floor(target.x - (width / 2))}px`;
  button.style.top = `${Math.floor(y - (height / 2))}px`;
  button.style.width = `${width}px`;
  button.style.height = `${height}px`;
  button.style.fontSize = `${Math.round(Math.min(20, Math.max(13, height * 0.28)))}px`;
  button.style.opacity = `${clamp(0, opacity, 1)}`;
}

function renderCapturesCursor(time, milestones, points) {
  const cursor = ensureFakeCursor();
  if (!cursor) return;
  const position = getCapturesCursorState(time, milestones, points);
  if (!position) {
    cursor.style.opacity = '0';
    return;
  }

  cursor.style.left = `${position.x}px`;
  cursor.style.top = `${position.y}px`;
  cursor.style.opacity = `${clamp(0, position.opacity, 1)}`;
  cursor.style.setProperty('--cursor-scale', `${position.scale}`);
}

function getCapturesCursorState(time, milestones, points) {
  const challengeTarget = getCapturesChallengeButtonPoint(points);
  const poisonTarget = getCapturesPoisonButtonPoint(points);
  const start = {
    x: challengeTarget.x + (layout.squareSize * 1.05),
    y: challengeTarget.y - (layout.squareSize * 1.15),
  };

  if (time < milestones.challengeCursorStart) return null;
  if (time < milestones.challengeCursorArrive) {
    const progress = easeInOutCubic((time - milestones.challengeCursorStart) / TIMELINE.challengeCursorApproachDuration);
    return {
      ...interpolatePoint(start, challengeTarget, progress),
      opacity: progress,
      scale: 1,
    };
  }
  if (time < milestones.poisonCursorStart) {
    return { ...challengeTarget, opacity: 1, scale: 1 };
  }
  if (time < milestones.poisonCursorClickStart) {
    const progress = easeInOutCubic((time - milestones.poisonCursorStart) / TIMELINE.captureCursorMoveDuration);
    return { ...interpolatePoint(challengeTarget, poisonTarget, progress), opacity: 1, scale: 1 };
  }
  if (time < milestones.poisonCursorClickEnd) {
    const raw = (time - milestones.poisonCursorClickStart) / TIMELINE.challengeCursorClickDuration;
    return { ...poisonTarget, opacity: 1, scale: 1 - (Math.sin(raw * Math.PI) * 0.12) };
  }

  if (time < milestones.passCursorStart) return null;
  if (time < milestones.passCursorClickStart) {
    const progress = easeInOutCubic((time - milestones.passCursorStart) / TIMELINE.captureCursorMoveDuration);
    const passStart = {
      x: poisonTarget.x + (layout.squareSize * 0.62),
      y: poisonTarget.y + (layout.squareSize * 0.58),
    };
    return { ...interpolatePoint(passStart, poisonTarget, progress), opacity: progress, scale: 1 };
  }
  if (time < milestones.passCursorClickEnd) {
    const raw = (time - milestones.passCursorClickStart) / TIMELINE.challengeCursorClickDuration;
    return { ...poisonTarget, opacity: 1, scale: 1 - (Math.sin(raw * Math.PI) * 0.12) };
  }
  if (time < milestones.firstChallengeCursorStart) return null;
  if (time < milestones.firstChallengeCursorClickStart) {
    const progress = easeInOutCubic((time - milestones.firstChallengeCursorStart) / TIMELINE.captureCursorMoveDuration);
    return { ...interpolatePoint(poisonTarget, challengeTarget, progress), opacity: 1, scale: 1 };
  }
  if (time < milestones.firstChallengeCursorClickEnd) {
    const raw = (time - milestones.firstChallengeCursorClickStart) / TIMELINE.challengeCursorClickDuration;
    return { ...challengeTarget, opacity: 1, scale: 1 - (Math.sin(raw * Math.PI) * 0.12) };
  }
  if (time < milestones.secondChallengeCursorStart) return null;
  if (time < milestones.secondChallengeCursorClickStart) {
    const progress = easeInOutCubic((time - milestones.secondChallengeCursorStart) / TIMELINE.captureCursorMoveDuration);
    const challengeStart = {
      x: challengeTarget.x + (layout.squareSize * 0.62),
      y: challengeTarget.y + (layout.squareSize * 0.58),
    };
    return { ...interpolatePoint(challengeStart, challengeTarget, progress), opacity: progress, scale: 1 };
  }
  if (time < milestones.secondChallengeCursorClickEnd) {
    const raw = (time - milestones.secondChallengeCursorClickStart) / TIMELINE.challengeCursorClickDuration;
    return { ...challengeTarget, opacity: 1, scale: 1 - (Math.sin(raw * Math.PI) * 0.12) };
  }
  if (time < milestones.heartThoughtCursorStart) return null;
  const heartTarget = getPointFromDirection(points.center, { row: -1, col: 0 }, 1);
  const heartBubbleTarget = getHeartThoughtBubbleCursorPoint(heartTarget);
  if (time < milestones.heartThoughtCursorClickStart) {
    const progress = easeInOutCubic((time - milestones.heartThoughtCursorStart) / TIMELINE.cursorApproachDuration);
    const heartStart = {
      x: heartBubbleTarget.x + (layout.squareSize * 1.1),
      y: heartBubbleTarget.y + (layout.squareSize * 0.95),
    };
    return { ...interpolatePoint(heartStart, heartBubbleTarget, progress), opacity: progress, scale: 1 };
  }
  if (time < milestones.heartThoughtCursorClickEnd) {
    const raw = (time - milestones.heartThoughtCursorClickStart) / TIMELINE.cursorClickDuration;
    return { ...heartBubbleTarget, opacity: 1, scale: 1 - (Math.sin(raw * Math.PI) * 0.12) };
  }
  if (time < milestones.heartThoughtCursorExitEnd) {
    const progress = easeInOutCubic((time - milestones.heartThoughtCursorClickEnd) / TIMELINE.cursorExitDuration);
    return {
      ...interpolatePoint(heartBubbleTarget, {
        x: heartBubbleTarget.x + (layout.squareSize * 0.62),
        y: heartBubbleTarget.y + (layout.squareSize * 0.58),
      }, progress),
      opacity: 1 - progress,
      scale: 1,
    };
  }
  return null;
}

function renderCapturesRewindIndicator(time, milestones) {
  const indicator = ensureRewindIndicator();
  if (!indicator) return;
  const firstVisible = time >= milestones.passRewindStart && time < milestones.passRewindEnd;
  const secondVisible = time >= milestones.daggerRewindStart && time < milestones.daggerRewindEnd;
  const thirdVisible = time >= milestones.finalRewindStart && time < milestones.finalRewindEnd;
  if (!firstVisible && !secondVisible && !thirdVisible) {
    indicator.style.opacity = '0';
    return;
  }
  const start = firstVisible
    ? milestones.passRewindStart
    : (secondVisible ? milestones.daggerRewindStart : milestones.finalRewindStart);
  const end = firstVisible
    ? milestones.passRewindEnd
    : (secondVisible ? milestones.daggerRewindEnd : milestones.finalRewindEnd);
  const fadeIn = easeOutCubic((time - start) / 180);
  const fadeOut = 1 - easeInOutCubic((time - (end - 240)) / 240);
  indicator.style.opacity = `${clamp(0, Math.min(fadeIn, fadeOut), 1)}`;
}

function getCapturesDaggerSlotsCenter(points) {
  const challenge = getCapturesChallengeButtonPoint(points);
  const { height } = getCapturesButtonMetrics();
  return {
    x: challenge.x,
    y: challenge.y - (height * 0.9),
  };
}

function getCapturesDaggerSlotPoint(points, index) {
  const center = getCapturesDaggerSlotsCenter(points);
  const spacing = getDaggerSlotSize() + getDaggerSlotGap();
  return {
    x: center.x + ((index - 1) * spacing),
    y: center.y,
  };
}

function renderCapturesDagger(time, milestones, points) {
  const slots = ensureDaggerSlots();
  const token = ensureDaggerToken();
  if (!slots || !token) return;

  const center = getCapturesDaggerSlotsCenter(points);
  slots.style.left = `${center.x}px`;
  slots.style.top = `${center.y}px`;
  token.classList.remove('animation-dagger-token--flash');

  let slotsOpacity = 0;
  let tokenOpacity = 0;
  let tokenPosition = {
    x: layout.width + layout.squareSize,
    y: center.y,
  };

  const firstDagger = getDaggerPhaseState(
    time,
    milestones.firstDaggerSlotsStart,
    milestones.firstDaggerSlideStart,
    milestones.firstDaggerSlideEnd,
    milestones.daggerRewindStart,
    milestones.daggerRewindEnd,
    points
  );
  const finalDagger = getDaggerPhaseState(
    time,
    milestones.finalDaggerSlotsStart,
    milestones.finalDaggerSlideStart,
    milestones.finalDaggerSlideEnd,
    milestones.finalRewindStart,
    milestones.finalRewindEnd,
    points
  );

  if (firstDagger.active) {
    slotsOpacity = firstDagger.slotsOpacity;
    tokenOpacity = firstDagger.tokenOpacity;
    tokenPosition = firstDagger.tokenPosition;
  }
  if (finalDagger.active) {
    slotsOpacity = finalDagger.slotsOpacity;
    tokenOpacity = finalDagger.tokenOpacity;
    tokenPosition = finalDagger.tokenPosition;
  }

  slots.style.opacity = `${clamp(0, slotsOpacity, 1)}`;
  token.style.left = `${tokenPosition.x - (token.offsetWidth / 2 || 22)}px`;
  token.style.top = `${tokenPosition.y - (token.offsetHeight / 2 || 22)}px`;
  token.style.opacity = `${clamp(0, tokenOpacity, 1)}`;
}

function getDaggerPhaseState(time, slotsStart, slideStart, slideEnd, rewindStart, rewindEnd, points) {
  const target = getCapturesDaggerSlotPoint(points, 0);
  const start = {
    x: layout.width + layout.squareSize,
    y: target.y,
  };
  if (time < slotsStart) {
    return {
      active: false,
      slotsOpacity: 0,
      tokenOpacity: 0,
      tokenPosition: start,
    };
  }

  let slotsOpacity = easeOutCubic((time - slotsStart) / 240);
  let tokenOpacity = 0;
  let tokenPosition = { ...start };
  if (time >= slideStart && time < slideEnd) {
    const progress = easeInOutCubic((time - slideStart) / TIMELINE.daggerSlideDuration);
    tokenPosition = interpolatePoint(start, target, progress);
    tokenOpacity = progress;
  } else if (time >= slideEnd) {
    tokenPosition = { ...target };
    tokenOpacity = 1;
  }

  if (rewindEnd > rewindStart && time >= rewindStart) {
    const progress = easeInOutCubic((time - rewindStart) / (rewindEnd - rewindStart));
    slotsOpacity *= 1 - progress;
    tokenOpacity *= 1 - progress;
  }

  return {
    active: true,
    slotsOpacity,
    tokenOpacity,
    tokenPosition,
  };
}

function renderFakeCursor(visible, time, milestones, piecePosition, mode = 'spear', points = null) {
  const cursor = ensureFakeCursor();
  if (!cursor) return;
  if (!visible) {
    cursor.style.opacity = '0';
    return;
  }

  const isChallenge = (mode === 'challenge' || mode === 'secondChallenge') && points;
  const isSecondChallenge = mode === 'secondChallenge';
  const target = isChallenge
    ? getChallengeButtonPoint(points)
    : getSpearBubbleCursorPoint(piecePosition);
  const start = isChallenge
    ? {
        x: target.x + (layout.squareSize * 1.05),
        y: target.y - (layout.squareSize * 1.15),
      }
    : {
        x: target.x + (layout.squareSize * 1.25),
        y: target.y + (layout.squareSize * 0.95),
      };
  let position = { ...target };
  let opacity = 1;
  let scale = 1;

  const approachStart = isSecondChallenge
    ? milestones.secondChallengeCursorStart
    : (isChallenge ? milestones.challengeCursorStart : milestones.cursorStart);
  const clickStart = isSecondChallenge
    ? milestones.secondChallengeCursorClickStart
    : (isChallenge ? milestones.challengeCursorClickStart : milestones.cursorClickStart);
  const clickEnd = isSecondChallenge
    ? milestones.secondChallengeCursorClickEnd
    : (isChallenge ? milestones.challengeCursorClickEnd : milestones.cursorClickEnd);
  const exitEnd = isSecondChallenge
    ? milestones.secondChallengeCursorExitEnd
    : (isChallenge ? milestones.challengeCursorExitEnd : milestones.cursorExitEnd);
  const approachDuration = isChallenge ? TIMELINE.challengeCursorApproachDuration : TIMELINE.cursorApproachDuration;
  const clickDuration = isChallenge ? TIMELINE.challengeCursorClickDuration : TIMELINE.cursorClickDuration;
  const exitDuration = isChallenge ? TIMELINE.challengeCursorExitDuration : TIMELINE.cursorExitDuration;

  if (time < clickStart) {
    const progress = easeInOutCubic((time - approachStart) / approachDuration);
    position = interpolatePoint(start, target, progress);
    opacity = progress;
  } else if (time < clickEnd) {
    const raw = (time - clickStart) / clickDuration;
    scale = 1 - (Math.sin(raw * Math.PI) * 0.12);
  } else {
    const progress = easeInOutCubic((time - clickEnd) / exitDuration);
    position = interpolatePoint(target, {
      x: target.x + (layout.squareSize * 0.62),
      y: target.y + (layout.squareSize * 0.58),
    }, progress);
    opacity = 1 - progress;
  }

  cursor.style.left = `${position.x}px`;
  cursor.style.top = `${position.y}px`;
  cursor.style.opacity = `${clamp(0, opacity, 1)}`;
  cursor.style.setProperty('--cursor-scale', `${scale}`);
}

function renderScytheTargetActor(actor, color, target, offscreen, time, milestones) {
  let position = { ...offscreen };
  let opacity = 0;
  if (time >= milestones.targetStart && time < milestones.targetEnd) {
    const progress = easeInOutCubic((time - milestones.targetStart) / TIMELINE.lineBlockerSlideDuration);
    position = interpolatePoint(offscreen, target, progress);
    opacity = progress;
  } else if (time >= milestones.targetEnd && time < milestones.rowHoldEnd) {
    position = { ...target };
    opacity = 1;
  } else if (time >= milestones.rowHoldEnd && time < milestones.clearEnd) {
    const progress = easeInOutCubic((time - milestones.rowHoldEnd) / TIMELINE.lineClearDuration);
    position = interpolatePoint(target, offscreen, progress);
    opacity = 1 - progress;
  }
  renderPositionedActor(actor, UNKNOWN_IDENTITY, color, position, opacity);
}

function renderScytheRowActor(actor, target, offscreen, time, milestones) {
  let position = { ...offscreen };
  let opacity = 0;
  if (time >= milestones.rowStart && time < milestones.rowEnd) {
    const progress = easeInOutCubic((time - milestones.rowStart) / TIMELINE.lineBlockerSlideDuration);
    position = interpolatePoint(offscreen, target, progress);
    opacity = progress;
  } else if (time >= milestones.rowEnd && time < milestones.rowHoldEnd) {
    position = { ...target };
    opacity = 1;
  } else if (time >= milestones.rowHoldEnd && time < milestones.clearEnd) {
    const progress = easeInOutCubic((time - milestones.rowHoldEnd) / TIMELINE.lineClearDuration);
    position = interpolatePoint(target, offscreen, progress);
    opacity = 1 - progress;
  }
  renderPositionedActor(actor, UNKNOWN_IDENTITY, BLACK, position, opacity);
}

function renderLineBlockerActors(config, time, points) {
  const milestones = config.milestones;
  const whiteActor = ensureActor(`animation${config.key}WhiteBlocker`);
  const blackNearActor = ensureActor(`animation${config.key}BlackNearBlocker`);
  const blackFarActor = ensureActor(`animation${config.key}BlackFarBlocker`);
  const whiteTarget = getPointFromDirection(points.center, config.whiteDirection, 2);
  const blackNearTarget = getPointFromDirection(points.center, config.blackDirection, 2);
  const blackFarTarget = getPointFromDirection(points.center, config.blackDirection, 3);
  const whiteOffscreen = getBlockerOffscreenPoint(whiteTarget, config.whiteDirection);
  const blackNearOffscreen = getBlockerOffscreenPoint(blackNearTarget, config.blackDirection);
  const blackFarOffscreen = getBlockerOffscreenPoint(blackFarTarget, config.blackDirection);

  [
    { actor: whiteActor, color: WHITE, target: whiteTarget, offscreen: whiteOffscreen },
    { actor: blackNearActor, color: BLACK, target: blackNearTarget, offscreen: blackNearOffscreen },
    { actor: blackFarActor, color: BLACK, target: blackFarTarget, offscreen: blackFarOffscreen },
  ].forEach((entry) => {
    renderPieceContent(entry.actor, UNKNOWN_IDENTITY, entry.color);
    entry.actor.style.setProperty('--piece-size', `${layout.pieceSize}px`);

    let position = { ...entry.offscreen };
    let opacity = 0;
    if (time >= milestones.blockerStart && time < milestones.blockerEnd) {
      const progress = easeInOutCubic((time - milestones.blockerStart) / TIMELINE.lineBlockerSlideDuration);
      position = interpolatePoint(entry.offscreen, entry.target, progress);
      opacity = progress;
    } else if (time >= milestones.blockerEnd && time < milestones.blockerHoldEnd) {
      position = { ...entry.target };
      opacity = 1;
    } else if (time >= milestones.blockerHoldEnd && time < milestones.clearEnd) {
      const progress = easeInOutCubic((time - milestones.blockerHoldEnd) / TIMELINE.lineClearDuration);
      position = interpolatePoint(entry.target, entry.offscreen, progress);
      opacity = 1 - progress;
    }

    entry.actor.style.left = `${position.x}px`;
    entry.actor.style.top = `${position.y}px`;
    entry.actor.style.opacity = `${clamp(0, opacity, 1)}`;
    entry.actor.style.transform = 'translate(-50%, -50%) scale(1)';
    entry.actor.style.filter = 'drop-shadow(0 14px 14px rgba(0, 0, 0, 0.42))';
  });
}

function directionsEqual(a, b) {
  return Boolean(a && b && a.row === b.row && a.col === b.col);
}

function getClearFade(milestones, time) {
  if (time < milestones.blockerHoldEnd) return 0;
  return easeInOutCubic((time - milestones.blockerHoldEnd) / TIMELINE.lineClearDuration);
}

function renderLineSequenceAnnotations(svg, time) {
  if (!layout) return;
  const points = getBoardPoints();
  if (!points) return;

  getLineSequenceConfigs().forEach((config) => {
    const milestones = config.milestones;
    if (time < milestones.arrowStart || time >= milestones.clearEnd) return;
    const clearFade = getClearFade(milestones, time);
    const blockerProgress = easeInOutCubic((time - milestones.blockerStart) / TIMELINE.lineBlockerSlideDuration);
    const opacity = 1 - clearFade;

    config.directions.forEach((direction, index) => {
      const elapsed = time - milestones.arrowStart - (index * TIMELINE.lineArrowDirectionStagger);
      let distance = getLineArrowDistance(elapsed);
      if (directionsEqual(direction, config.whiteDirection)) {
        const limitedDistance = 3 - (blockerProgress * 2);
        distance = Math.min(distance, limitedDistance);
      } else if (directionsEqual(direction, config.blackDirection)) {
        const limitedDistance = 3 - blockerProgress;
        distance = Math.min(distance, limitedDistance);
      }
      if (distance <= 0 || opacity <= 0) return;
      appendStraightArrow(
        svg,
        points.center,
        getPointFromDirection(points.center, direction, distance),
        layout.squareSize,
        opacity
      );
    });

    if (time >= milestones.blockerStart && opacity > 0) {
      const circleOpacity = Math.min(opacity, easeOutCubic((time - milestones.blockerStart) / TIMELINE.lineBlockerSlideDuration));
      appendCircle(svg, getPointFromDirection(points.center, config.blackDirection, 2), layout.squareSize, circleOpacity);
    }
  });
}

function tick(now) {
  if (!isPlaying) {
    animationFrameId = null;
    return;
  }
  const delta = Math.max(0, now - lastFrameAt);
  lastFrameAt = now;
  virtualTime = Math.min(getSequenceEndTime(), virtualTime + (delta * animationSpeed));
  syncActiveChapterToTime(virtualTime);
  if (virtualTime !== lastRenderedTime) {
    renderAnimationFrame(virtualTime);
    lastRenderedTime = virtualTime;
  }

  if (virtualTime < getSequenceEndTime()) {
    animationFrameId = requestAnimationFrame(tick);
  } else {
    animationFrameId = null;
  }
}

function startAnimation() {
  if (!isPlaying || animationFrameId !== null || virtualTime >= getSequenceEndTime()) return;
  lastFrameAt = performance.now();
  animationFrameId = requestAnimationFrame(tick);
}

function render() {
  layout = measureLayout();
  drawBoard();
  positionPieces();
  renderAnimationFrame(virtualTime);
}

window.addEventListener('resize', render, { passive: true });
window.addEventListener('orientationchange', render, { passive: true });
virtualTime = getChapterStartTime(activeChapterKey);
render();
startAnimation();
