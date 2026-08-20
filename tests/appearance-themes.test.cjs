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

// --- Тема считается из основного стиля ------------------------------------------------
// Первая версия «Багрового» опиралась на одни переменные цвета, и этого не
// хватило: сотни правил задают цвет напрямую, переменных они не знают, и
// экраны оставались наполовину сине-зелёными. Перекрашивать их руками — та же
// ловушка, что с «Графитом»: новый экран забудут. Поэтому тема создаётся из
// самого стиля, а тест сторожит, что созданное не разошлось с исходником.
const crimson = fs.readFileSync(path.join(root, 'src', 'renderer', 'crimson.css'), 'utf8');
const { buildBlock, parseRules, repaint } = require(path.join(root, 'scripts', 'crimson-theme.cjs'));

assert.equal(crimson.trim(), buildBlock(styles).trim(),
  'crimson.css устарел — выполните npm run theme:crimson');

// Тема подключается после основного стиля, иначе базовые цвета перебьют её.
const entry = fs.readFileSync(path.join(root, 'src', 'renderer', 'main.tsx'), 'utf8');
assert.ok(entry.indexOf("import './crimson.css'") > entry.indexOf("import './styles.css'"),
  'тема обязана подключаться после основного стиля');

// Переменные оформления обязаны быть перекрашены все до одной.
const rootBlock = crimson.slice(crimson.indexOf('.appearance-crimson {'));
const variables = rootBlock.slice(0, rootBlock.indexOf('}'));
for (const name of ['--bg', '--panel', '--text', '--muted', '--cyan', '--violet', '--amber', '--red', '--mint']) {
  assert.ok(variables.includes(`${name}:`), `в теме должна быть переменная ${name}`);
}

// --- Ни одного непрокрашенного места --------------------------------------------------
// Главная жалоба была именно такой: «очень много элементов не докрашены».
// Проверяем поимённо — каждое правило основного стиля, где есть цвет, обязано
// иметь пару в теме.
const COLOUR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\([^)]*\)/g;
const missing = [];
for (const rule of parseRules(styles)) {
  if (rule.at) continue;
  if (/\.appearance-(graphite|crimson)\b/.test(rule.selector)) continue;
  if (/server-flag|theme-dot|appearance-options i|tg-brand|discord|brand-logo/.test(rule.selector)) continue;
  const repaintable = (rule.body.match(COLOUR) || []).some((token) => repaint(token) !== token);
  if (!repaintable) continue;
  const first = rule.selector.split(',')[0].trim().replace(/\s+/g, ' ');
  const expected = first === ':root'
    ? '.appearance-crimson'
    : first.startsWith('.app-frame')
      ? first.replace('.app-frame', '.app-frame.appearance-crimson')
      : `.appearance-crimson ${first}`;
  // Селектор может стоять как в начале правила, так и в перечислении через
  // запятую — проверяем оба вида записи.
  if (!crimson.includes(`${expected} `) && !crimson.includes(`${expected},`)) missing.push(first);
}
assert.deepEqual(missing, [], `в оформлении «Багровое» не перекрашены: ${missing.slice(0, 12).join(' | ')}`);

// --- Гамма строго чёрно-красная -------------------------------------------------------
// Тема двухцветная: чёрный корпус и красные акценты. Любой цвет, где красная
// доля не наибольшая, означает уцелевший синий или зелёный островок.
const readRgb = (token) => {
  if (token[0] === '#') {
    let hex = token.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  const parts = token.match(/[\d.]+/g).map(Number);
  return [parts[0], parts[1], parts[2]];
};
const foreign = [];
for (const token of crimson.match(COLOUR) || []) {
  const [r, g, b] = readRgb(token);
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (spread > 18 && (g > r || b > r)) foreign.push(token);
}
assert.deepEqual([...new Set(foreign)], [], `в теме остались не красные цвета: ${foreign.slice(0, 10).join(' ')}`);

// Чёрный и белый не перекрашиваются: это тени и блики, они дают объём и
// уместны в любой теме. Розовая дымка вместо теней выглядела бы грязно.
assert.equal(repaint('rgba(0,0,0,.3)'), 'rgba(0,0,0,.3)');
assert.equal(repaint('#ffffff'), '#ffffff');
// А вот бирюзовый и фиолетовый обязаны стать красными.
for (const token of ['#7cf2d5', '#a895ff', '#71f4b8']) {
  const [r, g, b] = readRgb(repaint(token));
  assert.ok(r > g && r > b, `${token} должен стать красным`);
}
// Состояния остаются различимы: предупреждение теплее ошибки, иначе «внимание»
// и «сбой» сольются в один цвет и смысл подсветки пропадёт.
assert.notEqual(repaint('#f8c76c'), repaint('#ff718f'));

// --- Цвета, до которых таблица стилей не дотягивалась ----------------------------------
// Переключатель модулей красился прямо из JavaScript и оставался зелёным в
// любой теме, а градиенты логотипа стояли атрибутами внутри SVG.
assert.doesNotMatch(app, /background: checked \? '#/, 'цвет переключателя обязан жить в стиле');
assert.match(styles, /\.toggle\.is-on \{[^}]*background: #5ce7b0/);
// Исключение — логотип Telegram: чужой товарный знак перекрашивать нельзя,
// поэтому его градиент остаётся прописанным в разметке.
const ownGradients = app.slice(0, app.indexOf('id="tg-brand"'));
assert.doesNotMatch(ownGradients, /stopColor="#/, 'цвета градиентов обязаны задаваться классами');
for (const name of ['gr-face-a', 'gr-side-a', 'gr-orbit-a', 'gr-pulse-a']) {
  assert.match(styles, new RegExp(`\\.${name} \\{ stop-color:`), `градиенту ${name} нужен цвет в стиле`);
}

// Мерцание короны лучшего сервера задано ключевыми кадрами, приписать их теме
// селектором нельзя — для неё заведён отдельный набор кадров.
assert.match(crimson, /@keyframes crown-glow-crimson/);

// Флаги серверов остаются цветными: страну узнают именно по ним.
assert.match(crimson, /\.appearance-crimson \.server-flag-svg/);

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
