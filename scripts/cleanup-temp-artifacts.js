const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const tempRoot = os.tmpdir();

const repoTargets = [
  path.join(repoRoot, 'output', 'playwright'),
  path.join(repoRoot, '.playwright-cli'),
];

const tempTargets = [
  path.join(tempRoot, 'cg-3100.out.log'),
  path.join(tempRoot, 'cg-3100.err.log'),
  path.join(tempRoot, 'cloaks-gambit-server.out.log'),
  path.join(tempRoot, 'cloaks-gambit-server.err.log'),
];

const SKIPPABLE_REMOVE_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);

function removeTarget(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (err) {
    if (SKIPPABLE_REMOVE_CODES.has(err?.code)) {
      console.warn(`[clean:temp] Skipping busy artifact "${targetPath}" (${err.code})`);
      return;
    }
    throw err;
  }
}

repoTargets.forEach(removeTarget);
tempTargets.forEach(removeTarget);
