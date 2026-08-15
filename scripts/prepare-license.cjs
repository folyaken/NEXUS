#!/usr/bin/env node
/**
 * Готовит текст лицензии для окна установщика.
 *
 * Установщик NSIS показывает файл лицензии как есть. Если файл сохранён в
 * UTF-8 без метки порядка байтов, Windows считает его текстом однобайтовой
 * кодировки, и вместо русских букв появляется «РЎРѕРіР»Р°С€РµРЅРёРµ» —
 * ровно то, что видел пользователь на первом шаге установки.
 *
 * Поэтому из канонического LICENSE собирается копия с меткой порядка байтов:
 * по ней NSIS распознаёт кодировку однозначно на любой системе. Так же
 * поступает и сам electron-builder с локализованными файлами лицензий — здесь
 * это делается для файла, указанного вручную. Исходный LICENSE не трогается,
 * он остаётся обычным текстовым файлом.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'LICENSE');
const target = path.join(root, 'build', 'license.txt');

function main() {
  if (!fs.existsSync(source)) {
    console.error('LICENSE не найден — окно с условиями будет пустым.');
    process.exitCode = 1;
    return;
  }

  const text = fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, '');
  // Переносы строк обязаны быть в стиле Windows: иначе текст в окне
  // установщика склеивается в один абзац.
  const normalized = text.replace(/\r?\n/g, '\r\n');

  const body = Buffer.from(normalized, 'utf8');
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const content = Buffer.concat([bom, body]);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Перезапись только при изменении: иначе каждый запуск сборки трогал бы файл
  // и раздувал историю изменений.
  if (fs.existsSync(target) && fs.readFileSync(target).equals(content)) {
    console.log('Текст лицензии для установщика уже актуален.');
    return;
  }
  fs.writeFileSync(target, content);
  console.log(`Текст лицензии подготовлен: ${path.relative(root, target)}`);
}

main();
