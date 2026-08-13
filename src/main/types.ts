export type ModuleStatus = 'running' | 'stopped' | 'error' | 'starting' | 'stopping';
export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'installed' | 'up-to-date' | 'unsupported' | 'error';

export interface ModuleManifest {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  executable: string;
  args: string[];
  status: ModuleStatus;
  category: string;
  icon: string;
  pid: number | null;
  log_file: string;
  working_dir?: string;
  launch_mode?: 'executable' | 'batch';
  strategy?: string;
  strategies?: Record<string, string>;
  error?: string;
  development?: boolean;
  worker_name?: string;
}

export interface ModuleLog {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'error' | 'warn';
  message: string;
}

export interface UpdateInfo {
  id: string;
  name: string;
  repo: string;
  source: 'GitHub';
  latestVersion: string | null;
  installedVersion: string | null;
  asset: string | null;
  status: UpdateStatus;
  executable?: string;
  sha256?: string;
  error?: string;
  downloadedBytes?: number;
  totalBytes?: number;
}

export interface UserProfile {
  displayName: string;
  deviceId: string;
  deviceName: string;
}

export interface AppSettings {
  autoStart: boolean;
  notifications: boolean;
  closeToTray: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoStart: false,
  notifications: true,
  closeToTray: true,
};
