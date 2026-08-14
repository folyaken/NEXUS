const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { ModuleManager } = require(path.join(root, 'dist-electron', 'module-manager.js'));
const { GithubUpdater } = require(path.join(root, 'dist-electron', 'github-updater.js'));
const {
  tgWsProxyAssetCandidates,
  windowsAssetArchitecture,
  xrayAssetCandidates,
} = require(path.join(root, 'dist-electron', 'platform-assets.js'));

assert.equal(windowsAssetArchitecture({ PROCESSOR_ARCHITECTURE: 'AMD64' }, 'x64'), 'x64');
assert.equal(windowsAssetArchitecture({ PROCESSOR_ARCHITECTURE: 'ARM64' }, 'x64'), 'arm64', 'native ARM64 wins over an emulated x64 runtime');
assert.equal(windowsAssetArchitecture({ PROCESSOR_ARCHITECTURE: 'x86' }, 'ia32'), 'ia32');
assert.deepEqual(tgWsProxyAssetCandidates('win32', 'x64').slice(0, 2), [
  'TgWsProxy_windows_7_64bit.exe',
  'TgWsProxy_windows.exe',
]);
assert.deepEqual(tgWsProxyAssetCandidates('win32', 'arm64'), ['TgWsProxy_windows_arm64.exe']);
assert.deepEqual(tgWsProxyAssetCandidates('win32', 'ia32'), ['TgWsProxy_windows_7_32bit.exe']);
assert.deepEqual(xrayAssetCandidates('win32', 'arm64'), ['Xray-windows-arm64-v8a.zip']);
assert.deepEqual(xrayAssetCandidates('win32', 'ia32'), ['Xray-windows-32.zip']);

const tgManifest = JSON.parse(fs.readFileSync(path.join(root, 'modules', 'tg-ws-proxy.module.json'), 'utf8'));
assert.deepEqual(tgManifest.args, ['--portable']);
assert.equal(tgManifest.working_dir, './bin');
assert.equal(tgManifest.healthcheck.host, '127.0.0.1');
assert.equal(tgManifest.healthcheck.port, 1443);
assert.equal(tgManifest.upstream_log_file, './bin/TgWsProxy_data/proxy.log');
assert.doesNotMatch(JSON.stringify(tgManifest), /--listen|127\.0\.0\.1:8080|bin\/tg-ws-proxy\.exe/i);

const updaterSource = fs.readFileSync(path.join(root, 'src', 'main', 'github-updater.ts'), 'utf8');
assert.match(updaterSource, /installed\.asset === asset\.name/, 'an asset change at the same release version must trigger migration');
assert.match(updaterSource, /manager\.beginUpdate\(target\.id\)/, 'updates must lock module startup');
assert.match(updaterSource, /atomicReplaceFile/, 'direct binary updates must be staged and replaced atomically');
assert.match(updaterSource, /isExternallyRunning\(target\.id\)/, 'Xray updates must account for the VPN process outside ModuleManager');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

/**
 * ModuleManager, изолированный от процессов операционной системы.
 *
 * Без этого обнаружение «уже запущенного» модуля читает реальный список процессов
 * машины: запущенный у разработчика TgWsProxy.exe или winws.exe ломает обновление
 * ошибкой «Остановите модуль перед обновлением». Тест обязан быть детерминированным.
 */
function isolatedManager(dir, pidsByImage = {}) {
  const manager = new ModuleManager(dir);
  manager.setProcessScanner(async (image) => pidsByImage[image] ?? []);
  return manager;
}

function manifest(overrides) {
  return {
    id: overrides.id,
    name: overrides.name || overrides.id,
    description: 'test module',
    enabled: false,
    executable: process.execPath,
    args: overrides.args || [],
    status: 'stopped',
    category: 'other',
    icon: 'T',
    pid: null,
    log_file: `./logs/${overrides.id}.log`,
    working_dir: overrides.working_dir,
    healthcheck: overrides.healthcheck,
  };
}

async function runAtomicLockPreservationTest() {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-atomic-lock-test-'));
  const originalRename = fsp.rename;
  try {
    const source = path.join(temp, 'new.bin');
    const destination = path.join(temp, 'installed.bin');
    await fsp.writeFile(source, 'new release');
    await fsp.writeFile(destination, 'working old release');
    const manager = isolatedManager(temp);
    await manager.init();
    const updater = new GithubUpdater(temp, manager);
    fsp.rename = async (from, to) => {
      if (from === destination && String(to).includes('.nexus-backup-')) {
        const error = new Error('simulated Windows file lock');
        error.code = 'EPERM';
        throw error;
      }
      return await originalRename(from, to);
    };
    await assert.rejects(updater.atomicReplaceFile(source, destination), /simulated Windows file lock/);
    assert.equal(await fsp.readFile(destination, 'utf8'), 'working old release', 'a locked destination must never be deleted');
    const leftovers = (await fsp.readdir(temp)).filter((name) => /\.nexus-(?:new|backup)-/.test(name));
    assert.deepEqual(leftovers, []);
  } finally {
    fsp.rename = originalRename;
    await fsp.rm(temp, { recursive: true, force: true });
  }
}

async function runZapretRollbackTest() {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-zapret-rollback-test-'));
  try {
    const installRoot = path.join(temp, 'bin', 'zapret');
    await fsp.mkdir(installRoot, { recursive: true });
    await fsp.writeFile(path.join(installRoot, 'old-install.marker'), 'keep me');
    // A directory at the manifest path makes the final manifest write fail,
    // exercising rollback after the staged release has already been swapped.
    await fsp.mkdir(path.join(temp, 'zapret.module.json'));
    const archive = path.join(temp, 'release.zip');
    await fsp.writeFile(archive, Buffer.from(
      'UEsDBAoAAAAAAOuODl0AAAAAAAAAAAAAAAAIABwAcmVsZWFzZS9VVAkAA4lWf2qJVn9qdXgLAAEE6QMAAATpAwAAUEsDBAoAAAAAAOuODl0AAAAAAAAAAAAAAAAMABwAcmVsZWFzZS9iaW4vVVQJAAOJVn9qiVZ/anV4CwABBOkDAAAE6QMAAFBLAwQKAAAAAADrjg5dDEzQbgYAAAAGAAAAFQAcAHJlbGVhc2UvYmluL3dpbndzLmV4ZVVUCQADiVZ/aolWf2p1eAsAAQTpAwAABOkDAABNWm1vY2tQSwMECgAAAAAA644OXeAwvYoLAAAACwAAABsAHAByZWxlYXNlL2dlbmVyYWwgKEFMVDEwKS5iYXRVVAkAA4lWf2qJVn9qdXgLAAEE6QMAAATpAwAAQGVjaG8gb2ZmDQpQSwECHgMKAAAAAADrjg5dAAAAAAAAAAAAAAAACAAYAAAAAAAAABAA7UEAAAAAcmVsZWFzZS9VVAUAA4lWf2p1eAsAAQTpAwAABOkDAABQSwECHgMKAAAAAADrjg5dAAAAAAAAAAAAAAAADAAYAAAAAAAAABAA7UFCAAAAcmVsZWFzZS9iaW4vVVQFAAOJVn9qdXgLAAEE6QMAAATpAwAAUEsBAh4DCgAAAAAA644OXQxM0G4GAAAABgAAABUAGAAAAAAAAQAAAKSBiAAAAHJlbGVhc2UvYmluL3dpbndzLmV4ZVVUBQADiVZ/anV4CwABBOkDAAAE6QMAAFBLAQIeAwoAAAAAAOuODl3gML2KCwAAAAsAAAAbABgAAAAAAAEAAACkgd0AAAByZWxlYXNlL2dlbmVyYWwgKEFMVDEwKS5iYXRVVAUAA4lWf2p1eAsAAQTpAwAABOkDAABQSwUGAAAAAAQABABcAQAAPQEAAAAA',
      'base64',
    ));

    const manager = isolatedManager(temp);
    await manager.init();
    const updater = new GithubUpdater(temp, manager);
    await assert.rejects(updater.installZapret(archive, 'test-version'));
    assert.equal(await fsp.readFile(path.join(installRoot, 'old-install.marker'), 'utf8'), 'keep me');
    assert.equal(fs.existsSync(path.join(installRoot, 'release', 'bin', 'winws.exe')), false);
    const leftovers = (await fsp.readdir(path.join(temp, 'bin'))).filter((name) => /^\.zapret-(?:installing|backup)-/.test(name));
    assert.deepEqual(leftovers, [], 'failed installation must not leave staging or backup directories');
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
}

async function runTgPortableRuntimeTest() {
  if (process.platform === 'win32') return;
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-tg-runtime-test-'));
  try {
    const assetName = tgWsProxyAssetCandidates()[0];
    const binary = path.join(temp, 'bin', assetName);
    await fsp.mkdir(path.dirname(binary), { recursive: true });
    await fsp.writeFile(binary, [
      '#!/usr/bin/env node',
      "const net = require('node:net');",
      "const server = net.createServer((socket) => socket.end());",
      "server.listen(1443, '127.0.0.1');",
      "const stop = () => server.close(() => process.exit(0));",
      "process.on('SIGTERM', stop);",
      "process.on('SIGINT', stop);",
    ].join('\n'));
    await fsp.chmod(binary, 0o755);
    const portableDirectory = path.join(temp, 'bin', 'TgWsProxy_data');
    await fsp.mkdir(portableDirectory, { recursive: true });
    await fsp.writeFile(path.join(portableDirectory, 'proxy.log'), [
      "Config: {'secret': '0123456789abcdef0123456789abcdef'}",
      'proxy error secret=0123456789abcdef0123456789abcdef',
      'open tg://proxy?server=example.org&secret=0123456789abcdef0123456789abcdef',
      'Authorization: Bearer proxy-token-that-must-not-leak',
      'request https://user:password@provider.example/private?token=hidden',
      'upstream connection failed',
    ].join('\n'));
    await fsp.writeFile(path.join(temp, 'tg-ws-proxy.module.json'), JSON.stringify({
      ...manifest({ id: 'tg-ws-proxy', working_dir: './bin' }),
      executable: `./bin/${assetName}`,
    }, null, 2));

    // Запущенный на машине настоящий TgWsProxy.exe иначе будет подхвачен как
    // «уже работающий», и модуль не пройдёт штатный путь запуска.
    const manager = isolatedManager(temp);
    await manager.init();
    try {
      const running = await manager.start('tg-ws-proxy');
      assert.equal(running.status, 'running');
      assert.ok(running.pid > 0);
      const configPath = path.join(temp, 'bin', 'TgWsProxy_data', 'config.json');
      const config = JSON.parse(await fsp.readFile(configPath, 'utf8'));
      assert.equal(config.host, '127.0.0.1');
      assert.equal(config.port, 1443);
      assert.equal(config.check_updates, false, 'the upstream self-updater must be disabled under NEXUS');
      assert.match(config.secret, /^[a-f0-9]{32}$/i);
      assert.equal((await fsp.stat(configPath)).mode & 0o777, 0o600);
      const visibleLogs = manager.getLogs('tg-ws-proxy').map((entry) => entry.message).join('\n');
      assert.match(visibleLogs, /upstream connection failed/);
      assert.doesNotMatch(visibleLogs, /0123456789abcdef0123456789abcdef|Config:|proxy-token-that-must-not-leak|user:password|token=hidden/i);
      assert.match(visibleLogs, /tg:\/\/proxy\?\[скрыто\]/i);
      assert.match(visibleLogs, /Authorization: \[скрыто\]/i);
      assert.match(visibleLogs, /https:\/\/provider\.example\/…/i);
    } finally {
      await manager.stop('tg-ws-proxy').catch(() => undefined);
    }
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
}

async function runMockGithubUpdateTest() {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-module-update-test-'));
  const assetName = tgWsProxyAssetCandidates()[0];
  const fakeExecutable = Buffer.alloc(4096, 0x41);
  fakeExecutable.set([0x7f, 0x45, 0x4c, 0x46], 0);
  const assetUrl = `https://github.com/Flowseal/tg-ws-proxy/releases/download/v-test/${assetName}`;
  const validDigest = createHash('sha256').update(fakeExecutable).digest('hex');
  let releaseDigest = `sha256:${validDigest}`;
  const realFetch = global.fetch;
  const requests = [];

  try {
    await fsp.writeFile(path.join(temp, 'tg-ws-proxy.module.json'), JSON.stringify({
      ...manifest({ id: 'tg-ws-proxy', working_dir: './bin' }),
      version: '0.0.0',
      executable: './bin/missing',
    }, null, 2));

    global.fetch = async (input) => {
      const url = input.toString();
      requests.push(url);
      if (url === 'https://api.github.com/repos/Flowseal/tg-ws-proxy/releases/latest') {
        return new Response(JSON.stringify({
          tag_name: 'v-test',
          name: 'mock release',
          html_url: 'https://github.com/Flowseal/tg-ws-proxy/releases/tag/v-test',
          assets: [{
            name: assetName,
            browser_download_url: assetUrl,
            size: fakeExecutable.length,
            digest: releaseDigest,
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === assetUrl) return new Response('temporary release-assets failure', { status: 503 });
      if (url === `https://ghproxy.net/${assetUrl}` || url === `https://mirror.ghproxy.com/${assetUrl}`) {
        return new Response(fakeExecutable, {
          status: 200,
          headers: { 'content-length': String(fakeExecutable.length), 'content-type': 'application/octet-stream' },
        });
      }
      throw new Error(`unexpected mock URL: ${url}`);
    };

    const manager = isolatedManager(temp);
    await manager.init();
    const updater = new GithubUpdater(temp, manager);
    await updater.ensure('tg-ws-proxy');

    const installedPath = path.join(temp, 'bin', assetName);
    assert.deepEqual(await fsp.readFile(installedPath), fakeExecutable, 'downloaded executable must be installed byte-for-byte');
    const installedManifest = JSON.parse(await fsp.readFile(path.join(temp, 'tg-ws-proxy.module.json'), 'utf8'));
    assert.equal(installedManifest.installed_version, 'v-test');
    assert.equal(installedManifest.executable, `./bin/${assetName}`);
    assert.deepEqual(installedManifest.args, ['--portable']);
    assert.deepEqual(installedManifest.healthcheck, { type: 'tcp', host: '127.0.0.1', port: 1443, timeout_ms: 15_000 });
    assert.equal(updater.list().find((item) => item.id === 'tg-ws-proxy')?.status, 'installed');
    const expectedRequests = [
      'https://api.github.com/repos/Flowseal/tg-ws-proxy/releases/latest',
      assetUrl,
      `https://ghproxy.net/${assetUrl}`,
    ];
    assert.deepEqual(requests, expectedRequests, 'a failed direct asset request must fall back to the trusted mirror exactly once');

    releaseDigest = `sha256:${'0'.repeat(64)}`;
    requests.length = 0;
    await fsp.rm(installedPath);
    await assert.rejects(updater.ensure('tg-ws-proxy'), /Контрольная сумма GitHub asset .* не совпала/);
    assert.equal(fs.existsSync(installedPath), false, 'an asset with a mismatched GitHub digest must not be installed');
    assert.equal(updater.list().find((item) => item.id === 'tg-ws-proxy')?.status, 'error');
    // Несовпадение суммы проверяется для каждого источника отдельно: повреждённое
    // зеркало не должно обрывать обновление, пока остаются непроверенные зеркала.
    assert.deepEqual(requests, [
      'https://api.github.com/repos/Flowseal/tg-ws-proxy/releases/latest',
      assetUrl,
      `https://ghproxy.net/${assetUrl}`,
      `https://mirror.ghproxy.com/${assetUrl}`,
    ], 'a digest mismatch must move on to the next mirror instead of aborting');
  } finally {
    global.fetch = realFetch;
    await fsp.rm(temp, { recursive: true, force: true });
  }
}

async function run() {
  await runMockGithubUpdateTest();
  await runAtomicLockPreservationTest();
  await runZapretRollbackTest();
  await runTgPortableRuntimeTest();
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-module-test-'));
  try {
    const fixture = path.join(temp, 'tcp-service.cjs');
    await fsp.writeFile(fixture, [
      "const net = require('node:net');",
      "const server = net.createServer((socket) => socket.end());",
      "server.listen(Number(process.argv[2]), '127.0.0.1');",
      "const stop = () => server.close(() => process.exit(0));",
      "process.on('SIGTERM', stop);",
      "process.on('SIGINT', stop);",
    ].join('\n'));

    if (process.platform !== 'win32') {
      const workerFixture = path.join(temp, 'batch-worker.cjs');
      // Уникальное имя образа на прогон: «осиротевший» воркер от прерванного
      // запуска иначе будет найден как уже работающий и сломает следующий прогон.
      // Имя должно укладываться в 15 символов: pgrep -x на Linux сравнивает
      // усечённое comm, а более длинное имя никогда не совпадёт.
      const workerImage = `nx${process.pid.toString(36)}w.exe`;
      const workerBinary = path.join(temp, workerImage);
      const fakeCommand = path.join(temp, 'fake-cmd');
      const fakeCommandWithoutWorker = path.join(temp, 'fake-cmd-no-worker');
      const strategyFile = path.join(temp, 'general (ALT10).bat');
      await fsp.writeFile(workerFixture, [
        "const stop = () => process.exit(0);",
        "process.on('SIGTERM', stop);",
        "process.on('SIGINT', stop);",
        "setInterval(() => {}, 1000);",
      ].join('\n'));
      await fsp.copyFile(process.execPath, workerBinary);
      await fsp.chmod(workerBinary, 0o755);
      await fsp.writeFile(fakeCommand, [
        '#!/usr/bin/env node',
        "const { spawn } = require('node:child_process');",
        `spawn(${JSON.stringify(workerBinary)}, [${JSON.stringify(workerFixture)}], { detached: true, stdio: 'ignore' }).unref();`,
      ].join('\n'));
      await fsp.chmod(fakeCommand, 0o755);
      await fsp.writeFile(fakeCommandWithoutWorker, '#!/usr/bin/env node\nprocess.exit(0);\n');
      await fsp.chmod(fakeCommandWithoutWorker, 0o755);
      await fsp.writeFile(strategyFile, '@echo off\r\n');
      await fsp.writeFile(path.join(temp, 'batch-worker.module.json'), JSON.stringify({
        ...manifest({ id: 'batch-worker', working_dir: temp }),
        launch_mode: 'batch',
        strategy: 'general (ALT10)',
        strategies: { 'general (ALT10)': './general (ALT10).bat' },
        worker_name: workerImage,
      }, null, 2));
      await fsp.writeFile(path.join(temp, 'batch-no-worker.module.json'), JSON.stringify({
        ...manifest({ id: 'batch-no-worker', working_dir: temp }),
        launch_mode: 'batch',
        strategy: 'general (ALT10)',
        strategies: { 'general (ALT10)': './general (ALT10).bat' },
        worker_name: 'nexus-never-worker',
      }, null, 2));
    }

    const healthyPort = await reservePort();
    await fsp.writeFile(path.join(temp, 'healthy.module.json'), JSON.stringify(manifest({
      id: 'healthy',
      args: [fixture, String(healthyPort)],
      working_dir: temp,
      healthcheck: { type: 'tcp', host: '127.0.0.1', port: healthyPort, timeout_ms: 3000 },
    }), null, 2));
    await fsp.writeFile(path.join(temp, 'crash.module.json'), JSON.stringify(manifest({
      id: 'crash',
      args: ['-e', 'process.exit(255)'],
      working_dir: temp,
    }), null, 2));
    const missingPort = await reservePort();
    await fsp.writeFile(path.join(temp, 'unhealthy.module.json'), JSON.stringify(manifest({
      id: 'unhealthy',
      args: ['-e', 'setInterval(() => {}, 1000)'],
      working_dir: temp,
      healthcheck: { type: 'tcp', host: '127.0.0.1', port: missingPort, timeout_ms: 600 },
    }), null, 2));

    const manager = new ModuleManager(temp);
    await manager.init();

    if (process.platform !== 'win32') {
      const previousComSpec = process.env.ComSpec;
      process.env.ComSpec = path.join(temp, 'fake-cmd');
      try {
        const batch = await manager.start('batch-worker');
        assert.equal(batch.status, 'running');
        assert.ok(batch.pid > 0, 'batch status must expose the real worker PID');
        assert.equal(manager.isRunning('batch-worker'), true);
        await manager.stop('batch-worker');
        assert.equal(manager.isRunning('batch-worker'), false);
        process.env.ComSpec = path.join(temp, 'fake-cmd-no-worker');
        await assert.rejects(manager.start('batch-no-worker'), /рабочий процесс не появился/);
        assert.equal(manager.list().find((item) => item.id === 'batch-no-worker').status, 'error');
        assert.equal(manager.isRunning('batch-no-worker'), false);
      } finally {
        if (previousComSpec === undefined) delete process.env.ComSpec;
        else process.env.ComSpec = previousComSpec;
        await manager.stop('batch-worker').catch(() => undefined);
      }
    }

    const healthy = await manager.start('healthy');
    assert.equal(healthy.status, 'running');
    assert.ok(healthy.pid > 0);
    assert.equal(manager.isRunning('healthy'), true);
    assert.equal(JSON.parse(await fsp.readFile(path.join(temp, 'healthy.module.json'), 'utf8')).enabled, true);

    assert.throws(() => manager.beginUpdate('healthy'), /Остановите модуль/);
    await manager.stop('healthy');
    assert.equal(manager.isRunning('healthy'), false);
    assert.equal(manager.list().find((item) => item.id === 'healthy').status, 'stopped');
    assert.equal(JSON.parse(await fsp.readFile(path.join(temp, 'healthy.module.json'), 'utf8')).enabled, false);

    const releaseLock = manager.beginUpdate('healthy');
    await assert.rejects(manager.start('healthy'), /завершения обновления/);
    releaseLock();

    await assert.rejects(manager.start('crash'), /код 255/);
    const crashed = manager.list().find((item) => item.id === 'crash');
    assert.equal(crashed.status, 'error');
    assert.equal(crashed.enabled, false);

    const startedAt = Date.now();
    await assert.rejects(manager.start('unhealthy'), /не подтвердил готовность/);
    assert.ok(Date.now() - startedAt < 5000, 'health timeout must terminate the failed child promptly');
    assert.equal(manager.isRunning('unhealthy'), false);
    assert.equal(manager.list().find((item) => item.id === 'unhealthy').status, 'error');
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
}

run().then(() => {
  console.log('module lifecycle/update regression tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
