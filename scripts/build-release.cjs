#!/usr/bin/env node
/**
 * Сборка выпуска с поддержкой обновления.
 *
 * Отличается от обычной сборки одним: в установщик кладётся адрес канала
 * обновлений, а рядом с ним появляется файл `latest.yml` со сведениями о
 * версии. Без этого файла установленная программа не может узнать, что вышла
 * новая версия.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { readChannelUrl, builderPublishArgs } = require('./update-channel.cjs');

/**
 * Запускает шаг сборки.
 *
 * Через оболочку выполняются только команды без аргументов от пользователя
 * (`npm`, `npx`): Node предупреждает, что при `shell: true` аргументы не
 * экранируются. Все остальные шаги — это вызовы Node с путями к скриптам,
 * им оболочка не нужна вовсе.
 */
function run(command, args, useShell = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: useShell && process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/**
 * Запускает сборку установщика, сохраняя весь вывод в файл.
 *
 * Когда makensis падает, он печатает сотню строк «Command line defined», и
 * сама причина уезжает за край окна консоли — в терминале её уже не прочитать.
 * Поэтому вывод пишется и на экран, и в release/build-log.txt, а при ошибке
 * последние строки печатаются ещё раз, отдельным блоком.
 */
function runBuilder(args) {
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  const logPath = path.join(root, 'release', 'build-log.txt');
  const log = fs.createWriteStream(logPath, { flags: 'w' });

  const result = spawnSync('npx', args, {
    cwd: root,
    shell: process.platform === 'win32',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  log.write(output);
  log.end();

  if (result.status === 0) return;

  // Полезные строки — те, где есть слово «error» или «warning», плюс хвост
  // вывода. Их печатаем повторно: в общем потоке они теряются.
  const lines = output.split(/\r?\n/);
  const meaningful = lines.filter((line) => /error|warning|!include|!insertmacro|\.nsh|\.nsi/i.test(line));
  console.error('');
  console.error('─────────────────────────────────────────────');
  console.error('Сборка установщика не удалась.');
  console.error(`Полный вывод сохранён: ${path.relative(root, logPath)}`);
  if (meaningful.length) {
    console.error('');
    console.error('Строки, в которых обычно указана причина:');
    for (const line of meaningful.slice(-25)) console.error(`  ${line}`);
  }
  console.error('─────────────────────────────────────────────');
  process.exit(result.status ?? 1);
}

function main() {
  const channel = readChannelUrl();
  if (!channel) {
    console.error('');
    console.error('Канал обновлений не настроен, поэтому выпуск собрать нельзя.');
    console.error('Без него установленная программа не узнает о новой версии.');
    console.error('');
    console.error('Задайте адрес один раз:');
    console.error('  npm run channel:set -- https://github.com/<аккаунт>/<репозиторий>/releases/latest/download/');
    console.error('');
    process.exit(1);
  }

  console.log(`Канал обновлений: ${channel}`);

  // Настройки проверяются до сборки: часть причин падения makensis видна прямо
  // в package.json, а по выводу NSIS их не разобрать — он обрывается кодом 1
  // после сотни строк «Command line defined».
  run(process.execPath, [path.join('scripts', 'check-build-config.cjs')]);

  // Ядра и текст лицензии готовятся так же, как при обычной сборке.
  run(process.execPath, [path.join('scripts', 'ensure-xray.cjs')]);
  run(process.execPath, [path.join('scripts', 'ensure-singbox.cjs')]);
  // Драйвер виртуального адаптера: без него режим TUN не запускается.
  run(process.execPath, [path.join('scripts', 'ensure-wintun.cjs')]);
  run(process.execPath, [path.join('scripts', 'prepare-wincodesign.cjs')]);
  run(process.execPath, [path.join('scripts', 'prepare-license.cjs')]);

  run('npm', ['run', 'build'], true);

  // `--publish never` означает «собрать файлы, но никуда не загружать»:
  // готовые файлы выкладываются вручную. Токен GitHub в сборке не участвует.
  runBuilder(['electron-builder', '--win', '--x64', '--publish', 'never', ...builderPublishArgs()]);

  const releaseDir = path.join(root, 'release');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  // Имя без пробелов принципиально: GitHub заменяет пробелы в именах вложений
  // на точки, а latest.yml ссылается на исходное имя. Обновление тогда падает
  // с ошибкой «файл не найден», хотя внешне всё выложено правильно.
  const installer = `NEXUS-Setup-${version}.exe`;
  const required = [installer, 'latest.yml'];
  const blockmap = `${installer}.blockmap`;

  console.log('');
  console.log('Готово. Выложите в раздел релизов эти файлы:');
  let missing = false;
  for (const name of [...required, blockmap]) {
    const exists = fs.existsSync(path.join(releaseDir, name));
    console.log(`  ${exists ? '✓' : '✗'} ${name}`);
    if (!exists && required.includes(name)) missing = true;
  }
  if (missing) {
    console.error('');
    console.error('Не хватает обязательных файлов — обновление работать не будет.');
    process.exit(1);
  }
  // Сверяем имя файла внутри latest.yml с тем, что лежит на диске: если они
  // разойдутся, программа будет искать обновление по несуществующему адресу.
  try {
    const feed = fs.readFileSync(path.join(releaseDir, 'latest.yml'), 'utf8');
    const referenced = feed.match(/^\s*(?:url|path):\s*(.+)$/m);
    const name = referenced ? referenced[1].trim().replace(/^['"]|['"]$/g, '') : '';
    if (name && name !== installer) {
      console.error('');
      console.error(`latest.yml ссылается на «${name}», а собран «${installer}».`);
      console.error('Обновление не найдёт файл. Соберите выпуск заново.');
      process.exit(1);
    }
    if (/\s/.test(name)) {
      console.error('');
      console.error('В имени установщика есть пробелы: GitHub заменит их точками, и обновление сломается.');
      process.exit(1);
    }
  } catch {
    // Содержимое проверить не удалось — наличие файла уже подтверждено выше.
  }

  // Драйвер TUN проверяется по факту: без него режим TUN не работает, и узнать
  // об этом лучше сейчас, а не от пользователя после установки.
  if (process.platform === 'win32') {
    const driver = path.join(root, 'modules', 'bin', 'wintun.dll');
    if (fs.existsSync(driver)) {
      console.log('  ✓ драйвер TUN на месте (войдёт в установщик)');
    } else {
      console.log('');
      console.log('  ВНИМАНИЕ: wintun.dll отсутствует — в этой сборке режим TUN работать не будет.');
      console.log('  Режим PROXY не пострадает. Подробности см. выше в шаге загрузки драйвера.');
    }
  }

  console.log('');
  console.log('latest.yml обязателен: именно по нему программа узнаёт о новой версии.');
}

main();
