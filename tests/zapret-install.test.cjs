const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { ModuleManager } = require(path.join(root, 'dist-electron', 'module-manager.js'));
const { GithubUpdater } = require(path.join(root, 'dist-electron', 'github-updater.js'));

// --- Полный цикл установки Zapret без сети -------------------------------------
// Релизный ZIP распаковывается с верхней папкой вида
// «zapret-discord-youtube-1.10.3». Очистка прошлых выпусков принимала её за
// старьё и стирала файлы только что завершённой установки: статус «установлено»
// сменялся падением «Стратегия не найдена», повторные попытки качали заново.
const fixture = path.join(__dirname, 'fixtures', 'zapret-release-sim.zip');

(async () => {
  const modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-zapret-install-'));
  fs.cpSync(path.join(root, 'modules'), modulesDir, { recursive: true });
  const manager = new ModuleManager(modulesDir);
  await manager.init();
  const updater = new GithubUpdater(modulesDir, manager, () => false);

  // Установка вызывается напрямую: приватность в собранном JS не проверяется.
  const executable = await updater['installZapret'](fixture, '1.10.3');
  await manager.reload();

  const zapret = manager.list().find((item) => item.id === 'zapret');
  assert.ok(zapret, 'манифест zapret на месте');

  // Релиз развёрнут без верхней папки: winws лежит в bin/zapret, а не в
  // bin/zapret/zapret-discord-youtube-1.10.3.
  const executablePath = path.resolve(modulesDir, zapret.executable.replace(/^\.\//, ''));
  assert.equal(zapret.executable, './bin/zapret/bin/winws.exe', `исполняемый файл без верхней папки, получено: ${zapret.executable}`);
  assert.equal(fs.existsSync(executablePath), true, 'winws.exe пережил установку');

  // Профили запуска существуют на диске, служебный service.bat не в списке.
  const strategies = zapret.strategies ?? {};
  const names = Object.keys(strategies);
  assert.ok(names.includes('general (ALT10)'), 'профиль по умолчанию найден');
  assert.ok(!names.some((name) => /^service$/i.test(name)), 'служебные скрипты не попадают в профили');
  for (const value of Object.values(strategies)) {
    const filePath = path.resolve(modulesDir, value.replace(/^\.\//, ''));
    assert.equal(fs.existsSync(filePath), true, `профиль существует: ${value}`);
  }
  assert.equal(zapret.launch_mode, 'batch', 'режим запуска — через профиль');

  // Очистка не оставила папок прошлых выпусков.
  const leftovers = fs.readdirSync(path.join(modulesDir, 'bin', 'zapret'))
    .filter((name) => /^zapret-discord-youtube-/i.test(name));
  assert.equal(leftovers.length, 0, 'папка релиза развёрнута, версия не живёт отдельной папкой');

  // Версия установки фиксируется в манифесте.
  assert.equal(zapret.installed_version, '1.10.3', 'версия установки записана в манифест');

  fs.rmSync(modulesDir, { recursive: true, force: true });
  console.log('Zapret install cycle checks passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
