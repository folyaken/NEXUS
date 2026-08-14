const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

// --- Устойчивость интерфейса к захвату экрана -------------------------------
// Полупрозрачные панели с backdrop-filter рисуются отдельными GPU-слоями и
// пропадают на скриншотах и записи экрана. Под каждой такой панелью обязана
// лежать непрозрачная подложка, иначе в кадре остаётся голый фон.
const glassPanels = ['.sidebar', '.stat-card', '.module-card-inner', '.pulse-panel', '.profile-popover'];
for (const panel of glassPanels) {
  assert.ok(
    styles.includes(`${panel}::before`),
    `${panel} использует backdrop-filter и обязан иметь непрозрачную подложку ::before`,
  );
}

// Подложка обязана лежать под содержимым и не перехватывать курсор.
const backdropRule = styles.slice(styles.indexOf('.sidebar::before,'), styles.indexOf('.sidebar::before { background'));
assert.match(backdropRule, /z-index:\s*-1/, 'подложка должна находиться под содержимым панели');
assert.match(backdropRule, /inset:\s*0/, 'подложка должна покрывать панель целиком');
assert.match(backdropRule, /pointer-events:\s*none/, 'подложка не должна перехватывать клики');
assert.match(backdropRule, /border-radius:\s*inherit/, 'подложка должна повторять скругление панели');

// z-index: -1 работает только внутри собственного стекового контекста,
// иначе подложка уедет за фон окна и панель станет прозрачной.
assert.match(styles, /\.profile-popover\s*{\s*isolation:\s*isolate;\s*}/s, 'панелям нужен собственный стековый контекст');
assert.match(styles, /\.pulse-panel\s*{\s*position:\s*relative;\s*}/s, 'подложке нужен позиционированный родитель');

// У монохромной темы своя палитра — подложки не должны оставаться синими.
for (const panel of ['.sidebar', '.stat-card', '.module-card-inner', '.pulse-panel', '.profile-popover']) {
  assert.ok(
    styles.includes(`.appearance-graphite ${panel}::before`),
    `тема Graphite должна переопределять подложку для ${panel}`,
  );
}

// --- Репозиторий очищен -----------------------------------------------------
assert.doesNotMatch(JSON.stringify(packageJson), /arena/i, 'в манифесте не должно остаться сторонних упоминаний');
assert.equal(packageJson.build.appId, 'com.folyaken.nexus');
assert.match(gitignore, /NEXUS-patch-\*\.zip/, 'патч-архивы не должны попадать в репозиторий');

const strayPatches = fs.readdirSync(root).filter((name) => /^NEXUS-patch-.*\.zip$/i.test(name));
assert.deepEqual(strayPatches, [], 'патч-архивы не хранятся в репозитории');

console.log('UI capture safety and repository hygiene checks passed.');
