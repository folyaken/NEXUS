import type { AboutSystemInfo, AppSettings, DpiExpertOptions, DpiHostlistResult, ModuleStatusReport, TgProxyOptions, ModuleLog, ModuleManifest, NexusUpdateCheck, UpdateInfo, UserProfile, VpnDiagnostics, VpnLatencySample, VpnProfile, VpnRuntime, VpnSplitApp } from '../main/types';
import type { RunningApp } from '../main/running-apps';
import type { CommunityLink } from '../main/community';

declare global {
  /** Версия из package.json, подставляется на этапе сборки (см. vite.config.ts). */
  const __APP_VERSION__: string;

  interface Window {
    nexus?: {
      getModules(): Promise<ModuleManifest[]>;
      reloadModules(): Promise<ModuleManifest[]>;
      startModule(id: string): Promise<ModuleManifest>;
      stopModule(id: string): Promise<ModuleManifest>;
      setModuleStrategy(id: string, strategy: string): Promise<ModuleManifest>;
      setModuleExtraArgs(id: string, options: DpiExpertOptions): Promise<ModuleManifest>;
      setTgProxyOptions(id: string, options: TgProxyOptions): Promise<ModuleManifest>;
      checkModuleStatus(id: string): Promise<ModuleStatusReport>;
      refreshModuleStrategies(id: string): Promise<ModuleManifest>;
      isElevated(): Promise<boolean>;
      getDpiHosts(): Promise<string[]>;
      addDpiHost(host: string): Promise<DpiHostlistResult>;
      removeDpiHost(host: string): Promise<DpiHostlistResult>;
      getLogs(id?: string): Promise<ModuleLog[]>;
      getUpdates(): Promise<UpdateInfo[]>;
      syncUpdates(): Promise<UpdateInfo[]>;
      getProfile(): Promise<UserProfile>;
      saveProfile(name: string): Promise<UserProfile>;
      getAboutInfo(): Promise<AboutSystemInfo>;
      getCommunityLinks(): Promise<CommunityLink[]>;
      openCommunityLink(url: string): Promise<boolean>;
      checkNexusUpdate(): Promise<NexusUpdateCheck>;
      downloadNexusUpdate(): Promise<NexusUpdateCheck>;
      installNexusUpdate(): Promise<NexusUpdateCheck>;
      getNexusUpdateState(): Promise<NexusUpdateCheck>;
      onNexusUpdateChanged(callback: (state: NexusUpdateCheck) => void): () => void;
      getSettings(): Promise<AppSettings>;
      saveSettings(settings: AppSettings): Promise<AppSettings>;
      getLastScan(): Promise<string | null>;
      minimizeWindow(): Promise<void>;
      toggleMaximize(): Promise<boolean>;
      isMaximized(): Promise<boolean>;
      closeWindow(): Promise<void>;
      getVpn(): Promise<{ profiles: VpnProfile[]; runtime: VpnRuntime }>;
      getVpnDiagnostics(profileId?: string | null): Promise<VpnDiagnostics>;
      importVpn(link: string, name?: string): Promise<VpnProfile[]>;
      refreshVpn(url?: string): Promise<number>;
      removeVpn(id: string): Promise<void>;
      removeVpnSubscription(url: string): Promise<void>;
      pickVpnApps(): Promise<VpnSplitApp[]>;
      listRunningApps(): Promise<RunningApp[]>;
      connectVpn(id: string): Promise<VpnRuntime>;
      disconnectVpn(): Promise<VpnRuntime>;
      switchVpnMode(mode: 'proxy' | 'tun'): Promise<VpnRuntime>;
      ensureVpnCore(): Promise<void>;
      pingVpn(): Promise<VpnProfile[]>;
      sampleVpnLatency(): Promise<VpnLatencySample | null>;
      onModulesChanged(callback: (modules: ModuleManifest[]) => void): () => void;
      onLog(callback: (log: ModuleLog) => void): () => void;
      onUpdatesChanged(callback: (updates: UpdateInfo[]) => void): () => void;
      onMaximized(callback: (value: boolean) => void): () => void;
      onScan(callback: (stamp: string) => void): () => void;
      onVpnChanged(callback: (snapshot: { profiles: VpnProfile[]; runtime: VpnRuntime }) => void): () => void;
    };
  }
}

export {};
