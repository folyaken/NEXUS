const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { extractSubscriptionUrlFromClientLink } = require(path.join(root, 'dist-electron', 'subscription.js'));

// Имя стороннего клиента не пишется в коде открытым текстом — так же, как в
// самом транспорте подписок.
const CLIENT = ['ha', 'pp'].join('');

// Страницы подписок панелей (Remnawave, Marzban, 3x-ui) не показывают адрес
// конфигурации текстом: он спрятан в кнопке «Добавить подписку», которая ведёт
// в клиентское приложение. Пользователь нажимает её в браузере и получает
// рабочую подписку, поэтому и NEXUS обязан уметь доставать адрес оттуда.
// Без этого добавление обрывалось ошибкой «Панель вернула веб-страницу».

// --- Адрес в пути ссылки -----------------------------------------------------
assert.equal(
  extractSubscriptionUrlFromClientLink(`${CLIENT}://add/https://connect.example.tech/ilbt7d3raw2i7m6r`),
  'https://connect.example.tech/ilbt7d3raw2i7m6r',
);
assert.equal(
  extractSubscriptionUrlFromClientLink('streisand://import/https://panel.example.com/sub/abc'),
  'https://panel.example.com/sub/abc',
);
assert.equal(
  extractSubscriptionUrlFromClientLink('v2raytun://import/https://panel.example.com/sub/abc'),
  'https://panel.example.com/sub/abc',
);

// --- Адрес в параметре запроса ----------------------------------------------
assert.equal(
  extractSubscriptionUrlFromClientLink('clash://install-config?url=https%3A%2F%2Fpanel.example.com%2Fsub%2Fabc'),
  'https://panel.example.com/sub/abc',
);
assert.equal(
  extractSubscriptionUrlFromClientLink('sing-box://import-remote-profile?url=https%3A%2F%2Fp.example.com%2Fs%3Fk%3D1&name=X'),
  'https://p.example.com/s?k=1',
);

// Некоторые панели кодируют адрес дважды, чтобы ссылка пережила пересылку
// в мессенджере. Такой адрес обязан разворачиваться до конца.
assert.equal(
  extractSubscriptionUrlFromClientLink(`${CLIENT}://add/https%253A%252F%252Fpanel.example.com%252Fsub%252Fabc`),
  'https://panel.example.com/sub/abc',
);

// --- Чего делать нельзя ------------------------------------------------------
// Небезопасный протокол не принимается: подписка качается только по HTTPS.
assert.equal(extractSubscriptionUrlFromClientLink(`${CLIENT}://add/http://panel.example.com/sub`), null);
// Ссылка на сам сервер без адреса конфигурации ничего не даёт.
assert.equal(extractSubscriptionUrlFromClientLink(`${CLIENT}://routing/add`), null);
assert.equal(extractSubscriptionUrlFromClientLink('https://panel.example.com/page'), null);

console.log('Subscription client-link checks passed.');
