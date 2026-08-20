#!/usr/bin/env node
/**
 * Готовит чистый снимок проекта для переноса в новый репозиторий.
 *
 * Зачем. В истории git остались следы прежнего окружения: идентификатор
 * приложения в старых коммитах и служебный соавтор в подписи. Удалить их из
 * истории, не переписав её целиком, невозможно — а переписывание меняет все
 * хеши и всё равно оставляет старые копии на GitHub, пока их не соберёт
 * сборщик мусора.
 *
 * Надёжнее не чинить историю, а начать её заново: берём текущее состояние
 * файлов, проверяем каждый на упоминания и складываем в отдельную папку. В
 * новом репозитории будет один начальный коммит от вашего имени — и никакой
 * прежней истории.
 *
 * Использование:
 *   node scripts/make-clean-snapshot.cjs            — папка clean-snapshot/
 *   node scripts/make-clean-snapshot.cjs --out ../NEXUS-clean
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/**
 * Слова, которых в чистом репозитории быть не должно.
 *
 * Проверяются и содержимое файлов, и их имена. Список намеренно короткий:
 * широкие шаблоны дают ложные срабатывания на обычных словах.
 */
const FORBIDDEN = [/\barena\b/i, /arena[-_.]?(ai|agent)/i, /ai\.arena/i];

/** Файлы, которые в новый репозиторий не переносятся. */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'dist-electron', 'release', 'out',
  'clean-snapshot', '.cache', 'patches',
]);
const SKIP_FILES = new Set(['NEXUS.zip', 'update-channel.json']);

function parseArgs(argv) {
  const args = { out: path.join(root, 'clean-snapshot') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = path.resolve(root, argv[++i]);
  }
  return args;
}

/**
 * Список файлов берётся у git, а не обходом папки.
 *
 * Так в снимок попадает ровно то, что под контролем версий: временные файлы,
 * личные ключи и сборочный мусор остаются за бортом автоматически.
 */
function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isSkipped(relative) {
  const parts = relative.split('/');
  if (parts.some((part) => SKIP_DIRS.has(part))) return true;
  if (SKIP_FILES.has(parts[parts.length - 1])) return true;
  // Архивы патчей нужны только текущему репозиторию: они ведут на его адрес.
  if (/^NEXUS-patch-.*\.zip$/.test(parts[parts.length - 1])) return true;
  return false;
}

/** Двоичные файлы на упоминания не проверяются: там их и не бывает. */
function isBinary(buffer) {
  const limit = Math.min(buffer.length, 8000);
  for (let i = 0; i < limit; i += 1) if (buffer[i] === 0) return true;
  return false;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = trackedFiles().filter((file) => !isSkipped(file));

  fs.rmSync(args.out, { recursive: true, force: true });
  fs.mkdirSync(args.out, { recursive: true });

  const problems = [];
  let copied = 0;

  for (const relative of files) {
    const source = path.join(root, relative);
    if (!fs.existsSync(source)) continue;

    for (const pattern of FORBIDDEN) {
      if (pattern.test(relative)) problems.push(`имя файла: ${relative}`);
    }

    const buffer = fs.readFileSync(source);
    if (!isBinary(buffer)) {
      const text = buffer.toString('utf8');
      text.split('\n').forEach((line, index) => {
        for (const pattern of FORBIDDEN) {
          if (pattern.test(line)) problems.push(`${relative}:${index + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }

    const target = path.join(args.out, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
    copied += 1;
  }

  console.log(`Скопировано файлов: ${copied}`);
  console.log(`Папка снимка: ${path.relative(root, args.out) || args.out}`);

  if (problems.length) {
    console.error('');
    console.error('Найдены упоминания, которые нужно убрать до переноса:');
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
  }

  console.log('Упоминаний прежнего окружения не найдено.');
  console.log('');
  console.log('Дальше:');
  console.log('  1. Создайте пустой репозиторий на GitHub (без README).');
  console.log('  2. cd в папку снимка и выполните:');
  console.log('       git init -b main');
  console.log('       git add .');
  console.log('       git commit -m "NEXUS: первая версия"');
  console.log('       git remote add origin <адрес нового репозитория>');
  console.log('       git push -u origin main');
}

if (require.main === module) main();

module.exports = { FORBIDDEN, isSkipped };
