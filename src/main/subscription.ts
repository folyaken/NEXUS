import type { VpnLinkParams, VpnProfile, VpnSubscriptionInfo } from './types';
import { extractShareLinks } from './share-link';
import { enrichProfile } from './vpn-classify';
import { profileConnectionKey, stableProfileId } from './vpn-identity';

const CLIENT_UAS = [
  'Happ/3.4.6',
  'v2rayN/6.55',
  'clash-meta/1.18.0',
];

function headers(ua: string, hwid: string): Record<string, string> {
  return {
    'User-Agent': ua,
    Accept: 'text/plain, application/json, application/yaml, */*',
    hwid,
    'x-hwid': hwid,
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

function parseUserInfo(response: Response, url: string, body = ''): VpnSubscriptionInfo {
  const raw = response.headers.get('subscription-userinfo') || headerOrComment(body, 'subscription-userinfo') || '';
  const parts = Object.fromEntries(raw.split(';').map((item) => {
    const [key, value] = item.split('=').map((part) => part.trim());
    return [key, value];
  }).filter((item) => item[0]));
  const title = decodeMaybeBase64(response.headers.get('profile-title') || headerOrComment(body, 'profile-title') || '');
  const announce = decodeMaybeBase64(response.headers.get('announce') || headerOrComment(body, 'announce') || '');
  const expire = Number(parts.expire);
  return {
    url,
    title: title || new URL(url).host,
    supportUrl: response.headers.get('support-url') || headerOrComment(body, 'support-url') || undefined,
    announce: announce || response.headers.get('profile-web-page-url') || undefined,
    expireAt: Number.isFinite(expire) && expire > 0 ? new Date(expire * 1000).toISOString() : undefined,
    upload: Number(parts.upload) || 0,
    download: Number(parts.download) || 0,
    total: Number(parts.total) || 0,
    updateHours: Number(response.headers.get('profile-update-interval') || headerOrComment(body, 'profile-update-interval')) || 1,
    lastSync: new Date().toISOString(),
  };
}

export async function fetchSubscriptionMaterial(url: string, hwid: string, log: (message: string) => void): Promise<{ links: string[]; clash: VpnProfile[]; info?: VpnSubscriptionInfo }> {
  const urls = candidateUrls(url);
  let htmlExtra: string[] = [];
  const links = new Set<string>();
  const clash: VpnProfile[] = [];
  const seenClash = new Set<string>();
  let info: VpnSubscriptionInfo | undefined;

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

  for (const target of urls) {
    for (const ua of CLIENT_UAS) {
      try {
        const response = await fetch(target, { headers: headers(ua, hwid), redirect: 'follow' });
        if (!response.ok) continue;
        const body = await response.text();
        if (!body.trim()) continue;
        if (htmlLooksLikePage(body)) {
          htmlExtra = [...new Set([...htmlExtra, ...extractUrlsFromHtml(body, target)])];
          continue;
        }
        take(extractShareLinks(body), [...extractClashProfiles(body), ...extractJsonProfiles(body)], parseUserInfo(response, url));
      } catch (error) {
        log(`Не удалось скачать ${target} (${ua.split('/')[0]}): ${error instanceof Error ? error.message : 'сеть'}`);
      }
    }
  }

  for (const extra of htmlExtra.slice(0, 8)) {
    try {
      const response = await fetch(extra, { headers: headers('v2rayN/6.55', hwid), redirect: 'follow' });
      if (!response.ok) continue;
      const body = await response.text();
      take(extractShareLinks(body), extractClashProfiles(body), parseUserInfo(response, url, body));
    } catch { /* next */ }
  }

  log(`Подписка: ссылок ${links.size} · профилей clash ${clash.length}`);
  return { links: [...links], clash, info };
}
