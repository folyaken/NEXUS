const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const vpnManager = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');
const i18n = require(path.join(root, 'dist-electron', 'i18n.js'));

// --- «Код 23» и файлы наборов адресов ---------------------------------------------
// Правило `geosite:ru` без валидного geosite.dat рядом с ядром роняет Xray
// сразу после запуска — с кодом 23 и без объяснения. Раньше файлы могли
// лежать в другом каталоге (например, докачаться в пользовательскую папку,
// пока ядро оставалось в папке установки): проверка их «видела», правила
// попадали в конфиг, и ядро падало.
assert.match(vpnManager, /ensureGeoFilesBesideEngine/, 'файлы наборов обязаны переноситься к ядру');
assert.match(vpnManager, /copyFileSync\(candidate, beside\)/,
  'валидная копия должна копироваться в папку ядра');
assert.match(vpnManager, /mkdirSync\(engineDir, \{ recursive: true \}\)/);
// Проверка идёт не только по существованию: пустышка от оборванной загрузки
// роняет ядро так же, как отсутствующий файл.
assert.match(vpnManager, /statSync\(file\)\.size > 1024/,
  'файл обязан считаться годным только при ненулевом размере');
// Битые копии удаляются, чтобы ядро и следующая проверка их не подхватили.
assert.match(vpnManager, /Удалён повреждённый файл/);
assert.match(vpnManager, /rmSync\(candidate, \{ force: true \}\)/);
// Перенос вызывается перед построением конфига и влияет на то, какие правила
// попадут в него.
assert.match(vpnManager, /const geoReady = useSingbox \|\| this\.ensureGeoFilesBesideEngine\(engine\)/);
// При падении с кодом 23 человек получает внятное объяснение, а не «код 23».
assert.match(vpnManager, /failed && code === 23/);
assert.match(vpnManager, /код 23/);
assert.match(vpnManager, /dropBrokenGeoFiles\(\)/);
assert.match(vpnManager, /«Модули» → «Проверить обновления»/);

// Сообщение об ошибке переводится, как и остальные сообщения из main-процесса.
assert.equal(
  i18n.hasTranslation('en', 'VPN-ядро не загрузило файлы наборов адресов (код 23). Откройте «Модули» → «Проверить обновления», чтобы восстановить их.'),
  true,
  'нужен английский перевод сообщения о коде 23',
);

console.log('VPN geo files guard checks passed.');
