import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, ModuleLog, ModuleManifest, UpdateInfo, UserProfile, VpnProfile, VpnRuntime } from './types';

contextBridge.exposeInMainWorld('nexus', {
  getModules: (): Promise<ModuleManifest[]> => ipcRenderer.invoke('modules:list'),
  reloadModules: (): Promise<ModuleManifest[]> => ipcRenderer.invoke('modules:reload'),
  startModule: (id: string): Promise<ModuleManifest> => ipcRenderer.invoke('modules:start', id),
  stopModule: (id: string): Promise<ModuleManifest> => ipcRenderer.invoke('modules:stop', id),
  setModuleStrategy: (id: string, strategy: string): Promise<ModuleManifest> => ipcRenderer.invoke('modules:set-strategy', id, strategy),
  getLogs: (id?: string): Promise<ModuleLog[]> => ipcRenderer.invoke('logs:list', id),
  getUpdates: (): Promise<UpdateInfo[]> => ipcRenderer.invoke('updates:list'),
  syncUpdates: (): Promise<UpdateInfo[]> => ipcRenderer.invoke('updates:sync'),
  getProfile: (): Promise<UserProfile> => ipcRenderer.invoke('profile:get'),
  saveProfile: (name: string): Promise<UserProfile> => ipcRenderer.invoke('profile:save', name),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke('settings:save', settings),
  getLastScan: (): Promise<string | null> => ipcRenderer.invoke('runtime:last-scan'),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-fullscreen'),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:is-fullscreen'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  getVpn: (): Promise<{ profiles: VpnProfile[]; runtime: VpnRuntime }> => ipcRenderer.invoke('vpn:list'),
  importVpn: (link: string, name?: string): Promise<VpnProfile[]> => ipcRenderer.invoke('vpn:import', link, name),
  refreshVpn: (): Promise<number> => ipcRenderer.invoke('vpn:refresh'),
  removeVpn: (id: string): Promise<void> => ipcRenderer.invoke('vpn:remove', id),
  connectVpn: (id: string): Promise<VpnRuntime> => ipcRenderer.invoke('vpn:connect', id),
  disconnectVpn: (): Promise<VpnRuntime> => ipcRenderer.invoke('vpn:disconnect'),
  ensureVpnCore: (): Promise<void> => ipcRenderer.invoke('vpn:ensure-core'),
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
  onFullscreen: (callback: (value: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: boolean) => callback(value);
    ipcRenderer.on('window:fullscreen', listener);
    return () => ipcRenderer.removeListener('window:fullscreen', listener);
  },
  onScan: (callback: (stamp: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, stamp: string) => callback(stamp);
    ipcRenderer.on('runtime:scan', listener);
    return () => ipcRenderer.removeListener('runtime:scan', listener);
  },
});
