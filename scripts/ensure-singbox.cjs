const fs = require('node:fs');
const os = require('node:os');
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
const isWin = process.platform === 'win32';
const binary = isWin ? 'sing-box.exe' : 'sing-box';
const dest = path.join(binDir, binary);
const repo = 'SagerNet/sing-box';
const userAgent = 'NEXUS-sing-box-Bootstrap';

function ok() {
  return fs.existsSync(dest) && fs.statSync(dest).size > 4_000_000;
}

function setupErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code).toUpperCase() : '';
  if (['EPERM', 'EACCES', 'EBUSY'].includes(code) || /\b(?:EPERM|EACCES|EBUSY)\b/i.test(message)) {
    return 'Windows временно заблокировал файл установки. Закройте лишние экземпляры NEXUS и повторите запуск.';
  }
  if (code === 'ENOSPC' || /\bENOSPC\b/i.test(message)) {
    return 'Недостаточно свободного места. Освободите место на системном диске и повторите запуск.';
  }
  return message;
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
    console.log(`sing-box уже установлен: ${path.relative(root, dest)}`);
    return;
  }
  if (!isWin) {
    console.warn('Автоматическая установка sing-box сейчас доступна только для Windows.');
    return;
  }

  console.log('Установка sing-box для подключений Hysteria2…');
  const release = await getJson(`https://api.github.com/repos/${repo}/releases/latest`, {
    repo,
    userAgent,
  });
  const asset = selectWindowsAsset(release);
  if (!asset) {
    console.warn('В релизе sing-box нет windows-amd64.zip');
    return;
  }

  const urls = [asset.url, `https://ghproxy.net/${asset.url}`];
  let last = 'не удалось скачать';
  for (const url of urls) {
    const attemptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-singbox-setup-'));
    const zipPath = path.join(attemptDir, asset.name);
    const extractDir = path.join(attemptDir, 'extract');
    try {
      console.log(`  загрузка ${safeUrlForLog(url)}`);
      await download(url, zipPath);
      await (await Open.file(zipPath)).extract({ path: extractDir });
      const found = walk(extractDir, binary);
      if (!found) throw new Error(`${binary} не найден в архиве`);
      fs.mkdirSync(binDir, { recursive: true });
      fs.copyFileSync(found, dest);
      if (!ok()) throw new Error('скопированный бинарник пустой');
      console.log(`sing-box установлен: ${path.relative(root, dest)}`);
      return;
    } catch (error) {
      last = setupErrorMessage(error);
      console.warn(`  попытка не удалась: ${last}`);
    } finally {
      try { fs.rmSync(attemptDir, { recursive: true, force: true }); } catch { /* system temp is cleaned later */ }
    }
  }
  console.warn(`sing-box не установлен (${last}). Hysteria2 станет доступна после успешной загрузки с GitHub.`);
}

main().catch((error) => {
  console.warn(setupErrorMessage(error));
});
