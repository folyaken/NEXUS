const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  addDpiHost,
  dpiHostlistPath,
  normalizeDpiHost,
  readDpiHostlist,
  removeDpiHost,
  syncDpiHostlistInto,
} = require(path.join(root, 'dist-electron', 'dpi-hostlist.js'));

// --- Нормализация пользовательского ввода -----------------------------------
// Люди вставляют ссылку целиком; в список должен попасть чистый домен.
assert.equal(normalizeDpiHost('instagram.com'), 'instagram.com');
assert.equal(normalizeDpiHost('  Instagram.COM  '), 'instagram.com');
assert.equal(normalizeDpiHost('https://instagram.com/'), 'instagram.com');
assert.equal(normalizeDpiHost('https://www.instagram.com/p/123?x=1#y'), 'instagram.com');
assert.equal(normalizeDpiHost('instagram.com:443'), 'instagram.com');
assert.equal(normalizeDpiHost('http://user:pass@instagram.com/path'), 'instagram.com');
assert.equal(normalizeDpiHost('.instagram.com.'), 'instagram.com');
assert.equal(normalizeDpiHost('sub.instagram.com'), 'sub.instagram.com', 'поддомены сохраняются');

// Мусор и неподдерживаемые адреса отбрасываются.
for (const invalid of ['', '   ', 'localhost', 'instagram', '1.2.3.4', '::1', 'exa mple.com', 'https://', '-bad.com', 'bad-.com', 'site.123', `${'a'.repeat(64)}.com`, null, 42]) {
  assert.equal(normalizeDpiHost(invalid), null, `должен отклоняться: ${String(invalid)}`);
}

// --- Хранение списка --------------------------------------------------------
void (async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-dpi-test-'));
  try {
    assert.deepEqual((await readDpiHostlist(temp)).hosts, [], 'на старте список пуст');

    await addDpiHost(temp, 'https://www.instagram.com/');
    const afterFirst = await addDpiHost(temp, 'rutracker.org');
    assert.deepEqual(afterFirst.hosts, ['instagram.com', 'rutracker.org'], 'порядок добавления сохраняется');

    // Список хранится отдельно от релиза Zapret, поэтому переживает обновление ядра.
    assert.equal(afterFirst.filePath, dpiHostlistPath(temp));
    assert.ok(afterFirst.filePath.includes(path.join('configs', 'dpi')), 'файл лежит вне каталога релиза');
    assert.match(await fsp.readFile(afterFirst.filePath, 'utf8'), /^#/, 'файл начинается с пояснения для пользователя');

    await assert.rejects(addDpiHost(temp, 'INSTAGRAM.com'), /уже есть в списке/, 'дубликаты отклоняются');
    await assert.rejects(addDpiHost(temp, 'не сайт'), /Введите адрес сайта/, 'подсказка должна быть понятной');

    const afterRemove = await removeDpiHost(temp, 'https://instagram.com');
    assert.deepEqual(afterRemove.hosts, ['rutracker.org'], 'удаление принимает ссылку целиком');
    assert.deepEqual((await removeDpiHost(temp, 'unknown.com')).hosts, ['rutracker.org'], 'удаление отсутствующего безопасно');

    // Повреждённые строки не ломают чтение.
    await fsp.writeFile(afterRemove.filePath, '# комментарий\n\nrutracker.org\nне сайт\nexample.com\nEXAMPLE.com\n', 'utf8');
    assert.deepEqual((await readDpiHostlist(temp)).hosts, ['rutracker.org', 'example.com'], 'мусор и дубликаты отсеиваются');

    // --- Подмешивание в рабочий список Zapret --------------------------------
    const release = path.join(temp, 'bin', 'zapret', 'lists');
    await fsp.mkdir(release, { recursive: true });
    const listFile = path.join(release, 'list-general.txt');
    await fsp.writeFile(listFile, 'youtube.com\ndiscord.com\n', 'utf8');

    assert.equal(await syncDpiHostlistInto(listFile, ['example.com']), true);
    const merged = await fsp.readFile(listFile, 'utf8');
    assert.match(merged, /youtube\.com/, 'штатный список релиза сохраняется');
    assert.match(merged, /discord\.com/);
    assert.match(merged, /example\.com/, 'пользовательский домен добавлен');

    // Повторная синхронизация заменяет блок целиком, а не копит дубликаты.
    await syncDpiHostlistInto(listFile, ['example.com', 'rutracker.org']);
    const second = await fsp.readFile(listFile, 'utf8');
    assert.equal(second.match(/example\.com/g).length, 1, 'домен не должен дублироваться');
    assert.equal(second.match(/NEXUS/g).length, 2, 'блок ограничен ровно одной парой маркеров');
    assert.match(second, /rutracker\.org/);

    // Пустой список убирает блок, оставляя файл релиза нетронутым.
    await syncDpiHostlistInto(listFile, []);
    const cleaned = await fsp.readFile(listFile, 'utf8');
    assert.doesNotMatch(cleaned, /example\.com|NEXUS/, 'блок удаляется полностью');
    assert.match(cleaned, /youtube\.com\ndiscord\.com/, 'содержимое релиза не пострадало');

    // Отсутствующий файл не должен ронять запуск модуля.
    assert.equal(await syncDpiHostlistInto(path.join(temp, 'нет-такого.txt'), ['example.com']), false);

    // --- Описания модулей для широкой аудитории ------------------------------
    for (const [moduleId, expected] of [
      ['tg-ws-proxy', 'Возвращает доступ к Telegram, когда он заблокирован.'],
      ['zapret', 'Открывает YouTube, Discord и другие сайты без VPN.'],
    ]) {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'modules', `${moduleId}.module.json`), 'utf8'));
      assert.equal(manifest.description, expected);
      assert.ok(manifest.description.length <= 80, `${moduleId}: описание должно быть коротким`);
      assert.doesNotMatch(manifest.description, /127\.0\.0\.1|MTProto|порт|трее/i, `${moduleId}: без технических деталей`);
    }

    const managerSource = fs.readFileSync(path.join(root, 'src', 'main', 'module-manager.ts'), 'utf8');
    assert.match(managerSource, /TG_WS_DESCRIPTION = 'Возвращает доступ к Telegram/, 'описание в коде должно совпадать с манифестом');

    console.log('DPI hostlist and module description checks passed.');
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
})();

// --- Регрессия: домены не применялись к реальным профилям Zapret -------------
// Пути в .bat записаны через переменные (%LISTS%list-general.txt). Раньше
// разворачивался только %~dp0, имя файла оставалось буквальным «%LISTS%...»,
// не находилось на диске — и добавленные сайты молча не работали.
void (async () => {
  const { ModuleManager } = require(path.join(root, 'dist-electron', 'module-manager.js'));
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-dpi-real-bat-'));
  try {
    const release = path.join(temp, 'bin', 'zapret');
    const lists = path.join(release, 'lists');
    await fsp.mkdir(lists, { recursive: true });
    await fsp.writeFile(path.join(lists, 'list-general.txt'), 'youtube.com\ndiscord.com\n', 'utf8');

    // Профиль в формате настоящего релиза Flowseal.
    const batch = path.join(release, 'general (ALT10).bat');
    await fsp.writeFile(batch, [
      '@echo off',
      'chcp 65001 > nul',
      'cd /d "%~dp0"',
      'set "BIN=%~dp0bin\\"',
      'set "LISTS=%~dp0lists\\"',
      'start "zapret" /min "%BIN%winws.exe" --wf-tcp=80,443 ^',
      '--filter-tcp=80,443 --hostlist="%LISTS%list-general.txt" --hostlist="%LISTS%list-general-user.txt" --hostlist-exclude="%LISTS%list-exclude.txt"',
      '',
    ].join('\r\n'), 'utf8');

    await fsp.writeFile(path.join(temp, 'zapret.module.json'), JSON.stringify({
      id: 'zapret',
      name: 'Обход DPI',
      description: 'Открывает YouTube, Discord и другие сайты без VPN.',
      enabled: false,
      executable: './bin/zapret/bin/winws.exe',
      working_dir: './bin/zapret',
      launch_mode: 'batch',
      strategy: 'general (ALT10)',
      strategies: { 'general (ALT10)': './bin/zapret/general (ALT10).bat' },
      args: [],
      status: 'stopped',
      category: 'dpi',
      icon: 'S',
      pid: null,
      log_file: './logs/zapret.log',
    }, null, 2));

    const manager = new ModuleManager(temp);
    manager.setProcessScanner(async () => []);
    await manager.init();

    await addDpiHost(temp, 'twitter.com');
    await addDpiHost(temp, 'soundcloud.com');

    const { hosts } = await readDpiHostlist(temp);
    await manager.applyCustomDpiHosts(manager.list().find((item) => item.id === 'zapret'), batch);

    // Домены обязаны попасть в пользовательский список, который Zapret читает
    // наравне с основным и не затирает при обновлении.
    const userListPath = path.join(lists, 'list-general-user.txt');
    assert.equal(fs.existsSync(userListPath), true, 'пользовательский список должен создаваться');
    const userList = await fsp.readFile(userListPath, 'utf8');
    assert.match(userList, /twitter\.com/);
    assert.match(userList, /soundcloud\.com/);

    // Штатный список релиза остаётся нетронутым.
    const general = await fsp.readFile(path.join(lists, 'list-general.txt'), 'utf8');
    assert.match(general, /youtube\.com/);
    assert.doesNotMatch(general, /twitter\.com/, 'домены пишутся только в пользовательский файл');

    // Ни один путь не должен остаться неразвёрнутым.
    for (const name of await fsp.readdir(lists)) {
      assert.doesNotMatch(name, /%/, `неразвёрнутая переменная в имени файла: ${name}`);
    }
    assert.equal(fs.existsSync(path.join(release, '%LISTS%list-general.txt')), false);

    // Повторный запуск не плодит дубликаты.
    await manager.applyCustomDpiHosts(manager.list().find((item) => item.id === 'zapret'), batch);
    const twice = await fsp.readFile(userListPath, 'utf8');
    assert.equal(twice.match(/twitter\.com/g).length, 1, 'домен не должен дублироваться при перезапуске');
    assert.deepEqual(hosts, ['twitter.com', 'soundcloud.com']);

    console.log('Zapret real-profile hostlist checks passed.');
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
})();
