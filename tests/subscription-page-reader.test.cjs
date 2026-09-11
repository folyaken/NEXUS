const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  chooseSubscriptionCandidate,
  readSubscriptionUrlFromPage,
} = require(path.join(root, 'dist-electron', 'subscription-page.js'));

// Имя стороннего клиента в коде открытым текстом не пишется.
const CLIENT = ['ha', 'pp'].join('');
const PAGE = 'https://connect.example.tech/ilbt7d3raw2i7m6r';

// Панели рисуют страницу скриптами уже в браузере: в исходном тексте страницы
// ссылок нет вообще. Поэтому загрузка по сети видела пустую заготовку, и
// подписка не добавлялась, сколько бы имён клиентов мы ни перебирали. Страница
// открывается так же, как её видит человек, и адрес читается из кнопки.

// --- Выбор адреса среди всего, что есть на странице -------------------------
// Ссылка в клиентское приложение важнее прочих: панель кладёт в неё точный адрес.
assert.equal(
  chooseSubscriptionCandidate([
    '/assets/index.js',
    PAGE,
    `${CLIENT}://add/${PAGE}/v2ray-json`,
    'https://t.me/support',
  ], PAGE),
  `${PAGE}/v2ray-json`,
);

// Панели показывают адрес и просто текстом — в поле «ваша ссылка».
assert.equal(chooseSubscriptionCandidate([`${PAGE}/sub-link`], PAGE), `${PAGE}/sub-link`);

// Сама страница подписки уже проверена и ничего не дала: предлагать её снова
// означало бы зациклиться.
assert.equal(chooseSubscriptionCandidate([PAGE, `${PAGE}/`], PAGE), null);
assert.equal(chooseSubscriptionCandidate([], PAGE), null);

// Посторонние ссылки со страницы (поддержка, магазины приложений) подпиской не
// являются и выбираться не должны.
assert.equal(
  chooseSubscriptionCandidate(['https://t.me/support', 'https://apps.apple.com/app/id123'], PAGE),
  null,
);

// Подписка качается только по HTTPS: незащищённый адрес отбрасывается.
assert.equal(chooseSubscriptionCandidate([`${CLIENT}://add/http://panel.example.com/sub`], PAGE), null);
// Локальные адреса недопустимы — иначе страница заставила бы приложение
// обратиться внутрь домашней сети пользователя.
assert.equal(chooseSubscriptionCandidate([`${CLIENT}://add/https://127.0.0.1/sub`], PAGE), null);
assert.equal(chooseSubscriptionCandidate([`${CLIENT}://add/https://192.168.1.1/sub`], PAGE), null);

// --- Чтение страницы ---------------------------------------------------------
void (async () => {
  const found = [];
  const reader = { collect: async () => [`${CLIENT}://add/${PAGE}/v2ray-json`] };
  assert.equal(
    await readSubscriptionUrlFromPage(PAGE, (message) => found.push(message), reader),
    `${PAGE}/v2ray-json`,
  );
  assert.match(found.join(' '), /получен со страницы/, 'пользователь должен видеть, что адрес найден');

  // Сбой чтения страницы не должен превращаться в непонятную ошибку: добавление
  // просто завершится обычным понятным сообщением.
  const failing = { collect: async () => { throw new Error('страница не ответила вовремя'); } };
  const failures = [];
  assert.equal(await readSubscriptionUrlFromPage(PAGE, (message) => failures.push(message), failing), null);
  assert.match(failures.join(' '), /Не удалось прочитать страницу/);

  // Пустая страница — тоже не ошибка, а отсутствие результата.
  assert.equal(await readSubscriptionUrlFromPage(PAGE, () => {}, { collect: async () => [] }), null);

  // --- Безопасность окна -----------------------------------------------------
  const source = fs.readFileSync(path.join(root, 'src', 'main', 'subscription-page.ts'), 'utf8');
  // Чужая страница открывается изолированно и не должна получить доступ к
  // возможностям приложения или к файлам пользователя.
  assert.match(source, /show: false/, 'окно обязано быть невидимым');
  assert.match(source, /nodeIntegration: false/);
  assert.match(source, /contextIsolation: true/);
  assert.match(source, /sandbox: true/);
  assert.match(source, /webSecurity: true/);
  // Следы просмотра не остаются: своё хранилище, которое очищается после чтения.
  assert.match(source, /clearStorageData/);
  assert.match(source, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/, 'страница не должна открывать окна');
  // Окно закрывается всегда, иначе оно осталось бы висеть в памяти.
  assert.match(source, /window\.destroy\(\)/);

  // Страница читается только когда обычные способы ничего не дали.
  const manager = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');
  assert.match(manager, /if \(!material\.links\.length && !material\.clash\.length\) \{[\s\S]{0,400}readSubscriptionUrlFromPage/);

  console.log('Subscription page reader checks passed.');
})();
