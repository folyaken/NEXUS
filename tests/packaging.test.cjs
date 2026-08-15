const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const build = manifest.build;
const mainSource = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const managerSource = fs.readFileSync(path.join(root, 'src', 'main', 'module-manager.ts'), 'utf8');
const vpnSource = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');

// --- Блокер 1: ядра не должны попадать внутрь asar --------------------------
// asar — read-only архив: операционная система не может запустить из него
// исполняемый файл. Ядро, упакованное туда, просто не стартует.
assert.ok(build.asar, 'asar остаётся включённым для исходников');
const filesText = build.files.join('\n');
assert.doesNotMatch(filesText, /^modules\/\*\*\/\*$/m, 'modules/**/* затягивает бинарники в asar');
assert.ok(build.files.includes('modules/*.module.json'), 'манифесты модулей нужны в сборке');

const binResource = build.extraResources.find((item) => item.from === 'modules/bin');
assert.ok(binResource, 'ядра обязаны лежать вне asar, в extraResources');
assert.equal(binResource.to, 'modules/bin', 'путь должен совпадать с тем, где их ищет VpnManager');

// Код ищет ядро именно по этому пути — иначе вложение бессмысленно.
assert.match(vpnSource, /path\.join\(process\.resourcesPath, 'modules', 'bin', name\)/);

// --- Блокер 3: личные данные не должны уезжать в установщик -----------------
// modules/configs/vpn содержит профили с ключами и UUID, modules/logs — журналы.
for (const secret of ['modules/configs', 'modules/logs', 'modules/vpn']) {
  assert.ok(
    !build.files.some((pattern) => pattern.startsWith(secret) && !pattern.startsWith('!')),
    `${secret} не должен попадать в сборку: там личные данные пользователя`,
  );
}
// Явного включения configs/logs быть не может, но проверяем и фильтр бинарников.
assert.ok(
  binResource.filter.some((item) => item.startsWith('!')),
  'журналы рядом с ядрами тоже исключаются',
);

// Вложенные ядра переносятся в рабочий каталог, иначе приложение скачает их заново.
assert.match(mainSource, /async function adoptBundledBinaries/, 'нужен перенос вложенных ядер');
assert.match(mainSource, /force: false/, 'скачанное обновление не должно откатываться вложенным файлом');
assert.match(mainSource, /await adoptBundledBinaries\(userModulesDir\)/);

// --- Блокер 2: права администратора -----------------------------------------
const { elevationMessage, moduleNeedsElevation, tunElevationMessage } = require(path.join(root, 'dist-electron', 'elevation.js'));

// Zapret работает через драйвер WinDivert — без прав он не стартует.
assert.equal(moduleNeedsElevation('zapret'), true);
assert.equal(moduleNeedsElevation('tg-ws-proxy'), false, 'локальному прокси права не нужны');
assert.equal(moduleNeedsElevation('dns-guard'), false);

// Сообщения обязаны объяснять действие, а не только факт отказа.
assert.match(elevationMessage('Обход DPI'), /Обход DPI/);
// Сообщение должно подсказывать действие, а не только называть проблему.
assert.match(elevationMessage('Обход DPI'), /ярлык/i);
assert.match(elevationMessage('Обход DPI'), /прав администратора/i);
assert.match(tunElevationMessage(), /TUN/);
assert.match(tunElevationMessage(), /PROXY/, 'у пользователя должен быть рабочий обходной путь');

// Проверка выполняется ДО запуска процесса: иначе ядро падает с невнятной ошибкой.
assert.match(managerSource, /if \(moduleNeedsElevation\(id\) && !\(await isElevated\(\)\)\)/);
assert.match(vpnSource, /if \(mode === 'tun' && !\(await isElevated\(\)\)\)/);

// Zapret и TUN без администратора не работают вообще, поэтому приложение
// запрашивает повышение через манифест exe: заставлять человека каждый раз
// перезапускать программу вручную бессмысленно.
assert.equal(build.win.requestedExecutionLevel, 'requireAdministrator',
  'приложение должно запрашивать права само');

// signAndEditExecutable: false отключил бы resedit целиком — вместе с ним
// перестал бы применяться и requestedExecutionLevel, то есть запрос прав молча
// не попал бы в манифест. По умолчанию флаг true, поэтому его просто нет.
assert.notEqual(build.win.signAndEditExecutable, false,
  'этот флаг отключает правку манифеста и обнуляет запрос прав');
// signExecutable появился только в electron-builder 26+: на версии 25.1.8 он
// валит сборку с «unknown property». Подпись и так не выполняется без сертификата.
assert.ok(!('signExecutable' in build.win),
  'signExecutable не поддерживается установленной версией electron-builder');

// Без сертификата electron-builder всё равно тянет и распаковывает winCodeSign.
// В архиве лежат символические ссылки для macOS, и Windows без прав на их
// создание выдаёт поток ошибок «Cannot create symbolic link … libcrypto.dylib»
// на каждый .exe. Собственная функция подписи убирает загрузку пакета целиком.
assert.equal(build.win.sign, 'build/no-sign.cjs', 'нужна заглушка подписи, пока нет сертификата');
assert.ok(fs.existsSync(path.join(root, 'build', 'no-sign.cjs')), 'файл заглушки должен существовать');
assert.ok(build.files.includes('build/no-sign.cjs'), 'заглушка обязана попадать в сборку');

const noSign = require(path.join(root, 'build', 'no-sign.cjs'));
assert.equal(typeof noSign.default, 'function', 'electron-builder ожидает экспорт default');

// Ключевое: заглушка отключает только подпись. Правка ресурсов обязана
// остаться — именно она записывает requestedExecutionLevel в манифест, без
// которого Zapret и TUN не получат прав администратора.
assert.notEqual(build.win.signAndEditExecutable, false,
  'этот флаг отключил бы и правку манифеста вместе с запросом прав');

// Конфигурация проверяется настоящей схемой electron-builder, а не на глаз:
// неизвестное свойство обнаруживается здесь, а не при сборке установщика.
const scheme = require(path.join(root, 'node_modules', 'app-builder-lib', 'scheme.json'));
const { validateConfiguration } = require(path.join(root, 'node_modules', 'app-builder-lib', 'out', 'util', 'config', 'config.js'));
assert.doesNotThrow(
  () => validateConfiguration(JSON.parse(JSON.stringify(build)), scheme, { warn() {} }),
  'конфигурация сборки должна соответствовать схеме установленной версии',
);

// Установка для всех пользователей: программа и так ставится с повышением.
assert.equal(build.nsis.perMachine, true);
assert.equal(build.nsis.allowElevation, true);

// Страховка на случай portable-сборки и запуска из среды разработки:
// там манифест может не примениться, и причину отказа нужно объяснить.
assert.match(managerSource, /moduleNeedsElevation\(id\) && !\(await isElevated\(\)\)/);

console.log('Packaging and elevation checks passed.');

// --- Запуск профилей Zapret --------------------------------------------------
// Профили не принимают аргументы: строку запуска winws.exe они собирают сами.
// Передача параметров в `call` заставляла cmd выполнять их как команды —
// пользователь видел «'--filter-udp' is not recognized as an internal or
// external command», и модуль падал с кодом 1.
assert.doesNotMatch(managerSource, /call "\$\{batchFile\}"\$\{suffix\}/,
  'аргументы нельзя дописывать в вызов профиля');
assert.match(managerSource, /NEXUS_EXTRA_ARGS/,
  'экспертные параметры передаются переменной окружения');

// Профиль использует ^ для переноса строк: на одиночном LF команда рвётся.
assert.match(managerSource, /lines\.join\('\\r\\n'\)/, 'runner обязан использовать CRLF');

// --- Самостоятельное повышение прав ------------------------------------------
// Манифест exe запрашивает права, но у portable-сборки он применяется не всегда,
// а ярлык мог быть создан вручную. Без запасного пути пользователю приходилось
// каждый раз вызывать «Запуск от имени администратора» самому.
const elevationSource = fs.readFileSync(path.join(root, 'src', 'main', 'elevation.ts'), 'utf8');
assert.match(elevationSource, /export function relaunchElevated/);
assert.match(elevationSource, /-Verb RunAs/, 'повышение выполняется через UAC');
assert.match(elevationSource, /detached: true/, 'новый процесс должен пережить закрытие текущего');
assert.match(elevationSource, /child\.unref\(\)/);

// Путь уходит в PowerShell: без экранирования апостроф позволил бы подставить
// произвольную команду.
assert.match(elevationSource, /replace\(\/'\/g, "''"\)/, 'аргументы обязаны экранироваться');

// Перезапуск только для установленной версии: в разработке он мешал бы работе.
assert.match(mainSource, /if \(app\.isPackaged && process\.platform === 'win32' && !\(await isElevated\(\)\)\)/);
assert.match(mainSource, /relaunchElevated\(process\.execPath, process\.argv\.slice\(1\)\)/);
// Отказ пользователя от повышения не должен закрывать приложение.
assert.match(mainSource, /Повышение не удалось/);
