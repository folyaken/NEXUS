const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, 'src', 'renderer', file), 'utf8');
const app = read('App.tsx');
const jey = read('Jey2RayPage.tsx');
const styles = read('styles.css');
const { hasTranslation, createTranslator } = require(path.join(root, 'dist-electron', 'i18n.js'));

// --- Значок языка показывает выбранный язык -------------------------------------
// В шапке настроек было жёстко написано «RU»: при переключении на английский
// значок продолжал утверждать, что интерфейс русский.
assert.match(app, /\{settings\.language === 'en' \? 'EN' : 'RU'\}/, 'значок языка обязан зависеть от настройки');
assert.doesNotMatch(app, /global-settings-badges"><span>RU<\/span>/, 'жёсткий «RU» должен быть убран');

// --- Карточки «Обзора» возвращаются плавно ----------------------------------------
// Пружина появления пишет transform прямо в атрибут style, а инлайновый стиль
// сильнее CSS. Пока :hover задавал transform той же карточке, вверх она шла
// мягко, а обратно возвращалась рывком. Пружина двигает обёртку, наведение —
// вложенную плитку.
assert.match(app, /className="stat-card-shell" style=\{\{ opacity: spring\.opacity/,
  'пружина обязана двигать обёртку, а не саму карточку');
assert.match(app, /<div className=\{`stat-card tone-\$\{tone\}`\}>/, 'плитка должна быть вложена в обёртку');
assert.doesNotMatch(app, /animated\.div className=\{`stat-card tone/, 'пружина не должна висеть на карточке');
// Наведение читается с обёртки, иначе правило снова не сработает.
assert.match(styles, /\.stat-card-shell:hover \.stat-card \{/);
assert.match(styles, /\.stat-card-shell:hover \.stat-icon \{/);
assert.doesNotMatch(styles, /\n\.stat-card:hover \{/, 'наведение обязано читаться с обёртки');
// Уход и возврат идут одной кривой — иначе движение выглядит несимметричным.
assert.match(styles, /\.stat-card \{[^}]*transition: transform \.26s cubic-bezier\(\.22,\.61,\.36,1\)/);
assert.match(styles, /\.stat-icon \{[^}]*transition: transform \.26s cubic-bezier\(\.22,\.61,\.36,1\)/);

// --- Кнопки сканирования крутятся при нажатии ------------------------------------
// Значок вращался по loadingModules — а тот описывает только первую загрузку
// списка и при нажатии «Сканировать» уже равен false: анимации не было вовсе.
assert.match(app, /const \[scanning, setScanning\] = useState\(false\);/);
assert.match(app, /if \(scanning\) return;\s*\n\s*setScanning\(true\);/);
assert.match(app, /window\.setTimeout\(\(\) => setScanning\(false\), 1100\);/,
  'оборот значка длится 1.1 с и обязан доигрывать');
assert.match(app, /className=\{`quiet-button \$\{scanning \? 'is-spin' : ''\}`\}/);
assert.match(app, /className=\{`primary-button small \$\{scanning \? 'is-spin' : ''\}`\}/);
assert.doesNotMatch(app, /loadingModules \? 'is-busy'/, 'вращение больше не привязано к первой загрузке');

// Значок тот же, что у кнопки «Обновить» в Jey2Ray, и анимация та же.
assert.match(app, /function RefreshGlyph\(\)/);
assert.match(app, /className="spin-ico"/);
const refreshPath = 'M11.2 3.15A8.85 8.85 0 1 0 19 7.55l-1.95 1.15A6.55 6.55 0 1 1 11.2 5.45v2.7L17.45 5 11.2.65z';
assert.ok(app.includes(refreshPath), 'значок обязан совпадать с кнопкой «Обновить» в Jey2Ray');
assert.ok(jey.includes(refreshPath), 'образец в Jey2Ray должен остаться на месте');
assert.match(styles, /\.quiet-button\.is-spin \.spin-ico,\s*\n\.primary-button\.small\.is-spin \.spin-ico \{ animation: refresh-turn 1\.1s/);

// --- Jey2Ray: текст из main-процесса переводится ------------------------------------
// Названия стран, причины блокировки и ошибки приходят из main-процесса всегда
// по-русски — там они служат ключами. Раньше они так и попадали на экран.
assert.match(jey, /function localizedServerName\(profile: VpnProfile\): string \{/);
assert.match(jey, /<strong>\{localizedServerName\(profile\)\}<\/strong>/);
assert.match(jey, /<small>\{blocked \? t\(blocked\) : stackOf\(profile\)\}<\/small>/);
assert.match(jey, /onToast\(t\(blocked\)\)/);
// Ошибки из main-процесса переводятся в одной точке — в cleanError.
for (const file of ['App.tsx', 'Jey2RayPage.tsx', 'ModuleSettings.tsx']) {
  const source = read(file);
  const body = source.slice(source.indexOf('function cleanError'), source.indexOf('function cleanError') + 700);
  assert.match(body, /return (?:t|translate)\(text\);/, `${file}: cleanError обязан переводить сообщение`);
}

// Страны и служебные сообщения есть в словаре.
const translate = createTranslator('en');
for (const phrase of [
  'Нидерланды', 'Германия', 'США', 'Великобритания', 'Россия', 'Европа',
  'Это не сервер, а служебная строка панели.',
  'У Reality-узла нет ключа — ссылка обрезана.',
  'Профиль не найден', 'Буфер обмена пуст', 'Модуль не найден',
]) {
  assert.equal(hasTranslation('en', phrase), true, `нужен перевод: «${phrase}»`);
  assert.notEqual(translate(phrase), phrase, `перевод «${phrase}» не должен совпадать с русским`);
}
// Заглушка «Другие» сравнивается с русским оригиналом, иначе ломается имя сервера.
assert.match(jey, /knownCountry !== 'Другие'/);

// --- Движение подчиняется настройке анимаций -------------------------------------------
for (const selector of ['.quiet-button .spin-ico', '.stat-card-shell:hover .stat-icon']) {
  assert.ok(styles.includes(`.app-frame:not(.motion-force) ${selector}`), `${selector}: нужна защита по настройке`);
  assert.ok(styles.includes(`.app-frame.motion-off ${selector}`), `${selector}: нужен вариант «Выключены»`);
}

console.log('Hover, language badge and scan button checks passed.');
