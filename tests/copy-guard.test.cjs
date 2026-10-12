const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { guardScript, parseGuardOutput, closeStaleCopies } = require(path.join(root, 'dist-electron', 'copy-guard.js'));
const main = require('node:fs').readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');

// --- Сценарий для PowerShell -------------------------------------------------
const script = guardScript(String.raw`C:\Apps\NEXUS\NEXUS.exe`);
assert.match(script, /\$ours = 'C:\\Apps\\NEXUS\\NEXUS\.exe'/, 'наш путь попадает в сценарий как строка');
// Кавычка в пути экранируется удвоением, иначе сценарий не разберётся.
assert.ok(guardScript("C:\\User's\\NEXUS.exe").includes("User''s"), 'кавычка в пути экранируется');
assert.match(script, /Get-Process NEXUS/, 'перебираются только процессы NEXUS');
assert.match(script, /\$_\.Path -ne \$ours/, 'наша копия не трогается');
assert.match(script, /Stop-Process -Id \$\_\.Id -Force/, 'чужая копия закрывается');
assert.match(script, /Write-Output \$path/, 'путь закрытой копии возвращается для уведомления');

// --- Разбор вывода -----------------------------------------------------------
assert.deepEqual(parseGuardOutput('F:\\old\\NEXUS.exe\r\nD:\\other\\NEXUS.exe\n'), ['F:\\old\\NEXUS.exe', 'D:\\other\\NEXUS.exe']);
assert.deepEqual(parseGuardOutput(''), [], 'пустой вывод — ничего не закрыто');

// --- Контракт запуска --------------------------------------------------------
// На системах без Windows защита отключается: работать она обязана только
// у установленной программы на Windows.
void closeStaleCopies('C:\\x\\NEXUS.exe', async () => ({ stdout: '' })).then((closed) => {
  assert.ok(Array.isArray(closed), 'защита возвращает список путей');
  console.log('Copy guard checks passed.');
});
