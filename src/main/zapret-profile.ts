import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Разбор профиля обхода DPI.
 *
 * Профили Zapret — это .bat-файлы, которые собирают одну длинную команду
 * запуска winws.exe и переносят её на несколько строк символом `^`.
 *
 * Раньше NEXUS просто вызывал такой .bat через cmd.exe. Это оказалось
 * ненадёжным: интерпретатор Windows теряет перенос строки, если после `^`
 * остался пробел, если файл сохранён с переносами в стиле Unix или если
 * содержимое прошло через промежуточную обёртку. Команда рвалась пополам, и
 * вторая половина выполнялась как отдельная команда — пользователь видел
 * «'--filter-udp' is not recognized as an internal or external command», а
 * модуль падал с кодом 1.
 *
 * Поэтому строка запуска читается здесь и передаётся ядру напрямую, минуя
 * командный интерпретатор: список аргументов уходит в процесс массивом, где
 * переносы строк и пробелы уже не имеют значения.
 */

export interface ZapretLaunch {
  /** Полный путь до winws.exe. */
  executable: string;
  /** Готовые аргументы командной строки. */
  args: string[];
  /** Рабочий каталог процесса (папка bin релиза). */
  cwd: string;
}

export interface GameFilterPorts {
  tcp: string;
  udp: string;
}

/** Значение, которым Zapret обозначает выключенный игровой фильтр. */
const GAME_FILTER_DISABLED = '12';
const GAME_FILTER_RANGE = '1024-65535';

/**
 * Игровой фильтр включается отдельным файлом-флагом в самом релизе Zapret.
 * Профиль подставляет диапазон портов из переменных, поэтому их нужно
 * восстановить, иначе в строке запуска останется пустое место.
 */
export async function readGameFilter(releaseRoot: string): Promise<GameFilterPorts> {
  const flagFile = path.join(releaseRoot, 'utils', 'game_filter.enabled');
  let mode = '';
  try {
    mode = (await fs.readFile(flagFile, 'utf8')).split(/\r?\n/, 1)[0].trim().toLowerCase();
  } catch {
    return { tcp: GAME_FILTER_DISABLED, udp: GAME_FILTER_DISABLED };
  }
  if (mode === 'all') return { tcp: GAME_FILTER_RANGE, udp: GAME_FILTER_RANGE };
  if (mode === 'tcp') return { tcp: GAME_FILTER_RANGE, udp: GAME_FILTER_DISABLED };
  if (mode === 'udp') return { tcp: GAME_FILTER_DISABLED, udp: GAME_FILTER_RANGE };
  return { tcp: GAME_FILTER_DISABLED, udp: GAME_FILTER_DISABLED };
}

/**
 * Склеивает строки, разорванные символом продолжения `^`.
 *
 * Пробелы после каретки допускаются намеренно: именно на них спотыкался
 * командный интерпретатор, и повторять его ошибку здесь незачем.
 */
function joinContinuedLines(lines: string[], startIndex: number): string {
  const parts: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index].replace(/\s+$/, '');
    const continues = line.endsWith('^');
    parts.push(continues ? line.slice(0, -1) : line);
    if (!continues) break;
  }
  return parts.join(' ');
}

/** Собирает значения переменных, объявленных в профиле через `set`. */
function collectVariables(lines: string[], upToIndex: number, batDirectory: string): Map<string, string> {
  const variables = new Map<string, string>();
  const expandDir = (value: string): string => value.replace(/%~dp0/gi, `${batDirectory}${path.sep}`);
  for (let index = 0; index < upToIndex; index += 1) {
    const match = /^\s*set\s+"?([A-Za-z_][A-Za-z0-9_]*)=([^"\r\n]*)"?\s*$/i.exec(lines[index]);
    if (!match) continue;
    variables.set(match[1].toLowerCase(), expandDir(match[2]));
  }
  return variables;
}

/**
 * Разбивает строку на аргументы так же, как это сделал бы Windows: кавычки
 * группируют пробелы и в готовый аргумент не попадают.
 */
export function tokenizeCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quoted = false;
  for (const character of input) {
    if (character === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (!quoted && /\s/.test(character)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += character;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

export interface ParseOptions {
  /** Каталог, в котором лежит профиль: заменяет `%~dp0`. */
  batDirectory: string;
  /** Порты игрового фильтра, включаемого в самом Zapret. */
  gameFilter?: GameFilterPorts;
}

export interface ParsedProfile {
  /** Путь до winws.exe в том виде, в котором его записал профиль. */
  executable: string;
  args: string[];
}

/**
 * Извлекает из текста профиля команду запуска ядра.
 *
 * Возвращает `null`, если строку не удалось разобрать целиком: в этом случае
 * вызывающий код возвращается к прежнему способу запуска, а не подсовывает
 * ядру наполовину разобранные аргументы.
 */
export function parseZapretProfile(script: string, options: ParseOptions): ParsedProfile | null {
  const lines = script.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /winws\.exe/i.test(line) && !/^\s*(?:::|rem\b)/i.test(line));
  if (startIndex < 0) return null;

  const batDirectory = options.batDirectory.replace(/[\\/]+$/, '');
  const gameFilter = options.gameFilter ?? { tcp: GAME_FILTER_DISABLED, udp: GAME_FILTER_DISABLED };
  const variables = collectVariables(lines, startIndex, batDirectory);
  variables.set('gamefilter', GAME_FILTER_RANGE);
  variables.set('gamefiltertcp', gameFilter.tcp);
  variables.set('gamefilterudp', gameFilter.udp);

  const expand = (value: string): string => {
    let result = value.replace(/%~dp0/gi, `${batDirectory}${path.sep}`);
    for (let pass = 0; pass < 5 && result.includes('%'); pass += 1) {
      result = result.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name: string) => variables.get(name.toLowerCase()) ?? whole);
    }
    return result;
  };

  const command = joinContinuedLines(lines, startIndex);
  const tokens = tokenizeCommandLine(command);

  // Всё, что стоит до имени ядра, — это `start "заголовок" /min`: способ
  // запуска окна, к самому ядру отношения не имеющий.
  const executableIndex = tokens.findIndex((token) => /winws\.exe$/i.test(token));
  if (executableIndex < 0) return null;

  const executable = expand(tokens[executableIndex]);
  const args: string[] = [];
  for (const token of tokens.slice(executableIndex + 1)) {
    const value = expand(token);
    // Пустые значения появляются, когда профиль подставляет незаданную
    // переменную. Передавать их ядру нельзя: оно посчитает это ошибкой.
    if (!value) continue;
    // Неразобранная переменная означает, что профиль устроен сложнее, чем мы
    // понимаем. Безопаснее отказаться целиком.
    if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(value)) return null;
    args.push(value);
  }

  if (!args.length) return null;
  return { executable, args };
}

/**
 * Штатные пользовательские списки Zapret.
 *
 * Обычно их создаёт service.bat при первом запуске. NEXUS запускает ядро
 * напрямую, поэтому создаёт их сам: без этих файлов winws.exe завершится с
 * ошибкой «файл не найден», хотя пользователь ничего не нарушал.
 */
const USER_LIST_DEFAULTS: Record<string, string> = {
  'list-general-user.txt': '# Свои сайты добавляются в настройках NEXUS\r\ndomain.example.abc\r\n',
  'list-exclude-user.txt': 'domain.example.abc\r\n',
  'ipset-exclude-user.txt': '203.0.113.113/32\r\n',
};

export async function ensureZapretUserLists(releaseRoot: string): Promise<void> {
  const listsDirectory = path.join(releaseRoot, 'lists');
  await fs.mkdir(listsDirectory, { recursive: true }).catch(() => undefined);
  for (const [name, content] of Object.entries(USER_LIST_DEFAULTS)) {
    const target = path.join(listsDirectory, name);
    if (existsSync(target)) continue;
    await fs.writeFile(target, content, 'utf8').catch(() => undefined);
  }
}

/**
 * Готовит запуск ядра по выбранному профилю.
 *
 * Экспертные параметры дописываются в конец: Zapret применяет последнее
 * указанное значение, поэтому пользовательская настройка перекрывает то, что
 * задано в профиле, а не конфликтует с ним.
 */
export async function buildZapretLaunch(
  batchFile: string,
  releaseRoot: string,
  extraArgs: string[] = [],
): Promise<ZapretLaunch | null> {
  let script: string;
  try {
    script = await fs.readFile(batchFile, 'utf8');
  } catch {
    return null;
  }

  const parsed = parseZapretProfile(script, {
    batDirectory: path.dirname(batchFile),
    gameFilter: await readGameFilter(releaseRoot),
  });
  if (!parsed) return null;

  // Профиль записывает пути в стиле Windows. На других системах (прогон тестов,
  // разработка) разделитель другой, поэтому путь приводится к местному виду.
  const nativePath = path.sep === '\\' ? parsed.executable : parsed.executable.replace(/\\/g, path.sep);
  const executable = path.isAbsolute(nativePath)
    ? path.normalize(nativePath)
    : path.resolve(path.dirname(batchFile), nativePath);
  if (!existsSync(executable)) return null;

  return {
    executable,
    args: [...parsed.args, ...extraArgs],
    cwd: path.dirname(executable),
  };
}
