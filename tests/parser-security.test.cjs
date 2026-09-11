const assert = require('node:assert/strict');
const {
  PROFILE_PARSER_LIMITS,
  ProfileParseError,
  createProfileFromLink,
  extractShareLinks,
  normalizeProfileAddress,
  parseProfilePort,
  parseShareLink,
  sanitizeProfileName,
} = require('../dist-electron/share-link.js');
const {
  extractClashProfiles,
  extractJsonProfiles,
} = require('../dist-electron/subscription-parser.js');

const UUID = '00000000-0000-4000-8000-000000000001';
const base64 = (value) => Buffer.from(value, 'utf8').toString('base64');
const base64url = (value) => Buffer.from(value, 'utf8').toString('base64url');

function rejectedLink(link, message) {
  let error;
  try {
    parseShareLink(link);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof ProfileParseError, message || `${link.slice(0, 24)} must be rejected`);
  assert.equal(error.message.includes(link), false, 'parser errors must never repeat the source link');
  return error.message;
}

const reality = createProfileFromLink(
  `vless://${UUID}@reality.example.com:443?encryption=none&security=reality&type=grpc&sni=edge.example.com&fp=chrome&pbk=public-key&sid=abcd&serviceName=nexus#Reality%20GRPC`,
);
assert.equal(reality.name, 'Reality GRPC');
assert.equal(reality.protocol, 'vless');
assert.equal(reality.server, 'reality.example.com');
assert.equal(reality.port, 443);
assert.equal(reality.params.network, 'grpc');
assert.equal(reality.params.security, 'reality');
assert.equal(reality.params.sni, 'edge.example.com');
assert.equal(reality.params.publicKey, 'public-key');
assert.equal(reality.params.shortId, 'abcd');
assert.equal(reality.params.serviceName, 'nexus');

const websocket = createProfileFromLink(
  `vless://${UUID}@ws.example.com:8443?encryption=none&security=tls&type=ws&sni=ws.example.com&host=cdn.example.com&path=%2Fsocket#WebSocket`,
);
assert.equal(websocket.params.network, 'ws');
assert.equal(websocket.params.host, 'cdn.example.com');
assert.equal(websocket.params.path, '/socket');

const trojan = createProfileFromLink(
  'trojan://p%40ss%3Aword@trojan.example.com:443?security=tls&type=tcp&sni=trojan.example.com#Trojan',
);
assert.equal(trojan.params.password, 'p@ss:word');
assert.equal(trojan.params.security, 'tls');

const vmessData = {
  v: '2',
  ps: 'VMess WS',
  add: 'vmess.example.com',
  port: '443',
  id: UUID,
  aid: '0',
  scy: 'auto',
  net: 'ws',
  type: 'none',
  host: 'cdn.example.com',
  path: '/vmess',
  tls: 'tls',
  sni: 'vmess.example.com',
};
const vmess = createProfileFromLink(`vmess://${base64(JSON.stringify(vmessData))}`);
assert.equal(vmess.name, 'VMess WS');
assert.equal(vmess.params.uuid, UUID);
assert.equal(vmess.params.network, 'ws');
assert.equal(vmess.params.security, 'tls');
assert.equal(vmess.params.encryption, 'auto');

const sip002 = createProfileFromLink(
  `ss://${base64url('aes-256-gcm:p%ss')}@ss.example.com:8388#SIP002`,
);
assert.equal(sip002.params.method, 'aes-256-gcm');
assert.equal(sip002.params.password, 'p%ss', 'base64-decoded credentials must not be URL-decoded twice');
assert.equal(sip002.port, 8388);

const plainSs = createProfileFromLink('ss://aes-128-gcm:p%2540ss@plain.example.com:8389#Plain');
assert.equal(plainSs.params.password, 'p%40ss', 'plain SIP002 credentials are URL-decoded exactly once');

const fullSs = createProfileFromLink(
  `ss://${base64url('chacha20-ietf-poly1305:secret@[2001:4860:4860::8888]:443')}#IPv6`,
);
assert.equal(fullSs.server, '2001:4860:4860::8888');
assert.equal(fullSs.port, 443);
assert.equal(fullSs.params.password, 'secret');

const hysteria = createProfileFromLink(
  'hy2://hy%40pass@hy.example.com:443?sni=edge.example.com&obfs=salamander&obfs-password=cover#Hysteria2',
);
assert.equal(hysteria.protocol, 'hysteria2');
assert.equal(hysteria.params.password, 'hy@pass');
assert.equal(hysteria.params.network, 'hysteria2');
assert.equal(hysteria.params.sni, 'edge.example.com');
assert.equal(hysteria.params.obfs, 'cover');

const wrappedSubscription = base64([
  `vless://${UUID}@one.example.com:443?security=tls#One`,
  'trojan://secret@two.example.com:443?security=tls#Two',
].join('\n')).replace(/(.{64})/g, '$1\n');
assert.equal(extractShareLinks(wrappedSubscription).length, 2, 'wrapped Base64 subscriptions remain supported');

const clashYaml = `
proxies:
  - {name: "Inline SS", type: ss, server: ss.example.com, port: 8388, cipher: aes-256-gcm, password: "p:a"}
  - name: Reality VLESS
    type: vless
    server: reality.example.com
    port: 443
    uuid: ${UUID}
    network: grpc
    tls: true
    servername: edge.example.com
    reality-opts: {public-key: reality-key, short-id: abcd}
    grpc-opts: {grpc-service-name: nexus}
`;
const clashProfiles = extractClashProfiles(clashYaml);
assert.equal(clashProfiles.length, 2);
assert.equal(clashProfiles[0].protocol, 'shadowsocks');
assert.equal(clashProfiles[0].params.password, 'p:a');
assert.equal(clashProfiles[1].protocol, 'vless');
assert.equal(clashProfiles[1].params.security, 'reality');
assert.equal(clashProfiles[1].params.publicKey, 'reality-key');
assert.equal(clashProfiles[1].params.serviceName, 'nexus');
assert.equal(clashProfiles[1].shareLink.includes(UUID), false, 'derived config links must not copy credentials');

const singBoxJson = JSON.stringify({
  outbounds: [{
    type: 'vless',
    tag: 'Sing-box Reality',
    server: 'sing.example.com',
    server_port: 443,
    uuid: UUID,
    tls: {
      enabled: true,
      server_name: 'sing.example.com',
      utls: { fingerprint: 'chrome' },
      reality: { enabled: true, public_key: 'sing-public-key', short_id: '1234' },
    },
    transport: { type: 'ws', path: '/sing', headers: { Host: 'cdn.example.com' } },
  }],
});
const jsonProfiles = extractJsonProfiles(singBoxJson);
assert.equal(jsonProfiles.length, 1);
assert.equal(jsonProfiles[0].name, 'Sing-box Reality');
assert.equal(jsonProfiles[0].params.security, 'reality');
assert.equal(jsonProfiles[0].params.network, 'ws');
assert.equal(jsonProfiles[0].params.host, 'cdn.example.com');
assert.equal(jsonProfiles[0].params.fingerprint, 'chrome');
assert.equal(jsonProfiles[0].params.publicKey, 'sing-public-key');

for (const malformed of [
  'vmess://!!!!',
  'vmess://YQ=',
  'vmess://ab-_+/',
  `vmess://${Buffer.from([0xff]).toString('base64')}`,
  `vmess://${base64('null')}`,
  `vmess://${base64(JSON.stringify({ add: 'vm.example.com', port: 443, id: 'not-a-uuid' }))}`,
  `vmess://${base64(JSON.stringify({ add: 'vm.example.com', port: '1e3', id: UUID }))}`,
  `vless://${UUID}@missing-port.example.com?security=tls`,
  `vless://not-a-uuid@bad.example.com:443?security=tls`,
  `vless://${UUID}@bad.example.com:0?security=tls`,
  `vless://${UUID}@bad.example.com:443?type=unsupported`,
  `vless://${UUID}@bad.example.com:443?security=reality`,
  `vless://${UUID}@bad.example.com:443?security=tls&security=none`,
  `vless://${UUID}@bad.example.com:443?security=tls&type=ws&network=grpc`,
  `trojan://user:password@bad.example.com:443?security=tls`,
  'trojan://secret@bad.example.com:443?path=%ZZ',
  'trojan://secret@bad.example.com:443?path=%FF',
  'ss://YWVzLTEyOC1nY206cGFzcw@missing-port.example.com',
  'ss://YWVzLTEyOC1nY206cGFzcw@bad.example.com:8388/extra',
  'ss://not-base64@bad.example.com:8388',
  'hysteria2://user:password@bad.example.com:443',
]) rejectedLink(malformed);

const secret = 'DO-NOT-LEAK-THIS-CREDENTIAL';
const secretError = rejectedLink(`trojan://${secret}@bad.example.com:not-a-port?security=tls`);
assert.equal(secretError.includes(secret), false, 'credentials must not be copied into parser errors');
rejectedLink(`vless://${UUID}@bad.example.com:443?${Array.from({ length: 65 }, (_, index) => `p${index}=x`).join('&')}`);
rejectedLink(`vless://${UUID}@bad.example.com:443?security=tls\nsecret=${secret}`);

const cleanedName = createProfileFromLink(
  `vless://${UUID}@name.example.com:443?security=tls#Line%00Break`,
).name;
assert.equal(cleanedName, 'Line Break');
assert.equal(sanitizeProfileName(`  A\u0000\n B  `, 'fallback'), 'A B');
assert.throws(() => normalizeProfileAddress('[example.com'), ProfileParseError);
assert.throws(() => normalizeProfileAddress('[example.com]'), ProfileParseError);
assert.throws(() => normalizeProfileAddress(1234), ProfileParseError);
assert.throws(() => parseProfilePort('1e3'), ProfileParseError);
assert.throws(() => parseProfilePort(true), ProfileParseError);

const aliasBomb = `
proxies:
  - &node {name: Alias, type: ss, server: alias.example.com, port: 8388, cipher: aes-128-gcm, password: secret}
  - *node
`;
assert.deepEqual(extractClashProfiles(aliasBomb), [], 'YAML aliases are rejected instead of expanded');
assert.deepEqual(extractClashProfiles(`proxies:\n  - {name: one, name: two, type: ss, server: x.example.com, port: 1, cipher: aes-128-gcm, password: p}`), [], 'duplicate YAML keys are rejected');

let deepJson = {
  type: 'ss',
  server: 'deep.example.com',
  server_port: 8388,
  method: 'aes-128-gcm',
  password: 'secret',
};
for (let index = 0; index < PROFILE_PARSER_LIMITS.maxJsonDepth + 5; index += 1) deepJson = { nodes: [deepJson] };
assert.deepEqual(extractJsonProfiles(JSON.stringify(deepJson)), [], 'JSON traversal is bounded by depth');

let deepYaml = '  - {name: deep, type: ss, server: deep.example.com, port: 8388, cipher: aes-128-gcm, password: p}';
for (let index = 0; index < PROFILE_PARSER_LIMITS.maxJsonDepth + 5; index += 1) deepYaml = `nodes:\n${deepYaml.split('\n').map((line) => `  ${line}`).join('\n')}`;
assert.deepEqual(extractClashProfiles(deepYaml), [], 'YAML conversion is bounded by AST depth');

const excessiveKeys = { type: 'ss', server: 'wide.example.com', server_port: 8388, method: 'aes-128-gcm', password: 'p' };
for (let index = 0; index < 300; index += 1) excessiveKeys[`extra_${index}`] = index;
assert.deepEqual(extractJsonProfiles(JSON.stringify([excessiveKeys])), [], 'excessively wide profile objects are skipped');
assert.deepEqual(extractJsonProfiles(JSON.stringify([{
  type: 'ss',
  server: ['one.example.com', 'two.example.com'],
  server_port: [8388, 8389],
  method: 'aes-128-gcm',
  password: 'secret',
}])), [], 'arrays are not accepted in scalar address and port fields');
assert.deepEqual(extractJsonProfiles(JSON.stringify([{
  type: 'ss',
  server: 'ambiguous.example.com',
  server_port: 8388,
  'server-port': 8389,
  method: 'aes-128-gcm',
  password: 'secret',
}])), [], 'keys that normalize to the same field are rejected');
assert.deepEqual(
  extractJsonProfiles('[{"type":"ss","server":"one.example.com","server":"two.example.com","server_port":8388,"method":"aes-128-gcm","password":"secret"}]'),
  [],
  'duplicate JSON keys are rejected',
);

const manyLinks = Array.from(
  { length: PROFILE_PARSER_LIMITS.maxExtractedLinks + 10 },
  (_, index) => `vless://${UUID}@node-${index}.example.com:443?security=tls#Node-${index}`,
).join('\n');
assert.equal(extractShareLinks(manyLinks).length, PROFILE_PARSER_LIMITS.maxExtractedLinks);

const manyProfiles = Array.from(
  { length: PROFILE_PARSER_LIMITS.maxProfiles + 10 },
  (_, index) => ({
    type: 'ss',
    name: `Node ${index}`,
    server: `node-${index}.example.com`,
    server_port: 8388,
    method: 'aes-128-gcm',
    password: 'secret',
  }),
);
assert.equal(extractJsonProfiles(JSON.stringify(manyProfiles)).length, PROFILE_PARSER_LIMITS.maxProfiles);

const oversized = 'x'.repeat(PROFILE_PARSER_LIMITS.maxPayloadChars + 1);
assert.deepEqual(extractShareLinks(oversized), []);
assert.deepEqual(extractClashProfiles(oversized), []);
assert.deepEqual(extractJsonProfiles(`["${oversized}"]`), []);

console.log('parser security tests: ok');
