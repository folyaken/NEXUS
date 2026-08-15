const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  buildDpiExtraArgs,
  normalizeDpiExpertOptions,
  parseCustomDpiArguments,
  readDpiExpertOptions,
} = require(path.join(root, 'dist-electron', 'dpi-arguments.js'));
const { ModuleManager } = require(path.join(root, 'dist-electron', 'module-manager.js'));

// --- Безопасность пользовательской строки -----------------------------------
// Аргументы попадают в .cmd, который исполняет интерпретатор Windows, поэтому
// любой метасимвол означал бы выполнение произвольной команды.
assert.deepEqual(parseCustomDpiArguments('--hostcase --wssize=4'), ['--hostcase', '--wssize=4']);
assert.deepEqual(parseCustomDpiArguments('   '), []);
assert.deepEqual(parseCustomDpiArguments('--dpi-desync=fake,split2'), ['--dpi-desync=fake,split2']);

for (const dangerous of [
  '--hostcase & calc.exe',
  '--hostcase && shutdown',
  '--hostcase | more',
  '--hostcase > out.txt',
  '--hostcase\ncalc',
  '--host"case',
  '--hostcase%PATH%',
  '--hostcase^',
  '--hostcase;calc',
  '--hostcase$(id)',
  '--hostcase`id`',
  'calc.exe',
  '-hostcase',
]) {
  assert.throws(() => parseCustomDpiArguments(dangerous), /записан неверно|Ожидается вид/, `должен отклоняться: ${dangerous}`);
}

// Параметрами, которыми управляет приложение, пользователь управлять не может:
// подмена списка сайтов или портов сломала бы работу модуля.
for (const reserved of ['--hostlist=other.txt', '--wf-tcp=1', '--wf-udp=1', '--log=x']) {
  assert.throws(() => parseCustomDpiArguments(reserved), /задаётся автоматически/, reserved);
}

assert.throws(() => parseCustomDpiArguments(`--a${'b'.repeat(600)}`), /слишком длинная/);
assert.throws(() => parseCustomDpiArguments(Array.from({ length: 40 }, (_, i) => `--opt${i}`).join(' ')), /Слишком много/);

// --- Числовые поля ----------------------------------------------------------
assert.equal(normalizeDpiExpertOptions({ wssize: 4 }).wssize, 4);
assert.equal(normalizeDpiExpertOptions({ wssize: null }).wssize, null);
assert.equal(normalizeDpiExpertOptions({ wssize: '' }).wssize, null);
for (const invalid of [0, -1, 70000, 1.5, 'abc']) {
  assert.throws(() => normalizeDpiExpertOptions({ wssize: invalid }), /Размер фрагмента/, String(invalid));
}
for (const invalid of [0, 51, 2.5]) {
  assert.throws(() => normalizeDpiExpertOptions({ desyncRepeats: invalid }), /Повторы/, String(invalid));
}

// --- Сборка итоговых аргументов ---------------------------------------------
assert.deepEqual(buildDpiExtraArgs({ hostcase: true, hostdot: true, wssize: 4, desyncRepeats: 6, custom: '' }), [
  '--hostcase',
  '--hostdot',
  '--wssize=4',
  '--dpi-desync-repeats=6',
]);
assert.deepEqual(buildDpiExtraArgs({ hostcase: false, hostdot: false, wssize: null, desyncRepeats: null, custom: '' }), []);

// Чекбокс и ручной ввод не должны давать два одинаковых параметра.
assert.deepEqual(
  buildDpiExtraArgs({ hostcase: true, hostdot: false, wssize: 4, desyncRepeats: null, custom: '--hostcase --wssize=8 --new-flag' }),
  ['--hostcase', '--wssize=4', '--new-flag'],
  'первое значение выигрывает, дубликаты отбрасываются',
);

// --- Обратное чтение для формы ----------------------------------------------
const restored = readDpiExpertOptions(['--hostcase', '--wssize=4', '--dpi-desync-repeats=6', '--custom-flag']);
assert.equal(restored.hostcase, true);
assert.equal(restored.hostdot, false);
assert.equal(restored.wssize, 4);
assert.equal(restored.desyncRepeats, 6);
assert.equal(restored.custom, '--custom-flag');
assert.deepEqual(readDpiExpertOptions(undefined), { hostcase: false, hostdot: false, wssize: null, desyncRepeats: null, custom: '' });

// Круговой обход: сохранённое состояние восстанавливается без потерь.
const options = { hostcase: true, hostdot: true, wssize: 12, desyncRepeats: 3, custom: '--extra-flag' };
assert.deepEqual(readDpiExpertOptions(buildDpiExtraArgs(options)), options);

// --- Сохранение в манифест и запуск -----------------------------------------
void (async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-dpi-args-test-'));
  try {
    const manifestPath = path.join(temp, 'zapret.module.json');
    await fsp.writeFile(manifestPath, JSON.stringify({
      id: 'zapret',
      name: 'Обход DPI',
      description: 'Открывает YouTube, Discord и другие сайты без VPN.',
      enabled: false,
      executable: './bin/winws.exe',
      args: ['--wf-tcp=80,443', '--hostlist=lists/list-general.txt'],
      status: 'stopped',
      category: 'dpi',
      icon: 'S',
      pid: null,
      log_file: './logs/zapret.log',
    }, null, 2));

    const manager = new ModuleManager(temp);
    manager.setProcessScanner(async () => []);
    await manager.init();

    const updated = await manager.setExtraArgs('zapret', { hostcase: true, wssize: 4, custom: '--extra-flag' });
    assert.deepEqual(updated.extra_args, ['--hostcase', '--wssize=4', '--extra-flag']);

    // Параметры обязаны переживать пересканирование манифестов.
    const persisted = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    assert.deepEqual(persisted.extra_args, ['--hostcase', '--wssize=4', '--extra-flag']);
    await manager.reload();
    assert.deepEqual(manager.list().find((item) => item.id === 'zapret').extra_args, ['--hostcase', '--wssize=4', '--extra-flag']);

    // Опасный ввод не должен доходить до манифеста.
    await assert.rejects(manager.setExtraArgs('zapret', { custom: '--hostcase & calc.exe' }), /записан неверно|Ожидается вид/);
    assert.deepEqual(
      JSON.parse(await fsp.readFile(manifestPath, 'utf8')).extra_args,
      ['--hostcase', '--wssize=4', '--extra-flag'],
      'после отклонённого ввода сохранённые параметры не меняются',
    );

    // Очистка формы убирает все аргументы.
    assert.deepEqual((await manager.setExtraArgs('zapret', {})).extra_args, []);

    console.log('DPI expert arguments checks passed.');
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
})();

// --- Профили запуска берутся из релиза целиком ------------------------------
const updaterSource = fs.readFileSync(path.join(root, 'src', 'main', 'github-updater.ts'), 'utf8');
assert.match(updaterSource, /findBatchProfiles/, 'профили должны обнаруживаться, а не задаваться списком');
assert.doesNotMatch(
  updaterSource,
  /\['general \(ALT10\)', 'general \(ALT11\)', 'general \(ALT12\)'\]/,
  'жёстко заданные три профиля скрывали остальные стратегии релиза',
);

// Служебные скрипты не должны попадать в список профилей.
const skipPattern = updaterSource.match(/const skip = (\/[^\n]+\/i);/)?.[1];
assert.ok(skipPattern, 'нужен фильтр служебных .bat');
const skip = new RegExp(skipPattern.slice(1, -2), 'i');
for (const service of ['service_install.bat', 'check_updates.bat', 'cleanup.bat', 'diagnostics.bat', 'stop.bat', 'blockcheck.bat']) {
  assert.equal(skip.test(service), true, `${service} не должен быть профилем`);
}
for (const profile of ['general (ALT10).bat', 'general (ALT2).bat', 'discord.bat', 'youtube.bat']) {
  assert.equal(skip.test(profile), false, `${profile} должен остаться профилем`);
}

// Runner обязан фильтровать аргументы повторно: он пишет их в исполняемый .cmd.
const managerSource = fs.readFileSync(path.join(root, 'src', 'main', 'module-manager.ts'), 'utf8');
assert.match(managerSource, /createBatchRunner\(id: string, batchFile: string, extraArgs: string\[\] = \[\]\)/);
assert.match(managerSource, /const safeArgs = extraArgs/, 'runner должен проверять аргументы перед записью в .cmd');
