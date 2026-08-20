const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const jey = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const {
  DNS_PROVIDERS, isValidDnsAddress, resolveDnsServers, xrayDnsSection, singboxDnsSection,
} = require(path.join(root, 'dist-electron', 'dns-servers.js'));
const { COMMUNITY_LINKS, DISCORD_CONTACT, isAllowedCommunityUrl } = require(path.join(root, 'dist-electron', 'community.js'));
const { DEFAULT_SETTINGS } = require(path.join(root, 'dist-electron', 'types.js'));
const { hasTranslation } = require(path.join(root, 'dist-electron', 'i18n.js'));

// --- «Отключить всё» реагирует и на модули без VPN ---------------------------------
// Меню значка возле часов пересобиралось только по событиям VPN. Если модуль
// запускали без подключения, пункт оставался серым: отключать было что, а
// нажать нельзя.
assert.match(main, /manager\.on\('changed', \(modules\) => \{[\s\S]{0,400}refreshTrayMenu/,
  'меню трея обязано обновляться при изменениях модулей');
assert.match(main, /enabled: isRunning \|\| status === 'connecting' \|\| \(manager\?\.list\(\)\.some\(\(item\) => item\.status === 'running'\)/);

// --- Discord в разделе «О программе» -------------------------------------------------
assert.equal(DISCORD_CONTACT, 'https://discord.com/users/folyaken');
const discord = COMMUNITY_LINKS.find((link) => link.id === 'discord');
assert.ok(discord, 'нужна ссылка на Discord');
assert.match(discord.description, /folyaken/, 'в подписи должно быть имя для связи');
// Открывается только то, что перечислено в коде: программа работает с правами
// администратора, и произвольные адреса открывать нельзя.
assert.equal(isAllowedCommunityUrl(DISCORD_CONTACT), true);
assert.equal(isAllowedCommunityUrl('https://discord.com/users/someone-else'), false);
for (const phrase of [discord.title, discord.description]) {
  assert.equal(hasTranslation('en', phrase), true, `нужен перевод: «${phrase}»`);
}

// --- Выбор справочника имён ------------------------------------------------------------
assert.equal(DEFAULT_SETTINGS.vpnDnsProvider, 'system', 'по умолчанию ничего не меняем');
assert.equal(DEFAULT_SETTINGS.vpnDnsCustom, '');

const ids = DNS_PROVIDERS.map((item) => item.id);
for (const required of ['system', 'cloudflare', 'google', 'adguard', 'custom']) {
  assert.ok(ids.includes(required), `нужен вариант ${required}`);
}
// У каждого варианта понятная подпись и перевод: список без пояснений
// заставляет гадать, чем варианты отличаются.
for (const provider of DNS_PROVIDERS) {
  assert.ok(provider.title.trim() && provider.description.trim());
  assert.equal(hasTranslation('en', provider.title), true, `нужен перевод: ${provider.title}`);
  assert.equal(hasTranslation('en', provider.description), true, `нужен перевод описания: ${provider.title}`);
}
// Известные адреса не должны разъехаться при правках.
assert.deepEqual(resolveDnsServers('cloudflare'), ['1.1.1.1', '1.0.0.1']);
assert.deepEqual(resolveDnsServers('google'), ['8.8.8.8', '8.8.4.4']);
assert.deepEqual(resolveDnsServers('adguard'), ['94.140.14.14', '94.140.15.15']);
// Системный вариант не добавляет секцию DNS вовсе — поведение как раньше.
assert.deepEqual(resolveDnsServers('system'), []);
assert.equal(xrayDnsSection([]), null);
assert.equal(singboxDnsSection([]), null);

// --- Проверка адреса ---------------------------------------------------------------------
// Неверный адрес молча ломает разрешение имён: интернет «пропадает» без
// объяснения причины. Поэтому значение проверяется до записи в настройки.
for (const good of ['1.1.1.1', '8.8.4.4', '9.9.9.9', 'https://dns.example.com/dns-query', '2606:4700:4700::1111']) {
  assert.equal(isValidDnsAddress(good), true, `адрес должен приниматься: ${good}`);
}
for (const bad of ['', '   ', 'not-an-address', '999.1.1.1', 'http://dns.example.com', 'javascript:alert(1)', '1.1.1']) {
  assert.equal(isValidDnsAddress(bad), false, `адрес должен отклоняться: ${bad}`);
}
assert.deepEqual(resolveDnsServers('custom', 'сломанный адрес'), [], 'битый адрес не должен уходить в ядро');
assert.deepEqual(resolveDnsServers('custom', ' 1.1.1.1 '), ['1.1.1.1'], 'пробелы по краям обрезаются');

// --- Настройка доходит до ядра ---------------------------------------------------------
const xray = fs.readFileSync(path.join(root, 'src', 'main', 'xray-config.ts'), 'utf8');
const singbox = fs.readFileSync(path.join(root, 'src', 'main', 'singbox-config.ts'), 'utf8');
assert.match(xray, /dnsServers: string\[\] = \[\]/, 'Xray обязан принимать список DNS');
assert.match(singbox, /dnsServers: string\[\] = \[\]/, 'sing-box обязан принимать список DNS');
assert.match(main, /resolveDnsServers\(settings\.vpnDnsProvider, settings\.vpnDnsCustom\)/);
// Настройка задаётся при старте ядра, поэтому смена справочника перезапускает
// активную сессию: иначе выбранный DNS начал бы работать только после ручного
// переподключения, и человек решил бы, что настройка не действует.
assert.match(main, /const dnsChanged = /);
assert.match(main, /saved\.vpnAllowLan !== previousAllowLan \|\| dnsChanged/);

// Для sing-box адрес самого VPN-сервера разрешается напрямую — иначе замкнутый
// круг: чтобы подключиться, нужно узнать адрес, а чтобы узнать — подключиться.
const section = singboxDnsSection(['1.1.1.1']);
assert.ok(section.servers.some((item) => item.tag === 'dns-direct' && item.detour === 'direct'),
  'нужен прямой сервер для разрешения адреса подключения');

// --- Интерфейс ------------------------------------------------------------------------------
assert.match(jey, /DNS_PROVIDERS\.map/, 'список справочников обязан строиться из общего перечня');
assert.match(jey, /role="radiogroup"/);
assert.match(jey, /const \[dnsDraft, setDnsDraft\]/,
  'свой адрес обязан редактироваться черновиком: сохранение на каждую клавишу оборвёт разрешение имён');
assert.match(jey, /if \(!isValidDnsAddress\(value\)\)/, 'адрес проверяется до сохранения');
assert.match(styles, /\.dns-provider-option/);
assert.match(styles, /\.dns-provider-option:focus-visible/, 'выбор должен быть доступен с клавиатуры');
assert.ok(styles.includes('.app-frame:not(.motion-force) .dns-provider-option'), 'нужна защита анимаций');
assert.ok(styles.includes('.app-frame.motion-off .dns-provider-option'));

console.log('DNS selection and contact links checks passed.');
