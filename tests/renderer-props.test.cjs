const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');

// Экран логов падал с «t is not defined»: перевод в нём использовался, но
// компонент его не получал. TypeScript такую ошибку не ловит — обращение к
// необъявленному имени он считает ссылкой на внешнюю область видимости, а
// падает всё уже у пользователя, при открытии страницы.
//
// Проверка идёт по исходному тексту: каждая функция, которая обращается к
// переводу, обязана либо получать его доводом, либо создавать сама.

function componentsMissingTranslator(source) {
  const starts = [...source.matchAll(/^function (\w+)/gm)].map((match) => ({ index: match.index, name: match[1] }));
  starts.push({ index: source.length, name: '<конец файла>' });

  const missing = [];
  for (let i = 0; i < starts.length - 1; i += 1) {
    const body = source.slice(starts[i].index, starts[i + 1].index);
    // Заголовок функции — до первой открывающей скобки тела.
    const opening = /\)\s*\{/.exec(body);
    const head = opening ? body.slice(0, opening.index + opening[0].length) : body;
    const rest = opening ? body.slice(opening.index + opening[0].length) : body;

    // Обращение к переводу: `t(` — но не `.t(`, не часть слова и не внутри строки.
    const usesTranslator = /[^.\w']t\(/.test(rest);
    if (!usesTranslator) continue;

    // Перевод получен доводом либо создан внутри функции.
    const declared = /\bt\b\s*[,}:]/.test(head) || /const t\s*=/.test(rest);
    if (!declared) missing.push(starts[i].name);
  }
  return missing;
}

const missing = componentsMissingTranslator(app);
assert.deepEqual(missing, [], `эти компоненты используют перевод, но не получают его: ${missing.join(', ')}`);

// Сама проверка обязана работать: на заведомо сломанном примере она должна
// сообщать об ошибке, иначе тест бесполезен.
const broken = `
function Good({ t }: { t: (text: string) => string }) {
  return <span>{t('Настройки')}</span>;
}
function Broken({ logs }: { logs: string[] }) {
  return <span>{t('Логи')}</span>;
}
`;
assert.deepEqual(componentsMissingTranslator(broken), ['Broken'], 'проверка обязана находить пропущенный перевод');

// --- Экран логов ---------------------------------------------------------------
// Компонент обязан получать перевод и получать его при вызове.
assert.match(app, /function LogsPage\(\{[^}]*\bt\b[^}]*\}/, 'LogsPage обязан принимать перевод');
assert.match(app, /<LogsPage[^>]*\st=\{t\}/, 'перевод обязан передаваться в LogsPage');

// Прочие компоненты, которым перевод передаётся, тоже проверяются: пропуск
// любого из них снова уронит страницу.
for (const call of ['<AboutPage', '<ModuleCard']) {
  const position = app.indexOf(call);
  assert.notEqual(position, -1, `не найден вызов ${call}`);
  const tag = app.slice(position, app.indexOf('/>', position) + 2);
  assert.match(tag, /\st=\{t\}/, `${call} обязан получать перевод`);
}

// --- Читаемость карточки обновления ----------------------------------------
// Подписи в карточке обновления были 7–8px: разобрать их можно было только
// вплотную к экрану. Это единственное место, где человек читает состояние
// обновления, поэтому мельче обычного они быть не должны.
const smallest = (selector) => {
  const block = styles.slice(styles.lastIndexOf(selector + ' {'));
  const size = /font-size:\s*([\d.]+)px/.exec(block.slice(0, block.indexOf('}')));
  return size ? Number(size[1]) : null;
};

for (const [selector, minimum] of [
  ['.about-update-badge', 9],
  ['.about-update-copy > span', 10],
  ['.about-update-copy p', 12],
  ['.about-update-checked', 10],
]) {
  const size = smallest(selector);
  assert.ok(size !== null, `у ${selector} должен быть задан размер текста`);
  assert.ok(size >= minimum, `${selector}: ожидается не мельче ${minimum}px, сейчас ${size}px`);
}

// Текст журнала намеренно не трогали: там размер и так удобный.
const consoleLine = styles.slice(styles.indexOf('.log-console-line {'));
const consoleSize = /font-size:\s*([\d.]+)px/.exec(consoleLine.slice(0, consoleLine.indexOf('}')));
assert.equal(consoleSize && consoleSize[1], '10', 'размер текста журнала менять не следует');

console.log('Renderer props and log readability checks passed.');
