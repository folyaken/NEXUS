#!/usr/bin/env node
/**
 * Готовит текст поста о новой версии для канала NEXUS.
 *
 * Зачем скрипт. Пост о релизе каждый раз писался заново, и получалось
 * по-разному: то забывалась ссылка на установщик, то пункты шли техническими
 * формулировками из коммитов. Читателю канала это ничего не говорит. Здесь
 * текст собирается из CHANGELOG.md — того же файла, который ведётся при работе
 * над версией, — и всегда выходит в одном виде: заголовок, список изменений
 * человеческим языком, ссылка на скачивание, напоминание про кнопку обновления.
 *
 * Использование:
 *   node scripts/release-post.cjs              — пост о текущей версии из package.json
 *   node scripts/release-post.cjs 1.1.9        — пост о конкретной версии
 *   node scripts/release-post.cjs --out post.txt
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const RELEASES_PAGE = 'https://github.com/folyaken/NEXUS-releases/releases/latest';

function parseArgs(argv) {
  const args = { version: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--out') args.out = argv[++index];
    else if (!token.startsWith('--')) args.version = token;
  }
  return args;
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

/**
 * Достаёт раздел нужной версии из CHANGELOG.md.
 *
 * Разбор намеренно простой (строки, а не разметка): файл пишется руками, и чем
 * меньше правил, тем меньше шансов, что пост не соберётся перед выпуском.
 */
function readChangelogSection(version) {
  const filePath = path.join(root, 'CHANGELOG.md');
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('## ') && line.slice(3).trim().startsWith(version));
  if (start === -1) return null;

  const groups = [];
  let current = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('## ')) break;
    if (line.startsWith('### ')) {
      current = { title: line.slice(4).trim(), items: [] };
      groups.push(current);
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(.*\S)\s*$/);
    if (item) {
      if (!current) {
        current = { title: '', items: [] };
        groups.push(current);
      }
      current.items.push(item[1]);
    }
  }
  const date = (lines[start].split('—')[1] ?? '').trim() || null;
  return { date, groups: groups.filter((group) => group.items.length) };
}

/** Значок раздела: в ленте канала глаз цепляется за него быстрее, чем за слово. */
function groupIcon(title) {
  const value = title.toLowerCase();
  if (value.startsWith('исправ')) return '🛠';
  if (value.startsWith('улучш')) return '⚡️';
  if (value.startsWith('добав') || value.startsWith('нов')) return '✨';
  return '•';
}

function buildPost(version, section) {
  const lines = [];
  lines.push(`🚀 NEXUS ${version}`);
  if (section?.date) lines.push(`${section.date}`);
  lines.push('');

  if (section?.groups.length) {
    for (const group of section.groups) {
      if (group.title) lines.push(`${groupIcon(group.title)} ${group.title}`);
      for (const item of group.items) lines.push(`— ${item}`);
      lines.push('');
    }
  } else {
    lines.push('Описание изменений добавьте вручную: раздела этой версии нет в CHANGELOG.md.');
    lines.push('');
  }

  lines.push('⬇️ Обновиться');
  lines.push('В программе: «О программе» → «Проверить» → «Скачать» → «Перезапустить и установить».');
  lines.push(`Установщик целиком: ${RELEASES_PAGE}`);
  lines.push('');
  lines.push('#nexus #обновление');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version ?? readVersion();
  const section = readChangelogSection(version);
  const post = buildPost(version, section);

  if (args.out) {
    const target = path.resolve(root, args.out);
    fs.writeFileSync(target, post, 'utf8');
    console.log(`Пост сохранён: ${path.relative(root, target)}`);
    return;
  }
  process.stdout.write(post);
}

if (require.main === module) main();

module.exports = { buildPost, readChangelogSection };
