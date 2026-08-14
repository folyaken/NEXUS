import type { VpnAppRoutingMode, VpnSplitApp } from './types';

const MAX_SPLIT_APPS = 64;
const MAX_PATH_LENGTH = 1024;
const MAX_EXECUTABLE_LENGTH = 255;

function executableFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function isAbsoluteFilePath(filePath: string): boolean {
  return /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(filePath);
}

export function normalizeVpnSplitApps(input: unknown): VpnSplitApp[] {
  if (!Array.isArray(input)) return [];
  const apps: VpnSplitApp[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    if (apps.length >= MAX_SPLIT_APPS) break;
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<VpnSplitApp>;
    const filePath = typeof candidate.path === 'string' ? candidate.path.trim() : '';
    if (!filePath || filePath.length > MAX_PATH_LENGTH || /[\u0000-\u001f]/.test(filePath) || !isAbsoluteFilePath(filePath)) continue;

    const executable = executableFromPath(filePath);
    if (!executable || executable.length > MAX_EXECUTABLE_LENGTH || !/\.exe$/i.test(executable) || /[<>:"/\\|?*]/.test(executable)) continue;

    const key = executable.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    apps.push({ executable, path: filePath });
  }

  return apps;
}

export function resolveVpnAppRouting(
  input: unknown,
  legacySplitTunnel: unknown,
  vpnMode: 'proxy' | 'tun',
  apps: VpnSplitApp[],
): VpnAppRoutingMode {
  if (vpnMode !== 'tun' || !normalizeVpnSplitApps(apps).length) return 'system';
  if (input === 'system' || input === 'exclude' || input === 'include') return input;
  return legacySplitTunnel ? 'include' : 'system';
}

export function xrayProcessSelectors(apps: VpnSplitApp[]): string[] {
  const selectors = new Set<string>();
  for (const app of normalizeVpnSplitApps(apps)) {
    selectors.add(app.executable.replace(/\.exe$/i, ''));
    selectors.add(app.path.replace(/\\/g, '/'));
  }
  return [...selectors];
}

export function singboxProcessNames(apps: VpnSplitApp[]): string[] {
  return normalizeVpnSplitApps(apps).map((app) => app.executable);
}

export function singboxProcessPaths(apps: VpnSplitApp[]): string[] {
  return normalizeVpnSplitApps(apps).map((app) => app.path);
}
