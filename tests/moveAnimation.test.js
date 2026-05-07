const path = require('path');
const { pathToFileURL } = require('url');

async function loadMoveAnimationModule() {
  return import(
    pathToFileURL(path.resolve(__dirname, '../public/js/modules/animations/moveAnimation.js')).href
  );
}

describe('moveAnimation helpers', () => {
  test('normalizes animation speed values with slow as the default', async () => {
    const { normalizeAnimationSpeed } = await loadMoveAnimationModule();

    expect(normalizeAnimationSpeed(undefined)).toBe('slow');
    expect(normalizeAnimationSpeed('FAST')).toBe('fast');
    expect(normalizeAnimationSpeed('off')).toBe('off');
    expect(normalizeAnimationSpeed('medium')).toBe('slow');
  });

  test('routes scythe declarations as a two-square then one-square L', async () => {
    const { buildMoveRoute } = await loadMoveAnimationModule();

    expect(buildMoveRoute({
      fromUI: { uiR: 5, uiC: 2 },
      toUI: { uiR: 3, uiC: 3 },
      declaration: 5,
    })).toEqual([
      { uiR: 5, uiC: 2 },
      { uiR: 3, uiC: 2 },
      { uiR: 3, uiC: 3 },
    ]);

    expect(buildMoveRoute({
      fromUI: { uiR: 4, uiC: 1 },
      toUI: { uiR: 3, uiC: 3 },
      declaration: 5,
    })).toEqual([
      { uiR: 4, uiC: 1 },
      { uiR: 4, uiC: 3 },
      { uiR: 3, uiC: 3 },
    ]);
  });

  test('derives an opponent pending capture plan but skips active player moves', async () => {
    const { deriveOpponentMoveAnimationPlan } = await loadMoveAnimationModule();
    const board = [
      [null, null, null, null, null],
      [null, null, null, null, null],
      [null, null, null, null, null],
      [null, null, null, { color: 0, identity: 4 }, null],
      [null, null, null, null, null],
      [null, null, { color: 1, identity: 0 }, null, null],
    ];
    const game = {
      animationSpeed: 'slow',
      actions: [{
        type: 1,
        player: 1,
        details: {
          from: { row: 5, col: 2 },
          to: { row: 3, col: 3 },
          declaration: 5,
        },
      }],
      moves: [{
        player: 1,
        from: { row: 5, col: 2 },
        to: { row: 3, col: 3 },
        declaration: 5,
        state: 0,
      }],
    };

    const plan = deriveOpponentMoveAnimationPlan({
      game,
      currentBoard: board,
      viewerColor: 0,
      rows: 6,
      cols: 5,
      currentIsWhite: true,
    });

    expect(plan).toMatchObject({
      speed: 'slow',
      moveKey: '1:5:2:3:3:5',
      movingPiece: { color: 1, identity: 0 },
      targetPiece: { color: 0, identity: 4 },
      fromUI: { uiR: 0, uiC: 2 },
      toUI: { uiR: 2, uiC: 3 },
    });
    expect(plan.route).toEqual([
      { uiR: 0, uiC: 2 },
      { uiR: 2, uiC: 2 },
      { uiR: 2, uiC: 3 },
    ]);
    expect(plan.startBoard[5][2]).toBeNull();
    expect(plan.arrivedBoard[3][3]).toEqual({ color: 1, identity: 0 });

    expect(deriveOpponentMoveAnimationPlan({
      game,
      currentBoard: board,
      viewerColor: 1,
      rows: 6,
      cols: 5,
      currentIsWhite: false,
    })).toBeNull();
  });
});
