/**
 * Правила маршрутизации VPN.
 *
 * Зачем. Обычно VPN — это «всё или ничего»: либо весь трафик идёт через сервер,
 * либо ничего. На практике так неудобно: банк и госуслуги ругаются на вход из
 * другой страны, локальные сайты открываются медленнее, а реклама грузится и
 * через VPN. Правила позволяют развести это по адресам: одни сайты напрямую,
 * другие через сервер, третьи вообще не открывать.
 *
 * Правила действуют только на VPN. Обход блокировок (Zapret) работает на другом
 * уровне — он вмешивается в сетевые пакеты, а не выбирает маршрут, — и общего
 * механизма правил у них быть не может.
 */

/** Куда направить трафик, попавший под правило. */
export type RoutingOutbound = 'proxy' | 'direct' | 'block';

export interface RoutingRule {
  id: string;
  /** Домен, адрес, подсеть или групповой набор вида `geosite:ru`. */
  value: string;
  outbound: RoutingOutbound;
  enabled: boolean;
}

/**
 * Готовые наборы адресов, встроенные в ядро.
 *
 * Файлы `geosite.dat` и `geoip.dat` поставляются вместе с Xray и содержат
 * заранее собранные списки: все российские сайты, соцсети, рекламные сети.
 * Перечислять такие адреса вручную бессмысленно — их тысячи.
 */
export const ROUTING_PRESETS: { value: string; title: string; description: string }[] = [
  { value: 'geosite:category-ads-all', title: 'Реклама и слежка', description: 'Рекламные и следящие домены. Обычно их блокируют.' },
  { value: 'geosite:ru', title: 'Российские сайты', description: 'Госуслуги, банки, локальные сервисы. Обычно — напрямую.' },
  { value: 'geoip:ru', title: 'Российские адреса', description: 'Серверы, расположенные в России.' },
  { value: 'geosite:private', title: 'Домашняя сеть', description: 'Роутер, принтер, сетевой диск. Всегда напрямую.' },
  { value: 'geoip:private', title: 'Локальные адреса', description: 'Адреса вида 192.168.x.x и подобные.' },
  { value: 'geosite:category-social-media', title: 'Соцсети', description: 'Социальные сети и мессенджеры.' },
];

/** Пределы: список правил не должен разрастаться бесконтрольно. */
export const MAX_ROUTING_RULES = 100;
const MAX_VALUE_LENGTH = 200;

/**
 * Проверка того, что ввёл пользователь.
 *
 * Ошибка здесь стоит дорого: неверная строка в конфигурации не даёт ядру
 * запуститься вовсе, и VPN перестаёт подключаться — с виду «без причины».
 * Поэтому значение проверяется до сохранения, а не при подключении.
 */
export function isValidRoutingValue(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text || text.length > MAX_VALUE_LENGTH) return false;

  // Групповые наборы из файлов ядра.
  if (/^(geosite|geoip|ext):[a-z0-9._@-]+$/.test(text)) return true;
  // Полное совпадение и регулярные выражения — синтаксис самого Xray.
  if (/^(full|domain|regexp|keyword):.+$/.test(text)) return true;

  // Подсеть: 10.0.0.0/8.
  if (/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(text)) {
    const [address, mask] = text.split('/');
    return address.split('.').every((part) => Number(part) <= 255) && Number(mask) <= 32;
  }
  // Обычный адрес IPv4.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
    return text.split('.').every((part) => Number(part) <= 255);
  }
  // Домен, в том числе с маской поддоменов: *.example.com.
  return /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(text);
}

/** Приводит список из настроек к рабочему виду, отбрасывая мусор. */
export function normalizeRoutingRules(raw: unknown): RoutingRule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rules: RoutingRule[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Partial<RoutingRule>;
    const value = String(source.value ?? '').trim();
    if (!isValidRoutingValue(value)) continue;

    // Повторы бессмысленны: сработает только первое совпавшее правило.
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const outbound = source.outbound === 'direct' || source.outbound === 'block' ? source.outbound : 'proxy';
    rules.push({
      id: typeof source.id === 'string' && source.id ? source.id : `rule-${rules.length + 1}-${key.slice(0, 24)}`,
      value,
      outbound,
      enabled: source.enabled !== false,
    });
    if (rules.length >= MAX_ROUTING_RULES) break;
  }
  return rules;
}

/**
 * Превращает правила в секцию `rules` для Xray.
 *
 * Порядок сохраняется: ядро применяет первое совпавшее правило, поэтому
 * положение в списке — это и есть приоритет. Выключенные правила пропускаются,
 * но остаются в настройках: их удобно включить обратно, не набирая заново.
 */
export function xrayRoutingRules(rules: RoutingRule[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const value = rule.value.trim();
    const outboundTag = rule.outbound === 'block' ? 'block' : rule.outbound === 'direct' ? 'direct' : 'proxy';

    // IP-адреса, подсети и наборы geoip описываются полем ip, домены — domain.
    const isAddress = /^geoip:/i.test(value)
      || /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(value);

    result.push(isAddress
      ? { type: 'field', ip: [value], outboundTag }
      : { type: 'field', domain: [value], outboundTag });
  }
  return result;
}

/**
 * То же самое для sing-box: у него другой формат правил.
 *
 * Групповые наборы geosite/geoip в sing-box подключаются иначе и требуют
 * отдельных файлов правил, поэтому здесь они пропускаются — иначе ядро не
 * запустится. Обычные домены и адреса работают.
 */
export function singboxRoutingRules(rules: RoutingRule[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const value = rule.value.trim();
    if (/^(geosite|geoip|ext):/i.test(value)) continue;

    const action = rule.outbound === 'block'
      ? { action: 'reject' }
      : { action: 'route', outbound: rule.outbound === 'direct' ? 'direct' : 'proxy' };

    if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(value)) {
      result.push({ ip_cidr: [value.includes('/') ? value : `${value}/32`], ...action });
    } else if (value.startsWith('*.')) {
      result.push({ domain_suffix: [value.slice(1)], ...action });
    } else {
      result.push({ domain: [value], domain_suffix: [`.${value}`], ...action });
    }
  }
  return result;
}
