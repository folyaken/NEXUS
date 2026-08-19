const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const bootstrap = require(path.join(root, 'scripts', 'ensure-wintun.cjs'));
const bootstrapSource = fs.readFileSync(path.join(root, 'scripts', 'ensure-wintun.cjs'), 'utf8');
const vpnManager = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');
const releaseScript = fs.readFileSync(path.join(root, 'scripts', 'build-release.cjs'), 'utf8');
const { buildXrayConfig } = require(path.join(root, 'dist-electron', 'xray-config.js'));

// Режим TUN заворачивает в туннель весь трафик системы: ядро создаёт
// виртуальный сетевой адаптер через драйвер Wintun. Библиотека обязана лежать
// рядом с ядром, иначе процесс завершается мгновенно с кодом −1 (4294967295) и
// пустым журналом — именно это и видел пользователь.

// --- Загрузка драйвера ---------------------------------------------------------
assert.equal(bootstrap.WINTUN_VERSION, '0.14.1', 'версия драйвера зафиксирована намеренно');
assert.match(bootstrap.WINTUN_URL, /^https:\/\/www\.wintun\.net\/builds\//, 'только сайт разработчика');
// Контрольная сумма именно этого архива, подтверждённая сторонней проверкой.
assert.equal(
  bootstrap.WINTUN_SHA256,
  '07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51',
);

// Драйвер получает доступ к сетевому стеку целиком, поэтому подмена файла
// недопустима: адрес ограничен, сумма сверяется, размер ограничен.
assert.match(bootstrapSource, /parsed\.protocol !== 'https:'/, 'только защищённое соединение');
assert.match(bootstrapSource, /!ALLOWED_HOSTS\.has\(parsed\.hostname\.toLowerCase\(\)\)/, 'только доверенные узлы');

// Сайт разработчика доступен не из всех сетей. Без запасного источника сборка
// молча уходила без драйвера, и TUN не работал уже у пользователя.
assert.ok(bootstrap.WINTUN_SOURCES.length >= 2, 'нужен запасной источник загрузки');
for (const source of bootstrap.WINTUN_SOURCES) {
  assert.match(source.url, /^https:\/\//, 'только защищённое соединение');
  assert.ok(source.url.includes(bootstrap.WINTUN_VERSION), 'источники обязаны давать одну версию');
}
// Обоим источникам — одна контрольная сумма: запасной путь не ослабляет проверку.
assert.match(bootstrapSource, /digest !== WINTUN_SHA256/);

// Об отсутствии драйвера обязано быть заметное предупреждение: одна строка
// среди сотен строк сборки теряется, и проблема всплывает у пользователя.
assert.match(bootstrapSource, /function warnTunUnavailable/);
assert.match(bootstrapSource, /режим TUN работать не будет/);
assert.match(releaseScript, /wintun\.dll/, 'выпуск обязан проверять наличие драйвера');
assert.match(releaseScript, /режим TUN работать не будет/, 'выпуск обязан предупреждать');
assert.match(bootstrapSource, /digest !== WINTUN_SHA256/, 'сумма обязана сверяться');
assert.match(bootstrapSource, /size > MAX_ARCHIVE_BYTES/, 'размер архива ограничен');
assert.match(bootstrapSource, /redirectsLeft <= 0/, 'перенаправления ограничены');

// Недоступность сети не должна ломать сборку: без драйвера остаётся режим PROXY.
assert.match(bootstrapSource, /Режим PROXY продолжит работать/);

// Разрядность выбирается по системе: у драйвера отдельная сборка под каждую.
assert.ok(['amd64', 'arm64', 'arm', 'x86'].includes(bootstrap.windowsArchFolder()));

// На других системах шаг просто пропускается.
assert.match(bootstrapSource, /if \(!isWin\)/);

// --- Шаг подключён к сборке ------------------------------------------------------
assert.match(manifest.scripts['package:win'], /ensure-wintun\.cjs/, 'сборка обязана готовить драйвер');
assert.match(manifest.scripts.dev, /ensure-wintun\.cjs/, 'в разработке TUN тоже нужен');
assert.match(releaseScript, /ensure-wintun\.cjs/, 'выпуск обязан включать драйвер');

// Драйвер лежит рядом с ядрами и попадает в установщик вместе с ними.
const binResource = manifest.build.extraResources.find((item) => item.from === 'modules/bin');
assert.ok(binResource, 'ядра и драйвер поставляются из modules/bin');
assert.ok(binResource.filter.includes('**/*'));
assert.equal(
  binResource.filter.some((rule) => rule.startsWith('!') && /dll/i.test(rule)),
  false,
  'драйвер не должен попадать под исключения',
);

// --- Понятная ошибка вместо кода −1 ----------------------------------------------
assert.match(vpnManager, /private missingTunDriver\(enginePath: string\)/);
assert.match(vpnManager, /wintun\.dll/);
// Проверка идёт до запуска ядра: иначе пользователь снова увидит только код.
const guard = vpnManager.indexOf('missingTunDriver(engine)');
const spawn = vpnManager.indexOf('const child = spawn(');
assert.ok(guard > 0 && spawn > guard, 'драйвер проверяется до запуска ядра');
// Сообщение обязано подсказывать выход, а не только называть проблему.
assert.match(vpnManager, /Режим PROXY работает без этого драйвера/);
assert.match(vpnManager, /Проверить/, 'подсказка про обновление даёт простой выход');

// Драйвер мог остаться во вложенной в установщик папке: прежде чем отказывать,
// программа переносит его к ядру.
assert.match(vpnManager, /private tunDriverCandidates\(\)/);
assert.match(vpnManager, /copyFileSync\(candidate/);
assert.match(vpnManager, /process\.resourcesPath, 'modules', 'bin', 'wintun\.dll'/);
// Проверка только для Windows: на других системах драйвер не нужен.
assert.match(vpnManager, /mode === 'tun' && process\.platform === 'win32'/);

// --- Конфигурация TUN --------------------------------------------------------------
// Ядро само поднимает адаптер и прописывает маршруты — иначе трафик в туннель
// не попадёт, и режим окажется бесполезным.
const config = buildXrayConfig(
  { protocol: 'vless', address: 'example.com', port: 443, uuid: '11111111-2222-3333-4444-555555555555' },
  10808,
  'tun',
);
const inbounds = config.inbounds;
const tun = inbounds.find((item) => item.protocol === 'tun');
assert.ok(tun, 'в режиме TUN обязан быть соответствующий вход');
assert.ok(Array.isArray(tun.settings.autoSystemRoutingTable), 'маршруты прописываются автоматически');
assert.equal(tun.settings.autoOutboundsInterface, 'auto', 'без привязки к адаптеру трафик зациклится');

// В обычном режиме адаптер не создаётся: права администратора там не нужны.
const proxyConfig = buildXrayConfig(
  { protocol: 'vless', address: 'example.com', port: 443, uuid: '11111111-2222-3333-4444-555555555555' },
  10808,
  'proxy',
);
assert.equal(proxyConfig.inbounds.some((item) => item.protocol === 'tun'), false);

console.log('TUN driver checks passed.');
