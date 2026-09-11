const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const launch = require(path.join(root, 'dist-electron', 'launch-at-login.js'));
const source = fs.readFileSync(path.join(root, 'src', 'main', 'launch-at-login.ts'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Автозапуск не работал: программа объявлена как требующая прав администратора,
// а такие приложения Windows из раздела автозапуска реестра не запускает вовсе —
// показать запрос прав до входа в систему некому, и запись молча игнорируется.
// Пользователь видел включённый переключатель и незапускающуюся программу.
//
// Рабочий путь один: задание в планировщике с наивысшими правами.

// Условие, которое и создало проблему, — проверяем, что оно всё ещё в силе.
assert.equal(manifest.build.win.requestedExecutionLevel, 'requireAdministrator');

// --- Состав команды планировщика ------------------------------------------------
const args = launch.createTaskArguments('C:\\Program Files\\NEXUS\\NEXUS.exe', 'PC\\user');
const line = args.join(' ');

// Без наивысших прав задание создастся, но программа снова не запустится.
assert.ok(line.includes('/RL HIGHEST'), 'нужны наивысшие права');
// Запуск именно при входе в систему.
assert.ok(line.includes('/SC ONLOGON'), 'задание обязано срабатывать при входе');
// Перезапись существующего задания: иначе повторное включение упадёт с ошибкой.
assert.ok(args.includes('/F'), 'задание обязано перезаписываться');
// Задание создаётся для конкретного пользователя, а не для всех.
assert.ok(line.includes('/RU PC\\user'));

// Путь к программе обязан быть в кавычках: в «Program Files» есть пробел, без
// кавычек планировщик обрежет команду и запустит не то.
const target = args[args.indexOf('/TR') + 1];
assert.match(target, /^"C:\\Program Files\\NEXUS\\NEXUS\.exe"/, 'путь обязан быть в кавычках');
// Признак запуска системой: по нему окно не показывается, программа уходит в трей.
assert.ok(target.endsWith(launch.LAUNCH_AT_LOGIN_FLAG));

// --- Поведение включения и выключения ---------------------------------------------
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
Object.defineProperty(process, 'platform', { value: 'win32' });

void (async () => {
  try {
    const calls = [];
    const succeed = async (file, params) => { calls.push(params[0]); return { stdout: '', stderr: '' }; };

    assert.equal(await launch.setLoginTask(true, 'C:\\NEXUS\\NEXUS.exe', succeed, { USERNAME: 'user' }), null);
    assert.equal(calls[0], '/Create', 'включение создаёт задание');

    calls.length = 0;
    assert.equal(await launch.setLoginTask(false, 'C:\\NEXUS\\NEXUS.exe', succeed, { USERNAME: 'user' }), null);
    assert.equal(calls[0], '/Delete', 'выключение удаляет задание');

    // Отсутствие задания при выключении — не ошибка.
    const absent = async () => { throw new Error('ERROR: The system cannot find the file specified.'); };
    assert.equal(await launch.setLoginTask(false, 'C:\\NEXUS\\NEXUS.exe', absent, { USERNAME: 'user' }), null);

    // Отказ обязан объясняться понятно, а не молчать: пользователь включил
    // переключатель и должен узнать, что настройка не применилась.
    const denied = async () => { throw new Error('ERROR: Access is denied.'); };
    const deniedMessage = await launch.setLoginTask(true, 'C:\\NEXUS\\NEXUS.exe', denied, { USERNAME: 'user' });
    assert.match(deniedMessage, /недостаточно прав/);

    const disabled = async () => { throw new Error('The Task Scheduler service is disabled'); };
    assert.match(
      await launch.setLoginTask(true, 'C:\\NEXUS\\NEXUS.exe', disabled, { USERNAME: 'user' }),
      /планировщик заданий Windows отключён/,
    );

    // Наличие задания определяется запросом к планировщику.
    assert.equal(await launch.hasLoginTask(async () => ({ stdout: launch.TASK_NAME, stderr: '' })), true);
    assert.equal(await launch.hasLoginTask(async () => { throw new Error('not found'); }), false);

    // Имя пользователя с доменом и без — оба случая рабочие.
    assert.equal(launch.currentUserAccount({ USERNAME: 'user', USERDOMAIN: 'PC' }), 'PC\\user');
    assert.equal(launch.currentUserAccount({ USERNAME: 'user' }), 'user');

    console.log('Launch-at-login checks passed.');
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
})();

// --- Подключение к программе --------------------------------------------------------
assert.match(main, /setLoginTask\(enabled, process\.execPath\)/);
// Прежняя запись в реестре не работает, но остаётся видна в списке автозагрузки —
// её нужно убрать, чтобы не вводить пользователя в заблуждение.
assert.match(main, /legacyRunKeyCleanup/);
assert.match(source, /export function legacyRunKeyCleanup/);
// О неудаче пользователю сообщают.
assert.match(main, /if \(problem\) notify\('NEXUS', problem\)/);
// В среде разработки в автозапуск попала бы временная сборка.
assert.match(main, /if \(process\.platform !== 'win32' \|\| !app\.isPackaged\) return;/);
// Полный путь к планировщику: у программы с правами администратора переменная
// PATH может отличаться от пользовательской.
assert.match(source, /System32\\\\schtasks\.exe/);

console.log('Launch-at-login static checks passed.');
