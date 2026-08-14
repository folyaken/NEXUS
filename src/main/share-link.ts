import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { TextDecoder } from 'node:util';
import type { VpnLinkParams, VpnProfile, VpnProtocol } from './types';
import { stableProfileId } from './vpn-identity';

export const PROFILE_PARSER_LIMITS = Object.freeze({
  maxShareLinkChars: 16 * 1024,
  maxPayloadChars: 8 * 1024 * 1024,
  maxExtractedLinks: 4_096,
  maxProfiles: 4_096,
  maxJsonDepth: 32,
  maxNameChars: 128,
  maxAddressChars: 253,
  maxCredentialChars: 4_096,
  maxParameterChars: 4_096,
  maxQueryParameters: 64,
});

const SUPPORTED_PROTOCOLS = new Set<VpnProtocol>(['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2']);
const SUPPORTED_NETWORKS = new Set(['tcp', 'ws', 'grpc', 'h2', 'http', 'kcp', 'quic', 'xhttp', 'splithttp', 'httpupgrade', 'hysteria2']);
const NETWORK_ALIASES = new Map([
  ['gun', 'grpc'],
  ['http2', 'h2'],
  ['http-upgrade', 'httpupgrade'],
  ['split-http', 'splithttp'],
]);
const SUPPORTED_SECURITY = new Set(['none', 'tls', 'xtls', 'reality']);
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export class ProfileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileParseError';
  }
}

function decodeBase64(value: string, maxDecodedChars: number): string {
  const compact = value.replace(/\s+/g, '');
  if (!compact || compact.length > Math.ceil(maxDecodedChars * 4 / 3) + 4) {
    throw new ProfileParseError('Некорректные данные Base64');
  }
  const hasStandardAlphabet = /[+/]/.test(compact);
  const hasUrlSafeAlphabet = /[-_]/.test(compact);
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(compact)
    || compact.slice(0, -2).includes('=')
    || (hasStandardAlphabet && hasUrlSafeAlphabet)) {
    throw new ProfileParseError('Некорректные данные Base64');
  }

  const unpadded = compact.replace(/=+$/, '');
  const remainder = unpadded.length % 4;
  const actualPadding = compact.length - unpadded.length;
  const expectedPadding = remainder === 0 ? 0 : 4 - remainder;
  if (remainder === 1 || (actualPadding > 0 && actualPadding !== expectedPadding)) {
    throw new ProfileParseError('Некорректные данные Base64');
  }
  const normalized = unpadded.replace(/-/g, '+').replace(/_/g, '/');
  const padding = expectedPadding ? '='.repeat(expectedPadding) : '';
  const buffer = Buffer.from(normalized + padding, 'base64');
  if (!buffer.length || buffer.length > maxDecodedChars) throw new ProfileParseError('Некорректные данные Base64');
  if (buffer.toString('base64').replace(/=+$/, '') !== normalized) {
    throw new ProfileParseError('Некорректные данные Base64');
  }

  try {
    return UTF8_DECODER.decode(buffer);
  } catch {
    throw new ProfileParseError('Данные Base64 содержат некорректный UTF-8');
  }
}

export function decodeBase64Text(value: string, maxDecodedChars: number): string {
  return decodeBase64(value, maxDecodedChars);
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ProfileParseError('Ссылка содержит некорректное кодирование');
  }
}

function cleanText(value: unknown, maxLength: number, label: string, trim = true): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new ProfileParseError(`Некорректное поле «${label}»`);
  }
  const raw = String(value);
  if (raw.length > maxLength || CONTROL_CHARACTERS.test(raw)) {
    throw new ProfileParseError(`Некорректное поле «${label}»`);
  }
  const result = trim ? raw.trim() : raw;
  return result || undefined;
}

function requiredText(value: unknown, maxLength: number, label: string, trim = true): string {
  const result = cleanText(value, maxLength, label, trim);
  if (!result) throw new ProfileParseError(`В профиле не указано поле «${label}»`);
  return result;
}

export function sanitizeProfileName(value: unknown, fallback: string): string {
  const source = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const cleaned = source
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, PROFILE_PARSER_LIMITS.maxNameChars);
}

export function normalizeProfileAddress(value: unknown): string {
  if (typeof value !== 'string') throw new ProfileParseError('Некорректный адрес сервера');
  const raw = requiredText(value, PROFILE_PARSER_LIMITS.maxAddressChars + 2, 'адрес сервера');
  const startsBracket = raw.startsWith('[');
  const endsBracket = raw.endsWith(']');
  if (startsBracket !== endsBracket) throw new ProfileParseError('Некорректный адрес сервера');
  const bracketed = startsBracket && endsBracket;
  const withoutBrackets = (bracketed ? raw.slice(1, -1) : raw).replace(/\.$/, '');
  if (!withoutBrackets || /[\s\\/?#@]/.test(withoutBrackets)) {
    throw new ProfileParseError('Некорректный адрес сервера');
  }
  const ipFamily = isIP(withoutBrackets);
  if (bracketed && ipFamily !== 6) throw new ProfileParseError('Некорректный адрес сервера');
  if (ipFamily) return withoutBrackets.toLowerCase();

  const ascii = domainToASCII(withoutBrackets).toLowerCase();
  if (!ascii || ascii.length > PROFILE_PARSER_LIMITS.maxAddressChars) {
    throw new ProfileParseError('Некорректный адрес сервера');
  }
  const labels = ascii.split('.');
  if (labels.some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-') || !/^[a-z0-9_-]+$/.test(label))) {
    throw new ProfileParseError('Некорректный адрес сервера');
  }
  return ascii;
}

export function parseProfilePort(value: unknown, fallback?: number): number {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new ProfileParseError('В профиле не указан порт сервера');
  }
  const text = typeof value === 'number' ? undefined : String(value).trim();
  if (text !== undefined && !/^\d{1,5}$/.test(text)) throw new ProfileParseError('Некорректный порт сервера');
  const port = typeof value === 'number' ? value : Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ProfileParseError('Некорректный порт сервера');
  }
  return port;
}

export function parseProfileAlterId(value: unknown, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === '') return fallback;
  const text = typeof value === 'number' ? undefined : String(value).trim();
  if (text !== undefined && !/^\d{1,5}$/.test(text)) throw new ProfileParseError('Некорректный alterId VMess');
  const alterId = typeof value === 'number' ? value : Number(text);
  if (!Number.isInteger(alterId) || alterId < 0 || alterId > 65_535) {
    throw new ProfileParseError('Некорректный alterId VMess');
  }
  return alterId;
}

function normalizeNetwork(value: unknown, protocol: VpnProtocol): string {
  if (protocol === 'hysteria2') return 'hysteria2';
  const raw = (cleanText(value, 32, 'тип транспорта') || 'tcp').toLowerCase();
  const network = NETWORK_ALIASES.get(raw) || raw;
  if (!SUPPORTED_NETWORKS.has(network)) throw new ProfileParseError('Неподдерживаемый тип транспорта');
  return network;
}

function normalizeSecurity(value: unknown, protocol: VpnProtocol): string {
  if (protocol === 'hysteria2') return 'tls';
  const security = (cleanText(value, 32, 'тип защиты') || 'none').toLowerCase();
  if (!SUPPORTED_SECURITY.has(security)) throw new ProfileParseError('Неподдерживаемый тип защиты соединения');
  return security;
}

function optionalParameter(value: unknown, label: string, maxLength: number = PROFILE_PARSER_LIMITS.maxParameterChars, trim = true): string | undefined {
  return cleanText(value, maxLength, label, trim);
}

export function validateVpnLinkParams(input: VpnLinkParams): VpnLinkParams {
  const protocol = input.protocol;
  if (!SUPPORTED_PROTOCOLS.has(protocol)) throw new ProfileParseError('Неподдерживаемый протокол профиля');

  const address = normalizeProfileAddress(input.address);
  const port = parseProfilePort(input.port);
  const uuid = optionalParameter(input.uuid, 'идентификатор', PROFILE_PARSER_LIMITS.maxCredentialChars);
  const password = optionalParameter(input.password, 'пароль', PROFILE_PARSER_LIMITS.maxCredentialChars, false);
  const method = optionalParameter(input.method, 'шифр', 128);
  const security = normalizeSecurity(input.security, protocol);
  const publicKey = optionalParameter(input.publicKey, 'публичный ключ', 512);
  const alterId = parseProfileAlterId(input.alterId);

  if ((protocol === 'vless' || protocol === 'vmess') && !uuid) {
    throw new ProfileParseError('В профиле не указан идентификатор пользователя');
  }
  if ((protocol === 'vless' || protocol === 'vmess')
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid || '')) {
    throw new ProfileParseError('Некорректный идентификатор пользователя');
  }
  if ((protocol === 'trojan' || protocol === 'hysteria2') && !password) {
    throw new ProfileParseError('В профиле не указан пароль');
  }
  if (protocol === 'shadowsocks' && (!method || !password)) {
    throw new ProfileParseError('В профиле Shadowsocks не указан шифр или пароль');
  }
  if (security === 'reality' && !publicKey) {
    throw new ProfileParseError('В Reality-профиле не указан публичный ключ');
  }

  return {
    protocol,
    address,
    port,
    uuid,
    password,
    method,
    encryption: optionalParameter(input.encryption, 'шифрование', 128),
    flow: optionalParameter(input.flow, 'flow', 128),
    alterId,
    security,
    network: normalizeNetwork(input.network, protocol),
    sni: optionalParameter(input.sni, 'SNI', 512),
    host: optionalParameter(input.host, 'Host', 1_024),
    path: optionalParameter(input.path, 'путь транспорта', PROFILE_PARSER_LIMITS.maxParameterChars, false),
    serviceName: optionalParameter(input.serviceName, 'имя gRPC-сервиса', 1_024, false),
    fingerprint: optionalParameter(input.fingerprint, 'fingerprint', 128),
    publicKey,
    shortId: optionalParameter(input.shortId, 'short ID', 128),
    spiderX: optionalParameter(input.spiderX, 'spiderX', 1_024, false),
    alpn: optionalParameter(input.alpn, 'ALPN', 512),
    allowInsecure: Boolean(input.allowInsecure),
    type: optionalParameter(input.type, 'тип заголовка', 128),
    headerType: optionalParameter(input.headerType, 'тип заголовка', 128),
    obfs: optionalParameter(input.obfs, 'пароль обфускации', PROFILE_PARSER_LIMITS.maxCredentialChars, false),
  };
}

function queryMap(search: string): Record<string, string> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const result: Record<string, string> = Object.create(null);
  let count = 0;
  for (const [rawKey, rawValue] of params.entries()) {
    count += 1;
    if (count > PROFILE_PARSER_LIMITS.maxQueryParameters) throw new ProfileParseError('Слишком много параметров в ссылке');
    const key = requiredText(rawKey, 128, 'имя параметра').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new ProfileParseError('Ссылка содержит повторяющиеся параметры');
    }
    const value = cleanText(rawValue, PROFILE_PARSER_LIMITS.maxParameterChars, key, false) || '';
    result[key] = value;
  }
  return result;
}

function fragmentName(hash: string, fallback: string): string {
  if (!hash) return fallback;
  return sanitizeProfileName(decodeUrlComponent(hash.replace(/^#/, '')), fallback);
}

function booleanParameter(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value || '');
}

function userInfo(url: URL, includePassword: boolean): string {
  const username = decodeUrlComponent(url.username);
  if (!includePassword || !url.password) return username;
  return `${username}:${decodeUrlComponent(url.password)}`;
}

function parseVlessOrTrojan(raw: string, protocol: 'vless' | 'trojan'): { params: VpnLinkParams; name: string } {
  const url = new URL(raw);
  if (url.protocol !== `${protocol}:`) throw new ProfileParseError(`Некорректная ссылка ${protocol.toUpperCase()}`);
  if (url.password) throw new ProfileParseError(`${protocol.toUpperCase()}-ссылка содержит неоднозначные данные пользователя`);
  const q = queryMap(url.search);
  if (q.type && q.network && q.type.toLowerCase() !== q.network.toLowerCase()) {
    throw new ProfileParseError('Ссылка содержит противоречивые параметры транспорта');
  }
  const address = normalizeProfileAddress(url.hostname);
  const credential = userInfo(url, false);
  const params = validateVpnLinkParams({
    protocol,
    address,
    port: parseProfilePort(url.port),
    security: q.security || (q.sni ? 'tls' : 'none'),
    network: q.type || q.network || 'tcp',
    sni: q.sni || q.peer || q.host,
    host: q.host,
    path: q.path,
    serviceName: q.servicename,
    fingerprint: q.fp || q.fingerprint,
    publicKey: q.pbk || q.publickey,
    shortId: q.sid || q.shortid,
    spiderX: q.spx,
    alpn: q.alpn,
    flow: q.flow,
    headerType: q.headertype,
    allowInsecure: booleanParameter(q.allowinsecure || q.insecure),
    ...(protocol === 'vless'
      ? { uuid: credential, encryption: q.encryption || 'none' }
      : { password: credential }),
  });
  return { params, name: fragmentName(url.hash, `${protocol.toUpperCase()} ${address}`) };
}

type JsonScalar = string | number | boolean;

function jsonScalar(record: Record<string, unknown>, ...keys: string[]): JsonScalar | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  }
  return undefined;
}

function parseVmess(raw: string): { params: VpnLinkParams; name: string } {
  const encoded = raw.slice('vmess://'.length).trim();
  let data: unknown;
  try {
    data = JSON.parse(decodeBase64(encoded, PROFILE_PARSER_LIMITS.maxShareLinkChars));
  } catch (error) {
    if (error instanceof ProfileParseError) throw error;
    throw new ProfileParseError('VMess-ссылка содержит некорректный JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > 64) {
    throw new ProfileParseError('VMess-ссылка содержит некорректный профиль');
  }

  const record = data as Record<string, unknown>;
  const address = normalizeProfileAddress(jsonScalar(record, 'add', 'address'));
  const tlsValue = String(jsonScalar(record, 'tls') || '').toLowerCase();
  const params = validateVpnLinkParams({
    protocol: 'vmess',
    address,
    port: parseProfilePort(jsonScalar(record, 'port')),
    uuid: cleanText(jsonScalar(record, 'id'), PROFILE_PARSER_LIMITS.maxCredentialChars, 'идентификатор'),
    alterId: parseProfileAlterId(jsonScalar(record, 'aid'), 0),
    encryption: String(jsonScalar(record, 'scy', 'security') || 'auto'),
    network: String(jsonScalar(record, 'net') || 'tcp'),
    security: tlsValue === '1' || tlsValue === 'true' ? 'tls' : tlsValue || 'none',
    sni: cleanText(jsonScalar(record, 'sni', 'serverName'), 512, 'SNI'),
    host: cleanText(jsonScalar(record, 'host'), 1_024, 'Host'),
    path: cleanText(jsonScalar(record, 'path'), PROFILE_PARSER_LIMITS.maxParameterChars, 'путь', false),
    serviceName: cleanText(jsonScalar(record, 'serviceName'), 1_024, 'имя gRPC-сервиса', false),
    fingerprint: cleanText(jsonScalar(record, 'fp'), 128, 'fingerprint'),
    alpn: cleanText(jsonScalar(record, 'alpn'), 512, 'ALPN'),
    headerType: cleanText(jsonScalar(record, 'type'), 128, 'тип заголовка'),
    allowInsecure: booleanParameter(String(jsonScalar(record, 'allowInsecure') || '')),
  });
  const name = sanitizeProfileName(jsonScalar(record, 'ps', 'remark'), `VMess ${address}`);
  return { params, name };
}

function parseShadowsocksServer(serverInfo: string): { address: string; port: number } {
  let url: URL;
  try {
    url = new URL(`ss://placeholder@${serverInfo}`);
  } catch {
    throw new ProfileParseError('Некорректный адрес Shadowsocks-сервера');
  }
  if (url.pathname || url.search || url.hash || url.username !== 'placeholder' || url.password) {
    throw new ProfileParseError('Некорректный адрес Shadowsocks-сервера');
  }
  return {
    address: normalizeProfileAddress(url.hostname),
    port: parseProfilePort(url.port),
  };
}

function parseShadowsocks(raw: string): { params: VpnLinkParams; name: string } {
  const rest = raw.slice('ss://'.length);
  const hashIndex = rest.indexOf('#');
  const beforeHash = hashIndex >= 0 ? rest.slice(0, hashIndex) : rest;
  const namePart = hashIndex >= 0 ? rest.slice(hashIndex) : '';
  const queryIndex = beforeHash.indexOf('?');
  const body = (queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash).replace(/\/$/, '');
  let method: string;
  let password: string;
  let serverInfo: string;

  if (body.includes('@')) {
    const at = body.lastIndexOf('@');
    const rawUserInfo = body.slice(0, at);
    serverInfo = body.slice(at + 1);
    const separator = rawUserInfo.indexOf(':');
    if (separator > 0) {
      method = decodeUrlComponent(rawUserInfo.slice(0, separator));
      password = decodeUrlComponent(rawUserInfo.slice(separator + 1));
    } else {
      const userInfo = decodeBase64(
        decodeUrlComponent(rawUserInfo),
        PROFILE_PARSER_LIMITS.maxCredentialChars * 2,
      );
      const decodedSeparator = userInfo.indexOf(':');
      if (decodedSeparator <= 0) throw new ProfileParseError('В Shadowsocks-ссылке нет шифра или пароля');
      method = userInfo.slice(0, decodedSeparator);
      password = userInfo.slice(decodedSeparator + 1);
    }
  } else {
    const decoded = decodeBase64(body, PROFILE_PARSER_LIMITS.maxShareLinkChars);
    const at = decoded.lastIndexOf('@');
    if (at <= 0 || at === decoded.length - 1) throw new ProfileParseError('Некорректная Shadowsocks-ссылка');
    const userInfo = decoded.slice(0, at);
    const separator = userInfo.indexOf(':');
    if (separator <= 0) throw new ProfileParseError('В Shadowsocks-ссылке нет шифра или пароля');
    method = userInfo.slice(0, separator);
    password = userInfo.slice(separator + 1);
    serverInfo = decoded.slice(at + 1);
  }
  const server = parseShadowsocksServer(serverInfo);
  const params = validateVpnLinkParams({
    protocol: 'shadowsocks',
    address: server.address,
    port: server.port,
    method,
    password,
    network: 'tcp',
    security: 'none',
  });
  return { params, name: fragmentName(namePart, `SS ${server.address}`) };
}

function parseHysteria2(raw: string): { params: VpnLinkParams; name: string } {
  const url = new URL(raw.replace(/^hy2:/i, 'hysteria2:'));
  if (url.protocol !== 'hysteria2:') throw new ProfileParseError('Некорректная ссылка Hysteria2');
  if (url.password) throw new ProfileParseError('Hysteria2-ссылка содержит неоднозначные данные пользователя');
  const q = queryMap(url.search);
  const address = normalizeProfileAddress(url.hostname);
  const password = userInfo(url, false) || q.auth || '';
  const obfsType = (q.obfs || '').toLowerCase();
  const params = validateVpnLinkParams({
    protocol: 'hysteria2',
    address,
    port: parseProfilePort(url.port),
    password,
    security: 'tls',
    network: 'hysteria2',
    sni: q.sni || q.peer || address,
    obfs: q['obfs-password'] || (obfsType && obfsType !== 'salamander' ? q.obfs : undefined),
    allowInsecure: booleanParameter(q.insecure || q.allowinsecure),
  });
  return { params, name: fragmentName(url.hash, `HY2 ${address}`) };
}

export function parseShareLink(input: string): { params: VpnLinkParams; name: string } {
  const raw = input.trim();
  if (!raw) throw new ProfileParseError('Вставьте ссылку vless://, vmess://, trojan://, ss:// или hy2://');
  if (raw.length > PROFILE_PARSER_LIMITS.maxShareLinkChars || CONTROL_CHARACTERS.test(raw)) {
    throw new ProfileParseError('Ссылка профиля слишком длинная или содержит служебные символы');
  }
  try {
    decodeURIComponent(raw);
  } catch {
    throw new ProfileParseError('Ссылка содержит некорректное кодирование');
  }

  const scheme = raw.slice(0, raw.indexOf(':')).toLowerCase();
  try {
    if (scheme === 'vless') return parseVlessOrTrojan(raw, 'vless');
    if (scheme === 'trojan') return parseVlessOrTrojan(raw, 'trojan');
    if (scheme === 'vmess') return parseVmess(raw);
    if (scheme === 'ss') return parseShadowsocks(raw);
    if (scheme === 'hy2' || scheme === 'hysteria2') return parseHysteria2(raw);
  } catch (error) {
    if (error instanceof ProfileParseError) throw error;
    throw new ProfileParseError('Не удалось безопасно разобрать ссылку профиля');
  }
  throw new ProfileParseError('Неподдерживаемая ссылка. Нужны vless://, vmess://, trojan://, ss:// или hy2://');
}

export function createProfileFromLink(input: string, explicitName?: string): VpnProfile {
  const raw = input.trim();
  const { params, name } = parseShareLink(raw);
  const profile: VpnProfile = {
    id: '',
    name: sanitizeProfileName(explicitName, name).slice(0, 64),
    protocol: params.protocol,
    server: params.address,
    port: params.port,
    shareLink: raw,
    params,
    createdAt: new Date().toISOString(),
  };
  profile.id = stableProfileId(profile);
  return profile;
}

export function extractShareLinks(payload: string): string[] {
  const text = payload.trim();
  if (!text || text.length > PROFILE_PARSER_LIMITS.maxPayloadChars) return [];
  const direct = splitLinks(text);
  if (direct.length) return direct;
  try {
    return splitLinks(decodeBase64(text, PROFILE_PARSER_LIMITS.maxPayloadChars));
  } catch {
    return [];
  }
}

function splitLinks(text: string): string[] {
  const found = new Set<string>();
  const add = (candidate: string) => {
    if (found.size >= PROFILE_PARSER_LIMITS.maxExtractedLinks) return;
    const link = candidate.trim();
    if (!link || link.length > PROFILE_PARSER_LIMITS.maxShareLinkChars || CONTROL_CHARACTERS.test(link)) return;
    if (/^(vless|vmess|trojan|ss|hy2|hysteria2):\/\//i.test(link)) found.add(link);
  };

  let offset = 0;
  while (offset <= text.length && found.size < PROFILE_PARSER_LIMITS.maxExtractedLinks) {
    const lineFeed = text.indexOf('\n', offset);
    const carriageReturn = text.indexOf('\r', offset);
    const delimiters = [lineFeed, carriageReturn].filter((index) => index >= 0);
    const end = delimiters.length ? Math.min(...delimiters) : text.length;
    const line = text.slice(offset, end).trim();
    if (/^(vless|vmess|trojan|ss|hy2|hysteria2):\/\//i.test(line)) add(line);
    if (!delimiters.length) break;
    offset = end + (text[end] === '\r' && text[end + 1] === '\n' ? 2 : 1);
  }
  if (found.size) return [...found];

  const pattern = /(?:vless|vmess|trojan|ss|hy2|hysteria2):\/\/[^\s<>"']+/gi;
  for (const match of text.matchAll(pattern)) {
    add(match[0]);
    if (found.size >= PROFILE_PARSER_LIMITS.maxExtractedLinks) break;
  }
  return [...found];
}

export function isSubscriptionUrl(value: string): boolean {
  const raw = value.trim();
  if (!raw || raw.length > PROFILE_PARSER_LIMITS.maxShareLinkChars) return false;
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}
