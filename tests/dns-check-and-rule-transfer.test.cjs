const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const jey = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const { checkDnsServer, serversForSettings } = require(path.join(root, 'dist-electron', 'dns-check.js'));
const {
  exportRoutingRules, importRoutingRules, mergeRoutingRules,
} = require(path.join(root, 'dist-electron', 'routing-transfer.js'));
const { MAX_ROUTING_RULES } = require(path.join(root, 'dist-electron', 'routing-rules.js'));
const { hasTranslation } = require(path.join(root, 'dist-electron', 'i18n.js'));

/**
 * Поднимает подставной DNS на локальном порту.
 *
 * Настоящие серверы в проверках недоступны и зависят от сети, поэтому ответ
 * подделываем: так тест проверяет именно разбор пакета, а не наличие интернета.
 */
function startFakeDns({ broken = false } = {}) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.on('message', (message, remote) => {
      const header = Buffer.alloc(12);
      header.writeUInt16BE(message.readUInt16BE(0), 0);
      // 0x8180 — успешный ответ, 0x8183 — «имя не найдено».
      header.writeUInt16BE(broken ? 0x8183 : 0x8180, 2);
      header.writeUInt16BE(1, 4);
      header.writeUInt16BE(broken ? 0 : 1, 6);
      const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 93, 184, 216, 34]);
      const body = broken ? message.subarray(12) : Buffer.concat([message.subarray(12), answer]);
      socket.send(Buffer.concat([header, body]), remote.port, remote.address);
    });
    socket.bind(0, '127.0.0.1', () => resolve({ port: socket.address().port, close: () => socket.close() }));
  });
}

/** Подменяет порт 53 на локальный, чтобы запрос ушёл к подставному серверу. */
function withRedirectedPort(port, action) {
  const original = dgram.createSocket;
  dgram.createSocket = (type) => {
    const socket = original(type);
    const send = socket.send.bind(socket);
    socket.send = (buffer, _port, _host, callback) => send(buffer, port, '127.0.0.1', callback);
    return socket;
  };
  return action().finally(() => { dgram.createSocket = original; });
}

(async () => {
  // --- Проверка справочника имён ---------------------------------------------------
  // Открытый порт ничего не доказывает: у провайдеров бывают заглушки, которые
  // принимают соединение и молчат. Поэтому шлём настоящий запрос и разбираем ответ.
  const alive = await startFakeDns();
  const good = await withRedirectedPort(alive.port, () => checkDnsServer('1.1.1.1', 2000));
  alive.close();
  assert.equal(good.ok, true, 'рабочий сервер обязан определяться');
  assert.ok(typeof good.latencyMs === 'number' && good.latencyMs > 0, 'нужно время ответа');
  assert.equal(good.title, 'Cloudflare', 'известный адрес подписывается названием');

  // Ответ с ошибкой не должен считаться успехом: сервер жив, но не работает.
  const broken = await startFakeDns({ broken: true });
  const bad = await withRedirectedPort(broken.port, () => checkDnsServer('1.1.1.1', 2000));
  broken.close();
  assert.equal(bad.ok, false, 'ответ с ошибкой — это не рабочий справочник');
  assert.ok(bad.error, 'нужна причина отказа');

  // Молчащий сервер: проверка обязана завершиться по времени, а не висеть.
  const startedAt = Date.now();
  const silent = await checkDnsServer('203.0.113.1', 700);
  assert.equal(silent.ok, false);
  assert.ok(Date.now() - startedAt < 3000, 'проверка не должна зависать');
  assert.match(silent.error, /не ответил/i);

  // Защищённые адреса идут по другому протоколу — запрос по UDP до них не
  // дойдёт, и показывать ложную ошибку нельзя.
  const secure = await checkDnsServer('https://dns.example.com/dns-query');
  assert.equal(secure.ok, true);
  assert.match(secure.error, /Защищённый/);

  // У системного справочника своих адресов нет: их назначает Windows.
  assert.deepEqual(serversForSettings('system', ''), []);
  assert.deepEqual(serversForSettings('cloudflare', ''), ['1.1.1.1']);
  assert.deepEqual(serversForSettings('custom', 'сломано'), [], 'битый адрес не проверяем');

  // --- Обмен наборами правил -----------------------------------------------------------
  const rules = [
    { id: 'a', value: 'geosite:ru', outbound: 'direct', enabled: true },
    { id: 'b', value: 'ads.example.com', outbound: 'block', enabled: false },
  ];
  const file = exportRoutingRules(rules);
  const parsed = JSON.parse(file);
  assert.equal(parsed.kind, 'nexus-routing-rules', 'нужна метка формата');
  assert.ok(parsed.exportedAt, 'дата помогает разобраться среди файлов');
  // Идентификаторы привязаны к устройству и при переносе только мешают.
  assert.ok(parsed.rules.every((rule) => !rule.id), 'идентификаторы не переносятся');

  const back = importRoutingRules(file);
  assert.equal(back.rules.length, 2, 'правила читаются обратно');
  assert.equal(back.rules[1].enabled, false, 'выключенное правило остаётся выключенным');

  // Файл приходит извне, доверия к нему нет: битые записи отбрасываются, но
  // весь импорт из-за них падать не должен.
  const dirty = importRoutingRules(JSON.stringify({
    kind: 'nexus-routing-rules', version: 1,
    rules: [{ value: 'ok.com', outbound: 'proxy' }, { value: 'сломано' }, { value: 'ok.com', outbound: 'direct' }],
  }));
  assert.equal(dirty.rules.length, 1, 'битые и повторяющиеся записи отбрасываются');
  assert.equal(dirty.skipped, 2);

  for (const [text, expected] of [
    ['не json', /повреждён/i],
    ['{"kind":"other","rules":[]}', /другой программы/i],
    ['{"kind":"nexus-routing-rules","version":99,"rules":[]}', /новой версией/i],
    ['{"kind":"nexus-routing-rules"}', /нет правил/i],
  ]) {
    const outcome = importRoutingRules(text);
    assert.equal(outcome.rules.length, 0);
    assert.match(outcome.error, expected, `нужна понятная причина для: ${text.slice(0, 30)}`);
  }

  // Допускаем и голый список: человек мог собрать файл руками.
  assert.equal(importRoutingRules('[{"value":"x.com","outbound":"proxy"}]').rules.length, 1);

  // Загрузка добавляет к текущим, а не заменяет: замена стёрла бы настроенное.
  const merged = mergeRoutingRules(
    [{ id: '1', value: 'ads.example.com', outbound: 'block', enabled: true }],
    back.rules,
  );
  assert.equal(merged.added, 1, 'повтор пропускается');
  assert.equal(merged.rules.length, 2);
  // Предел соблюдается и при загрузке из файла.
  const overflow = mergeRoutingRules(
    Array.from({ length: MAX_ROUTING_RULES }, (_, i) => ({ id: `${i}`, value: `site${i}.com`, outbound: 'proxy', enabled: true })),
    [{ id: 'x', value: 'extra.com', outbound: 'proxy', enabled: true }],
  );
  assert.equal(overflow.added, 0, 'сверх предела правила не добавляются');

  // --- Связь с приложением -------------------------------------------------------------
  assert.match(main, /ipcMain\.handle\('dns:check-current'/);
  assert.match(main, /ipcMain\.handle\('dns:measure-all'/);
  assert.match(main, /ipcMain\.handle\('routing:export'/);
  assert.match(main, /ipcMain\.handle\('routing:import'/);
  // Загруженные правила попадают в конфигурацию при старте ядра, поэтому
  // активная сессия перезапускается — иначе набор не действовал бы.
  const importer = main.slice(main.indexOf('async function loadRoutingRulesFromFile'));
  assert.match(importer, /connectVpnProfile\(current\.activeProfileId/, 'после импорта нужен перезапуск сессии');
  assert.match(importer, /mergeRoutingRules\(settings\.vpnRoutingRules/, 'импорт обязан добавлять, а не заменять');

  // --- Интерфейс ------------------------------------------------------------------------
  assert.match(jey, /Проверить DNS/);
  assert.match(jey, /Найти самый быстрый/);
  assert.match(jey, /dns-ranking/, 'замеры показываются списком, а не одним победителем');
  assert.match(jey, /const runDnsCheck = /);
  assert.match(jey, /const runDnsMeasure = /);
  assert.match(jey, /disabled=\{dnsBusy !== null\}/, 'во время проверки кнопки блокируются');
  assert.match(jey, /Загрузить набор/);
  assert.match(jey, /Сохранить набор/);
  assert.match(jey, /disabled=\{!routingRules\.length\}/, 'пустой набор сохранять незачем');
  assert.match(styles, /\.dns-ranking li:first-child:not\(\.is-bad\) \.dns-ranking-place/, 'победитель выделяется');
  assert.match(styles, /\.dns-check-result\.is-bad/);

  for (const phrase of ['Проверить DNS', 'Найти самый быстрый', 'Загрузить набор', 'Сохранить набор', 'Сервер не ответил']) {
    assert.equal(hasTranslation('en', phrase), true, `нужен перевод: «${phrase}»`);
  }

  console.log('DNS check and routing transfer checks passed.');
})();
