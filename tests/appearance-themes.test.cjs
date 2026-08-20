const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const types = fs.readFileSync(path.join(root, 'src', 'main', 'types.ts'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const { DEFAULT_SETTINGS } = require(path.join(root, 'dist-electron', 'types.js'));
const { hasTranslation } = require(path.join(root, 'dist-electron', 'i18n.js'));

// --- Три оформления ------------------------------------------------------------------
assert.match(types, /appearance: 'indigo' \| 'graphite' \| 'crimson'/);
assert.equal(DEFAULT_SETTINGS.appearance, 'indigo', 'по умолчанию оформление не меняется');
// Испорченное значение не должно оставлять интерфейс без темы.
assert.match(main, /raw\.appearance === 'graphite' \|\| raw\.appearance === 'crimson' \? raw\.appearance : 'indigo'/);

// --- Тема задаётся переменными, а не сотней правил -----------------------------------
// Графиту понадобилось больше двух сотен отдельных правил: там гасили каждый
// цветной акцент поимённо. Здесь акценты остаются, меняется оттенок — значит
// переменных достаточно. Чем меньше правил, тем меньше шансов, что новый экран
// окажется не перекрашен.
const crimsonBlock = styles.slice(styles.indexOf('.appearance-crimson {'));
const variables = crimsonBlock.slice(0, crimsonBlock.indexOf('}'));
for (const name of ['--bg', '--panel', '--line', '--text', '--muted', '--cyan', '--violet', '--red', '--mint', '--shadow']) {
  assert.ok(variables.includes(`${name}:`), `в теме должна быть переменная ${name}`);
}
const crimsonRules = (styles.match(/\.appearance-crimson/g) || []).length;
assert.ok(crimsonRules < 40, `тема должна опираться на переменные, а не на правила (сейчас ${crimsonRules})`);

// Холодные пятна фона обязаны перекрашиваться: на чёрно-красном синие кляксы
// выглядят инородно.
assert.match(styles, /\.appearance-crimson \.ambient-one/);
assert.match(styles, /\.appearance-crimson \.app-shell/);
// Полоса прокрутки по умолчанию бирюзово-фиолетовая — её тоже нужно перекрасить.
assert.match(styles, /\.appearance-crimson \*::-webkit-scrollbar-thumb/);
// Флаги серверов остаются цветными: страну узнают именно по ним.
assert.match(styles, /\.appearance-crimson \.server-flag-svg \{ filter: none; \}/);

// --- Переключатель кружками ------------------------------------------------------------
assert.match(app, /className="theme-dots"/);
assert.doesNotMatch(app, /className="appearance-options" role="radiogroup" aria-label=\{t\('Оформление NEXUS'\)\}/,
  'старый переключатель подписями заменён кружками');
for (const theme of ['indigo', 'graphite', 'crimson']) {
  assert.ok(app.includes(`['${theme}',`), `нужен кружок темы ${theme}`);
  assert.match(styles, new RegExp(`\\.theme-dot\\.theme-${theme} i`), `у кружка ${theme} должен быть свой цвет`);
}

// Доступность: кнопки должны объявляться как переключатели с названием, иначе
// цветной кружок ничего не скажет тому, кто пользуется чтением с экрана.
assert.match(app, /role="radiogroup"/);
assert.match(app, /aria-checked=\{settings\.appearance === id\}/);
assert.match(app, /aria-label=\{label\}/);
assert.match(styles, /\.theme-dot:focus-visible/, 'выбор доступен с клавиатуры');

// Подпись раскрывается шириной, а не появляется поверх соседей: через display
// анимировать нельзя, а всплывающее окно перекрывало бы другие кружки.
assert.match(styles, /\.theme-dot-label \{[^}]*max-width: 0/);
assert.match(styles, /\.theme-dot-label \{[^}]*transition: max-width/);
assert.match(styles, /\.theme-dot\.is-active \.theme-dot-label \{[^}]*max-width: 110px/);
assert.match(styles, /\.theme-dot:hover \.theme-dot-label,/);

// Обводка активного кружка берётся из его собственной темы: иначе выбранное
// «Багровое» подсвечивалось бы бирюзовым от текущего оформления.
assert.match(styles, /\.theme-dot\.theme-crimson\.is-active \{ color: #ff6b7f; \}/);

// Движение подчиняется настройке анимаций, как и весь интерфейс.
assert.ok(styles.includes('.app-frame:not(.motion-force) .theme-dot-label'));
assert.ok(styles.includes('.app-frame.motion-off .theme-dot-label'));

assert.equal(hasTranslation('en', 'Багровое'), true, 'название темы обязано переводиться');

console.log('Appearance theme checks passed.');
