const {
  BaseBotController,
  GAME_CONSTANTS,
  MOVE_DECLARATIONS,
} = require('../shared/bots/baseBot');

function createBot() {
  const bot = new BaseBotController('http://localhost', 'game', 'player', null, null);
  bot.color = 0;
  bot.board = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => null));
  bot.board[0][0] = { color: 0, identity: GAME_CONSTANTS.identities.ROOK };
  return bot;
}

describe('BaseBot move declarations', () => {
  test('MOVE_DECLARATIONS never includes bomb', () => {
    expect(MOVE_DECLARATIONS).not.toContain(GAME_CONSTANTS.identities.BOMB);
  });

  test('getLegalDeclarationsForMove excludes bomb for rook-like moves', () => {
    const bot = createBot();
    const move = {
      from: { row: 0, col: 0 },
      to: { row: 0, col: 3 },
    };

    const legal = bot.getLegalDeclarationsForMove(move);
    expect(legal).toContain(GAME_CONSTANTS.identities.ROOK);
    expect(legal).not.toContain(GAME_CONSTANTS.identities.BOMB);
  });

  test('chooseDeclaration never returns bomb even when bluffing', () => {
    const bot = createBot();
    const move = {
      from: { row: 0, col: 0 },
      to: { row: 0, col: 3 },
      declaration: GAME_CONSTANTS.identities.ROOK,
    };

    const declaration = bot.chooseDeclaration(move, true);
    expect(declaration).toBe(GAME_CONSTANTS.identities.ROOK);
  });
});
