const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VpnManager } = require('../dist-electron/vpn-manager.js');

function profile(id, subscriptionUrl) {
  return {
    id,
    name: id,
    protocol: 'vless',
    server: `${id}.example.com`,
    port: 443,
    shareLink: `vless://00000000-0000-4000-8000-000000000000@${id}.example.com:443`,
    subscriptionUrl,
    kind: 'node',
    params: {
      protocol: 'vless',
      address: `${id}.example.com`,
      port: 443,
      uuid: '00000000-0000-4000-8000-000000000000',
    },
    createdAt: '2026-08-14T00:00:00.000Z',
  };
}

async function functionalRemovalTest(root) {
  const manager = new VpnManager(root);
  const configs = path.join(root, 'configs', 'vpn');
  await fs.mkdir(configs, { recursive: true });

  const removedUrl = 'https://provider.example.com/list?token=secret';
  const keptUrl = 'https://other.example.com/subscription';
  const first = profile('source-one-a', removedUrl);
  const second = profile('source-one-b', removedUrl);
  const kept = profile('source-two', keptUrl);
  const manual = profile('manual-profile');
  for (const item of [first, second, kept, manual]) {
    manager.profiles.set(item.id, item);
    await fs.writeFile(path.join(configs, `${item.id}.json`), `${JSON.stringify(item)}\n`, 'utf8');
  }
  manager.subscriptions.set(removedUrl, { url: removedUrl, title: 'Provider One' });
  manager.subscriptions.set(keptUrl, { url: keptUrl, title: 'Provider Two' });
  await fs.writeFile(path.join(configs, 'subscriptions.json'), JSON.stringify([...manager.subscriptions.values()]), 'utf8');

  let disconnected = 0;
  manager.activeProfileId = first.id;
  manager.disconnect = async () => {
    disconnected += 1;
    manager.activeProfileId = null;
    return manager.runtime();
  };
  let snapshots = 0;
  manager.on('changed', () => { snapshots += 1; });
  await manager.removeSubscription(`${removedUrl}#ignored-fragment`);

  assert.equal(manager.subscriptions.has(removedUrl), false, 'removed subscription metadata leaves memory');
  assert.equal(manager.subscriptions.has(keptUrl), true, 'other subscription metadata is retained');
  assert.equal(manager.profiles.has(first.id), false, 'first source profile leaves memory');
  assert.equal(manager.profiles.has(second.id), false, 'second source profile leaves memory');
  assert.equal(manager.profiles.has(kept.id), true, 'profile from another source is retained');
  assert.equal(manager.profiles.has(manual.id), true, 'manual profile is retained');
  assert.equal(disconnected, 1, 'an active profile is disconnected before its source is removed');
  assert.equal(snapshots, 1, 'the UI receives one committed removal snapshot');

  await assert.rejects(fs.readFile(path.join(configs, `${first.id}.json`), 'utf8'), { code: 'ENOENT' });
  await assert.rejects(fs.readFile(path.join(configs, `${second.id}.json`), 'utf8'), { code: 'ENOENT' });
  assert.equal(JSON.parse(await fs.readFile(path.join(configs, 'subscriptions.json'), 'utf8')).length, 1);
  await assert.rejects(manager.removeSubscription(removedUrl), /Подписка не найдена/);
  await assert.rejects(manager.removeSubscription('http://other.example.com/subscription'), /только HTTPS/);
}

async function refreshAndQueueTest(root) {
  const manager = new VpnManager(root);
  const calls = [];
  manager.importSubscriptionUnlocked = async (url) => {
    calls.push(url);
    return [{ id: 'one' }, { id: 'two' }];
  };
  assert.equal(await manager.refreshSubscription('https://provider.example.com/list'), 2);
  assert.deepEqual(calls, ['https://provider.example.com/list']);

  let active = 0;
  let maximumActive = 0;
  const order = [];
  manager.removeSubscriptionUnlocked = async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push('remove:start');
    await new Promise((resolve) => setTimeout(resolve, 8));
    order.push('remove:end');
    active -= 1;
  };
  manager.importSubscriptionUnlocked = async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push('refresh:start');
    await new Promise((resolve) => setTimeout(resolve, 2));
    order.push('refresh:end');
    active -= 1;
    return [];
  };
  await Promise.all([
    manager.removeSubscription('https://provider.example.com/list'),
    manager.refreshSubscription('https://provider.example.com/list'),
  ]);
  assert.equal(maximumActive, 1, 'remove and refresh share the profile mutation queue');
  assert.deepEqual(order, ['remove:start', 'remove:end', 'refresh:start', 'refresh:end']);
}

async function sourceContractTest() {
  const [mainSource, preloadSource, envSource, uiSource, pageSource, stylesSource] = await Promise.all([
    fs.readFile(path.join(__dirname, '../src/main/main.ts'), 'utf8'),
    fs.readFile(path.join(__dirname, '../src/main/preload.ts'), 'utf8'),
    fs.readFile(path.join(__dirname, '../src/renderer/env.d.ts'), 'utf8'),
    fs.readFile(path.join(__dirname, '../src/renderer/SubscriptionManager.tsx'), 'utf8'),
    fs.readFile(path.join(__dirname, '../src/renderer/Jey2RayPage.tsx'), 'utf8'),
    fs.readFile(path.join(__dirname, '../src/renderer/styles.css'), 'utf8'),
  ]);
  assert.match(mainSource, /vpn:remove-subscription/);
  assert.match(preloadSource, /removeVpnSubscription/);
  assert.match(envSource, /refreshVpn\(url\?: string\)/);
  assert.match(uiSource, /адрес скрыт/);
  assert.doesNotMatch(uiSource, />\{info\.url\}</, 'secret subscription URL is never rendered as visible text');
  assert.match(pageSource, /server-card-metrics/, 'server scope uses the finished summary layout');
  assert.match(stylesSource, /grid-template-columns:\s*36px repeat\(4, minmax\(96px, 1fr\)\)/, 'toolbar reserves a compact Jey2Ray settings gear before four equal actions');
  assert.match(stylesSource, /\.jey-toolbar\.tight\s+\.ghost-action[^}]*height:\s*40px/, 'toolbar actions keep one stable height');
  assert.doesNotMatch(pageSource, />\s*Добавить ссылку\s*</, 'compact toolbar label cannot wrap in a normal window');
  assert.doesNotMatch(pageSource, />\s*Тест пинга\s*</, 'ping action uses its compact toolbar label');
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-subscription-management-'));
  try {
    await functionalRemovalTest(path.join(root, 'functional'));
    await refreshAndQueueTest(path.join(root, 'queue'));
    await sourceContractTest();
    console.log('subscription management tests: ok');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
