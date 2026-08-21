const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const jey = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const {
  ROUTING_PRESETS, MAX_ROUTING_RULES, isValidRoutingValue,
  normalizeRoutingRules, xrayRoutingRules, singboxRoutingRules,
} = require(path.join(root, 'dist-electron', 'routing-rules.js'));
const { buildXrayConfig } = require(path.join(root, 'dist-electron', 'xray-config.js'));
const { DEFAULT_SETTINGS } = require(path.join(root, 'dist-electron', 'types.js'));
const manifestBuild = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build;
const { hasTranslation } = require(path.join(root, 'dist-electron', 'i18n.js'));

// --- Проверка того, что вводит пользователь -------------------------------------
// Неверная строка не даёт ядру запуститься, и VPN перестаёт подключаться —
// с виду без причины. Поэтому значение проверяется до сохранения.
for (const good of [
  'example.com', '*.example.com', 'sub.domain.example.com',
  '10.0.0.0/8', '192.168.1.1', 'geosite:ru', 'geoip:private',
  'full:exact.example.com', 'regexp:.*\\.example\\.com',
]) {
  assert.equal(isValidRoutingValue(good), true, `должно приниматься: ${good}`);
}
for (const bad of ['', '   ', 'просто текст', 'http://example.com', '999.1.1.1', '10.0.0.0/64', 'geosite:', '..', 'a'.repeat(220)]) {
  assert.equal(isValidRoutingValue(bad), false, `должно отклоняться: ${bad}`);
}

// --- Чтение сохранённых правил ------------------------------------------------------
assert.deepEqual(normalizeRoutingRules(null), [], 'испорченные настройки не должны ронять запуск');
assert.deepEqual(normalizeRoutingRules('строка'), []);
// Мусор отбрасывается, а рабочие правила остаются.
const mixed = normalizeRoutingRules([
  { value: 'example.com', outbound: 'direct', enabled: true },
  { value: 'сломано', outbound: 'proxy' },
  { value: 'example.com', outbound: 'block' },
  { value: '10.0.0.0/8', outbound: 'мусор' },
]);
assert.equal(mixed.length, 2, 'битые и повторяющиеся правила отбрасываются');
assert.equal(mixed[1].outbound, 'proxy', 'неизвестное направление приводится к «через VPN»');
assert.ok(mixed.every((rule) => rule.id), 'у каждого правила должен быть ключ');
// Список не должен разрастаться бесконтрольно.
const many = normalizeRoutingRules(Array.from({ length: 150 }, (_, i) => ({ value: `site${i}.com`, outbound: 'direct' })));
assert.equal(many.length, MAX_ROUTING_RULES);

// --- Превращение в конфигурацию ядра ---------------------------------------------------
const rules = [
  { id: '1', value: 'geosite:ru', outbound: 'direct', enabled: true },
  { id: '2', value: '10.0.0.0/8', outbound: 'direct', enabled: true },
  { id: '3', value: 'ads.example.com', outbound: 'block', enabled: true },
  { id: '4', value: 'off.example.com', outbound: 'proxy', enabled: false },
];
const xray = xrayRoutingRules(rules);
assert.equal(xray.length, 3, 'выключенное правило в конфигурацию не попадает');
// Домены и адреса описываются разными полями — перепутать нельзя.
// Российская зона больше не полагается на чужой тег (его в наборах не было
// никогда): она разворачивается в собственное правило по окончанию домена.
assert.deepEqual(xray[0], { type: 'field', domain: ['regexp:(^|\\.)(ru|su|xn--p1ai)$'], outboundTag: 'direct' });
assert.deepEqual(xray[1], { type: 'field', ip: ['10.0.0.0/8'], outboundTag: 'direct' });
assert.equal(xray[2].outboundTag, 'block');

// Порядок сохраняется: ядро применяет первое совпавшее правило, поэтому
// положение в списке и есть приоритет.
const ordered = xrayRoutingRules([
  { id: 'a', value: 'a.com', outbound: 'block', enabled: true },
  { id: 'b', value: 'b.com', outbound: 'direct', enabled: true },
]);
assert.deepEqual(ordered.map((rule) => rule.domain[0]), ['a.com', 'b.com']);

// Правила пользователя обязаны идти раньше правил по программам: иначе те
// перехватят весь трафик туннеля, и до доменов дело не дойдёт.
const config = buildXrayConfig(
  { address: 'example.com', port: 443, protocol: 'vless', uuid: 'x', security: 'tls' },
  10808, 'tun', [{ executable: 'game.exe', path: 'C:/game.exe' }], 'include', true, false, [], rules,
);
const configRules = config.routing.rules;
assert.ok(configRules.length > 3);
assert.equal(configRules[0].domain[0], 'regexp:(^|\\.)(ru|su|xn--p1ai)$', 'правила пользователя идут первыми');
// Для правил по адресам нужен разбор имени в IP, иначе geoip не срабатывает.
assert.equal(config.routing.domainStrategy, 'IPIfNonMatch');

// Без правил поведение прежнее — лишней секции в конфигурации не появляется.
const plain = buildXrayConfig(
  { address: 'example.com', port: 443, protocol: 'vless', uuid: 'x', security: 'tls' },
  10808, 'proxy', [], 'system', true, false, [], [],
);
assert.equal(plain.routing, undefined, 'без правил секция routing не нужна');

// sing-box: групповые наборы пропускаются — они требуют отдельных файлов, и
// ядро с ними просто не запустится. Исключение — российская зона и соцсети:
// они разворачиваются в суффиксы доменов и не зависят от наборов.
const singbox = singboxRoutingRules(rules);
assert.ok(!singbox.some((rule) => JSON.stringify(rule).includes('geosite')), 'geosite в sing-box не поддерживается');
assert.ok(singbox.some((rule) => rule.action === 'reject'), 'блокировка обязана работать');
assert.ok(singbox.some((rule) => Array.isArray(rule.domain_suffix) && rule.domain_suffix.includes('ru')),
  'российская зона в sing-box обязана разворачиваться в суффиксы');
const singboxSocial = singboxRoutingRules([{ id: 's', value: 'geosite:category-social-media-!cn', outbound: 'direct', enabled: true }]);
assert.ok(singboxSocial.some((rule) => Array.isArray(rule.domain_suffix) && rule.domain_suffix.includes('t.me')),
  'соцсети в sing-box обязаны разворачиваться в список доменов');

// --- Собственные правила вместо чужих тегов ----------------------------------------------
// Тега `ru` в наборах не было никогда, `category-ru` появился недавно, а
// `category-social-media` удалён: правила на таких тегах молча не срабатывали.
// Российская зона и соцсети описываются собственными правилами NEXUS и
// работают с любым geosite.dat и любым ядром.
const russian = xrayRoutingRules([{ id: 'r', value: 'geosite:category-ru', outbound: 'direct', enabled: true }]);
assert.deepEqual(russian, [{ type: 'field', domain: ['regexp:(^|\\.)(ru|su|xn--p1ai)$'], outboundTag: 'direct' }]);
const social = xrayRoutingRules([{ id: 's', value: 'geosite:category-social-media-!cn', outbound: 'direct', enabled: true }]);
assert.equal(social.length, 1);
assert.ok(social[0].domain.includes('domain:vk.com'), 'соцсети обязаны включать vk.com');
assert.ok(social[0].domain.includes('domain:t.me'), 'соцсети обязаны включать t.me');
assert.ok(social[0].domain.includes('domain:youtube.com'), 'соцсети обязаны включать youtube.com');

// --- Настройки ---------------------------------------------------------------------------
assert.deepEqual(DEFAULT_SETTINGS.vpnRoutingRules, [], 'по умолчанию правил нет');
assert.match(main, /vpnRoutingRules: normalizeRoutingRules\(raw\.vpnRoutingRules\)/);
// Правила попадают в конфигурацию при старте ядра, поэтому их изменение
// перезапускает активную сессию — иначе они бы не действовали до переподключения.
assert.match(main, /const routingChanged = /);
assert.match(main, /dnsChanged \|\| routingChanged/);
assert.match(main, /settings\.vpnRoutingRules,/, 'правила обязаны доходить до менеджера VPN');

// --- Интерфейс --------------------------------------------------------------------------------
assert.match(jey, /const addRoutingRule = /);
assert.match(jey, /if \(!isValidRoutingValue\(value\)\)/, 'адрес проверяется до сохранения');
assert.match(jey, /Такое правило уже есть/, 'повтор ничего не изменит — сработает первое');
assert.match(jey, /const moveRoutingRule = /, 'порядок правил обязан меняться: это приоритет');
assert.match(jey, /ROUTING_PRESETS\.map/);
assert.match(jey, /routing-rule-order/, 'номер показывает приоритет правила');
// Значок пустого состояния раньше растягивался во всю карточку: у SVG не было
// заданного размера.
assert.match(styles, /\.routing-empty-icon svg \{[^}]*width: 22px/);
assert.match(styles, /\.routing-empty-icon \{[^}]*width: 44px/);
// Направления различаются цветом — он читается быстрее подписи.
for (const tone of ['is-proxy', 'is-direct', 'is-block']) {
  assert.ok(styles.includes(`.routing-rule-outbound.${tone}`), `нужен цвет для ${tone}`);
}
assert.match(styles, /\.routing-outbound-chip:focus-visible/, 'выбор доступен с клавиатуры');

// Наборы понятны без документации.
for (const preset of ROUTING_PRESETS) {
  assert.ok(preset.title.trim() && preset.description.trim());
  assert.equal(hasTranslation('en', preset.title), true, `нужен перевод: ${preset.title}`);
  assert.equal(hasTranslation('en', preset.description), true, `нужен перевод описания: ${preset.title}`);
}

// --- Актуальные теги наборов адресов -----------------------------------------------------
// Свежие наборы v2fly больше не содержат `ru` и `category-social-media`:
// ядро падало на таких тегах с кодом 23. Пресеты обязаны ссылаться только на
// живые теги, а старые — подменяться при построении конфигурации.
const presetValues = ROUTING_PRESETS.map((preset) => preset.value);
assert.ok(presetValues.includes('geosite:category-ru'), 'российские сайты обязаны идти через category-ru');
assert.ok(!presetValues.includes('geosite:ru'), 'тег ru больше не существует в наборах');
assert.ok(presetValues.includes('geosite:category-social-media-!cn'), 'соцсети обязаны идти через живой тег');
assert.ok(!presetValues.includes('geosite:category-social-media'), 'тег category-social-media больше не существует');
const { migrateLegacyRoutingTag, geoTagAlternatives } = require(path.join(root, 'dist-electron', 'routing-rules.js'));
assert.equal(migrateLegacyRoutingTag('geosite:ru'), 'geosite:category-ru');
assert.equal(migrateLegacyRoutingTag('geosite:RU'), 'geosite:category-ru', 'регистр не должен мешать миграции');
assert.equal(migrateLegacyRoutingTag('geosite:category-social-media'), 'geosite:category-social-media-!cn');
assert.equal(migrateLegacyRoutingTag('geosite:category-ads-all'), 'geosite:category-ads-all', 'живые теги не трогаются');
assert.equal(migrateLegacyRoutingTag('example.com'), 'example.com', 'обычные домены не трогаются');

// Синонимы разделов: наборы разного возраста знают разные имена. При
// подключении программа подбирает то имя, которое есть в файле наборов.
assert.deepEqual(geoTagAlternatives('geosite:category-ru'), ['geosite:ru', 'geosite:category-ru']);
assert.deepEqual(geoTagAlternatives('geosite:ru'), ['geosite:ru', 'geosite:category-ru']);
assert.deepEqual(geoTagAlternatives('geosite:category-social-media-!cn'), ['geosite:category-social-media', 'geosite:category-social-media-!cn']);
assert.deepEqual(geoTagAlternatives('geosite:category-ads-all'), ['geosite:category-ads-all'], 'без синонимов возвращается сам тег');

// --- Файлы наборов адресов --------------------------------------------------------
// Правило вида `geosite:ru` работает только когда рядом с ядром лежат
// `geosite.dat` и `geoip.dat`. Без них Xray падает сразу после запуска с кодом
// 23 и без объяснения — VPN просто не подключается.
//
// Раньше из архива Xray забирали только сам xray.exe, а файлы наборов терялись
// вместе с временной папкой. Пока правил маршрутизации не было, это не мешало.
const ensureXray = fs.readFileSync(path.join(root, 'scripts', 'ensure-xray.cjs'), 'utf8');
assert.match(ensureXray, /function copyGeoFiles/, 'файлы наборов обязаны копироваться рядом с ядром');
assert.match(ensureXray, /geoip\.dat/);
assert.match(ensureXray, /geosite\.dat/);
assert.match(ensureXray, /copyGeoFiles\(extractDir\)/, 'копирование обязано вызываться после распаковки');

// Файлы попадают в установщик: modules/bin переносится целиком.
const binResource = manifestBuild.extraResources.find((item) => item.from === 'modules/bin');
assert.ok(binResource, 'ядра и наборы обязаны попадать в сборку');
assert.ok(binResource.filter.includes('**/*'), 'фильтр не должен отсекать .dat');

// Если файлов всё же нет, групповые правила отбрасываются, а подключение
// сохраняется: лучше без части правил, чем совсем без VPN.
const vpnManager = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');
assert.match(vpnManager, /hasGeoFiles\(\): boolean/);
assert.match(vpnManager, /const geoRulesAllowed = geoReady && !this\.geoRulesForbidden/);
assert.match(vpnManager, /const usableRules = geoRulesAllowed/);
assert.match(vpnManager, /filter\(\(rule\) => !\/\^\(geosite\|geoip\|ext\):\/i\.test\(rule\.value\)\)/);
assert.match(vpnManager, /Файлы наборов адресов не найдены/, 'пользователю нужно объяснение в журнале');

// Проверка версии ядра не должна закрывать глаза на отсутствие файлов.
//
// Первая попытка починить код 23 не сработала именно из-за этого: скрипт
// видел «Xray нужной версии уже стоит» и выходил сразу, не доходя до
// копирования наборов. У всех, кто ставил NEXUS до появления маршрутизации,
// файлы так и не появлялись.
assert.match(ensureXray, /function hasGeoFiles/, 'наличие наборов проверяется отдельно от версии ядра');
assert.match(ensureXray, /supportsTunSplit\(currentVersion\) && hasGeoFiles\(\)/,
  'ранний выход возможен только когда есть и ядро, и наборы');
// Оборванная загрузка оставляет пустой файл — ядро падает на нём так же.
assert.match(ensureXray, /statSync\(file\)\.size > 1024/, 'пустой файл считается отсутствующим');

console.log('Routing rules checks passed.');
