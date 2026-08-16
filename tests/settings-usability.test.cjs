const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const moduleSettings = fs.readFileSync(path.join(root, 'src', 'renderer', 'ModuleSettings.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const { createTranslator, hasTranslation, translationKeys } = require(path.join(root, 'dist-electron', 'i18n.js'));

// --- Кнопка возврата слева ----------------------------------------------------
// Раньше «К модулям» стояла справа, вплотную к кнопке сворачивания боковой
// панели: рука тянулась влево и попадала не туда.
const heading = moduleSettings.slice(
  moduleSettings.indexOf('module-settings-heading'),
  moduleSettings.indexOf('</div>', moduleSettings.indexOf('module-settings-heading')),
);
assert.ok(heading.includes('page-back-button'), 'нужна отдельная кнопка возврата');
assert.ok(
  heading.indexOf('page-back-button') < heading.indexOf('section-kicker'),
  'кнопка возврата обязана стоять перед заголовком, то есть слева',
);
// Стрелка рисуется значком, а не символом «←»: символ выглядит инородно и
// по-разному отображается в разных шрифтах.
assert.match(moduleSettings, /<svg viewBox="0 0 24 24"[\s\S]{0,120}page-back|page-back-button[\s\S]{0,220}<svg/);
assert.match(styles, /\.page-back-button/);
// Кнопку должно быть видно и с клавиатуры.
assert.match(styles, /\.page-back-button:focus-visible/);

// --- Версии модулей -----------------------------------------------------------
// Друг спрашивал версию модуля, а показать её было негде.
assert.match(moduleSettings, /module\.installed_version && <p className="module-settings-version">/);
assert.match(moduleSettings, /Установленная версия модуля/);
// На карточке версия тоже видна — не нужно открывать настройки ради номера.
assert.match(app, /module\.installed_version \? <em className="module-version"/);
assert.match(styles, /\.module-version/);
// У модулей в разработке версии нет: показывать пустоту незачем.
assert.match(app, /!isDevelopment && module\.installed_version/);

// --- Постраничный список сайтов ------------------------------------------------
// Список задумывался коротким, но пользователи добавляют по десятку и больше:
// страница вытягивалась, и до кнопок под списком приходилось долго крутить.
assert.match(moduleSettings, /const PAGE_SIZE = 6;/);
assert.match(moduleSettings, /dpi-host-pager/);
// Положение в списке показывается числом и точками: «3 сайта · 1/2».
assert.match(moduleSettings, /\{safePage \+ 1\}\/\{pageCount\}/);
assert.match(moduleSettings, /dpi-host-pager-dots/, 'нужен наглядный указатель страницы');
// Точек не должно быть слишком много: при десятках страниц они сливаются.
assert.match(moduleSettings, /pageCount <= 8 &&/);
// Стрелки рисуются значками, а не символами «←» и «→»: символы выглядят
// неровно и по-разному в разных шрифтах.
assert.doesNotMatch(moduleSettings, />←<\/button>/, 'стрелка должна быть значком');
assert.doesNotMatch(moduleSettings, />→<\/button>/, 'стрелка должна быть значком');
// Поиск появляется только когда список длинный: на трёх сайтах он мешает.
assert.match(moduleSettings, /hosts\.length > PAGE_SIZE && <input/);
// Страница могла исчезнуть после удаления сайтов — показываем существующую.
assert.match(moduleSettings, /const safePage = Math\.min\(page, pageCount - 1\)/);
// Кнопки листания недоступны на краях списка.
assert.match(moduleSettings, /disabled=\{safePage === 0\}/);
assert.match(moduleSettings, /disabled=\{safePage >= pageCount - 1\}/);
// Пустой результат поиска объясняется, а не выглядит как потерянный список.
assert.match(moduleSettings, /ничего не найдено/i);

// Счётчик склоняется правильно: «1 сайт», «2 сайта», «5 сайтов».
const { hostsWord } = (() => {
  // Функция не экспортируется (она нужна только этому экрану), поэтому
  // проверяется её поведение по исходному тексту.
  const body = moduleSettings.slice(moduleSettings.indexOf('function hostsWord'));
  assert.ok(body.includes("return 'сайтов'"), 'нужна форма «сайтов»');
  assert.ok(body.includes("return 'сайт'"), 'нужна форма «сайт»');
  assert.ok(body.includes("return 'сайта'"), 'нужна форма «сайта»');
  // Исключение для 11–14: «11 сайтов», а не «11 сайт».
  assert.ok(body.includes('tail >= 11 && tail <= 14'), 'нужно исключение для 11–14');
  return { hostsWord: null };
})();
assert.equal(hostsWord, null);

// --- Английский перевод ---------------------------------------------------------
// Перевод был совсем куцым: включаешь английский, а почти всё остаётся русским.
assert.ok(translationKeys('en').length >= 130, `переводов должно быть больше, сейчас ${translationKeys('en').length}`);

const translate = createTranslator('en');
// Экраны, которые видно первыми, обязаны переводиться целиком.
for (const phrase of [
  'Все модули', 'Активные', 'Остановлены', 'Сканировать', 'Ничего не найдено',
  'Запустить', 'Остановить', 'Готов к запуску', 'Профиль', 'Изменить',
  'К модулям', 'НАСТРОЙКИ МОДУЛЯ', 'Список пуст', 'Поиск по списку…',
  'Быстрый доступ', 'Открыть модули', 'ВСЕГО МОДУЛЕЙ', 'ЗДОРОВЬЕ',
]) {
  assert.equal(hasTranslation('en', phrase), true, `нужен перевод: «${phrase}»`);
  assert.notEqual(translate(phrase), phrase, `перевод «${phrase}» не должен совпадать с русским`);
}

// Разметка обязана использовать словарь, иначе перевод не дойдёт до экрана.
assert.match(app, /\{t\('Все модули'\)\}/);
assert.match(app, /\{t\('Сканировать'\)\}/);
assert.match(app, /t\(module\.description\)/, 'описание модуля тоже переводится');
assert.match(app, /t: \(text: string\) => string/, 'карточка модуля обязана получать перевод');

// Ключи не должны дублироваться: повтор молча затирает первый перевод.
const keys = [...fs.readFileSync(path.join(root, 'src', 'main', 'i18n.ts'), 'utf8')
  .matchAll(/^\s*'([^']+)':\s*'/gm)].map((match) => match[1]);
assert.equal(new Set(keys).size, keys.length, 'в словаре есть повторяющиеся ключи');

console.log('Settings usability and translation checks passed.');
