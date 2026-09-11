const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { inboundListenAddress, isPrivateIpv4, lanAddresses, lanEndpoints } = require(path.join(root, 'dist-electron', 'lan-share.js'));
const { buildXrayConfig } = require(path.join(root, 'dist-electron', 'xray-config.js'));
const { buildSingboxConfig } = require(path.join(root, 'dist-electron', 'singbox-config.js'));
const { DEFAULT_SETTINGS } = require(path.join(root, 'dist-electron', 'types.js'));

// --- Классификация адресов --------------------------------------------------
for (const address of ['10.0.0.5', '192.168.1.42', '172.16.9.9', '172.31.255.1', '100.100.0.1']) {
  assert.equal(isPrivateIpv4(address), true, `${address} должен считаться домашним`);
}
for (const address of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '203.0.113.7', '100.128.0.1']) {
  assert.equal(isPrivateIpv4(address), false, `${address} не должен считаться домашним`);
}

// --- Слушающий адрес входов -------------------------------------------------
assert.equal(inboundListenAddress(false), '127.0.0.1', 'по умолчанию прокси доступен только этому ПК');
assert.equal(inboundListenAddress(true), '0.0.0.0', 'раздача открывает вход на всех интерфейсах');

// --- Перечисление интерфейсов ----------------------------------------------
const interfaces = {
  'Loopback': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  'Wi-Fi': [
    { address: '192.168.1.50', family: 'IPv4', internal: false },
    { address: 'fe80::1', family: 'IPv6', internal: false },
  ],
  'Ethernet': [{ address: '10.0.0.7', family: 'IPv4', internal: false }],
  'VPN-adapter': [{ address: '203.0.113.10', family: 'IPv4', internal: false }],
  'Duplicate': [{ address: '10.0.0.7', family: 'IPv4', internal: false }],
};

assert.deepEqual(lanAddresses(interfaces), [
  { interfaceName: 'Ethernet', address: '10.0.0.7' },
  { interfaceName: 'Wi-Fi', address: '192.168.1.50' },
], 'внутренние, публичные, IPv6 и дубликаты отбрасываются, порядок стабилен');

assert.deepEqual(lanEndpoints(true, 10808, interfaces), [
  { interfaceName: 'Ethernet', address: '10.0.0.7', socks: '10.0.0.7:10808', http: '10.0.0.7:10809' },
  { interfaceName: 'Wi-Fi', address: '192.168.1.50', socks: '192.168.1.50:10808', http: '192.168.1.50:10809' },
]);
assert.deepEqual(lanEndpoints(false, 10808, interfaces), [], 'выключенная раздача не отдаёт адреса');
assert.deepEqual(lanEndpoints(true, 0, interfaces), [], 'некорректный порт не отдаёт адреса');

// --- Конфигурация Xray ------------------------------------------------------
const xrayParams = {
  protocol: 'vless',
  address: 'vpn.example.com',
  port: 443,
  uuid: '00000000-0000-0000-0000-000000000000',
  network: 'tcp',
  security: 'tls',
};

const localXray = buildXrayConfig(xrayParams, 10808, 'proxy', [], 'system', true);
assert.deepEqual(localXray.inbounds.map((item) => item.listen), ['127.0.0.1', '127.0.0.1'], 'по умолчанию Xray слушает только loopback');

const sharedXray = buildXrayConfig(xrayParams, 10808, 'proxy', [], 'system', true, true);
assert.deepEqual(sharedXray.inbounds.map((item) => item.listen), ['0.0.0.0', '0.0.0.0']);
assert.deepEqual(sharedXray.inbounds.map((item) => item.port), [10808, 10809], 'пара портов сохраняется при раздаче');
assert.equal(sharedXray.inbounds[1].settings.allowTransparent, false, 'HTTP-вход не становится прозрачным прокси');

// TUN-вход и фрагментация не ломаются раздачей.
const sharedTun = buildXrayConfig(xrayParams, 10808, 'tun', [], 'system', true, true);
assert.equal(sharedTun.inbounds.length, 3);
assert.equal(sharedTun.inbounds[2].protocol, 'tun');
assert.ok(sharedTun.outbounds.some((item) => item.tag === 'fragment'), 'фрагментация продолжает работать');

// --- Конфигурация sing-box (Hysteria2) --------------------------------------
const hysteriaParams = { protocol: 'hysteria2', address: 'hy.example.com', port: 8443, password: 'secret' };
const localSingbox = buildSingboxConfig(hysteriaParams, 10808, 'proxy', [], 'system');
assert.deepEqual(localSingbox.inbounds.map((item) => item.listen), ['127.0.0.1', '127.0.0.1']);

const sharedSingbox = buildSingboxConfig(hysteriaParams, 10808, 'proxy', [], 'system', true);
assert.deepEqual(sharedSingbox.inbounds.map((item) => item.listen), ['0.0.0.0', '0.0.0.0']);
assert.deepEqual(sharedSingbox.inbounds.map((item) => item.listen_port), [10808, 10809]);

// --- Настройка по умолчанию -------------------------------------------------
assert.equal(DEFAULT_SETTINGS.vpnAllowLan, false, 'раздача выключена по умолчанию — безопасное состояние');

console.log('LAN sharing (Allow LAN) regression checks passed.');
