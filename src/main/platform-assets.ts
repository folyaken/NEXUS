import os from 'node:os';

export type WindowsAssetArchitecture = 'x64' | 'arm64' | 'ia32';

/**
 * Detect the native Windows architecture even when the x64 build of NEXUS is
 * running under Windows-on-ARM emulation.
 */
export function windowsAssetArchitecture(
  env: NodeJS.ProcessEnv = process.env,
  runtimeArch: string = os.arch(),
): WindowsAssetArchitecture {
  const native = `${env.PROCESSOR_ARCHITEW6432 || env.PROCESSOR_ARCHITECTURE || runtimeArch}`.toLowerCase();
  if (native.includes('arm64') || native.includes('aarch64')) return 'arm64';
  if (runtimeArch === 'ia32' && !native.includes('amd64') && !native.includes('x86_64')) return 'ia32';
  return 'x64';
}

export function tgWsProxyAssetCandidates(
  platform: NodeJS.Platform = process.platform,
  architecture: WindowsAssetArchitecture = windowsAssetArchitecture(),
): string[] {
  if (platform === 'win32') {
    if (architecture === 'arm64') return ['TgWsProxy_windows_arm64.exe'];
    if (architecture === 'ia32') return ['TgWsProxy_windows_7_32bit.exe'];
    // Upstream recommends the functionally identical compatibility build for
    // PyInstaller/_tkinter startup failures seen with the regular x64 asset.
    return ['TgWsProxy_windows_7_64bit.exe', 'TgWsProxy_windows.exe'];
  }
  if (platform === 'linux' && os.arch() === 'x64') return ['TgWsProxy_linux_amd64'];
  return [];
}

export function xrayAssetCandidates(
  platform: NodeJS.Platform = process.platform,
  architecture: WindowsAssetArchitecture = windowsAssetArchitecture(),
): string[] {
  if (platform === 'win32') {
    if (architecture === 'arm64') return ['Xray-windows-arm64-v8a.zip'];
    if (architecture === 'ia32') return ['Xray-windows-32.zip'];
    return ['Xray-windows-64.zip'];
  }
  if (platform === 'linux' && os.arch() === 'x64') return ['Xray-linux-64.zip'];
  return [];
}
