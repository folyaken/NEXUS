import { promises as dns } from 'node:dns';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { countryByCode, looksLikeHost, looksLikeIp, looksLikeTechnicalName } from './vpn-classify';
import type { VpnProfile } from './types';

type GeoHit = { code: string; name: string; flag: string; city?: string; isp?: string };
type GeoCacheFile = { version: 2; locale: 'ru'; entries: Record<string, GeoHit> };

async function resolveHost(host: string): Promise<string | null> {
  if (looksLikeIp(host)) return host;
  try {
    const { address } = await dns.lookup(host);
    return address;
  } catch {
    return null;
  }
}

type GeoRow = { query: string; countryCode: string; city?: string; isp?: string };

/** Ответ провайдера — данные из сети, поэтому каждое поле проверяется. */
function sanitizeGeoText(value: unknown, maxLength = 64): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Управляющие символы вырезаются: строка попадает в имя профиля и в интерфейс.
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, maxLength) : undefined;
}

function sanitizeCountryCode(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
}

/**
 * Определение страны по IP через HTTPS.
 *
 * Раньше запрос шёл открытым HTTP: провайдер или любой узел на пути мог
 * подменить ответ и показать чужую страну для сервера. У ip-api HTTPS доступен
 * только в платном тарифе, поэтому основным источником стал ipwho.is
 * (HTTPS на бесплатном тарифе), а ip-api оставлен запасным — тоже по HTTPS.
 * Если шифрованный канал недоступен, геолокация просто не определяется:
 * откат на HTTP означал бы возврат к подменяемым данным.
 */
async function lookupBatch(ips: string[]): Promise<GeoRow[]> {
  if (!ips.length) return [];

  const rows = await lookupViaIpWho(ips);
  if (rows.length) return rows;
  return lookupViaIpApi(ips);
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', 'User-Agent': 'NEXUS-Network-Control-Plane', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

/** Основной источник: HTTPS доступен без подписки, но только по одному адресу. */
async function lookupViaIpWho(ips: string[]): Promise<GeoRow[]> {
  const rows: GeoRow[] = [];
  // Запросы идут небольшими группами, чтобы не упереться в лимиты сервиса.
  for (let index = 0; index < ips.length; index += 4) {
    const group = ips.slice(index, index + 4);
    const answers = await Promise.all(group.map(async (ip) => {
      const payload = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,ip,country_code,city,connection`);
      const record = payload as { success?: boolean; ip?: string; country_code?: unknown; city?: unknown; connection?: { isp?: unknown } } | null;
      if (!record || record.success === false) return null;
      const countryCode = sanitizeCountryCode(record.country_code);
      if (!countryCode) return null;
      return {
        query: ip,
        countryCode,
        city: sanitizeGeoText(record.city),
        isp: sanitizeGeoText(record.connection?.isp),
      } satisfies GeoRow;
    }));
    for (const answer of answers) if (answer) rows.push(answer);
  }
  return rows;
}

/** Запасной источник: тот же ip-api, но строго по HTTPS. */
async function lookupViaIpApi(ips: string[]): Promise<GeoRow[]> {
  const payload = await fetchJson('https://ip-api.com/batch?fields=status,query,countryCode,city,isp&lang=ru', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ips),
  });
  if (!Array.isArray(payload)) return [];

  const rows: GeoRow[] = [];
  for (const item of payload) {
    const record = item as { status?: unknown; query?: unknown; countryCode?: unknown; city?: unknown; isp?: unknown };
    if (record.status !== 'success' || typeof record.query !== 'string') continue;
    const countryCode = sanitizeCountryCode(record.countryCode);
    if (!countryCode) continue;
    rows.push({
      query: record.query,
      countryCode,
      city: sanitizeGeoText(record.city),
      isp: sanitizeGeoText(record.isp),
    });
  }
  return rows;
}

export async function applyGeo(profiles: VpnProfile[], cacheFile: string): Promise<VpnProfile[]> {
  const cache = await loadCache(cacheFile);
  const hosts = [...new Set(profiles.map((item) => item.server))];
  const missing: string[] = [];
  for (const host of hosts) {
    if (cache[host]) continue;
    const ip = await resolveHost(host);
    if (ip && cache[ip]) {
      cache[host] = cache[ip];
      continue;
    }
    if (ip) missing.push(ip);
  }

  if (missing.length) {
    for (let index = 0; index < missing.length; index += 100) {
      const chunk = missing.slice(index, index + 100);
      const rows = await lookupBatch(chunk);
      for (const row of rows) {
        const known = countryByCode(row.countryCode);
        if (!known) continue;
        cache[row.query] = { ...known, city: row.city, isp: row.isp };
      }
    }
    for (const host of hosts) {
      if (cache[host]) continue;
      const ip = await resolveHost(host);
      if (ip && cache[ip]) cache[host] = cache[ip];
    }
    const cacheDocument: GeoCacheFile = { version: 2, locale: 'ru', entries: cache };
    await fs.writeFile(cacheFile, `${JSON.stringify(cacheDocument)}\n`, 'utf8');
  }

  // Серверов в одной стране обычно несколько. Одинаковые названия в списке
  // неразличимы, поэтому повторы нумеруются: «Германия · 2», «Германия · 3».
  const usedNames = new Map<string, number>();
  for (const profile of profiles) {
    const hit = cache[profile.server];
    const nameless = looksLikeHost(profile.name)
      || profile.name === profile.server
      || looksLikeTechnicalName(profile.name);
    if (hit && nameless) continue;
    usedNames.set(profile.name, (usedNames.get(profile.name) ?? 0) + 1);
  }

  const uniqueName = (base: string): string => {
    const seen = usedNames.get(base) ?? 0;
    usedNames.set(base, seen + 1);
    return seen === 0 ? base : `${base} · ${seen + 1}`;
  };

  return profiles.map((profile) => {
    const hit = cache[profile.server];
    if (!hit) return profile;
    // Служебный тег из конфигурации («proxy-13») в списке серверов
    // бесполезен: пользователь выбирает по стране, а не по номеру выхода.
    const nameless = looksLikeHost(profile.name)
      || profile.name === profile.server
      || looksLikeTechnicalName(profile.name);
    return {
      ...profile,
      country: hit.code,
      countryName: hit.name,
      city: hit.city,
      flag: hit.flag,
      name: nameless ? uniqueName(hit.city ? `${hit.name} · ${hit.city}` : hit.name) : profile.name,
    };
  });
}

async function loadCache(file: string): Promise<Record<string, GeoHit>> {
  try {
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<GeoCacheFile>;
    if (parsed.version !== 2 || parsed.locale !== 'ru' || !parsed.entries || typeof parsed.entries !== 'object') return {};
    return parsed.entries;
  } catch {
    return {};
  }
}
