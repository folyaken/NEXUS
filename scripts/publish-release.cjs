#!/usr/bin/env node
/**
 * Публикация выпуска одной командой.
 *
 * До сих пор выпуск собирался и выкладывался в два места руками: сначала
 * `npm run release:win`, потом страница «New release» на GitHub, куда файлы
 * перетаскивались мышкой. Каждый такой проход — шанс забыть blockmap,
 * опубликовать релиз без latest.yml (у пользователей сломается проверка
 * обновлений) или перепутать текст поста. Здесь весь маршрут — одна команда:
 *
 *   npm run release:publish            — собрать и опубликовать v<версия>
 *   npm run release:publish -- --skip-build  — только публикация готовых файлов
 *   npm run release:publish -- --dry-run     — показать план, ничего не трогая
 *
 * Скрипт сам берёт версию из package.json, текст поста — из CHANGELOG.md,
 * проверяет, что latest.yml описывает именно эту версию, и что релиз не
 * останется без обязательных файлов.
 */

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const DEFAULT_REPO = 'folyaken/NEXUS-releases';

function parseArgs(argv) {
  const args = {
    skipBuild: false,
    dryRun: false,
    draft: false,
    repo: DEFAULT_REPO,
    tag: null,
    notesFile: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--skip-build') args.skipBuild = true;
    else if (token === '--dry-run') args.dryRun = true;
    else if (token === '--draft') args.draft = true;
    else if (token === '--repo') args.repo = argv[++index];
    else if (token === '--tag') args.tag = argv[++index];
    else if (token === '--notes-file') args.notesFile = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${token}`);
  }
  return args;
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

/** Заметки о версии: из CHANGELOG.md тем же кодом, что и пост для канала. */
function buildNotes(version) {
  const result = spawnSync(process.execPath, [path.join('scripts', 'release-post.cjs'), version], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Не удалось собрать текст поста: ${result.stderr || 'пустой вывод'}`);
  }
  return result.stdout.trimEnd();
}

function run(command, args, useShell = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: useShell && process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Первая строка latest.yml — «version: …»: по ней сверяем выпуск. */
function readLatestYmlVersion(releaseDir) {
  try {
    const ymlPath = path.join(releaseDir, 'latest.yml');
    const firstLine = fs.readFileSync(ymlPath, 'utf8').split(/\r?\n/, 1)[0] ?? '';
    const match = /^version:\s*(.+?)\s*$/.exec(firstLine);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const version = readVersion();
  const tag = args.tag ?? `v${version}`;
  const releaseDir = path.join(root, 'release');
  const setupExe = path.join(releaseDir, `NEXUS-Setup-${version}.exe`);
  const setupBlockmap = path.join(releaseDir, `NEXUS-Setup-${version}.exe.blockmap`);
  const latestYml = path.join(releaseDir, 'latest.yml');

  console.log(`Версия: ${version} · тег ${tag} · репозиторий ${args.repo}${args.draft ? ' · черновик' : ''}`);

  if (!args.skipBuild) {
    console.log('');
    console.log('── Сборка установщика ──');
    run('npm', ['run', 'release:win'], true);
  } else {
    console.log('Сборка пропущена (--skip-build): берутся готовые файлы из release/.');
  }

  const missing = [setupExe, setupBlockmap, latestYml].filter((file) => !fs.existsSync(file));
  if (missing.length) {
    console.error('');
    console.error('В release/ нет обязательных файлов выпуска:');
    for (const file of missing) console.error(`  ${path.relative(root, file)}`);
    console.error('');
    console.error('Соберите установщик без --skip-build и повторите.');
    process.exit(1);
  }

  const ymlVersion = readLatestYmlVersion(releaseDir);
  if (ymlVersion !== version) {
    console.error('');
    console.error(`latest.yml описывает версию ${ymlVersion ?? 'неизвестную'}, а в package.json — ${version}.`);
    console.error('Похоже, в release/ остался файл от прошлого выпуска. Пересоберите установщик.');
    process.exit(1);
  }

  if (args.dryRun) {
    console.log('');
    console.log('── Сухой запуск: публикации не будет ──');
    console.log(`gh release create ${tag} \\`);
    console.log(`  "${path.relative(root, setupExe)}" \\`);
    console.log(`  "${path.relative(root, setupBlockmap)}" \\`);
    console.log(`  "${path.relative(root, latestYml)}" \\`);
    console.log(`  --repo ${args.repo} --title "NEXUS ${version}" --notes-file <пост из CHANGELOG.md>`);
    console.log('');
    console.log('Пост, который уйдёт в заметки релиза:');
    console.log('──────────────────────────────────');
    console.log(buildNotes(version));
    console.log('──────────────────────────────────');
    return;
  }

  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
  } catch {
    console.error('gh не авторизован. Один раз выполните: gh auth login');
    process.exit(1);
  }

  const notesFile = args.notesFile ?? path.join(os.tmpdir(), `nexus-release-notes-${version}.txt`);
  fs.writeFileSync(notesFile, buildNotes(version), 'utf8');

  const assetArgs = [setupExe, setupBlockmap, latestYml];
  const releaseExists = spawnSync('gh', ['release', 'view', tag, '--repo', args.repo], { stdio: 'pipe' }).status === 0;

  if (releaseExists) {
    // Релиз уже есть (например, создался пустым по ошибке): дописываем файлы,
    // а не разваливаемся — повторный запуск после обрыва связи безопасен.
    console.log(`Релиз ${tag} уже существует — добавляем файлы в него.`);
    run('gh', ['release', 'upload', tag, '--repo', args.repo, '--clobber', ...assetArgs]);
  } else {
    const createArgs = ['release', 'create', tag, ...assetArgs, '--repo', args.repo, '--title', `NEXUS ${version}`, '--notes-file', notesFile];
    if (args.draft) createArgs.push('--draft');
    run('gh', createArgs);
  }

  const view = spawnSync('gh', ['release', 'view', tag, '--repo', args.repo, '--json', 'url,assets'], { encoding: 'utf8' });
  if (view.status === 0) {
    try {
      const info = JSON.parse(view.stdout);
      const names = (info.assets ?? []).map((asset) => asset.name);
      const expected = [path.basename(setupExe), path.basename(setupBlockmap), 'latest.yml'];
      const absent = expected.filter((name) => !names.includes(name));
      if (absent.length) {
        console.error(`Предупреждение: не все файлы видны в релизе, не хватает: ${absent.join(', ')}`);
      }
      console.log('');
      console.log(`Готово: ${info.url}`);
      console.log(`Файлы в релизе: ${names.join(', ') || '—'}`);
    } catch {
      console.log('Релиз создан, но проверить список файлов не удалось.');
    }
  }
  if (args.draft) {
    console.log('Релиз создан черновиком: опубликуйте его на странице релизов, когда будете готовы.');
  }
}

main();
