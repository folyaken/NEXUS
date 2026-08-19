const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, 'src', 'renderer', file), 'utf8');
const app = read('App.tsx');
const styles = read('styles.css');
const { hasTranslation, translationKeys, createTranslator, setInterfaceLanguage, dateLocale } = require(path.join(root, 'dist-electron', 'i18n.js'));

const SCREENS = ['App.tsx', 'Jey2RayPage.tsx', 'ModuleSettings.tsx', 'SubscriptionManager.tsx', 'AppPicker.tsx', 'ConnectionDiagnostics.tsx'];

// --- Перевод: текст между тегами --------------------------------------------------
// Прошлые проверки смотрели только на строки в кавычках, поэтому целая страница
// Jey2Ray оставалась русской в английском режиме: её подписи написаны прямо в
// разметке, между тегами. Здесь проверяется именно такой текст.
const cyrillic = /[А-Яа-яЁё]/;
const rawJsxText = [];
for (const screen of SCREENS) {
  const source = read(screen).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const match of source.matchAll(/[>}]([^<>{}\n]*[А-Яа-яЁё][^<>{}]*)[<{]/g)) {
    const text = match[1].trim();
    // Служебные обрывки кода в разбор не попадают: нас интересуют только
    // человеческие фразы, а не куски выражений с кавычками и скобками.
    if (!text || /['"`(){}=;]/.test(text)) continue;
    if (text === 'Русский') continue; // название языка не переводится
    rawJsxText.push(`${screen}: ${text}`);
  }
}
assert.deepEqual(rawJsxText, [], `текст в разметке без t(): ${rawJsxText.join(' | ')}`);

// --- Перевод: каждый ключ t() есть в словаре --------------------------------------
// Обернуть строку в t() мало — если ключа нет в словаре, на экране останется
// русский текст, и заметить это можно только глазами.
const missing = [];
for (const screen of SCREENS) {
  const source = read(screen);
  for (const match of source.matchAll(/\b(?:t|translate)\('((?:[^'\\]|\\.)*)'\)/g)) {
    const key = match[1].replace(/\\'/g, "'");
    if (!hasTranslation('en', key)) missing.push(`${screen}: ${key}`);
  }
}
assert.deepEqual(missing, [], `ключи без перевода: ${missing.join(' | ')}`);
assert.ok(translationKeys('en').length >= 500, `в словаре только ${translationKeys('en').length} фраз`);

// --- Даты подчиняются языку -----------------------------------------------------------
// Формат 'ru-RU' был вписан в каждый файл, и в английском режиме даты оставались
// русскими: «19.08.2026» вместо «19/08/2026».
assert.equal(typeof dateLocale, 'function', 'нужна общая функция локали для дат');
setInterfaceLanguage('en');
assert.equal(dateLocale(), 'en-GB');
setInterfaceLanguage('ru');
assert.equal(dateLocale(), 'ru-RU');
for (const screen of SCREENS) {
  const source = read(screen).replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /Intl\.DateTimeFormat\('ru-RU'/,
    `${screen}: локаль даты обязана браться из языка интерфейса`);
}

// --- Значки главной страницы ------------------------------------------------------------
// Раньше это были символы шрифта «◈ ϟ ⌁ ◷»: разной толщины, а на части систем
// Windows часть из них рисовалась прямоугольником-заглушкой.
assert.match(app, /function StatGlyph\(\{ name \}: \{ name: string \}\)/);
for (const glyph of ['modules', 'active', 'health', 'scan']) {
  assert.match(app, new RegExp(`glyph="${glyph}"`), `карточке нужен значок ${glyph}`);
}
assert.doesNotMatch(app, /icon="◈"|icon="ϟ"|icon="⌁"|icon="◷"/, 'символы шрифта заменены на SVG');
assert.match(styles, /\.stat-icon svg \{[^}]*stroke: currentColor/);
// Цвет плитки сообщает о беде раньше, чем прочитан текст.
assert.match(app, /tone=\{errors \? 'red' : 'mint'\}/, 'при ошибках «Здоровье» обязано краснеть');
assert.match(styles, /\.stat-icon\.red/);

// Полоска под числом: «73%» само по себе не с чем сравнить.
assert.match(app, /className="stat-meter"/);
assert.match(styles, /\.stat-meter i \{/);
assert.match(app, /meter=\{modules\.length \? \(running \/ modules\.length\) \* 100 : 0\}/);

// --- Кнопки главной страницы --------------------------------------------------------------
// «Все модули» была просто текстом со стрелкой — терялась рядом с заголовком.
assert.match(app, /className="text-button-count"/, 'у кнопки «Все модули» должен быть счётчик');
assert.match(app, /className="text-button-arrow"/);
assert.match(styles, /\.text-button \{[^}]*border:/, 'кнопке нужна рамка, иначе она не выглядит нажимаемой');
assert.match(styles, /\.text-button:focus-visible/, 'кнопку должно быть видно с клавиатуры');
assert.match(styles, /\.text-button:hover \.text-button-arrow/);
// Стрелки нарисованы, а не взяты из шрифта.
assert.doesNotMatch(app, /<b>↗<\/b>/, 'стрелка должна быть значком');
assert.doesNotMatch(app, /<span>⟳<\/span>/, 'значок обновления должен быть SVG');
assert.match(app, /className="quiet-button-icon"/);
// Обе кнопки ведут через openPage: повторное нажатие обязано работать.
assert.match(app, /className="primary-button" onClick=\{\(\) => openPage\('modules'\)\}/);
assert.match(app, /className="text-button" onClick=\{\(\) => openPage\('modules'\)\}/);

// --- Движение подчиняется настройке анимаций ------------------------------------------------
// Windows умеет гасить анимации глобально; без защиты интерфейс выглядел бы
// застывшим, хотя работает верно.
const reduceBlocks = [...styles.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{/g)];
assert.ok(reduceBlocks.length > 0);
for (const selector of ['.stat-card', '.primary-button', '.text-button', '.stat-meter i']) {
  assert.ok(
    styles.includes(`.app-frame:not(.motion-force) ${selector}`),
    `${selector}: анимация обязана отключаться по настройке движения`,
  );
  assert.ok(
    styles.includes(`.app-frame.motion-off ${selector}`),
    `${selector}: нужен вариант для «Выключены»`,
  );
}

// --- Английский действительно отличается от русского -------------------------------------------
const translate = createTranslator('en');
for (const phrase of [
  'Раздача в сеть', 'Скачать ядро', 'Истекает', 'Порт', 'пунктов', 'мс',
  'Подписка добавлена · серверов', 'Найдено профилей:', 'Требуют внимания:',
  'уже есть в списке', 'адрес скрыт', 'Это действие нельзя отменить.',
]) {
  assert.notEqual(translate(phrase), phrase, `перевод «${phrase}» не должен совпадать с русским`);
}

console.log('Dashboard visuals and translation coverage checks passed.');
