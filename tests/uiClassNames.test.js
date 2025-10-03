const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const LEGACY_CLASS_TOKENS = [
  'spectate-banner',
  'banner-overlay',
  'history-status-icon',
  'history-status-win',
  'history-status-loss',
  'history-status-draw',
];

function collectFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(fullPath);
    }
    return [fullPath];
  });
}

describe('UI class name normalization', () => {
  it('does not allow legacy class names outside of transitional aliases', () => {
    const files = collectFiles(PUBLIC_DIR).filter((filePath) => {
      return path.basename(filePath) !== 'ui.css';
    });

    const offenders = [];

    files.forEach((filePath) => {
      const contents = fs.readFileSync(filePath, 'utf8');
      LEGACY_CLASS_TOKENS.forEach((token) => {
        if (contents.includes(token)) {
          offenders.push({ filePath: path.relative(ROOT, filePath), token });
        }
      });
    });

    const message = offenders
      .map((offender) => `${offender.token} found in ${offender.filePath}`)
      .join('\n');

    expect(message).toBe('');
  });
});
