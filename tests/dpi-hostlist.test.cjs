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
