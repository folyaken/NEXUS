import type { AppSettings, ModuleLog, ModuleManifest, UpdateInfo, UserProfile, VpnProfile, VpnRuntime } from '../main/types';

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
      getSettings(): Promise<AppSettings>;
      saveSettings(settings: AppSettings): Promise<AppSettings>;
      getLastScan(): Promise<string | null>;
      minimizeWindow(): Promise<void>;
      toggleFullscreen(): Promise<boolean>;
      isFullscreen(): Promise<boolean>;
      closeWindow(): Promise<void>;
      getVpn(): Promise<{ profiles: VpnProfile[]; runtime: VpnRuntime }>;
      importVpn(link: string, name?: string): Promise<VpnProfile[]>;
      refreshVpn(): Promise<number>;
      removeVpn(id: string): Promise<void>;
      connectVpn(id: string): Promise<VpnRuntime>;
      disconnectVpn(): Promise<VpnRuntime>;
      ensureVpnCore(): Promise<void>;
      pingVpn(): Promise<VpnProfile[]>;
      onModulesChanged(callback: (modules: ModuleManifest[]) => void): () => void;
      onLog(callback: (log: ModuleLog) => void): () => void;
      onUpdatesChanged(callback: (updates: UpdateInfo[]) => void): () => void;
      onFullscreen(callback: (value: boolean) => void): () => void;
      onScan(callback: (stamp: string) => void): () => void;
      onVpnChanged(callback: (snapshot: { profiles: VpnProfile[]; runtime: VpnRuntime }) => void): () => void;
    };
  }
}

export {};
