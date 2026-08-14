import { promises as dns } from 'node:dns';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { VpnLinkParams, VpnProfile, VpnSubscriptionInfo } from './types';
import { extractShareLinks } from './share-link';
import { enrichProfile } from './vpn-classify';
import { profileConnectionKey, stableProfileId } from './vpn-identity';

const CLIENT_UAS = [
  'Happ/3.4.6',
  'v2rayN/6.55',
  'clash-meta/1.18.0',
];

export const SUBSCRIPTION_TRANSPORT_LIMITS = Object.freeze({
  dnsTimeoutMs: 5_000,
  requestTimeoutMs: 12_000,
  totalTimeoutMs: 75_000,
  maxRedirects: 5,
  maxRequests: 48,
  maxResponseBytes: 8 * 1024 * 1024,
  maxDiscoveredUrls: 8,
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
  let lastError: unknown;

  for (const address of addresses) {
    try {
      return await openSubscriptionResponse(url, address, requestHeaders, remainingRequestTime(budget));
    } catch (error) {
      lastError = error;
    }
  }

  const reason = lastError instanceof SubscriptionTransportError ? lastError.message : 'защищённое соединение не установлено';
  throw new SubscriptionTransportError(`Не удалось подключиться к ${url.host}: ${reason}`);
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
    return Buffer.concat(chunks, size).toString('utf8');
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

function candidateUrls(raw: string): string[] {
  const url = new URL(raw);
  const base = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  const extras = [
    raw,
    `${base}?flag=v2ray`,
    `${base}?flag=clash`,
    `${base}?flag=happ`,
    `${base}?flag=sing`,
    `${base}?flag=sing-box`,
    `${base}?target=v2ray`,
    `${base}?target=clash`,
    `${base}?format=v2ray`,
    `${base}/v2ray`,
    `${base}/clash`,
    `${base}/singbox`,
  ];
  return [...new Set(extras)];
}

function htmlLooksLikePage(text: string): boolean {
  const head = text.slice(0, 400).toLowerCase();
  return head.includes('<!doctype') || head.includes('<html') || head.includes('<head') || text.includes('Add Subscription');
}

function extractUrlsFromHtml(html: string, pageUrl: string): string[] {
  const found = new Set<string>();
  const hrefs = html.matchAll(/href=["']([^"']+)["']/gi);
  for (const match of hrefs) {
    try {
      const resolved = new URL(match[1], pageUrl);
      if (resolved.protocol !== 'https:') continue;
      const href = resolved.toString();
      if (/v2ray|clash|sub|happ|sing-box|xray/i.test(href)) found.add(href);
      if (found.size >= SUBSCRIPTION_TRANSPORT_LIMITS.maxDiscoveredUrls) break;
    } catch { /* ignore */ }
  }
  return [...found];
}

function yamlValue(block: string, key: string): string | undefined {
  const match = block.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*(.+)`, 'i'));
  if (!match) return undefined;
  return match[1].trim().replace(/^["']|["']$/g, '');
}

function clashBlockToProfile(block: string): VpnProfile | null {
  const type = (yamlValue(block, 'type') || '').toLowerCase();
  const server = yamlValue(block, 'server');
  const port = Number(yamlValue(block, 'port'));
  const name = yamlValue(block, 'name') || server || 'node';
  if (!server || !port) return null;

  const tls = /true|tls/i.test(yamlValue(block, 'tls') || '') || Boolean(yamlValue(block, 'servername'));
  const reality = /reality/i.test(block) || Boolean(yamlValue(block, 'public-key'));
  const params: VpnLinkParams = {
    protocol: type === 'vmess' ? 'vmess' : type === 'trojan' ? 'trojan' : type === 'ss' || type === 'shadowsocks' ? 'shadowsocks' : type === 'hysteria2' || type === 'hy2' ? 'hysteria2' : 'vless',
    address: server,
    port,
    uuid: yamlValue(block, 'uuid'),
    password: yamlValue(block, 'password'),
    method: yamlValue(block, 'cipher') || yamlValue(block, 'method'),
    flow: yamlValue(block, 'flow'),
    network: yamlValue(block, 'network') || 'tcp',
    security: reality ? 'reality' : tls ? 'tls' : 'none',
    sni: yamlValue(block, 'servername') || yamlValue(block, 'sni'),
    fingerprint: yamlValue(block, 'client-fingerprint') || yamlValue(block, 'fingerprint'),
    publicKey: yamlValue(block, 'public-key'),
    shortId: yamlValue(block, 'short-id'),
    path: yamlValue(block, 'path'),
    host: yamlValue(block, 'Host') || yamlValue(block, 'host'),
    serviceName: yamlValue(block, 'grpc-service-name') || yamlValue(block, 'serviceName'),
    encryption: yamlValue(block, 'encryption') || 'none',
  };
  if (type && !['vless', 'vmess', 'trojan', 'ss', 'shadowsocks', 'hysteria2', 'hy2'].includes(type)) return null;
  const shareLink = `clash://${params.protocol}/${server}:${port}#${encodeURIComponent(name)}`;
  const profile = enrichProfile({
    id: '',
    name: name.slice(0, 80),
    protocol: params.protocol,
    server,
    port,
    shareLink,
    params,
    createdAt: new Date().toISOString(),
  });
  profile.id = stableProfileId(profile);
  return profile;
}

export function extractClashProfiles(text: string): VpnProfile[] {
  if (!/type:\s*(vless|vmess|trojan|ss|shadowsocks|hysteria2|hy2)/i.test(text)) return [];
  const chunks = text.split(/\n(?=\s*-\s+name:|\s*-\s+\{)/);
  const profiles: VpnProfile[] = [];
  for (const chunk of chunks) {
    const profile = clashBlockToProfile(chunk);
    if (profile) profiles.push(profile);
  }
  return profiles;
}

function flattenJsonNodes(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const nested = [record.proxies, record.outbounds, record.servers, record.nodes];
  return nested.flatMap((item) => flattenJsonNodes(item));
}

export function extractJsonProfiles(text: string): VpnProfile[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [];
  try {
    const list = flattenJsonNodes(JSON.parse(trimmed));
    if (!list.length) return [];
    const yamlish = list.map((item) => Object.entries(item).map(([key, value]) => {
      if (value && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).map(([inner, innerValue]) => `  ${inner}: ${innerValue}`).join('\n');
      }
      return `${key}: ${value}`;
    }).join('\n')).join('\n---\n');
    return extractClashProfiles(yamlish);
  } catch {
    return [];
  }
}

function headerOrComment(source: string, key: string): string {
  const match = source.match(new RegExp(`(?:^|[\\r\\n])#?\\s*${key}:\\s*(.+)`, 'i'));
  return match?.[1]?.trim() || '';
}

function decodeMaybeBase64(value: string): string {
  if (!value.toLowerCase().startsWith('base64:')) return value;
  try { return Buffer.from(value.slice(7), 'base64').toString('utf8'); } catch { return value; }
}

function parseUserInfo(responseHeaders: IncomingHttpHeaders, url: string, body = ''): VpnSubscriptionInfo {
  const raw = responseHeader(responseHeaders, 'subscription-userinfo') || headerOrComment(body, 'subscription-userinfo') || '';
  const parts = Object.fromEntries(raw.split(';').map((item) => {
    const [key, value] = item.split('=').map((part) => part.trim());
    return [key, value];
  }).filter((item) => item[0]));
  const title = decodeMaybeBase64(responseHeader(responseHeaders, 'profile-title') || headerOrComment(body, 'profile-title') || '');
  const announce = decodeMaybeBase64(responseHeader(responseHeaders, 'announce') || headerOrComment(body, 'announce') || '');
  const expire = Number(parts.expire);
  return {
    url,
    title: title || new URL(url).host,
    supportUrl: responseHeader(responseHeaders, 'support-url') || headerOrComment(body, 'support-url') || undefined,
    announce: announce || responseHeader(responseHeaders, 'profile-web-page-url') || undefined,
    expireAt: Number.isFinite(expire) && expire > 0 ? new Date(expire * 1000).toISOString() : undefined,
    upload: Number(parts.upload) || 0,
    download: Number(parts.download) || 0,
    total: Number(parts.total) || 0,
    updateHours: Number(responseHeader(responseHeaders, 'profile-update-interval') || headerOrComment(body, 'profile-update-interval')) || 1,
    lastSync: new Date().toISOString(),
  };
}

export async function fetchSubscriptionMaterial(url: string, hwid: string, log: (message: string) => void): Promise<{ links: string[]; clash: VpnProfile[]; info?: VpnSubscriptionInfo }> {
  const initialTarget = validateSubscriptionUrl(url);
  await resolveSafeSubscriptionTarget(initialTarget);

  const urls = candidateUrls(initialTarget.toString());
  const trustedOrigin = initialTarget.origin;
  const budget: SubscriptionRequestBudget = {
    deadline: Date.now() + SUBSCRIPTION_TRANSPORT_LIMITS.totalTimeoutMs,
    requests: 0,
  };
  let htmlExtra: string[] = [];
  const links = new Set<string>();
  const clash: VpnProfile[] = [];
  const seenClash = new Set<string>();
  let info: VpnSubscriptionInfo | undefined;
  let lastTransportError: SubscriptionTransportError | undefined;

  const take = (nextLinks: string[], nextClash: VpnProfile[], nextInfo?: VpnSubscriptionInfo) => {
    for (const link of nextLinks) links.add(link);
    for (const profile of nextClash) {
      const identity = profileConnectionKey(profile);
      if (seenClash.has(identity)) continue;
      seenClash.add(identity);
      clash.push(profile);
    }
    if (nextInfo && (!info || (nextInfo.expireAt && !info.expireAt))) info = nextInfo;
  };

  candidateRequests:
  for (const target of urls) {
    for (const ua of CLIENT_UAS) {
      if (Date.now() >= budget.deadline || budget.requests >= SUBSCRIPTION_TRANSPORT_LIMITS.maxRequests) break candidateRequests;
      try {
        const response = await downloadSubscriptionText(target, headers(ua, hwid), trustedOrigin, budget);
        if (response.status < 200 || response.status >= 300) continue;
        const body = response.body;
        if (!body.trim()) continue;
        if (htmlLooksLikePage(body)) {
          htmlExtra = [...new Set([
            ...htmlExtra,
            ...extractUrlsFromHtml(body, response.finalUrl.toString()),
          ])].slice(0, SUBSCRIPTION_TRANSPORT_LIMITS.maxDiscoveredUrls);
          continue;
        }
        take(
          extractShareLinks(body),
          [...extractClashProfiles(body), ...extractJsonProfiles(body)],
          parseUserInfo(response.headers, initialTarget.toString(), body),
        );
      } catch (error) {
        if (error instanceof SubscriptionTransportError) lastTransportError = error;
        const reason = error instanceof Error ? error.message : 'ошибка сети';
        log(`Не удалось скачать подписку с ${safeSubscriptionUrlForLog(target)} (${ua.split('/')[0]}): ${reason}`);
        if (Date.now() >= budget.deadline || budget.requests >= SUBSCRIPTION_TRANSPORT_LIMITS.maxRequests) break candidateRequests;
      }
    }
  }

  for (const extra of htmlExtra.slice(0, SUBSCRIPTION_TRANSPORT_LIMITS.maxDiscoveredUrls)) {
    if (Date.now() >= budget.deadline || budget.requests >= SUBSCRIPTION_TRANSPORT_LIMITS.maxRequests) break;
    try {
      const response = await downloadSubscriptionText(extra, headers('v2rayN/6.55', hwid), trustedOrigin, budget);
      if (response.status < 200 || response.status >= 300) continue;
      const body = response.body;
      take(
        extractShareLinks(body),
        [...extractClashProfiles(body), ...extractJsonProfiles(body)],
        parseUserInfo(response.headers, initialTarget.toString(), body),
      );
    } catch (error) {
      if (error instanceof SubscriptionTransportError) lastTransportError = error;
      const reason = error instanceof Error ? error.message : 'ошибка сети';
      log(`Не удалось скачать найденную подписку с ${safeSubscriptionUrlForLog(extra)}: ${reason}`);
    }
  }

  if (!links.size && !clash.length && lastTransportError) throw lastTransportError;
  log(`Подписка: ссылок ${links.size} · профилей clash ${clash.length}`);
  return { links: [...links], clash, info };
}
