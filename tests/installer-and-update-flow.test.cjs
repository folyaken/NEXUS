const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const nsis = manifest.build.nsis;
const updater = fs.readFileSync(path.join(root, 'src', 'main', 'app-updater.ts'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');

// --- Обновление ставится само и запускает программу -------------------------------
// Раньше вызывался quitAndInstall(false, true): установщик открывал полный
// мастер — выбор папки, лицензия и обязательное «Готово» в конце. Человек
// только что нажал «Перезапустить и установить» и ждёт, что дальше всё
// произойдёт само, а вместо этого получал пять лишних шагов.
const install = updater.slice(updater.indexOf('async install('));
assert.match(install, /updater\.quitAndInstall\(true, true\)/,
  'обновление обязано ставиться тихо и запускать NEXUS само');
assert.doesNotMatch(install, /quitAndInstall\(false/, 'мастер при обновлении открываться не должен');
// Перед установкой обязательно остановить VPN и модули: иначе в системе
// останутся winws.exe и изменённый прокси, и пользователь потеряет сеть.
assert.match(install, /await beforeQuit\(\)/);
assert.ok(install.indexOf('await beforeQuit()') < install.indexOf('quitAndInstall'),
  'остановка модулей обязана идти до перезапуска');

// Второй аргумент включает ключ --force-run у установщика: без него программа
// после тихой установки просто не откроется.
const nsisUpdater = path.join(root, 'node_modules', 'electron-updater', 'out', 'NsisUpdater.js');
if (fs.existsSync(nsisUpdater)) {
  const source = fs.readFileSync(nsisUpdater, 'utf8');
  assert.match(source, /isForceRunAfter[\s\S]{0,80}--force-run/,
    'поведение electron-updater изменилось — проверьте аргументы quitAndInstall');
  assert.match(source, /options\.isSilent[\s\S]{0,60}"\/S"/,
    'тихий режим передаётся установщику ключом /S');
}

// --- Оформление установщика -------------------------------------------------------
// Установщик показывал стандартную синеватую заставку NSIS: первое, что видит
// человек после скачивания, выглядело чужим.
assert.equal(nsis.installerSidebar, 'build/installer-sidebar.bmp');
assert.equal(nsis.uninstallerSidebar, 'build/installer-sidebar.bmp');
assert.equal(nsis.installerHeader, 'build/installer-header.bmp');
assert.equal(nsis.installerIcon, 'assets/nexus.ico');
assert.equal(nsis.runAfterFinish, true, 'после первой установки программа должна запускаться сама');

// Картинки рисуются перед сборкой, а не лежат в репозитории.
const releaseScript = fs.readFileSync(path.join(root, 'scripts', 'build-release.cjs'), 'utf8');
assert.match(releaseScript, /make-installer-art\.cjs/, 'оформление обязано готовиться перед сборкой');
assert.match(manifest.scripts['package:win'], /make-installer-art\.cjs/);
assert.ok(fs.existsSync(path.join(root, 'scripts', 'make-installer-art.cjs')));
const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
assert.match(ignore, /installer-\*\.bmp/, 'производные картинки не хранятся в репозитории');

// Размеры продиктованы NSIS: другие он молча обрежет.
const art = fs.readFileSync(path.join(root, 'scripts', 'make-installer-art.cjs'), 'utf8');
assert.match(art, /SIDEBAR = \{ width: 164, height: 314 \}/);
assert.match(art, /HEADER = \{ width: 150, height: 57 \}/);
// Заголовок BMP собирается вручную: готовых записывающих библиотек в проекте нет.
assert.match(art, /function writeBmp\(/);
assert.match(art, /header\.write\('BM', 0, 'ascii'\)/);
// Скрипт обязан работать на чистом Node.
//
// Первая версия рисовала через sharp: пакет тянет платформенные двоичные
// файлы, ставится не везде, и на машине пользователя сборка молча оставалась
// без оформления. Никаких внешних зависимостей здесь быть не должно.
const requires = [...art.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]);
assert.deepEqual(
  requires.filter((name) => !name.startsWith('node:')),
  [],
  `оформление установщика обязано работать без сторонних пакетов, найдено: ${requires.join(', ')}`,
);
// Сглаживание: без него диагонали логотипа выходят «лесенкой».
assert.match(art, /SUPERSAMPLE = \d/);
assert.match(art, /function downscale\(/);

// Если картинки уже собраны, проверяем их формат по-настоящему.
for (const [name, width, height] of [['installer-sidebar.bmp', 164, 314], ['installer-header.bmp', 150, 57]]) {
  const file = path.join(root, 'build', name);
  if (!fs.existsSync(file)) continue;
  const data = fs.readFileSync(file);
  assert.equal(data.subarray(0, 2).toString('ascii'), 'BM', `${name}: NSIS принимает только BMP`);
  assert.equal(data.readInt32LE(18), width, `${name}: ширина обязана быть ${width}`);
  assert.equal(data.readInt32LE(22), height, `${name}: высота обязана быть ${height}`);
  assert.equal(data.readUInt16LE(28), 24, `${name}: нужен 24-битный BMP`);
}

// --- Кнопка «Проверить обновления» ---------------------------------------------------
// Во время проверки кнопка просто гасла: было непонятно, идёт работа или
// программа зависла.
assert.match(app, /className=\{`github-button \$\{syncing \? 'is-busy' : ''\}`\}/);
assert.match(app, /className="github-button-icon"><RefreshGlyph \/>/);
assert.match(app, /className="github-button-progress"/, 'ход загрузки показывает полоска');
assert.doesNotMatch(app, /github-button"[^>]*>\{syncing[\s\S]{0,120}<span>↗<\/span>/, 'символ ↗ заменён значком');
assert.match(styles, /\.github-button\.is-busy \.github-button-icon \.spin-ico \{ animation: refresh-turn/);
assert.match(styles, /\.github-button-progress \{/);
// Анимация подчиняется настройке движения, как и всё остальное.
assert.ok(styles.includes('.app-frame:not(.motion-force) .github-button.is-busy .github-button-icon .spin-ico'));
assert.ok(styles.includes('.app-frame.motion-off .github-button.is-busy .github-button-icon .spin-ico'));

// --- Кнопка «Все модули» не должна быть громоздкой -------------------------------------
// Выглядела крупной и жирной — неуместно рядом с заголовком раздела.
const textButton = styles.slice(styles.indexOf('.text-button { display: inline-flex'));
const rule = textButton.slice(0, textButton.indexOf('}'));
assert.match(rule, /font-size: 11px/, 'подпись должна быть мельче заголовка');
assert.match(rule, /font-weight: 500/, 'жирное начертание выглядело тяжело');
assert.match(rule, /padding: 5px 8px 5px 10px/);
// Стрелка «Все модули» нарисована линией — она должна быть тонкой.
assert.match(styles, /\.text-button-arrow svg \{[^}]*stroke-width: 1\.6/);

// Значок обновления рисуется сплошной заливкой (fill), как в Jey2Ray.
// Общее правило .quiet-button-icon svg навязывало ему ещё и обводку поверх
// заливки: контур наращивался с обеих сторон, и стрелка выглядела жирной.
// Обводка нужна только контурным значкам, поэтому правило исключает .spin-ico.
assert.match(styles, /\.quiet-button-icon svg:not\(\.spin-ico\) \{[^}]*stroke-width: 1\.6/,
  'обводка должна применяться только к контурным значкам');
assert.match(styles, /\.quiet-button-icon \.spin-ico \{[^}]*stroke: none/,
  'у заливочного значка не должно быть обводки');
assert.match(styles, /\.github-button-icon \.spin-ico \{[^}]*stroke: none/);
// Общее правило не должно задавать обводку всем значкам подряд.
assert.doesNotMatch(styles, /\.quiet-button-icon svg \{[^}]*stroke-width/,
  'обводка в общем правиле снова утолщает заливочный значок');

// --- Страница «Готово» пропускается при обновлении -------------------------------
// Тихий режим ставит обновление без окон, но шаблон electron-builder всё равно
// добавляет финальную страницу с кнопкой «Готово» — на ней установка и
// останавливалась. Пропуск сделан в самом установщике намеренно: команду на
// установку отдаёт УЖЕ УСТАНОВЛЕННАЯ (старая) копия программы, поэтому правка
// в коде приложения на текущее обновление не повлияла бы.
const nsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
assert.match(nsh, /!macro customFinishPage/, 'нужна своя финальная страница');
assert.match(nsh, /Function NexusSkipFinishPage/);
assert.match(nsh, /\$\{if\} \$\{isUpdated\}[\s\S]{0,120}Call NexusLaunchAfterInstall[\s\S]{0,40}Abort/,
  'при обновлении страница обязана пропускаться, а программа — запускаться');
assert.match(nsh, /MUI_PAGE_CUSTOMFUNCTION_PRE NexusSkipFinishPage/);
// Запуск от имени пользователя: NEXUS работает с правами администратора, и без
// этого окно открылось бы в чужом сеансе.
assert.match(nsh, /StdUtils\.ExecShellAsUser/);
// Макрос StartApp объявляет Var /GLOBAL startAppArgs, а его уже объявляет
// installSection — повторное объявление обрывает сборку установщика.
assert.doesNotMatch(nsh, /!insertmacro StartApp/, 'повторное объявление переменной сломает сборку');
// Весь блок объявлен только для установщика: при сборке деинсталлятора страниц
// нет, и ссылка на функции оборвалась бы.
const finishBlock = nsh.slice(nsh.indexOf('!macro customFinishPage'), nsh.indexOf('!macroend', nsh.indexOf('!macro customFinishPage')));
assert.match(finishBlock, /!ifndef BUILD_UNINSTALLER/);

// --- Окно обновления показывает ход дела ------------------------------------------
// Была только полоска без единой цифры: при файле на 90 МБ непонятно, сколько
// ждать и идёт ли загрузка вообще.
assert.match(app, /className="about-update-progress-meta"/);
assert.match(app, /formatBytes\(updateCheck\.totalBytes\)/, 'нужен размер файла');
assert.match(app, /Math\.round\(updateCheck\?\.percent \?\? 0\)\}%/, 'нужен процент цифрой');
assert.match(app, /className="about-update-steps"/, 'нужны шаги обновления');
assert.match(styles, /\.about-update-steps li\.is-current/);
assert.match(styles, /\.about-update-steps li\.is-done/);
// Бегущий блик показывает, что процесс не замер, и подчиняется настройке движения.
assert.match(styles, /@keyframes update-sheen/);
assert.ok(styles.includes('.app-frame:not(.motion-force) .about-update-progress-bar:after'));
assert.ok(styles.includes('.app-frame.motion-off .about-update-progress-bar:after'));

console.log('Installer art and update flow checks passed.');
