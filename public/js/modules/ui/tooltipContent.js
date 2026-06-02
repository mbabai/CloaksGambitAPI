import {
  IDENTITIES,
  VISUAL_THEMES,
  getIdentityLabelsForVisualTheme,
  normalizeVisualTheme
} from '../constants.js';

export const TOOLTIP_TEXT = Object.freeze({
  daggerToken: 'This is a "strike" for bluffing a piece or challenging a Poison that was a real Poison. If you get 3 you lose!',
  bombButton: 'Declare that your piece is Poison. If they believe you, you keep your piece and they lose their attacker. If they challenge, lose your Poison and get a dagger token. 3 dagger tokens and you lose!',
  bombButtonHeartBlocked: 'You cannot declare bomb against a heart declaration.',
  challengeButton: 'Call your opponent\'s bluff. If you\'re right, they lose that piece (and get a dagger token if it was Poison). If you\'re wrong, get a dagger token. 3 dagger tokens and you lose!',
  challengeBubble: 'The Challenge action. If the last move was a bluff, that piece is removed. If it was NOT a bluff, then gain a dagger token (3 dagger tokens and you lose).',
  passButton: 'You believe that piece really is Poison. You lose your attacking piece, and your opponent takes their turn.',
  resignButton: 'Resign and immediately lose the game.',
  drawButton: 'Offer a draw to your opponent (only available once every 30 seconds).',
  setupStash: 'Choose 5 pieces to place on your starting row, one of which must be your Heart. Then choose 1 to put "on deck" (the purple tile).',
  onDeckStash: 'Place on piece "on-deck" (the purple tile). This piece will replace one of your pieces if your opponent\'s challenge fails.',
  capturedPieces: 'These are the captured pieces of the player. Use this to determine what they have left. Players start with: 1 Heart, 1 Poison, 2 Scythes, 2 Spears, 2 Swords.',
});

export const FOX_TOOLTIP_TEXT = Object.freeze({
  daggerToken: 'This is a "strike" for bluffing a piece or investigating a Poison Mushroom that was a real Poison Mushroom. If you get 3 you lose!',
  bombButton: 'Declare that your piece is Poison. If they believe you, you keep your piece and they lose their attacker. If they investigate, lose your Poison Mushroom and get a strike. 3 strikes and you lose!',
  bombButtonHeartBlocked: 'You cannot declare poison against a fox declaration.',
  challengeButton: 'Investigate your opponent\'s bluff. If you\'re right, they lose that piece (and get a strike if it was a Poison Mushroom). If you\'re wrong, get a strike. 3 strikes and you lose!',
  challengeBubble: 'The Investigate action. If the last move was a bluff, that piece is removed. If it was NOT a bluff, then gain a strike (3 strikes and you lose).',
  passButton: 'You believe that piece really is a Poison Mushroom. You lose your attacking piece, and your opponent takes their turn.',
  resignButton: TOOLTIP_TEXT.resignButton,
  drawButton: TOOLTIP_TEXT.drawButton,
  setupStash: 'Choose 5 pieces to place on your starting row, one of which must be your Fox. Then choose 1 to put "on deck" (the purple tile).',
  onDeckStash: 'Place one piece "on-deck" (the purple tile). This piece will replace one of your pieces if your opponent\'s investigation fails.',
  capturedPieces: 'These are the captured pieces of the player. Use this to determine what they have left. Players start with: 1 Fox, 1 Poison Mushroom, 2 Vipers, 2 Hawks, 2 Bears.',
});

const TOOLTIP_TEXT_BY_VISUAL_THEME = Object.freeze({
  [VISUAL_THEMES.DEFAULT]: TOOLTIP_TEXT,
  [VISUAL_THEMES.FOX]: FOX_TOOLTIP_TEXT
});

export function getTooltipText(key, visualTheme = VISUAL_THEMES.DEFAULT) {
  const theme = normalizeVisualTheme(visualTheme);
  const textSet = TOOLTIP_TEXT_BY_VISUAL_THEME[theme] || TOOLTIP_TEXT;
  return textSet[key] || TOOLTIP_TEXT[key] || '';
}

function articleFor(noun) {
  if (typeof noun !== 'string' || !noun.trim()) {
    return 'a';
  }
  return /^[aeiou]/i.test(noun.trim()) ? 'an' : 'a';
}

function declarationIdentityFromBubbleType(type) {
  if (typeof type !== 'string' || !type.includes('Thought')) {
    return null;
  }
  if (type.includes('king')) return IDENTITIES.KING;
  if (type.includes('bishop')) return IDENTITIES.BISHOP;
  if (type.includes('rook')) return IDENTITIES.ROOK;
  if (type.includes('knight')) return IDENTITIES.KNIGHT;
  return null;
}

export function getThoughtBubbleTooltipText(type, visualTheme = VISUAL_THEMES.DEFAULT) {
  const declarationIdentity = declarationIdentityFromBubbleType(type);
  const declarationLabel = declarationIdentity
    ? getIdentityLabelsForVisualTheme(visualTheme)?.[declarationIdentity]
    : null;
  if (!declarationLabel) {
    return '';
  }
  return `Declare this piece as ${articleFor(declarationLabel)} ${declarationLabel}.`;
}
