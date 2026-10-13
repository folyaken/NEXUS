const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { ModuleManager } = require(path.join(root, 'dist-electron', 'module-manager.js'));
const { GithubUpdater } = require(path.join(root, 'dist-electron', 'github-updater.js'));

// --- Полный цикл установки Xray (модуль Jey2Ray) без сети ---------------------
// Релизный ZIP Xray-core распакован с верхней папкой («Xray-core-26.7.28»),
// внутри — ядро и датасеты geoip/geosite. Проверяется весь путь установки:
// распаковка → ядро и датасеты на месте → манифест обновлён → модуль «готов».
// Это тот же класс ошибок, что ломал Zapret (установка считалась удачной, но
// файлы до запуска не доживали), поэтому цикл фиксируется тестом.
const fixture = path.join(__dirname, 'fixtures', 'xray-release-sim.zip');

(async () => {
  const modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-xray-install-'));
  fs.cpSync(path.join(root, 'modules'), modulesDir, { recursive: true });
  const manager = new ModuleManager(modulesDir);
  await manager.init();
  const updater = new GithubUpdater(modulesDir, manager, () => false);

  // До установки модуль не готов — иначе тест ниже ничего не проверял бы.
  assert.equal(updater['moduleReady']('jey2ray'), false, 'до установки Xray модуль не готов');

  const executable = await updater['installXray'](fixture, '26.7.28');
  await manager.reload();

  const binaryName = process.platform === 'win32' ? 'xray.exe' : 'xray';
  assert.equal(executable, `./bin/${binaryName}`, 'ядро установлено в bin');
  assert.equal(fs.existsSync(path.join(modulesDir, 'bin', binaryName)), true, 'файл ядра существует');

  // Датасеты и их копии без расширения: старые ядра искали `geoip` без `.dat`
  // и падали с кодом 23 — копии должны пережить установку.
  for (const name of ['geoip.dat', 'geosite.dat']) {
    assert.equal(fs.existsSync(path.join(modulesDir, 'bin', name)), true, `датасет на месте: ${name}`);
    assert.equal(fs.existsSync(path.join(modulesDir, 'bin', name.replace(/\.dat$/i, ''))), true, `копия без расширения: ${name}`);
  }

  // Манифест читается с диска: list() намеренно скрывает jey2ray — модуль
  // живёт во вкладке Jey2Ray, а не в общем списке модулей.
  const manifestPath = path.join(modulesDir, 'jey2ray.module.json');
  const jey2ray = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(jey2ray.executable, `./bin/${binaryName}`, 'манифест указывает на установленное ядро');
  assert.equal(jey2ray.working_dir, './bin', 'рабочая папка — bin');
  assert.equal(jey2ray.installed_version, '26.7.28', 'версия установки записана в манифест');
  assert.ok(jey2ray.args.includes('-config'), 'ядро запускается с конфигом');

  // Ключевая проверка: после установки модуль считается готовым без
  // перезапуска программы — этим пользуется докачка при запуске.
  assert.equal(updater['moduleReady']('jey2ray'), true, 'после установки модуль готов');

  fs.rmSync(modulesDir, { recursive: true, force: true });
  console.log('Xray install cycle checks passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
