const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { describeSubscriptionBody } = require(path.join(root, 'dist-electron', 'subscription.js'));
const source = fs.readFileSync(path.join(root, 'src', 'main', 'subscription.ts'), 'utf8');

// Самый первый запрос к панели больше не решает судьбу всей загрузки.
// Раньше его сетевая ошибка выбрасывалась наружу немедленно, и до перебора
// клиентов, форматов и чтения страницы дело не доходило вовсе: пользователь
// видел ошибку, хотя подписка рабочая и добавилась бы следующим способом.
const firstRequest = source.slice(source.indexOf('let response: SubscriptionTextResponse | null = null'));
assert.ok(firstRequest.length > 0, 'первый ответ обязан быть необязательным');
assert.match(firstRequest, /try \{[\s\S]{0,200}await downloadOnce\(initialTarget/, 'первый запрос обязан быть в try');
assert.match(firstRequest, /firstFailure = error/, 'ошибка первого запроса запоминается, а не выбрасывается');

// Ошибка сети не должна подменяться рассказом про «панель не отдаёт
// конфигурацию»: это увело бы пользователя не в ту сторону. Но и выбрасывать
// её здесь нельзя — сначала должна отработать последняя попытка, чтение
// страницы браузерным движком. Поэтому причина возвращается наружу.
const manager = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');
assert.match(source, /firstFailure: firstFailure \?\? undefined/, 'причина отказа возвращается вызывающему коду');
assert.match(manager, /throw material\.firstFailure;/, 'настоящая причина показывается пользователю');

// Адрес, найденный на странице, тоже может оказаться нерабочим — и это не
// повод прекращать попытки.
assert.match(
  source.slice(source.indexOf('const linkedResponse')),
  /catch \{/,
  'сбой найденного адреса не должен прерывать остальные способы',
);

// --- Понятная диагностика ----------------------------------------------------
// Без сводки ответа причина отказа неотличима на глаз, и поиск превращается в
// гадание. Само содержимое не пишется: там ключи доступа.
assert.match(source, /Ответ панели: HTTP/, 'каждый ответ панели обязан попадать в журнал');

assert.equal(describeSubscriptionBody(''), 'пустой ответ');
assert.equal(describeSubscriptionBody('   \n  '), 'пустой ответ');
assert.equal(describeSubscriptionBody('<!DOCTYPE html><html><body>x</body></html>'), 'веб-страница');
assert.equal(
  describeSubscriptionBody('vless://11111111-2222-3333-4444-555555555555@a.com:443#N'),
  'ссылки на серверы',
);
assert.equal(describeSubscriptionBody('{"outbounds":[]}'), 'конфигурация JSON');
assert.equal(describeSubscriptionBody('proxies:\n  - name: a'), 'конфигурация YAML');
assert.equal(describeSubscriptionBody('dmxlc3M6Ly9leGFtcGxl'), 'данные в кодировке base64');

// Ключи доступа в журнал не попадают ни при каком ответе.
const secret = 'vless://11111111-2222-3333-4444-555555555555@secret.example.com:443';
assert.doesNotMatch(describeSubscriptionBody(secret), /secret\.example\.com|555555555555/);

console.log('Subscription first-failure checks passed.');
