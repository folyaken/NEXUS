const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { isPrivateNetworkAddress, isServiceNode, looksLikeTechnicalName } = require(path.join(root, 'dist-electron', 'vpn-classify.js'));
const { applyGeo } = require(path.join(root, 'dist-electron', 'vpn-geo.js'));

// --- Служебные имена из конфигурации Xray ------------------------------------
// Конфигурации в формате ядра подписывают выходы тегами: proxy, proxy-13,
// outbound-2. В списке серверов они неразличимы и выбрать по ним нельзя.
for (const technical of [
  'proxy', 'proxy-13', 'proxy_7', 'proxy 2', 'outbound-2', 'out', 'node', 'server 3',
  'srv-1', 'vless-7', 'vmess', 'trojan-2', 'ss-3', 'hysteria2', 'direct', 'default', 'remote', '',
]) {
  assert.equal(looksLikeTechnicalName(technical), true, `должно считаться служебным: «${technical}»`);
}

// Осмысленные названия обязаны сохраняться: их выбрал провайдер или сам
// пользователь, и подменять их нельзя.
for (const meaningful of [
  'Germany Frankfurt', '🇩🇪 Берлин', 'Netherlands-1', 'MyProxy', 'proxy-vip-fast',
  'США · Нью-Йорк', 'Сервер для игр',
]) {
  assert.equal(looksLikeTechnicalName(meaningful), false, `должно сохраняться: «${meaningful}»`);
}

// --- Адреса внутри домашней сети ---------------------------------------------
// «Сервер» с таким адресом заставил бы приложение обратиться к устройству в
// сети пользователя — роутеру или камере. Подключаться туда нельзя.
for (const priv of [
  '127.0.0.1', '192.168.1.1', '10.0.0.5', '172.16.0.1', '172.31.255.255',
  '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1',
  'localhost', 'router.local',
]) {
  assert.equal(isPrivateNetworkAddress(priv), true, `должен отклоняться: ${priv}`);
  assert.equal(isServiceNode({ name: 'X', server: priv, port: 443 }), true, `не должен стать сервером: ${priv}`);
}

// Публичные адреса задевать нельзя — иначе пропадут рабочие серверы.
for (const publicAddress of ['8.8.8.8', '1.2.3.4', '172.32.0.1', '172.15.0.1', '99.86.1.1', 'de1.example.com']) {
  assert.equal(isPrivateNetworkAddress(publicAddress), false, `должен приниматься: ${publicAddress}`);
}

// --- Понятные названия в списке ----------------------------------------------
void (async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-naming-'));
  const cacheFile = path.join(directory, 'geo-cache.json');
  try {
    // Готовый справочник: тест не должен зависеть от сети.
    fs.writeFileSync(cacheFile, JSON.stringify({
      version: 2,
      locale: 'ru',
      entries: {
        'de1.example.com': { code: 'DE', name: 'Германия', flag: '🇩🇪' },
        'de2.example.com': { code: 'DE', name: 'Германия', flag: '🇩🇪' },
        'de3.example.com': { code: 'DE', name: 'Германия', flag: '🇩🇪', city: 'Берлин' },
        'nl1.example.com': { code: 'NL', name: 'Нидерланды', flag: '🇳🇱' },
        'keep.example.com': { code: 'US', name: 'США', flag: '🇺🇸' },
      },
    }));

    const make = (name, server) => ({
      id: name, name, protocol: 'vless', server, port: 443, params: {}, createdAt: '', shareLink: '',
    });

    const located = await applyGeo([
      make('proxy', 'de1.example.com'),
      make('proxy-13', 'de2.example.com'),
      make('proxy-14', 'de3.example.com'),
      make('proxy-17', 'nl1.example.com'),
      make('Мой любимый сервер', 'keep.example.com'),
    ], cacheFile);

    const names = located.map((item) => item.name);
    // Служебные теги заменяются страной, а повторы нумеруются: иначе в списке
    // окажется несколько одинаковых строк «Германия».
    assert.deepEqual(names, [
      'Германия',
      'Германия · 2',
      'Германия · Берлин',
      'Нидерланды',
      'Мой любимый сервер',
    ]);
    assert.equal(new Set(names).size, names.length, 'названия обязаны быть различимы');

    // Страна и флаг проставляются независимо от имени.
    assert.equal(located[0].flag, '🇩🇪');
    assert.equal(located[4].country, 'US', 'страна определяется и для сервера с своим именем');

    console.log('Profile naming checks passed.');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})();
