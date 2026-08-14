const fs = require('node:fs');
const path = require('node:path');
const { Open } = require('unzipper');
const { downloadZip, safeUrlForLog } = require('./bootstrap-network.cjs');

const root = path.resolve(__dirname, '..');
const binDir = path.join(root, 'modules', 'bin');
const cacheDir = path.join(root, 'modules', '.cache');
const isWin = process.platform === 'win32';
const binary = isWin ? 'xray.exe' : 'xray';
const zipName = isWin ? 'Xray-windows-64.zip' : 'Xray-linux-64.zip';
const dest = path.join(binDir, binary);
const repo = 'XTLS/Xray-core';
const userAgent = 'NEXUS-Xray-Bootstrap';

function ok() {
  return fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000;
}

async function download(url, file) {
  await downloadZip(url, file, {
    repo,
    userAgent,
    minimumBytes: 800_000,
  });
}

async function main() {
  if (ok()) {
    console.log(`Xray уже на месте: ${path.relative(root, dest)}`);
    return;
  }
  console.log('Ставим Xray-core (как ядро внутри Happ)…');
  const zipPath = path.join(cacheDir, zipName);
  const urls = [
    `https://github.com/${repo}/releases/latest/download/${zipName}`,
    `https://ghproxy.net/https://github.com/${repo}/releases/latest/download/${zipName}`,
  ];
  let last = 'не удалось скачать';
  for (const url of urls) {
    try {
      console.log(`  качаем ${safeUrlForLog(url)}`);
      await download(url, zipPath);
      const extractDir = path.join(cacheDir, 'xray-extract');
      fs.rmSync(extractDir, { recursive: true, force: true });
      await (await Open.file(zipPath)).extract({ path: extractDir });
      const found = walk(extractDir, binary);
      if (!found) throw new Error(`${binary} нет в архиве`);
      fs.mkdirSync(binDir, { recursive: true });
      fs.copyFileSync(found, dest);
      if (!isWin) fs.chmodSync(dest, 0o755);
      if (!ok()) throw new Error('скопированный бинарник пустой');
      console.log(`Xray установлен: ${path.relative(root, dest)}`);
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      console.warn(`  не вышло: ${last}`);
    }
  }
  console.warn(`Xray не установлен (${last}). VPN заработает после удачной загрузки GitHub.`);
}

function walk(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full;
    if (entry.isDirectory()) {
      const nested = walk(full, name);
      if (nested) return nested;
    }
  }
  return null;
}

main().catch((error) => {
  console.warn(error.message);
});
