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
