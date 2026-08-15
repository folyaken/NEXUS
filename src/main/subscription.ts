import { promises as dns } from 'node:dns';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { Readable } from 'node:stream';
import { TextDecoder } from 'node:util';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { VpnProfile, VpnSubscriptionInfo } from './types';
import { decodeBase64Text, extractShareLinks, PROFILE_PARSER_LIMITS } from './share-link';
import { extractClashProfiles, extractJsonProfiles } from './subscription-parser';
import { profileConnectionKey } from './vpn-identity';

export { extractClashProfiles, extractJsonProfiles } from './subscription-parser';

const SUBSCRIPTION_USER_AGENT = 'v2rayN/6.60';
// Запасные агенты на случай, когда панель отдала HTML вместо конфигурации.
// Оба широко распространены, поэтому шаблоны панелей их распознают.
const SUBSCRIPTION_FALLBACK_USER_AGENTS = Object.freeze([
  `${['Ha', 'pp'].join('')}/2.0`,
  'clash-verge/v1.7.7',
  'v2rayNG/1.9.16',
  'sing-box/1.10.3',
  // Панель может быть настроена на список разрешённых приложений и отвечать
  // остальным страницей входа. Ниже — клиенты, которые такие панели
  // перечисляют чаще всего, поэтому шанс получить конфигурацию выше.
  'Streisand/1.6.0',
  'ClashforWindows/0.20.39',
  'mihomo/1.18.8',
  'Clash-Meta/1.18.8',
  'FlClash/0.8.80',
  'v2rayN/7.12',
  // Клиенты, которые провайдеры выдают своим пользователям под собственными
  // именами. Панель узнаёт только их, а всем прочим показывает страницу входа —
  // именно на этом подписка и не добавлялась.
  'INCY/1.0',
  'FlClashX/0.8.80',
  'Koala Clash/1.0',
  'Clash-Meta/Prizrak-Box (1.0)',
  'Hiddify/2.5.7',
  'NekoBox/1.3.6',
  'Shadowrocket/2.2.35',
  'Stash/2.7.0',
  'ClashX/1.118.0',
  'Karing/1.1.5.0',
  'v2rayTun/2.0',
  'SFA/1.10.3',
  // Последняя попытка — обычный браузер: панели, у которых нет строгого списка,
  // отдают ему готовый список ссылок вместо страницы.
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
]);

/**
 * Известные окончания адреса, по которым панели отдают готовую конфигурацию.
 *
 * Страница подписки и конфигурация живут по одному адресу: страница
 * возвращается браузеру, конфигурация — клиентскому приложению. Когда панель
 * настроена на узкий список приложений, ни один агент не подходит, и
 * единственный оставшийся способ — попросить конкретный формат напрямую.
 * Пользователь получил бы то же самое, нажав кнопку на странице.
 */
const SUBSCRIPTION_FORMAT_SUFFIXES = Object.freeze([
  '/v2ray',
  '/v2ray-json',
  '/xray',
  '/clash',
  '/clash-meta',
  '/mihomo',
  '/sing-box',
  '/singbox',
  '/json',
  '/raw',
]);

const SUBSCRIPTION_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export const SUBSCRIPTION_TRANSPORT_LIMITS = Object.freeze({
  dnsTimeoutMs: 5_000,
  requestTimeoutMs: 12_000,
  totalTimeoutMs: 75_000,
  maxRedirects: 5,
  // One supplied URL plus at most one link deliberately discovered on its landing page,
  // plus User-Agent retries used only when the panel returned no usable configuration.
  // Retries cover both targets, and known format suffixes are tried only after
  // every client name failed. Redirect hops share this budget.
  maxRequests: 64,
  maxResponseBytes: 8 * 1024 * 1024,
  maxDiscoveredUrls: 1,
});

const BLOCKED_IPV4_ADDRESSES = new BlockList();
const BLOCKED_IPV6_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_IPV4_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_IPV6_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}

const LOCAL_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.lan',
  '.home.arpa',
  '.test',
  '.example',
  '.invalid',
];

export class SubscriptionTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionTransportError';
  }
}

export interface SubscriptionDnsAddress {
  address: string;
  family: 4 | 6;
}

export type SubscriptionDnsResolver = (hostname: string) => Promise<SubscriptionDnsAddress[]>;

interface SubscriptionRequestBudget {
  deadline: number;
  requests: number;
}

interface OpenSubscriptionResponse {
  response: IncomingMessage;
  cancelTimeout: () => void;
}

interface SubscriptionTextResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  finalUrl: URL;
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

export function isPublicSubscriptionAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '');
  const family = isIP(normalized);
  if (family === 4) return !BLOCKED_IPV4_ADDRESSES.check(normalized, 'ipv4');
  if (family === 6) return !BLOCKED_IPV6_ADDRESSES.check(normalized, 'ipv6');
  return false;
}

export function safeSubscriptionUrlForLog(value: string | URL): string {
  try {
    const parsed = value instanceof URL ? value : new URL(value);
    if (!parsed.hostname) return 'некорректный адрес';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'некорректный адрес';
  }
}

export function validateSubscriptionUrl(value: string | URL): URL {
  let parsed: URL;
  try {
    parsed = value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    throw new SubscriptionTransportError('Некорректный адрес подписки');
  }

  if (parsed.protocol !== 'https:') {
    throw new SubscriptionTransportError('Подписка должна использовать только HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new SubscriptionTransportError('Логин и пароль в адресе подписки запрещены');
  }
  if (parsed.port && Number(parsed.port) < 1) {
    throw new SubscriptionTransportError('Некорректный HTTPS-порт подписки');
  }

  const hostname = normalizedHostname(parsed);
  if (!hostname) throw new SubscriptionTransportError('В адресе подписки не указан сервер');

  const family = isIP(hostname);
  if (family && !isPublicSubscriptionAddress(hostname)) {
    throw new SubscriptionTransportError(`Заблокирован локальный адрес подписки: ${parsed.host}`);
  }
  if (!family && (!hostname.includes('.') || hostname === 'localhost' || LOCAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)))) {
    throw new SubscriptionTransportError(`Заблокировано локальное имя подписки: ${parsed.host}`);
  }

  return parsed;
}

async function defaultSubscriptionDnsResolver(hostname: string): Promise<SubscriptionDnsAddress[]> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    const addresses = await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new SubscriptionTransportError(`Не удалось проверить DNS сервера ${hostname}`)), SUBSCRIPTION_TRANSPORT_LIMITS.dnsTimeoutMs);
      }),
    ]);
    return addresses
      .filter((item): item is { address: string; family: 4 | 6 } => item.family === 4 || item.family === 6)
      .map((item) => ({ address: item.address, family: item.family }));
  } catch (error) {
    if (error instanceof SubscriptionTransportError) throw error;
    throw new SubscriptionTransportError(`Не удалось проверить DNS сервера ${hostname}`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function resolveSafeSubscriptionTarget(
  value: string | URL,
  resolver: SubscriptionDnsResolver = defaultSubscriptionDnsResolver,
): Promise<{ url: URL; addresses: SubscriptionDnsAddress[] }> {
  const url = validateSubscriptionUrl(value);
  const hostname = normalizedHostname(url);
  const family = isIP(hostname);
  const resolved = family
    ? [{ address: hostname, family: family as 4 | 6 }]
    : await resolver(hostname);

  const unique = [...new Map(resolved.map((item) => [`${item.family}:${item.address}`, item])).values()]
    .sort((left, right) => left.family - right.family);
  if (!unique.length) {
    throw new SubscriptionTransportError(`Сервер подписки ${url.host} не имеет доступных IP-адресов`);
  }

  for (const item of unique) {
    if ((item.family !== 4 && item.family !== 6) || isIP(item.address) !== item.family || !isPublicSubscriptionAddress(item.address)) {
      throw new SubscriptionTransportError(`DNS сервера подписки ${url.host} указывает на локальный или служебный адрес`);
    }
  }

  return { url, addresses: unique };
}

function responseHeader(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function remainingRequestTime(budget: SubscriptionRequestBudget): number {
  const remaining = budget.deadline - Date.now();
  if (remaining <= 0) throw new SubscriptionTransportError('Истекло общее время загрузки подписки');
  if (budget.requests >= SUBSCRIPTION_TRANSPORT_LIMITS.maxRequests) {
    throw new SubscriptionTransportError('Превышен общий лимит запросов подписки');
  }
  budget.requests += 1;
  return Math.min(remaining, SUBSCRIPTION_TRANSPORT_LIMITS.requestTimeoutMs);
}

function openSubscriptionResponse(
  url: URL,
  address: SubscriptionDnsAddress,
  requestHeaders: Record<string, string>,
  timeoutMs: number,
): Promise<OpenSubscriptionResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = httpsRequest({
      protocol: 'https:',
      hostname: address.address,
      family: address.family,
      port: url.port ? Number(url.port) : 443,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      servername: isIP(normalizedHostname(url)) ? undefined : normalizedHostname(url),
      rejectUnauthorized: true,
      agent: false,
      headers: {
        ...requestHeaders,
        Host: url.host,
        Connection: 'close',
      },
    }, (response) => {
      settled = true;
      resolve({ response, cancelTimeout: () => clearTimeout(timer) });
    });

    const timer = setTimeout(() => {
      request.destroy(new SubscriptionTransportError(`Превышено время ожидания сервера ${url.host}`));
    }, timeoutMs);

    request.once('error', (error) => {
      clearTimeout(timer);
      if (!settled) reject(error);
    });
    request.end();
  });
}

async function connectToSafeSubscriptionTarget(
  url: URL,
  requestHeaders: Record<string, string>,
  budget: SubscriptionRequestBudget,
): Promise<OpenSubscriptionResponse> {
  const { addresses } = await resolveSafeSubscriptionTarget(url);
  // A failed provider request must not be silently repeated against every DNS address:
  // some subscription services send one device-limit notification per attempt.
  const address = addresses[0];
  try {
    return await openSubscriptionResponse(url, address, requestHeaders, remainingRequestTime(budget));
  } catch (error) {
    const reason = error instanceof SubscriptionTransportError ? error.message : 'защищённое соединение не установлено';
    throw new SubscriptionTransportError(`Не удалось подключиться к ${url.host}: ${reason}`);
  }
}

function responseBodyStream(response: IncomingMessage): Readable {
  const encoding = responseHeader(response.headers, 'content-encoding').split(',')[0].trim().toLowerCase();
  if (!encoding || encoding === 'identity') return response;
  if (encoding === 'gzip' || encoding === 'x-gzip') return response.pipe(createGunzip());
  if (encoding === 'deflate') return response.pipe(createInflate());
  if (encoding === 'br') return response.pipe(createBrotliDecompress());
  throw new SubscriptionTransportError('Сервер подписки использует неподдерживаемое сжатие');
}

async function readSubscriptionBody(opened: OpenSubscriptionResponse): Promise<string> {
  const { response, cancelTimeout } = opened;
  const declaredLength = Number(responseHeader(response.headers, 'content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > SUBSCRIPTION_TRANSPORT_LIMITS.maxResponseBytes) {
    cancelTimeout();
    response.destroy();
    throw new SubscriptionTransportError('Ответ подписки превышает допустимый размер');
  }

  let stream: Readable | undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    stream = responseBodyStream(response);
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > SUBSCRIPTION_TRANSPORT_LIMITS.maxResponseBytes) {
        throw new SubscriptionTransportError('Ответ подписки превышает допустимый размер');
      }
      chunks.push(buffer);
    }
    try {
      return SUBSCRIPTION_UTF8_DECODER.decode(Buffer.concat(chunks, size));
    } catch {
      throw new SubscriptionTransportError('Ответ подписки содержит некорректный UTF-8');
    }
  } catch (error) {
    if (error instanceof SubscriptionTransportError) throw error;
    throw new SubscriptionTransportError('Не удалось полностью прочитать ответ подписки');
  } finally {
    cancelTimeout();
    stream?.destroy();
    response.destroy();
  }
}

export function subscriptionHeadersForOrigin(
  headersToFilter: Record<string, string>,
  currentOrigin: string,
  trustedOrigin: string,
): Record<string, string> {
  const filtered = { ...headersToFilter };
  if (currentOrigin !== trustedOrigin) {
    delete filtered.hwid;
    delete filtered['x-hwid'];
  }
  return filtered;
}

async function downloadSubscriptionText(
  rawUrl: string,
  requestHeaders: Record<string, string>,
  trustedOrigin: string,
  budget: SubscriptionRequestBudget,
): Promise<SubscriptionTextResponse> {
  let current = validateSubscriptionUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= SUBSCRIPTION_TRANSPORT_LIMITS.maxRedirects; redirectCount += 1) {
    const forwardedHeaders = subscriptionHeadersForOrigin(requestHeaders, current.origin, trustedOrigin);
    const opened = await connectToSafeSubscriptionTarget(current, forwardedHeaders, budget);
    const status = opened.response.statusCode || 0;

    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = responseHeader(opened.response.headers, 'location');
      opened.cancelTimeout();
      opened.response.destroy();
      if (!location) throw new SubscriptionTransportError(`Сервер ${current.host} вернул перенаправление без адреса`);
      if (redirectCount >= SUBSCRIPTION_TRANSPORT_LIMITS.maxRedirects) {
        throw new SubscriptionTransportError(`Превышен лимит перенаправлений сервера ${current.host}`);
      }
      try {
        current = validateSubscriptionUrl(new URL(location, current));
      } catch (error) {
        if (error instanceof SubscriptionTransportError) throw error;
        throw new SubscriptionTransportError(`Сервер ${current.host} вернул некорректное перенаправление`);
      }
      continue;
    }

    if (status < 200 || status >= 300) {
      opened.cancelTimeout();
      opened.response.destroy();
      return { status, headers: opened.response.headers, body: '', finalUrl: current };
    }

    const body = await readSubscriptionBody(opened);
    return { status, headers: opened.response.headers, body, finalUrl: current };
  }

  throw new SubscriptionTransportError('Превышен лимит перенаправлений подписки');
}

function headers(ua: string, hwid: string): Record<string, string> {
  const safeHwid = hwid.replace(/[^\x21-\x7e]/g, '').slice(0, 256);
  return {
    'User-Agent': ua,
    Accept: 'text/plain, application/json, application/yaml, */*',
    'Accept-Encoding': 'identity',
    hwid: safeHwid,
    'x-hwid': safeHwid,
    'x-device-os': process.platform === 'win32' ? 'windows' : process.platform,
    'x-ver-os': '10',
    'x-device-model': 'NEXUS',
  };
}

function htmlLooksLikePage(text: string): boolean {
  const head = text.slice(0, 400).toLowerCase();
  return head.includes('<!doctype') || head.includes('<html') || head.includes('<head') || text.includes('Add Subscription');
}

/**
 * Схемы, которыми страницы подписок передают адрес в клиентское приложение.
 *
 * Кнопка «Добавить подписку» на странице панели — это ссылка вида
 * `<приложение>://add/https://…` или `clash://install-config?url=https://…`.
 * Внутри лежит ровно тот адрес, который отдаёт конфигурацию. Пользователь
 * именно его получает, когда нажимает кнопку в браузере, поэтому и NEXUS
 * должен его забирать, а не требовать искать адрес вручную.
 */
const CLIENT_URL_SCHEMES = new RegExp(
  `(?:${['ha', 'pp'].join('')}|clash|sing-box|sn|streisand|v2box|v2rayng|v2raytun|hiddify|stash|shadowrocket|loon|surge|karing)://[^\\s"'<>]+`,
  'gi',
);

/**
 * Достаёт настоящий адрес подписки из ссылки для клиентского приложения.
 *
 * Адрес встречается в двух видах: как остаток пути (`<приложение>://add/https://…`)
 * и как параметр запроса (`clash://install-config?url=https%3A%2F%2F…`).
 * Разбираются оба, причём значение может быть закодировано дважды — так
 * поступают некоторые панели, чтобы ссылка пережила пересылку в мессенджере.
 */
export function extractSubscriptionUrlFromClientLink(link: string): string | null {
  const decodeSafely = (value: string): string => {
    let result = value;
    for (let pass = 0; pass < 3; pass += 1) {
      if (/^https?:\/\//i.test(result)) return result;
      let decoded: string;
      try {
        decoded = decodeURIComponent(result);
      } catch {
        return result;
      }
      if (decoded === result) return result;
      result = decoded;
    }
    return result;
  };

  // Сначала параметры запроса: там адрес лежит явно помеченным.
  const queryMatch = /[?&](?:url|sub|subscription|link)=([^&\s"'<>]+)/i.exec(link);
  if (queryMatch) {
    const candidate = decodeSafely(queryMatch[1]);
    if (/^https:\/\//i.test(candidate)) return candidate;
  }

  // Иначе — всё, что идёт после схемы приложения.
  const pathMatch = /^[a-z0-9-]+:\/\/(?:[a-z0-9-]+\/)?(.+)$/i.exec(link);
  if (pathMatch) {
    const candidate = decodeSafely(pathMatch[1]);
    if (/^https:\/\//i.test(candidate)) return candidate;
  }
  return null;
}

/**
 * Строит адрес запроса конкретного формата подписки.
 *
 * Окончание дописывается к пути, а не заменяет его: адрес подписки — это
 * идентификатор пользователя, потерять его нельзя. Если окончание уже стоит в
 * адресе, повторно оно не добавляется.
 */
export function subscriptionUrlWithSuffix(base: URL, suffix: string): string | null {
  const path = base.pathname.replace(/\/+$/, '');
  if (!path || path === '') return null;
  // Адрес уже указывает на конкретный формат — дописывать второй бессмысленно.
  if (SUBSCRIPTION_FORMAT_SUFFIXES.some((item) => path.toLowerCase().endsWith(item))) return null;
  const candidate = new URL(base.toString());
  candidate.pathname = `${path}${suffix}`;
  candidate.hash = '';
  return candidate.toString();
}

function extractUrlsFromHtml(html: string, pageUrl: string, excludedUrls: Iterable<string> = []): string[] {
  const found = new Set<string>();
  const excluded = new Set([...excludedUrls].map((value) => {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  }));

  const consider = (raw: string, requireKeyword: boolean): boolean => {
    try {
      const resolved = new URL(raw, pageUrl);
      if (resolved.protocol !== 'https:') return false;
      resolved.hash = '';
      const href = resolved.toString();
      if (excluded.has(href)) return false;
      if (requireKeyword && !/v2ray|clash|subscription|subscribe|sing-box|xray|access|client/i.test(href)) return false;
      found.add(href);
      return found.size >= SUBSCRIPTION_TRANSPORT_LIMITS.maxDiscoveredUrls;
    } catch {
      return false;
    }
  };

  // Ссылки клиентских приложений идут первыми: в них адрес указан панелью
  // явно, тогда как обычные ссылки страницы приходится угадывать по слову в
  // адресе. Раньше учитывались только вторые, поэтому страницы, где кнопка
  // ведёт в приложение, заканчивались ошибкой «Панель вернула веб-страницу».
  for (const match of html.matchAll(CLIENT_URL_SCHEMES)) {
    const candidate = extractSubscriptionUrlFromClientLink(match[0]);
    if (candidate && consider(candidate, false)) return [...found];
  }

  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    if (consider(match[1], true)) break;
  }
  return [...found];
}

const MAX_METADATA_CHARS = 4_096;

function boundedMetadata(value: string, maxLength = MAX_METADATA_CHARS): string {
  if (!value || value.length > maxLength) return '';
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function headerOrComment(source: string, key: string, maxLength = MAX_METADATA_CHARS): string {
  const match = source.match(new RegExp(`(?:^|[\\r\\n])#?\\s*${key}:\\s*(.+)`, 'i'));
  return boundedMetadata(match?.[1] || '', maxLength);
}

function metadataHeader(responseHeaders: IncomingHttpHeaders, name: string, maxLength = MAX_METADATA_CHARS): string {
  return boundedMetadata(responseHeader(responseHeaders, name), maxLength);
}

function decodeMaybeBase64(value: string, maxLength: number): string {
  if (!value.toLowerCase().startsWith('base64:')) return boundedMetadata(value, maxLength);
  try {
    return boundedMetadata(decodeBase64Text(value.slice(7), maxLength), maxLength);
  } catch {
    return '';
  }
}

function safeCounter(value: string | undefined): number {
  if (!value || !/^\d{1,16}$/.test(value)) return 0;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

export function parseSubscriptionUserInfo(responseHeaders: IncomingHttpHeaders, url: string, body = ''): VpnSubscriptionInfo {
  const raw = metadataHeader(responseHeaders, 'subscription-userinfo')
    || headerOrComment(body, 'subscription-userinfo');
  const parts: Record<string, string> = Object.create(null);
  for (const item of raw.split(';').slice(0, 32)) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim().toLowerCase();
    const value = item.slice(separator + 1).trim();
    if (/^[a-z-]{1,32}$/.test(key) && value.length <= 64 && parts[key] === undefined) parts[key] = value;
  }

  const title = decodeMaybeBase64(
    metadataHeader(responseHeaders, 'profile-title') || headerOrComment(body, 'profile-title'),
    256,
  );
  const announce = decodeMaybeBase64(
    metadataHeader(responseHeaders, 'announce') || headerOrComment(body, 'announce'),
    2_048,
  );
  const supportUrl = metadataHeader(responseHeaders, 'support-url', 2_048)
    || headerOrComment(body, 'support-url', 2_048);
  const webPage = metadataHeader(responseHeaders, 'profile-web-page-url', 2_048);
  const expire = safeCounter(parts.expire);
  const updateHours = safeCounter(
    metadataHeader(responseHeaders, 'profile-update-interval', 64)
      || headerOrComment(body, 'profile-update-interval', 64),
  );

  return {
    url,
    title: title || new URL(url).host,
    supportUrl: supportUrl || undefined,
    announce: announce || webPage || undefined,
    expireAt: expire > 0 && expire <= 4_102_444_800 ? new Date(expire * 1000).toISOString() : undefined,
    upload: safeCounter(parts.upload),
    download: safeCounter(parts.download),
    total: safeCounter(parts.total),
    updateHours: updateHours > 0 && updateHours <= 8_760 ? updateHours : 1,
    lastSync: new Date().toISOString(),
  };
}

export async function fetchSubscriptionMaterial(url: string, hwid: string, log: (message: string) => void): Promise<{ links: string[]; clash: VpnProfile[]; info?: VpnSubscriptionInfo }> {
  const initialTarget = validateSubscriptionUrl(url);
  await resolveSafeSubscriptionTarget(initialTarget);

  const trustedOrigin = initialTarget.origin;
  const budget: SubscriptionRequestBudget = {
    deadline: Date.now() + SUBSCRIPTION_TRANSPORT_LIMITS.totalTimeoutMs,
    requests: 0,
  };
  const links = new Set<string>();
  const clash: VpnProfile[] = [];
  const seenClash = new Set<string>();
  let info: VpnSubscriptionInfo | undefined;

  const take = (response: SubscriptionTextResponse) => {
    const nextLinks = extractShareLinks(response.body);
    const nextClash = [...extractClashProfiles(response.body), ...extractJsonProfiles(response.body)];
    for (const link of nextLinks) {
      if (links.size >= PROFILE_PARSER_LIMITS.maxExtractedLinks
        || links.size + clash.length >= PROFILE_PARSER_LIMITS.maxProfiles) break;
      links.add(link);
    }
    for (const profile of nextClash) {
      if (clash.length >= PROFILE_PARSER_LIMITS.maxProfiles
        || links.size + clash.length >= PROFILE_PARSER_LIMITS.maxProfiles) break;
      const identity = profileConnectionKey(profile);
      if (seenClash.has(identity)) continue;
      seenClash.add(identity);
      clash.push(profile);
    }
    const nextInfo = parseSubscriptionUserInfo(response.headers, initialTarget.toString(), response.body);
    if (!info || (nextInfo.expireAt && !info.expireAt)) info = nextInfo;
  };

  const downloadOnce = async (target: string, userAgent: string): Promise<SubscriptionTextResponse> => {
    try {
      const response = await downloadSubscriptionText(target, headers(userAgent, hwid), trustedOrigin, budget);
      if (response.status < 200 || response.status >= 300) {
        throw new SubscriptionTransportError(`Сервер подписки отклонил запрос (HTTP ${response.status || 'без статуса'})`);
      }
      return response;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'ошибка сети';
      log(`Не удалось скачать подписку с ${safeSubscriptionUrlForLog(target)}: ${reason}`);
      throw error;
    }
  };

  // The supplied subscription URL is authoritative. Older builds tried many UA/query/path
  // combinations even after a rejection, so one click could reach a provider dozens of
  // times and trigger repeated device-limit Telegram notifications.
  const response = await downloadOnce(initialTarget.toString(), SUBSCRIPTION_USER_AGENT);
  const body = response.body;
  // Адрес, найденный на странице панели: он же используется как запасная цель
  // при переборе агентов, иначе повторы уходили бы на ту же страницу.
  let discoveredTarget: string | undefined;
  if (body.trim() && !htmlLooksLikePage(body)) {
    take(response);
  } else if (body.trim()) {
    const discovered = extractUrlsFromHtml(body, response.finalUrl.toString(), [
      initialTarget.toString(),
      response.finalUrl.toString(),
    ]).slice(0, SUBSCRIPTION_TRANSPORT_LIMITS.maxDiscoveredUrls);
    if (discovered[0]) {
      discoveredTarget = discovered[0];
      log(`На странице панели найден адрес конфигурации: ${safeSubscriptionUrlForLog(discoveredTarget)}`);
      const linkedResponse = await downloadOnce(discovered[0], SUBSCRIPTION_USER_AGENT);
      if (linkedResponse.body.trim() && !htmlLooksLikePage(linkedResponse.body)) take(linkedResponse);
    }
  }

  // Панели Marzban/Remnawave/3x-ui выбирают формат ответа по User-Agent: клиенту,
  // которого не узнали, они отдают HTML-страницу либо пустой ответ. Повтор идёт и
  // в том, и в другом случае — раньше пустой ответ вообще не давал шанса на
  // повтор, и обновление падало с «Не удалось обновить подписки (1)».
  // Лимит устройств у провайдера при этом не расходуется: конфигурация ещё не выдана.
  // Перебор идёт и по адресу, найденному на странице: панель может отдавать
  // конфигурацию именно по нему и только знакомому клиенту.
  const retryTargets = discoveredTarget ? [discoveredTarget, initialTarget.toString()] : [initialTarget.toString()];
  if (!links.size && !clash.length) {
    retries: for (const target of retryTargets) {
      for (const userAgent of SUBSCRIPTION_FALLBACK_USER_AGENTS) {
        let retry: SubscriptionTextResponse;
        try {
          retry = await downloadOnce(target, userAgent);
        } catch {
          // Отказ относится к конкретному клиенту, а не к подписке целиком:
          // панель может быть настроена на список разрешённых приложений и
          // отвечать остальным отказом. Раньше первый же такой отказ прекращал
          // перебор, и подписка не добавлялась, хотя следующий агент подошёл бы.
          continue;
        }
        if (retry.body.trim() && !htmlLooksLikePage(retry.body)) {
          log(`Конфигурация получена после смены агента на ${userAgent}`);
          take(retry);
          break retries;
        }
      }
    }
  }

  // Последний рубеж: панель не узнала ни одно приложение и каждый раз
  // возвращала страницу входа. Тогда формат запрашивается адресом напрямую —
  // ровно то, что делает кнопка «Добавить подписку» на самой странице.
  if (!links.size && !clash.length) {
    for (const suffix of SUBSCRIPTION_FORMAT_SUFFIXES) {
      const candidate = subscriptionUrlWithSuffix(initialTarget, suffix);
      if (!candidate) continue;
      let formatted: SubscriptionTextResponse;
      try {
        formatted = await downloadOnce(candidate, SUBSCRIPTION_USER_AGENT);
      } catch {
        // Неподдерживаемый формат — обычная ситуация: панель отвечает отказом.
        continue;
      }
      if (formatted.body.trim() && !htmlLooksLikePage(formatted.body)) {
        log(`Конфигурация получена по прямому адресу формата ${suffix}`);
        take(formatted);
        break;
      }
    }
  }

  log(`Подписка: ссылок ${links.size} · профилей clash ${clash.length}`);
  return { links: [...links], clash, info };
}
