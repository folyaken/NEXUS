const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const { hasTranslation } = require(path.join(root, 'dist-electron', 'i18n.js'));

// --- «Подключиться к лучшему» ---------------------------------------------------------
// Как в привычных VPN-клиентах: одна кнопка сама измеряет пинг и подключает
// самый быстрый сервер. Раньше человек должен был сравнивать строки списка
// и выбирать руками.
assert.match(page, /Подключиться к лучшему/, 'нужна кнопка с понятной подписью');
assert.match(page, /const quickConnect = async \(\) => \{/, 'нужен обработчик нажатия');
// Выбор идёт тем же способом, что у короны лучшего сервера, — pickFastest.
assert.match(page, /pickFastest\(fresh\)/, 'цель подключения должна выбираться как самый быстрый');
assert.match(page, /setSelectedId\(target\.id\)/);
assert.match(page, /await connect\(target\.id\)/);
// Если пинг ещё не измеряли, кнопка сначала меряет его — иначе «самый
// быстрый» был бы просто первым в списке.
assert.match(page, /const unmeasured = visible\.some/);
assert.match(page, /window\.nexus\?\.pingVpn\(\)/);
// Во время замера видна та же индикация, что у обычной проверки пинга.
assert.match(page, /setAction\('ping'\)/);
assert.match(page, /Замеряем пинг…/);
// Пустые и повторные случаи объясняются всплывающей подсказкой, а не тишиной.
assert.match(page, /Уже подключены к самому быстрому серверу/);
assert.match(page, /Нет доступных серверов/);
// Кнопка не мешает во время подключения и не запускает второе действие.
assert.match(page, /className="quick-connect"/);
assert.match(page, /disabled=\{busy \|\| Boolean\(action\) \|\| runtime\.status === 'connecting'\}/);

// Кнопка оформлена в стиле интерфейса и красится темами вместе с остальным.
assert.match(styles, /\.quick-connect \{/);
assert.match(styles, /\.quick-connect:disabled/);

// Переводы: кнопка обязана переводиться, как весь интерфейс.
for (const phrase of ['Подключиться к лучшему', 'Замеряем пинг…', 'Нет доступных серверов',
  'Уже подключены к самому быстрому серверу', 'Не удалось измерить пинг']) {
  assert.equal(hasTranslation('en', phrase), true, `нет перевода: ${phrase}`);
}

console.log('Quick connect checks passed.');
