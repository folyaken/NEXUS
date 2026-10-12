import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Запуск программы вместе с Windows.
 *
 * Обычный способ — запись в разделе автозапуска реестра — для NEXUS не
 * работает. Программа объявлена как требующая прав администратора, а такие
 * приложения Windows из автозапуска **не запускает вовсе**: показать окно
 * запроса прав до входа в систему некому, поэтому система молча пропускает
 * запись. Со стороны это выглядит как «настройка включена, а программа не
 * стартует» — ровно то, что и наблюдалось.
 *
 * Рабочий путь один: задание в планировщике Windows с отметкой «выполнить с
 * наивысшими правами». Планировщик поднимает программу от имени администратора
 * без запроса подтверждения. Так поступают все программы, которым нужны права
 * и автозапуск одновременно.
 */

/** Имя задания в планировщике. Осмысленное: пользователь может увидеть его в списке. */
export const TASK_NAME = 'NEXUS Autostart';

/** Признак запуска планировщиком: по нему окно не показывается, программа уходит в трей. */
export const LAUNCH_AT_LOGIN_FLAG = '--launched-at-login';

/**
 * Сравнение версий вида «1.6.25» и технических сборок «1.6.29-beta.1»:
 * больше нуля — левая новее, меньше — правая.
 *
 * Проверки на равенство недостаточно: когда на канале оказывалась более
 * старая версия (например, релиз перекатывали), программа предлагала
 * «обновиться» вниз — на сломанную сборку. Обновление предлагается только
 * когда версия на канале строго новее установленной. Техническая сборка
 * всегда новее последнего релиза, но старее своего релиза: как только
 * «1.6.29» опубликован, бета «1.6.29-beta.1» получает предложение
 * обновиться на него.
 */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): { core: number[]; pre: string[] } => {
    const text = value.trim();
    const dash = text.indexOf('-');
    const core = (dash === -1 ? text : text.slice(0, dash)).split('.').map((part) => Number.parseInt(part, 10) || 0);
    const pre = dash === -1 ? [] : text.slice(dash + 1).split('.');
    return { core, pre };
  };
  const leftParsed = parse(left);
  const rightParsed = parse(right);
  const length = Math.max(leftParsed.core.length, rightParsed.core.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParsed.core[index] ?? 0) - (rightParsed.core[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  // Релиз новее своей беты: после публикации «1.6.29» техническая
  // «1.6.29-beta.1» обязана получить предложение обновиться.
  if (!leftParsed.pre.length !== !rightParsed.pre.length) return leftParsed.pre.length ? -1 : 1;
  for (let index = 0; index < Math.max(leftParsed.pre.length, rightParsed.pre.length); index += 1) {
    const leftPart = leftParsed.pre[index];
    const rightPart = rightParsed.pre[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumber = Number.parseInt(leftPart, 10);
    const rightNumber = Number.parseInt(rightPart, 10);
    const bothNumeric = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber);
    if (bothNumeric && leftNumber !== rightNumber) return leftNumber > rightNumber ? 1 : -1;
    if (!bothNumeric && leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

const COMMAND_TIMEOUT_MS = 15_000;

function schtasksPath(): string {
  const root = process.env.SystemRoot || process.env.windir;
  // Полный путь, а не короткое имя: у программы, запущенной от администратора,
  // переменная PATH может отличаться от пользовательской.
  return root ? `${root}\\System32\\schtasks.exe` : 'schtasks.exe';
}

/** Учётная запись, для которой создаётся задание. */
export function currentUserAccount(env: NodeJS.ProcessEnv = process.env): string {
  const name = env.USERNAME || os.userInfo().username;
  const domain = env.USERDOMAIN;
  return domain ? `${domain}\\${name}` : name;
}

/**
 * Строит аргументы создания задания.
 *
 * Вынесено отдельно, чтобы проверить состав команды тестом: ошибка в ключах
 * планировщика приводит к молчаливому отказу автозапуска, который иначе
 * обнаруживается только перезагрузкой компьютера.
 */
export function createTaskArguments(executablePath: string, account: string): string[] {
  return [
    '/Create',
    '/TN', TASK_NAME,
    // Путь берётся в кавычки: в «Program Files» есть пробел, без кавычек
    // планировщик обрежет команду на первом же из них.
    '/TR', `"${executablePath}" ${LAUNCH_AT_LOGIN_FLAG}`,
    '/SC', 'ONLOGON',
    '/RU', account,
    // Ключевая строка: без наивысших прав задание создастся, но программа
    // с запросом администратора снова не запустится.
    '/RL', 'HIGHEST',
    '/F',
  ];
}

export interface TaskRunner {
  (file: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

const defaultRunner: TaskRunner = (file, args) =>
  execFileAsync(file, args, { windowsHide: true, timeout: COMMAND_TIMEOUT_MS });

/** Есть ли задание автозапуска. */
export async function hasLoginTask(run: TaskRunner = defaultRunner): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    await run(schtasksPath(), ['/Query', '/TN', TASK_NAME]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Включает или выключает автозапуск.
 *
 * Возвращает понятную причину отказа либо null при успехе. Ошибку нельзя
 * проглатывать: пользователь включил переключатель и вправе узнать, что
 * настройка не применилась.
 */
export async function setLoginTask(
  enabled: boolean,
  executablePath: string,
  run: TaskRunner = defaultRunner,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (process.platform !== 'win32') return null;

  try {
    if (!enabled) {
      // Отсутствие задания — не ошибка: выключение уже выполнено.
      await run(schtasksPath(), ['/Delete', '/TN', TASK_NAME, '/F']).catch(() => undefined);
      return null;
    }
    await run(schtasksPath(), createTaskArguments(executablePath, currentUserAccount(env)));
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Access is denied|отказано в доступе/i.test(message)) {
      return 'Не удалось настроить автозапуск: недостаточно прав. Запустите NEXUS от имени администратора.';
    }
    if (/disabled|отключен/i.test(message)) {
      return 'Не удалось настроить автозапуск: планировщик заданий Windows отключён.';
    }
    return 'Не удалось настроить автозапуск Windows. Проверьте, не запрещает ли его политика безопасности.';
  }
}

/**
 * Убирает устаревшую запись из раздела автозапуска реестра.
 *
 * Прежние версии добавляли её штатными средствами, но для программы с правами
 * администратора она не работает. Оставлять её нельзя: пользователь увидит
 * NEXUS в списке автозагрузки диспетчера задач, а запускаться программа
 * по-прежнему не будет.
 */
export function legacyRunKeyCleanup(setLoginItemSettings: (options: { openAtLogin: boolean; path?: string }) => void, executablePath: string): void {
  try {
    setLoginItemSettings({ openAtLogin: false, path: executablePath });
  } catch {
    // Устаревшая запись не мешает работе: если убрать не вышло, продолжаем.
  }
}
