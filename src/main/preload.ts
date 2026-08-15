import { contextBridge, ipcRenderer } from 'electron';
import type { AboutSystemInfo, AppSettings, DpiExpertOptions, DpiHostlistResult, ModuleStatusReport, TgProxyOptions, ModuleLog, ModuleManifest, NexusUpdateCheck, UpdateInfo, UserProfile, VpnDiagnostics, VpnLatencySample, VpnProfile, VpnRuntime, VpnSplitApp } from './types';

contextBridge.exposeInMainWorld('nexus', {
  getModules: (): Promise<ModuleManifest[]> => ipcRenderer.invoke('modules:list'),
  reloadModules: (): Promise<ModuleManifest[]> => ipcRenderer.invoke('modules:reload'),
  startModule: (id: string): Promise<ModuleManifest> => ipcRenderer.invoke('modules:start', id),
  stopModule: (id: string): Promise<ModuleManifest> => ipcRenderer.invoke('modules:stop', id),
  setModuleStrategy: (id: string, strategy: string): Promise<ModuleManifest> => ipcRenderer.invoke('modules:set-strategy', id, strategy),
  setModuleExtraArgs: (id: string, options: DpiExpertOptions): Promise<ModuleManifest> => ipcRenderer.invoke('modules:set-extra-args', id, options),
  setTgProxyOptions: (id: string, options: TgProxyOptions): Promise<ModuleManifest> => ipcRenderer.invoke('modules:set-tg-options', id, options),
  checkModuleStatus: (id: string): Promise<ModuleStatusReport> => ipcRenderer.invoke('modules:check-status', id),
  refreshModuleStrategies: (id: string): Promise<ModuleManifest> => ipcRenderer.invoke('modules:refresh-strategies', id),
  getDpiHosts: (): Promise<string[]> => ipcRenderer.invoke('dpi:list-hosts'),
  addDpiHost: (host: string): Promise<DpiHostlistResult> => ipcRenderer.invoke('dpi:add-host', host),
  removeDpiHost: (host: string): Promise<DpiHostlistResult> => ipcRenderer.invoke('dpi:remove-host', host),
  getLogs: (id?: string): Promise<ModuleLog[]> => ipcRenderer.invoke('logs:list', id),
  getUpdates: (): Promise<UpdateInfo[]> => ipcRenderer.invoke('updates:list'),
  syncUpdates: (): Promise<UpdateInfo[]> => ipcRenderer.invoke('updates:sync'),
  getProfile: (): Promise<UserProfile> => ipcRenderer.invoke('profile:get'),
  saveProfile: (name: string): Promise<UserProfile> => ipcRenderer.invoke('profile:save', name),
  getAboutInfo: (): Promise<AboutSystemInfo> => ipcRenderer.invoke('about:get-info'),
  checkNexusUpdate: (): Promise<NexusUpdateCheck> => ipcRenderer.invoke('about:check-update'),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke('settings:save', settings),
  getLastScan: (): Promise<string | null> => ipcRenderer.invoke('runtime:last-scan'),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  getVpn: (): Promise<{ profiles: VpnProfile[]; runtime: VpnRuntime }> => ipcRenderer.invoke('vpn:list'),
  getVpnDiagnostics: (profileId?: string | null): Promise<VpnDiagnostics> => ipcRenderer.invoke('vpn:diagnostics', profileId ?? null),
  importVpn: (link: string, name?: string): Promise<VpnProfile[]> => ipcRenderer.invoke('vpn:import', link, name),
  refreshVpn: (url?: string): Promise<number> => ipcRenderer.invoke('vpn:refresh', url),
  removeVpn: (id: string): Promise<void> => ipcRenderer.invoke('vpn:remove', id),
  removeVpnSubscription: (url: string): Promise<void> => ipcRenderer.invoke('vpn:remove-subscription', url),
  pickVpnApps: (): Promise<VpnSplitApp[]> => ipcRenderer.invoke('vpn:pick-apps'),
  connectVpn: (id: string): Promise<VpnRuntime> => ipcRenderer.invoke('vpn:connect', id),
  disconnectVpn: (): Promise<VpnRuntime> => ipcRenderer.invoke('vpn:disconnect'),
  switchVpnMode: (mode: 'proxy' | 'tun'): Promise<VpnRuntime> => ipcRenderer.invoke('vpn:switch-mode', mode),
  ensureVpnCore: (): Promise<void> => ipcRenderer.invoke('vpn:ensure-core'),
  pingVpn: (): Promise<VpnProfile[]> => ipcRenderer.invoke('vpn:ping'),
  sampleVpnLatency: (): Promise<VpnLatencySample | null> => ipcRenderer.invoke('vpn:latency-sample'),
  onVpnChanged: (callback: (snapshot: { profiles: VpnProfile[]; runtime: VpnRuntime }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: { profiles: VpnProfile[]; runtime: VpnRuntime }) => callback(snapshot);
    ipcRenderer.on('vpn:changed', listener);
    return () => ipcRenderer.removeListener('vpn:changed', listener);
  },
  onModulesChanged: (callback: (modules: ModuleManifest[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, modules: ModuleManifest[]) => callback(modules);
    ipcRenderer.on('modules:changed', listener);
    return () => ipcRenderer.removeListener('modules:changed', listener);
  },
  onLog: (callback: (log: ModuleLog) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, log: ModuleLog) => callback(log);
    ipcRenderer.on('logs:append', listener);
    return () => ipcRenderer.removeListener('logs:append', listener);
  },
  onUpdatesChanged: (callback: (updates: UpdateInfo[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, updates: UpdateInfo[]) => callback(updates);
    ipcRenderer.on('updates:changed', listener);
    return () => ipcRenderer.removeListener('updates:changed', listener);
  },
  onMaximized: (callback: (value: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: boolean) => callback(value);
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  },
  onScan: (callback: (stamp: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, stamp: string) => callback(stamp);
    ipcRenderer.on('runtime:scan', listener);
    return () => ipcRenderer.removeListener('runtime:scan', listener);
  },
});
