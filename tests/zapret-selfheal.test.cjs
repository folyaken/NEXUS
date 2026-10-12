const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const updaterSource = fs.readFileSync(path.join(root, 'src', 'main', 'github-updater.ts'), 'utf8');
const managerSource = fs.readFileSync(path.join(root, 'src', 'main', 'module-manager.ts'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');

// --- Готовность модуля: исполняемый файл + профили запуска --------------------
// Zapret без .bat-стратегий неработоспособен, но раньше считался «установленным»:
// проверка обновлений не докачивала пропавшее, запуск падал «не найдена».
assert.match(updaterSource, /private moduleReady\(id: string\): boolean/, 'должна быть полная проверка готовности');
assert.match(updaterSource, /module\.launch_mode !== 'batch'/, 'для batch-модулей требуются профили');
assert.match(updaterSource, /if \(!values\.length\) return false;/, 'пустой список профилей — модуль не готов');
assert.match(updaterSource, /this\.moduleReady\(target\.id\)/, 'условие «уже установлен» обязано проверять готовность целиком');
assert.ok(!/installed\.asset === asset\.name && executableExists/.test(updaterSource), 'старое условие только по исполняемому файлу убрано');
assert.equal((updaterSource.match(/this\.moduleReady\(id\)/g) ?? []).length >= 3, true, 'ensureTarget тоже проверяет полную готовность');

// --- Запуск докачивает отсутствующий модуль сам --------------------------------
assert.match(mainSource, /const tracked = updater\.list\(\)\.some\(\(item\) => item\.id === moduleId\);/, 'повторная попытка только для модулей с каналом обновлений');
assert.match(mainSource, /await updater\.ensure\(moduleId\);/, 'запуск обязан докачать отсутствующий модуль');
assert.match(mainSource, /return await manager\.start\(moduleId\);/, 'после докачки старт повторяется');
assert.match(mainSource, /if \(!tracked \|\| !\/не найден\/\.test\(message\)\) throw error;/, 'прочие ошибки запуска не глотаются');

// --- Тексты ошибок ведут к одной кнопке -----------------------------------------
assert.ok(!managerSource.includes('Проверить GitHub'), 'устаревшее имя кнопки убрано');
assert.match(managerSource, /Нажмите «Запустить» ещё раз/, 'подсказка должна звать ту же кнопку запуска');

// --- Версия и журнал -------------------------------------------------------------
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
assert.equal(version, '1.6.28', 'версия повышена: предыдущая локальная сборка должна отличаться');
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
assert.match(changelog, /## 1\.6\.28 — 12\.10\.2026/, 'в журнале есть раздел новой версии');

console.log('Zapret self-heal wiring checks passed.');

// --- Докачка наблюдаема в журнале ---------------------------------------------
// Ошибки обновлений были видны только в полосе на странице модулей: со
// страницы журнала казалось, что программа молча ничего не делает.
assert.match(mainSource, /reportedUpdateStatus/, 'статусы обновлений зеркалятся в журнал');
assert.equal((mainSource.match(/logs:append/g) ?? []).length >= 3, true, 'лог-канал используется зеркалом и обработчиком запуска');
assert.match(mainSource, /Файлы модуля отсутствуют — скачиваю с GitHub…/, 'старт докачки пишется в журнал');
assert.match(mainSource, /Не удалось скачать: /, 'ошибка докачки пишется в журнал');
assert.match(mainSource, /Загрузка завершена — повторяю запуск…/, 'повторный запуск пишется в журнал');

console.log('Update log visibility checks passed.');
