import type { LanEndpoint } from './lan-share';

export type { LanEndpoint };

export type ModuleStatus = 'running' | 'stopped' | 'error' | 'starting' | 'stopping';
export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'installed' | 'up-to-date' | 'unsupported' | 'error';
export type VpnProtocol = 'vless' | 'vmess' | 'trojan' | 'shadowsocks' | 'hysteria2';
export type VpnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type VpnAppRoutingMode = 'system' | 'exclude' | 'include';

export interface ModuleHealthcheck {
  type: 'tcp';
  host: string;
  port: number;
  timeout_ms?: number;
}

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
  healthcheck?: ModuleHealthcheck;
  upstream_log_file?: string;
  installed_version?: string;
  /** Дополнительные аргументы командной строки, заданные пользователем. */
  extra_args?: string[];
}

/** Экспертные параметры Zapret, редактируемые в настройках модуля. */
export interface DpiExpertOptions {
  hostcase: boolean;
  hostdot: boolean;
  /** Размер фрагмента `--wssize`; null — параметр не передаётся. */
  wssize: number | null;
  /** Число повторов `--dpi-desync-repeats`; null — параметр не передаётся. */
  desyncRepeats: number | null;
  /** Произвольная строка аргументов, введённая вручную. */
  custom: string;
}

/** Ответ на изменение списка сайтов обхода DPI. */
export interface DpiHostlistResult {
  hosts: string[];
  /** Был ли перезапущен работающий модуль, чтобы список вступил в силу. */
  restarted: boolean;
}

/** Режим работы TG WS Proxy. */
export type TgProxyMode = 'telegram' | 'universal';

/** Основные параметры TG WS Proxy, редактируемые в настройках модуля. */
export interface TgProxyOptions {
  port: number;
  mode: TgProxyMode;
}

export const DEFAULT_TG_PROXY_OPTIONS: TgProxyOptions = {
  port: 8080,
  mode: 'telegram',
};

/** Результат проверки состояния модуля по кнопке «Проверить статус». */
export interface ModuleStatusReport {
  id: string;
  running: boolean;
  pid: number | null;
  host: string;
  port: number;
  portListening: boolean;
  checkedAt: string;
  summary: string;
}

export const DEFAULT_DPI_EXPERT_OPTIONS: DpiExpertOptions = {
  hostcase: false,
  hostdot: false,
  wssize: null,
  desyncRepeats: null,
  custom: '',
};

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

export interface AboutSystemInfo {
  nexusVersion: string;
  xrayVersion: string | null;
  singBoxVersion: string | null;
  hwid: string;
  computer: string;
}

export interface NexusUpdateCheck {
  status: 'placeholder';
  currentVersion: string;
  latestVersion: null;
  canInstall: false;
  checkedAt: string;
  message: string;
}

export interface VpnSplitApp {
  executable: string;
  path: string;
}

export interface AppSettings {
  language: 'ru';
  theme: 'dark';
  appearance: 'indigo' | 'graphite';
  autoStart: boolean;
  notifications: boolean;
  closeToTray: boolean;
  autoConnectVpn: boolean;
  vpnFragmentation: boolean;
  lastVpnProfileId: string | null;
  vpnInboundPort: number;
  /** Раздавать локальные SOCKS/HTTP-входы устройствам домашней сети. */
  vpnAllowLan: boolean;
  vpnMode: 'proxy' | 'tun';
  vpnAppRouting: VpnAppRoutingMode;
  /** Legacy mirror retained while settings created by patch 09 are migrated. */
  vpnSplitTunnel?: boolean;
  vpnSplitApps: VpnSplitApp[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ru',
  theme: 'dark',
  appearance: 'indigo',
  autoStart: false,
  notifications: true,
  closeToTray: true,
  autoConnectVpn: false,
  vpnFragmentation: true,
  lastVpnProfileId: null,
  vpnInboundPort: 10808,
  vpnAllowLan: false,
  vpnMode: 'proxy',
  vpnAppRouting: 'system',
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
  city?: string;
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
  connectedAt: string | null;
  pid: number | null;
  inboundPort: number;
  xrayReady: boolean;
  xrayVersion: string | null;
  error?: string;
  subscriptions?: VpnSubscriptionInfo[];
  /** Активна ли раздача входов в локальную сеть у текущего подключения. */
  lanShared?: boolean;
  /** Адреса «ip:порт», по которым доступен прокси с других устройств. */
  lanEndpoints?: LanEndpoint[];
}

export interface VpnLatencySample {
  pingMs: number;
  measuredAt: string;
}

export type VpnDiagnosticTone = 'ok' | 'warning' | 'error' | 'info';

export interface VpnDiagnosticCheck {
  id: string;
  title: string;
  tone: VpnDiagnosticTone;
  summary: string;
  detail: string | null;
}

export interface VpnDiagnosticEvent {
  timestamp: string;
  level: ModuleLog['level'];
  message: string;
}

export interface VpnDiagnostics {
  generatedAt: string;
  overall: Exclude<VpnDiagnosticTone, 'info'>;
  headline: string;
  runtimeStatus: VpnStatus;
  mode: 'proxy' | 'tun';
  engine: 'Xray-core' | 'sing-box';
  profileName: string | null;
  protocol: VpnProtocol | null;
  endpoint: string | null;
  localSocks: string;
  localHttp: string;
  checks: VpnDiagnosticCheck[];
  events: VpnDiagnosticEvent[];
  report: string;
}
