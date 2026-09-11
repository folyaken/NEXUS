#!/usr/bin/env node
/**
 * Подготовка кеша winCodeSign перед сборкой установщика.
 *
 * Проблема. Даже без сертификата electron-builder скачивает пакет winCodeSign и
 * распаковывает его целиком. Внутри лежат библиотеки для macOS
 * (`darwin/10.12/lib/libcrypto.dylib`, `libssl.dylib`), оформленные
 * символическими ссылками. Windows создаёт такие ссылки только с правами
 * администратора или во включённом режиме разработчика, поэтому 7-Zip
 * возвращает ошибку, electron-builder считает шаг проваленным и повторяет
 * попытку. В итоге установщик не создаётся вовсе — в `release` остаётся только
 * `win-unpacked`.
 *
 * Решение. Скачиваем архив сами и распаковываем **без** ссылок macOS: они нужны
 * исключительно для подписи на macOS и к сборке под Windows отношения не имеют.
 * Готовый каталог кладётся в кеш, и electron-builder использует его как есть —
 * ничего не скачивая.
 *
 * Скрипт безопасно завершается при любой ошибке: он лишь предотвращает сбой,
 * но не является обязательным шагом сборки.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VERSION = 'winCodeSign-2.6.0';
const ARCHIVE_URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${VERSION}/${VERSION}.7z`;

/** Каталог кеша electron-builder, тот же, что использует сборщик. */
function cacheRoot() {
  if (process.env.ELECTRON_BUILDER_CACHE) return process.env.ELECTRON_BUILDER_CACHE;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'electron-builder');
  return path.join(os.homedir(), '.cache', 'electron-builder');
}

function sevenZipPath() {
  const binary = process.platform === 'win32' ? '7za.exe' : '7za';
  const platformDir = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  const architecture = process.arch === 'ia32' ? 'ia32' : process.arch === 'arm64' ? 'arm64' : 'x64';
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '7zip-bin', platformDir, architecture, binary),
    path.join(__dirname, '..', 'node_modules', '7zip-bin', platformDir, binary),
  ];
  return candidates.find((item) => fs.existsSync(item)) ?? null;
}

function main() {
  const targetDir = path.join(cacheRoot(), 'winCodeSign', VERSION);

  // Готовый кеш повторно не собирается: signtool.exe — признак успешной распаковки.
  if (fs.existsSync(path.join(targetDir, 'windows-10'))) {
    console.log(`winCodeSign уже подготовлен: ${targetDir}`);
    return;
  }

  const sevenZip = sevenZipPath();
  if (!sevenZip) {
    console.log('7-Zip из node_modules не найден — шаг пропущен.');
    return;
  }

  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-wincodesign-'));
  const archivePath = path.join(temporaryDir, `${VERSION}.7z`);

  try {
    console.log(`Загрузка ${VERSION}…`);
    execFileSync('curl', ['-fsSL', '-o', archivePath, ARCHIVE_URL], { stdio: 'inherit', timeout: 180_000 });

    fs.mkdirSync(targetDir, { recursive: true });

    // -x!darwin исключает каталог macOS целиком: именно в нём лежат
    // символические ссылки, которые Windows не создаёт без прав администратора.
    // Ключ -snld намеренно не используется — сборки 7-Zip из node_modules его
    // не понимают и завершаются с ошибкой разбора аргументов.
    console.log('Распаковка без компонентов macOS…');
    execFileSync(sevenZip, ['x', '-bd', '-y', archivePath, `-o${targetDir}`, '-x!darwin'], {
      stdio: 'inherit',
      timeout: 180_000,
    });

    console.log(`Кеш winCodeSign подготовлен: ${targetDir}`);
  } catch (error) {
    // Сборка должна продолжиться в любом случае: скрипт лишь помогает.
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Не удалось подготовить winCodeSign (${message}). Сборка продолжится.`);
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

main();
