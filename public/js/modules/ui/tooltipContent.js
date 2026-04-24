export const TOOLTIP_TEXT = Object.freeze({
  daggerToken: 'This is a "strike" for bluffing a piece or challenging a bomb that was a real bomb. If you get 3 you lose!',
  bombButton: 'Declare that your piece is a bomb. If they believe you, you keep your piece and they lose their attacker. If they challenge, lose your bomb and get a dagger token. 3 dagger tokens and you lose!',
  challengeButton: 'Call your opponent\'s bluff. If you\'re right, they lose that piece (and get a dagger token if it was a bomb). If you\'re wrong, get a dagger token. 3 dagger tokens and you lose!',
  challengeBubble: 'The Challenge action. If the last move was a bluff, that piece is removed. If it was NOT a bluff, then gain a dagger token (3 dagger tokens and you lose).',
  passButton: 'You believe that piece really is a bomb. You lose your attacking piece, and your opponent takes their turn.',
  resignButton: 'Resign and immediately lose the game.',
  drawButton: 'Offer a draw to your opponent (only available once every 30 seconds).',
  setupStash: 'Choose 5 pieces to place on your starting row, one of which must be your king (♔). Then choose 1 to put "on deck" (the purple tile).',
  onDeckStash: 'Place on piece "on-deck" (the purple tile). This piece will replace one of your pieces if your opponent\'s challenge fails.',
  capturedPieces: 'These are the captured pieces of the player. Use this to determine what they have left. Players start with: 1 king, 1 bomb, 2 knights, 2 bishops, 2 rooks.',
});

function articleFor(noun) {
  if (typeof noun !== 'string' || !noun.trim()) {
    return 'a';
  }
  return /^[aeiou]/i.test(noun.trim()) ? 'an' : 'a';
}

function declarationLabelFromBubbleType(type) {
  if (typeof type !== 'string' || !type.includes('Thought')) {
    return null;
  }
  if (type.includes('king')) return 'king';
  if (type.includes('bishop')) return 'bishop';
  if (type.includes('rook')) return 'rook';
  if (type.includes('knight')) return 'knight';
  return null;
}

export function getThoughtBubbleTooltipText(type) {
  const declarationLabel = declarationLabelFromBubbleType(type);
  if (!declarationLabel) {
    return '';
  }
  return `Declare this piece as ${articleFor(declarationLabel)} ${declarationLabel}.`;
}
