import type { VpnProfile } from './types';

const SERVICE_HOSTS = new Set(['0.0.0.0', '127.0.0.1', '::', 'localhost', 'example.com', '1.1.1.1']);
const SERVICE_NAME = /подписк|hwid|оплат|напишите|telegram|velvetpays|закончил|продлите|help_bot|отправк|уведомл|announce|info|support|бот|оплатите|expired|renew/i;

const COUNTRIES: Record<string, { name: string; flag: string }> = {
  NL: { name: 'Нидерланды', flag: '🇳🇱' }, DE: { name: 'Германия', flag: '🇩🇪' }, US: { name: 'США', flag: '🇺🇸' },
  GB: { name: 'Великобритания', flag: '🇬🇧' }, UK: { name: 'Великобритания', flag: '🇬🇧' }, FR: { name: 'Франция', flag: '🇫🇷' },
  FI: { name: 'Финляндия', flag: '🇫🇮' }, SE: { name: 'Швеция', flag: '🇸🇪' }, NO: { name: 'Норвегия', flag: '🇳🇴' },
  PL: { name: 'Польша', flag: '🇵🇱' }, CZ: { name: 'Чехия', flag: '🇨🇿' }, AT: { name: 'Австрия', flag: '🇦🇹' },
  CH: { name: 'Швейцария', flag: '🇨🇭' }, IT: { name: 'Италия', flag: '🇮🇹' }, ES: { name: 'Испания', flag: '🇪🇸' },
  TR: { name: 'Турция', flag: '🇹🇷' }, AE: { name: 'ОАЭ', flag: '🇦🇪' }, SG: { name: 'Сингапур', flag: '🇸🇬' },
  JP: { name: 'Япония', flag: '🇯🇵' }, KR: { name: 'Корея', flag: '🇰🇷' }, HK: { name: 'Гонконг', flag: '🇭🇰' },
  TW: { name: 'Тайвань', flag: '🇹🇼' }, IN: { name: 'Индия', flag: '🇮🇳' }, CA: { name: 'Канада', flag: '🇨🇦' },
  AU: { name: 'Австралия', flag: '🇦🇺' }, BR: { name: 'Бразилия', flag: '🇧🇷' }, KZ: { name: 'Казахстан', flag: '🇰🇿' },
  RU: { name: 'Россия', flag: '🇷🇺' }, UA: { name: 'Украина', flag: '🇺🇦' }, LV: { name: 'Латвия', flag: '🇱🇻' },
  LT: { name: 'Литва', flag: '🇱🇹' }, EE: { name: 'Эстония', flag: '🇪🇪' }, RO: { name: 'Румыния', flag: '🇷🇴' },
  BG: { name: 'Болгария', flag: '🇧🇬' }, RS: { name: 'Сербия', flag: '🇷🇸' }, MD: { name: 'Молдова', flag: '🇲🇩' },
  GE: { name: 'Грузия', flag: '🇬🇪' }, AM: { name: 'Армения', flag: '🇦🇲' }, AZ: { name: 'Азербайджан', flag: '🇦🇿' },
  EU: { name: 'Европа', flag: '🇪🇺' },
  IL: { name: 'Израиль', flag: '🇮🇱' }, IR: { name: 'Иран', flag: '🇮🇷' }, CN: { name: 'Китай', flag: '🇨🇳' },
};

const NAME_TO_ISO: Array<[RegExp, string]> = [
  [/nether|голланд|amsterdam|^ams\d/i, 'NL'], [/german|deutsch|герман|frankfurt|berlin|^fra\d|nodemesh/i, 'DE'],
  [/united.?states|america|сша|new.?york|los.?angeles|miami|^nyc\d|^lax\d/i, 'US'], [/britain|england|london|великобритан|^lon\d|^lhr\d/i, 'GB'],
  [/france|paris|франц/i, 'FR'], [/finland|helsinki|финлянд/i, 'FI'], [/sweden|stockholm|швец/i, 'SE'],
  [/poland|warsaw|польш/i, 'PL'], [/turkey|istanbul|турц/i, 'TR'], [/singapore|сингапур/i, 'SG'],
  [/japan|tokyo|япон/i, 'JP'], [/korea|seoul|коре/i, 'KR'], [/hong.?kong|гонконг/i, 'HK'],
  [/canada|toronto|канад/i, 'CA'], [/latvia|рига|латви/i, 'LV'], [/lithuania|вильн|литв/i, 'LT'],
  [/estonia|tallinn|эстон/i, 'EE'], [/kazakhstan|алмат|астан|казах/i, 'KZ'], [/russia|москв|росси/i, 'RU'],
];

export function isServiceNode(profile: Pick<VpnProfile, 'name' | 'server' | 'port'>): boolean {
  if (SERVICE_HOSTS.has(profile.server.toLowerCase())) return true;
  if (profile.port <= 1) return true;
  if (SERVICE_NAME.test(profile.name)) return true;
  return false;
}

export function countryByCode(code: string): { code: string; name: string; flag: string } | null {
  const known = COUNTRIES[code.toUpperCase()];
  return known ? { code: code.toUpperCase(), ...known } : null;
}

export function looksLikeIp(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || /^[0-9a-f:]+$/i.test(value);
}

export function looksLikeHost(value: string): boolean {
  const text = value.trim();
  if (!text || /[а-яё]/i.test(text)) return false;
  if (looksLikeIp(text)) return true;
  if (text.includes('.') && /^[a-z0-9.-]+$/i.test(text)) return true;
  return /^[a-z]{3}\d{1,2}(?:[-.][a-z0-9.-]+)?$/i.test(text);
}

export function canConnect(profile: Pick<VpnProfile, 'protocol' | 'kind' | 'params'>): string | null {
  if (profile.kind === 'notice') return 'Это не сервер, а служебная строка панели.';
  if (profile.protocol === 'hysteria2') return 'Hysteria есть только в Happ. Здесь бери VLESS / VMess / Trojan / SS.';
  if ((profile.params.security || '').toLowerCase() === 'reality' && !profile.params.publicKey) return 'У Reality-узла нет ключа — ссылка обрезана.';
  return null;
}

export function displayName(profile: VpnProfile): string {
  if (!looksLikeHost(profile.name) && profile.name.trim()) return profile.name;
  if (profile.countryName && profile.countryName !== 'Другие') {
    const city = profile.name.includes('·') ? profile.name.split('·')[1]?.trim() : '';
    return city && !looksLikeHost(city) ? `${profile.countryName} · ${city}` : profile.countryName;
  }
  return profile.name;
}

export function detectCountry(...hints: Array<string | undefined>): { code: string; name: string; flag: string } {
  for (const hint of hints) {
    if (!hint) continue;
    const flags = hint.match(/\p{Regional_Indicator}{2}/u);
    if (flags) {
      const code = [...flags[0]].map((char) => String.fromCharCode(char.codePointAt(0)! - 127397)).join('');
      const known = COUNTRIES[code];
      if (known) return { code, ...known };
    }
    const iso = hint.match(/(?:^|[\s\[\(\-_|])([A-Z]{2})(?:$|[\s\]\)\-_|0-9])/);
    if (iso && COUNTRIES[iso[1]]) return { code: iso[1], ...COUNTRIES[iso[1]] };
    for (const [pattern, code] of NAME_TO_ISO) {
      if (pattern.test(hint) && COUNTRIES[code]) return { code, ...COUNTRIES[code] };
    }
    const tld = hint.match(/\.([a-z]{2})(?:$|\/)/i)?.[1]?.toUpperCase();
    if (tld && COUNTRIES[tld === 'UK' ? 'GB' : tld]) {
      const code = tld === 'UK' ? 'GB' : tld;
      return { code, ...COUNTRIES[code] };
    }
    if (/доступн|быстр|optimal|fastest|europe|европ/i.test(hint)) return { code: 'EU', name: 'Европа', flag: '🇪🇺' };
  }
  return { code: 'UN', name: 'Другие', flag: '🌐' };
}

export function protocolStack(profile: Pick<VpnProfile, 'protocol' | 'params'>): string {
  const proto = ({ vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', shadowsocks: 'SS', hysteria2: 'HYSTERIA' })[profile.protocol] || profile.protocol.toUpperCase();
  const network = (profile.params.network || (profile.protocol === 'hysteria2' ? 'HYSTERIA' : 'TCP')).toUpperCase();
  const security = (profile.params.security || (profile.protocol === 'hysteria2' ? 'TLS' : 'NONE')).toUpperCase();
  return `${proto} / ${network} / ${security} / JSON`;
}

export function subscriptionLabel(url?: string): string {
  if (!url) return 'Ручные профили';
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return 'Подписка';
  }
}

export function enrichProfile(profile: VpnProfile): VpnProfile {
  const service = isServiceNode(profile);
  const country = detectCountry(profile.name, profile.params.sni, profile.params.host, profile.server);
  return {
    ...profile,
    kind: service ? 'notice' : 'node',
    country: profile.country && profile.country !== 'UN' ? profile.country : country.code,
    countryName: profile.countryName && profile.country !== 'UN' ? profile.countryName : country.name,
    flag: profile.flag && profile.country !== 'UN' ? profile.flag : country.flag,
    stack: protocolStack(profile),
    isNew: /(?:^|[\s\[])new(?:$|[\s\]])|нов/i.test(profile.name),
  };
}
