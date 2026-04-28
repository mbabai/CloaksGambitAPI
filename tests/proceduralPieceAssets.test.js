const path = require('path');
const { pathToFileURL } = require('url');

const constantsUrl = pathToFileURL(
  path.resolve(__dirname, '..', 'public', 'js', 'modules', 'constants.js')
).href;
const pieceAssetsUrl = pathToFileURL(
  path.resolve(__dirname, '..', 'public', 'js', 'modules', 'render', 'pieceAssets.js')
).href;
const PIECE_GLYPH_PATH = path.resolve(
  __dirname,
  '..',
  'public',
  'js',
  'modules',
  'render',
  'pieceGlyph.js'
);
const BOARD_RENDER_PATH = path.resolve(
  __dirname,
  '..',
  'public',
  'js',
  'modules',
  'render',
  'board.js'
);

describe('procedural piece assets', () => {
  let constants;
  let pieceAssets;

  beforeAll(async () => {
    [constants, pieceAssets] = await Promise.all([
      import(constantsUrl),
      import(pieceAssetsUrl)
    ]);
  });

  test('unknown identities still use dedicated unknown SVGs', () => {
    const { PIECE_IMAGES, IDENTITIES } = constants;

    expect(PIECE_IMAGES[IDENTITIES.UNKNOWN][0]).toBe('/assets/images/Pieces/Procedural/WhiteUnknown.svg');
    expect(PIECE_IMAGES[IDENTITIES.UNKNOWN][1]).toBe('/assets/images/Pieces/Procedural/BlackUnknown.svg');
  });

  test('known identities layer cloak and identity assets with opposite identity colors', () => {
    const { PIECE_IMAGES, IDENTITIES } = constants;
    const expectedIdentities = {
      [IDENTITIES.KING]: 'HeartIdentity.svg',
      [IDENTITIES.ROOK]: 'SwordIdentity.svg',
      [IDENTITIES.BISHOP]: 'SpearIdentity.svg',
      [IDENTITIES.KNIGHT]: 'ScytheIdentity.svg',
      [IDENTITIES.BOMB]: 'PoisonIdentity.svg'
    };

    Object.entries(expectedIdentities).forEach(([identity, identityFile]) => {
      expect(PIECE_IMAGES[identity][0]).toMatchObject({
        kind: 'procedural',
        cloak: '/assets/images/Pieces/Procedural/WhiteCloak.svg',
        identity: `/assets/images/Pieces/Procedural/${identityFile}`,
        identityColor: '#292929ff'
      });
      expect(PIECE_IMAGES[identity][1]).toMatchObject({
        kind: 'procedural',
        cloak: '/assets/images/Pieces/Procedural/BlackCloak.svg',
        identity: `/assets/images/Pieces/Procedural/${identityFile}`,
        identityColor: '#d9d9d9ff'
      });
    });
  });

  test('preload source extraction returns only image URLs for procedural entries', () => {
    const { PIECE_IMAGES, IDENTITIES } = constants;
    const { getPieceAssetSources } = pieceAssets;

    expect(getPieceAssetSources(PIECE_IMAGES[IDENTITIES.ROOK][1])).toEqual([
      '/assets/images/Pieces/Procedural/BlackCloak.svg',
      '/assets/images/Pieces/Procedural/SwordIdentity.svg'
    ]);
  });

  test('identity render box preserves the taller identity aspect ratio', () => {
    const { getIdentityRenderBox, PROCEDURAL_IDENTITY_ASPECT } = pieceAssets;

    expect(PROCEDURAL_IDENTITY_ASPECT).toEqual({ width: 210, height: 250 });
    expect(getIdentityRenderBox(100, 0.5)).toEqual({ width: 42, height: 50 });
  });

  test('procedural identities render through sharp image paths', () => {
    const fs = require('fs');
    const glyphSource = fs.readFileSync(PIECE_GLYPH_PATH, 'utf8');
    const boardSource = fs.readFileSync(BOARD_RENDER_PATH, 'utf8');

    expect(glyphSource).toContain('document.createElement(\'img\')');
    expect(glyphSource).not.toContain('maskImage');
    expect(boardSource).toContain('width * scaleX');
    expect(boardSource).toContain('height * scaleY');
  });
});
