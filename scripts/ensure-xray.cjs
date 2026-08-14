const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Open } = require('unzipper');
const { downloadZip, safeUrlForLog } = require('./bootstrap-network.cjs');

const root = path.resolve(__dirname, '..');
const binDir = path.join(root, 'modules', 'bin');
const isWin = process.platform === 'win32';
const binary = isWin ? 'xray.exe' : 'xray';
const zipName = isWin ? 'Xray-windows-64.zip' : 'Xray-linux-64.zip';
const dest = path.join(binDir, binary);
const repo = 'XTLS/Xray-core';
const userAgent = 'NEXUS-Xray-Bootstrap';
// Windows TUN auto-routing was added after the latest stable v26.3.27.
// Pin a reviewed release whose JSON schema supports Split Tunneling.
const requiredRelease = 'v26.7.28';
const minimumTunVersion = [26, 4, 13];

function ok() {
  return fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000;
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

function installedVersion() {
  if (!ok()) return null;
  try {
    const result = spawnSync(dest, ['version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const match = output.match(/\bXray\s+(\d+)\.(\d+)\.(\d+)/i);
    return match ? match.slice(1, 4).map(Number) : null;
  } catch {
    return null;
  }
}

function supportsTunSplit(version) {
  if (!version) return false;
  for (let index = 0; index < minimumTunVersion.length; index += 1) {
    if (version[index] !== minimumTunVersion[index]) return version[index] > minimumTunVersion[index];
  }
  return true;
}

async function download(url, file) {
  await downloadZip(url, file, {
    repo,
    userAgent,
    minimumBytes: 800_000,
  });
}

async function main() {
  const currentVersion = installedVersion();
  if (supportsTunSplit(currentVersion)) {
    console.log(`Xray уже установлен: ${path.relative(root, dest)} (${currentVersion.join('.')})`);
    return;
  }
  if (ok()) {
    const label = currentVersion ? currentVersion.join('.') : 'неизвестная версия';
    console.log(`Обновление Xray ${label}: для TUN Split требуется версия 26.4.13 или новее…`);
  } else {
    console.log('Установка Xray-core для VPN-подключений…');
  }
  const urls = [
    `https://github.com/${repo}/releases/download/${requiredRelease}/${zipName}`,
    `https://ghproxy.net/https://github.com/${repo}/releases/download/${requiredRelease}/${zipName}`,
  ];
  let last = 'не удалось скачать';
  for (const url of urls) {
    const attemptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-xray-setup-'));
    const zipPath = path.join(attemptDir, zipName);
    const extractDir = path.join(attemptDir, 'extract');
    try {
      console.log(`  загрузка ${safeUrlForLog(url)}`);
      await download(url, zipPath);
      await (await Open.file(zipPath)).extract({ path: extractDir });
      const found = walk(extractDir, binary);
      if (!found) throw new Error(`${binary} не найден в архиве`);
      fs.mkdirSync(binDir, { recursive: true });
      fs.copyFileSync(found, dest);
      if (!isWin) fs.chmodSync(dest, 0o755);
      const nextVersion = installedVersion();
      if (!supportsTunSplit(nextVersion)) throw new Error('ядро не поддерживает TUN Split');
      console.log(`Xray установлен: ${path.relative(root, dest)} (${nextVersion.join('.')})`);
      return;
    } catch (error) {
      last = setupErrorMessage(error);
      console.warn(`  попытка не удалась: ${last}`);
    } finally {
      try { fs.rmSync(attemptDir, { recursive: true, force: true }); } catch { /* system temp is cleaned later */ }
    }
  }
  const action = ok() ? 'не обновлён; Proxy может продолжить работу, но TUN Split требует Xray 26.4.13+' : 'не установлен';
  console.warn(`Xray ${action} (${last}). Повторите запуск после восстановления доступа к GitHub.`);
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

if (require.main === module) {
  main().catch((error) => {
    console.warn(setupErrorMessage(error));
  });
}

module.exports = {
  minimumTunVersion,
  requiredRelease,
  supportsTunSplit,
};
