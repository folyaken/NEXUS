import type { ModuleLog, ModuleManifest, UpdateInfo, UserProfile } from '../main/types';

declare global {
  interface Window {
    nexus?: {
      getModules(): Promise<ModuleManifest[]>;
      reloadModules(): Promise<ModuleManifest[]>;
      startModule(id: string): Promise<ModuleManifest>;
      stopModule(id: string): Promise<ModuleManifest>;
      setModuleStrategy(id: string, strategy: string): Promise<ModuleManifest>;
      getLogs(id?: string): Promise<ModuleLog[]>;
      getUpdates(): Promise<UpdateInfo[]>;
      syncUpdates(): Promise<UpdateInfo[]>;
      getProfile(): Promise<UserProfile>;
      saveProfile(name: string): Promise<UserProfile>;
      minimizeWindow(): Promise<void>;
      toggleFullscreen(): Promise<boolean>;
      closeWindow(): Promise<void>;
      onModulesChanged(callback: (modules: ModuleManifest[]) => void): () => void;
      onLog(callback: (log: ModuleLog) => void): () => void;
      onUpdatesChanged(callback: (updates: UpdateInfo[]) => void): () => void;
    };
  }
}

export {};
