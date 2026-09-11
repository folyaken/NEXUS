const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'main', 'subscription.ts'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');

// Панель пользователя отвечала «HTTP 404 · 0 симв.» на каждый запрос, хотя в
// браузере страница открывалась. Разница была в заголовках: приложение всегда
// сообщало идентификатор устройства (HWID), а браузер — нет. Панели с
// привязкой к устройству отвечают отказом на незнакомый идентификатор, когда
// лимит устройств исчерпан или подписка привязана к другому приложению.

// --- Запрос без сведений об устройстве --------------------------------------
assert.match(source, /function headers\(ua: string, hwid: string, includeDevice = true\)/,
  'заголовки обязаны уметь работать без сведений об устройстве');
assert.match(source, /if \(!includeDevice\) return base;/);
// Пустой идентификатор не должен уходить на сервер как пустой заголовок.
assert.match(source, /if \(!safeHwid\) return base;/);

// Повтор без идентификатора обязан существовать и выполняться только тогда,
// когда обычные способы ничего не дали.
const anonymous = source.slice(source.indexOf('Попытка без сведений об устройстве'));
assert.ok(anonymous.length > 0, 'нужна попытка без сведений об устройстве');
assert.match(anonymous, /if \(!links\.size && !clash\.length\)/);
assert.match(anonymous, /downloadOnce\(target, userAgent, false\)/);

// Пользователь должен видеть в журнале, каким способом получена конфигурация.
assert.match(source, /Конфигурация получена без передачи сведений об устройстве/);
assert.match(source, /без сведений об устройстве/, 'сводка ответа обязана отмечать такой запрос');

// Браузеру панель отдаёт страницу, поэтому её тип тоже принимается сервером.
assert.match(source, /Accept: 'text\/plain, application\/json, application\/yaml, text\/html/);

// --- Порядок: ошибка не должна обрывать последнюю попытку -------------------
// Ошибка первого запроса возвращается наружу, а не выбрасывается внутри:
// иначе чтение страницы браузерным движком не успевало отработать, и патч,
// добавивший его, вообще не запускался.
assert.match(source, /firstFailure: firstFailure \?\? undefined/);
assert.doesNotMatch(
  source,
  /if \(!links\.size && !clash\.length && firstFailure\) throw firstFailure;/,
  'ошибка не выбрасывается до чтения страницы',
);

// Показывается она только после того, как испробованы все способы.
const pageStep = manager.indexOf('readSubscriptionUrlFromPage');
const throwStep = manager.indexOf('throw material.firstFailure');
assert.ok(pageStep > 0 && throwStep > pageStep, 'сначала чтение страницы, только потом ошибка');

console.log('Subscription device-header checks passed.');
