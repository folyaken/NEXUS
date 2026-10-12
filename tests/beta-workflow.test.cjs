const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const mainSource = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const releaseSource = fs.readFileSync(path.join(root, 'scripts', 'build-release.cjs'), 'utf8');

// --- Две версии на одном компьютере: стабильная и техническая -----------------
// Стабильная ставится установщиком и живёт в своей папке данных. Беты
// изолируются: отдельная папка данных — эксперименты не трогают стабильную.

// Изоляция данных беты: редирект после блокировки одиночного запуска и до
// любого использования папки данных (кэш, настройки, модули читаются позже).
const lockIndex = mainSource.indexOf('requestSingleInstanceLock');
const redirectIndex = mainSource.indexOf("app.getVersion().includes('-beta')");
assert.ok(lockIndex !== -1, 'блокировка одиночного запуска на месте');
assert.ok(redirectIndex > lockIndex, 'редирект данных беты — после блокировки запуска');
assert.match(mainSource, /if \(app\.isPackaged && app\.getVersion\(\)\.includes\('-beta'\)\) \{\s*\n\s*app\.setPath\('userData', `\$\{app\.getPath\('userData'\)\}-beta`\);/, 'бета получает отдельную папку данных');
assert.match(mainSource, /Эксперименты в бете физически не могут испортить стабильную/, 'комментарий объясняет изоляцию');

// Беты собираются переносным exe: установка поверх стабильной невозможна.
assert.match(releaseSource, /const isBeta = version\.includes\('-beta'\);/, 'сборщик различает беты и релизы');
assert.match(releaseSource, /'-c\.win\.target=portable'/, 'бета собирается переносным exe');
assert.match(releaseSource, /NEXUS-Portable-\$\{version\}\.\$\{ext\}/, 'имя переносного файла с версией');
assert.match(releaseSource, /Беты не публикуются/, 'сборщик напоминает: беты в релизы не попадают');
// Для релизов всё по-прежнему: NSIS + latest.yml.
assert.match(releaseSource, /NEXUS-Setup-\$\{version\}\.exe/, 'релизная ветка сохранена');
assert.match(releaseSource, /required = \[installer, 'latest\.yml'\];/, 'релиз требует latest.yml');

// Текущая версия — техническая, раздел журнала относится к будущему релизу.
assert.match(version, /^1\.6\.29-beta\.\d+$/, `ожидается бета 1.6.29, получено ${version}`);
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
assert.match(changelog, /## 1\.6\.29 —/, 'в журнале есть раздел будущей версии');

console.log('Beta workflow checks passed.');
