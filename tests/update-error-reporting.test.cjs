const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const updater = fs.readFileSync(path.join(root, 'src', 'main', 'github-updater.ts'), 'utf8');
const subscription = fs.readFileSync(path.join(root, 'src', 'main', 'subscription.ts'), 'utf8');
const vpnManager = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'scripts', 'run-tests.cjs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// --- Приоритет причин отказа обновления -------------------------------------
// Файл может полностью скачаться с GitHub и не пройти проверку целостности, а
// следом недоступные зеркала добавят «fetch failed». Показывать нужно причину
// целостности, иначе пользователь видит «проверьте интернет» при рабочей сети.
assert.match(updater, /const failures: Error\[\] = \[\];/, 'причины отказов должны собираться по всем зеркалам');
assert.match(updater, /isIntegrityFailure/, 'нужен приоритет ошибок целостности');
assert.match(updater, /Контрольная сумма\|не является\|скачан не полностью\|слишком мал/, 'ошибки целостности должны распознаваться');
assert.match(updater, /failures\.find\(\(error\) => isIntegrityFailure\(error\.message\)\)/, 'ошибка целостности должна выбираться первой');
assert.doesNotMatch(updater, /let lastError: unknown = new Error\('Не удалось скачать GitHub asset'\)/, 'нельзя показывать ошибку последнего зеркала');

// Транспортное сообщение обязано подсказывать реальный обходной путь.
assert.match(updater, /GitHub и запасные зеркала недоступны/, 'сетевая ошибка должна называть настоящую причину');
assert.match(updater, /включите VPN в Jey2Ray/, 'пользователю нужен работающий обходной путь');
assert.doesNotMatch(updater, /Не удалось связаться с сервером обновлений\. Проверьте подключение к интернету/, 'старая формулировка вводила в заблуждение');

// --- Панель, отвечающая HTML вместо конфигурации ----------------------------
// Marzban/Remnawave/3x-ui выбирают формат по User-Agent. Один повтор с другим
// известным агентом решает проблему и не расходует лимит устройств: конфигурация
// на первом запросе выдана не была.
assert.match(subscription, /SUBSCRIPTION_FALLBACK_USER_AGENTS/, 'нужны запасные User-Agent');
assert.match(subscription, /clash-verge/, 'в списке должен быть распространённый клиент');
assert.match(subscription, /if \(!links\.size && !clash\.length\)/, 'повтор допустим только когда ничего не разобрано');
assert.match(subscription, /break;/, 'после успешного ответа перебор обязан прекращаться');

// Бюджет запросов обязан покрывать повторы, иначе они упрутся в лимит.
const limits = subscription.slice(subscription.indexOf('SUBSCRIPTION_TRANSPORT_LIMITS'));
assert.match(limits, /maxRequests: 64,/, 'бюджет должен учитывать повторы по User-Agent для обеих целей');

// Текст ошибки обязан объяснять, что делать, а не просто фиксировать формат.
assert.match(vpnManager, /Панель выдаёт конфигурацию только своим приложениям/, 'ошибка должна называть причину');
assert.match(vpnManager, /Получить ссылку/, 'ошибка должна подсказывать конкретное действие');

// Адрес конфигурации на странице панели прячется в кнопке «Добавить подписку»:
// это ссылка в клиентское приложение. Без её разбора подписки таких панелей
// добавить нельзя — пользователь упирался в «Панель вернула веб-страницу».
assert.match(subscription, /extractSubscriptionUrlFromClientLink/, 'нужен разбор ссылок клиентских приложений');
assert.match(subscription, /discoveredTarget/, 'найденный адрес обязан участвовать в повторах');

// Отказ панели конкретному клиенту не должен прекращать перебор: панель может
// быть настроена на список разрешённых приложений, и следующий агент подойдёт.
assert.doesNotMatch(
  subscription.slice(subscription.indexOf('retries: for')),
  /continue retries;/,
  'отказ одному клиенту не прекращает перебор остальных',
);

// --- Видимость уровня патча -------------------------------------------------
// Без этого невозможно отличить «фикс не работает» от «архив не распаковался».
assert.equal(typeof manifest.patchLevel, 'number', 'манифест должен объявлять уровень патча');
assert.ok(manifest.patchLevel >= 23, 'уровень патча должен расти вместе с исправлениями');
assert.match(runner, /уровень патча/, 'прогон тестов должен печатать уровень патча');

console.log('Update error reporting and subscription fallback checks passed.');
