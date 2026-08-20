const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const tsconfigMain = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.main.json'), 'utf8'));

// --- Ничего постороннего не уезжает пользователю ---------------------------------
// package.json целиком попадает внутрь asar: его видно всякому, кто распакует
// установленную программу. Любые следы окружения, в котором писался код, должны
// остаться в исходниках, а не в готовом продукте.
const manifestText = JSON.stringify(manifest);
for (const pattern of [/arena/i, /\bagent\b/i, /assistant/i, /copilot/i]) {
  assert.doesNotMatch(manifestText, pattern, `в манифесте не должно быть посторонних упоминаний: ${pattern}`);
}
assert.equal(manifest.build.appId, 'com.folyaken.nexus');
assert.equal(manifest.author, 'NEXUS');

// В сборку попадают только перечисленные файлы. Исходники, тесты и служебные
// документы внутрь .exe уезжать не должны.
const packed = manifest.build.files.join('\n');
for (const leak of ['src/**', 'tests/**', 'scripts/**', '*.md']) {
  assert.ok(!manifest.build.files.includes(leak), `${leak} не должен попадать в сборку`);
}
assert.ok(packed.includes('dist/**/*') && packed.includes('dist-electron/**/*'));

// --- Комментарии не уезжают в собранный код ----------------------------------------
// Комментарии в проекте объясняют, какая была проблема и почему код такой.
// Внутри asar это подсказка, где у программы слабые места, — вырезаем.
assert.equal(tsconfigMain.compilerOptions.removeComments, true,
  'комментарии обязаны вырезаться из собранного main-процесса');

const builtMain = path.join(root, 'dist-electron', 'main.js');
if (fs.existsSync(builtMain)) {
  const built = fs.readFileSync(builtMain, 'utf8');
  for (const marker of ['Раньше', 'проблем', 'arena', 'TODO', 'FIXME']) {
    assert.ok(!built.includes(marker), `в собранном коде остался след: ${marker}`);
  }
}

// Карты кода восстанавливают исходник целиком — в готовой сборке их быть не должно.
for (const dir of ['dist', 'dist-electron']) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  const maps = [];
  const walk = (place) => {
    for (const entry of fs.readdirSync(place, { withFileTypes: true })) {
      const target = path.join(place, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.name.endsWith('.map')) maps.push(path.relative(root, target));
    }
  };
  walk(full);
  assert.deepEqual(maps, [], `карты кода раскрывают исходники: ${maps.join(', ')}`);
}

// --- Окно закрыто от ковыряния ------------------------------------------------------
// Инструменты разработчика показывают разметку, состояние и внутренние вызовы.
// В установленной версии они не нужны, в разработке — остаются.
assert.match(main, /devTools: !app\.isPackaged/, 'в собранной программе DevTools обязаны быть выключены');
// Меню Electron само по себе держит горячие клавиши F12 и Ctrl+Shift+I:
// пока меню существует, они работают даже в окне без рамки.
assert.match(main, /if \(app\.isPackaged\) Menu\.setApplicationMenu\(null\);/);
assert.match(main, /before-input-event/, 'горячие клавиши обязаны перехватываться');
assert.match(main, /key === 'f12'/);
// Окно грузит только свои файлы: уход на чужой адрес запрещён, а всплывающие
// окна не открываются вовсе. Программа работает с правами администратора.
assert.match(main, /will-navigate/);
assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
assert.match(main, /contextIsolation: true/);
assert.match(main, /nodeIntegration: false/);

// --- Целостность сборки ---------------------------------------------------------------
// electron-builder считает контрольные суммы asar и кладёт их в манифест
// приложения. Если подменить файл внутри установленной программы, Windows
// откажется её запускать. Проверка включена по умолчанию — важно её не выключить.
assert.notEqual(manifest.build.disableAsarIntegrity, true,
  'проверку целостности asar отключать нельзя: она мешает подменить код');
assert.equal(manifest.build.asar, true, 'без asar исходники лежат простыми файлами');

// Установщик просит права администратора: без них не работают обход блокировок
// и режим TUN, им нужен доступ к сетевому драйверу.
assert.equal(manifest.build.win.requestedExecutionLevel, 'requireAdministrator');

console.log('Release hardening checks passed.');
