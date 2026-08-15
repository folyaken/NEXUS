import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Список приложений, которые сейчас открыты у пользователя.
 *
 * Выбирать программу файлом неудобно: нужно помнить, где она установлена, и
 * искать .exe среди системных папок. Гораздо привычнее выбрать её из списка
 * уже запущенных — так же, как это делают другие клиенты.
 *
 * Показываются только обычные программы пользователя: службы Windows и
 * фоновые процессы в списке не нужны — они лишь мешают найти нужное.
 */

export interface RunningApp {
  /** Имя файла: `chrome.exe`. */
  executable: string;
  /** Полный путь до файла. */
  path: string;
  /** Название, под которым программа известна пользователю. */
  title: string;
  /** Значок программы в виде data:image/png, если его удалось получить. */
  icon?: string;
}

const LIST_TIMEOUT_MS = 15_000;
const MAX_APPS = 200;

/**
 * Процессы, которые пользователю показывать бессмысленно.
 *
 * Это службы самой Windows и вспомогательные оболочки: они не «приложения», и
 * правила маршрутизации для них либо бесполезны, либо опасны — можно случайно
 * увести системный трафик в туннель.
 */
const SYSTEM_PROCESSES = new Set([
  'system', 'system idle process', 'registry', 'memory compression', 'smss.exe', 'csrss.exe',
  'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe', 'svchost.exe', 'fontdrvhost.exe',
  'dwm.exe', 'sihost.exe', 'taskhostw.exe', 'ctfmon.exe', 'conhost.exe', 'dllhost.exe',
  'runtimebroker.exe', 'searchhost.exe', 'searchindexer.exe', 'shellexperiencehost.exe',
  'startmenuexperiencehost.exe', 'applicationframehost.exe', 'systemsettings.exe',
  'textinputhost.exe', 'lockapp.exe', 'wudfhost.exe', 'spoolsv.exe', 'audiodg.exe',
  'backgroundtaskhost.exe', 'wmiprvse.exe', 'msmpeng.exe', 'securityhealthservice.exe',
  'securityhealthsystray.exe', 'nissrv.exe', 'sppsvc.exe', 'trustedinstaller.exe',
  'tiworker.exe', 'usocoreworker.exe', 'wsappx', 'smartscreen.exe', 'rundll32.exe',
  'explorer.exe',
]);

/**
 * Скрипт PowerShell, который собирает список программ.
 *
 * Берутся процессы с собственным окном — именно они и есть «приложения» с точки
 * зрения человека. Для каждого извлекается значок, чтобы список читался
 * взглядом, а не вычитывался по буквам.
 */
const LIST_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing | Out-Null
$result = New-Object System.Collections.ArrayList
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$processes = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path }
foreach ($process in $processes) {
  $path = $process.Path
  if (-not $path) { continue }
  $key = $path.ToLowerInvariant()
  if (-not $seen.Add($key)) { continue }
  $icon = ''
  try {
    $extracted = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
    if ($extracted) {
      $bitmap = $extracted.ToBitmap()
      $stream = New-Object System.IO.MemoryStream
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      $icon = [Convert]::ToBase64String($stream.ToArray())
      $stream.Dispose(); $bitmap.Dispose(); $extracted.Dispose()
    }
  } catch { }
  $title = ''
  try { $title = $process.MainModule.FileVersionInfo.FileDescription } catch { }
  if (-not $title) { $title = $process.ProcessName }
  [void]$result.Add([pscustomobject]@{
    executable = [System.IO.Path]::GetFileName($path)
    path = $path
    title = $title
    icon = $icon
  })
}
$result | ConvertTo-Json -Compress -Depth 3
`;

interface RawApp {
  executable?: unknown;
  path?: unknown;
  title?: unknown;
  icon?: unknown;
}

/** Значок не должен раздувать сообщение: крупные картинки отбрасываются. */
const MAX_ICON_CHARS = 64 * 1024;

function toRunningApp(raw: RawApp): RunningApp | null {
  const path = typeof raw.path === 'string' ? raw.path.trim() : '';
  const executable = typeof raw.executable === 'string' ? raw.executable.trim() : '';
  if (!path || !executable) return null;
  if (!/\.exe$/i.test(executable)) return null;
  // Управляющие символы в пути означают испорченные данные.
  if (/[\u0000-\u001f]/.test(path) || /[<>:"/\\|?*]/.test(executable)) return null;
  if (SYSTEM_PROCESSES.has(executable.toLowerCase())) return null;

  const rawTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
  const title = (rawTitle || executable.replace(/\.exe$/i, '')).slice(0, 96);
  const rawIcon = typeof raw.icon === 'string' ? raw.icon.trim() : '';
  const icon = rawIcon && rawIcon.length <= MAX_ICON_CHARS && /^[A-Za-z0-9+/=]+$/.test(rawIcon)
    ? `data:image/png;base64,${rawIcon}`
    : undefined;

  return { executable, path, title, icon };
}

/**
 * Возвращает открытые сейчас приложения.
 *
 * Пустой список — это не ошибка: на других системах или при отказе
 * PowerShell пользователю остаётся привычный выбор файлом.
 */
export async function listRunningApps(): Promise<RunningApp[]> {
  if (process.platform !== 'win32') return [];
  let stdout = '';
  try {
    const result = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', LIST_SCRIPT,
    ], { windowsHide: true, timeout: LIST_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
    stdout = result.stdout;
  } catch {
    return [];
  }

  const text = stdout.trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  // Единственный процесс возвращается объектом, а не списком.
  const rows: RawApp[] = Array.isArray(parsed) ? parsed as RawApp[] : [parsed as RawApp];
  const apps: RunningApp[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (apps.length >= MAX_APPS) break;
    const app = toRunningApp(row ?? {});
    if (!app) continue;
    const key = app.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    apps.push(app);
  }

  // По названию, как в проводнике: искать глазами так проще всего.
  return apps.sort((left, right) => left.title.localeCompare(right.title, 'ru'));
}
