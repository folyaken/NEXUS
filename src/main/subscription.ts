import { createHash, randomUUID } from 'node:crypto';
import type { VpnLinkParams, VpnProfile, VpnSubscriptionInfo } from './types';
import { extractShareLinks } from './share-link';
import { enrichProfile } from './vpn-classify';

const CLIENT_UAS = [
  'v2rayN/6.55',
  'v2rayNG/1.8.34',
  'clash-meta/1.18.0',
  'ClashMetaForAndroid/2.11.0',
  'HiddifyNext/2.0',
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
    `${base}?target=v2ray`,
    `${base}?format=v2ray`,
    `${base}/v2ray`,
    `${base}/clash`,
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
  return enrichProfile({
    id: createHash('sha1').update(`${name}|${server}|${port}|${params.uuid || params.password || ''}`).digest('hex').slice(0, 12) || randomUUID().slice(0, 12),
    name: name.slice(0, 64),
    protocol: params.protocol,
    server,
    port,
    shareLink,
    params,
    createdAt: new Date().toISOString(),
  });
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

export function extractJsonProfiles(text: string): VpnProfile[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [];
  try {
    const data = JSON.parse(trimmed) as { proxies?: Record<string, unknown>[] } | Record<string, unknown>[];
    const list = Array.isArray(data) ? data : data.proxies;
    if (!Array.isArray(list)) return [];
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

function parseUserInfo(response: Response, url: string): VpnSubscriptionInfo {
  const raw = response.headers.get('subscription-userinfo') || response.headers.get('Subscription-Userinfo') || '';
  const parts = Object.fromEntries(raw.split(';').map((item) => {
    const [key, value] = item.split('=').map((part) => part.trim());
    return [key, value];
  }).filter((item) => item[0]));
  let title = response.headers.get('profile-title') || '';
  if (title.toLowerCase().startsWith('base64:')) {
    try { title = Buffer.from(title.slice(7), 'base64').toString('utf8'); } catch { /* keep */ }
  }
  const expire = Number(parts.expire);
  return {
    url,
    title: title || new URL(url).host,
    supportUrl: response.headers.get('support-url') || undefined,
    announce: response.headers.get('announce') || response.headers.get('profile-web-page-url') || undefined,
    expireAt: Number.isFinite(expire) && expire > 0 ? new Date(expire * 1000).toISOString() : undefined,
    upload: Number(parts.upload) || 0,
    download: Number(parts.download) || 0,
    total: Number(parts.total) || 0,
    updateHours: Number(response.headers.get('profile-update-interval')) || 1,
    lastSync: new Date().toISOString(),
  };
}

export async function fetchSubscriptionMaterial(url: string, hwid: string, log: (message: string) => void): Promise<{ links: string[]; clash: VpnProfile[]; info?: VpnSubscriptionInfo }> {
  const urls = candidateUrls(url);
  let htmlExtra: string[] = [];

  for (const target of urls) {
    for (const ua of CLIENT_UAS) {
      try {
        const response = await fetch(target, { headers: headers(ua, hwid), redirect: 'follow' });
        if (!response.ok) continue;
        const body = await response.text();
        if (!body.trim()) continue;
        if (htmlLooksLikePage(body)) {
          htmlExtra = [...new Set([...htmlExtra, ...extractUrlsFromHtml(body, target)])];
          log(`Страница панели (${new URL(target).pathname || '/'}, UA ${ua.split('/')[0]}) — ищем прямую подписку`);
          continue;
        }
        const links = extractShareLinks(body);
        const clash = extractClashProfiles(body);
        const json = extractJsonProfiles(body);
        if (links.length || clash.length || json.length) {
          log(`Подписка прочитана как ${ua.split('/')[0]} · ссылок ${links.length} · clash ${clash.length + json.length}`);
          return { links, clash: [...clash, ...json], info: parseUserInfo(response, url) };
        }
      } catch (error) {
        log(`Не удалось скачать ${target} (${ua.split('/')[0]}): ${error instanceof Error ? error.message : 'сеть'}`);
      }
    }
  }

  for (const extra of htmlExtra.slice(0, 6)) {
    if (urls.includes(extra)) continue;
    try {
      const response = await fetch(extra, { headers: headers('v2rayN/6.55', hwid), redirect: 'follow' });
      if (!response.ok) continue;
      const body = await response.text();
      const links = extractShareLinks(body);
      const clash = extractClashProfiles(body);
      if (links.length || clash.length) return { links, clash, info: parseUserInfo(response, url) };
    } catch { /* next */ }
  }

  return { links: [], clash: [] };
}
