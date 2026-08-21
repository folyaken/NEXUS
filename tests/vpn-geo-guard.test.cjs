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
assert.match(vpnManager, /Проверить обновления/);
// Настоящая причина падения (stderr ядра) не прячется за общим текстом:
// общее сообщение показывается только когда причина неизвестна или касается
// наборов адресов.
assert.match(vpnManager, /const geoFailure = \/geosite\|geoip\|no such file\|not found\|cannot find\/i\.test\(lastErr\)/);
assert.match(vpnManager, /reason = describeVpnFailure\(lastErr, mode\)/,
  'если причина не про наборы адресов, показывается настоящая ошибка ядра');
// Если групповые правила были в конфиге и ядро упало — следующая попытка
// идёт без них, чтобы VPN точно включился.
assert.match(vpnManager, /lastConfigIncludedGeo/);
assert.match(vpnManager, /geoRulesForbidden = true/);
assert.match(vpnManager, /geoRulesAllowed = geoReady && !this\.geoRulesForbidden/);
// Копии наборов без расширения: старые ядра Xray (26.1.13–26.1.17) искали
// файл `geosite` без `.dat` и падали с кодом 23 даже при наличном geosite.dat.
assert.match(vpnManager, /placeGeoAlias/);
assert.match(vpnManager, /datFile\.replace\(\/\\\.dat\$\/i, ''\)/);
// Конфиг с групповыми правилами проверяется ядром до запуска (-test): если
// ядро их не принимает, NEXUS пересобирает конфиг без них и запускается сразу,
// а не после первого падения с кодом 23.
assert.match(vpnManager, /spawnSync\(engine, \['-test', '-config', configFile\]/);
// Мёртвые теги отбрасываются по одному: каждый уникальный тег проверяется
// своим крошечным конфигом, и выкидывается только нерабочий — остальные
// правила продолжают действовать.
assert.match(vpnManager, /probeConfigPath = path\.join\(this\.configsDir\(\), 'probe_config\.json'\)/);
assert.match(vpnManager, /deadTags = new Set/);
assert.match(vpnManager, /Тег \$\{tag\} отсутствует в наборах адресов/);
assert.match(vpnManager, /const liveRules = usableRules\s*\n\s*\.map\(/);
// Мёртвый тег не просто отключается: подбирается синоним, который есть в
// наборах адресов (старый geosite.dat не знает новых имён разделов).
assert.match(vpnManager, /geoTagAlternatives\(dead\)/);
assert.match(vpnManager, /tagSubstitutions = new Map/);
assert.match(vpnManager, /Правило \$\{dead\} заменено на \$\{candidate\}/);
assert.match(vpnManager, /replacement \? \{ \.\.\.rule, value: replacement \} : null/);
const ensureXray = fs.readFileSync(path.join(root, 'scripts', 'ensure-xray.cjs'), 'utf8');
assert.match(ensureXray, /replace\(\/\\\.dat\$\/i, ''\)/, 'скрипт установки ядра тоже обязан класть копию без расширения');
const updater = fs.readFileSync(path.join(root, 'src', 'main', 'github-updater.ts'), 'utf8');
assert.match(updater, /replace\(\/\\\.dat\$\/i, ''\)/, 'обновление ядра тоже обязано класть копию без расширения');

// Сообщение об ошибке переводится, как и остальные сообщения из main-процесса.
assert.equal(
  i18n.hasTranslation('en', 'VPN-ядро не смогло загрузить наборы адресов (код 23). Программа подключит без групповых правил; после «Проверить обновления» и перезапуска они вернутся.'),
  true,
  'нужен английский перевод сообщения о коде 23',
);

console.log('VPN geo files guard checks passed.');
