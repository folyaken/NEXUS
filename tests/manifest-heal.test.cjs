const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { healStubManifest, isStubManifest } = require(path.join(root, 'dist-electron', 'manifest-heal.js'));
const main = require('node:fs').readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');

// --- Определение огрызка -----------------------------------------------------
assert.equal(isStubManifest({ id: 'zapret', name: 'zapret' }), true, 'name = id — огрызок');
assert.equal(isStubManifest({ id: 'zapret' }), true, 'имени нет — огрызок');
assert.equal(isStubManifest({ id: 'zapret', name: 'Обход DPI' }), false, 'человеческое имя — не огрызок');

// --- Лечение -----------------------------------------------------------------
const stub = { id: 'zapret', name: 'zapret', category: 'other', installed_version: '1.10.3', executable: './bin/winws.exe' };
const bundled = { id: 'zapret', name: 'Обход DPI', category: 'dpi', description: 'Открывает YouTube и Discord.', icon: '🛡️' };
const healed = healStubManifest(stub, bundled);
assert.ok(healed, 'огрызок лечится');
assert.equal(healed.name, 'Обход DPI', 'возвращается человеческое имя');
assert.equal(healed.category, 'dpi', 'категория берётся из штатного манифеста');
assert.equal(healed.icon, '🛡️', 'иконка возвращается');
// Рабочие поля пользователя сохраняются: их писал апдейтер после установки.
assert.equal(healed.installed_version, '1.10.3');
assert.equal(healed.executable, './bin/winws.exe');

// Живой манифест не трогается: пользовательские подписки и стратегии не сносятся.
const good = { id: 'zapret', name: 'Обход DPI', category: 'dpi', strategy: 'general (ALT13)' };
assert.equal(healStubManifest(good, bundled), null, 'не-огрызок лечить не нужно');

// Штатный манифест без имени лечением не считается.
assert.equal(healStubManifest(stub, { id: 'zapret' }), null, 'без имени в штатном лечить нечем');

// --- Связка со стартом -------------------------------------------------------
assert.match(main, /healStubManifest\(user, bundled\)/, 'старт приложения обязан лечить огрызки манифестов');

console.log('Manifest heal checks passed.');
