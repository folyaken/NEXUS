const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  SUBSCRIPTION_TRANSPORT_LIMITS,
  subscriptionUrlWithSuffix,
} = require(path.join(root, 'dist-electron', 'subscription.js'));
const source = fs.readFileSync(path.join(root, 'src', 'main', 'subscription.ts'), 'utf8');

// Панель провайдера отдаёт конфигурацию только приложениям, которые знает, а
// всем остальным — страницу входа. Пользователь упирался в «Панель отдала
// только страницу входа», хотя подписка рабочая. Ниже закреплены оба обходных
// пути: назваться знакомым приложением и запросить формат адресом напрямую.

// --- Адрес конкретного формата ----------------------------------------------
const base = new URL('https://connect.example.tech/ilbt7d3raw2i7m6r');
assert.equal(
  subscriptionUrlWithSuffix(base, '/v2ray'),
  'https://connect.example.tech/ilbt7d3raw2i7m6r/v2ray',
);

// Идентификатор пользователя — часть адреса, потерять его нельзя.
assert.match(subscriptionUrlWithSuffix(base, '/clash'), /ilbt7d3raw2i7m6r/);

// Параметры запроса несут токен доступа и обязаны сохраняться.
assert.equal(
  subscriptionUrlWithSuffix(new URL('https://p.example.com/abc?token=1'), '/clash'),
  'https://p.example.com/abc/clash?token=1',
);

// Если формат в адресе уже указан, второй дописывать нельзя.
assert.equal(subscriptionUrlWithSuffix(new URL('https://p.example.com/abc/json'), '/v2ray'), null);
assert.equal(subscriptionUrlWithSuffix(new URL('https://p.example.com/abc/sing-box'), '/clash'), null);
// Адрес без пути ведёт на сам сайт, а не на подписку.
assert.equal(subscriptionUrlWithSuffix(new URL('https://p.example.com/'), '/v2ray'), null);

// --- Список имён клиентов ----------------------------------------------------
// Провайдеры выдают пользователям клиенты под собственными именами, и панель
// узнаёт только их. Без этих имён подписка не добавлялась.
for (const client of ['INCY', 'FlClashX', 'Koala Clash', 'Prizrak-Box']) {
  assert.ok(source.includes(client), `в списке клиентов должен быть ${client}`);
}

// Обычный браузер — последняя попытка: панели без строгого списка отдают ему
// готовую конфигурацию.
assert.match(source, /Mozilla\/5\.0/, 'нужна попытка от имени браузера');

// --- Порядок действий --------------------------------------------------------
// Прямой запрос формата — крайняя мера, только когда ни одно имя не подошло.
// Иначе лишние обращения к панели тратили бы лимит устройств у провайдера.
const formatBlock = source.slice(source.indexOf('SUBSCRIPTION_FORMAT_SUFFIXES.'));
assert.match(
  source.slice(source.indexOf('Последний рубеж')),
  /if \(!links\.size && !clash\.length\)/,
  'форматы запрашиваются только когда ничего не разобрано',
);
assert.ok(formatBlock.length > 0, 'перебор форматов обязан присутствовать');

// Бюджет запросов обязан вмещать перебор клиентов и форматов целиком, иначе
// последние варианты не будут проверены и подписка снова не добавится.
const clientCount = (source.match(/^\s{2}'[^']+',$/gm) || []).length;
assert.ok(
  SUBSCRIPTION_TRANSPORT_LIMITS.maxRequests >= clientCount,
  `бюджет ${SUBSCRIPTION_TRANSPORT_LIMITS.maxRequests} мал для перебора`,
);

console.log('Subscription panel format checks passed.');
