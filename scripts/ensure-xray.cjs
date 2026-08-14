const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { pipeline } = require('node:stream/promises');
const { Open } = require('unzipper');

const root = path.resolve(__dirname, '..');
const binDir = path.join(root, 'modules', 'bin');
const cacheDir = path.join(root, 'modules', '.cache');
const isWin = process.platform === 'win32';
const binary = isWin ? 'xray.exe' : 'xray';
const zipName = isWin ? 'Xray-windows-64.zip' : 'Xray-linux-64.zip';
const dest = path.join(binDir, binary);

function ok() {
  return fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000;
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'NEXUS-Xray-Bootstrap' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        get(res.headers.location).then(resolve, reject);
        return;
      }
      if (!res.statusCode || res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} ${url}`));
        res.resume();
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function download(url, file) {
  const res = await get(url);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await pipeline(res, fs.createWriteStream(file));
  const stat = fs.statSync(file);
  if (stat.size < 800_000) throw new Error(`слишком маленький файл (${stat.size} байт)`);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(2);
  fs.readSync(fd, buf, 0, 2, 0);
  fs.closeSync(fd);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('это не ZIP');
}

async function main() {
  if (ok()) {
    console.log(`Xray уже на месте: ${path.relative(root, dest)}`);
    return;
  }
  console.log('Ставим Xray-core (как ядро внутри Happ)…');
  const zipPath = path.join(cacheDir, zipName);
  const urls = [
    `https://github.com/XTLS/Xray-core/releases/latest/download/${zipName}`,
    `https://ghproxy.net/https://github.com/XTLS/Xray-core/releases/latest/download/${zipName}`,
  ];
  let last = 'не удалось скачать';
  for (const url of urls) {
    try {
      console.log(`  качаем ${url}`);
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
