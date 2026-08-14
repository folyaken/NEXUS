const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { VpnManager } = require(path.join(root, 'dist-electron', 'vpn-manager.js'));

const manager = new VpnManager(path.join(os.tmpdir(), `nexus-mode-session-${process.pid}`));
manager.setState('connected', 'profile-a', 1234);
const firstRuntime = manager.runtime();
assert.match(firstRuntime.connectedAt, /^\d{4}-\d{2}-\d{2}T/, 'a connected runtime must publish its session start');

const continuedAt = '2026-08-14T09:10:11.000Z';
manager.setState('connected', 'profile-a', 4321, undefined, continuedAt);
assert.equal(manager.runtime().connectedAt, continuedAt, 'an automatic mode reconnect must preserve the session start');
manager.setState('disconnected', null, null);
assert.equal(manager.runtime().connectedAt, null, 'disconnect must end the session counter');
manager.setState('error', 'profile-a', null, 'test');
assert.equal(manager.runtime().connectedAt, null, 'a failed connection must not retain an active session');

const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const switchStart = main.indexOf("ipcMain.handle('vpn:switch-mode'");
const switchEnd = main.indexOf("ipcMain.handle('vpn:ensure-core'", switchStart);
assert.ok(switchStart > 0 && switchEnd > switchStart, 'main process must register the live mode switch IPC');
const switchHandler = main.slice(switchStart, switchEnd);
assert.match(switchHandler, /requestedMode !== 'proxy' && requestedMode !== 'tun'/);
assert.match(switchHandler, /await saveSettings\(\{/);
assert.match(switchHandler, /vpnMode: requestedMode/);
assert.match(switchHandler, /vpnSplitTunnel: requestedMode === 'tun'/);
assert.match(switchHandler, /current\.status !== 'connected' \|\| !current\.activeProfileId/);
assert.match(switchHandler, /current\.connectedAt/);
assert.ok(switchHandler.indexOf('await saveSettings') < switchHandler.indexOf('return vpn.connect'), 'the selected mode must be durable before reconnect');

const preload = fs.readFileSync(path.join(root, 'src', 'main', 'preload.ts'), 'utf8');
const env = fs.readFileSync(path.join(root, 'src', 'renderer', 'env.d.ts'), 'utf8');
const types = fs.readFileSync(path.join(root, 'src', 'main', 'types.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');

assert.match(preload, /switchVpnMode: \(mode: 'proxy' \| 'tun'\)/);
assert.match(env, /switchVpnMode\(mode: 'proxy' \| 'tun'\): Promise<VpnRuntime>/);
assert.match(types, /connectedAt: string \| null/);
assert.match(page, /const selectConnectionMode = async/);
assert.match(page, /await window\.nexus\?\.switchVpnMode\(next\)/);
assert.match(page, /disabled=\{busy \|\| runtime\.status === 'connecting'\}/, 'connected VPN must not disable the PROXY/TUN buttons');
assert.match(page, /setInterval\(\(\) => setSessionNow\(Date\.now\(\)\), 1000\)/);
assert.match(page, /<span className="power-session">/);
assert.match(page, /formatSessionDuration\(runtime\.connectedAt, sessionNow\)/);
assert.doesNotMatch(page, /<PingSparkline|className="tunnel-ping"/);
assert.match(styles, /\.power-session b/);
assert.doesNotMatch(styles, /\.tunnel-ping/);

console.log('Live VPN mode switching and session counter regression checks passed.');
