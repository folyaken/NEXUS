const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  buildTgProxyArgs,
  normalizeTgProxyOptions,
  normalizeTgProxyPort,
  readTgProxyOptions,
} = require(path.join(root, 'dist-electron', 'tg-proxy-options.js'));
const { ModuleManager } = require(path.join(root, 'dist-electron', 'module-manager.js'));

// --- Валидация порта --------------------------------------------------------
// Порты ниже 1024 требуют прав администратора: модуль запускался бы с ошибкой.
assert.equal(normalizeTgProxyPort(8080), 8080);
assert.equal(normalizeTgProxyPort('9090'), 9090);
for (const invalid of [80, 1023, 0, -1, 65536, 1.5, 'abc', '']) {
  assert.throws(() => normalizeTgProxyPort(invalid), /Введите порт/, String(invalid));
}
assert.equal(normalizeTgProxyOptions({}).port, 8080, 'по умолчанию используется 8080');
assert.equal(normalizeTgProxyOptions({ port: '' }).port, 8080, 'пустое поле не должно ронять сохранение');
assert.equal(normalizeTgProxyOptions({ mode: 'нечто' }).mode, 'telegram', 'неизвестный режим откатывается к стандартному');

// --- Аргументы запуска ------------------------------------------------------
assert.deepEqual(buildTgProxyArgs({ port: 8080, mode: 'telegram' }), ['--portable', '--listen=127.0.0.1:8080']);
assert.deepEqual(buildTgProxyArgs({ port: 9091, mode: 'universal' }), ['--portable', '--listen=127.0.0.1:9091', '--all-proxy']);
// --portable обязателен: без него конфигурация уедет в AppData.
assert.ok(buildTgProxyArgs({ port: 8080, mode: 'telegram' }).includes('--portable'));

// --- Чтение состояния формы -------------------------------------------------
assert.deepEqual(readTgProxyOptions({ args: ['--portable', '--listen=127.0.0.1:9090'] }), { port: 9090, mode: 'telegram' });
assert.deepEqual(readTgProxyOptions({ args: ['--portable', '--listen=127.0.0.1:9090', '--all-proxy'] }), { port: 9090, mode: 'universal' });
// Ранние сборки не писали --listen: порт должен подхватываться из healthcheck.
assert.deepEqual(readTgProxyOptions({ args: ['--portable'], healthcheck: { port: 1443 } }), { port: 1443, mode: 'telegram' });
assert.deepEqual(readTgProxyOptions({ args: [] }), { port: 8080, mode: 'telegram' });
assert.deepEqual(readTgProxyOptions(undefined), { port: 8080, mode: 'telegram' });

// Круговой обход без потерь.
for (const options of [{ port: 8080, mode: 'telegram' }, { port: 12345, mode: 'universal' }]) {
  assert.deepEqual(readTgProxyOptions({ args: buildTgProxyArgs(options) }), options);
}

void (async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-tg-options-test-'));
  try {
    const manifestPath = path.join(temp, 'tg-ws-proxy.module.json');
    await fsp.writeFile(manifestPath, JSON.stringify({
      id: 'tg-ws-proxy',
      name: 'TG WS Proxy',
      description: 'Возвращает доступ к Telegram, когда он заблокирован.',
      enabled: false,
      executable: './bin/TgWsProxy_windows_7_64bit.exe',
      args: ['--portable', '--listen=127.0.0.1:8080'],
      status: 'stopped',
      category: 'proxy',
      icon: 'T',
      pid: null,
      log_file: './logs/tg-ws-proxy.log',
      healthcheck: { type: 'tcp', host: '127.0.0.1', port: 8080, timeout_ms: 15000 },
    }, null, 2));

    const manager = new ModuleManager(temp);
    manager.setProcessScanner(async () => []);
    await manager.init();

    const updated = await manager.setTgProxyOptions('tg-ws-proxy', { port: 9099, mode: 'universal' });
    assert.deepEqual(updated.args, ['--portable', '--listen=127.0.0.1:9099', '--all-proxy']);
    // Порт обязан совпадать в healthcheck, иначе проверка готовности стучится не туда.
    assert.equal(updated.healthcheck.port, 9099, 'healthcheck должен следовать за портом');

    await manager.reload();
    const reloaded = manager.list().find((item) => item.id === 'tg-ws-proxy');
    assert.deepEqual(reloaded.args, ['--portable', '--listen=127.0.0.1:9099', '--all-proxy'], 'настройки переживают пересканирование');
    assert.equal(reloaded.healthcheck.port, 9099);

    await assert.rejects(manager.setTgProxyOptions('tg-ws-proxy', { port: 80 }), /Введите порт/);

    // Занятый порт отклоняется до остановки модуля.
    const squatter = net.createServer();
    await new Promise((resolve, reject) => {
      squatter.once('error', reject);
      squatter.listen(0, '127.0.0.1', resolve);
    });
    const busyPort = squatter.address().port;
    try {
      await assert.rejects(manager.setTgProxyOptions('tg-ws-proxy', { port: busyPort }), /уже занят/);
      assert.deepEqual(
        manager.list().find((item) => item.id === 'tg-ws-proxy').args,
        ['--portable', '--listen=127.0.0.1:9099', '--all-proxy'],
        'после отклонённого порта настройки не меняются',
      );
    } finally {
      await new Promise((resolve) => squatter.close(resolve));
    }

    // --- Проверка статуса ----------------------------------------------------
    const stopped = await manager.checkStatus('tg-ws-proxy');
    assert.equal(stopped.running, false);
    assert.equal(stopped.pid, null);
    assert.equal(stopped.portListening, false);
    assert.equal(stopped.port, 9099);
    assert.equal(stopped.summary, 'Модуль остановлен');
    assert.ok(Number.isFinite(Date.parse(stopped.checkedAt)));

    // Занятый посторонним приложением порт не должен выдаваться за рабочий модуль.
    const foreign = net.createServer();
    await new Promise((resolve) => foreign.listen(9099, '127.0.0.1', resolve));
    try {
      const report = await manager.checkStatus('tg-ws-proxy');
      assert.equal(report.portListening, true);
      assert.equal(report.running, false);
      assert.equal(report.summary, 'Порт занят другим приложением');
    } finally {
      await new Promise((resolve) => foreign.close(resolve));
    }

    console.log('TG WS Proxy options and status checks passed.');
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
})();
