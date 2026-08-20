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

// --- Заставку должно быть видно ------------------------------------------------------
// Главная жалоба: «анимацию даже не видно, она только появляется и сразу
// программа». React отрисовывается за доли секунды, и заставка, снимавшаяся по
// первому же событию отрисовки, обрывалась на первом кадре — выходило
// мелькание, похожее на сбой. Теперь показ доигрывается до конца.
assert.match(indexHtml, /MIN_VISIBLE/, 'у заставки должен быть минимальный показ');
const minVisible = /MIN_VISIBLE = calm \? (\d+) : (\d+)/.exec(indexHtml);
assert.ok(minVisible, 'минимальное время показа должно задаваться явно');
assert.ok(Number(minVisible[2]) >= 2500,
  `анимация обязана успевать проиграться, сейчас ${minVisible[2]}мс`);
// При отключённых анимациях держать окно незачем — показывать нечего.
assert.ok(Number(minVisible[1]) < Number(minVisible[2]),
  'без анимаций заставка не должна задерживать запуск');
// Скрытие идёт через отсчёт остатка, а не сразу по готовности интерфейса.
assert.match(indexHtml, /function hideWhenShown/);
assert.match(indexHtml, /MIN_VISIBLE - \(Date\.now\(\) - startedAt\)/);
// Повторный вызов не должен запускать затухание дважды.
assert.match(indexHtml, /if \(hidden\) return;/);

// --- Знак живёт бесконечностью --------------------------------------------------------
// Просьба была анимировать логотип «как бесконечность»: по замкнутому контуру
// знака бесконечно бегут огоньки, встречаясь в перекрестье.
assert.match(indexHtml, /nexus-boot-comet/, 'нужен бегущий огонёк по ленте');
assert.match(indexHtml, /@keyframes nexus-comet/);
assert.match(indexHtml, /animation:\s*\n?\s*nexus-comet [\d.]+s linear [-\d.]+s infinite/,
  'движение по ленте обязано быть бесконечным');

// Длина штриха обязана совпадать с длиной контура знака. Раньше стояло 64 при
// настоящей длине 53.28, и линия дорисовывалась заметно раньше конца анимации.
const contour = [
  [4.2, 13.6], [4.2, 9.6], [7.2, 6.6], [12, 11.8], [16.8, 6.6], [19.8, 9.6],
  [19.8, 13.6], [16.8, 16.6], [12, 11.4], [7.2, 16.6], [4.2, 13.6],
];
let length = 0;
for (let i = 1; i < contour.length; i += 1) {
  length += Math.hypot(contour[i][0] - contour[i - 1][0], contour[i][1] - contour[i - 1][1]);
}
const dash = /\.nexus-boot-ribbon \{[^}]*stroke-dasharray:\s*([\d.]+)/.exec(indexHtml);
assert.ok(dash, 'у ленты должен быть задан штрих');
assert.ok(Math.abs(Number(dash[1]) - length) < 0.5,
  `штрих ${dash[1]} не совпадает с длиной контура ${length.toFixed(2)}`);

// Подписи меняются: неподвижный текст через несколько секунд читается как зависание.
assert.match(indexHtml, /Проверка модулей…/);

// Движение подчиняется настройке анимаций Windows — как и весь интерфейс.
assert.match(indexHtml, /@media \(prefers-reduced-motion: reduce\)/);
const reduced = indexHtml.slice(indexHtml.indexOf('@media (prefers-reduced-motion: reduce)'));
assert.match(reduced, /\.nexus-boot-ring, \.nexus-boot-track i \{ animation: none; \}/);
// Новые слои движения тоже обязаны подчиняться настройке, иначе при
// «отключить анимации» половина заставки продолжит жить своей жизнью.
assert.match(reduced, /\.nexus-boot-comet, \.nexus-boot-pulse \{ animation: none;/);
assert.match(reduced, /\.nexus-boot-mark, \.nexus-boot-aurora\.one, \.nexus-boot-aurora\.two \{ animation: none; \}/);
assert.match(reduced, /\.nexus-boot-name span \{ animation: none;/);

// Заставка обязана попадать в собранную страницу — но проверять это здесь
// нельзя, и вот почему.
//
// `npm test` собирает только main-процесс: папку `dist/` создаёт отдельная
// команда `npm run build`. Значит на машине разработчика там почти всегда
// лежит сборка от предыдущего запуска — без свежих правок.
//
// Первая попытка сравнивать время файлов провалилась: при распаковке патча
// `index.html` получает дату из архива (то есть момент сборки патча), а
// локальный `dist/` собран позже — и проверка снова падала, хотя с кодом всё
// в порядке. Дважды подряд тест ругался не на ошибку, а на устаревший артефакт.
//
// Правильное место для такой проверки — сама сборка, а не набор тестов.
// Скрипт выпуска (`scripts/build-release.cjs`) сверяет `dist/index.html` сразу
// после `vite build`, когда файл заведомо свежий.

// Проверка не должна потеряться совсем: убеждаемся, что сборка выпуска её
// выполняет. Так тест сторожит саму защиту, не трогая артефакты.
const releaseScript = fs.readFileSync(path.join(root, 'scripts', 'build-release.cjs'), 'utf8');
assert.match(releaseScript, /id="nexus-boot"/, 'сборка обязана проверять заставку в собранной странице');

console.log('Windows version and splash screen checks passed.');
