export type ModuleStatus = 'running' | 'stopped' | 'error' | 'starting' | 'stopping';
export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'installed' | 'up-to-date' | 'unsupported' | 'error';
export type VpnProtocol = 'vless' | 'vmess' | 'trojan' | 'shadowsocks' | 'hysteria2';
export type VpnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

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

export interface VpnSplitApp {
  executable: string;
  path: string;
}

export interface AppSettings {
  autoStart: boolean;
  notifications: boolean;
  closeToTray: boolean;
  autoConnectVpn: boolean;
  lastVpnProfileId: string | null;
  vpnInboundPort: number;
  vpnMode: 'proxy' | 'tun';
  vpnSplitTunnel: boolean;
  vpnSplitApps: VpnSplitApp[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoStart: false,
  notifications: true,
  closeToTray: true,
  autoConnectVpn: false,
  lastVpnProfileId: null,
  vpnInboundPort: 10808,
  vpnMode: 'proxy',
  vpnSplitTunnel: false,
  vpnSplitApps: [],
};

export interface VpnLinkParams {
  protocol: VpnProtocol;
  address: string;
  port: number;
  uuid?: string;
  password?: string;
  method?: string;
  encryption?: string;
  flow?: string;
  alterId?: number;
  security?: string;
  network?: string;
  sni?: string;
  host?: string;
  path?: string;
  serviceName?: string;
  fingerprint?: string;
  publicKey?: string;
  shortId?: string;
  spiderX?: string;
  alpn?: string;
  allowInsecure?: boolean;
  type?: string;
  headerType?: string;
  obfs?: string;
}

export interface VpnSubscriptionInfo {
  url: string;
  title: string;
  supportUrl?: string;
  announce?: string;
  description?: string;
  expireAt?: string;
  upload?: number;
  download?: number;
  total?: number;
  updateHours?: number;
  lastSync?: string;
}

export interface VpnProfile {
  id: string;
  name: string;
  protocol: VpnProtocol;
  server: string;
  port: number;
  shareLink: string;
  subscriptionUrl?: string;
  kind?: 'node' | 'notice';
  country?: string;
  countryName?: string;
  flag?: string;
  stack?: string;
  isNew?: boolean;
  pingMs?: number | null;
  params: VpnLinkParams;
  createdAt: string;
}

export interface VpnRuntime {
  status: VpnStatus;
  activeProfileId: string | null;
  activeName: string | null;
  pid: number | null;
  inboundPort: number;
  xrayReady: boolean;
  xrayVersion: string | null;
  error?: string;
  subscriptions?: VpnSubscriptionInfo[];
}
