#!/usr/bin/env node
/**
 * Проверка настроек сборки перед запуском electron-builder.
 *
 * Зачем. Сборка установщика падала на шаге makensis, а понять причину по
 * выводу почти невозможно: NSIS печатает сотню строк «Command line defined»
 * и обрывается кодом 1. При этом часть причин видна заранее, в package.json.
 * Дешевле проверить их за секунду до сборки, чем ждать десять минут и читать
 * простыню.
 *
 * Запускается автоматически из `npm run release:win` и `npm run package:win`.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const build = manifest.build ?? {};

const problems = [];
const notes = [];

/**
 * Описание уходит в APP_DESCRIPTION и в ресурсы .exe.
 *
 * NSIS принимает определения командной строки в кодировке системы, а не UTF-8.
 * Кириллица превращалась в «NEXUS ◆ ◆◆◆◆◆◆◆◆ Electron-◆◆◆◆◆◆» — это было
 * видно прямо в выводе сборки. Отсюда же берутся сбои разбора.
 */
const description = String(manifest.description ?? '');
if (!/^[\x20-\x7e]*$/.test(description)) {
  problems.push([
    'В поле "description" есть символы вне латиницы.',
    'Они попадают в параметры NSIS и в свойства .exe, где ломаются в «◆◆◆◆».',
    'Замените описание на латиницу — пользователю оно почти не видно.',
  ]);
}

/**
 * Поле win.sign устарело в electron-builder 25: сборка печатает
 * «deprecated field fields=["sign"]» и в новых версиях перестанет его читать.
 * Тогда заглушка подписи не подключится, начнётся загрузка winCodeSign, а с
 * ней — поток ошибок про символические ссылки.
 */
if (build.win && Object.prototype.hasOwnProperty.call(build.win, 'sign')) {
  problems.push([
    'Поле build.win.sign устарело.',
    'Перенесите его в build.win.signtoolOptions.sign — иначе заглушка подписи',
    'перестанет применяться и сборка начнёт скачивать winCodeSign.',
  ]);
}

const signPath = build.win?.signtoolOptions?.sign ?? build.win?.sign;
if (signPath && !fs.existsSync(path.join(root, signPath))) {
  problems.push([`Файл заглушки подписи не найден: ${signPath}`]);
}

/**
 * Имя установщика без пробелов: GitHub заменяет их точками, и latest.yml
 * начинает ссылаться на несуществующий файл — обновление молча ломается.
 */
const artifact = build.nsis?.artifactName ?? '';
if (/\s/.test(artifact)) {
  problems.push([
    `В имени установщика есть пробел: ${artifact}`,
    'GitHub заменит его точкой, и обновление не найдёт файл.',
  ]);
}

/**
 * Файл лицензии готовит prepare-license.cjs. Если его забыли запустить,
 * makensis падает на директиве LicenseData без внятного объяснения.
 */
const license = build.nsis?.license;
if (license && !fs.existsSync(path.join(root, license))) {
  problems.push([
    `Файл лицензии не найден: ${license}`,
    'Запустите: node scripts/prepare-license.cjs',
  ]);
}

/**
 * Скрипт установщика подключается и при сборке деинсталлятора, где нет ни
 * страниц, ни nsDialogs. Раньше на этом makensis падал, поэтому блок со
 * страницей ярлыков обёрнут в !ifndef BUILD_UNINSTALLER. Проверяем, что
 * обёртка на месте — без неё сборка снова начнёт падать.
 */
const includePath = build.nsis?.include;
if (includePath) {
  const full = path.join(root, includePath);
  if (!fs.existsSync(full)) {
    problems.push([`Скрипт установщика не найден: ${includePath}`]);
  } else {
    const nsh = fs.readFileSync(full, 'utf8');
    if (nsh.includes('nsDialogs::Create') && !nsh.includes('!ifndef BUILD_UNINSTALLER')) {
      problems.push([
        'В build/installer.nsh есть страница nsDialogs без !ifndef BUILD_UNINSTALLER.',
        'При сборке деинсталлятора makensis выдаст предупреждение и остановится.',
      ]);
    }
  }
}

/**
 * Предупреждения NSIS по умолчанию считаются ошибками (ключ -WX). Одно
 * безобидное замечание останавливает всю сборку, а в выводе видно только
 * «makensis.exe process failed». Для выпуска это слишком строго.
 */
if (build.nsis?.warningsAsErrors !== false) {
  notes.push([
    'build.nsis.warningsAsErrors не выключен: любое предупреждение NSIS остановит сборку.',
    'Если сборка падает без понятной причины — поставьте false.',
  ]);
}

if (notes.length) {
  console.log('');
  for (const note of notes) {
    console.log(`  ! ${note[0]}`);
    for (const line of note.slice(1)) console.log(`    ${line}`);
  }
}

if (problems.length) {
  console.error('');
  console.error('Настройки сборки нужно поправить, иначе установщик не соберётся:');
  console.error('');
  for (const problem of problems) {
    console.error(`  ✗ ${problem[0]}`);
    for (const line of problem.slice(1)) console.error(`    ${line}`);
    console.error('');
  }
  process.exit(1);
}

console.log('Проверка настроек сборки пройдена.');
