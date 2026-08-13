import { contextBridge, ipcRenderer } from 'electron';
import type { ModuleLog, ModuleManifest, UpdateInfo, UserProfile } from './types';

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
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-fullscreen'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
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
});
