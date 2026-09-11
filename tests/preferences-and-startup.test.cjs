const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { DEFAULT_SETTINGS } = require(path.join(root, 'dist-electron', 'types.js'));
const { ModuleManager } = require(path.join(root, 'dist-electron', 'module-manager.js'));
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'src', 'main', 'i18n.ts'), 'utf8');

// --- Анимации ---------------------------------------------------------------
// Windows умеет глобально отключать анимации, и приложение честно подчинялось:
// у части пользователей орбиты и индикаторы выглядели застывшими, будто
// программа сломана. Теперь выбор пользователя важнее системного.
assert.equal(DEFAULT_SETTINGS.motion, 'full', 'по умолчанию движение включено');
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.app-frame:not\(\.motion-force\)/);
assert.match(styles, /\.app-frame\.motion-off[\s\S]*?animation: none;/);
assert.match(app, /motion === 'full' \? 'motion-force'/);
assert.match(app, /motion === 'reduced' \? 'motion-off'/);
// Два варианта, а не три. Пункт «Как в Windows» убран: человек видел
// застывший интерфейс, шёл в настройки, а там уже было написано «включены»
// (по системе) — и он не понимал, что нажимать. Анимации либо работают, либо
// нет, третьего состояния у настройки быть не должно.
for (const option of ['Включены', 'Выключены']) {
  assert.ok(app.includes(option), `нужен вариант «${option}»`);
}
assert.ok(!app.includes('Как в Windows'), 'вариант «Как в Windows» должен быть убран');
assert.ok(!/'system'/.test(main.slice(main.indexOf('motion:'), main.indexOf('motion:') + 400)),
  'режим system больше не сохраняется');
// Старое значение из уже сохранённых настроек приводится к «включены»:
// иначе у этих пользователей анимаций не будет, а переключателя в таком
// положении в интерфейсе уже нет.
assert.match(main, /motion: raw\.motion === 'reduced' \? 'reduced' : 'full'/);

// --- Запуск вместе с Windows -------------------------------------------------
assert.equal(DEFAULT_SETTINGS.launchAtLogin, false, 'без спроса в автозапуск не добавляемся');
assert.match(main, /function applyLaunchAtLogin/);
assert.match(main, /app\.setLoginItemSettings/);
// Регистрацией занимается система: ручная правка реестра ломается при
// обновлении и требует лишних прав.
assert.doesNotMatch(main, /CurrentVersion\\\\Run/, 'реестр вручную не правим');
// В среде разработки автозапуск не регистрируется: иначе система запускала бы
// временную сборку вместо установленной программы.
assert.match(main, /if \(process\.platform !== 'win32' \|\| !app\.isPackaged\) return;/);
// Настройка применяется и при старте: после обновления путь к программе
// меняется, и старая запись указывала бы в никуда.
assert.match(main, /applyLaunchAtLogin\(settings\.launchAtLogin\)/);
// Окно при входе в систему не показывается — программа уходит в трей.
assert.match(main, /const startHidden = startedByWindowsLogin\(\)/);
assert.match(main, /show: !startHidden/);

// --- Порядок модулей ---------------------------------------------------------
void (async () => {
  const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-order-'));
  try {
    const write = (id, name, development) => fs.writeFileSync(
      path.join(directory, `${id}.module.json`),
      JSON.stringify({ id, name, executable: './x.exe', development }),
    );
    // Порядок файлов на диске намеренно обратный нужному.
    write('dns-guard', 'DNS Guard', true);
    write('exitlag-sdk', 'ExitLag', true);
    write('tg-ws-proxy', 'Telegram Proxy', false);
    write('zapret', 'Обход DPI', false);

    const manager = new ModuleManager(directory);
    manager.setProcessScanner(async () => []);
    await manager.init();

    const order = manager.list().map((item) => item.id);
    // Готовые к работе идут первыми: иначе человек первым делом видит то, что
    // включить нельзя, и решает, что программа не работает.
    assert.deepEqual(order, ['zapret', 'tg-ws-proxy', 'dns-guard', 'exitlag-sdk']);

    // Ни один недоделанный модуль не должен стоять выше рабочего.
    const flags = manager.list().map((item) => Boolean(item.development));
    assert.deepEqual(flags, [...flags].sort((left, right) => Number(left) - Number(right)),
      'недоделанные модули обязаны идти после рабочих');

    console.log('Preferences, startup and module order checks passed.');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})();

// --- Галочки ярлыков в установщике -------------------------------------------
// Установщик создавал ярлыки молча. Теперь пользователь решает сам.
assert.match(installer, /!macro customPageAfterChangeDir/);
assert.match(installer, /Создать значок на рабочем столе/);
assert.match(installer, /Добавить NEXUS в меню «Пуск»/);
// Обе галочки отмечены заранее — это привычное поведение.
assert.match(installer, /StrCpy \$NexusWantDesktop "1"/);
assert.match(installer, /StrCpy \$NexusWantStartMenu "1"/);
// При обновлении вопрос не задаётся повторно. Пропуск сделан внутри самой
// страницы: макрос skipPageIfUpdated рассчитан на страницы MUI и с собственной
// страницей прервал бы установку целиком.
assert.match(installer, /\$\{if\} \$\{isUpdated\}\s*\n\s*Abort/);
assert.doesNotMatch(installer, /!insertmacro skipPageIfUpdated/,
  'штатный пропуск несовместим с собственной страницей');
// Кнопка «Запустить» в конце установки ссылается на ярлык меню «Пуск». Если
// ярлык не создавать, запуск завершился бы ошибкой «файл не найден».
assert.match(installer, /StrCpy \$launchLink "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}"/);
// Каталог меню удаляется только пустым: чужие ярлыки трогать нельзя.
assert.match(installer, /RMDir "\$SMPROGRAMS\\\$\{MENU_FILENAME\}"/);


// Файл дополнений подключается и при сборке деинсталлятора. Там нет ни страниц,
// ни nsDialogs, а компилятор NSIS запускается с ключом «предупреждения как
// ошибки» — из-за этого сборка обрывалась на этапе деинсталлятора, и установщик
// не создавался вовсе.
const renderInstaller = (defines) => {
  const output = [];
  const stack = [true];
  for (const line of installer.split('\n')) {
    const text = line.trim();
    if (text.startsWith('!ifndef ')) { stack.push(stack[stack.length - 1] && !defines.has(text.split(/\s+/)[1])); continue; }
    if (text.startsWith('!ifdef ')) { stack.push(stack[stack.length - 1] && defines.has(text.split(/\s+/)[1])); continue; }
    if (text === '!endif') { stack.pop(); continue; }
    // Комментарии отбрасываются: слово в пояснении не должно выдавать себя за
    // работающий код.
    if (stack[stack.length - 1] && !text.startsWith(';')) output.push(line);
  }
  assert.equal(stack.length, 1, 'условия в installer.nsh должны быть парными');
  return output.join('\n');
};

const forInstaller = renderInstaller(new Set(['MENU_FILENAME']));
const forUninstaller = renderInstaller(new Set(['BUILD_UNINSTALLER', 'MENU_FILENAME']));

// В установщике страница есть целиком.
assert.match(forInstaller, /Page custom NexusShortcutPageShow/);
assert.match(forInstaller, /Function NexusShortcutPageShow/);
assert.match(forInstaller, /nsDialogs::Create/);

// В деинсталляторе её нет вовсе — ни объявления, ни ссылки на функции.
assert.doesNotMatch(forUninstaller, /Page custom/, 'страница не должна попадать в деинсталлятор');
assert.doesNotMatch(forUninstaller, /nsDialogs::/, 'nsDialogs недоступен при сборке деинсталлятора');
assert.doesNotMatch(forUninstaller, /Var NexusWantDesktop/);

// А вот остановка процессов и возврат системного прокси нужны именно
// деинсталлятору: без них после удаления пользователь теряет интернет.
assert.match(forUninstaller, /stopNexusWorkers/);
assert.match(forUninstaller, /restoreSystemProxy/);

// --- Английский язык ----------------------------------------------------------
assert.match(i18n, /export function createTranslator/);
// Русский текст остаётся ключом: если перевода нет, показывается оригинал, а не
// пустое место.
assert.match(i18n, /dictionary\[text\] \?\? text/);
assert.match(app, /createTranslator\(settings\.language\)/);
assert.ok(app.includes("language: 'en'"), 'нужен переключатель на английский');

const { createTranslator, hasTranslation } = require(path.join(root, 'dist-electron', 'i18n.js'));
assert.equal(createTranslator('en')('Настройки'), 'Settings');
assert.equal(createTranslator('ru')('Настройки'), 'Настройки', 'русский остаётся без изменений');
assert.equal(createTranslator('en')('Строка без перевода'), 'Строка без перевода');
assert.equal(hasTranslation('en', 'Настройки'), true);
assert.equal(hasTranslation('en', 'Строка без перевода'), false);

// Ключевые экраны обязаны быть переведены: язык переключают ради них.
for (const phrase of [
  'Настройки', 'Модули', 'Журнал', 'О программе', 'Серверы', 'Подписки',
  'Язык интерфейса', 'Анимации', 'Запускать вместе с Windows', 'Обход DPI',
]) {
  assert.equal(hasTranslation('en', phrase), true, `нужен перевод: «${phrase}»`);
}
