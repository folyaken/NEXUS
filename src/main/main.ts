import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, Tray } from 'electron';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { ModuleManager } from './module-manager';
import { GithubUpdater } from './github-updater';
import type { UserProfile } from './types';

declare const __dirname: string;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let manager: ModuleManager;
let updater: GithubUpdater;

function assetPath(name: string): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'assets', name) : path.join(app.getAppPath(), 'assets', name);
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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
    { label: 'Выйти', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    resizable: false,
    maximizable: false,
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
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
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
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:close', () => mainWindow?.close());

  manager.on('changed', (modules) => mainWindow?.webContents.send('modules:changed', modules));
  manager.on('log', (log) => mainWindow?.webContents.send('logs:append', log));
  updater.on('changed', (updates) => mainWindow?.webContents.send('updates:changed', updates));
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(null);
  const modulesDir = await resolveModulesDir();
  manager = new ModuleManager(modulesDir);
  updater = new GithubUpdater(modulesDir, manager);
  wireIpc();
  await manager.init();
  createTray();
  createWindow();
  // GitHub-only sync is non-blocking: the interface opens even when GitHub is unavailable.
  void updater.syncAll();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  tray?.destroy();
  tray = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
