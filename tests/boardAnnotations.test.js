const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '..',
  'public',
  'js',
  'modules',
  'components',
  'boardAnnotations.js',
)).href;

function evaluate(functionName, args) {
  const script = `
    import(${JSON.stringify(moduleUrl)}).then((mod) => {
      const result = mod[${JSON.stringify(functionName)}](...${JSON.stringify(args)});
      console.log(JSON.stringify(result));
    }).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8' }
  );
  return JSON.parse(output);
}

describe('board annotation snapping', () => {
  test('keeps exact rook, bishop, and knight targets unchanged', () => {
    expect(evaluate('getSnappedAnnotationSquare', [{ row: 2, col: 2 }, { row: 2, col: 4 }, 6, 5]))
      .toEqual({ row: 2, col: 4 });
    expect(evaluate('getSnappedAnnotationSquare', [{ row: 2, col: 2 }, { row: 4, col: 4 }, 6, 5]))
      .toEqual({ row: 4, col: 4 });
    expect(evaluate('getSnappedAnnotationSquare', [{ row: 2, col: 2 }, { row: 4, col: 3 }, 6, 5]))
      .toEqual({ row: 4, col: 3 });
  });

  test('snaps invalid hovered squares to the nearest legal target', () => {
    expect(evaluate('getSnappedAnnotationSquare', [{ row: 0, col: 0 }, { row: 2, col: 3 }, 6, 5]))
      .toEqual({ row: 2, col: 2 });
    expect(evaluate('getSnappedAnnotationSquare', [{ row: 4, col: 4 }, { row: 3, col: 2 }, 6, 5]))
      .toEqual({ row: 3, col: 2 });
  });

  test('uses the long leg first for knight arrows', () => {
    expect(evaluate('getKnightCorner', [{ row: 1, col: 1 }, { row: 3, col: 2 }]))
      .toEqual({ row: 3, col: 1 });
    expect(evaluate('getKnightCorner', [{ row: 1, col: 1 }, { row: 2, col: 3 }]))
      .toEqual({ row: 1, col: 3 });
  });
});
