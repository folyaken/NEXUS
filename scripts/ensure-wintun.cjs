const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { createHash } = require('node:crypto');
const { Open } = require('unzipper');

/**
 * Драйвер сетевого адаптера для режима TUN.
 *
 * В режиме TUN ядро создаёт в Windows виртуальный сетевой адаптер и заворачивает
 * в него весь трафик системы. Делается это через библиотеку Wintun, и она обязана
 * лежать рядом с исполняемым файлом ядра. Без неё ядро завершается сразу после
 * запуска с кодом −1 (4294967295) и без единой строки в журнале — понять причину
 * по такому сообщению невозможно.
 *
 * Библиотека не входит в состав ядра и не поставляется в установщике: у неё своя
 * лицензия. Поэтому она загружается отдельно с сайта разработчика, а целостность
 * проверяется по контрольной сумме.
 */

const root = path.resolve(__dirname, '..');
const binDir = path.join(root, 'modules', 'bin');
const isWin = process.platform === 'win32';

/**
 * Версия зафиксирована намеренно: обновление драйвера меняет контрольную сумму,
 * и подмена файла на стороне сети должна быть заметна.
 */
const WINTUN_VERSION = '0.14.1';
const WINTUN_URL = `https://www.wintun.net/builds/wintun-${WINTUN_VERSION}.zip`;
const WINTUN_SHA256 = '07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51';
const WINTUN_HOST = 'www.wintun.net';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;

/** Разрядность Windows: у драйвера отдельная сборка под каждую. */
function windowsArchFolder() {
  const native = String(
    process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE || os.arch(),
  ).toLowerCase();
  if (native.includes('arm64') || native.includes('aarch64')) return 'arm64';
  if (native.includes('arm')) return 'arm';
  if (native.includes('x86') && !native.includes('amd64') && process.arch === 'ia32') return 'x86';
  return 'amd64';
}

const destination = path.join(binDir, 'wintun.dll');

function alreadyInstalled() {
  try {
    return fs.existsSync(destination) && fs.statSync(destination).size > 50_000;
  } catch {
    return false;
  }
}

function download(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('некорректный адрес загрузки'));
      return;
    }
    // Только сайт разработчика и только по защищённому соединению: подменённый
    // драйвер получает доступ к сетевому стеку целиком.
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== WINTUN_HOST) {
      reject(new Error(`недоверенный адрес ${parsed.hostname}`));
      return;
    }

    const request = https.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': 'NEXUS-Wintun-Bootstrap', Accept: 'application/zip' },
    }, (response) => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        if (redirectsLeft <= 0 || !response.headers.location) {
          reject(new Error('слишком много перенаправлений'));
          return;
        }
        resolve(download(new URL(response.headers.location, url).toString(), redirectsLeft - 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`сервер ответил HTTP ${status}`));
        return;
      }

      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_ARCHIVE_BYTES) {
          response.destroy();
          reject(new Error('архив превышает допустимый размер'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });

    request.on('timeout', () => {
      request.destroy(new Error('превышено время ожидания'));
    });
    request.on('error', reject);
  });
}

async function main() {
  if (!isWin) {
    console.log('Драйвер TUN нужен только в Windows — шаг пропущен.');
    return;
  }
  if (alreadyInstalled()) {
    console.log('Драйвер TUN уже на месте.');
    return;
  }

  console.log(`Загрузка драйвера TUN (Wintun ${WINTUN_VERSION})…`);
  let archive;
  try {
    archive = await download(WINTUN_URL);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Не удалось загрузить драйвер TUN: ${reason}`);
    console.error('Режим PROXY будет работать; для TUN повторите сборку при доступной сети.');
    return;
  }

  const digest = createHash('sha256').update(archive).digest('hex');
  if (digest !== WINTUN_SHA256) {
    console.error('Контрольная сумма драйвера TUN не совпала — файл отклонён.');
    console.error(`  ожидалось: ${WINTUN_SHA256}`);
    console.error(`  получено : ${digest}`);
    return;
  }

  const temporaryZip = path.join(os.tmpdir(), `nexus-wintun-${process.pid}.zip`);
  try {
    await fs.promises.mkdir(binDir, { recursive: true });
    await fs.promises.writeFile(temporaryZip, archive);

    const directory = await Open.file(temporaryZip);
    const wanted = `wintun/bin/${windowsArchFolder()}/wintun.dll`;
    const entry = directory.files.find((file) => file.path.toLowerCase() === wanted);
    if (!entry) throw new Error(`в архиве нет ${wanted}`);

    const content = await entry.buffer();
    const temporaryDll = `${destination}.download-${process.pid}`;
    await fs.promises.writeFile(temporaryDll, content);
    await fs.promises.rm(destination, { force: true }).catch(() => undefined);
    await fs.promises.rename(temporaryDll, destination);

    console.log(`Драйвер TUN установлен: ${path.relative(root, destination)}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Не удалось распаковать драйвер TUN: ${reason}`);
  } finally {
    await fs.promises.rm(temporaryZip, { force: true }).catch(() => undefined);
  }
}

module.exports = { WINTUN_VERSION, WINTUN_SHA256, WINTUN_URL, windowsArchFolder, destination };

if (require.main === module) {
  void main();
}
