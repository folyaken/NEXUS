import dgram from 'node:dgram';
import { DNS_PROVIDERS, resolveDnsServers, type DnsProviderId } from './dns-servers';

/**
 * Проверка справочника имён.
 *
 * Зачем. Человек выбирает DNS и не может убедиться, что тот вообще отвечает:
 * если адрес нерабочий, сайты просто перестают открываться, и причина неочевидна
 * — выглядит как «пропал интернет». Проверка отвечает на два вопроса: сервер
 * жив и насколько быстро он отвечает.
 *
 * Почему настоящий DNS-запрос, а не проверка соединения. Открытый порт ничего
 * не доказывает: у провайдеров бывают заглушки, которые принимают соединение и
 * молчат. Здесь отправляется полноценный запрос и разбирается ответ — только
 * так видно, что справочник действительно работает.
 */

export interface DnsCheckResult {
  /** Адрес, который проверяли. */
  server: string;
  /** Название провайдера, если адрес известен. */
  title: string;
  /** Время ответа в миллисекундах. Пусто, если сервер не ответил. */
  latencyMs: number | null;
  ok: boolean;
  /** Причина отказа, понятная человеку. */
  error?: string;
}

/** Имя для проверки: короткое, есть всегда и не кэшируется агрессивно. */
const PROBE_HOSTNAME = 'example.com';
const TIMEOUT_MS = 2500;

/**
 * Собирает запрос DNS вручную.
 *
 * Готовой библиотеки в проекте нет, а тянуть зависимость ради двух десятков
 * байт неразумно: формат запроса простой и не менялся десятилетиями.
 */
function buildQuery(hostname: string): Buffer {
  const parts = hostname.split('.');
  // 12 байт заголовка + имя + 4 байта на тип и класс записи.
  const nameLength = parts.reduce((total, part) => total + part.length + 1, 1);
  const buffer = Buffer.alloc(12 + nameLength + 4);

  // Случайный номер запроса: по нему проверяется, что ответ пришёл на него.
  buffer.writeUInt16BE(Math.floor(Math.random() * 65535), 0);
  // Флаги: обычный запрос с рекурсией.
  buffer.writeUInt16BE(0x0100, 2);
  // Один вопрос в запросе.
  buffer.writeUInt16BE(1, 4);

  let offset = 12;
  for (const part of parts) {
    buffer.writeUInt8(part.length, offset);
    buffer.write(part, offset + 1, 'ascii');
    offset += part.length + 1;
  }
  buffer.writeUInt8(0, offset);
  offset += 1;
  buffer.writeUInt16BE(1, offset);      // тип A — обычный адрес
  buffer.writeUInt16BE(1, offset + 2);  // класс IN — интернет
  return buffer;
}

/** Ответ считается годным, если сервер вернул хотя бы одну запись без ошибки. */
function isUsableAnswer(response: Buffer, requestId: number): boolean {
  if (response.length < 12) return false;
  if (response.readUInt16BE(0) !== requestId) return false;
  // Младшие четыре бита флагов — код ответа. Ноль означает успех.
  const responseCode = response.readUInt16BE(2) & 0x000f;
  if (responseCode !== 0) return false;
  return response.readUInt16BE(6) > 0;
}

/**
 * Проверяет один адрес.
 *
 * Адреса DNS-over-HTTPS (`https://…`) здесь не проверяются: у них другой
 * протокол, и запрос по UDP до них не дойдёт. Для таких возвращается честный
 * ответ вместо ложной ошибки.
 */
export function checkDnsServer(server: string, timeoutMs = TIMEOUT_MS): Promise<DnsCheckResult> {
  const provider = DNS_PROVIDERS.find((item) => item.servers.includes(server));
  const title = provider ? provider.title : server;

  if (/^https:\/\//i.test(server)) {
    return Promise.resolve({
      server, title, latencyMs: null, ok: true,
      error: 'Защищённый адрес — проверяется при подключении',
    });
  }

  return new Promise((resolve) => {
    const query = buildQuery(PROBE_HOSTNAME);
    const requestId = query.readUInt16BE(0);
    const socket = dgram.createSocket(server.includes(':') ? 'udp6' : 'udp4');
    const startedAt = Date.now();
    let settled = false;

    const finish = (result: DnsCheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Закрытие в try: сокет мог уже отвалиться сам, и повторный close бросает.
      try { socket.close(); } catch { /* уже закрыт */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ server, title, latencyMs: null, ok: false, error: 'Сервер не ответил' });
    }, timeoutMs);

    socket.on('message', (response) => {
      const latencyMs = Math.max(1, Date.now() - startedAt);
      finish(isUsableAnswer(response, requestId)
        ? { server, title, latencyMs, ok: true }
        : { server, title, latencyMs, ok: false, error: 'Сервер ответил ошибкой' });
    });

    socket.on('error', (error) => {
      finish({ server, title, latencyMs: null, ok: false, error: cleanReason(error) });
    });

    try {
      socket.send(query, 53, server);
    } catch (error) {
      finish({ server, title, latencyMs: null, ok: false, error: cleanReason(error) });
    }
  });
}

/** Технические коды сети заменяются понятной причиной. */
function cleanReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/EACCES|EPERM/i.test(message)) return 'Запрос заблокирован системой или брандмауэром';
  if (/ENETUNREACH|EHOSTUNREACH/i.test(message)) return 'Сеть недоступна';
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return 'Адрес не найден';
  return 'Не удалось отправить запрос';
}

/**
 * Проверяет все известные справочники и сортирует по скорости.
 *
 * Нужно для подсказки «какой выбрать»: скорость DNS зависит от сети и
 * провайдера, и угадать заранее нельзя — в одной сети быстрее Cloudflare,
 * в другой Google. Проверки идут одновременно: последовательно это заняло бы
 * несколько секунд.
 */
export async function measureDnsProviders(timeoutMs = TIMEOUT_MS): Promise<DnsCheckResult[]> {
  const candidates = DNS_PROVIDERS
    .filter((provider) => provider.servers.length)
    .map((provider) => ({ id: provider.id, server: provider.servers[0] }));

  const results = await Promise.all(
    candidates.map(async ({ id, server }) => {
      const result = await checkDnsServer(server, timeoutMs);
      return { ...result, providerId: id };
    }),
  );

  // Отвечающие сначала, среди них — самые быстрые.
  return results.sort((left, right) => {
    if (left.ok !== right.ok) return left.ok ? -1 : 1;
    return (left.latencyMs ?? Number.MAX_SAFE_INTEGER) - (right.latencyMs ?? Number.MAX_SAFE_INTEGER);
  });
}

/** Адреса выбранной настройки — то, что реально проверять у пользователя. */
export function serversForSettings(providerId: string, customAddress: string): string[] {
  const servers = resolveDnsServers(providerId, customAddress);
  // У системного справочника своих адресов нет: их назначает Windows, и
  // проверять здесь нечего.
  return servers.length ? servers.slice(0, 1) : [];
}

export type { DnsProviderId };
