import YAML, { isAlias, isCollection, isPair, isScalar } from 'yaml';
import {
  parseProfileAlterId,
  parseProfilePort,
  ProfileParseError,
  PROFILE_PARSER_LIMITS,
  sanitizeProfileName,
  validateVpnLinkParams,
} from './share-link';
import type { VpnLinkParams, VpnProfile, VpnProtocol } from './types';
import { enrichProfile } from './vpn-classify';
import { profileConnectionKey, stableProfileId } from './vpn-identity';

const CONTAINER_KEYS = new Set(['proxies', 'outbounds', 'servers', 'nodes']);
const PROTOCOLS = new Map<string, VpnProtocol>([
  ['vless', 'vless'],
  ['vmess', 'vmess'],
  ['trojan', 'trojan'],
  ['ss', 'shadowsocks'],
  ['shadowsocks', 'shadowsocks'],
  ['hysteria2', 'hysteria2'],
  ['hy2', 'hysteria2'],
]);

/**
 * Приводит имя поля к единому виду.
 *
 * Панели пишут одно и то же поле по-разному: `server-name`, `server_name` и
 * `serverName`. Слитная запись — родная для конфигураций Xray и sing-box,
 * поэтому граница слов в ней тоже превращается в дефис. Без этого поля
 * `streamSettings` и `realitySettings` не находились, и профиль терял
 * шифрование Reality вместе с настройками транспорта.
 */
function normalizedKey(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizedRecord(value: unknown): Map<string, unknown> {
  const result = new Map<string, unknown>();
  const record = asRecord(value);
  if (!record) return result;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    if (result.size >= 256) return new Map();
    const normalized = normalizedKey(key);
    if (result.has(normalized)) throw new ProfileParseError('Неоднозначные поля конфигурации');
    result.set(normalized, record[key]);
  }
  return result;
}

function field(record: Map<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = record.get(normalizedKey(key));
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function nestedRecord(record: Map<string, unknown>, ...keys: string[]): Map<string, unknown> {
  return normalizedRecord(field(record, ...keys));
}

function scalar(value: unknown): string | number | boolean | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined;
}

function text(value: unknown): string | undefined {
  const result = scalar(value);
  return result === undefined ? undefined : String(result);
}

function textList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return text(value);
  if (!value.length || value.length > 16) return undefined;
  const items = value.map((item) => text(item));
  return items.some((item) => item === undefined) ? undefined : items.join(',');
}

function bool(value: unknown): boolean {
  const result = scalar(value);
  if (typeof result === 'boolean') return result;
  if (typeof result === 'number') return result === 1;
  return /^(?:1|true|yes|on|tls|reality)$/i.test(result || '');
}

/**
 * Приводит запись Xray JSON к привычному виду.
 *
 * Панели Remnawave и подобные отдают конфигурацию в формате самого ядра Xray.
 * Там сервер описан не одним объектом, а тремя вложенными: адрес и учётные
 * данные лежат в `settings.vnext[]` (для VLESS и VMess) либо в
 * `settings.servers[]` (Trojan и Shadowsocks), а транспорт и шифрование — в
 * `streamSettings`. Разбор ожидал плоскую запись, не находил адрес рядом с
 * протоколом и возвращал ноль профилей: подписка скачивалась, но серверов в
 * ней «не было».
 *
 * Здесь такая запись раскладывается в плоский набор полей — по одному на
 * каждый сервер. Возвращается пустой список, если запись устроена иначе:
 * тогда работает прежний разбор.
 */
function expandXrayOutbound(source: Record<string, unknown>): Record<string, unknown>[] {
  const record = normalizedRecord(source);
  const protocol = String(scalar(field(record, 'protocol')) || '').toLowerCase();
  if (!PROTOCOLS.has(protocol)) return [];

  const settings = nestedRecord(record, 'settings');
  const endpoints = field(settings, 'vnext', 'servers');
  if (!Array.isArray(endpoints) || !endpoints.length) return [];

  const stream = nestedRecord(record, 'stream-settings');
  const network = text(field(stream, 'network'));
  const security = text(field(stream, 'security'));
  const tlsSettings = nestedRecord(stream, 'tls-settings');
  const realitySettings = nestedRecord(stream, 'reality-settings');
  const wsSettings = nestedRecord(stream, 'ws-settings');
  const grpcSettings = nestedRecord(stream, 'grpc-settings');
  const httpSettings = nestedRecord(stream, 'http-settings', 'xhttp-settings', 'splithttp-settings');
  const wsHeaders = nestedRecord(wsSettings, 'headers');
  // Настройки безопасности приходят либо для TLS, либо для Reality.
  const secure = realitySettings.size ? realitySettings : tlsSettings;

  const flat: Record<string, unknown>[] = [];
  for (const endpoint of endpoints.slice(0, PROFILE_PARSER_LIMITS.maxProfiles)) {
    const server = normalizedRecord(endpoint);
    if (!server.size) continue;
    // У VLESS и VMess учётные данные лежат в списке пользователей, у Trojan и
    // Shadowsocks — прямо в описании сервера.
    const users = field(server, 'users');
    const user = normalizedRecord(Array.isArray(users) ? users[0] : undefined);

    const entry: Record<string, unknown> = {
      protocol,
      address: scalar(field(server, 'address')),
      port: scalar(field(server, 'port')),
      name: scalar(field(server, 'remarks', 'email')) ?? scalar(field(user, 'email')) ?? scalar(field(record, 'tag')),
      id: scalar(field(user, 'id')),
      password: scalar(field(server, 'password')) ?? scalar(field(user, 'password')),
      method: scalar(field(server, 'method')) ?? scalar(field(user, 'method')),
      encryption: scalar(field(user, 'encryption')),
      flow: scalar(field(user, 'flow')),
      alterId: scalar(field(user, 'alter-id')),
      network,
      security,
      sni: scalar(field(secure, 'server-name')),
      fingerprint: scalar(field(secure, 'fingerprint')),
      publicKey: scalar(field(realitySettings, 'public-key')),
      shortId: scalar(field(realitySettings, 'short-id')),
      spiderX: scalar(field(realitySettings, 'spider-x')),
      alpn: field(secure, 'alpn'),
      allowInsecure: scalar(field(secure, 'allow-insecure')),
      host: scalar(field(wsHeaders, 'host')) ?? scalar(field(httpSettings, 'host')),
      path: scalar(field(wsSettings, 'path')) ?? scalar(field(httpSettings, 'path')),
      serviceName: scalar(field(grpcSettings, 'service-name')),
    };
    for (const key of Object.keys(entry)) {
      if (entry[key] === undefined) delete entry[key];
    }
    if (entry.address === undefined) continue;
    flat.push(entry);
  }
  return flat;
}

function collectProfileRecords(root: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const queue: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  const visited = new Set<object>();
  const maxVisited = PROFILE_PARSER_LIMITS.maxProfiles * 8;
  let queueIndex = 0;
  let enqueued = 1;

  const enqueue = (value: unknown, depth: number) => {
    if (enqueued >= maxVisited) return;
    queue.push({ value, depth });
    enqueued += 1;
  };

  while (queueIndex < queue.length && records.length < PROFILE_PARSER_LIMITS.maxProfiles) {
    const next = queue[queueIndex++];
    if (next.depth > PROFILE_PARSER_LIMITS.maxJsonDepth) continue;
    if (next.value === null || typeof next.value !== 'object') continue;
    if (visited.has(next.value)) continue;
    visited.add(next.value);

    if (Array.isArray(next.value)) {
      for (let index = 0; index < next.value.length && enqueued < maxVisited; index += 1) {
        enqueue(next.value[index], next.depth + 1);
      }
      continue;
    }

    const record = next.value as Record<string, unknown>;
    const normalized = normalizedRecord(record);
    if (PROTOCOLS.has(String(scalar(field(normalized, 'type', 'protocol')) || '').toLowerCase())
      && scalar(field(normalized, 'server', 'address', 'add')) !== undefined) {
      records.push(record);
    } else {
      // Формат самого ядра Xray: адрес лежит во вложенном списке серверов.
      for (const expanded of expandXrayOutbound(record)) {
        if (records.length >= PROFILE_PARSER_LIMITS.maxProfiles) break;
        records.push(expanded);
      }
    }

    for (const [key, child] of normalized) {
      if (CONTAINER_KEYS.has(key)) enqueue(child, next.depth + 1);
    }
  }

  return records;
}

function profileFromRecord(source: Record<string, unknown>): VpnProfile | null {
  try {
    const record = normalizedRecord(source);
    const protocolName = String(scalar(field(record, 'type', 'protocol')) || '').toLowerCase();
    const protocol = PROTOCOLS.get(protocolName);
    if (!protocol) return null;

    const tls = nestedRecord(record, 'tls');
    const reality = nestedRecord(record, 'reality-opts', 'reality');
    const tlsReality = nestedRecord(tls, 'reality');
    const transport = nestedRecord(record, 'transport');
    const wsOptions = nestedRecord(record, 'ws-opts', 'ws-options');
    const grpcOptions = nestedRecord(record, 'grpc-opts', 'grpc-options');
    const obfsOptions = nestedRecord(record, 'obfs');
    const wsHeaders = nestedRecord(wsOptions, 'headers');
    const transportHeaders = nestedRecord(transport, 'headers');
    const utls = nestedRecord(tls, 'utls');

    const realityEnabled = reality.size > 0
      || bool(field(tlsReality, 'enabled'))
      || field(tlsReality, 'public-key') !== undefined
      || String(scalar(field(record, 'security')) || '').toLowerCase() === 'reality';
    const tlsEnabled = realityEnabled
      || bool(field(record, 'tls'))
      || bool(field(tls, 'enabled'))
      || field(record, 'servername', 'sni') !== undefined;
    const declaredSecurity = String(scalar(field(record, 'security')) || '').toLowerCase();
    const security = ['none', 'tls', 'xtls', 'reality'].includes(declaredSecurity)
      ? declaredSecurity
      : realityEnabled
        ? 'reality'
        : tlsEnabled
          ? 'tls'
          : 'none';

    const network = text(field(record, 'network'))
      || text(field(transport, 'type'))
      || (protocol === 'hysteria2' ? 'hysteria2' : 'tcp');
    const server = scalar(field(record, 'server', 'address', 'add'));
    const port = scalar(field(record, 'port', 'server-port'));
    if (typeof server !== 'string') return null;
    const params: VpnLinkParams = validateVpnLinkParams({
      protocol,
      address: server,
      port: parseProfilePort(port),
      uuid: text(field(record, 'uuid', 'id')),
      password: text(field(record, 'password', 'auth')),
      method: text(field(record, 'cipher', 'method')),
      alterId: protocol === 'vmess' ? parseProfileAlterId(field(record, 'alter-id', 'aid'), 0) : undefined,
      encryption: protocol === 'vmess'
        ? text(field(record, 'cipher', 'encryption', 'security')) || 'auto'
        : text(field(record, 'encryption')) || (protocol === 'vless' ? 'none' : undefined),
      flow: text(field(record, 'flow')),
      network,
      security,
      sni: text(field(record, 'servername', 'server-name', 'sni', 'peer'))
        || text(field(tls, 'server-name', 'servername')),
      host: text(field(record, 'host'))
        || text(field(wsHeaders, 'host'))
        || text(field(transportHeaders, 'host')),
      path: text(field(record, 'path'))
        || text(field(wsOptions, 'path'))
        || text(field(transport, 'path')),
      serviceName: text(field(record, 'grpc-service-name', 'service-name', 'servicename'))
        || text(field(grpcOptions, 'grpc-service-name', 'service-name'))
        || text(field(transport, 'service-name')),
      fingerprint: text(field(record, 'client-fingerprint', 'fingerprint', 'fp'))
        || text(field(utls, 'fingerprint')),
      publicKey: text(field(record, 'public-key', 'pbk'))
        || text(field(reality, 'public-key'))
        || text(field(tlsReality, 'public-key')),
      shortId: text(field(record, 'short-id', 'sid'))
        || text(field(reality, 'short-id'))
        || text(field(tlsReality, 'short-id')),
      spiderX: text(field(record, 'spider-x', 'spx'))
        || text(field(reality, 'spider-x'))
        || text(field(tlsReality, 'spider-x')),
      alpn: textList(field(record, 'alpn')) || textList(field(tls, 'alpn')),
      headerType: text(field(record, 'header-type')),
      allowInsecure: bool(field(record, 'skip-cert-verify', 'allow-insecure', 'insecure'))
        || bool(field(tls, 'insecure')),
      obfs: text(field(record, 'obfs-password')) || text(field(obfsOptions, 'password')),
    });

    const fallbackName = `${protocol.toUpperCase()} ${params.address}`;
    const name = sanitizeProfileName(scalar(field(record, 'name', 'tag', 'remarks', 'remark', 'ps')), fallbackName);
    const profile = enrichProfile({
      id: '',
      name: name.slice(0, 80),
      protocol: params.protocol,
      server: params.address,
      port: params.port,
      shareLink: `config://${params.protocol}/${params.address}:${params.port}#${encodeURIComponent(name)}`,
      params,
      createdAt: new Date().toISOString(),
    });
    profile.id = stableProfileId(profile);
    return profile;
  } catch {
    return null;
  }
}

function profilesFromRoot(root: unknown): VpnProfile[] {
  const profiles: VpnProfile[] = [];
  const seen = new Set<string>();
  for (const record of collectProfileRecords(root)) {
    const profile = profileFromRecord(record);
    if (!profile) continue;
    const identity = profileConnectionKey(profile);
    if (seen.has(identity)) continue;
    seen.add(identity);
    profiles.push(profile);
    if (profiles.length >= PROFILE_PARSER_LIMITS.maxProfiles) break;
  }
  return profiles;
}

function yamlAstIsSafe(contents: unknown): boolean {
  const maxNodes = PROFILE_PARSER_LIMITS.maxProfiles * 64;
  const queue: Array<{ node: unknown; depth: number }> = [{ node: contents, depth: 0 }];
  const visited = new Set<object>();
  let queueIndex = 0;

  while (queueIndex < queue.length) {
    if (queue.length > maxNodes) return false;
    const { node, depth } = queue[queueIndex++];
    if (node === null || node === undefined) continue;
    if (typeof node !== 'object') continue;
    if (visited.has(node)) continue;
    visited.add(node);
    if (isAlias(node)) return false;

    if (isPair(node)) {
      queue.push({ node: node.key, depth });
      queue.push({ node: node.value, depth });
      continue;
    }
    if (isCollection(node)) {
      if (depth >= PROFILE_PARSER_LIMITS.maxJsonDepth) return false;
      for (const item of node.items) queue.push({ node: item, depth: depth + 1 });
      continue;
    }
    if (isScalar(node)) {
      if (typeof node.value === 'string' && node.value.length > PROFILE_PARSER_LIMITS.maxCredentialChars) return false;
      continue;
    }
    return false;
  }

  return true;
}

export function extractClashProfiles(textValue: string): VpnProfile[] {
  const text = textValue.trim();
  if (!text || text.length > PROFILE_PARSER_LIMITS.maxPayloadChars || /^[{[]/.test(text)) return [];
  if (!/(?:^|\n)\s*(?:proxies|outbounds|servers|nodes)\s*:|\btype\s*:/i.test(text)) return [];

  try {
    const documents = YAML.parseAllDocuments(text, {
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
    });
    if (documents.length > 16) return [];
    const profiles: VpnProfile[] = [];
    const seen = new Set<string>();
    for (const document of documents) {
      if (document.errors.length || !yamlAstIsSafe(document.contents)) continue;
      const root = document.toJS({ maxAliasCount: 0 });
      for (const profile of profilesFromRoot(root)) {
        const identity = profileConnectionKey(profile);
        if (seen.has(identity)) continue;
        seen.add(identity);
        profiles.push(profile);
        if (profiles.length >= PROFILE_PARSER_LIMITS.maxProfiles) return profiles;
      }
    }
    return profiles;
  } catch {
    return [];
  }
}

export function extractJsonProfiles(textValue: string): VpnProfile[] {
  const text = textValue.trim();
  if (!text || text.length > PROFILE_PARSER_LIMITS.maxPayloadChars || (!text.startsWith('{') && !text.startsWith('['))) return [];
  try {
    const root = JSON.parse(text);
    const preflight = YAML.parseDocument(text, {
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
    });
    if (preflight.errors.length || !yamlAstIsSafe(preflight.contents)) return [];
    return profilesFromRoot(root);
  } catch {
    return [];
  }
}
