const { MediumBotController } = require('../shared/bots/mediumBot');
const { GAME_CONSTANTS } = require('../shared/bots/baseBot');

describe('MediumBotController turn actions', () => {
  test('standard turns never use pass as a move option', async () => {
    const bot = new MediumBotController('http://localhost', 'game-1', 'player-1', null, null);
    bot.color = 0;
    bot.playerTurn = 0;
    bot.pendingAction = false;

    const move = {
      from: { row: 0, col: 0 },
      to: { row: 0, col: 1 },
      declaration: GAME_CONSTANTS.identities.ROOK,
    };

    bot.collectLegalActions = jest.fn(() => ({
      pendingMove: null,
      moves: [move],
      canPass: true,
    }));
    bot.buildMoveActionOptions = jest.fn(() => ([
      {
        type: 'move',
        move,
        declaration: GAME_CONSTANTS.identities.ROOK,
        key: '0,0->0,1:4',
        score: 1,
      },
    ]));
    bot.selectWeightedAction = jest.fn((options) => options.find((option) => option.type === 'pass') || options[0]);
    bot.submitMoveAction = jest.fn().mockResolvedValue('success');
    bot.issuePass = jest.fn().mockResolvedValue(true);

    await bot.executeMoveDecision();

    expect(bot.issuePass).not.toHaveBeenCalled();
    expect(bot.submitMoveAction).toHaveBeenCalledWith(move, GAME_CONSTANTS.identities.ROOK);
  });
});
