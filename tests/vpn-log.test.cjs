const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { describeVpnFailure, parseVpnLogLine, stripAnsi } = require(path.join(root, 'dist-electron', 'vpn-log.js'));
const managerSource = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');

// --- Реальная строка из отчёта пользователя ---------------------------------
// Штатный обрыв соединения показывался как ERROR вместе с ANSI-кодами и
// внутренними адресами. При обычном сёрфинге такие строки идут десятками.
const realLine = '\u001b[31mERROR\u001b[0m[0036] [\u001b[38;5;226m1147351762\u001b[0m 32.41s] connection: connection download closed: close tcp 127.0.0.1:10809->127.0.0.1:56142: shutdown: An existing connection was forcibly closed by the remote host.';
const parsed = parseVpnLogLine(realLine);

assert.equal(parsed.noise, true, 'обрыв соединения — фоновый шум, а не поломка VPN');
assert.equal(parsed.fatal, false, 'такая строка не должна становиться причиной отказа');
assert.equal(parsed.level, 'info');
assert.doesNotMatch(parsed.message, /\u001b|\[31m|\[0m|38;5;226/, 'ANSI-раскраска обязана вырезаться');
assert.doesNotMatch(parsed.message, /127\.0\.0\.1:\d+/, 'внутренние адреса не показываются пользователю');
assert.match(parsed.message, /локальный порт/);

// --- Прочий фоновый шум -----------------------------------------------------
for (const noisy of [
  'connection upload closed: EOF',
  'read: connection reset by peer',
  'write: broken pipe',
  'use of closed network connection',
  'context canceled',
  'wsarecv: An existing connection was forcibly closed by the remote host.',
]) {
  const line = parseVpnLogLine(noisy);
  assert.equal(line.noise, true, `должно считаться шумом: ${noisy}`);
  assert.equal(line.fatal, false);
}

// --- Настоящие отказы -------------------------------------------------------
for (const fatal of [
  'failed to listen on 127.0.0.1:10808: bind: address already in use',
  'panic: runtime error',
  'invalid config: unexpected token',
  'failed to parse config file',
  'permission denied',
]) {
  const line = parseVpnLogLine(fatal);
  assert.equal(line.fatal, true, `должно считаться отказом: ${fatal}`);
  assert.equal(line.level, 'error');
  assert.equal(line.noise, false);
}

// --- Понятные пользователю причины ------------------------------------------
// Технический текст ядра сам по себе ничего не подсказывает.
assert.match(describeVpnFailure('bind: address already in use', 'proxy'), /порт занят/i);
assert.match(describeVpnFailure('permission denied', 'tun'), /администратора/i);
assert.match(describeVpnFailure('permission denied', 'proxy'), /администратора/i);
assert.match(describeVpnFailure('invalid config: bad json', 'proxy'), /Профиль сервера/i);
assert.match(describeVpnFailure('invalid user: uuid mismatch', 'proxy'), /Обновите подписку/i);
assert.match(describeVpnFailure('no such file or directory', 'proxy'), /Проверить обновления/i);
assert.match(describeVpnFailure('cannot resolve host', 'proxy'), /адрес сервера/i);
assert.match(describeVpnFailure('tls handshake failed', 'proxy'), /другой сервер/i);
// Подсказка про TUN отличается от общей: режимы требуют разных действий.
assert.notEqual(describeVpnFailure('permission denied', 'tun'), describeVpnFailure('permission denied', 'proxy'));
// Неизвестный текст не теряется, но очищается от раскраски.
assert.doesNotMatch(describeVpnFailure('\u001b[31msomething odd\u001b[0m', 'proxy'), /\u001b/);

// --- Служебные строки -------------------------------------------------------
assert.equal(parseVpnLogLine(''), null);
assert.equal(parseVpnLogLine('   '), null);
assert.equal(parseVpnLogLine('\u001b[31m\u001b[0m'), null, 'строка из одной раскраски бессмысленна');
assert.equal(stripAnsi('\u001b[31mERROR\u001b[0m'), 'ERROR');

// Длина ограничена: одна строка ядра не должна занимать весь журнал.
const huge = parseVpnLogLine(`failed to start: ${'x'.repeat(2000)}`);
assert.ok(huge.message.length <= 240);

// --- Интеграция с менеджером ------------------------------------------------
assert.match(managerSource, /parseVpnLogLine\(rawLine\)/, 'вывод ядра должен разбираться построчно');
assert.match(managerSource, /if \(parsed\.noise\) continue;/, 'шум не показывается пользователю');
assert.match(managerSource, /if \(parsed\.fatal\) lastErr =/, 'причиной отказа становится только настоящий сбой');
assert.match(managerSource, /describeVpnFailure\(lastErr, mode\)/, 'пользователь видит объяснение, а не текст ядра');
// Прежнее поведение: любое слово error поднимало тревогу.
assert.doesNotMatch(managerSource, /if \(\/failed\|error\|fatal\|invalid\/i\.test\(text\)\)/, 'грубая проверка по подстроке удалена');
// Файл журнала не должен содержать управляющих последовательностей.
assert.match(managerSource, /stripAnsi\(text\)/, 'в файл пишется строка без раскраски');

console.log('VPN log parsing checks passed.');
