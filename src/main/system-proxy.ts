import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function setSystemProxy(host: string, port: number): Promise<void> {
  if (process.platform !== 'win32') return;
  const server = `${host}:${port}`;
  const script = `
$ErrorActionPreference = 'Stop'
$path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
Set-ItemProperty -Path $path -Name ProxyEnable -Value 1
Set-ItemProperty -Path $path -Name ProxyServer -Value '${server}'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinINetProxy {
  [DllImport("wininet.dll", SetLastError=true)]
  public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
}
"@
[WinINetProxy]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
[WinINetProxy]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null
`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 8000 });
}

export async function clearSystemProxy(): Promise<void> {
  if (process.platform !== 'win32') return;
  const script = `
$path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
Set-ItemProperty -Path $path -Name ProxyEnable -Value 0
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinINetProxy {
  [DllImport("wininet.dll", SetLastError=true)]
  public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
}
"@
[WinINetProxy]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
[WinINetProxy]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null
`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 8000 });
}

/**
 * Синхронный сброс системного прокси для аварийного завершения.
 *
 * При падении процесса цикл событий уже не выполнит асинхронную работу, поэтому
 * настройка снимается напрямую через реестр. Без этого Windows продолжит слать
 * трафик на локальный порт, которого больше нет, и пользователь останется без
 * интернета, не понимая причины.
 */
export function clearSystemProxySync(): void {
  if (process.platform !== 'win32') return;
  const registryPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  try {
    // reg.exe запускается быстрее PowerShell — на аварийном пути это важно.
    execFileSync('reg', ['add', registryPath, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'], {
      windowsHide: true,
      timeout: 3000,
      stdio: 'ignore',
    });
    // Уведомление системы: иначе прежние настройки продолжат действовать.
    execFileSync('rundll32.exe', ['wininet.dll,InternetSetOption', '0', '39', '0', '0'], {
      windowsHide: true,
      timeout: 3000,
      stdio: 'ignore',
    });
  } catch {
    /* аварийный путь: помешать завершению нельзя */
  }
}
