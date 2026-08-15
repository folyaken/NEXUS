import type { ModuleLog } from './types';

/**
 * Разбор вывода Xray и sing-box.
 *
 * Ядро пишет в stderr всё подряд: служебную статистику, обрывы отдельных
 * соединений и настоящие отказы. Раньше строка показывалась пользователю как
 * есть — вместе с ANSI-кодами цвета (`[31mERROR[0m`) и внутренними адресами,
 * а любое упоминание слова «error» поднималось до уровня ошибки. В результате
 * штатный обрыв вкладки браузера выглядел как поломка VPN.
 */

/** Управляющие последовательности цвета, которые ядро печатает для терминала. */
const ANSI_PATTERN = /\u001b?\[[0-9;]*m/g;

/**
 * Обрывы отдельных соединений.
 *
 * Возникают постоянно при обычном сёрфинге: пользователь закрыл вкладку,
 * сервер закрыл keep-alive, приложение отменило запрос. К работоспособности
 * туннеля отношения не имеют.
 */
const CONNECTION_NOISE = [
  /connection download closed/i,
  /connection upload closed/i,
  /forcibly closed by the remote host/i,
  /connection reset by peer/i,
  /broken pipe/i,
  /use of closed network connection/i,
  /context canceled/i,
  /i\/o timeout/i,
  /EOF$/i,
  /wsarecv|wsasend/i,
  /read: connection aborted/i,
  /an established connection was aborted/i,
];

/** Отказы, которые действительно ломают подключение. */
const FATAL_PATTERNS = [
  /failed to (?:start|bind|listen|initialize|load|parse)/i,
  /address already in use/i,
  /permission denied/i,
  /invalid (?:config|json|user|uuid|password)/i,
  /panic:/i,
  /fatal/i,
  /no such file or directory/i,
  /cannot resolve/i,
  /handshake failed/i,
  /certificate/i,
];

export interface ParsedVpnLine {
  level: ModuleLog['level'];
  message: string;
  /** Строку не нужно показывать пользователю: это фоновый шум соединений. */
  noise: boolean;
  /** Строка означает отказ подключения и годится как причина ошибки. */
  fatal: boolean;
}

/** Убирает ANSI-раскраску и служебные отступы. */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

/**
 * Прячет локальные адреса и порты.
 *
 * `127.0.0.1:10809->127.0.0.1:56142` ничего не говорит пользователю, но выдаёт
 * внутреннее устройство туннеля. В журнал попадает обобщённая формулировка.
 */
function hideLocalEndpoints(value: string): string {
  return value
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}(?:\s*->\s*(?:\d{1,3}\.){3}\d{1,3}:\d{1,5})?/g, 'локальный порт')
    .replace(/\b\[[0-9a-f:]+\]:\d{1,5}/gi, 'локальный порт');
}

/** Разбирает одну строку вывода ядра. */
export function parseVpnLogLine(rawLine: string): ParsedVpnLine | null {
  const line = stripAnsi(String(rawLine ?? '')).trim();
  if (!line) return null;

  const noise = CONNECTION_NOISE.some((pattern) => pattern.test(line));
  const fatal = !noise && FATAL_PATTERNS.some((pattern) => pattern.test(line));
  const declaredError = /\bERROR\b|\bFATAL\b/.test(line);

  // Обрыв соединения остаётся в файле журнала, но не тревожит пользователя.
  const level: ModuleLog['level'] = fatal ? 'error' : noise ? 'info' : declaredError ? 'warn' : 'info';

  // Отметка времени и уровень ядра дублируют то, что NEXUS показывает сам.
  const message = hideLocalEndpoints(line)
    .replace(/^\[?\d{4}[/-]\d{2}[/-]\d{2}[ T]\d{2}:\d{2}:\d{2}\]?\s*/, '')
    .replace(/^(?:ERROR|WARNING|WARN|INFO|DEBUG)\s*(?:\[\d+\]\s*)?/i, '')
    .replace(/^\[[^\]]*\d+\.\d+s\]\s*/, '')
    .trim();

  if (!message) return null;
  return { level, message: message.slice(0, 240), noise, fatal };
}

/**
 * Понятная пользователю причина отказа.
 *
 * Технический текст ядра заменяется объяснением с конкретным действием, потому
 * что «bind: address already in use» ни о чём не говорит без подсказки.
 */
export function describeVpnFailure(rawLine: string, mode: 'proxy' | 'tun'): string {
  const line = stripAnsi(String(rawLine ?? ''));

  if (/address already in use|bind: /i.test(line)) {
    return 'Локальный порт занят другой программой. Смените порт в настройках Jey2Ray или закройте другой VPN-клиент.';
  }
  if (/permission denied|access is denied|operation not permitted/i.test(line)) {
    return mode === 'tun'
      ? 'Для режима TUN нужны права администратора. Запустите NEXUS от имени администратора или переключитесь на PROXY.'
      : 'Системе не хватило прав для запуска ядра. Запустите NEXUS от имени администратора.';
  }
  if (/invalid (?:config|json)|failed to parse|unmarshal/i.test(line)) {
    return 'Профиль сервера повреждён или не поддерживается. Обновите подписку и выберите сервер заново.';
  }
  if (/invalid (?:user|uuid|password)|authentication|auth failed/i.test(line)) {
    return 'Сервер отклонил учётные данные. Обновите подписку — ключ мог измениться.';
  }
  if (/no such file|not found|cannot find/i.test(line)) {
    return 'Файл ядра не найден. Нажмите «Проверить обновления» и дождитесь загрузки Xray-core.';
  }
  if (/cannot resolve|no such host|dns/i.test(line)) {
    return 'Не удалось определить адрес сервера. Проверьте подключение к интернету и адрес в подписке.';
  }
  if (/handshake|certificate|tls/i.test(line)) {
    return 'Сервер не принял защищённое соединение. Попробуйте другой сервер — этот может быть недоступен.';
  }

  const parsed = parseVpnLogLine(line);
  return parsed?.message || 'Не удалось запустить VPN-ядро';
}
