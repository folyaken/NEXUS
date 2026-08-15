const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');
const viteConfig = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
const envTypes = fs.readFileSync(path.join(root, 'src', 'renderer', 'env.d.ts'), 'utf8');

// --- Версия берётся из манифеста --------------------------------------------
// Дублирование версии строкой означает, что после повышения интерфейс начнёт
// показывать старое значение, и понять установленную сборку будет невозможно.
assert.match(viteConfig, /__APP_VERSION__: JSON\.stringify\(version\)/, 'версия подставляется на сборке');
assert.match(viteConfig, /readFileSync\(fileURLToPath\(manifestUrl\), 'utf8'\)/, 'источник — package.json');

assert.match(app, /NEXUS v\{__APP_VERSION__\}/, 'боковая панель показывает версию из манифеста');
assert.match(app, /nexusVersion: __APP_VERSION__/, 'заглушка «О программе» тоже');

// Версия NEXUS не должна дублироваться строкой. Проверяется именно она:
// в файле встречаются посторонние числа — IP-адреса и версии сторонних
// модулей в демо-данных, которые к версии приложения отношения не имеют.
const currentVersion = manifest.version.replace(/[.]/g, '\\.');
assert.doesNotMatch(app, new RegExp(`NEXUS v${currentVersion}`), 'версия в панели должна подставляться');
assert.doesNotMatch(app, new RegExp(`nexusVersion: '${currentVersion}'`), 'заглушка не должна хранить версию строкой');

// Объявление должно быть внутри declare global: файл содержит import и является
// модулем, поэтому обычный declare const остался бы локальным.
const globalBlock = envTypes.slice(envTypes.indexOf('declare global {'));
assert.match(globalBlock, /const __APP_VERSION__: string;/, 'константа объявлена глобально');

// Версия в манифесте обязана быть корректной для electron-builder.
assert.match(manifest.version, /^\d+\.\d+\.\d+/, 'версия должна следовать semver');

// --- Демо-данные не показываются в приложении -------------------------------
// Раньше выдуманные модули, журнал и версии обновлений успевали мелькнуть в
// реальном окне до ответа main-процесса.
assert.match(app, /const isDesktop = typeof window !== 'undefined' && Boolean\(window\.nexus\)/);
assert.match(app, /useState<ModuleManifest\[\]>\(isDesktop \? \[\] : DEMO_MODULES\)/);
assert.match(app, /useState<ModuleLog\[\]>\(isDesktop \? \[\] : DEMO_LOGS\)/);
assert.match(app, /useState<UpdateInfo\[\]>\(isDesktop \? \[\] : DEMO_UPDATES\)/);

// Демо-набор сохранён: без него нельзя посмотреть интерфейс через dev:web.
assert.match(app, /const DEMO_MODULES: ModuleManifest\[\]/, 'демо-данные нужны для просмотра в браузере');

// Пустой список во время загрузки не должен читаться как «модулей нет».
assert.match(app, /const \[loadingModules, setLoadingModules\] = useState\(isDesktop\)/);
assert.match(app, /function ModuleSkeletons/, 'нужен скелет загрузки');
assert.match(app, /loadingModules \? <ModuleSkeletons count=\{4\} \/>/, 'скелет показывается вместо карточек');
assert.match(app, /!loadingModules && filteredModules\.length === 0/, '«Ничего не найдено» — только после загрузки');

// Флаг обязан сниматься и при ошибке, иначе скелет останется навсегда.
assert.match(app, /\.finally\(\(\) => \{\s*if \(alive\) setLoadingModules\(false\);/s, 'загрузка завершается в любом случае');

console.log('Version wiring and demo data checks passed.');
