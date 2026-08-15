const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { AppUpdater, updateFeedUrl } = require(path.join(root, 'dist-electron', 'app-updater.js'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const updaterSource = fs.readFileSync(path.join(root, 'src', 'main', 'app-updater.ts'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');

// --- Канал обновления не должен раскрывать токен ----------------------------
// Для приватного репозитория провайдер github требует положить токен GitHub
// внутрь установщика. Любой может распаковать asar и получить доступ ко всем
// репозиториям аккаунта, поэтому используется generic-провайдер.
assert.equal(manifest.build.publish[0].provider, 'generic', 'провайдер github раскрыл бы токен');
assert.doesNotMatch(JSON.stringify(manifest.build.publish), /token|GH_TOKEN|ghp_/i, 'токенов в конфигурации быть не должно');
assert.doesNotMatch(updaterSource, /provider: 'github'/, 'github-провайдер несовместим с приватным репозиторием');
assert.doesNotMatch(updaterSource, /ghp_|GH_TOKEN/, 'токен не должен попадать в код');

// --- Адрес канала проверяется -----------------------------------------------
// По открытому HTTP канал обновления можно подменить и подсунуть чужой установщик.
assert.equal(updateFeedUrl({ NEXUS_UPDATE_URL: 'https://updates.example.com/nexus/' }), 'https://updates.example.com/nexus/');
assert.equal(updateFeedUrl({ NEXUS_UPDATE_URL: 'http://updates.example.com/' }), null, 'HTTP недопустим');
assert.equal(updateFeedUrl({ NEXUS_UPDATE_URL: 'не ссылка' }), null);
assert.equal(updateFeedUrl({}), null, 'без адреса канал считается ненастроенным');

// --- Поведение без настроенного канала --------------------------------------
void (async () => {
  // Запуск из исходников: обновляться нечему, но приложение обязано работать.
  const dev = new AppUpdater('1.1.1', false, 'https://updates.example.com/');
  const devState = await dev.check();
  assert.equal(devState.status, 'disabled');
  assert.match(devState.message, /установленной версии/i);
  assert.equal(devState.canInstall, false);

  // Установленная версия без адреса канала.
  const noFeed = new AppUpdater('1.1.1', true, null);
  const noFeedState = await noFeed.check();
  assert.equal(noFeedState.status, 'disabled');
  assert.match(noFeedState.message, /не настроен/i);

  // Установка невозможна, пока обновление не загружено: иначе перезапуск
  // произошёл бы впустую и пользователь потерял бы соединение.
  let restartCalled = false;
  await noFeed.install(async () => { restartCalled = true; });
  assert.equal(restartCalled, false, 'без загруженного обновления перезапуск недопустим');

  // Снимок состояния не должен позволять изменить внутреннее состояние извне.
  const snapshot = noFeed.snapshot();
  snapshot.status = 'downloaded';
  assert.notEqual(noFeed.snapshot().status, 'downloaded');

  console.log('App updater behaviour checks passed.');
})();

// --- Загрузка и установка разделены -----------------------------------------
// Автозагрузка съедала бы трафик без ведома пользователя, а автоустановка при
// выходе оборвала бы VPN в неподходящий момент.
assert.match(updaterSource, /autoUpdater\.autoDownload = false/);
assert.match(updaterSource, /autoUpdater\.autoInstallOnAppQuit = false/);

// Перед перезапуском обязательно останавливать VPN и модули: иначе в системе
// останутся winws.exe и изменённый системный прокси — пользователь без сети.
assert.match(mainSource, /async function prepareForUpdateRestart/);
assert.match(mainSource, /await vpn\?\.disconnect\(\)/);
assert.match(mainSource, /await manager\?\.stopAll/);
assert.match(mainSource, /appUpdater\.install\(prepareForUpdateRestart\)/);

// Примечания к релизу приходят из сети и попадают в интерфейс.
assert.match(updaterSource, /replace\(\/<\[\^>\]\*>\/g, ' '\)/, 'разметка вырезается');
assert.match(updaterSource, /\\u0000-\\u001f/, 'управляющие символы вырезаются');

// Ошибки объясняются понятным языком, а не кодом библиотеки.
for (const phrase of ['Сервер обновлений недоступен', 'подлинности обновления', 'прав для установки']) {
  assert.ok(updaterSource.includes(phrase), `нужна понятная формулировка: ${phrase}`);
}

// --- Интерфейс отражает реальное состояние ----------------------------------
// Раньше кнопка «Установить» была заблокирована навсегда.
assert.doesNotMatch(app, /Установка станет доступна после подключения канала релизов/, 'заглушка удалена');
assert.doesNotMatch(app, /'placeholder'/, 'статуса placeholder больше нет');
assert.match(app, /runUpdateAction\('download'\)/);
assert.match(app, /runUpdateAction\('install'\)/);
// Прогресс приходит событиями: локальная копия разошлась бы с реальностью.
assert.match(app, /api\.onNexusUpdateChanged\(setUpdateCheck\)/);
assert.match(app, /about-update-progress-bar/);
