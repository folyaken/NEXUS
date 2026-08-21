const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');
const moduleSettings = fs.readFileSync(path.join(root, 'src', 'renderer', 'ModuleSettings.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');

// --- Производительность интерфейса ------------------------------------------
// Бесконечные пружины @react-spring считаются в JavaScript на каждом кадре и
// держат главный поток занятым даже в покое. Постоянные анимации обязаны быть
// на CSS, иначе наведение на карточки заметно теряет плавность.
assert.doesNotMatch(app, /loop:\s*true/, 'бесконечные JS-анимации недопустимы');
assert.doesNotMatch(app, /loop:\s*\{\s*reverse:\s*true\s*\}/, 'пульсация индикаторов должна быть на CSS');

// Пульсация точек статуса: одна CSS-анимация вместо пружины на каждую точку.
assert.match(styles, /@keyframes nx-dot-pulse/, 'нужна CSS-анимация индикатора состояния');
assert.match(styles, /\.status-dot \{[^}]*animation: nx-dot-pulse/);
assert.match(styles, /\.status-dot\.muted \{[^}]*animation: none/, 'неактивный индикатор не должен анимироваться');
assert.match(app, /function StatusDot\(\{ tone \}: \{ tone: Tone \}\) \{\s*return <span className=\{`status-dot \$\{tone\}`\} \/>;/s, 'StatusDot должен быть статичным');

// Наведение на карточку: box-shadow как анимируемое JS-свойство перерисовывался
// покадрово — именно это ощущалось рывками.
assert.doesNotMatch(app, /hover\s*=\s*useSpring/, 'hover-эффект должен быть на CSS');
assert.doesNotMatch(app, /boxShadow: hover\.shadow/, 'тень нельзя анимировать через JS');
assert.match(styles, /\.module-card:hover \.module-card-inner \{[^}]*transform: translateY\(-4px\)/);
assert.match(styles, /\.module-card-inner \{[^}]*transition: transform/);

// Орбиты на главной вращались двумя бесконечными пружинами.
assert.match(styles, /@keyframes nx-orbit-a/);
assert.match(styles, /@keyframes nx-orbit-b/);
assert.doesNotMatch(app, /orbitA|orbitB/, 'вращение орбит должно быть на CSS');

// Пользователи с отключённой анимацией не должны получать постоянную нагрузку.
// Правило ищется по всему файлу: блоков prefers-reduced-motion несколько, и
// привязка к последнему ломается при добавлении новых анимаций.
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.orbit-b \{ animation: none; \}/);

// Настройка Windows «отключить анимации» гасила движение во всём приложении, и
// интерфейс выглядел сломанным (орбиты застыли, индикаторы не двигались).
// Теперь выбор пользователя важнее системного: правила экономии движения
// действуют, только пока он не включил анимации принудительно.
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.app-frame:not\(\.motion-force\)/,
  'системная экономия движения обязана уступать явному выбору');

// Отключение по выбору пользователя работает и там, где Windows анимации
// разрешает: иначе настройка «Выключены» ничего бы не меняла.
assert.match(styles, /\.app-frame\.motion-off [\s\S]*?animation: none;/);

// Настройка «Анимации» обязана перекрывать системную для КАЖДОГО правила.
// Один пропущенный селектор — и часть движения гаснет у всех, у кого Windows
// экономит анимации: так у пользователя перестали летать кружки вокруг кнопки
// включения VPN, хотя остальные анимации работали.
const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, '');
const unguarded = [];
const media = /@media \(prefers-reduced-motion: reduce\)\s*\{/g;
let found;
while ((found = media.exec(withoutComments)) !== null) {
  let index = media.lastIndex;
  let depth = 1;
  while (index < withoutComments.length && depth > 0) {
    if (withoutComments[index] === '{') depth += 1;
    else if (withoutComments[index] === '}') depth -= 1;
    index += 1;
  }
  const block = withoutComments.slice(media.lastIndex, index - 1);
  for (const rule of block.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const selector of rule[1].split(',')) {
      const text = selector.trim().replace(/\s+/g, ' ');
      if (text && !text.includes('motion-force')) unguarded.push(text);
    }
  }
}
assert.deepEqual(unguarded, [],
  `эти правила гасят анимацию мимо выбора пользователя: ${unguarded.join(' | ')}`);

// Кнопка включения VPN — самая заметная анимация в программе, проверяем явно.
assert.match(styles, /\.app-frame:not\(\.motion-force\) \.power-orb\.is-on \.orb-halo/);
assert.match(styles, /\.app-frame\.motion-off \.power-orb\.is-on \.orb-halo/);

// --- Оформление выпадающего списка ------------------------------------------
// Нативный <select> рисуется средствами ОС и выбивается из оформления.
assert.doesNotMatch(moduleSettings, /<select[\s>]/, 'нативный select заменён собственным компонентом');
assert.match(moduleSettings, /function StrategySelect/, 'нужен собственный список профилей');

// Доступность: список остаётся управляемым с клавиатуры и понятным скринридеру.
assert.match(moduleSettings, /role="listbox"/);
assert.match(moduleSettings, /role="option"/);
assert.match(moduleSettings, /aria-selected=\{selected\}/);
assert.match(moduleSettings, /aria-expanded=\{open\}/);
for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Enter']) {
  assert.ok(moduleSettings.includes(`'${key}'`), `клавиша ${key} должна обрабатываться`);
}
// Открытый список закрывается кликом мимо — иначе он «залипает» поверх страницы.
assert.match(moduleSettings, /document\.addEventListener\('pointerdown', closeOnOutside, true\)/);
assert.match(moduleSettings, /document\.removeEventListener\('pointerdown', closeOnOutside, true\)/, 'слушатель обязан сниматься');
// Выделенный пункт удерживается в зоне видимости при навигации стрелками.
assert.match(moduleSettings, /scrollIntoView\(\{ block: 'nearest' \}\)/);

// Стрелка разворачивается при открытии.
assert.match(styles, /\.nx-select\.is-open \.nx-select-caret \{[^}]*transform: rotate\(180deg\)/);
assert.match(styles, /\.nx-select-caret \{[^}]*transition: transform/);

// Активный профиль подсвечивается зелёным.
assert.match(styles, /\.nx-select-option\.is-selected \{[^}]*rgba\(113,244,184/);
assert.match(styles, /\.nx-select-option\.is-selected \.nx-select-mark \{[^}]*background: var\(--mint\)/);

// Ползунок оформлен под интерфейс, а не системным стилем.
assert.match(styles, /\.nx-select-list::-webkit-scrollbar-thumb/);

// --- Тема «Графит» ----------------------------------------------------------
// Тема перестала быть чёрно-белой: у неё графитовый корпус и лавандовый акцент.
// Проверяем, что она по-прежнему переопределяет все свои места.
for (const selector of [
  '.appearance-graphite .nx-select-trigger',
  '.appearance-graphite .nx-select-list',
  '.appearance-graphite .nx-select-option.is-selected',
  '.appearance-graphite .nx-select-current',
  '.appearance-graphite .nx-select-list::-webkit-scrollbar-thumb',
  '.appearance-graphite .module-card:hover .module-card-inner',
]) {
  assert.ok(styles.includes(selector), `тема Graphite должна переопределять ${selector}`);
}

const graphiteSelect = styles.slice(styles.indexOf('.appearance-graphite .nx-select-trigger'));
const graphiteBlock = graphiteSelect.slice(0, graphiteSelect.indexOf('/* ==='));
// Бирюза «Индиго» здесь всё так же неуместна — у темы свой акцент.
assert.doesNotMatch(graphiteBlock, /113,244,184|124,242,213/, 'в теме не должно остаться бирюзовых акцентов «Индиго»');

// --- Живой фон «Графита» ------------------------------------------------------
// Сеть узлов и лавандовые пятна — отличительная черта этой темы. Движение
// обязано быть на CSS: считать частицы в JavaScript на фоне жалоб на
// подвисания было бы прямым вредом.
const app2 = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');
assert.match(app2, /function NodeWeb/, 'нужен фоновый узор темы');
assert.match(app2, /<NodeWeb \/>/, 'узор обязан быть подключён');
assert.doesNotMatch(app2, /requestAnimationFrame[\s\S]{0,400}node-web/, 'узор не должен считаться в JavaScript');
// Узор виден только в «Графите»: в других темах он скрыт.
assert.match(styles, /\.node-web \{ display: none; \}/, 'в других оформлениях узор показывать не нужно');
assert.match(styles, /\.appearance-graphite \.node-web \{/);
// Слой не должен перехватывать нажатия — он лежит под интерфейсом.
const webRule = styles.slice(styles.indexOf('.appearance-graphite .node-web {'));
assert.match(webRule.slice(0, webRule.indexOf('}')), /pointer-events: none/,
  'фон обязан пропускать нажатия к интерфейсу');
// И подчиняться настройке анимаций, как всё остальное движение.
assert.match(styles, /\.app-frame\.motion-off \.node-web-links line/);
assert.match(styles, /\.app-frame:not\(\.motion-force\) \.node-web-links line/);

// --- Список серверов не перерисовывается по таймеру ---------------------------
// На странице тикает счётчик времени сессии. Без memo он раз в секунду
// пересобирал все строки списка — с флагами и значками сигнала. Именно это
// ощущалось как подвисание интерфейса.
const page = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
assert.match(page, /const ServerRow = memo\(/, 'строка сервера обязана быть мемоизирована');
assert.match(page, /const selectServer = useCallback/, 'обработчик выбора обязан быть стабильным');
assert.match(page, /const launchServer = useCallback/, 'обработчик запуска обязан быть стабильным');
// Ссылка на connect живёт в ref: иначе useCallback пересоздавался бы на каждой
// перерисовке и memo потерял бы смысл.
assert.match(page, /const connectRef = useRef\(connect\)/);

// --- Настройки из «Быстрого доступа» ----------------------------------------
// Иначе за настройками пришлось бы каждый раз заходить в раздел модулей.
assert.match(app, /const openModuleSettings = \(module: ModuleManifest\) => \{/);
assert.match(app, /setPage\('modules'\);/);
const quickAccess = app.slice(app.indexOf('module-grid compact'), app.indexOf('module-grid compact') + 400);
assert.match(quickAccess, /onOpenSettings=\{openModuleSettings\}/, 'карточкам быстрого доступа нужна кнопка настроек');
// Переход с главной не должен сбрасывать выбранный модуль.
assert.match(app, /if \(page !== 'modules' && page !== 'dashboard'\) setSettingsModuleId\(null\);/);

console.log('UI performance and select styling checks passed.');
