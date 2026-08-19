const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const { createTranslator, hasTranslation, translationKeys } = require(path.join(root, 'dist-electron', 'i18n.js'));
const { DEFAULT_SETTINGS } = require(path.join(root, 'dist-electron', 'types.js'));

// --- Метка обновления: круглая и заметная ---------------------------------------
// Метка выглядела скруглённым прямоугольником. Виновата была не она сама, а
// общее правило `.nav-item em`: оно задаёт min-width 21px и border-radius 7px,
// поэтому ширина 7px не применялась. Размеры теперь задаются жёстко.
const dotRule = styles.slice(styles.indexOf('.nav-update-dot {'), styles.indexOf('.nav-update-dot svg'));
assert.match(dotRule, /border-radius: 50%/, 'метка обязана быть круглой');
assert.match(dotRule, /min-width: 20px/, 'без min-width метку растягивает правило .nav-item em');
assert.match(dotRule, /height: 20px/);
assert.match(dotRule, /cursor: pointer/, 'на метку нужно нажимать — курсор обязан это показывать');

// Внутри кружка стрелка вниз: без неё точка читается как «что-то случилось»,
// а не как «нажми и обнови».
const badgeMarkup = app.slice(app.indexOf('nav-update-dot'), app.indexOf('nav-update-dot') + 400);
assert.match(badgeMarkup, /<svg viewBox="0 0 24 24"/, 'в метке нужен значок стрелки');
assert.match(badgeMarkup, /m7 12 5 5 5-5/, 'стрелка должна указывать вниз — на загрузку');

// Расходящееся кольцо привлекает взгляд движением, а не только цветом.
assert.match(styles, /\.nav-update-dot:after[\s\S]*?animation: nav-update-ring/);
assert.match(styles, /@keyframes nav-update-ring/);
// Весь пункт меню подсвечивается: одну точку в углу окна легко не заметить.
assert.match(app, /\$\{updateReady \? 'has-update' : ''\}/, 'пункт «О программе» обязан подсвечиваться');
assert.match(styles, /\.nav-item\.has-update/);
// В свёрнутой панели подписи скрыты, но метка — не подпись, а единственный
// признак новой версии: она обязана остаться видимой.
assert.match(styles, /\.nav-item em:not\(\.nav-update-dot\) \{ display: none; \}/);
assert.match(styles, /\.app-shell\.is-sidebar-collapsed \.nav-update-dot/);
// Анимация подчиняется настройке движения, как и всё остальное в интерфейсе.
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.app-frame:not\(\.motion-force\) \.nav-update-dot:after \{ animation: none; \}/);
assert.match(styles, /\.app-frame\.motion-off \.nav-update-dot:after \{ animation: none; \}/);

// --- Повторное нажатие на пункт меню --------------------------------------------
// Нажатие на уже открытый раздел не делало ничего: из настроек модуля кнопка
// «Модули» выглядела нажимаемой, но экран не менялся — казалось, что зависло.
assert.match(app, /const openPage = \(next: Page\) => \{/);
assert.match(app, /if \(page === next\) \{/, 'повторное нажатие обязано обрабатываться отдельно');
assert.match(app, /if \(next === 'modules'\) setSettingsModuleId\(null\);/,
  'повторное нажатие на «Модули» обязано закрывать настройки модуля');
// Прокручивается область содержимого, а не окно: overflow-y висит на .main-content,
// и window.scrollTo здесь не сработал бы вовсе.
assert.match(app, /mainContentRef\.current\?\.scrollTo/);
assert.match(app, /<main className="main-content" ref=\{mainContentRef\}>/);
assert.match(styles, /\.main-content \{[^}]*overflow-y: auto/);
// Плавность прокрутки подчиняется настройке анимаций.
assert.match(app, /behavior: settings\.motion === 'reduced' \? 'auto' : 'smooth'/);
// Все пункты меню ходят через openPage, иначе часть из них осталась бы «мёртвой».
assert.match(app, /navItems\.map\(\(item\) => <button[\s\S]{0,200}onClick=\{\(\) => openPage\(item\.id\)\}/);
assert.match(app, /onClick=\{\(\) => openPage\('about'\)\}/);
assert.match(app, /onClick=\{\(\) => openPage\('logs'\)\}/, 'кнопка «Логи» сверху — тоже пункт перехода');

// --- Анимации: два состояния вместо трёх -------------------------------------------
// «Как в Windows» только путал: человек видит застывший интерфейс, идёт в
// настройки, а там уже написано «включены» (по системе).
assert.ok(!app.includes('Как в Windows'), 'вариант «Как в Windows» должен быть убран');
assert.ok(!app.includes("motion: 'system'"), 'режим system больше не выставляется из интерфейса');
assert.equal(DEFAULT_SETTINGS.motion, 'full');
// Значение из уже сохранённых настроек приводится к «включены»: иначе у этих
// пользователей анимаций не будет, а переключателя в таком положении уже нет.
assert.match(main, /motion: raw\.motion === 'reduced' \? 'reduced' : 'full'/);

// --- Перевод доведён до конца -------------------------------------------------------
assert.ok(translationKeys('en').length >= 500, `в словаре только ${translationKeys('en').length} фраз`);

const translate = createTranslator('en');
// Строки, которые оставались русскими в английском режиме на разных экранах.
for (const phrase of [
  'Активен', 'Остановка…', 'Система в норме', 'Ожидание запуска', 'только что',
  'Основной лог', 'СОБЫТИЙ', 'Не удалось подключиться', 'Подключаем…',
  'Через VPN', 'Напрямую', 'Срок истёк', 'Нет серверов', 'сайтов',
  'Проверить статус', 'не запущен', 'ГОТОВО', 'ВНИМАНИЕ', 'Не выбран',
  'Проверить новую версию', 'ГОТОВО К УСТАНОВКЕ', 'Локальное устройство',
]) {
  assert.equal(hasTranslation('en', phrase), true, `нужен перевод: «${phrase}»`);
  assert.notEqual(translate(phrase), phrase, `перевод «${phrase}» не должен совпадать с русским`);
}

// Подписи, которые считаются заранее, обязаны переводиться при показе, иначе
// перевод до экрана не доходит.
assert.match(app, /return translate\(\(\{ running: 'Активен'/, 'состояние модуля переводится');
assert.match(app, /const systemTitle = errors \? t\('Есть ошибки модулей'\)/);
assert.match(app, /const profileName = profile\.displayName \|\| t\('Выбрать имя'\)/);
assert.match(app, /const lastScanLabel = lastScan \? formatTime\(lastScan\) : t\('только что'\)/);

// Словари уровня модуля вычисляются один раз при загрузке файла — раньше, чем
// приложение прочитает настройки и выберет язык. Такие подписи обязаны быть
// функциями, иначе английский интерфейс покажет русский текст до перезапуска.
const diagnostics = fs.readFileSync(path.join(root, 'src', 'renderer', 'ConnectionDiagnostics.tsx'), 'utf8');
assert.match(diagnostics, /function runtimeLabel\(status: VpnStatus\): string \{/);
assert.doesNotMatch(diagnostics, /^const runtimeLabels/m, 'готовый объект вычислится до выбора языка');

// Страна сервера приходит из main-процесса всегда по-русски: сравнивать нужно с
// оригиналом, иначе в английском режиме название сервера ломается.
const jey = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
assert.match(jey, /knownCountry !== 'Другие'/, 'сравнение идёт с русским оригиналом из vpn-classify');

console.log('Navigation, update badge and translation checks passed.');
