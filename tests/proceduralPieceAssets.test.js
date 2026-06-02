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

  test('fox theme remaps piece art, labels, and token treatment', () => {
    const {
      FOX_PIECE_IMAGES,
      IDENTITIES,
      VISUAL_THEMES,
      getIdentityLabelsForVisualTheme,
      getTerminologyForVisualTheme,
      getVisualThemeConfig
    } = constants;
    const { getPieceAssetSources } = pieceAssets;

    expect(FOX_PIECE_IMAGES[IDENTITIES.UNKNOWN][0]).toMatchObject({
      kind: 'proceduralSingle',
      src: '/assets/images/Pieces/Procedural/WhiteUnknownFox.svg',
      tintColor: '#d3340b'
    });
    expect(FOX_PIECE_IMAGES[IDENTITIES.KING][0]).toMatchObject({
      kind: 'procedural',
      cloak: '/assets/images/Pieces/Procedural/WhitePiece.svg',
      cloakColor: '#d3340b',
      identity: '/assets/images/Pieces/Procedural/FoxIdentity.svg',
      identityColor: '#000000'
    });
    expect(FOX_PIECE_IMAGES[IDENTITIES.ROOK][1]).toMatchObject({
      cloak: '/assets/images/Pieces/Procedural/WhitePiece.svg',
      cloakColor: '#7968d9',
      identity: '/assets/images/Pieces/Procedural/BearIdentity.svg',
      identityColor: '#000000'
    });
    expect(FOX_PIECE_IMAGES[IDENTITIES.BISHOP][0].identity).toBe('/assets/images/Pieces/Procedural/HawkIdentity.svg');
    expect(FOX_PIECE_IMAGES[IDENTITIES.KNIGHT][0].identity).toBe('/assets/images/Pieces/Procedural/ViperIdentity.svg');
    expect(FOX_PIECE_IMAGES[IDENTITIES.BOMB][0].identity).toBe('/assets/images/Pieces/Procedural/MushroomIdentity.svg');
    expect(getPieceAssetSources(FOX_PIECE_IMAGES[IDENTITIES.UNKNOWN][0])).toEqual([
      '/assets/images/Pieces/Procedural/WhiteUnknownFox.svg'
    ]);

    expect(getIdentityLabelsForVisualTheme(VISUAL_THEMES.FOX)).toMatchObject({
      [IDENTITIES.KING]: 'Fox',
      [IDENTITIES.ROOK]: 'Bear',
      [IDENTITIES.BISHOP]: 'Hawk',
      [IDENTITIES.KNIGHT]: 'Viper',
      [IDENTITIES.BOMB]: 'Poison Mushroom'
    });
    expect(getVisualThemeConfig(VISUAL_THEMES.FOX)).toMatchObject({
      daggerTokenLabel: 'X',
      terminology: {
        challengeAction: 'Investigate',
        daggerTokenName: 'strike',
        daggerTokenPlural: 'strikes'
      },
      boardPalette: {
        backRankBorders: true,
        lightSquare: '#6FAE68',
        darkSquare: '#2D5A4F',
        boardBackColor: '#5A4632',
        squareRadius: 10
      }
    });
    expect(getTerminologyForVisualTheme(VISUAL_THEMES.FOX)).toMatchObject({
      challengeSuccess: 'Investigation Successful!',
      challengeFailed: 'Investigation Failed',
      daggerTokenAlt: 'Strike'
    });
  });

  test('visual theme defaults to regular mode', () => {
    const {
      PIECE_IMAGES,
      VISUAL_THEMES,
      getIdentityLabelsForVisualTheme,
      getTerminologyForVisualTheme,
      getVisualThemeConfig,
      normalizeVisualTheme
    } = constants;

    expect(normalizeVisualTheme()).toBe(VISUAL_THEMES.DEFAULT);
    expect(normalizeVisualTheme('')).toBe(VISUAL_THEMES.DEFAULT);
    expect(normalizeVisualTheme('default')).toBe(VISUAL_THEMES.DEFAULT);
    expect(normalizeVisualTheme('fox')).toBe(VISUAL_THEMES.FOX);
    expect(getVisualThemeConfig()).toMatchObject({
      theme: VISUAL_THEMES.DEFAULT,
      pieceImages: PIECE_IMAGES,
      boardPalette: null,
      playerColors: null,
      playerTextColors: null
    });
    expect(getIdentityLabelsForVisualTheme()[constants.IDENTITIES.KING]).toBe('Heart');
    expect(getTerminologyForVisualTheme().challengeAction).toBe('Challenge');
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
    expect(boardSource).toContain('drawColorizedImage');
    expect(boardSource).toContain('drawBoardBackground');
    expect(boardSource).toContain('palette.boardBackColor');
    expect(boardSource).not.toContain('ctx.globalCompositeOperation = \'destination-in\'');
    expect(glyphSource).not.toContain('ctx.globalCompositeOperation = \'source-in\'');
    expect(glyphSource).not.toContain('ctx.globalCompositeOperation = \'destination-in\'');
    expect(boardSource).toContain('drawBackRankBorder');
    expect(boardSource).toContain('backRankPlayerColor');
  });
});
