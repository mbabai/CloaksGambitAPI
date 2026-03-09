const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const tempRoot = os.tmpdir();

const repoTargets = [
  path.join(repoRoot, 'output'),
  path.join(repoRoot, '.playwright-cli'),
];

const tempTargets = [
  path.join(tempRoot, 'cg-3100.out.log'),
  path.join(tempRoot, 'cg-3100.err.log'),
  path.join(tempRoot, 'cloaks-gambit-server.out.log'),
  path.join(tempRoot, 'cloaks-gambit-server.err.log'),
];

function removeTarget(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
}

repoTargets.forEach(removeTarget);
tempTargets.forEach(removeTarget);
