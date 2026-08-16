#!/usr/bin/env node
/**
 * Адрес канала обновлений.
 *
 * Канал — это просто адрес в интернете, откуда установленная программа берёт
 * сведения о новой версии и сам установщик. Задаётся один раз и хранится в
 * файле `update-channel.json` в корне проекта, чтобы не набирать его при
 * каждой сборке.
 *
 * Секции `publish` в package.json намеренно нет: electron-builder раскрывает
 * подстановки вроде `${env.NEXUS_UPDATE_URL}` на этапе сборки и падает, если
 * переменная не задана. Тогда обычная локальная сборка требовала бы
 * настроенный сервер обновлений, что неудобно.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(root, 'update-channel.json');

/**
 * Проверяет адрес канала.
 *
 * Только HTTPS: по открытому HTTP ответ сервера можно подменить и подсунуть
 * пользователю чужой установщик. Адрес обязан заканчиваться косой чертой —
 * к нему дописываются имена файлов.
 */
function normalizeChannelUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  parsed.hash = '';
  parsed.search = '';
  const text = parsed.toString();
  return text.endsWith('/') ? text : `${text}/`;
}

/**
 * Читает адрес канала: сначала переменная окружения, затем файл настройки.
 *
 * Путь к файлу настройки принимается отдельным доводом, а не берётся из
 * глобальной переменной. Иначе поведение зависело бы от того, настроен ли
 * канал на конкретной машине: у одного разработчика проверка проходила бы, у
 * другого — нет, хотя код одинаковый.
 */
function readChannelUrl(env = process.env, configFile = CONFIG_FILE) {
  const fromEnv = normalizeChannelUrl(env.NEXUS_UPDATE_URL);
  if (fromEnv) return fromEnv;
  try {
    if (!fs.existsSync(configFile)) return null;
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return normalizeChannelUrl(parsed && parsed.url);
  } catch {
    return null;
  }
}

function writeChannelUrl(raw) {
  const url = normalizeChannelUrl(raw);
  if (!url) {
    throw new Error('Адрес канала должен начинаться с https:// — по открытому HTTP обновление можно подменить.');
  }
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify({ url }, null, 2)}\n`, 'utf8');
  return url;
}

/**
 * Аргументы electron-builder для публикации.
 *
 * Пока канал не настроен, список пуст — сборка идёт как обычно, просто без
 * файлов обновления. Это позволяет собирать программу на машине, где канал
 * не нужен.
 */
function builderPublishArgs(env = process.env, configFile = CONFIG_FILE) {
  const url = readChannelUrl(env, configFile);
  if (!url) return [];
  return [
    '-c.publish.provider=generic',
    `-c.publish.url=${url}`,
    '-c.publish.channel=latest',
  ];
}

if (require.main === module) {
  const [command, value] = process.argv.slice(2);
  if (command === 'set') {
    const url = writeChannelUrl(value);
    console.log(`Канал обновлений сохранён: ${url}`);
  } else if (command === 'args') {
    process.stdout.write(builderPublishArgs().join(' '));
  } else {
    const url = readChannelUrl();
    console.log(url ? `Канал обновлений: ${url}` : 'Канал обновлений не настроен.');
    if (!url) {
      console.log('Задать: npm run channel:set -- https://github.com/<аккаунт>/<репозиторий>/releases/latest/download/');
    }
  }
}

module.exports = { normalizeChannelUrl, readChannelUrl, writeChannelUrl, builderPublishArgs, CONFIG_FILE };
