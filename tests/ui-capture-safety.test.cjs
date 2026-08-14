const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

// --- Устойчивость интерфейса к захвату экрана -------------------------------
// backdrop-filter выносит панель в отдельный GPU-слой, который скриншотеры и
// запись экрана часто не копируют — в кадре панели пропадают. Размытие должно
// быть отключено, а фоны панелей — сплошными.
const glassPanels = ['.sidebar', '.stat-card', '.module-card-inner', '.pulse-panel', '.profile-popover', '.toast'];

const overrideStart = styles.indexOf('.sidebar,\n.stat-card,\n.module-card-inner,\n.pulse-panel,\n.profile-popover,\n.toast { backdrop-filter: none; }');
assert.ok(overrideStart > 0, 'должно быть правило, отключающее backdrop-filter у панелей');

// Каскад: отключение обязано идти ПОСЛЕ исходных объявлений панелей,
// иначе более поздние правила вернут размытие обратно.
for (const panel of glassPanels) {
  const declaration = styles.indexOf(`${panel} {`);
  assert.ok(declaration >= 0, `${panel} должен быть объявлен`);
  assert.ok(
    overrideStart > declaration,
    `отключение backdrop-filter должно идти после объявления ${panel}`,
  );
}

// Фоны панелей не должны оставаться полупрозрачными: rgba со значением альфы
// меньше единицы снова делает панель зависимой от нижележащих слоёв.
const overrides = styles.slice(overrideStart);
for (const panel of glassPanels) {
  const rule = new RegExp(`\\n${panel.replace('.', '\\.')} \\{ background: ([^}]+)\\}`);
  const match = overrides.match(rule);
  assert.ok(match, `${panel} должен получить сплошной фон`);
  assert.doesNotMatch(match[1], /rgba\([^)]*,\s*0?\.\d+\s*\)/, `${panel}: фон должен быть непрозрачным`);
}

// У монохромной темы своя палитра — фоны не должны остаться синими.
for (const panel of ['.sidebar', '.stat-card', '.module-card-inner', '.pulse-panel', '.profile-popover', '.toast']) {
  assert.ok(
    overrides.includes(`.appearance-graphite ${panel}`),
    `тема Graphite должна переопределять фон для ${panel}`,
  );
}

// --- Репозиторий очищен -----------------------------------------------------
assert.doesNotMatch(JSON.stringify(packageJson), /arena/i, 'в манифесте не должно остаться сторонних упоминаний');
assert.equal(packageJson.build.appId, 'com.folyaken.nexus');
assert.match(gitignore, /NEXUS-patch-\*\.zip/, 'патч-архивы не должны попадать в репозиторий');

// Локально собранный патч лежать в папке может — важно, что он не попадает
// под контроль версий.
const trackedPatches = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((name) => /^NEXUS-patch-.*\.zip$/i.test(name.trim()));
assert.deepEqual(trackedPatches, [], 'патч-архивы не должны быть в репозитории');

console.log('UI capture safety and repository hygiene checks passed.');
