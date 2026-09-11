const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src', 'main', 'preload.ts'), 'utf8');
const env = fs.readFileSync(path.join(root, 'src', 'renderer', 'env.d.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
const { hasTranslation } = require(path.join(root, 'dist-electron', 'i18n.js'));

// --- Кнопка «Проверить сеть» -----------------------------------------------------------
// Когда правило в ядре работает, а браузер показывает чужой IP, причина — в
// сети машины (осиротевший TUN-адаптер, второй прокси). Отчёт собирает
// системный прокси, адаптеры туннелей и маршруты по умолчанию в журнал NEXUS.
assert.match(main, /ipcMain\.handle\('net:diagnose'/, 'нужен обработчик отчёта о сети');
assert.match(main, /Internet Settings' \| Select-Object ProxyEnable, ProxyServer/,
  'отчёт обязан показывать системный прокси из реестра');
assert.match(main, /Get-NetAdapter.*Wintun\|TAP\|TUN/,
  'отчёт обязан показывать адаптеры туннелей');
assert.match(main, /Get-NetRoute -DestinationPrefix '0\.0\.0\.0\/0'/,
  'отчёт обязан показывать маршруты по умолчанию с именами адаптеров');
assert.match(main, /logs:append/, 'отчёт должен попадать в журнал NEXUS');
assert.match(preload, /netDiagnose: \(\): Promise<boolean> => ipcRenderer\.invoke\('net:diagnose'\)/);
assert.match(env, /netDiagnose\(\): Promise<boolean>;/);

// Кнопка на странице Jey2Ray рядом с диагностикой.
assert.match(page, /Проверить сеть/);
assert.match(page, /const runNetworkReport = async \(\) =>/);
assert.match(page, /window\.nexus\?\.netDiagnose/);
assert.match(page, /Отчёт сети записан в журнал/);

// Переводы.
for (const phrase of ['Проверить сеть', 'Прокси, адаптеры и маршруты',
  'Отчёт сети записан в журнал', 'Не удалось собрать отчёт сети',
  'Проверка сети доступна в установленной программе']) {
  assert.equal(hasTranslation('en', phrase), true, `нет перевода: ${phrase}`);
}

console.log('Network report checks passed.');
