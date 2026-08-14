const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  commitAtomicFileTransaction,
  recoverAtomicFileTransactions,
} = require('../dist-electron/atomic-files.js');
const { VpnManager } = require('../dist-electron/vpn-manager.js');

const TRANSACTION_PREFIX = '.nexus-transaction-';

async function assertNoTransactions(root) {
  const entries = await fs.readdir(root);
  assert.equal(entries.some((name) => name.startsWith(TRANSACTION_PREFIX)), false, 'transaction directory must be cleaned');
}

async function transactionTests(root) {
  await fs.writeFile(path.join(root, 'a.json'), 'old-a', 'utf8');
  await fs.writeFile(path.join(root, 'b.json'), 'old-b', 'utf8');
  await commitAtomicFileTransaction(root, {
    writes: [
      { name: 'a.json', content: 'new-a' },
      { name: 'c.json', content: 'new-c' },
    ],
    removals: ['b.json'],
  });
  assert.equal(await fs.readFile(path.join(root, 'a.json'), 'utf8'), 'new-a');
  assert.equal(await fs.readFile(path.join(root, 'c.json'), 'utf8'), 'new-c');
  await assert.rejects(fs.readFile(path.join(root, 'b.json'), 'utf8'), { code: 'ENOENT' });
  await assertNoTransactions(root);

  await fs.writeFile(path.join(root, 'a.json'), 'rollback-a', 'utf8');
  await fs.writeFile(path.join(root, 'b.json'), 'rollback-b', 'utf8');
  await fs.rm(path.join(root, 'c.json'), { force: true });
  await assert.rejects(
    commitAtomicFileTransaction(root, {
      writes: [
        { name: 'a.json', content: 'partial-a' },
        { name: 'c.json', content: 'partial-c' },
      ],
      removals: ['b.json'],
    }, {
      beforeApply: (_name, index) => {
        if (index === 1) throw new Error('injected transaction failure');
      },
    }),
    /injected transaction failure/,
  );
  assert.equal(await fs.readFile(path.join(root, 'a.json'), 'utf8'), 'rollback-a', 'replaced file is restored');
  assert.equal(await fs.readFile(path.join(root, 'b.json'), 'utf8'), 'rollback-b', 'unprocessed removal is preserved');
  await assert.rejects(fs.readFile(path.join(root, 'c.json'), 'utf8'), { code: 'ENOENT' });
  await assertNoTransactions(root);

  await assert.rejects(
    commitAtomicFileTransaction(root, { writes: [{ name: '../escape.json', content: 'bad' }] }),
    /Недопустимое имя/,
  );
  await assert.rejects(
    commitAtomicFileTransaction(root, {
      writes: [
        { name: 'DUPLICATE.json', content: 'one' },
        { name: 'duplicate.json', content: 'two' },
      ],
    }),
    /Повторяющийся файл/,
  );
}

async function interruptedRecoveryTest(root) {
  const transactionDir = path.join(root, `${TRANSACTION_PREFIX}interrupted`);
  await fs.mkdir(path.join(transactionDir, 'backup'), { recursive: true });
  await fs.mkdir(path.join(transactionDir, 'staged'), { recursive: true });
  await fs.writeFile(path.join(root, 'recover.json'), 'new-but-uncommitted', 'utf8');
  await fs.writeFile(path.join(transactionDir, 'backup', 'recover.json'), 'old-before-crash', 'utf8');
  await fs.writeFile(path.join(transactionDir, 'manifest.json'), JSON.stringify({
    version: 1,
    operations: [{ name: 'recover.json', action: 'write', hadOriginal: true }],
  }), 'utf8');
  await fs.writeFile(path.join(transactionDir, 'READY'), 'ready\n', 'utf8');

  assert.equal(await recoverAtomicFileTransactions(root), 1);
  assert.equal(await fs.readFile(path.join(root, 'recover.json'), 'utf8'), 'old-before-crash');
  await assertNoTransactions(root);
}

async function committedRecoveryTest(root) {
  const transactionDir = path.join(root, `${TRANSACTION_PREFIX}committed`);
  await fs.mkdir(path.join(transactionDir, 'backup'), { recursive: true });
  await fs.mkdir(path.join(transactionDir, 'staged'), { recursive: true });
  await fs.writeFile(path.join(root, 'committed.json'), 'committed-new', 'utf8');
  await fs.writeFile(path.join(transactionDir, 'backup', 'committed.json'), 'committed-old', 'utf8');
  await fs.writeFile(path.join(transactionDir, 'manifest.json'), JSON.stringify({
    version: 1,
    operations: [{ name: 'committed.json', action: 'write', hadOriginal: true }],
  }), 'utf8');
  await fs.writeFile(path.join(transactionDir, 'READY'), 'ready\n', 'utf8');
  await fs.writeFile(path.join(transactionDir, 'COMMITTED'), 'committed\n', 'utf8');

  assert.equal(await recoverAtomicFileTransactions(root), 1);
  assert.equal(await fs.readFile(path.join(root, 'committed.json'), 'utf8'), 'committed-new');
  await assertNoTransactions(root);
}

async function managerQueueTests(root) {
  const manager = new VpnManager(root);
  manager.subscriptions.set('https://one.example.com/list', { url: 'https://one.example.com/list', title: 'One' });
  manager.subscriptions.set('https://two.example.com/list', { url: 'https://two.example.com/list', title: 'Two' });

  const calls = [];
  manager.importSubscriptionUnlocked = async (url) => {
    calls.push(url);
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (url.includes('two.')) throw new Error('temporary failure');
    return [{ id: 'profile' }];
  };
  const first = manager.refreshSubscriptions();
  const coalesced = manager.refreshSubscriptions();
  assert.equal(first, coalesced, 'concurrent refresh requests share one in-flight operation');
  assert.equal(await first, 1, 'a failed source does not discard successful refreshes');
  assert.equal(calls.length, 2);

  manager.importSubscriptionUnlocked = async () => { throw new Error('offline'); };
  await assert.rejects(
    manager.refreshSubscriptions(),
    /Старые профили сохранены/,
    'an all-source failure is reported while retaining previous state',
  );

  let active = 0;
  let maximumActive = 0;
  manager.importSubscriptionUnlocked = async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return [];
  };
  await Promise.all([
    manager.importSubscription('https://three.example.com/list'),
    manager.importSubscription('https://four.example.com/list'),
  ]);
  assert.equal(maximumActive, 1, 'subscription mutations are serialized');
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-refresh-test-'));
  try {
    await transactionTests(root);
    await interruptedRecoveryTest(root);
    await committedRecoveryTest(root);
    await managerQueueTests(path.join(root, 'manager'));

    const managerSource = await fs.readFile(path.join(__dirname, '../src/main/vpn-manager.ts'), 'utf8');
    const commitIndex = managerSource.indexOf('await commitAtomicFileTransaction(this.configsDir()');
    const memoryIndex = managerSource.indexOf('this.profiles = nextProfiles', commitIndex);
    assert.ok(commitIndex >= 0 && memoryIndex > commitIndex, 'memory state changes only after the disk transaction commits');
    assert.ok(managerSource.indexOf('recoverAtomicFileTransactions(this.configsDir())') < managerSource.indexOf('fs.readdir(this.configsDir()'), 'recovery runs before profiles are loaded');

    console.log('subscription refresh tests: ok');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
