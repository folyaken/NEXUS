const assert = require('node:assert/strict');
const { buildXrayConfig } = require('../dist-electron/xray-config.js');
const { buildSingboxConfig } = require('../dist-electron/singbox-config.js');
const { normalizeVpnSplitApps } = require('../dist-electron/split-tunnel.js');
const { XRAY_TUN_RELEASE } = require('../dist-electron/github-updater.js');
const { minimumTunVersion, requiredRelease, supportsTunSplit } = require('../scripts/ensure-xray.cjs');

assert.deepEqual(minimumTunVersion, [26, 4, 13]);
assert.equal(requiredRelease, 'v26.7.28');
assert.equal(XRAY_TUN_RELEASE, requiredRelease);
assert.equal(supportsTunSplit([26, 4, 12]), false);
assert.equal(supportsTunSplit([26, 4, 13]), true);
assert.equal(supportsTunSplit([26, 7, 28]), true);

const apps = [
  { executable: 'untrusted.exe', path: 'C:\\Program Files\\Google\\Chrome\\chrome.exe' },
  { executable: 'Code.exe', path: 'C:\\Users\\Tester\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe' },
  { executable: 'duplicate.exe', path: 'D:\\Portable\\CHROME.EXE' },
  { executable: 'bad.exe', path: 'relative\\bad.exe' },
];
const normalized = normalizeVpnSplitApps(apps);
assert.deepEqual(normalized, [
  { executable: 'chrome.exe', path: 'C:\\Program Files\\Google\\Chrome\\chrome.exe' },
  { executable: 'Code.exe', path: 'C:\\Users\\Tester\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe' },
]);

const base = {
  protocol: 'vless',
  address: 'vpn.example.com',
  port: 443,
  uuid: '00000000-0000-0000-0000-000000000000',
};

const xray = buildXrayConfig(base, 10808, 'tun', normalized);
const xrayTun = xray.inbounds.find((item) => item.tag === 'tun-in');
assert.ok(xrayTun, 'Xray TUN inbound is generated');
assert.deepEqual(xrayTun.settings.autoSystemRoutingTable, ['0.0.0.0/0', '::/0']);
assert.equal(xrayTun.settings.autoOutboundsInterface, 'auto');
assert.equal(xrayTun.settings.autoRoute, undefined, 'obsolete sing-box field is not emitted for Xray');
assert.deepEqual(xray.routing.rules[1], {
  type: 'field',
  inboundTag: ['tun-in'],
  process: [
    'chrome',
    'C:/Program Files/Google/Chrome/chrome.exe',
    'Code',
    'C:/Users/Tester/AppData/Local/Programs/Microsoft VS Code/Code.exe',
  ],
  outboundTag: 'proxy',
});
assert.equal(xray.routing.rules[2].outboundTag, 'direct', 'unselected TUN traffic is direct');

const xrayAll = buildXrayConfig(base, 10808, 'tun');
assert.equal(xrayAll.routing, undefined, 'regular TUN keeps the proxy as default outbound');
const xrayProxy = buildXrayConfig(base, 10808, 'proxy', normalized);
assert.equal(xrayProxy.inbounds.some((item) => item.tag === 'tun-in'), false);
assert.equal(xrayProxy.routing, undefined, 'split selectors are ignored in Proxy mode');

const singbox = buildSingboxConfig({ ...base, protocol: 'hysteria2', password: 'secret' }, 10808, 'tun', normalized);
assert.ok(singbox.inbounds.some((item) => item.tag === 'tun-in'));
assert.equal(singbox.outbounds[0].tag, 'proxy');
assert.equal(singbox.outbounds[1].tag, 'direct');
assert.deepEqual(singbox.route.rules[0].process_name, ['chrome.exe', 'Code.exe']);
assert.deepEqual(singbox.route.rules[1].process_path, normalized.map((app) => app.path));
assert.equal(singbox.route.rules.at(-1).outbound, 'direct', 'unselected Hysteria TUN traffic is direct');
assert.equal(singbox.route.final, 'proxy');

const singboxAll = buildSingboxConfig({ ...base, protocol: 'hysteria2', password: 'secret' }, 10808, 'tun');
assert.deepEqual(singboxAll.route.rules, []);
assert.equal(singboxAll.route.final, 'proxy');

console.log('split-tunnel config tests: ok');
