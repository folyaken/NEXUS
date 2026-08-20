const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');

// --- «Отключить всё» в меню значка возле часов ------------------------------------
// Чтобы вернуть чистую сеть, приходилось обходить программу вручную: отключить
// VPN на вкладке Jey2Ray, потом остановить каждый модуль. Один забытый пункт —
// и в системе остаётся работающий winws.exe или прописанный прокси, а человек
// уверен, что всё выключено.
assert.match(main, /async function shutdownEverything\(\)/);
assert.match(main, /label: 'Отключить всё'/, 'нужен пункт полного отключения в трее');
assert.match(main, /click: \(\) => runTrayAction\(shutdownEverything\)/);

const shutdown = main.slice(main.indexOf('async function shutdownEverything'));
const body = shutdown.slice(0, shutdown.indexOf('\n}\n'));
// Порядок важен: VPN правит системный прокси, поэтому снимается первым.
assert.ok(
  body.indexOf('vpn?.disconnect()') < body.indexOf('manager?.stopAll'),
  'VPN обязан отключаться до остановки модулей',
);
// Модули ставятся на паузу, а не выключаются навсегда: их отметки «включён»
// сохраняются, и при следующем запуске NEXUS поднимет их сам.
assert.match(body, /stopAll\(\{ persistEnabled: true \}\)/,
  'отметки включённых модулей должны сохраняться');
// Подстраховка на случай, если ядро упало раньше и не откатило настройку.
assert.match(body, /clearSystemProxy\(\)/, 'системный прокси обязан сниматься');
// Ошибка одного шага не должна прерывать остальные: иначе часть останется работать.
assert.equal((body.match(/\.catch\(\(\) => undefined\)/g) || []).length >= 3, true,
  'каждый шаг отключения обязан переживать ошибку соседнего');
// Пункт неактивен, когда отключать нечего — серый пункт честно показывает,
// что сеть уже чистая.
assert.match(main, /enabled: isRunning \|\| status === 'connecting' \|\| \(manager\?\.list\(\)\.some/);

// --- Полоса загрузки ------------------------------------------------------------------
// Была плоской заливкой: при медленной загрузке казалось, что процесс завис.
// Кружки-шаги убраны — вместо них самолётик, летящий по реальному проценту.
assert.match(app, /className="about-update-spark"/, 'край заливки обязан подсвечиваться');
assert.match(app, /className="about-update-plane"/, 'над полосой должен лететь самолётик');
assert.doesNotMatch(app, /about-update-steps/, 'кружки шагов удалены');
assert.match(styles, /\.about-update-progress-bar \{[^}]*background-size: 300% 100%/);
assert.match(styles, /@keyframes update-flow/);

// Галочка прочерчивается и подскакивает, а не появляется скачком.
assert.match(app, /className="about-update-tick"/);
assert.match(styles, /\.about-update-tick \{[^}]*stroke-dasharray/);
assert.match(styles, /@keyframes update-tick-draw/);
assert.match(styles, /@keyframes tick-pop/);

// --- Движение подчиняется настройке анимаций --------------------------------------------
for (const selector of ['.about-update-plane', '.about-update-landed-mark']) {
  assert.ok(styles.includes(`.app-frame:not(.motion-force) ${selector}`), `${selector}: нужна защита по настройке`);
  assert.ok(styles.includes(`.app-frame.motion-off ${selector}`), `${selector}: нужен вариант «Выключены»`);
}

console.log('Tray shutdown and progress animation checks passed.');
