const assert = require('node:assert/strict');
const { buildXrayConfig } = require('../dist-electron/xray-config.js');
const { buildSingboxConfig } = require('../dist-electron/singbox-config.js');
const { normalizeVpnSplitApps, resolveVpnAppRouting } = require('../dist-electron/split-tunnel.js');
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
assert.equal(resolveVpnAppRouting(undefined, true, 'tun', normalized), 'include', 'patch 09 split setting is migrated');
assert.equal(resolveVpnAppRouting('exclude', false, 'tun', normalized), 'exclude');
assert.equal(resolveVpnAppRouting('system', true, 'tun', normalized), 'system', 'explicit system mode wins over legacy data');
assert.equal(resolveVpnAppRouting('include', true, 'proxy', normalized), 'system', 'Proxy cannot activate process routing');
assert.equal(resolveVpnAppRouting('include', true, 'tun', []), 'system', 'an empty app list disables process routing');

const base = {
  protocol: 'vless',
  address: 'vpn.example.com',
  port: 443,
  uuid: '00000000-0000-0000-0000-000000000000',
  network: 'tcp',
  security: 'tls',
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
const xrayProxyOutbound = xray.outbounds.find((item) => item.tag === 'proxy');
const xrayFragmentOutbound = xray.outbounds.find((item) => item.tag === 'fragment');
assert.equal(xrayProxyOutbound.streamSettings.sockopt.dialerProxy, 'fragment', 'TCP/TLS connects through the fragment outbound by default');
assert.deepEqual(xrayFragmentOutbound, {
  tag: 'fragment',
  protocol: 'freedom',
  settings: { fragment: { packets: 'tlshello', length: '50-100', interval: '10-20' } },
});

const xrayWithoutFragmentation = buildXrayConfig(base, 10808, 'proxy', [], 'system', false);
assert.equal(xrayWithoutFragmentation.outbounds.some((item) => item.tag === 'fragment'), false, 'the setting must remove the fragment outbound');
assert.equal(xrayWithoutFragmentation.outbounds[0].streamSettings.sockopt, undefined, 'the setting must remove the fragment dialer');
const xrayReality = buildXrayConfig({ ...base, security: 'reality', publicKey: 'test-key' }, 10808);
assert.equal(xrayReality.outbounds[0].streamSettings.sockopt.dialerProxy, 'fragment', 'TCP/Reality must use TLSHello fragmentation');
const xrayXtls = buildXrayConfig({ ...base, security: 'xtls' }, 10808);
assert.equal(xrayXtls.outbounds[0].streamSettings.sockopt.dialerProxy, 'fragment', 'legacy TCP/XTLS profiles must use TLSHello fragmentation');
const xrayWebSocket = buildXrayConfig({ ...base, network: 'ws' }, 10808);
assert.equal(xrayWebSocket.outbounds.some((item) => item.tag === 'fragment'), false, 'non-TCP Xray transports are not sent to the TLSHello fragment dialer');
assert.equal(xrayWebSocket.outbounds[0].streamSettings.sockopt, undefined);
const xrayPlainTcp = buildXrayConfig({ ...base, security: 'none' }, 10808);
assert.equal(xrayPlainTcp.outbounds.some((item) => item.tag === 'fragment'), false, 'plain TCP without TLS has no ClientHello to fragment');

const xrayExcluded = buildXrayConfig(base, 10808, 'tun', normalized, 'exclude');
assert.equal(xrayExcluded.routing.rules[1].outboundTag, 'direct', 'excluded Xray apps bypass the VPN');
assert.equal(xrayExcluded.routing.rules[2].outboundTag, 'proxy', 'other Xray TUN traffic stays on VPN');
assert.deepEqual(xrayExcluded.routing.rules[1].process, xray.routing.rules[1].process);

const xrayAll = buildXrayConfig(base, 10808, 'tun');
assert.equal(xrayAll.routing, undefined, 'regular TUN keeps the proxy as default outbound');
const xraySystemWithApps = buildXrayConfig(base, 10808, 'tun', normalized, 'system');
assert.equal(xraySystemWithApps.routing, undefined, 'system routing ignores a saved application list');
const xrayProxy = buildXrayConfig(base, 10808, 'proxy', normalized, 'exclude');
assert.equal(xrayProxy.inbounds.some((item) => item.tag === 'tun-in'), false);
assert.equal(xrayProxy.routing, undefined, 'application selectors are ignored in Proxy mode');

const singbox = buildSingboxConfig({ ...base, protocol: 'hysteria2', password: 'secret' }, 10808, 'tun', normalized);
assert.ok(singbox.inbounds.some((item) => item.tag === 'tun-in'));
assert.equal(singbox.outbounds[0].tag, 'proxy');
assert.equal(singbox.outbounds[1].tag, 'direct');
assert.deepEqual(singbox.route.rules[0].process_name, ['chrome.exe', 'Code.exe']);
assert.deepEqual(singbox.route.rules[1].process_path, normalized.map((app) => app.path));
assert.equal(singbox.route.rules.at(-1).outbound, 'direct', 'unselected Hysteria TUN traffic is direct');
assert.equal(singbox.route.final, 'proxy');

const singboxExcluded = buildSingboxConfig(
  { ...base, protocol: 'hysteria2', password: 'secret' },
  10808,
  'tun',
  normalized,
  'exclude',
);
assert.equal(singboxExcluded.route.rules[0].outbound, 'direct', 'excluded sing-box apps bypass the VPN');
assert.equal(singboxExcluded.route.rules[1].outbound, 'direct');
assert.equal(singboxExcluded.route.rules.at(-1).outbound, 'proxy', 'other sing-box TUN traffic stays on VPN');
assert.equal(singboxExcluded.route.final, 'proxy');

const singboxAll = buildSingboxConfig({ ...base, protocol: 'hysteria2', password: 'secret' }, 10808, 'tun');
assert.deepEqual(singboxAll.route.rules, []);
assert.equal(singboxAll.route.final, 'proxy');
const singboxSystemWithApps = buildSingboxConfig(
  { ...base, protocol: 'hysteria2', password: 'secret' },
  10808,
  'tun',
  normalized,
  'system',
);
assert.deepEqual(singboxSystemWithApps.route.rules, []);

console.log('split-tunnel config tests: ok');
