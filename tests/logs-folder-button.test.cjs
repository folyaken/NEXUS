const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src', 'main', 'preload.ts'), 'utf8');
const env = fs.readFileSync(path.join(root, 'src', 'renderer', 'env.d.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const { hasTranslation } = require(path.join(root, 'dist-electron', 'i18n.js'));

// --- Кнопка «Открыть папку с логами» -----------------------------------------------
// Раньше, чтобы получить логи для поддержки, человеку приходилось объяснять
// путь к папке словами. Теперь она открывается в проводнике одним кликом.
assert.match(main, /ipcMain\.handle\('logs:open-folder'/, 'нужен обработчик открытия папки логов');
assert.match(main, /shell\.openPath\(logsDir\)/, 'папка должна открываться через shell.openPath');
assert.match(main, /path\.join\(manager\.getModulesDir\(\), 'logs'\)/,
  'путь обязан браться из modulesDir, а не из ввода пользователя');
assert.match(main, /fs\.mkdir\(logsDir, \{ recursive: true \}\)/,
  'папку нужно создавать, если её ещё нет');
// Безопасность: обработчик не принимает никаких данных от пользователя.
const handler = main.slice(main.indexOf("ipcMain.handle('logs:open-folder'"));
assert.match(handler.slice(0, handler.indexOf(';')), /async \(\) =>/,
  'обработчик не должен принимать аргументов — открыть можно только папку логов');

assert.match(preload, /openLogsFolder: \(\): Promise<string \| null> => ipcRenderer\.invoke\('logs:open-folder'\)/,
  'метод обязан быть открыт окну через preload');
assert.match(env, /openLogsFolder\(\): Promise<string \| null>;/, 'метод обязан быть в типах окна');

// Кнопка на странице «Логи» рядом с копированием отчёта.
assert.match(app, /Открыть папку с логами/, 'нужна подпись кнопки');
assert.match(app, /const openLogsFolder = async \(\) =>/, 'нужен обработчик нажатия');
assert.match(app, /window\.nexus\?\.openLogsFolder/);
// В браузерном предпросмотре папки нет — человек должен получить честную
// подсказку, а не молчаливую кнопку.
assert.match(app, /Папка с логами доступна в установленной программе/);
// Обе кнопки стоят рядом в общей строке действий.
assert.match(styles, /\.logs-heading-actions \{ display: flex/);

// Переводы: кнопка обязана переводиться, как весь интерфейс.
assert.equal(hasTranslation('en', 'Открыть папку с логами'), true);
assert.equal(hasTranslation('en', 'Не удалось открыть папку с логами'), true);
assert.equal(hasTranslation('en', 'Папка с логами доступна в установленной программе'), true);

console.log('Logs folder button checks passed.');
