const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { extractJsonProfiles } = require(path.join(root, 'dist-electron', 'subscription-parser.js'));

// Панель отдала конфигурацию (HTTP 200, 13 466 символов), но профилей
// получилось ноль. Причина: это формат самого ядра Xray, где сервер описан не
// одним объектом, а вложенными — адрес в settings.vnext, транспорт в
// streamSettings. Разбор искал адрес рядом с протоколом и ничего не находил.

const XRAY_JSON = JSON.stringify({
  log: { loglevel: 'warning' },
  inbounds: [{ port: 10808, protocol: 'socks' }],
  outbounds: [
    {
      tag: 'Reality',
      protocol: 'vless',
      settings: {
        vnext: [{
          address: 'de1.example.com',
          port: 443,
          users: [{ id: '11111111-2222-3333-4444-555555555555', encryption: 'none', flow: 'xtls-rprx-vision' }],
        }],
      },
      streamSettings: {
        network: 'tcp',
        security: 'reality',
        realitySettings: { serverName: 'www.google.com', publicKey: 'abcdef', fingerprint: 'chrome', shortId: 'aa' },
      },
    },
    {
      tag: 'WS',
      protocol: 'vless',
      settings: { vnext: [{ address: 'ws.example.com', port: 8443, users: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', encryption: 'none' }] }] },
      streamSettings: {
        network: 'ws',
        security: 'tls',
        tlsSettings: { serverName: 'ws.example.com', alpn: ['h2', 'http/1.1'] },
        wsSettings: { path: '/vpn', headers: { Host: 'ws.example.com' } },
      },
    },
    {
      tag: 'Trojan',
      protocol: 'trojan',
      settings: { servers: [{ address: 'tr.example.com', port: 443, password: 'secretpass' }] },
      streamSettings: { network: 'tcp', security: 'tls', tlsSettings: { serverName: 'tr.example.com' } },
    },
    {
      tag: 'SS',
      protocol: 'shadowsocks',
      settings: { servers: [{ address: 'ss.example.com', port: 8388, method: 'aes-256-gcm', password: 'sspass' }] },
    },
    { tag: 'gRPC', protocol: 'vmess',
      settings: { vnext: [{ address: 'g.example.com', port: 443, users: [{ id: '11111111-1111-1111-1111-111111111111', alterId: 0 }] }] },
      streamSettings: { network: 'grpc', security: 'tls', grpcSettings: { serviceName: 'gsvc' }, tlsSettings: { serverName: 'g.example.com' } } },
    // Служебные выходы — это не серверы и профилями становиться не должны.
    { protocol: 'freedom', tag: 'direct' },
    { protocol: 'blackhole', tag: 'block' },
  ],
});

const profiles = extractJsonProfiles(XRAY_JSON);
assert.equal(profiles.length, 5, 'из конфигурации Xray обязаны получиться все серверы');

const byName = new Map(profiles.map((item) => [item.name, item]));

// --- Reality --------------------------------------------------------------
// Без этих полей подключение к Reality не состоится: ядро откажет.
const reality = byName.get('Reality');
assert.ok(reality, 'сервер Reality обязан быть разобран');
assert.equal(reality.protocol, 'vless');
assert.equal(reality.server, 'de1.example.com');
assert.equal(reality.port, 443);
assert.equal(reality.params.security, 'reality', 'шифрование Reality не должно теряться');
assert.equal(reality.params.sni, 'www.google.com');
assert.equal(reality.params.publicKey, 'abcdef');
assert.equal(reality.params.shortId, 'aa');
assert.equal(reality.params.fingerprint, 'chrome');
assert.equal(reality.params.flow, 'xtls-rprx-vision');
assert.equal(reality.params.uuid, '11111111-2222-3333-4444-555555555555');

// --- WebSocket ------------------------------------------------------------
const ws = byName.get('WS');
assert.equal(ws.params.network, 'ws');
assert.equal(ws.params.security, 'tls');
assert.equal(ws.params.path, '/vpn');
assert.equal(ws.params.host, 'ws.example.com', 'заголовок Host нужен для маскировки соединения');

// --- Trojan и Shadowsocks: учётные данные лежат прямо в описании сервера ---
const trojan = byName.get('Trojan');
assert.equal(trojan.protocol, 'trojan');
assert.equal(trojan.params.password, 'secretpass');

const shadowsocks = byName.get('SS');
assert.equal(shadowsocks.protocol, 'shadowsocks');
assert.equal(shadowsocks.params.method, 'aes-256-gcm');
assert.equal(shadowsocks.params.password, 'sspass');

// --- gRPC -----------------------------------------------------------------
const grpc = byName.get('gRPC');
assert.equal(grpc.protocol, 'vmess');
assert.equal(grpc.params.network, 'grpc');
assert.equal(grpc.params.serviceName, 'gsvc');

// Служебные выходы профилями не становятся.
assert.equal(profiles.some((item) => ['direct', 'block'].includes(item.name)), false);

// --- Слитная запись полей ---------------------------------------------------
// Xray и sing-box пишут поля слитно (streamSettings, serverName). Раньше такие
// имена не распознавались, и профиль молча терял шифрование и транспорт.
const camel = extractJsonProfiles(JSON.stringify({
  outbounds: [{
    protocol: 'vless',
    settings: { vnext: [{ address: 'c.example.com', port: 443, users: [{ id: '22222222-3333-4444-5555-666666666666' }] }] },
    streamSettings: { network: 'tcp', security: 'reality', realitySettings: { serverName: 'a.com', publicKey: 'k' } },
  }],
}));
assert.equal(camel.length, 1);
assert.equal(camel[0].params.security, 'reality');
assert.equal(camel[0].params.sni, 'a.com');

// Прежний плоский формат (Clash и подобные) обязан работать по-прежнему.
const flat = extractJsonProfiles(JSON.stringify({
  proxies: [{ name: 'Flat', type: 'vless', server: 'f.example.com', port: 443, uuid: '33333333-4444-5555-6666-777777777777', tls: true, servername: 'f.example.com' }],
}));
assert.equal(flat.length, 1);
assert.equal(flat[0].server, 'f.example.com');
assert.equal(flat[0].params.security, 'tls');

// Мусор и незакрытые конструкции не должны валить разбор.
assert.deepEqual(extractJsonProfiles('{"outbounds":[{"protocol":"vless","settings":{"vnext":[]}}]}'), []);
assert.deepEqual(extractJsonProfiles('не json'), []);

console.log('Xray JSON subscription checks passed.');
