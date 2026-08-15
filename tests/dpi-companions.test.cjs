const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { companionCount, companionDomains, expandDpiHosts } = require(path.join(root, 'dist-electron', 'dpi-companions.js'));

// --- Сопутствующие домены сервиса -------------------------------------------
// Сайт отдаёт контент с отдельных доменов, которые поддоменами не являются:
// без них страница грузится, а картинки и видео — нет.
const instagram = companionDomains('instagram.com');
assert.equal(instagram[0], 'instagram.com', 'запрошенный домен идёт первым');
assert.ok(instagram.includes('cdninstagram.com'), 'CDN сервиса обязателен');
assert.ok(instagram.includes('fbcdn.net'));

assert.ok(companionDomains('soundcloud.com').includes('sndcdn.com'), 'SoundCloud без sndcdn.com не играет');
assert.ok(companionDomains('twitter.com').includes('twimg.com'), 'картинки Twitter лежат на twimg.com');
assert.ok(companionDomains('twitter.com').includes('x.com'), 'группа связывает оба имени сервиса');

// Обратная связь: добавление CDN подключает и основной домен.
assert.ok(companionDomains('cdninstagram.com').includes('instagram.com'), 'группы двусторонние');

// Домен из нескольких групп объединяет их: fbcdn.net обслуживает и Instagram, и Facebook.
const fbcdn = companionDomains('fbcdn.net');
assert.ok(fbcdn.includes('instagram.com'));
assert.ok(fbcdn.includes('facebook.com'));

// Поддомен известного сервиса подтягивает ту же группу.
const musicYoutube = companionDomains('music.youtube.com');
assert.equal(musicYoutube[0], 'music.youtube.com');
assert.ok(musicYoutube.includes('googlevideo.com'), 'видео YouTube идёт с googlevideo.com');

// Неизвестный домен остаётся сам по себе — выдумывать адреса нельзя.
assert.deepEqual(companionDomains('example-unknown-site.com'), ['example-unknown-site.com']);
assert.deepEqual(companionDomains('   '), []);
assert.equal(companionCount('example-unknown-site.com'), 0);
assert.ok(companionCount('instagram.com') >= 2);

// Регистр и пробелы не мешают сопоставлению.
assert.deepEqual(companionDomains('  INSTAGRAM.com '), companionDomains('instagram.com'));

// --- Поддомены не перечисляются вручную -------------------------------------
// Ядро Zapret раскрывает поддомены само («subdomains auto apply»), поэтому
// записи вида i.instagram.com только раздували бы список.
const source = fs.readFileSync(path.join(root, 'src', 'main', 'dpi-companions.ts'), 'utf8');
const groups = source.slice(source.indexOf('const DOMAIN_GROUPS'), source.indexOf('/** Домен -> все домены'));
for (const forbidden of ['i.instagram.com', 'scontent.instagram.com', 'www.youtube.com', 'api.twitter.com']) {
  assert.ok(!groups.includes(forbidden), `поддомен ${forbidden} не должен перечисляться вручную`);
}

// --- Развёртывание списка ---------------------------------------------------
const expanded = expandDpiHosts(['instagram.com', 'soundcloud.com']);
assert.ok(expanded.includes('instagram.com'));
assert.ok(expanded.includes('cdninstagram.com'));
assert.ok(expanded.includes('soundcloud.com'));
assert.ok(expanded.includes('sndcdn.com'));

// Дубликаты между пересекающимися группами схлопываются.
const overlapping = expandDpiHosts(['instagram.com', 'facebook.com']);
assert.equal(new Set(overlapping).size, overlapping.length, 'в списке не должно быть повторов');
assert.equal(overlapping.filter((item) => item === 'fbcdn.net').length, 1);

assert.deepEqual(expandDpiHosts([]), []);

// Порядок стабилен: сначала то, что ввёл пользователь.
assert.equal(expandDpiHosts(['soundcloud.com'])[0], 'soundcloud.com');

// --- Кеш Chromium вне общего профиля ----------------------------------------
// Zapret требует прав администратора, поэтому приложение запускают с разными
// правами. Каталог кеша с чужим владельцем вызывал «Unable to move the cache (0x5)».
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
assert.match(main, /function prepareChromiumCache\(\)/, 'кеш должен готовиться до старта Chromium');
assert.match(main, /app\.setPath\('cache', cacheRoot\)/);
assert.match(main, /app\.setPath\('sessionData'/);
// Проверка записи и пересоздание — иначе каталог от админского запуска остаётся нечитаемым.
assert.match(main, /writeFileSync\(probe, ''\)/, 'нужна проверка доступа на запись');
assert.match(main, /rmSync\(cacheRoot, \{ recursive: true, force: true \}\)/, 'недоступный каталог пересоздаётся');
// Сбой подготовки кеша не должен мешать запуску: это лишь ускорение отрисовки.
const cacheBlock = main.slice(main.indexOf('function prepareChromiumCache'), main.indexOf('if (gotLock) prepareChromiumCache()'));
assert.match(cacheBlock, /catch \{/, 'ошибки подготовки кеша обязаны подавляться');
assert.ok(
  main.indexOf('prepareChromiumCache()') < main.indexOf('app.whenReady'),
  'путь кеша задаётся до готовности приложения, иначе Chromium уже создаст его сам',
);

console.log('DPI companion domains and Chromium cache checks passed.');
