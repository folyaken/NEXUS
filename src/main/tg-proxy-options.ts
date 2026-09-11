import { DEFAULT_TG_PROXY_OPTIONS, type ModuleManifest, type TgProxyMode, type TgProxyOptions } from './types';

/**
 * Основные параметры TG WS Proxy.
 *
 * Порт и режим работы передаются процессу аргументами командной строки и
 * дублируются в healthcheck: без этого проверка готовности продолжала бы
 * стучаться в старый порт и объявляла бы запуск неудачным.
 */

/** Порты ниже 1024 требуют прав администратора и заняты системными службами. */
const MIN_PORT = 1024;
const MAX_PORT = 65535;

export class TgProxyOptionError extends Error {}

export function normalizeTgProxyPort(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    throw new TgProxyOptionError(`Введите порт от ${MIN_PORT} до ${MAX_PORT}`);
  }
  return parsed;
}

export function normalizeTgProxyMode(value: unknown): TgProxyMode {
  return value === 'universal' ? 'universal' : 'telegram';
}

export function normalizeTgProxyOptions(input: unknown): TgProxyOptions {
  // Значение приходит из IPC, поэтому тип не гарантирован: пустая строка из поля
  // ввода означает «оставить порт по умолчанию».
  const raw = (input ?? {}) as Record<string, unknown>;
  const port = raw.port;
  return {
    port: port === undefined || port === null || port === ''
      ? DEFAULT_TG_PROXY_OPTIONS.port
      : normalizeTgProxyPort(port),
    mode: normalizeTgProxyMode(raw.mode),
  };
}

/**
 * Аргументы запуска для выбранных параметров.
 *
 * `--portable` сохраняется всегда: он держит конфигурацию рядом с исполняемым
 * файлом, иначе профиль уедет в AppData и переносимость сломается.
 */
export function buildTgProxyArgs(options: TgProxyOptions): string[] {
  const normalized = normalizeTgProxyOptions(options);
  const args = ['--portable', `--listen=127.0.0.1:${normalized.port}`];
  // В универсальном режиме прокси обслуживает любые запросы, а не только Telegram.
  if (normalized.mode === 'universal') args.push('--all-proxy');
  return args;
}

/** Восстанавливает состояние формы из сохранённого манифеста. */
export function readTgProxyOptions(module: Pick<ModuleManifest, 'args' | 'healthcheck'> | undefined): TgProxyOptions {
  const args = Array.isArray(module?.args) ? module.args : [];
  let port: number | null = null;

  for (const arg of args) {
    const match = /^--listen=(?:[^:]+:)?(\d{1,5})$/.exec(arg);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isInteger(parsed) && parsed >= MIN_PORT && parsed <= MAX_PORT) port = parsed;
    }
  }

  // Ранние сборки не писали --listen, но порт всегда отражён в healthcheck.
  if (port === null && module?.healthcheck?.port) {
    const fallback = Number(module.healthcheck.port);
    if (Number.isInteger(fallback) && fallback >= MIN_PORT && fallback <= MAX_PORT) port = fallback;
  }

  return {
    port: port ?? DEFAULT_TG_PROXY_OPTIONS.port,
    mode: args.includes('--all-proxy') ? 'universal' : 'telegram',
  };
}
