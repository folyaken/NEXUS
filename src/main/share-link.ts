import { createHash, randomUUID } from 'node:crypto';
import type { VpnLinkParams, VpnProfile, VpnProtocol } from './types';

function decodeBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64').toString('utf8');
}

function queryMap(search: string): Record<string, string> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) result[key.toLowerCase()] = value;
  return result;
}

function fragmentName(hash: string, fallback: string): string {
  if (!hash) return fallback;
  try {
    return decodeURIComponent(hash.replace(/^#/, '')) || fallback;
  } catch {
    return hash.replace(/^#/, '') || fallback;
  }
}

function asPort(value: string | number | undefined, fallback = 443): number {
  const port = Number(value);
  return Number.isFinite(port) && port > 0 && port < 65536 ? port : fallback;
}

function parseVlessOrTrojan(raw: string, protocol: 'vless' | 'trojan'): { params: VpnLinkParams; name: string } {
  const url = new URL(raw);
  const q = queryMap(url.search);
  const user = decodeURIComponent(url.username);
  const params: VpnLinkParams = {
    protocol,
    address: url.hostname,
    port: asPort(url.port, 443),
    security: q.security || (q.sni ? 'tls' : 'none'),
    network: q.type || q.network || 'tcp',
    sni: q.sni || q.peer || q.host,
    host: q.host,
    path: q.path,
    serviceName: q.servicename || q.serviceName,
    fingerprint: q.fp || q.fingerprint,
    publicKey: q.pbk || q.publickey,
    shortId: q.sid || q.shortid,
    spiderX: q.spx,
    alpn: q.alpn,
    flow: q.flow,
    headerType: q.headerType || q.headertype,
    allowInsecure: q.allowinsecure === '1' || q.insecure === '1',
  };
  if (protocol === 'vless') {
    params.uuid = user;
    params.encryption = q.encryption || 'none';
  } else {
    params.password = user;
  }
  const name = fragmentName(url.hash, `${protocol.toUpperCase()} ${url.hostname}`);
  return { params, name };
}

function parseVmess(raw: string): { params: VpnLinkParams; name: string } {
  const encoded = raw.slice('vmess://'.length).trim();
  const decoded = decodeBase64(encoded);
  const data = JSON.parse(decoded) as Record<string, string | number>;
  const address = String(data.add || data.address || '');
  const params: VpnLinkParams = {
    protocol: 'vmess',
    address,
    port: asPort(data.port, 443),
    uuid: String(data.id || ''),
    alterId: Number(data.aid ?? 0),
    encryption: String(data.scy || data.security || 'auto'),
    network: String(data.net || 'tcp'),
    security: String(data.tls || '') === 'tls' || String(data.tls || '') === '1' ? 'tls' : String(data.tls || 'none'),
    sni: String(data.sni || data.host || ''),
    host: String(data.host || ''),
    path: String(data.path || ''),
    type: String(data.type || ''),
    allowInsecure: false,
  };
  const name = String(data.ps || data.remark || `VMess ${address}`);
  return { params, name };
}

function parseShadowsocks(raw: string): { params: VpnLinkParams; name: string } {
  const rest = raw.slice('ss://'.length);
  const hashIndex = rest.indexOf('#');
  const body = hashIndex >= 0 ? rest.slice(0, hashIndex) : rest;
  const namePart = hashIndex >= 0 ? rest.slice(hashIndex) : '';
  let method = '';
  let password = '';
  let host = '';
  let port = 443;

  if (body.includes('@')) {
    const [userInfo, serverInfo] = body.split('@');
    const decodedUser = userInfo.includes(':') ? userInfo : decodeBase64(userInfo);
    const sep = decodedUser.indexOf(':');
    method = decodeURIComponent(decodedUser.slice(0, sep));
    password = decodeURIComponent(decodedUser.slice(sep + 1));
    const serverUrl = new URL(`ss://${serverInfo}`);
    host = serverUrl.hostname;
    port = asPort(serverUrl.port, 443);
  } else {
    const decoded = decodeBase64(body);
    const at = decoded.lastIndexOf('@');
    const user = decoded.slice(0, at);
    const server = decoded.slice(at + 1);
    const sep = user.indexOf(':');
    method = user.slice(0, sep);
    password = user.slice(sep + 1);
    const [hostname, portText] = server.split(':');
    host = hostname;
    port = asPort(portText, 443);
  }

  const params: VpnLinkParams = {
    protocol: 'shadowsocks',
    address: host,
    port,
    method: method || 'aes-256-gcm',
    password,
    network: 'tcp',
    security: 'none',
  };
  const name = fragmentName(namePart, `SS ${host}`);
  return { params, name };
}

export function parseShareLink(input: string): { params: VpnLinkParams; name: string } {
  const raw = input.trim();
  if (!raw) throw new Error('Вставьте ссылку vless://, vmess://, trojan:// или ss://');
  const scheme = raw.split(':')[0]?.toLowerCase();
  if (scheme === 'vless') return parseVlessOrTrojan(raw, 'vless');
  if (scheme === 'trojan') return parseVlessOrTrojan(raw, 'trojan');
  if (scheme === 'vmess') return parseVmess(raw);
  if (scheme === 'ss') return parseShadowsocks(raw);
  if (scheme === 'hy2' || scheme === 'hysteria2') return parseHysteria2(raw);
  throw new Error('Неподдерживаемая ссылка. Нужны vless://, vmess://, trojan://, ss:// или hy2://');
}

function parseHysteria2(raw: string): { params: VpnLinkParams; name: string } {
  const url = new URL(raw.replace(/^hy2:/i, 'hysteria2:'));
  const q = queryMap(url.search);
  const params: VpnLinkParams = {
    protocol: 'hysteria2',
    address: url.hostname,
    port: asPort(url.port, 443),
    password: decodeURIComponent(url.username || q.auth || ''),
    security: 'tls',
    network: 'hysteria2',
    sni: q.sni || q.peer || url.hostname,
    obfs: q.obfs || q['obfs-password'],
    allowInsecure: q.insecure === '1' || q.allowinsecure === '1',
  };
  return { params, name: fragmentName(url.hash, `HY2 ${url.hostname}`) };
}

export function createProfileFromLink(input: string, explicitName?: string): VpnProfile {
  const { params, name } = parseShareLink(input);
  if (!params.address) throw new Error('В ссылке нет адреса сервера');
  const id = createHash('sha1').update(input.trim()).digest('hex').slice(0, 12);
  return {
    id: id || randomUUID().slice(0, 12),
    name: (explicitName?.trim() || name).slice(0, 64),
    protocol: params.protocol,
    server: params.address,
    port: params.port,
    shareLink: input.trim(),
    params,
    createdAt: new Date().toISOString(),
  };
}

export function extractShareLinks(payload: string): string[] {
  const text = payload.trim();
  if (!text) return [];
  const direct = splitLinks(text);
  if (direct.length) return direct;
  try {
    const decoded = decodeBase64(text.replace(/\s+/g, ''));
    return splitLinks(decoded);
  } catch {
    return [];
  }
}

function splitLinks(text: string): string[] {
  const found = text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => /^(vless|vmess|trojan|ss|hy2|hysteria2):\/\//i.test(line));
  if (found.length) return [...new Set(found)];
  const inline = text.match(/(?:vless|vmess|trojan|ss|hy2|hysteria2):\/\/\S+/gi) ?? [];
  return [...new Set(inline.map((item) => item.trim()))];
}

export function isSubscriptionUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}
