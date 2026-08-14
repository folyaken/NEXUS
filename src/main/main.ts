import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, nativeImage, nativeTheme, Tray } from 'electron';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { ModuleManager } from './module-manager';
import { GithubUpdater } from './github-updater';
import { VpnManager } from './vpn-manager';
import { normalizeVpnSplitApps } from './split-tunnel';
import { DEFAULT_SETTINGS, type AppSettings, type ModuleLog, type UserProfile, type VpnSplitApp } from './types';

declare const __dirname: string;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let manager: ModuleManager;
let updater: GithubUpdater;
let vpn: VpnManager;
let settings: AppSettings = { ...DEFAULT_SETTINGS };
let trayHintShown = false;

function assetPath(name: string): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'assets', name) : path.join(app.getAppPath(), 'assets', name);
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function normalizeSettings(raw: Partial<AppSettings>): AppSettings {
  const vpnMode = raw.vpnMode === 'tun' ? 'tun' : 'proxy';
  const vpnSplitApps = normalizeVpnSplitApps(raw.vpnSplitApps);
  return {
    autoStart: Boolean(raw.autoStart),
    notifications: raw.notifications !== false,
    closeToTray: raw.closeToTray !== false,
    autoConnectVpn: Boolean(raw.autoConnectVpn),
    lastVpnProfileId: typeof raw.lastVpnProfileId === 'string' ? raw.lastVpnProfileId : null,
    vpnInboundPort: Number(raw.vpnInboundPort) > 0 ? Number(raw.vpnInboundPort) : 10808,
    vpnMode,
    vpnSplitTunnel: vpnMode === 'tun' && Boolean(raw.vpnSplitTunnel) && vpnSplitApps.length > 0,
    vpnSplitApps,
  };
}

async function readSettings(): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as Partial<AppSettings>;
    return normalizeSettings(raw);
  } catch {
    return { ...DEFAULT_SETTINGS, vpnSplitApps: [] };
  }
}

async function saveSettings(next: AppSettings): Promise<AppSettings> {
  settings = normalizeSettings(next ?? settings);
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return settings;
}

async function pickVpnApplications(): Promise<VpnSplitApp[]> {
  const options: Electron.OpenDialogOptions = {
    title: 'Выберите приложения для VPN',
    buttonLabel: 'Добавить',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Приложения Windows', extensions: ['exe'] }],
  };
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  return normalizeVpnSplitApps(result.filePaths.map((filePath) => ({ executable: '', path: filePath })));
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (mainWindow.isFullScreen()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function notify(title: string, body: string): void {
  if (!settings.notifications) return;
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}

function createTray(): void {
  if (tray) return;
  const iconPath = assetPath('nexus-tray.png');
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('NEXUS — Network Control Plane');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Показать NEXUS', click: showWindow },
    { label: 'Скрыть окно', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Выйти', click: () => { void quitApp(); } },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    center: true,
    frame: false,
    icon: assetPath('nexus-tray.png'),
    backgroundColor: '#090d16',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
  const useDevServer = !app.isPackaged && process.env.NEXUS_RENDERER_MODE !== 'dist';
  if (useDevServer) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
  }
  mainWindow.on('close', (event) => {
    if (!isQuitting && settings.closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
      if (!trayHintShown) {
        trayHintShown = true;
        notify('NEXUS свёрнут', 'Приложение продолжает работать в трее.');
      }
    }
  });
  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen', false);
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && mainWindow?.isFullScreen()) {
      event.preventDefault();
      mainWindow.setFullScreen(false);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function quitApp(): Promise<void> {
  if (isQuitting) return;
  isQuitting = true;
  try {
    await vpn?.disconnect();
    await manager?.stopAll({ persistEnabled: false });
  } catch {
    /* still quit */
  }
  tray?.destroy();
  tray = null;
  app.quit();
}

async function resolveModulesDir(): Promise<string> {
  const configured = process.env.NEXUS_MODULES_DIR;
  if (configured) return configured;
  if (!app.isPackaged) return path.join(process.cwd(), 'modules');

  const userModulesDir = path.join(app.getPath('userData'), 'modules');
  const bundledModulesDir = path.join(app.getAppPath(), 'modules');
  await fs.mkdir(userModulesDir, { recursive: true });

  if (existsSync(bundledModulesDir)) {
    const entries = await fs.readdir(bundledModulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.module.json')) continue;
      const destination = path.join(userModulesDir, entry.name);
      if (!existsSync(destination)) await fs.copyFile(path.join(bundledModulesDir, entry.name), destination);
    }
  }
  return userModulesDir;
}

function localDeviceId(): string {
  const signature = [
    os.platform(), os.arch(), os.hostname(), os.release(), os.cpus()[0]?.model ?? 'unknown', os.totalmem(),
  ].join('|');
  return `NX-${createHash('sha256').update(signature).digest('hex').slice(0, 12).toUpperCase()}`;
}

async function readProfile(): Promise<UserProfile> {
  const profilePath = path.join(app.getPath('userData'), 'profile.json');
  try {
    const profile = JSON.parse(await fs.readFile(profilePath, 'utf8')) as Partial<UserProfile>;
    return { displayName: profile.displayName?.trim() || '', deviceId: profile.deviceId || localDeviceId(), deviceName: profile.deviceName || os.hostname() };
  } catch {
    const profile = { displayName: '', deviceId: localDeviceId(), deviceName: os.hostname() };
    await fs.mkdir(path.dirname(profilePath), { recursive: true });
    await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
    return profile;
  }
}

async function saveProfile(displayName: string): Promise<UserProfile> {
  const current = await readProfile();
  const profile = { ...current, displayName: displayName.trim().slice(0, 32) };
  const profilePath = path.join(app.getPath('userData'), 'profile.json');
  await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  return profile;
}

function wireIpc(): void {
  ipcMain.handle('modules:list', () => manager.list());
  ipcMain.handle('modules:reload', () => manager.reload());
  ipcMain.handle('modules:start', (_event, id: string) => manager.start(id));
  ipcMain.handle('modules:stop', (_event, id: string) => manager.stop(id));
  ipcMain.handle('modules:set-strategy', (_event, id: string, strategy: string) => manager.setStrategy(id, strategy));
  ipcMain.handle('logs:list', (_event, id?: string) => manager.getLogs(id));
  ipcMain.handle('updates:list', () => updater.list());
  ipcMain.handle('updates:sync', () => updater.syncAll());
  ipcMain.handle('profile:get', () => readProfile());
  ipcMain.handle('profile:save', (_event, name: string) => saveProfile(typeof name === 'string' ? name : ''));
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:save', (_event, next: AppSettings) => saveSettings(next ?? settings));
  ipcMain.handle('vpn:list', () => vpn.snapshot());
  ipcMain.handle('vpn:import', (_event, link: string, name?: string) => vpn.importInput(String(link ?? ''), typeof name === 'string' ? name : undefined));
  ipcMain.handle('vpn:refresh', () => vpn.refreshSubscriptions());
  ipcMain.handle('vpn:remove', (_event, id: string) => vpn.remove(String(id ?? '')));
  ipcMain.handle('vpn:pick-apps', () => pickVpnApplications());
  ipcMain.handle('vpn:connect', async (_event, id: string) => {
    if (!vpn.hasXray()) {
      mainWindow?.webContents.send('logs:append', { id: 'jey2ray', level: 'info', message: 'Скачиваем Xray-core…', timestamp: new Date().toISOString() });
      await updater.ensure('jey2ray');
    }
    const splitApps = settings.vpnSplitTunnel ? settings.vpnSplitApps : [];
    const runtime = await vpn.connect(String(id ?? ''), settings.vpnInboundPort, settings.vpnMode, splitApps);
    await saveSettings({ ...settings, lastVpnProfileId: String(id ?? '') });
    return runtime;
  });
  ipcMain.handle('vpn:disconnect', () => vpn.disconnect());
  ipcMain.handle('vpn:ensure-core', () => updater.ensure('jey2ray'));
  ipcMain.handle('vpn:ping', () => vpn.pingAll());
  ipcMain.handle('runtime:last-scan', () => manager.getLastScanAt());
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggle-fullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });
  ipcMain.handle('window:is-fullscreen', () => Boolean(mainWindow?.isFullScreen()));
  ipcMain.handle('window:close', () => mainWindow?.close());

  manager.on('changed', (modules) => mainWindow?.webContents.send('modules:changed', modules));
  manager.on('log', (log: ModuleLog) => {
    mainWindow?.webContents.send('logs:append', log);
  });
  manager.on('state', (module: { name: string; status: string; error?: string }) => {
    if (module.status === 'error') notify(module.name, module.error || 'Модуль завершился с ошибкой');
  });
  manager.on('scan', (stamp: string) => mainWindow?.webContents.send('runtime:scan', stamp));
  updater.on('changed', (updates) => mainWindow?.webContents.send('updates:changed', updates));
  vpn.on('changed', (snapshot) => mainWindow?.webContents.send('vpn:changed', snapshot));
  vpn.on('log', (log: ModuleLog) => mainWindow?.webContents.send('logs:append', log));
}

if (gotLock) {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark';
    Menu.setApplicationMenu(null);
    settings = await readSettings();
    const modulesDir = await resolveModulesDir();
    manager = new ModuleManager(modulesDir);
    updater = new GithubUpdater(modulesDir, manager);
    vpn = new VpnManager(modulesDir);
    const profile = await readProfile();
    vpn.setHwid(profile.deviceId);
    wireIpc();
    await manager.init();
    await vpn.init(settings.lastVpnProfileId);
    createTray();
    createWindow();
    if (settings.autoStart) void manager.startEnabled();
    if (settings.autoConnectVpn && settings.lastVpnProfileId) {
      const splitApps = settings.vpnSplitTunnel ? settings.vpnSplitApps : [];
      void vpn.connect(settings.lastVpnProfileId, settings.vpnInboundPort, settings.vpnMode, splitApps).catch((error: Error) => {
        notify('Jey2Ray', error.message);
      });
    }
    void updater.syncAll();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('before-quit', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    void quitApp();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !settings.closeToTray) void quitApp();
  });
}
