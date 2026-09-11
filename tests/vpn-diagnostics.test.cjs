const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { createVpnDiagnostics, sanitizeDiagnosticText } = require(path.join(root, 'dist-electron', 'vpn-diagnostics.js'));

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const raw = [
  `vless://${uuid}@vpn.example.com:443?token=top-secret`,
  'https://provider.example.com/subscriptions/customer-token?token=query-secret',
  `"password": "hunter2" uuid=${uuid} publicKey=public-secret shortId=abc123`,
  'Authorization: Bearer abc.def.ghi',
  'C:\\Users\\Alice\\AppData\\Roaming\\NEXUS',
].join(' | ');
const sanitized = sanitizeDiagnosticText(raw);

for (const secret of ['top-secret', 'customer-token', 'query-secret', 'hunter2', uuid, 'public-secret', 'abc123', 'abc.def.ghi', 'Alice']) {
  assert.equal(sanitized.includes(secret), false, `diagnostic sanitizer leaked ${secret}`);
}
assert.match(sanitized, /vless:\/\/\[скрыто\]/);
assert.match(sanitized, /https:\/\/provider\.example\.com\/…/);
assert.match(sanitized, /C:\\Users\\\[пользователь\]/);
assert.ok(sanitizeDiagnosticText('x'.repeat(800)).length <= 500, 'diagnostic text must be bounded');

const snapshot = createVpnDiagnostics({
  generatedAt: '2026-08-14T12:00:00.000Z',
  overall: 'warning',
  headline: 'Подключение требует внимания',
  runtimeStatus: 'connected',
  mode: 'proxy',
  engine: 'Xray-core',
  profileName: `Office ${uuid}`,
  protocol: 'vless',
  endpoint: 'vpn.example.com:443',
  localSocks: '127.0.0.1:10808',
  localHttp: '127.0.0.1:10809',
  checks: [{
    id: 'bad id <>',
    title: 'Профиль',
    tone: 'warning',
    summary: 'Нужна проверка',
    detail: 'password=hunter2 https://provider.example.com/subscriptions/customer-token',
  }],
  events: [{
    timestamp: '2026-08-14T11:59:00.000Z',
    level: 'error',
    message: `failed vless://${uuid}@vpn.example.com:443 token=event-secret`,
  }],
});

assert.equal(snapshot.checks[0].id, 'badid');
assert.equal(snapshot.events.length, 1);
assert.match(snapshot.report, /NEXUS · безопасная диагностика Jey2Ray/);
assert.match(snapshot.report, /Секреты подключения, UUID, пароли и URL подписок/);
for (const secret of [uuid, 'hunter2', 'customer-token', 'event-secret']) {
  assert.equal(JSON.stringify(snapshot).includes(secret), false, `diagnostic snapshot leaked ${secret}`);
}
for (const forbidden of ['shareLink', 'subscriptionUrl', 'password', 'uuid', 'params']) {
  assert.equal(Object.hasOwn(snapshot, forbidden), false, `diagnostic snapshot exposes ${forbidden}`);
}

const manager = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');
const diagnosticsMethod = manager.slice(manager.indexOf('async diagnostics('), manager.indexOf('async disconnect()', manager.indexOf('async diagnostics(')));
assert.ok(diagnosticsMethod.length > 1000, 'diagnostics method missing');
for (const unsafeAccess of ['profile.shareLink', 'profile.subscriptionUrl', 'profile.params', 'subscriptions.values']) {
  assert.equal(diagnosticsMethod.includes(unsafeAccess), false, `diagnostics reads secret source: ${unsafeAccess}`);
}
assert.match(diagnosticsMethod, /probeTcp\('127\.0\.0\.1'/);
assert.match(diagnosticsMethod, /processAlive/);
assert.match(diagnosticsMethod, /mode === 'tun'/);
assert.match(diagnosticsMethod, /createVpnDiagnostics/);

const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src', 'main', 'preload.ts'), 'utf8');
const env = fs.readFileSync(path.join(root, 'src', 'renderer', 'env.d.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src', 'renderer', 'ConnectionDiagnostics.tsx'), 'utf8');
const jey = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');

assert.match(main, /ipcMain\.handle\('vpn:diagnostics'/);
assert.match(preload, /getVpnDiagnostics:/);
assert.match(env, /getVpnDiagnostics\(profileId\?: string \| null\): Promise<VpnDiagnostics>/);
assert.match(page, /snapshot\.report/);
assert.match(page, /Скопировать отчёт/);
assert.doesNotMatch(page, /JSON\.stringify\(snapshot/);
assert.match(jey, /className="diagnostics-entry"/);
assert.match(jey, /<ConnectionDiagnostics/);
assert.match(styles, /\.diagnostics-overview\.ok/);
assert.match(styles, /\.diagnostics-check-list/);

void (async () => {
  const { VpnManager } = require(path.join(root, 'dist-electron', 'vpn-manager.js'));
  const managerInstance = new VpnManager(path.join(root, '.diagnostics-test-runtime'));
  managerInstance.profiles.set('diagnostic-profile', {
    id: 'diagnostic-profile',
    name: 'Тестовый сервер',
    protocol: 'vless',
    server: '127.0.0.1',
    port: 1,
    shareLink: `vless://${uuid}@127.0.0.1:1?token=manager-secret`,
    subscriptionUrl: 'https://provider.example.com/subscriptions/manager-token',
    params: { protocol: 'vless', address: '127.0.0.1', port: 1, uuid },
    createdAt: '2026-08-14T12:00:00.000Z',
  });
  const managerSnapshot = await managerInstance.diagnostics('diagnostic-profile', 'proxy');
  for (const secret of [uuid, 'manager-secret', 'manager-token']) {
    assert.equal(JSON.stringify(managerSnapshot).includes(secret), false, `manager diagnostics leaked ${secret}`);
  }
  assert.equal(managerSnapshot.profileName, 'Тестовый сервер');
  assert.equal(managerSnapshot.endpoint, '127.0.0.1:1');
  console.log('VPN diagnostics regression checks passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
