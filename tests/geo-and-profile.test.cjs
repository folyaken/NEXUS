const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const geoSource = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-geo.ts'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const { applyGeo } = require(path.join(root, 'dist-electron', 'vpn-geo.js'));

// --- Геолокация только по HTTPS ---------------------------------------------
// Открытый HTTP позволял провайдеру подменить ответ и показать чужую страну.
assert.doesNotMatch(geoSource, /['"`]http:\/\//, 'запросы геолокации обязаны идти по HTTPS');
assert.match(geoSource, /https:\/\/ipwho\.is\//, 'нужен источник с HTTPS на бесплатном тарифе');
assert.match(geoSource, /https:\/\/ip-api\.com\/batch/, 'ip-api остаётся запасным, но по HTTPS');
// Откат на HTTP недопустим: он вернул бы подменяемые данные.
assert.doesNotMatch(geoSource, /fallback.*http:|http:.*fallback/i);
// Зависший ответ не должен блокировать импорт профилей.
assert.match(geoSource, /AbortSignal\.timeout\(/, 'запросу нужен таймаут');

// Ответ приходит из сети, поэтому каждое поле проверяется перед показом.
assert.match(geoSource, /function sanitizeCountryCode/);
assert.match(geoSource, /\^\[A-Za-z\]\{2\}\$/, 'код страны обязан строго валидироваться');
assert.match(geoSource, /replace\(\/\[\\u0000-\\u001f\\u007f\]\/g/, 'управляющие символы вырезаются');

// --- Поведение при недоступной сети -----------------------------------------
void (async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-geo-test-'));
  const realFetch = global.fetch;
  try {
    const cacheFile = path.join(temp, 'geo-cache.json');
    const profile = {
      id: 'node-1',
      name: 'vpn.example.com',
      protocol: 'vless',
      server: '203.0.113.10',
      port: 443,
      shareLink: 'vless://example',
      params: { protocol: 'vless', address: '203.0.113.10', port: 443 },
      createdAt: new Date().toISOString(),
    };

    // Провайдер недоступен: профили обязаны остаться пригодными к подключению.
    global.fetch = async () => { throw new Error('network is unreachable'); };
    const offline = await applyGeo([{ ...profile }], cacheFile);
    assert.equal(offline.length, 1);
    assert.equal(offline[0].server, '203.0.113.10', 'сервер не должен потеряться без геоданных');
    assert.equal(offline[0].country, undefined);

    // Ответ с мусором не должен попасть в имя профиля.
    global.fetch = async () => new Response(JSON.stringify({
      success: true,
      ip: '203.0.113.10',
      country_code: 'NL',
      city: 'Amster\u0000dam\ninjected',
      connection: { isp: 'Example ISP' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const located = await applyGeo([{ ...profile }], path.join(temp, 'geo-cache-2.json'));
    assert.equal(located[0].country, 'NL');
    assert.doesNotMatch(located[0].city ?? '', /[\u0000-\u001f]/, 'управляющие символы недопустимы');
    assert.doesNotMatch(located[0].name, /\n/, 'перевод строки не должен попадать в имя');

    // Некорректный код страны отбрасывается, а не показывается пользователю.
    global.fetch = async () => new Response(JSON.stringify({
      success: true, ip: '203.0.113.10', country_code: '<script>', city: 'X',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const bogus = await applyGeo([{ ...profile }], path.join(temp, 'geo-cache-3.json'));
    assert.equal(bogus[0].country, undefined, 'мусорный код страны игнорируется');

    console.log('Geo lookup checks passed.');
  } finally {
    global.fetch = realFetch;
    await fsp.rm(temp, { recursive: true, force: true });
  }
})();

// --- Сохранность профиля и настроек -----------------------------------------
// Обычный writeFile сначала обнуляет файл: обрыв в этот момент оставлял пустой
// профиль, и пользователь заново вводил имя.
assert.match(mainSource, /async function writeJsonSafely/, 'запись должна быть атомарной');
assert.match(mainSource, /await fs\.rename\(temporary, filePath\)/, 'замена файла через переименование');
assert.match(mainSource, /await writeJsonSafely\(profilePath\(\), profile\)/, 'профиль сохраняется атомарно');
assert.match(mainSource, /await writeJsonSafely\(settingsPath\(\), settings\)/, 'настройки сохраняются атомарно');
assert.doesNotMatch(mainSource, /fs\.writeFile\(settingsPath\(\)/, 'прямая запись настроек недопустима');

// Ошибка чтения не должна затирать существующий профиль.
assert.match(mainSource, /if \(!existsSync\(profilePath\(\)\)\) await writeJsonSafely/, 'профиль создаётся только когда его нет');
// Повреждённый файл сохраняется для восстановления, а не пропадает молча.
assert.match(mainSource, /\$\{filePath\}\.broken/, 'повреждённый файл сохраняется рядом');

// sessionData обязан остаться в userData: его перенос уводит состояние сессии.
assert.doesNotMatch(mainSource, /app\.setPath\('sessionData'/, 'перенос sessionData сбрасывает данные пользователя');
assert.match(mainSource, /app\.setPath\('cache', cacheRoot\)/, 'переносится только кеш');

console.log('Profile durability checks passed.');
