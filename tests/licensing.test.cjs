const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
const notices = fs.readFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');

// --- Лицензия продукта ------------------------------------------------------
assert.equal(manifest.license, 'SEE LICENSE IN LICENSE', 'проприетарные условия объявляются формой SPDX');
assert.equal(manifest.author, 'NEXUS');
assert.equal(manifest.build.copyright, 'Copyright (c) 2026 NEXUS');

assert.match(license, /Все права защищены/);
assert.match(license, /Copyright \(c\) 2026 NEXUS/);
// Ключевые разделы: без отказа от гарантий проприетарная лицензия неполна.
assert.match(license, /ОТСУТСТВИЕ ГАРАНТИЙ/);
assert.match(license, /ОГРАНИЧЕНИЕ ОТВЕТСТВЕННОСТИ/);
// Условия продукта не должны распространяться на сторонние компоненты.
assert.match(license, /THIRD-PARTY-NOTICES\.md/);
assert.match(license, /не распространяются на сторонние компоненты/);

// --- Сторонние компоненты ---------------------------------------------------
// Лицензии проверены по официальным репозиториям, а не по справочникам.
const expected = [
  ['Xray-core', /Mozilla Public License 2\.0/],
  ['sing-box', /GNU General Public License 3\.0/],
  ['Zapret', /MIT/],
  ['TG WS Proxy', /MIT/],
];
for (const [component, licensePattern] of expected) {
  assert.ok(notices.includes(component), `${component} должен быть описан`);
  assert.match(notices, licensePattern, `лицензия ${component} должна быть указана`);
}

// У каждого компонента обязана быть ссылка на исходный код: это требование
// и MPL-2.0, и GPL-3.0.
for (const repo of [
  'https://github.com/XTLS/Xray-core',
  'https://github.com/SagerNet/sing-box',
  'https://github.com/Flowseal/zapret-discord-youtube',
  'https://github.com/Flowseal/tg-ws-proxy',
]) {
  assert.ok(notices.includes(repo), `нужна ссылка на исходники: ${repo}`);
}

// Дополнительное условие sing-box: производные работы не вправе использовать имя
// проекта. Его легко упустить — GitHub показывает лицензию как «Other».
assert.match(notices, /no derivative work may use the name/i, 'особое условие sing-box должно быть приведено дословно');

// GPL-компонент не должен входить в установщик: иначе NEXUS становится его
// распространителем со всеми вытекающими обязательствами.
assert.match(notices, /не входит в состав установщика/);
const buildFiles = manifest.build.files.join('\n');
assert.doesNotMatch(buildFiles, /modules\/bin/, 'ядра не упаковываются в asar');

// Тексты лицензий обязаны попадать в установщик.
assert.ok(manifest.build.files.includes('LICENSE'));
assert.ok(manifest.build.files.includes('THIRD-PARTY-NOTICES.md'));
// Установщик показывает условия отдельным шагом.
assert.equal(manifest.build.nsis.license, 'LICENSE');

// --- Шрифты -----------------------------------------------------------------
// OFL требует прикладывать текст лицензии рядом со шрифтами.
for (const fontLicense of ['Inter-OFL.txt', 'JetBrains-Mono-OFL.txt', 'Space-Grotesk-OFL.txt']) {
  assert.ok(fs.existsSync(path.join(root, 'assets', 'fonts', fontLicense)), `нужен текст лицензии: ${fontLicense}`);
}
assert.match(notices, /SIL Open Font License/);

// --- Пользователь видит правовую информацию ---------------------------------
assert.match(app, /Лицензии<\/h3>/, 'раздел «О программе» должен показывать лицензии');
assert.match(app, /MPL-2\.0/);
assert.match(app, /GPL-3\.0/);
assert.match(app, /THIRD-PARTY-NOTICES\.md/, 'нужна отсылка к полному перечню');
assert.match(readme, /## Лицензия/);

console.log('Licensing checks passed.');
