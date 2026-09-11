import { DEFAULT_DPI_EXPERT_OPTIONS, type DpiExpertOptions } from './types';

/**
 * Экспертные параметры командной строки для Zapret.
 *
 * Аргументы попадают в дочерний процесс, поэтому строка от пользователя не
 * подставляется как есть: `spawn` вызывается без shell, но профиль запуска —
 * это .bat, и метасимволы вроде `&`, `|`, `>` в нём выполнились бы как команды.
 * Поэтому здесь разбор в массив токенов и жёсткая проверка каждого.
 */

const MAX_CUSTOM_LENGTH = 512;
const MAX_TOKENS = 32;
const MAX_TOKEN_LENGTH = 128;

/** Символы, опасные внутри пакетного файла Windows. */
const SHELL_METACHARACTERS = /[&|<>^"'`\r\n\t;$()%!*?]/;

/** Аргументы, которыми управляет само приложение — переопределять их нельзя. */
const RESERVED_PREFIXES = ['--hostlist', '--wf-tcp', '--wf-udp', '--daemon', '--pidfile', '--log'];

export class DpiArgumentError extends Error {}

function isSafeToken(token: string): boolean {
  if (!token || token.length > MAX_TOKEN_LENGTH) return false;
  if (SHELL_METACHARACTERS.test(token)) return false;
  // Каждый аргумент Zapret начинается с двойного дефиса.
  if (!token.startsWith('--')) return false;
  return /^--[a-z0-9][a-z0-9-]*(?:=[A-Za-z0-9_,.:+/@-]*)?$/i.test(token);
}

function assertNotReserved(token: string): void {
  const name = token.split('=', 1)[0].toLowerCase();
  if (RESERVED_PREFIXES.includes(name)) {
    throw new DpiArgumentError(`Параметр ${name} задаётся автоматически и не может быть изменён вручную`);
  }
}

/** Разбирает пользовательскую строку в отдельные аргументы. */
export function parseCustomDpiArguments(input: string): string[] {
  const raw = String(input ?? '').trim();
  if (!raw) return [];
  if (raw.length > MAX_CUSTOM_LENGTH) {
    throw new DpiArgumentError(`Строка параметров слишком длинная (максимум ${MAX_CUSTOM_LENGTH} символов)`);
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length > MAX_TOKENS) {
    throw new DpiArgumentError(`Слишком много параметров (максимум ${MAX_TOKENS})`);
  }

  for (const token of tokens) {
    if (!isSafeToken(token)) {
      throw new DpiArgumentError(`Параметр «${token}» записан неверно. Ожидается вид --параметр или --параметр=значение`);
    }
    assertNotReserved(token);
  }
  return tokens;
}

function parseBoundedNumber(value: unknown, label: string, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new DpiArgumentError(`${label}: введите целое число от ${min} до ${max}`);
  }
  return parsed;
}

export function normalizeDpiExpertOptions(input: unknown): DpiExpertOptions {
  const raw = (input ?? {}) as Partial<DpiExpertOptions>;
  return {
    hostcase: Boolean(raw.hostcase),
    hostdot: Boolean(raw.hostdot),
    wssize: parseBoundedNumber(raw.wssize, 'Размер фрагмента', 1, 65535),
    desyncRepeats: parseBoundedNumber(raw.desyncRepeats, 'Повторы', 1, 50),
    custom: typeof raw.custom === 'string' ? raw.custom.trim().slice(0, MAX_CUSTOM_LENGTH) : '',
  };
}

/** Собирает итоговый список аргументов; повторы отбрасываются по имени параметра. */
export function buildDpiExtraArgs(options: DpiExpertOptions): string[] {
  const normalized = normalizeDpiExpertOptions(options);
  const args: string[] = [];
  if (normalized.hostcase) args.push('--hostcase');
  if (normalized.hostdot) args.push('--hostdot');
  if (normalized.wssize !== null) args.push(`--wssize=${normalized.wssize}`);
  if (normalized.desyncRepeats !== null) args.push(`--dpi-desync-repeats=${normalized.desyncRepeats}`);
  args.push(...parseCustomDpiArguments(normalized.custom));

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const arg of args) {
    const name = arg.split('=', 1)[0].toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    unique.push(arg);
  }
  return unique;
}

/** Восстанавливает состояние формы из сохранённых аргументов манифеста. */
export function readDpiExpertOptions(extraArgs: string[] | undefined): DpiExpertOptions {
  const args = Array.isArray(extraArgs) ? extraArgs : [];
  const options: DpiExpertOptions = { ...DEFAULT_DPI_EXPERT_OPTIONS };
  const custom: string[] = [];

  for (const arg of args) {
    const [name, value] = arg.split('=', 2);
    switch (name.toLowerCase()) {
      case '--hostcase':
        options.hostcase = true;
        break;
      case '--hostdot':
        options.hostdot = true;
        break;
      case '--wssize':
        options.wssize = Number.isInteger(Number(value)) ? Number(value) : null;
        break;
      case '--dpi-desync-repeats':
        options.desyncRepeats = Number.isInteger(Number(value)) ? Number(value) : null;
        break;
      default:
        custom.push(arg);
    }
  }

  options.custom = custom.join(' ');
  return options;
}
