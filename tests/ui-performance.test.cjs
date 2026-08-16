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

// --- Монохромная тема -------------------------------------------------------
// Graphite обязан оставаться чёрно-бело-серым: зелёные акценты в нём недопустимы.
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
assert.doesNotMatch(graphiteBlock, /113,244,184|124,242,213|--mint|--cyan/, 'в монохромной теме не должно быть цветных акцентов');

// --- Настройки из «Быстрого доступа» ----------------------------------------
// Иначе за настройками пришлось бы каждый раз заходить в раздел модулей.
assert.match(app, /const openModuleSettings = \(module: ModuleManifest\) => \{/);
assert.match(app, /setPage\('modules'\);/);
const quickAccess = app.slice(app.indexOf('module-grid compact'), app.indexOf('module-grid compact') + 400);
assert.match(quickAccess, /onOpenSettings=\{openModuleSettings\}/, 'карточкам быстрого доступа нужна кнопка настроек');
// Переход с главной не должен сбрасывать выбранный модуль.
assert.match(app, /if \(page !== 'modules' && page !== 'dashboard'\) setSettingsModuleId\(null\);/);

console.log('UI performance and select styling checks passed.');
