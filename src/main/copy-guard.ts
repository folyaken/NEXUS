import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Защита от параллельных копий программы.
 *
 * Electron разрешает работать нескольким копиям сразу, если у них разные
 * каталоги данных — так случилось у части пользователей: старая сборка,
 * забытая на другом диске, поднималась ярлыком или заданием автозапуска
 * параллельно установленной. Обе писали в свои наборы файлов, обе пытались
 * поднять одно и то же сетевое ядро — и падали с невнятными ошибками.
 *
 * Лекарство — при каждом старте закрывать копии, запущенные из другого
 * места. Процессы самой программы (интерфейс, GPU, звук) имеют тот же путь,
 * что и наш exe, поэтому они не задеваются: под подозрение попадает только
 * чужой путь. Находится это средствами PowerShell, потому что путь процесса
 * обычным tasklist не отдаётся.
 *
 * Защита работает только у установленной программы: в разработке параллельные
 * экземпляры — штатная часть работы, закрывать их нельзя.
 */

/** PowerShell-сценарий: пути всех NEXUS-процессов, кроме нашего, и их закрытие. */
export function guardScript(ourExecutablePath: string): string {
  // Одиночная кавычка в пути экранируется удвоением — правила PowerShell.
  const escaped = ourExecutablePath.replace(/'/g, "''");
  return [
    `$ours = '${escaped}'`,
    'Get-Process NEXUS -ErrorAction SilentlyContinue | ForEach-Object {',
    '  if ($_.Path -and $_.Path -ne $ours) {',
    '    $path = $_.Path',
    '    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue',
    '    Write-Output $path',
    '  }',
    '}',
  ].join('\n');
}

/** Разбор вывода сценария: по строке на закрытый путь. */
export function parseGuardOutput(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export type GuardRunner = (file: string, args: string[]) => Promise<{ stdout: string }>;

const defaultRunner: GuardRunner = (file, args) =>
  execFileAsync(file, args, { windowsHide: true, timeout: 20_000 });

/**
 * Закрывает копии из чужих папок, возвращает их пути.
 *
 * Отказ защиты не блокирует запуск: не удалось выполнить проверку — программа
 * работает как раньше, просто без страховки.
 */
export async function closeStaleCopies(ourExecutablePath: string, run: GuardRunner = defaultRunner): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', guardScript(ourExecutablePath),
    ]);
    return parseGuardOutput(stdout);
  } catch {
    return [];
  }
}
