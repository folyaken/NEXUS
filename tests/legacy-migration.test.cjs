const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { LEGACY_DATA_SUBPATH, migrateLegacyUserData } = require(path.join(root, 'dist-electron', 'legacy-migration.js'));

void (async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-legacy-'));
  try {
    const userData = path.join(temp, 'nexus-network-tools');
    const legacy = path.join(userData, ...LEGACY_DATA_SUBPATH.split(/[\\/]/));
    const legacyModules = path.join(legacy, 'modules');
    await fsp.mkdir(path.join(legacyModules, 'bin', 'zapret'), { recursive: true });
    await fsp.writeFile(path.join(legacy, 'settings.json'), '{"autoStart":true}\n');
    await fsp.writeFile(path.join(legacy, 'profile.json'), '{"name":"Старая копия"}\n');
    await fsp.writeFile(path.join(legacyModules, 'bin', 'zapret', 'winws.exe'), 'stub');
    await fsp.writeFile(path.join(legacyModules, 'bin', 'zapret', 'general (ALT13).bat'), '@echo off\r\n');

    const result = await migrateLegacyUserData(userData);
    assert.equal(result.found, true, 'старая папка должна быть найдена');
    assert.ok(result.moved.includes('settings.json'), 'настройки переносятся');
    assert.ok(result.moved.includes('profile.json'), 'профиль переносится');
    assert.equal(await fsp.readFile(path.join(userData, 'settings.json'), 'utf8'), '{"autoStart":true}\n');
    assert.ok(fs.existsSync(path.join(userData, 'modules', 'bin', 'zapret', 'winws.exe')), 'ядро переносится');
    assert.ok(!fs.existsSync(legacy), 'вложенная копия убирается');

    // --- Повторный запуск: миграции уже нет, ничего не ломается --------------
    const again = await migrateLegacyUserData(userData);
    assert.equal(again.found, false, 'после переноса старой папки больше нет');

    // --- Свежие данные не перекрываются --------------------------------------
    await fsp.mkdir(legacy, { recursive: true });
    await fsp.writeFile(path.join(legacy, 'settings.json'), '{"autoStart":false}\n');
    await fsp.writeFile(path.join(userData, 'settings.json'), '{"autoStart":true}\n');
    const third = await migrateLegacyUserData(userData);
    assert.equal(third.found, true, 'повторная папка переносится');
    assert.ok(!third.moved.includes('settings.json'), 'свои настройки не перекрываются старыми');
    assert.equal(await fsp.readFile(path.join(userData, 'settings.json'), 'utf8'), '{"autoStart":true}\n');

    console.log('Legacy migration checks passed.');
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
})();
