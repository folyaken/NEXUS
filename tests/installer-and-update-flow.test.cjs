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
// sharp не умеет записывать BMP, поэтому заголовок собирается вручную.
assert.match(art, /function writeBmp\(/);
assert.match(art, /header\.write\('BM', 0, 'ascii'\)/);
// Отсутствие sharp не должно ронять сборку: без картинок установщик соберётся.
assert.match(art, /Оформление установщика пропущено/);

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
// Стрелки нарисованы тонкой линией: жирная смотрелась грубо.
assert.match(styles, /\.text-button-arrow svg \{[^}]*stroke-width: 1\.6/);
assert.match(styles, /\.quiet-button-icon svg \{[^}]*stroke-width: 1\.6/);

console.log('Installer art and update flow checks passed.');
