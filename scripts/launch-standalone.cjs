const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const electronCli = path.resolve(__dirname, '..', 'node_modules', 'electron', 'cli.js');
if (!fs.existsSync(electronCli)) {
  console.error('Electron не найден. Выполните: npm install --include=dev');
  process.exit(1);
}

const child = spawn(process.execPath, [electronCli, '.'], {
  env: { ...process.env, NEXUS_RENDERER_MODE: 'dist' },
  stdio: 'inherit',
  windowsHide: false,
});

child.on('error', (error) => {
  console.error(`Не удалось запустить Electron: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 0;
});
