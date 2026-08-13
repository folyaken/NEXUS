const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'NEXUS.zip');
execFileSync('git', ['archive', '--format=zip', 'HEAD', '-o', out], { cwd: root, stdio: 'inherit' });
console.log(`Flat archive written: ${out}`);
console.log('Extract next to an empty folder — files are at the zip root (no wrapper directory).');
