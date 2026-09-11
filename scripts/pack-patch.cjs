#!/usr/bin/env node
/**
 * NEXUS patch packer.
 *
 * Собирает zip только из изменённых файлов, чтобы его можно было распаковать
 * поверх локальной папки проекта (пути внутри архива — от корня проекта).
 *
 * Использование:
 *   node scripts/pack-patch.cjs --name 19-workflow-tests
 *   node scripts/pack-patch.cjs --name 19-workflow --base HEAD~1
 *   node scripts/pack-patch.cjs --name 19-workflow --files src/main/main.ts README.md
 *
 * Флаги:
 *   --name  <slug>   суффикс имени архива: NEXUS-patch-<slug>.zip (обязателен)
 *   --base  <ref>    git-ref для диффа (по умолчанию HEAD — берёт незакоммиченные
 *                    изменения; если их нет, откатывается на HEAD~1)
 *   --files <paths>  явный список файлов вместо git-диффа
 *   --out   <dir>    каталог для архива (по умолчанию корень проекта)
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { name: null, base: 'HEAD', files: [], out: root };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--name') args.name = argv[++index];
    else if (token === '--base') args.base = argv[++index];
    else if (token === '--out') args.out = path.resolve(root, argv[++index]);
    else if (token === '--files') {
      while (index + 1 < argv.length && !argv[index + 1].startsWith('--')) args.files.push(argv[++index]);
    } else throw new Error(`Неизвестный аргумент: ${token}`);
  }
  return args;
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function gitLines(args) {
  return git(args).split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Файлы, которые никогда не попадают в патч: сами архивы и мусор сборки. */
function isPackable(relativePath) {
  if (/^NEXUS.*\.zip$/i.test(path.basename(relativePath))) return false;
  if (relativePath.startsWith('node_modules/')) return false;
  if (relativePath.startsWith('dist/') || relativePath.startsWith('dist-electron/') || relativePath.startsWith('release/')) return false;
  return fs.existsSync(path.join(root, relativePath));
}

function collectChangedFiles(base) {
  // Незакоммиченные правки + новые файлы, которые ещё не в индексе.
  const working = [
    ...gitLines(['diff', '--name-only', 'HEAD']),
    ...gitLines(['ls-files', '--others', '--exclude-standard']),
  ];
  if (working.length) return [...new Set(working)];

  // Иначе — дифф последнего коммита (или указанного диапазона).
  const range = base === 'HEAD' ? 'HEAD~1..HEAD' : `${base}..HEAD`;
  return [...new Set(gitLines(['diff', '--name-only', range]))];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name) {
    console.error('Укажите имя патча: node scripts/pack-patch.cjs --name 19-my-change');
    process.exit(1);
  }

  const candidates = args.files.length ? args.files : collectChangedFiles(args.base);
  const files = [...new Set(candidates.map((item) => item.replace(/^\.\//, '')))]
    .filter(isPackable)
    .sort();

  if (!files.length) {
    console.error('Нет изменённых файлов для упаковки.');
    process.exit(1);
  }

  const slug = args.name.replace(/^NEXUS-patch-/i, '').replace(/\.zip$/i, '');
  const out = path.join(args.out, `NEXUS-patch-${slug}.zip`);
  fs.rmSync(out, { force: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // -X: без лишних метаданных, чтобы архивы были воспроизводимыми.
  execFileSync('zip', ['-q', '-X', out, ...files], { cwd: root, stdio: 'inherit' });

  const sizeKb = (fs.statSync(out).size / 1024).toFixed(1);
  console.log(`Патч собран: ${path.relative(root, out)} (${sizeKb} КБ, файлов: ${files.length})`);
  for (const file of files) console.log(`  • ${file}`);
  console.log('\nРаспакуй архив в корень папки проекта с заменой файлов.');
}

main();
