import { promises as dns } from 'node:dns';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { countryByCode, looksLikeHost, looksLikeIp } from './vpn-classify';
import type { VpnProfile } from './types';

type GeoHit = { code: string; name: string; flag: string; city?: string; isp?: string };

async function resolveHost(host: string): Promise<string | null> {
  if (looksLikeIp(host)) return host;
  try {
    const { address } = await dns.lookup(host);
    return address;
  } catch {
    return null;
  }
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
      try {
        const response = await fetch('http://ip-api.com/batch?fields=status,query,country,countryCode,city,isp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        });
        if (!response.ok) continue;
        const rows = await response.json() as Array<{ status: string; query: string; countryCode?: string; city?: string; isp?: string }>;
        for (const row of rows) {
          if (row.status !== 'success' || !row.countryCode) continue;
          const known = countryByCode(row.countryCode);
          if (!known) continue;
          cache[row.query] = { ...known, city: row.city, isp: row.isp };
        }
      } catch {
        /* offline */
      }
    }
    for (const host of hosts) {
      if (cache[host]) continue;
      const ip = await resolveHost(host);
      if (ip && cache[ip]) cache[host] = cache[ip];
    }
    await fs.writeFile(cacheFile, `${JSON.stringify(cache)}\n`, 'utf8');
  }

  return profiles.map((profile) => {
    const hit = cache[profile.server];
    if (!hit) return profile;
    const nameless = looksLikeHost(profile.name) || profile.name === profile.server;
    return {
      ...profile,
      country: hit.code,
      countryName: hit.name,
      flag: hit.flag,
      name: nameless ? (hit.city ? `${hit.name} · ${hit.city}` : hit.name) : profile.name,
    };
  });
}

async function loadCache(file: string): Promise<Record<string, GeoHit>> {
  try {
    if (!existsSync(file)) return {};
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, GeoHit>;
  } catch {
    return {};
  }
}
