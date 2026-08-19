import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, nativeImage, nativeTheme, shell, Tray } from 'electron';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { isElevated, relaunchElevated } from './elevation';
import { companionCount } from './dpi-companions';
import { COMMUNITY_LINKS, TELEGRAM_CHANNEL, isAllowedCommunityUrl } from './community';
import { addDpiHost, readDpiHostlist, removeDpiHost } from './dpi-hostlist';
import { clearSystemProxySync } from './system-proxy';
import { ModuleManager } from './module-manager';
import { AppUpdater } from './app-updater';
import { GithubUpdater } from './github-updater';
import { VpnManager } from './vpn-manager';
import { normalizeVpnSplitApps, resolveVpnAppRouting } from './split-tunnel';
import { listRunningApps } from './running-apps';
import { LAUNCH_AT_LOGIN_FLAG, legacyRunKeyCleanup, setLoginTask } from './launch-at-login';
import { DEFAULT_SETTINGS, type AboutSystemInfo, type AppSettings, type ModuleLog, type NexusUpdateCheck, type UserProfile, type VpnSplitApp, type VpnStatus } from './types';

declare const __dirname: string;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/**
 * Кеш Chromium вынесен в отдельный подкаталог профиля.
 *
 * Zapret и TUN-режим требуют прав администратора, поэтому приложение регулярно
 * запускают то от админа, то обычным пользователем. Каталог кеша при этом
 * получает владельца-администратора, и следующий обычный запуск уже не может в
 * него писать: Chromium сыплет «Unable to move the cache … (0x5)» и
 * «Gpu Cache Creation failed». Собственный каталог позволяет пересоздать кеш при
 * отказе в доступе, не трогая настройки и профили пользователя.
 */
function prepareChromiumCache(): void {
  try {
    const cacheRoot = path.join(app.getPath('userData'), 'chromium-cache');
    mkdirSync(cacheRoot, { recursive: true });

    // Проверка записи: если каталог остался от запуска с другими правами,
    // пересоздаём его — иначе Chromium будет ругаться при каждом старте.
    const probe = path.join(cacheRoot, '.write-test');
    try {
      writeFileSync(probe, '');
      rmSync(probe, { force: true });
    } catch {
      rmSync(cacheRoot, { recursive: true, force: true });
      mkdirSync(cacheRoot, { recursive: true });
    }

    app.setPath('cache', cacheRoot);
    // sessionData намеренно не переносится: по умолчанию он указывает на
    // userData, и его смещение уводит localStorage, cookies и прочее состояние
    // сессии в новое место — пользователь видит это как сброс настроек.
    // Ошибки GPU-кеша идут из `cache`, поэтому достаточно перенести только его.
  } catch {
    // Кеш — это только ускорение отрисовки. Если подготовить его не удалось,
    // приложение обязано запуститься и работать без него.
  }
}

if (gotLock) prepareChromiumCache();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let manager: ModuleManager;
let updater: GithubUpdater;
let vpn: VpnManager;
let appUpdater: AppUpdater;
let settings: AppSettings = { ...DEFAULT_SETTINGS };
let trayHintShown = false;
let trayVpnStatus: VpnStatus = 'disconnected';
let trayAnimation: NodeJS.Timeout | null = null;
let trayFrameIndex = 0;
const trayFrameCache = new Map<string, Electron.NativeImage>();

const TRAY_FRAME_FILES = {
  disconnected: ['nexus-off.png'],
  connecting: Array.from({ length: 8 }, (_, index) => `nexus-connecting-${index}.png`),
  connected: Array.from({ length: 6 }, (_, index) => `nexus-connected-${index}.png`),
} as const;

function assetPath(name: string): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'assets', name) : path.join(app.getAppPath(), 'assets', name);
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function normalizeSettings(raw: Partial<AppSettings>): AppSettings {
  const vpnMode = raw.vpnMode === 'tun' ? 'tun' : 'proxy';
  const vpnSplitApps = normalizeVpnSplitApps(raw.vpnSplitApps);
  const vpnAppRouting = resolveVpnAppRouting(raw.vpnAppRouting, raw.vpnSplitTunnel, vpnMode, vpnSplitApps);
  return {
    language: raw.language === 'en' ? 'en' : 'ru',
    theme: 'dark',
    appearance: raw.appearance === 'graphite' ? 'graphite' : 'indigo',
    // Полное движение по умолчанию: у части пользователей Windows глобально
    // гасит анимации, и интерфейс выглядел сломанным, хотя работал верно.
    // Значение 'system' осталось от прежней настройки «как в Windows». Пункт
    // убран, но в сохранённых настройках оно ещё встречается — приводим его к
    // «включены», иначе у этих пользователей анимаций не будет, а переключателя
    // в таком положении в интерфейсе уже нет.
    motion: raw.motion === 'reduced' ? 'reduced' : 'full',
    launchAtLogin: Boolean(raw.launchAtLogin),
    autoStart: Boolean(raw.autoStart),
    notifications: raw.notifications !== false,
    closeToTray: raw.closeToTray !== false,
    autoConnectVpn: Boolean(raw.autoConnectVpn),
    vpnFragmentation: raw.vpnFragmentation !== false,
    lastVpnProfileId: typeof raw.lastVpnProfileId === 'string' ? raw.lastVpnProfileId : null,
    vpnInboundPort: Number(raw.vpnInboundPort) > 0 ? Number(raw.vpnInboundPort) : 10808,
    vpnAllowLan: Boolean(raw.vpnAllowLan),
    vpnMode,
    vpnAppRouting,
    vpnSplitTunnel: vpnAppRouting === 'include',
    vpnSplitApps,
  };
}

/**
 * Запись пользовательских данных без риска потерять их при сбое.
 *
 * Обычный `writeFile` сначала обнуляет файл и только потом пишет содержимое.
 * Если в этот момент процесс убивают (выход из приложения, перезагрузка,
 * антивирус), на диске остаётся пустой файл — и профиль с настройками пропадают.
 * Данные пишутся во временный файл и переименовываются: замена атомарна.
 */
async function writeJsonSafely(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  try {
    await fs.writeFile(temporary, payload, 'utf8');
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Чтение JSON с восстановлением повреждённого файла.
 *
 * Файл, оборванный прошлым сбоем, читается как пустой. Он сохраняется рядом с
 * пометкой `.broken`, чтобы данные можно было восстановить вручную, а не
 * затирались молча при первой же записи.
 */
async function readJsonSafely<T>(filePath: string): Promise<Partial<T> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Partial<T> : null;
  } catch {
    await fs.copyFile(filePath, `${filePath}.broken`).catch(() => undefined);
    return null;
  }
}

async function readSettings(): Promise<AppSettings> {
  const raw = await readJsonSafely<AppSettings>(settingsPath());
  if (!raw) return { ...DEFAULT_SETTINGS, vpnSplitApps: [] };
  return normalizeSettings(raw);
}

async function saveSettings(next: AppSettings): Promise<AppSettings> {
  settings = normalizeSettings(next ?? settings);
  await writeJsonSafely(settingsPath(), settings);
  applyLaunchAtLogin(settings.launchAtLogin);
  if (tray && !tray.isDestroyed()) refreshTrayMenu(trayVpnStatus);
  return settings;
}

/**
 * Запуск вместе с Windows.
 *
 * Выполняется через планировщик заданий, а не через раздел автозапуска реестра.
 * Причина: NEXUS требует прав администратора, а такие программы Windows из
 * автозапуска не запускает вовсе — запросить подтверждение до входа в систему
 * не у кого, и запись молча игнорируется. Пользователь при этом видит
 * включённый переключатель и не запускающуюся программу.
 *
 * В среде разработки настройка не применяется: иначе в автозапуск попала бы
 * временная сборка вместо установленной программы.
 *
 * Приложение открывается свёрнутым в трей: показывать окно при каждом входе в
 * систему навязчиво, а модули и VPN поднимаются в фоне.
 */
function applyLaunchAtLogin(enabled: boolean): void {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  // Прежние версии писали в реестр. Запись не работает, но остаётся видна в
  // списке автозагрузки — убираем, чтобы не вводить в заблуждение.
  legacyRunKeyCleanup((options) => app.setLoginItemSettings(options), process.execPath);
  void setLoginTask(enabled, process.execPath).then((problem) => {
    if (problem) notify('NEXUS', problem);
  });
}

function startedByWindowsLogin(): boolean {
  return process.argv.includes(LAUNCH_AT_LOGIN_FLAG);
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
  mainWindow.show();
  mainWindow.focus();
}

function notify(title: string, body: string): void {
  if (!settings.notifications) return;
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}

function stopTrayAnimation(): void {
  if (trayAnimation) clearInterval(trayAnimation);
  trayAnimation = null;
  trayFrameIndex = 0;
}

function loadTrayFrame(fileName: string): Electron.NativeImage {
  const cached = trayFrameCache.get(fileName);
  if (cached) return cached;

  const framePath = assetPath(path.join('tray', fileName));
  if (existsSync(framePath)) {
    const frame = nativeImage.createFromPath(framePath);
    if (!frame.isEmpty()) {
      const resized = frame.resize({ width: 16, height: 16 });
      trayFrameCache.set(fileName, resized);
      return resized;
    }
  }
  const fallbackPath = assetPath('nexus-tray.png');
  const fallback = existsSync(fallbackPath)
    ? nativeImage.createFromPath(fallbackPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();
  trayFrameCache.set(fileName, fallback);
  return fallback;
}

function trayStatusCopy(status: VpnStatus): { label: string; tooltip: string } {
  if (status === 'connecting') return { label: 'VPN: подключение…', tooltip: 'NEXUS — VPN подключается…' };
  if (status === 'connected') return { label: 'VPN: подключён', tooltip: 'NEXUS — VPN подключён' };
  if (status === 'error') return { label: 'VPN: ошибка подключения', tooltip: 'NEXUS — ошибка VPN' };
  return { label: 'VPN: отключён', tooltip: 'NEXUS — VPN отключён' };
}

function trayMenuLabel(value: string, fallback: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/&/g, '＋').replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 48 ? `${normalized.slice(0, 45)}…` : normalized;
}

async function connectVpnProfile(
  profileId: string,
  mode: 'proxy' | 'tun' = settings.vpnMode,
  continuedSessionAt: string | null = null,
): Promise<ReturnType<VpnManager['runtime']>> {
  if (manager?.isUpdating('jey2ray')) throw new Error('Дождитесь завершения обновления Xray-core');
  if (!vpn.hasXray()) {
    mainWindow?.webContents.send('logs:append', { id: 'jey2ray', level: 'info', message: 'Скачиваем Xray-core…', timestamp: new Date().toISOString() });
    await updater.ensure('jey2ray');
  }
  const splitApps = settings.vpnAppRouting === 'system' ? [] : settings.vpnSplitApps;
  const runtime = await vpn.connect(
    profileId,
    settings.vpnInboundPort,
    mode,
    splitApps,
    settings.vpnAppRouting,
    continuedSessionAt,
    settings.vpnFragmentation,
    settings.vpnAllowLan,
  );
  await saveSettings({ ...settings, lastVpnProfileId: profileId });
  return runtime;
}

function runTrayAction(action: () => Promise<unknown>): void {
  void action().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Не удалось выполнить команду из трея';
    mainWindow?.webContents.send('logs:append', { id: 'jey2ray', level: 'error', message, timestamp: new Date().toISOString() });
    notify('NEXUS', message);
    refreshTrayMenu(vpn.runtime().status);
  });
}

async function selectTrayProfile(profileId: string): Promise<void> {
  const current = vpn.runtime();
  if (current.status === 'connecting') throw new Error('Дождитесь завершения текущего подключения');
  await saveSettings({ ...settings, lastVpnProfileId: profileId });
  if (current.status === 'connected') {
    await connectVpnProfile(profileId, settings.vpnMode, current.connectedAt);
  } else {
    refreshTrayMenu(current.status);
    notify('NEXUS', 'Сервер выбран');
  }
}

async function setTrayVpnMode(mode: 'proxy' | 'tun'): Promise<void> {
  const current = vpn.runtime();
  if (current.status === 'connecting') throw new Error('Дождитесь завершения текущего подключения');
  await saveSettings({
    ...settings,
    vpnMode: mode,
    vpnSplitTunnel: mode === 'tun' && settings.vpnAppRouting === 'include',
  });
  if (current.status === 'connected' && current.activeProfileId) {
    await connectVpnProfile(current.activeProfileId, mode, current.connectedAt);
  } else {
    refreshTrayMenu(current.status);
  }
}

async function setTrayLanSharing(enabled: boolean): Promise<void> {
  const current = vpn.runtime();
  if (current.status === 'connecting') throw new Error('Дождитесь завершения текущего подключения');
  await saveSettings({ ...settings, vpnAllowLan: enabled });
  if (current.status === 'connected' && current.activeProfileId) {
    await connectVpnProfile(current.activeProfileId, settings.vpnMode, current.connectedAt);
    const endpoints = vpn.runtime().lanEndpoints ?? [];
    notify('NEXUS', enabled
      ? (endpoints.length ? `Раздача включена · ${endpoints[0].socks}` : 'Раздача включена')
      : 'Раздача в локальную сеть выключена');
  } else {
    refreshTrayMenu(current.status);
    notify('NEXUS', enabled ? 'Раздача включится при подключении' : 'Раздача в локальную сеть выключена');
  }
}

async function setTrayRouting(appRouting: 'system' | 'include' | 'exclude'): Promise<void> {
  const current = vpn.runtime();
  if (current.status === 'connecting') throw new Error('Дождитесь завершения текущего подключения');
  const nextMode = appRouting === 'system' ? settings.vpnMode : 'tun';
  await saveSettings({
    ...settings,
    vpnMode: nextMode,
    vpnAppRouting: appRouting,
    vpnSplitTunnel: appRouting === 'include',
  });
  if (current.status === 'connected' && current.activeProfileId) {
    await connectVpnProfile(current.activeProfileId, nextMode, current.connectedAt);
  } else {
    refreshTrayMenu(current.status);
  }
}

async function importVpnFromClipboard(): Promise<void> {
  const input = clipboard.readText().trim();
  if (!input) throw new Error('Буфер обмена пуст');
  const imported = await vpn.importInput(input);
  if (!imported.length) throw new Error('В буфере нет поддерживаемой VPN-ссылки');
  await saveSettings({ ...settings, lastVpnProfileId: imported[0].id });
  refreshTrayMenu(vpn.runtime().status);
  notify('NEXUS', `Импортировано серверов: ${imported.length}`);
}

function refreshTrayMenu(status: VpnStatus): void {
  if (!tray || tray.isDestroyed() || !vpn) return;
  const copy = trayStatusCopy(status);
  const snapshot = vpn.snapshot();
  const profiles = snapshot.profiles.filter((profile) => profile.kind !== 'notice');
  const selected = profiles.find((profile) => profile.id === snapshot.runtime.activeProfileId)
    ?? profiles.find((profile) => profile.id === settings.lastVpnProfileId)
    ?? profiles[0]
    ?? null;
  const canChangeConnection = status !== 'connecting';
  const isRunning = status === 'connected';
  const hasSplitApps = settings.vpnSplitApps.length > 0;
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: copy.label, enabled: false },
    { label: `Выбрано: ${trayMenuLabel(selected?.name ?? '', 'сервер не выбран')}`, enabled: false },
    { type: 'separator' },
    {
      label: status === 'connecting' ? 'VPN подключается…' : status === 'connected' ? 'Отключить VPN' : 'Подключить VPN',
      enabled: status !== 'connecting' && (isRunning || Boolean(selected)),
      click: () => runTrayAction(async () => {
        if (isRunning) await vpn.disconnect();
        else if (selected) await connectVpnProfile(selected.id);
      }),
    },
    {
      label: 'Сменить сервер',
      enabled: profiles.length > 0 && canChangeConnection,
      submenu: profiles.length
        ? profiles.map((profile) => ({
          label: trayMenuLabel(profile.name, 'Сервер'),
          type: 'radio' as const,
          checked: profile.id === selected?.id,
          click: () => runTrayAction(() => selectTrayProfile(profile.id)),
        }))
        : [{ label: 'Нет импортированных серверов', enabled: false }],
    },
    { type: 'separator' },
    {
      label: `Транспорт · ${settings.vpnMode.toUpperCase()}`,
      enabled: canChangeConnection,
      submenu: [
        { label: 'PROXY', type: 'radio', checked: settings.vpnMode === 'proxy', click: () => runTrayAction(() => setTrayVpnMode('proxy')) },
        { label: 'TUN', type: 'radio', checked: settings.vpnMode === 'tun', click: () => runTrayAction(() => setTrayVpnMode('tun')) },
      ],
    },
    {
      label: 'Раздавать в локальную сеть',
      type: 'checkbox',
      checked: settings.vpnAllowLan,
      enabled: canChangeConnection,
      click: () => runTrayAction(() => setTrayLanSharing(!settings.vpnAllowLan)),
    },
    { label: 'Импортировать из буфера', click: () => runTrayAction(importVpnFromClipboard) },
    {
      label: 'Маршрутизация',
      enabled: canChangeConnection,
      submenu: [
        { label: 'Весь трафик через VPN', type: 'radio', checked: settings.vpnAppRouting === 'system', click: () => runTrayAction(() => setTrayRouting('system')) },
        { label: 'VPN только для выбранных приложений', type: 'radio', enabled: hasSplitApps, checked: settings.vpnAppRouting === 'include', click: () => runTrayAction(() => setTrayRouting('include')) },
        { label: 'Напрямую для выбранных приложений', type: 'radio', enabled: hasSplitApps, checked: settings.vpnAppRouting === 'exclude', click: () => runTrayAction(() => setTrayRouting('exclude')) },
        ...(!hasSplitApps ? [{ type: 'separator' as const }, { label: 'Список приложений настраивается в Jey2Ray', enabled: false }] : []),
      ],
    },
    { type: 'separator' },
    { label: 'Показать окно NEXUS', click: showWindow },
    { label: 'Скрыть окно', click: () => mainWindow?.hide() },
    // Канал в трее: о выходе новой версии люди узнают там, а из свёрнутой
    // программы до раздела «О программе» ещё нужно дойти.
    { label: 'Новости и обновления в Telegram', click: () => { void shell.openExternal(TELEGRAM_CHANNEL); } },
    { type: 'separator' },
    { label: 'Выход', click: () => { void quitApp(); } },
  ];
  tray.setToolTip(`${copy.tooltip}${selected ? ` · ${trayMenuLabel(selected.name, 'Сервер')}` : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function setTrayVpnStatus(status: VpnStatus): void {
  trayVpnStatus = status;
  stopTrayAnimation();
  if (!tray || tray.isDestroyed()) return;

  const visualState = status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected';
  const frames = TRAY_FRAME_FILES[visualState];
  const renderFrame = () => {
    if (!tray || tray.isDestroyed()) return;
    tray.setImage(loadTrayFrame(frames[trayFrameIndex % frames.length]));
    trayFrameIndex = (trayFrameIndex + 1) % frames.length;
  };

  renderFrame();
  refreshTrayMenu(status);
  if (frames.length > 1) {
    trayAnimation = setInterval(renderFrame, visualState === 'connecting' ? 150 : 420);
    trayAnimation.unref();
  }
}

function createTray(): void {
  if (tray) return;
  tray = new Tray(loadTrayFrame(TRAY_FRAME_FILES.disconnected[0]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  setTrayVpnStatus(trayVpnStatus);
}

function createWindow(): void {
  // При входе в Windows окно не показывается: программа уходит в трей и молча
  // поднимает модули. Всплывающее окно на каждом включении компьютера мешало бы.
  const startHidden = startedByWindowsLogin();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    center: true,
    show: !startHidden,
    frame: false,
    icon: assetPath('nexus-app.png'),
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
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized', false);
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
  stopTrayAnimation();
  tray?.destroy();
  tray = null;
  app.quit();
}

/**
 * Снимает системный прокси при аварийном завершении.
 *
 * В режиме PROXY приложение прописывает себя в настройки Windows. Штатный выход
 * это откатывает, но при падении процесса или закрытии из диспетчера задач
 * настройка остаётся: система продолжает слать трафик на локальный порт,
 * которого уже нет, и пользователь теряет интернет без видимой причины.
 *
 * Обработчики намеренно синхронные — на этом этапе цикл событий уже может не
 * успеть выполнить асинхронную работу.
 */
function registerEmergencyCleanup(): void {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      clearSystemProxySync();
    } catch {
      /* аварийный путь: помешать выходу нельзя */
    }
  };

  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      cleanup();
      process.exit(0);
    });
  }
  process.on('uncaughtException', (error) => {
    cleanup();
    // Ошибку нельзя проглатывать: без записи в журнал причина падения потеряется.
    console.error('Необработанная ошибка:', error);
    process.exit(1);
  });
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

  await adoptBundledBinaries(userModulesDir);
  return userModulesDir;
}

/**
 * Переносит вложенные в установщик ядра в рабочий каталог модулей.
 *
 * Бинарники лежат в `resources/modules/bin` — вне asar, иначе операционная
 * система не смогла бы их запустить. Но модули работают из `userData`, и без
 * копирования приложение считало бы, что ядро не установлено, и качало бы его
 * заново при первом же запуске — при том что файл уже есть на диске.
 *
 * Копируются только отсутствующие файлы: скачанное обновление новее вложенного
 * в установщик и не должно откатываться при каждом старте.
 */
async function adoptBundledBinaries(userModulesDir: string): Promise<void> {
  const bundledBinDir = path.join(process.resourcesPath, 'modules', 'bin');
  if (!existsSync(bundledBinDir)) return;

  const userBinDir = path.join(userModulesDir, 'bin');
  try {
    await fs.mkdir(userBinDir, { recursive: true });
    await fs.cp(bundledBinDir, userBinDir, {
      recursive: true,
      force: false,          // существующие (обновлённые) файлы не трогаем
      errorOnExist: false,
    });
  } catch {
    // Ядро останется доступным по запасному пути в resources, а при неудаче
    // будет скачано штатным механизмом обновления. Запуск блокировать нельзя.
  }
}

function localDeviceId(): string {
  const signature = [
    os.platform(), os.arch(), os.hostname(), os.release(), os.cpus()[0]?.model ?? 'unknown', os.totalmem(),
  ].join('|');
  return `NX-${createHash('sha256').update(signature).digest('hex').slice(0, 12).toUpperCase()}`;
}

function profilePath(): string {
  return path.join(app.getPath('userData'), 'profile.json');
}

async function readProfile(): Promise<UserProfile> {
  const stored = await readJsonSafely<UserProfile>(profilePath());
  if (stored) {
    return {
      displayName: stored.displayName?.trim() || '',
      deviceId: stored.deviceId || localDeviceId(),
      deviceName: stored.deviceName || os.hostname(),
    };
  }
  // Профиль создаётся только когда его действительно нет: раньше любая ошибка
  // чтения (файл занят антивирусом, том ещё не готов) молча перезаписывала файл
  // пустым, и введённое имя пропадало.
  const profile = { displayName: '', deviceId: localDeviceId(), deviceName: os.hostname() };
  if (!existsSync(profilePath())) await writeJsonSafely(profilePath(), profile).catch(() => undefined);
  return profile;
}

async function saveProfile(displayName: string): Promise<UserProfile> {
  const current = await readProfile();
  const profile = { ...current, displayName: displayName.trim().slice(0, 32) };
  await writeJsonSafely(profilePath(), profile);
  return profile;
}

function coreVersion(executable: string, product: 'xray' | 'sing-box'): Promise<string | null> {
  if (!existsSync(executable)) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(executable, ['version'], {
      encoding: 'utf8',
      timeout: 2_500,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    }, (_error, stdout, stderr) => {
      const output = `${stdout || ''}\n${stderr || ''}`.trim().slice(0, 8_192);
      const productPattern = product === 'xray'
        ? /\bXray\s+v?([0-9][0-9A-Za-z.+-]*)/i
        : /\bsing-box(?:\s+version)?\s+v?([0-9][0-9A-Za-z.+-]*)/i;
      const version = output.match(productPattern)?.[1]
        ?? output.match(/\bv?([0-9]+(?:\.[0-9A-Za-z+-]+){1,3})\b/)?.[1]
        ?? null;
      resolve(version);
    });
  });
}

function operatingSystemName(): string {
  if (process.platform === 'win32') return `Windows ${os.release()}`;
  if (process.platform === 'darwin') return `macOS ${os.release()}`;
  return `${os.type()} ${os.release()}`;
}

async function aboutSystemInfo(): Promise<AboutSystemInfo> {
  const profile = await readProfile();
  const [xrayVersion, singBoxVersion] = await Promise.all([
    coreVersion(vpn.xrayPath(), 'xray'),
    coreVersion(vpn.singboxPath(), 'sing-box'),
  ]);
  return {
    nexusVersion: app.getVersion(),
    xrayVersion,
    singBoxVersion,
    hwid: profile.deviceId,
    computer: `${operatingSystemName()} · ${os.hostname()} · ${os.arch()}`,
  };
}

/**
 * Останавливает всё запущенное перед перезапуском на обновление.
 *
 * Без этого после установки в системе остались бы работающие модули и
 * изменённый системный прокси — пользователь остался бы без интернета.
 */
async function prepareForUpdateRestart(): Promise<void> {
  isQuitting = true;
  try {
    await vpn?.disconnect();
    await manager?.stopAll({ persistEnabled: true });
  } finally {
    stopTrayAnimation();
    tray?.destroy();
    tray = null;
  }
}

function wireIpc(): void {
  ipcMain.handle('modules:list', () => manager.list());
  ipcMain.handle('modules:reload', () => manager.reload());
  ipcMain.handle('modules:start', (_event, id: string) => manager.start(id));
  ipcMain.handle('modules:stop', (_event, id: string) => manager.stop(id));
  ipcMain.handle('modules:set-strategy', (_event, id: string, strategy: string) => manager.setStrategy(id, strategy));
  ipcMain.handle('runtime:is-elevated', () => isElevated());
  ipcMain.handle('modules:set-extra-args', (_event, id: string, options: unknown) => manager.setExtraArgs(String(id ?? ''), options));
  ipcMain.handle('modules:set-tg-options', (_event, id: string, options: unknown) => manager.setTgProxyOptions(String(id ?? ''), options));
  ipcMain.handle('modules:check-status', (_event, id: string) => manager.checkStatus(String(id ?? '')));
  ipcMain.handle('modules:refresh-strategies', (_event, id: string) => manager.refreshStrategies(String(id ?? '')));
  ipcMain.handle('dpi:list-hosts', async () => (await readDpiHostlist(manager.getModulesDir())).hosts);
  // Список читается ядром только при старте, поэтому работающий модуль
  // перезапускается сразу: иначе добавленный сайт остался бы заблокированным.
  ipcMain.handle('dpi:add-host', async (_event, host: unknown) => {
    const result = await addDpiHost(manager.getModulesDir(), String(host ?? ''));
    const restarted = await manager.reapplyDpiHosts('zapret').catch(() => false);
    // Число связанных доменов показывается пользователю: иначе непонятно, почему
    // одна запись «instagram.com» покрывает и картинки, и видео сервиса.
    const added = result.hosts[result.hosts.length - 1] ?? '';
    return { hosts: result.hosts, restarted, companions: companionCount(added) };
  });
  ipcMain.handle('dpi:remove-host', async (_event, host: unknown) => {
    const result = await removeDpiHost(manager.getModulesDir(), String(host ?? ''));
    const restarted = await manager.reapplyDpiHosts('zapret').catch(() => false);
    return { hosts: result.hosts, restarted };
  });
  ipcMain.handle('logs:list', (_event, id?: string) => {
    const moduleLogs = id === 'jey2ray' ? [] : manager.getLogs(id);
    const vpnLogs = !id || id === 'jey2ray' ? vpn.getLogs() : [];
    return [...moduleLogs, ...vpnLogs]
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(0, 200);
  });
  ipcMain.handle('updates:list', () => updater.list());
  ipcMain.handle('updates:sync', () => updater.syncAll());
  ipcMain.handle('profile:get', () => readProfile());
  ipcMain.handle('profile:save', (_event, name: string) => saveProfile(typeof name === 'string' ? name : ''));
  ipcMain.handle('about:get-info', () => aboutSystemInfo());
  ipcMain.handle('community:links', () => COMMUNITY_LINKS);
  // Ссылка открывается в браузере, а не в окне программы. Окно NEXUS грузит
  // только свои файлы: сторонняя страница внутри процесса с правами
  // администратора — лишний риск. Список адресов закрытый (см. community.ts).
  ipcMain.handle('community:open', async (_event, url: unknown) => {
    if (!isAllowedCommunityUrl(url)) return false;
    await shell.openExternal(String(url));
    return true;
  });
  ipcMain.handle('about:check-update', () => appUpdater.check());
  ipcMain.handle('about:download-update', () => appUpdater.download());
  ipcMain.handle('about:install-update', () => appUpdater.install(prepareForUpdateRestart));
  ipcMain.handle('about:update-state', () => appUpdater.snapshot());
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:save', async (_event, next: AppSettings) => {
    const previousAllowLan = settings.vpnAllowLan;
    const saved = await saveSettings(next ?? settings);
    // Слушающий адрес входов задаётся при старте ядра, поэтому переключение
    // раздачи применяется мгновенным перезапуском активной сессии.
    const current = vpn?.runtime();
    if (saved.vpnAllowLan !== previousAllowLan && current?.status === 'connected' && current.activeProfileId) {
      await connectVpnProfile(current.activeProfileId, settings.vpnMode, current.connectedAt);
    }
    return saved;
  });
  ipcMain.handle('vpn:list', () => vpn.snapshot());
  ipcMain.handle('vpn:diagnostics', (_event, profileId: unknown) => vpn.diagnostics(
    typeof profileId === 'string' ? profileId : null,
    settings.vpnMode,
  ));
  ipcMain.handle('vpn:import', (_event, link: string, name?: string) => vpn.importInput(String(link ?? ''), typeof name === 'string' ? name : undefined));
  ipcMain.handle('vpn:refresh', (_event, url?: string) => typeof url === 'string' && url.trim()
    ? vpn.refreshSubscription(url)
    : vpn.refreshSubscriptions());
  ipcMain.handle('vpn:remove', (_event, id: string) => vpn.remove(String(id ?? '')));
  ipcMain.handle('vpn:remove-subscription', (_event, url: string) => vpn.removeSubscription(String(url ?? '')));
  ipcMain.handle('vpn:pick-apps', () => pickVpnApplications());
  ipcMain.handle('vpn:running-apps', () => listRunningApps());
  ipcMain.handle('vpn:connect', (_event, id: string) => connectVpnProfile(String(id ?? '')));
  ipcMain.handle('vpn:disconnect', () => vpn.disconnect());
  ipcMain.handle('vpn:switch-mode', async (_event, requestedMode: unknown) => {
    if (requestedMode !== 'proxy' && requestedMode !== 'tun') throw new Error('Неизвестный режим VPN');
    const current = vpn.runtime();
    if (current.status === 'connecting') throw new Error('Дождитесь завершения текущего подключения');

    await saveSettings({
      ...settings,
      vpnMode: requestedMode,
      vpnSplitTunnel: requestedMode === 'tun' && settings.vpnAppRouting === 'include',
    });
    if (current.status !== 'connected' || !current.activeProfileId) return vpn.runtime();
    return connectVpnProfile(current.activeProfileId, requestedMode, current.connectedAt);
  });
  ipcMain.handle('vpn:ensure-core', () => updater.ensure('jey2ray'));
  ipcMain.handle('vpn:ping', () => vpn.pingAll());
  ipcMain.handle('vpn:latency-sample', () => vpn.sampleLatency());
  ipcMain.handle('runtime:last-scan', () => manager.getLastScanAt());
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()));
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
  vpn.on('changed', (snapshot: ReturnType<VpnManager['snapshot']>) => {
    mainWindow?.webContents.send('vpn:changed', snapshot);
    setTrayVpnStatus(snapshot.runtime.status);
  });
  vpn.on('log', (log: ModuleLog) => mainWindow?.webContents.send('logs:append', log));
  appUpdater.on('changed', (state: NexusUpdateCheck) => mainWindow?.webContents.send('about:update-changed', state));
}

if (gotLock) {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark';
    Menu.setApplicationMenu(null);
    settings = await readSettings();
    const modulesDir = await resolveModulesDir();
    manager = new ModuleManager(modulesDir);
    vpn = new VpnManager(modulesDir);
    updater = new GithubUpdater(modulesDir, manager, (id) => {
      if (id !== 'jey2ray') return false;
      const runtime = vpn.runtime();
      return Boolean(runtime.pid) || runtime.status === 'connecting' || runtime.status === 'connected';
    });
    // Zapret и TUN без прав администратора не работают. Манифест exe запрашивает
    // их сам, но у portable-сборки он применяется не всегда, а ярлык мог быть
    // создан вручную. Тогда приложение поднимает UAC самостоятельно, чтобы
    // пользователю не приходилось каждый раз вызывать «Запуск от имени
    // администратора» вручную.
    if (app.isPackaged && process.platform === 'win32' && !(await isElevated())) {
      if (relaunchElevated(process.execPath, process.argv.slice(1))) {
        isQuitting = true;
        app.quit();
        return;
      }
      // Повышение не удалось (например, пользователь отказался). Приложение
      // продолжает работу: VPN в режиме PROXY и часть функций доступны и так,
      // а модули сообщат о нехватке прав понятным текстом.
    }

    registerEmergencyCleanup();
    // Регистрация в автозапуске восстанавливается при каждом старте: после
    // обновления путь к программе меняется, и старая запись указывала бы в
    // никуда.
    applyLaunchAtLogin(settings.launchAtLogin);
    appUpdater = new AppUpdater(app.getVersion(), app.isPackaged);
    const profile = await readProfile();
    vpn.setHwid(profile.deviceId);
    wireIpc();
    await manager.init();
    await vpn.init(settings.lastVpnProfileId);
    createTray();
    createWindow();

    // Проверка новой версии при запуске. Идёт в фоне и с задержкой: сразу
    // после старта приложение занято поднятием модулей, а сеть может быть ещё
    // не готова. Ничего не скачивается и не устанавливается — пользователь
    // только видит ненавязчивую отметку, что обновление есть.
    setTimeout(() => {
      void appUpdater.check().catch(() => undefined);
    }, 8_000);

    const startupUpdates = updater.syncAll();
    if (settings.autoStart || (settings.autoConnectVpn && settings.lastVpnProfileId)) {
      void startupUpdates.then(async () => {
        if (settings.autoStart) await manager.startEnabled();
        if (settings.autoConnectVpn && settings.lastVpnProfileId) {
          await connectVpnProfile(settings.lastVpnProfileId);
        }
      }).catch((error: Error) => {
        notify('NEXUS', error.message);
      });
    }
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
