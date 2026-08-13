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
  [/nether|голланд|amsterdam/i, 'NL'], [/german|deutsch|герман|frankfurt|berlin/i, 'DE'],
  [/united.?states|america|сша|new.?york|los.?angeles|miami/i, 'US'], [/britain|england|london|великобритан/i, 'GB'],
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

export function detectCountry(name: string): { code: string; name: string; flag: string } {
  const flags = name.match(/\p{Regional_Indicator}{2}/u);
  if (flags) {
    const code = [...flags[0]].map((char) => String.fromCharCode(char.codePointAt(0)! - 127397)).join('');
    const known = COUNTRIES[code];
    if (known) return { code, ...known };
  }
  const iso = name.match(/(?:^|[\s\[\(\-_|])([A-Z]{2})(?:$|[\s\]\)\-_|0-9])/);
  if (iso && COUNTRIES[iso[1]]) return { code: iso[1], ...COUNTRIES[iso[1]] };
  for (const [pattern, code] of NAME_TO_ISO) {
    if (pattern.test(name) && COUNTRIES[code]) return { code, ...COUNTRIES[code] };
  }
  if (/доступн|быстр|optimal|fastest|europe|европ/i.test(name)) return { code: 'EU', name: 'Европа', flag: '🇪🇺' };
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
  const country = detectCountry(profile.name);
  return {
    ...profile,
    kind: service ? 'notice' : 'node',
    country: country.code,
    countryName: country.name,
    flag: country.flag,
    stack: protocolStack(profile),
    isNew: /new|нов/i.test(profile.name) || Date.now() - Date.parse(profile.createdAt || '') < 1000 * 60 * 60 * 24,
  };
}
