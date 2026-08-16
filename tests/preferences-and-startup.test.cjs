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
// Три понятных варианта вместо одного «как в системе».
for (const option of ['Включены', 'Как в Windows', 'Выключены']) {
  assert.ok(app.includes(option), `нужен вариант «${option}»`);
}

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
