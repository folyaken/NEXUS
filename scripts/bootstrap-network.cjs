const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const GITHUB_ASSET_HOSTS = new Set([
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const TRUSTED_MIRROR_HOSTS = new Set(['ghproxy.net']);

function parseHttpsUrl(rawUrl, label) {
  let parsed;
  try {
    parsed = new URL(rawUrl.toString());
  } catch {
    throw new Error(`${label}: некорректный URL`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    throw new Error(`${label}: заблокирован недоверенный адрес ${hostname || 'unknown'}`);
  }
  return parsed;
}

function validateUrl(rawUrl, { repo, purpose, allowGithubAssetHost = false }) {
  const label = purpose === 'api' ? 'GitHub API' : 'Загрузка GitHub asset';
  const parsed = parseHttpsUrl(rawUrl, label);
  const hostname = parsed.hostname.toLowerCase();
  const repoPrefix = `/${repo}/`.toLowerCase();

  if (purpose === 'api') {
    const expectedPath = `/repos/${repo}/releases/latest`.toLowerCase();
    if (hostname !== 'api.github.com' || parsed.pathname.toLowerCase() !== expectedPath) {
      throw new Error(`${label}: заблокирован недоверенный адрес ${hostname || 'unknown'}`);
    }
    return parsed;
  }

  if (purpose !== 'asset') throw new Error('Неизвестный тип bootstrap-запроса');

  if (hostname === 'github.com') {
    const releasePrefix = `${repoPrefix}releases/`;
    if (!parsed.pathname.toLowerCase().startsWith(releasePrefix)) {
      throw new Error(`${label}: файл не принадлежит https://github.com/${repo}`);
    }
    return parsed;
  }

  if (TRUSTED_MIRROR_HOSTS.has(hostname)) {
    const expectedTarget = `https://github.com${repoPrefix}releases/`;
    if (!parsed.pathname.slice(1).toLowerCase().startsWith(expectedTarget)) {
      throw new Error(`${label}: зеркало ${hostname} запрашивает другой репозиторий`);
    }
    return parsed;
  }

  if (allowGithubAssetHost && GITHUB_ASSET_HOSTS.has(hostname)) return parsed;

  throw new Error(`${label}: заблокирован недоверенный домен ${hostname || 'unknown'}`);
}

function safeUrlForLog(rawUrl) {
  try {
    const parsed = new URL(rawUrl.toString());
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}

function requestOnce(parsed, userAgent, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let headerTimer;
    const request = https.get(parsed, {
      headers: {
        Accept: 'application/vnd.github+json, application/octet-stream',
        'User-Agent': userAgent,
      },
    }, (response) => {
      settled = true;
      clearTimeout(headerTimer);
      response.setTimeout(timeoutMs, () => {
        response.destroy(new Error(`тайм-аут чтения после ${timeoutMs} мс`));
      });
      resolve(response);
    });

    headerTimer = setTimeout(() => {
      request.destroy(new Error(`тайм-аут соединения после ${timeoutMs} мс`));
    }, timeoutMs);

    request.once('error', (error) => {
      clearTimeout(headerTimer);
      if (!settled) reject(error);
    });
  });
}

async function getResponse(rawUrl, {
  repo,
  purpose,
  userAgent,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxRedirects = MAX_REDIRECTS,
}) {
  let currentUrl = rawUrl;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const parsed = validateUrl(currentUrl, {
      repo,
      purpose,
      allowGithubAssetHost: purpose === 'asset' && redirectCount > 0,
    });

    let response;
    try {
      response = await requestOnce(parsed, userAgent, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ошибка сети';
      throw new Error(`${safeUrlForLog(parsed)}: ${message}`);
    }

    const statusCode = response.statusCode || 0;
    if (REDIRECT_STATUS_CODES.has(statusCode)) {
      const location = response.headers.location;
      response.destroy();
      if (!location) throw new Error(`HTTP ${statusCode}: перенаправление без адреса`);
      if (redirectCount >= maxRedirects) {
        throw new Error(`Превышен лимит перенаправлений (${maxRedirects})`);
      }

      let redirected;
      try {
        redirected = new URL(location, parsed);
      } catch {
        throw new Error('Получен некорректный адрес перенаправления');
      }
      validateUrl(redirected, {
        repo,
        purpose,
        allowGithubAssetHost: purpose === 'asset',
      });
      currentUrl = redirected;
      continue;
    }

    if (statusCode < 200 || statusCode >= 300) {
      response.destroy();
      throw new Error(`HTTP ${statusCode} ${safeUrlForLog(parsed)}`);
    }
    return response;
  }
}

function assertContentLength(response, maxBytes, label) {
  const header = response.headers['content-length'];
  if (header === undefined) return;
  const contentLength = Number(header);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    throw new Error(`${label}: некорректный Content-Length`);
  }
  if (contentLength > maxBytes) {
    throw new Error(`${label}: размер превышает лимит ${maxBytes} байт`);
  }
}

async function getJson(url, {
  repo,
  userAgent,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxBytes = MAX_JSON_BYTES,
}) {
  const response = await getResponse(url, {
    repo,
    purpose: 'api',
    userAgent,
    timeoutMs,
  });

  try {
    assertContentLength(response, maxBytes, 'Ответ GitHub API');
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of response) {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) throw new Error(`Ответ GitHub API превышает лимит ${maxBytes} байт`);
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('GitHub API вернул некорректный JSON');
      throw error;
    }
  } finally {
    response.destroy();
  }
}

async function downloadZip(url, destination, {
  repo,
  userAgent,
  minimumBytes,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxBytes = MAX_ARCHIVE_BYTES,
}) {
  const response = await getResponse(url, {
    repo,
    purpose: 'asset',
    userAgent,
    timeoutMs,
  });
  const tempPath = `${destination}.download-${process.pid}-${Date.now()}`;

  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
  try {
    assertContentLength(response, maxBytes, 'ZIP-архив');
    let downloadedBytes = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        downloadedBytes += chunk.length;
        if (downloadedBytes > maxBytes) {
          callback(new Error(`ZIP-архив превышает лимит ${maxBytes} байт`));
          return;
        }
        callback(null, chunk);
      },
    });

    await pipeline(response, limiter, fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
    const stat = await fs.promises.stat(tempPath);
    if (stat.size < minimumBytes) throw new Error(`слишком маленький файл (${stat.size} байт)`);

    const handle = await fs.promises.open(tempPath, 'r');
    const signature = Buffer.alloc(2);
    try {
      await handle.read(signature, 0, signature.length, 0);
    } finally {
      await handle.close();
    }
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error('это не ZIP');

    await fs.promises.rm(destination, { force: true }).catch(() => undefined);
    await fs.promises.rename(tempPath, destination);
  } catch (error) {
    response.destroy();
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

module.exports = {
  MAX_ARCHIVE_BYTES,
  MAX_JSON_BYTES,
  MAX_REDIRECTS,
  REQUEST_TIMEOUT_MS,
  downloadZip,
  getJson,
  getResponse,
  safeUrlForLog,
  validateUrl,
};
