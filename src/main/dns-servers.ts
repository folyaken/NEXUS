/**
 * Выбор DNS-сервера.
 *
 * Зачем это нужно. DNS — это справочник, который переводит имя сайта в адрес
 * сервера. По умолчанию используется справочник провайдера, и он видит все
 * запрошенные имена, даже когда сам трафик идёт через VPN. Провайдеры этим
 * пользуются: часть блокировок работает именно на уровне DNS — сайт открыт, но
 * его адрес «не находится».
 *
 * Свой DNS закрывает обе задачи: провайдер перестаёт видеть список посещённых
 * имён, а блокировки на уровне справочника перестают действовать.
 *
 * Список намеренно короткий. Десяток адресов на выбор запутывает: человеку
 * нужно решение, а не каталог. Оставлены четыре понятных варианта плюс
 * возможность вписать свой адрес.
 */

export type DnsProviderId = 'system' | 'cloudflare' | 'google' | 'adguard' | 'quad9' | 'custom';

export interface DnsProvider {
  id: DnsProviderId;
  /** Название для интерфейса. Переводится словарём. */
  title: string;
  /** Чем этот вариант отличается от остальных — простыми словами. */
  description: string;
  /** Основной и запасной адреса. Пусто у «системного» и «своего». */
  servers: string[];
}

export const DNS_PROVIDERS: DnsProvider[] = [
  {
    id: 'system',
    title: 'Как в Windows',
    description: 'Справочник провайдера. Он видит, какие сайты вы открываете.',
    servers: [],
  },
  {
    id: 'cloudflare',
    title: 'Cloudflare',
    description: 'Быстрый, не хранит историю запросов. 1.1.1.1',
    servers: ['1.1.1.1', '1.0.0.1'],
  },
  {
    id: 'google',
    title: 'Google',
    description: 'Стабильный и доступен почти везде. 8.8.8.8',
    servers: ['8.8.8.8', '8.8.4.4'],
  },
  {
    id: 'adguard',
    title: 'AdGuard',
    description: 'Дополнительно режет рекламу и следящие домены. 94.140.14.14',
    servers: ['94.140.14.14', '94.140.15.15'],
  },
  {
    id: 'quad9',
    title: 'Quad9',
    description: 'Блокирует известные вредоносные сайты. 9.9.9.9',
    servers: ['9.9.9.9', '149.112.112.112'],
  },
  {
    id: 'custom',
    title: 'Свой адрес',
    description: 'Укажите адрес вручную, если пользуетесь своим сервером.',
    servers: [],
  },
];

/**
 * Проверка адреса DNS-сервера.
 *
 * Принимаются обычный IPv4, IPv6 и запись вида `https://…/dns-query`
 * (DNS-over-HTTPS — его понимают оба ядра). Неверный адрес молча ломал бы
 * разрешение имён целиком: интернет «пропадал» бы без объяснения причины,
 * поэтому значение проверяется до записи в настройки.
 */
export function isValidDnsAddress(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 200) return false;

  if (/^https:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      return url.protocol === 'https:' && Boolean(url.hostname);
    } catch {
      return false;
    }
  }

  const ipv4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  if (ipv4.test(text)) return true;

  // IPv6 проверяется через конструктор URL: свой разбор всех сокращённых форм
  // легко написать с ошибкой, а браузерный движок это уже умеет.
  try {
    return Boolean(new URL(`http://[${text}]`).hostname);
  } catch {
    return false;
  }
}

/**
 * Адреса, которые надо передать ядру.
 *
 * Для «как в Windows» возвращается пустой список — тогда ядро не получает
 * секцию DNS вовсе и работает через системный справочник, как раньше.
 */
export function resolveDnsServers(providerId: string, customAddress = ''): string[] {
  if (providerId === 'custom') {
    const custom = customAddress.trim();
    return isValidDnsAddress(custom) ? [custom] : [];
  }
  const provider = DNS_PROVIDERS.find((item) => item.id === providerId);
  return provider ? [...provider.servers] : [];
}

/**
 * Секция DNS для конфигурации Xray.
 *
 * `queryStrategy: UseIP` оставляет ядру выбор между IPv4 и IPv6. Жёсткое
 * `UseIPv4` ломало бы сайты, доступные только по IPv6.
 */
export function xrayDnsSection(servers: string[]): Record<string, unknown> | null {
  if (!servers.length) return null;
  return { servers, queryStrategy: 'UseIP' };
}

/**
 * Секция DNS для конфигурации sing-box.
 *
 * Формат другой: сервера описываются объектами с тегом. Локальный сервер
 * добавляется отдельно — через него разрешается адрес самого VPN-сервера,
 * иначе получится замкнутый круг: чтобы подключиться, нужно узнать адрес, а
 * чтобы узнать адрес — уже быть подключённым.
 */
export function singboxDnsSection(servers: string[]): Record<string, unknown> | null {
  if (!servers.length) return null;
  return {
    servers: [
      ...servers.map((address, index) => ({
        tag: `dns-${index}`,
        address,
        detour: 'proxy',
      })),
      { tag: 'dns-direct', address: 'local', detour: 'direct' },
    ],
    // Имя сервера подключения разрешается напрямую, всё остальное — через
    // выбранный справочник.
    rules: [{ outbound: 'any', server: 'dns-direct' }],
    final: 'dns-0',
    strategy: 'prefer_ipv4',
  };
}
