const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const channel = require(path.join(root, 'scripts', 'update-channel.cjs'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseScript = fs.readFileSync(path.join(root, 'scripts', 'build-release.cjs'), 'utf8');

// Обновление одной кнопкой требует адреса, откуда программа берёт сведения о
// новой версии. Адрес задаётся один раз и хранится отдельно от манифеста.

// --- Проверка адреса ---------------------------------------------------------
// Только HTTPS: по открытому HTTP ответ сервера можно подменить и подсунуть
// пользователю чужой установщик.
assert.equal(channel.normalizeChannelUrl('http://example.com/updates/'), null, 'HTTP недопустим');
assert.equal(channel.normalizeChannelUrl('ftp://example.com/'), null);
assert.equal(channel.normalizeChannelUrl('не ссылка'), null);
assert.equal(channel.normalizeChannelUrl(''), null);
assert.equal(channel.normalizeChannelUrl(undefined), null);

// Косая черта в конце обязательна: к адресу дописываются имена файлов, и без
// неё программа искала бы их не там.
assert.equal(
  channel.normalizeChannelUrl('https://github.com/user/repo/releases/latest/download'),
  'https://github.com/user/repo/releases/latest/download/',
);
assert.equal(
  channel.normalizeChannelUrl('https://github.com/user/repo/releases/latest/download/'),
  'https://github.com/user/repo/releases/latest/download/',
);

// Параметры запроса и якорь отбрасываются: в адресе канала им не место, а
// случайно скопированный токен из адресной строки попал бы в установщик.
assert.equal(
  channel.normalizeChannelUrl('https://updates.example.com/nexus/?token=secret#part'),
  'https://updates.example.com/nexus/',
);

// --- Аргументы сборки --------------------------------------------------------
// Без канала сборка идёт как обычно: собирать программу на машине без сервера
// обновлений должно быть можно.
assert.deepEqual(channel.builderPublishArgs({}), []);

const configured = channel.builderPublishArgs({ NEXUS_UPDATE_URL: 'https://github.com/a/b/releases/latest/download' });
assert.deepEqual(configured, [
  '-c.publish.provider=generic',
  '-c.publish.url=https://github.com/a/b/releases/latest/download/',
  '-c.publish.channel=latest',
]);
// Провайдер github требует положить токен внутрь установщика — он не подходит.
assert.doesNotMatch(configured.join(' '), /provider=github/);

// --- Хранение адреса ---------------------------------------------------------
// Секции publish в манифесте быть не должно: electron-builder раскрывает
// подстановки на этапе сборки и падает, если переменная не задана.
assert.equal(manifest.build.publish, undefined);

// Команды должны быть под рукой, иначе настройка канала превращается в
// вспоминание длинной строки.
assert.equal(manifest.scripts.channel, 'node scripts/update-channel.cjs');
assert.equal(manifest.scripts['channel:set'], 'node scripts/update-channel.cjs set');
assert.equal(manifest.scripts['release:win'], 'node scripts/build-release.cjs');

// --- Сборка выпуска ----------------------------------------------------------
// Без latest.yml установленная программа не узнает о новой версии, поэтому его
// отсутствие обязано останавливать выпуск.
assert.match(releaseScript, /latest\.yml/);
assert.match(releaseScript, /Не хватает обязательных файлов/);
// Загрузка на сервер не выполняется: токен GitHub в сборке не участвует.
assert.match(releaseScript, /'--publish', 'never'/);
// Текст лицензии и ядра готовятся так же, как при обычной сборке.
assert.match(releaseScript, /prepare-license\.cjs/);
assert.match(releaseScript, /ensure-xray\.cjs/);

// --- Файл настройки ----------------------------------------------------------
void (() => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-channel-'));
  const saved = channel.CONFIG_FILE;
  try {
    // Проверяем чтение из файла на копии, не трогая настоящую настройку.
    const configPath = path.join(directory, 'update-channel.json');
    fs.writeFileSync(configPath, JSON.stringify({ url: 'https://example.com/updates/' }));
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(channel.normalizeChannelUrl(parsed.url), 'https://example.com/updates/');

    // Переменная окружения важнее файла: так проверяют тестовый канал, не
    // трогая рабочую настройку.
    assert.equal(
      channel.readChannelUrl({ NEXUS_UPDATE_URL: 'https://env.example.com/' }),
      'https://env.example.com/',
    );
    assert.ok(saved.endsWith('update-channel.json'), 'настройка хранится в отдельном файле');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})();

console.log('Update channel checks passed.');
