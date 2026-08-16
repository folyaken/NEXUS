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

  // Ядра и текст лицензии готовятся так же, как при обычной сборке.
  run(process.execPath, [path.join('scripts', 'ensure-xray.cjs')]);
  run(process.execPath, [path.join('scripts', 'ensure-singbox.cjs')]);
  run(process.execPath, [path.join('scripts', 'prepare-wincodesign.cjs')]);
  run(process.execPath, [path.join('scripts', 'prepare-license.cjs')]);

  run('npm', ['run', 'build'], true);

  // `--publish never` означает «собрать файлы, но никуда не загружать»:
  // готовые файлы выкладываются вручную. Токен GitHub в сборке не участвует.
  run('npx', ['electron-builder', '--win', '--x64', '--publish', 'never', ...builderPublishArgs()], true);

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

  console.log('');
  console.log('latest.yml обязателен: именно по нему программа узнаёт о новой версии.');
}

main();
