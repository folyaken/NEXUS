import os from 'node:os';

/**
 * Раздача локальных SOCKS/HTTP-входов в домашнюю сеть («Allow LAN»).
 *
 * По умолчанию Xray и sing-box слушают только 127.0.0.1, поэтому прокси доступен
 * исключительно самому компьютеру. Когда пользователь включает раздачу, входы
 * поднимаются на 0.0.0.0 и любое устройство в той же сети (ТВ, консоль, телефон)
 * может ходить через NEXUS, указав IP этого ПК и порт.
 */

/** Приватные диапазоны RFC1918 + CGNAT, только они считаются «домашней сетью». */
const PRIVATE_IPV4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

export interface LanEndpoint {
  /** Человекочитаемое имя интерфейса, например «Ethernet» или «Wi-Fi». */
  interfaceName: string;
  address: string;
  socks: string;
  http: string;
}

export function isPrivateIpv4(address: string): boolean {
  return PRIVATE_IPV4.some((pattern) => pattern.test(address));
}

/** Адрес, на котором должны слушать локальные входы ядра. */
export function inboundListenAddress(allowLan: boolean): string {
  return allowLan ? '0.0.0.0' : '127.0.0.1';
}

/**
 * Все приватные IPv4 машины, отсортированные стабильно, чтобы список в интерфейсе
 * не «прыгал» между обновлениями снапшота.
 */
export function lanAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): { interfaceName: string; address: string }[] {
  const found: { interfaceName: string; address: string }[] = [];
  const seen = new Set<string>();

  for (const [interfaceName, list] of Object.entries(interfaces)) {
    for (const item of list ?? []) {
      if (item.internal) continue;
      if (item.family !== 'IPv4' && String(item.family) !== '4') continue;
      if (!isPrivateIpv4(item.address) || seen.has(item.address)) continue;
      seen.add(item.address);
      found.push({ interfaceName, address: item.address });
    }
  }

  return found.sort((left, right) => left.address.localeCompare(right.address, 'en'));
}

/** Готовые строки «ip:порт» для карточки раздачи в интерфейсе. */
export function lanEndpoints(
  allowLan: boolean,
  inboundPort: number,
  interfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
): LanEndpoint[] {
  if (!allowLan || !Number.isFinite(inboundPort) || inboundPort <= 0) return [];
  return lanAddresses(interfaces).map(({ interfaceName, address }) => ({
    interfaceName,
    address,
    socks: `${address}:${inboundPort}`,
    http: `${address}:${inboundPort + 1}`,
  }));
}
