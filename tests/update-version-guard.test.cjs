const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { compareVersions } = require(path.join(root, 'dist-electron', 'launch-at-login.js'));
const updaterSource = require('node:fs').readFileSync(path.join(root, 'src', 'main', 'app-updater.ts'), 'utf8');

// --- Сравнение версий --------------------------------------------------------
assert.equal(compareVersions('1.6.25', '1.6.24'), 1, 'патч больше — новее');
assert.equal(compareVersions('1.6.24', '1.6.25'), -1, 'патч меньше — старее');
assert.equal(compareVersions('1.6.25', '1.6.25'), 0, 'равны');
assert.equal(compareVersions('2.0.0', '1.9.9'), 1, 'минорная граница');
assert.equal(compareVersions('1.10.0', '1.9.9'), 1, '10 > 9, а не строкой «1.10 < 1.9»');
assert.equal(compareVersions('1.6', '1.6.0'), 0, 'короткая запись равна полной');

// --- Связка с проверкой обновления -------------------------------------------
// Обновление предлагается только на строго новую версию: равенство и откат
// на канал со старой версией не должны превращаться в «Доступна версия…».
assert.match(updaterSource, /compareVersions\(latestVersion, this\.currentVersion\) <= 0/, 'проверка обязана строго сравнивать версии');
assert.ok(!/latestVersion === this\.currentVersion/.test(updaterSource), 'проверка на равенство заменена сравнением');

console.log('Update version guard checks passed.');
