import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Определение прав администратора.
 *
 * Zapret работает через драйвер WinDivert, а TUN создаёт сетевой адаптер —
 * обеим задачам нужны повышенные права. Без проверки пользователь видел лишь
 * невнятный отказ запуска и не понимал, что делать.
 *
 * Установленное приложение запрашивает повышение через манифест exe, поэтому
 * в норме права уже есть. Проверка остаётся как страховка: у portable-сборки
 * манифест применяется не всегда, а запуск через `npm start` в среде разработки
 * идёт с обычными правами. Без неё пользователь получил бы невнятный отказ
 * драйвера вместо объяснения.
 */

/** Модули, которым права администратора обязательны. */
const ELEVATION_REQUIRED = new Set(['zapret']);

let cachedResult: boolean | null = null;

/**
 * Запущено ли приложение с правами администратора.
 *
 * Результат кешируется: права не меняются в течение жизни процесса, а запуск
 * внешней команды на каждый вызов заметно тормозил бы старт модулей.
 */
export async function isElevated(): Promise<boolean> {
  if (cachedResult !== null) return cachedResult;

  if (process.platform !== 'win32') {
    // На Linux/macOS повышение проверяется по эффективному пользователю.
    cachedResult = typeof process.getuid === 'function' ? process.getuid() === 0 : false;
    return cachedResult;
  }

  try {
    // `net session` доступна только администратору и не меняет состояние системы.
    await execFileAsync('net', ['session'], { windowsHide: true, timeout: 4_000 });
    cachedResult = true;
  } catch {
    cachedResult = false;
  }
  return cachedResult;
}

/** Только для тестов: сбрасывает кеш проверки. */
export function resetElevationCache(): void {
  cachedResult = null;
}

export function moduleNeedsElevation(id: string): boolean {
  return ELEVATION_REQUIRED.has(id);
}

/** Текст для пользователя: что произошло и что с этим делать. */
export function elevationMessage(moduleName: string): string {
  return `${moduleName} требует прав администратора: модуль изменяет сетевые настройки Windows. Запустите NEXUS через ярлык на рабочем столе — установленная версия запрашивает права автоматически.`;
}

export function tunElevationMessage(): string {
  return 'Режим TUN требует прав администратора: создаётся виртуальный сетевой адаптер. Запустите NEXUS через ярлык на рабочем столе или переключитесь на режим PROXY.';
}
