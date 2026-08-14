const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { pipeline } = require('node:stream/promises');
const extract = require('extract-zip');

const root = path.resolve(__dirname, '..');
const binDir = path.join(root, 'modules', 'bin');
const cacheDir = path.join(root, 'modules', '.cache');
const isWin = process.platform === 'win32';
const binary = isWin ? 'sing-box.exe' : 'sing-box';
const dest = path.join(binDir, binary);

function ok() {
  return fs.existsSync(dest) && fs.statSync(dest).size > 4_000_000;
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'NEXUS-sing-box-Bootstrap' } }, (res) => {
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

function getJson(url) {
  return get(url).then((res) => new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { reject(error); }
    });
    res.on('error', reject);
  }));
}

async function download(url, file) {
  const res = await get(url);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await pipeline(res, fs.createWriteStream(file));
  const stat = fs.statSync(file);
  if (stat.size < 1_000_000) throw new Error(`слишком маленький файл (${stat.size} байт)`);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(2);
  fs.readSync(fd, buf, 0, 2, 0);
  fs.closeSync(fd);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('это не ZIP');
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

async function main() {
  if (ok()) {
    console.log(`sing-box уже на месте: ${path.relative(root, dest)}`);
    return;
  }
  console.log('Ставим sing-box (Hysteria2, как в Happ)…');
  const release = await getJson('https://api.github.com/repos/SagerNet/sing-box/releases/latest');
  const asset = (release.assets || []).find((item) => isWin
    ? /windows-amd64\.zip$/i.test(item.name)
    : /linux-amd64\.tar\.gz$/i.test(item.name));
  if (!asset || !isWin) {
    if (!isWin) console.warn('Автоустановка sing-box сейчас только для Windows.');
    else console.warn('В релизе sing-box нет windows-amd64.zip');
    return;
  }
  const zipPath = path.join(cacheDir, asset.name);
  const urls = [asset.browser_download_url, `https://ghproxy.net/${asset.browser_download_url}`];
  let last = 'не удалось скачать';
  for (const url of urls) {
    try {
      console.log(`  качаем ${url}`);
      await download(url, zipPath);
      const extractDir = path.join(cacheDir, 'singbox-extract');
      fs.rmSync(extractDir, { recursive: true, force: true });
      await extract(zipPath, { dir: extractDir });
      const found = walk(extractDir, binary);
      if (!found) throw new Error(`${binary} нет в архиве`);
      fs.mkdirSync(binDir, { recursive: true });
      fs.copyFileSync(found, dest);
      if (!ok()) throw new Error('скопированный бинарник пустой');
      console.log(`sing-box установлен: ${path.relative(root, dest)}`);
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      console.warn(`  не вышло: ${last}`);
    }
  }
  console.warn(`sing-box не установлен (${last}). Hysteria заработает после удачной загрузки GitHub.`);
}

main().catch((error) => {
  console.warn(error.message);
});
