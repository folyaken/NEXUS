const fs = require('node:fs');
const path = require('node:path');
const { Open } = require('unzipper');
const {
  downloadZip,
  getJson,
  safeUrlForLog,
  validateUrl,
} = require('./bootstrap-network.cjs');

const root = path.resolve(__dirname, '..');
const binDir = path.join(root, 'modules', 'bin');
const cacheDir = path.join(root, 'modules', '.cache');
const isWin = process.platform === 'win32';
const binary = isWin ? 'sing-box.exe' : 'sing-box';
const dest = path.join(binDir, binary);
const repo = 'SagerNet/sing-box';
const userAgent = 'NEXUS-sing-box-Bootstrap';

function ok() {
  return fs.existsSync(dest) && fs.statSync(dest).size > 4_000_000;
}

async function download(url, file) {
  await downloadZip(url, file, {
    repo,
    userAgent,
    minimumBytes: 1_000_000,
  });
}

function selectWindowsAsset(release) {
  if (!release || !Array.isArray(release.assets)) {
    throw new Error('GitHub API вернул некорректное описание релиза sing-box');
  }

  const asset = release.assets.find((item) => (
    item
    && typeof item.name === 'string'
    && /^[a-z0-9._-]+-windows-amd64\.zip$/i.test(item.name)
    && typeof item.browser_download_url === 'string'
  ));
  if (!asset) return null;

  const assetUrl = validateUrl(asset.browser_download_url, {
    repo,
    purpose: 'asset',
  });
  let urlFilename;
  try {
    urlFilename = decodeURIComponent(path.posix.basename(assetUrl.pathname));
  } catch {
    throw new Error('GitHub API вернул некорректное имя asset sing-box');
  }
  if (urlFilename !== asset.name) {
    throw new Error('Имя sing-box asset не совпадает с адресом загрузки');
  }
  return { name: asset.name, url: assetUrl.toString() };
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
  if (!isWin) {
    console.warn('Автоустановка sing-box сейчас только для Windows.');
    return;
  }

  console.log('Ставим sing-box (Hysteria2, как в Happ)…');
  const release = await getJson(`https://api.github.com/repos/${repo}/releases/latest`, {
    repo,
    userAgent,
  });
  const asset = selectWindowsAsset(release);
  if (!asset) {
    console.warn('В релизе sing-box нет windows-amd64.zip');
    return;
  }

  const zipPath = path.join(cacheDir, asset.name);
  const urls = [asset.url, `https://ghproxy.net/${asset.url}`];
  let last = 'не удалось скачать';
  for (const url of urls) {
    try {
      console.log(`  качаем ${safeUrlForLog(url)}`);
      await download(url, zipPath);
      const extractDir = path.join(cacheDir, 'singbox-extract');
      fs.rmSync(extractDir, { recursive: true, force: true });
      await (await Open.file(zipPath)).extract({ path: extractDir });
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
