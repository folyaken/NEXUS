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
//
// Раньше здесь стояло persistEnabled: true, но параметр работал наоборот
// своему названию и отметки как раз стирал — «Отключить всё» тихо забывало
// все модули. Теперь имя совпадает со смыслом: forget: false — это пауза.
assert.match(body, /stopAll\(\{ forget: false \}\)/,
  'отметки включённых модулей должны сохраняться');
assert.doesNotMatch(body, /persistEnabled/, 'параметр с обратным смыслом убран');
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

// --- Автозапуск не ждёт GitHub бесконечно ------------------------------------
// Модули поднимались строго после проверки обновлений, а у сетевых запросов нет
// таймаута. При медленной сети (обычное дело при старте вместе с Windows)
// ожидание растягивалось на минуты: программа запущена, модули — нет.
assert.match(main, /STARTUP_UPDATE_WAIT_MS/, 'ожидание обновлений обязано быть ограничено');
const waitMs = /const STARTUP_UPDATE_WAIT_MS = ([\d_]+)/.exec(main);
assert.ok(waitMs, 'срок ожидания должен задаваться явной константой');
assert.ok(Number(waitMs[1].replace(/_/g, '')) <= 30_000,
  'ждать проверку обновлений дольше 30 секунд нельзя — защита останется выключенной');
assert.match(main, /Promise\.race\(\[\s*startupUpdates\.catch/,
  'автозапуск обязан стартовать по таймауту, не дожидаясь GitHub');

// --- Ручное выключение забывает модуль, остальные остановки — пауза ----------
// Единственный случай, когда отметку «включён» снимают, — переключатель в
// интерфейсе: человек сам решил не пользоваться модулем.
assert.match(main, /modules:stop'.*manager\.stop\(id, \{ forget: true \}\)/,
  'переключатель обязан забывать модуль');

// --- Осиротевшие процессы модулей --------------------------------------------
// Модули переживают падение NEXUS. Оставшийся winws.exe держит драйвер
// WinDivert и продолжает разбирать трафик: часть сайтов не открывается, а
// программы, которая это делает, на экране уже нет.
assert.match(main, /stopModuleWorkersSync/, 'аварийный выход обязан останавливать модули');
const cleanupBlock = main.slice(main.indexOf('function registerEmergencyCleanup'));
assert.match(cleanupBlock.slice(0, cleanupBlock.indexOf('\n}\n')), /stopModuleWorkersSync\(\)/,
  'остановка модулей должна выполняться в аварийной очистке');

const proxySource = fs.readFileSync(path.join(root, 'src', 'main', 'system-proxy.ts'), 'utf8');
// Список процессов обязан совпадать с тем, что останавливает установщик:
// это одни и те же ядра.
const installerSource = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
for (const image of ['winws.exe', 'TgWsProxy_windows_7_64bit.exe', 'TgWsProxy_windows_arm64.exe']) {
  assert.ok(proxySource.includes(image), `аварийная очистка обязана знать про ${image}`);
  assert.ok(installerSource.includes(image), `установщик обязан знать про ${image}`);
}
// Ядро VPN трогать не должны — им занимается менеджер VPN вместе с маршрутами.
const workerList = proxySource.slice(proxySource.indexOf('const WORKER_IMAGES'));
assert.doesNotMatch(workerList.slice(0, workerList.indexOf(']')), /xray\.exe|sing-box\.exe/,
  'ядро VPN останавливает менеджер VPN, а не аварийная очистка модулей');

console.log('Tray shutdown and progress animation checks passed.');
