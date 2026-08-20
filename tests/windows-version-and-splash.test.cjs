const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const { windowsVersionName } = require(path.join(root, 'dist-electron', 'windows-version.js'));

// --- Название версии Windows -------------------------------------------------------
// os.release() возвращает номер ядра, а не то, что написано на коробке:
// у Windows 11 он равен 10.0.x, ядро осталось десятым. Из-за этого в разделе
// «О программе» у всех показывалась «Windows 10» — в том числе на одиннадцатой.
// Отличить их можно только по номеру сборки: 22000 и выше — это 11.
assert.match(windowsVersionName('10.0.22000'), /^Windows 11/, 'сборка 22000 — это уже Windows 11');
assert.match(windowsVersionName('10.0.22631'), /^Windows 11/);
assert.match(windowsVersionName('10.0.26100'), /^Windows 11/);
assert.match(windowsVersionName('10.0.19045'), /^Windows 10/, 'сборка 19045 — это Windows 10');
assert.match(windowsVersionName('10.0.10240'), /^Windows 10/);
// Граница ровно на 22000: соседние сборки не должны попадать не в ту систему.
assert.match(windowsVersionName('10.0.21999'), /^Windows 10/);

// Название обновления помогает понять, о какой именно системе речь.
assert.match(windowsVersionName('10.0.26100'), /24H2/);
assert.match(windowsVersionName('10.0.19045'), /22H2/);
// Номер сборки остаётся: по нему видно точную версию в отчёте о проблеме.
assert.match(windowsVersionName('10.0.22631'), /сборка 22631/);

// Старые системы подписываются честно, а не как «Windows 6.1».
assert.equal(windowsVersionName('6.3.9600'), 'Windows 8.1');
assert.equal(windowsVersionName('6.1.7601'), 'Windows 7');
// Неизвестный формат не должен ронять раздел «О программе».
assert.match(windowsVersionName('мусор'), /Windows/);
assert.match(windowsVersionName(''), /Windows/);

assert.match(main, /windowsVersionName\(os\.release\(\)\)/, 'название версии обязано разбираться');
assert.doesNotMatch(main, /`Windows \$\{os\.release\(\)\}`/, 'сырой номер ядра показывать нельзя');

// --- Заставка запуска ---------------------------------------------------------------
// После установки обновления программа закрывается и открывается снова —
// несколько секунд человек видел чёрное окно и не понимал, работает ли что-то.
assert.match(indexHtml, /id="nexus-boot"/, 'нужна заставка запуска');
assert.match(indexHtml, /Запуск…/);

// Стили и разметка заставки лежат прямо в странице: всё, что подключается
// ссылкой, грузится уже после разбора, и заставка появилась бы с задержкой —
// то есть ровно тогда, когда она уже не нужна.
assert.doesNotMatch(indexHtml, /<link[^>]+nexus-boot/, 'заставка не должна зависеть от внешних файлов');
assert.ok(indexHtml.indexOf('id="nexus-boot"') < indexHtml.indexOf('src="./src/renderer/main.tsx"'),
  'заставка обязана идти до подключения интерфейса');

// Заставка убирается по факту отрисовки интерфейса, а не по таймеру: на разных
// машинах окно готово в разное время.
assert.match(indexHtml, /new MutationObserver/);
assert.match(indexHtml, /observer\.observe\(root, \{ childList: true \}\)/);
// Узел удаляется после затухания — иначе перехватывал бы нажатия.
assert.match(indexHtml, /parentNode\.removeChild\(boot\)/);
// Страховка: если интерфейс не появился, заставка всё равно уходит и
// показывается сообщение об ошибке, а не вечная анимация.
assert.match(indexHtml, /if \(!root\.children\.length\)/);

// Подписи меняются: неподвижный текст через несколько секунд читается как зависание.
assert.match(indexHtml, /Проверка модулей…/);

// Движение подчиняется настройке анимаций Windows — как и весь интерфейс.
assert.match(indexHtml, /@media \(prefers-reduced-motion: reduce\)/);
const reduced = indexHtml.slice(indexHtml.indexOf('@media (prefers-reduced-motion: reduce)'));
assert.match(reduced, /\.nexus-boot-ring, \.nexus-boot-track i \{ animation: none; \}/);

// Заставка обязана попадать в собранную страницу, иначе её никто не увидит.
const built = path.join(root, 'dist', 'index.html');
if (fs.existsSync(built)) {
  assert.match(fs.readFileSync(built, 'utf8'), /id="nexus-boot"/, 'заставка потерялась при сборке');
}

console.log('Windows version and splash screen checks passed.');
