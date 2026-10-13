const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { ModuleManager } = require(path.join(root, 'dist-electron', 'module-manager.js'));
const { GithubUpdater } = require(path.join(root, 'dist-electron', 'github-updater.js'));
const { tgWsProxyAssetCandidates } = require(path.join(root, 'dist-electron', 'platform-assets.js'));
const { readTgProxyOptions } = require(path.join(root, 'dist-electron', 'tg-proxy-options.js'));

// --- Полный цикл установки TG WS Proxy без сети -------------------------------
// Ассет TG WS Proxy — это сам исполняемый файл (не архив): установка копирует
// его в bin и обновляет манифест, сохраняя выбранные пользователем порт и
// режим. Проверяется, что файл переживает установку, манифест согласован, а
// модуль сразу считается готовым — тот же класс ошибок, что ломал Zapret.
const fixture = path.join(__dirname, 'fixtures', 'tgwsproxy-sim.bin');

(async () => {
  const modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-tgws-install-'));
  fs.cpSync(path.join(root, 'modules'), modulesDir, { recursive: true });
  const manager = new ModuleManager(modulesDir);
  await manager.init();
  const updater = new GithubUpdater(modulesDir, manager, () => false);

  // Имя берётся у того же помощника, что и в программе: на Linux и Windows
  // наборы ассетов разные, тест не должен зависеть от платформы.
  const assetName = tgWsProxyAssetCandidates()[0];
  assert.ok(assetName, 'для платформы есть подходящий ассет TG WS Proxy');

  assert.equal(updater['moduleReady']('tg-ws-proxy'), false, 'до установки модуль не готов');

  // Порт и режим выбирает пользователь — установка обязана их сохранить.
  const beforeInstall = manager.list().find((item) => item.id === 'tg-ws-proxy');
  const expectedPort = readTgProxyOptions(beforeInstall).port;
  assert.ok(expectedPort > 0, 'порт по умолчанию задан');

  // Неподходящий файл отклоняется: защита от подмены ассета.
  await assert.rejects(
    () => updater['installDirect'](fixture, '1.11.2', 'not-a-tgwsproxy.exe'),
    /Неподходящий файл/,
    'чужой файл не устанавливается',
  );

  const executable = await updater['installDirect'](fixture, '1.11.2', assetName);
  await manager.reload();

  assert.equal(executable, `./bin/${assetName}`, 'файл установлен в bin');
  assert.equal(fs.existsSync(path.join(modulesDir, 'bin', assetName)), true, 'файл существует после установки');

  const module = manager.list().find((item) => item.id === 'tg-ws-proxy');
  assert.ok(module, 'манифест tg-ws-proxy на месте');
  assert.equal(module.executable, `./bin/${assetName}`, 'манифест указывает на установленный файл');
  assert.equal(module.launch_mode, 'executable', 'режим запуска — исполняемый файл');
  assert.equal(module.working_dir, './bin', 'рабочая папка — bin');
  assert.equal(module.installed_version, '1.11.2', 'версия установки записана в манифест');
  assert.equal(module.healthcheck?.type, 'tcp', 'проверка готовности — по TCP-порту');
  assert.equal(module.healthcheck?.port, expectedPort, 'порт пользователя пережил установку');
  assert.deepEqual(module.args, beforeInstall.args, 'аргументы запуска сохранились как были');
  assert.ok(module.args.some((arg) => arg.startsWith('--listen=')), 'аргументы содержат адрес прослушивания');

  assert.equal(updater['moduleReady']('tg-ws-proxy'), true, 'после установки модуль готов');

  fs.rmSync(modulesDir, { recursive: true, force: true });
  console.log('TG WS Proxy install cycle checks passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
