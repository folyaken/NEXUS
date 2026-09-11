const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  buildZapretLaunch,
  ensureZapretUserLists,
  parseZapretProfile,
  readGameFilter,
  tokenizeCommandLine,
} = require(path.join(root, 'dist-electron', 'zapret-profile.js'));

// Точная копия начала профиля «general (ALT10).bat» из релиза Zapret 1.10.1:
// именно на нём модуль падал с ошибкой «'--filter-udp' is not recognized».
const REAL_PROFILE = [
  '@echo off',
  'chcp 65001 > nul',
  ':: 65001 - UTF-8',
  '',
  'cd /d "%~dp0"',
  'call service.bat status_zapret',
  'call service.bat check_updates',
  'call service.bat load_game_filter',
  'call service.bat load_user_lists',
  'echo:',
  '',
  'set "BIN=%~dp0bin\\"',
  'set "LISTS=%~dp0lists\\"',
  'cd /d %BIN%',
  '',
  'start "zapret: %~n0" /min "%BIN%winws.exe" --wf-tcp=80,443,%GameFilterTCP% --wf-udp=443,%GameFilterUDP% ^',
  '--filter-udp=443 --hostlist="%LISTS%list-general.txt" --hostlist="%LISTS%list-general-user.txt" --dpi-desync=fake --dpi-desync-repeats=6 --new ^',
  '--filter-tcp=80,443 --hostlist="%LISTS%list-general.txt" --dpi-desync=fake --dpi-desync-fooling=ts',
].join('\r\n');

// --- Разбор строки на аргументы ---------------------------------------------
// Кавычки группируют пробелы и в готовый аргумент попадать не должны: иначе
// ядро получит путь вместе с кавычками и не найдёт файл.
assert.deepEqual(tokenizeCommandLine('a "b c" d'), ['a', 'b c', 'd']);
assert.deepEqual(tokenizeCommandLine('--hostlist="C:\\Program Files\\list.txt"'), ['--hostlist=C:\\Program Files\\list.txt']);
assert.deepEqual(tokenizeCommandLine('   '), []);

// --- Разбор настоящего профиля ----------------------------------------------
const parsed = parseZapretProfile(REAL_PROFILE, {
  batDirectory: path.join('C:', 'zapret'),
  gameFilter: { tcp: '12', udp: '12' },
});
assert.ok(parsed, 'профиль релиза обязан разбираться');
assert.match(parsed.executable, /winws\.exe$/);
assert.ok(!/^start$/i.test(parsed.args[0]), 'служебные слова cmd в аргументы не попадают');

// Главное: строки, перенесённые через ^, склеиваются в одну команду. Раньше
// вторая строка выполнялась отдельно, и cmd сообщал, что не знает такой команды.
assert.ok(parsed.args.includes('--filter-udp=443'), '--filter-udp обязан стать аргументом ядра, а не отдельной командой');
assert.ok(parsed.args.includes('--dpi-desync-fooling=ts'), 'последняя строка профиля тоже должна попасть в команду');
assert.ok(parsed.args.includes('--new'), 'разделители секций сохраняются');

// Переменные профиля разворачиваются в настоящие пути.
const hostlist = parsed.args.find((item) => item.startsWith('--hostlist='));
assert.ok(hostlist.includes('list-general.txt'));
assert.ok(!hostlist.includes('%'), `путь обязан быть развёрнут: ${hostlist}`);
for (const argument of parsed.args) {
  assert.ok(!argument.includes('%'), `неразвёрнутая переменная: ${argument}`);
  assert.ok(!argument.includes('"'), `кавычки не передаются ядру: ${argument}`);
  assert.notEqual(argument, '^', 'символ переноса строки не является аргументом');
}

// Игровой фильтр подставляется из состояния Zapret, а не остаётся пустым:
// пустое значение в списке портов ядро считает ошибкой.
assert.ok(parsed.args.includes('--wf-tcp=80,443,12'), 'выключенный игровой фильтр подставляет 12');
const enabled = parseZapretProfile(REAL_PROFILE, {
  batDirectory: path.join('C:', 'zapret'),
  gameFilter: { tcp: '1024-65535', udp: '1024-65535' },
});
assert.ok(enabled.args.includes('--wf-tcp=80,443,1024-65535'), 'включённый игровой фильтр расширяет диапазон');

// Профиль непонятного вида не разбирается наполовину: лучше запасной путь.
assert.equal(parseZapretProfile('@echo off\r\necho hello', { batDirectory: 'C:\\x' }), null);
assert.equal(
  parseZapretProfile('start "" "%BIN%winws.exe" --filter-udp=%UNKNOWN_VAR%', { batDirectory: 'C:\\x' }),
  null,
  'неизвестная переменная означает отказ от прямого запуска',
);

void (async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-zapret-profile-'));
  try {
    const releaseRoot = path.join(temp, 'zapret-discord-youtube-1.10.1');
    const binDirectory = path.join(releaseRoot, 'bin');
    await fsp.mkdir(binDirectory, { recursive: true });
    await fsp.mkdir(path.join(releaseRoot, 'utils'), { recursive: true });
    await fsp.writeFile(path.join(binDirectory, 'winws.exe'), 'stub');
    const batchFile = path.join(releaseRoot, 'general (ALT10).bat');
    await fsp.writeFile(batchFile, REAL_PROFILE);

    // --- Пользовательские списки ---------------------------------------------
    // Их обычно создаёт service.bat. Ядро запускается напрямую, поэтому файлы
    // создаёт приложение — без них winws.exe завершается с ошибкой.
    await ensureZapretUserLists(releaseRoot);
    for (const name of ['list-general-user.txt', 'list-exclude-user.txt', 'ipset-exclude-user.txt']) {
      assert.ok(fs.existsSync(path.join(releaseRoot, 'lists', name)), `нужен файл ${name}`);
    }
    // Существующий список не затирается: в нём сайты пользователя.
    const userList = path.join(releaseRoot, 'lists', 'list-general-user.txt');
    await fsp.writeFile(userList, 'example.com\r\n');
    await ensureZapretUserLists(releaseRoot);
    assert.equal(await fsp.readFile(userList, 'utf8'), 'example.com\r\n');

    // --- Игровой фильтр читается из релиза -----------------------------------
    assert.deepEqual(await readGameFilter(releaseRoot), { tcp: '12', udp: '12' });
    await fsp.writeFile(path.join(releaseRoot, 'utils', 'game_filter.enabled'), 'all\r\n');
    assert.deepEqual(await readGameFilter(releaseRoot), { tcp: '1024-65535', udp: '1024-65535' });

    // --- Готовая команда запуска ---------------------------------------------
    const launch = await buildZapretLaunch(batchFile, releaseRoot, ['--hostcase']);
    assert.ok(launch, 'команда запуска должна собираться');
    assert.equal(launch.executable, path.join(binDirectory, 'winws.exe'));
    assert.equal(launch.cwd, binDirectory, 'ядро работает из своей папки bin');
    // Экспертные параметры уходят в конец: Zapret применяет последнее значение,
    // поэтому настройка пользователя перекрывает записанное в профиле.
    assert.equal(launch.args[launch.args.length - 1], '--hostcase');
    assert.ok(launch.args.includes('--filter-udp=443'));

    // Без ядра на диске прямой запуск невозможен — нужен запасной путь.
    await fsp.rm(path.join(binDirectory, 'winws.exe'));
    assert.equal(await buildZapretLaunch(batchFile, releaseRoot, []), null);

    console.log('Zapret profile parsing checks passed.');
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
})();
