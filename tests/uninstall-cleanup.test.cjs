const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const installer = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const proxySource = fs.readFileSync(path.join(root, 'src', 'main', 'system-proxy.ts'), 'utf8');

// --- Скрипт подключён к сборке ----------------------------------------------
// Без include файл лежит в репозитории, но установщик его не использует.
assert.equal(manifest.build.nsis.include, 'build/installer.nsh');

// --- Процессы останавливаются ------------------------------------------------
// Иначе после удаления модули продолжают работать в памяти, а их файлы
// остаются занятыми и не удаляются.
for (const image of [
  'winws.exe',            // Zapret
  'xray.exe',             // ядро VPN
  'sing-box.exe',         // Hysteria2
  'TgWsProxy_windows_7_64bit.exe',
  'TgWsProxy_windows_7_32bit.exe',
  'TgWsProxy_windows_arm64.exe',
]) {
  assert.ok(installer.includes(image), `при удалении нужно останавливать ${image}`);
}

// Остановка нужна и перед установкой: обновление поверх работающей копии
// упирается в занятые файлы.
assert.match(installer, /!macro customInit[\s\S]*?stopNexusWorkers/, 'установка тоже должна освобождать файлы');
assert.match(installer, /!macro customUnInit[\s\S]*?stopNexusWorkers/, 'удаление должно останавливать процессы');

// --- Системный прокси возвращается в исходное состояние ----------------------
// Самое важное: NEXUS включает прокси на время работы VPN. Если удалить
// программу с активным подключением, Windows продолжит слать трафик на
// несуществующий локальный порт — пользователь останется без интернета.
assert.match(installer, /restoreSystemProxy/);
assert.match(installer, /ProxyEnable" 0/, 'прокси должен выключаться');
assert.match(installer, /DeleteRegValue HKCU .*ProxyServer/, 'адрес прокси должен удаляться');
// Без уведомления система использует прежние настройки до перезагрузки.
assert.match(installer, /InternetSetOption 0 39 0 0/);
assert.match(installer, /!macro customUnInit[\s\S]*?restoreSystemProxy/, 'сброс прокси обязателен при удалении');

// --- Пользовательские данные ------------------------------------------------
// Молча стирать настройки нельзя: при переустановке пользователь ожидает
// найти профили VPN и список сайтов на месте.
assert.equal(manifest.build.nsis.deleteAppDataOnUninstall, false, 'данные не удаляются автоматически');
assert.match(installer, /MessageBox MB_YESNO/, 'удаление данных предлагается вопросом');
assert.match(installer, /nexus-network-tools/, 'каталог данных должен быть указан верно');
// По умолчанию (тихое удаление) данные сохраняются — это безопасный выбор.
assert.match(installer, /\/SD IDNO/, 'при тихом удалении настройки сохраняются');
// При обновлении вопрос задавать нельзя: пользователь потеряет настройки.
assert.match(installer, /\$\{ifNot\} \$\{isUpdated\}/, 'во время обновления данные не трогаются');

// --- Аварийное завершение приложения ----------------------------------------
// Штатный выход снимает прокси, но падение процесса или закрытие через
// диспетчер задач оставляло настройку включённой.
assert.match(mainSource, /function registerEmergencyCleanup/);
assert.match(mainSource, /registerEmergencyCleanup\(\);/, 'очистка должна регистрироваться при старте');
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  assert.ok(mainSource.includes(signal), `нужна обработка ${signal}`);
}
assert.match(mainSource, /process\.on\('uncaughtException'/);
assert.match(mainSource, /process\.on\('exit', cleanup\)/);

// Повторный вызов не должен выполнять работу дважды.
assert.match(mainSource, /if \(cleaned\) return;/);

// Причина падения обязана попасть в журнал, иначе её не найти.
assert.match(mainSource, /console\.error\('Необработанная ошибка:'/);

// Синхронная реализация: на аварийном пути асинхронный код уже не выполнится.
assert.match(proxySource, /export function clearSystemProxySync/);
assert.match(proxySource, /execFileSync/);
assert.match(proxySource, /ProxyEnable/);
// Сбой очистки не должен мешать завершению процесса.
const syncBlock = proxySource.slice(proxySource.indexOf('export function clearSystemProxySync'));
assert.match(syncBlock, /catch \{/, 'ошибки на аварийном пути подавляются');

console.log('Uninstall cleanup checks passed.');
