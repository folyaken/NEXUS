const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { VpnManager } = require(path.join(root, 'dist-electron', 'vpn-manager.js'));

const manager = new VpnManager(path.join(os.tmpdir(), `nexus-mode-session-${process.pid}`));
manager.setState('connected', 'profile-a', 1234);
const firstRuntime = manager.runtime();
assert.match(firstRuntime.connectedAt, /^\d{4}-\d{2}-\d{2}T/, 'a connected runtime must publish its session start');

const continuedAt = '2026-08-14T09:10:11.000Z';
manager.setState('connected', 'profile-a', 4321, undefined, continuedAt);
assert.equal(manager.runtime().connectedAt, continuedAt, 'an automatic mode reconnect must preserve the session start');
manager.setState('disconnected', null, null);
assert.equal(manager.runtime().connectedAt, null, 'disconnect must end the session counter');
manager.setState('error', 'profile-a', null, 'test');
assert.equal(manager.runtime().connectedAt, null, 'a failed connection must not retain an active session');
manager.emitLog('info', 'retained log event');
const retainedLogs = manager.getLogs();
assert.equal(retainedLogs[0]?.message, 'retained log event', 'the log screen must receive retained VPN events on initial load');
retainedLogs[0].message = 'mutated renderer copy';
assert.equal(manager.getLogs()[0]?.message, 'retained log event', 'log history must be returned as defensive copies');

const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
const switchStart = main.indexOf("ipcMain.handle('vpn:switch-mode'");
const switchEnd = main.indexOf("ipcMain.handle('vpn:ensure-core'", switchStart);
assert.ok(switchStart > 0 && switchEnd > switchStart, 'main process must register the live mode switch IPC');
const switchHandler = main.slice(switchStart, switchEnd);
assert.match(switchHandler, /requestedMode !== 'proxy' && requestedMode !== 'tun'/);
assert.match(switchHandler, /await saveSettings\(\{/);
assert.match(switchHandler, /vpnMode: requestedMode/);
assert.match(switchHandler, /vpnSplitTunnel: requestedMode === 'tun'/);
assert.match(switchHandler, /current\.status !== 'connected' \|\| !current\.activeProfileId/);
assert.match(switchHandler, /current\.connectedAt/);
assert.ok(switchHandler.indexOf('await saveSettings') < switchHandler.indexOf('return connectVpnProfile'), 'the selected mode must be durable before reconnect');

const preload = fs.readFileSync(path.join(root, 'src', 'main', 'preload.ts'), 'utf8');
const env = fs.readFileSync(path.join(root, 'src', 'renderer', 'env.d.ts'), 'utf8');
const types = fs.readFileSync(path.join(root, 'src', 'main', 'types.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
const vpnManager = fs.readFileSync(path.join(root, 'src', 'main', 'vpn-manager.ts'), 'utf8');
const githubUpdater = fs.readFileSync(path.join(root, 'src', 'main', 'github-updater.ts'), 'utf8');
const subscriptionSource = fs.readFileSync(path.join(root, 'src', 'main', 'subscription.ts'), 'utf8');
const rendererMain = fs.readFileSync(path.join(root, 'src', 'renderer', 'main.tsx'), 'utf8');
const subscriptionManager = fs.readFileSync(path.join(root, 'src', 'renderer', 'SubscriptionManager.tsx'), 'utf8');
const ensureXray = fs.readFileSync(path.join(root, 'scripts', 'ensure-xray.cjs'), 'utf8');
const ensureSingbox = fs.readFileSync(path.join(root, 'scripts', 'ensure-singbox.cjs'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function pngDimensions(filePath) {
  const image = fs.readFileSync(filePath);
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${filePath} must be a PNG image`);
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

assert.match(preload, /switchVpnMode: \(mode: 'proxy' \| 'tun'\)/);
assert.match(env, /switchVpnMode\(mode: 'proxy' \| 'tun'\): Promise<VpnRuntime>/);
assert.match(preload, /getAboutInfo: \(\): Promise<AboutSystemInfo> => ipcRenderer\.invoke\('about:get-info'\)/);
assert.match(preload, /checkNexusUpdate: \(\): Promise<NexusUpdateCheck> => ipcRenderer\.invoke\('about:check-update'\)/);
assert.match(env, /getAboutInfo\(\): Promise<AboutSystemInfo>/);
assert.match(env, /checkNexusUpdate\(\): Promise<NexusUpdateCheck>/);
assert.match(types, /export interface AboutSystemInfo/);
assert.match(types, /xrayVersion: string \| null/);
assert.match(types, /singBoxVersion: string \| null/);
assert.match(types, /export interface NexusUpdateCheck/);
// Заглушка заменена рабочим каналом обновления: статус отражает реальный этап,
// а не фиксированное «канал не подключён».
assert.match(types, /export type NexusUpdateStatus/);
assert.match(types, /canInstall: boolean;/);
assert.doesNotMatch(types, /status: 'placeholder'/);
assert.match(types, /connectedAt: string \| null/);
assert.match(types, /language: 'ru'/);
assert.match(types, /theme: 'dark'/);
assert.match(types, /appearance: 'indigo' \| 'graphite'/);
assert.match(types, /vpnFragmentation: boolean/);
assert.match(types, /vpnFragmentation: true/);
assert.match(main, /appearance: raw\.appearance === 'graphite' \? 'graphite' : 'indigo'/);
assert.match(main, /vpnFragmentation: raw\.vpnFragmentation !== false/, 'old settings must migrate to enabled fragmentation');
assert.match(vpnManager, /fragmentation = true/);
assert.match(vpnManager, /buildXrayConfig\(profile\.params, port, mode, activeSplitApps, activeAppRouting, fragmentation, allowLan\)/);
assert.match(packageJson.version, /^\d+\.\d+\.\d+/, 'версия должна следовать semver');
assert.match(githubUpdater, /syncInFlight = new Map<string, Promise<void>>\(\)/, 'parallel sync requests must share one task per module');
assert.match(githubUpdater, /ensureInFlight = new Map<string, Promise<void>>\(\)/, 'parallel ensure requests must share one task per module');
assert.match(githubUpdater, /fs\.mkdtemp\(path\.join\(os\.tmpdir\(\), 'nexus-updater-'\)\)/);
assert.match(githubUpdater, /fs\.mkdtemp\(path\.join\(os\.tmpdir\(\), 'nexus-xray-download-'\)\)/);
assert.match(githubUpdater, /fs\.mkdtemp\(path\.join\(os\.tmpdir\(\), 'nexus-xray-extract-'\)\)/);
assert.doesNotMatch(githubUpdater, /path\.join\(this\.modulesDir, '\.cache'/, 'runtime downloads must not reuse the project cache directory');
assert.match(githubUpdater, /Windows временно заблокировал файл обновления/);
assert.match(githubUpdater, /Недостаточно свободного места для обновления/);
assert.match(githubUpdater, /GitHub и запасные зеркала недоступны/);
for (const [name, bootstrapSource, prefix] of [
  ['Xray', ensureXray, 'nexus-xray-setup-'],
  ['sing-box', ensureSingbox, 'nexus-singbox-setup-'],
]) {
  assert.match(bootstrapSource, /require\('node:os'\)/, `${name} bootstrap must use the system temporary directory`);
  assert.ok(bootstrapSource.includes(`fs.mkdtempSync(path.join(os.tmpdir(), '${prefix}'))`), `${name} bootstrap must isolate every mirror attempt`);
  assert.doesNotMatch(bootstrapSource, /modules', '\.cache|const cacheDir/, `${name} bootstrap must not reuse modules/.cache`);
  assert.match(bootstrapSource, /fs\.rmSync\(attemptDir, \{ recursive: true, force: true \}\)/, `${name} bootstrap must clean its temporary directory`);
  assert.match(bootstrapSource, /Windows временно заблокировал файл установки/, `${name} bootstrap must explain permission failures`);
  assert.match(bootstrapSource, /Недостаточно свободного места/, `${name} bootstrap must explain disk-space failures`);
}
assert.match(page, /const selectConnectionMode = async/);
assert.match(page, /await window\.nexus\?\.switchVpnMode\(next\)/);
assert.match(page, /disabled=\{busy \|\| runtime\.status === 'connecting'\}/, 'connected VPN must not disable the PROXY/TUN buttons');
assert.match(page, /setInterval\(\(\) => setSessionNow\(Date\.now\(\)\), 1000\)/);
assert.match(page, /<span className="tunnel-session-counter"[^>]*>\{sessionDuration\}<\/span>/);
assert.ok(page.indexOf('className="tunnel-session-counter"') < page.indexOf('className="tunnel-route"'), 'the session timer must be above the animated route');
assert.match(page, /formatSessionDuration\(runtime\.connectedAt, sessionNow\)/);
assert.doesNotMatch(page, /<PingSparkline|className="tunnel-ping"|className="power-session"|<small>Сессия<\/small>/);
assert.match(page, /orb-halo orb-halo-primary/);
assert.match(page, /orb-halo orb-halo-follow/);
assert.match(page, /orb-halo orb-halo-wait/);
assert.match(page, /if \(settingsOpen\) return <section className="page-section jey-page app-settings-page">/);
assert.match(page, /settings-gear-button/);
assert.match(page, /Открыть настройки Jey2Ray/);
assert.match(page, /const \[settingsTab, setSettingsTab\] = useState<'general' \| 'applications'>\('general'\)/);
assert.match(page, /role="tablist" aria-label=\{t\('Разделы настроек Jey2Ray'\)\}/);
assert.match(page, /id="jey-settings-panel"[\s\S]*role="tabpanel"[\s\S]*aria-labelledby=\{`jey-settings-\$\{settingsTab\}-tab`\}/);
assert.match(page, /role="tab"[\s\S]*aria-selected=\{settingsTab === 'general'\}[\s\S]*>\{t\('Общие'\)\}</);
assert.match(page, /role="tab"[\s\S]*aria-selected=\{settingsTab === 'applications'\}[\s\S]*>\{t\('Настройка приложений'\)\}</);
assert.match(page, /settingsTab === 'general' \? <>[\s\S]*<section className="app-settings-card auto-settings-card">/);
assert.match(page, /className="app-settings-card fragmentation-settings-card"/);
assert.match(page, /settings\.vpnFragmentation \? 'is-on' : ''/);
assert.match(page, /onSettings\(\{ \.\.\.settings, vpnFragmentation: enabled \}\)/);
assert.match(page, /Включить фрагментацию/);
assert.match(page, /Xray-профилей с TCP\/TLS, включая Reality/);
assert.match(page, /Hysteria2 использует QUIC/);
assert.ok(page.indexOf("settingsTab === 'general' ? <>") < page.indexOf('routing-settings-card'), 'application routing must be rendered only in the applications tab branch');
assert.match(page, /window\.nexus\?\.pickVpnApps\(\)/);
assert.match(page, /role="radiogroup" aria-label=\{t\('Режим маршрутизации приложений'\)\}/);
assert.match(page, /Сначала отключите VPN, затем измените маршрутизацию приложений/);
assert.doesNotMatch(page, /autoPing/, 'opening Jey2Ray must not trigger an automatic all-server ping');
assert.equal((page.match(/void ping\(\)/g) ?? []).length, 1, 'the explicit manual ping action must remain available');
assert.match(page, /sampleVpnLatency/);

assert.doesNotMatch(app, /SettingsTab|settings-tabs|function ApplicationSettings|Настройки приложений/, 'VPN settings must not leak into global NEXUS settings');
assert.doesNotMatch(app, /copyHwid|setCopied|Скопировать HWID/, 'HWID must be displayed without the temporary copy/check button');
// Версия подставляется из package.json на этапе сборки, а не хранится строкой:
// иначе после повышения версии интерфейс показывал бы старое значение.
assert.match(app, /nexusVersion: __APP_VERSION__/);
assert.match(app, /NEXUS v\{__APP_VERSION__\}/);
const heroVisual = app.slice(app.indexOf('function HeroVisual()'), app.indexOf('function GithubUpdateStrip'));
// Вращение перенесено в CSS: бесконечные пружины @react-spring занимали главный
// поток всё время, пока открыта главная, и мешали плавности наведения.
assert.doesNotMatch(heroVisual, /useSpring|loop: true/, 'hero orbits must animate on the compositor, not in JavaScript');
assert.match(styles, /\.orbit-a \{ animation: nx-orbit-a 22s linear infinite; \}/);
assert.match(styles, /\.orbit-b \{ animation: nx-orbit-b 31s linear infinite; \}/);
assert.match(styles, /@keyframes nx-orbit-a \{ from \{ transform: rotate\(-18deg\); \} to \{ transform: rotate\(342deg\); \} \}/);
assert.doesNotMatch(heroVisual, /reverse|turn %|planet-track/, 'hero orbits must move forward linearly without visible direction changes');
assert.match(heroVisual, /<NexusMark \/>/, 'the hero must use the NEXUS mark instead of a generic sparkle');
assert.match(app, /profileWrapRef = useRef<HTMLDivElement>\(null\)/);
assert.match(app, /document\.addEventListener\('pointerdown', closeOnOutsidePress, true\)/, 'the profile panel must close on every outside pointer press');
assert.match(app, /profileWrapRef\.current\?\.contains\(target\)/);
assert.match(app, /window\.addEventListener\('blur', closeOnWindowBlur\)/);
assert.match(app, /useEffect\(\(\) => \{ setProfileOpen\(false\); \}, \[page\]\)/);
assert.match(app, /className="about-nav-dot"/);
assert.match(app, /role="dialog" aria-label="Локальный профиль" aria-hidden=\{!open\}/);
assert.match(app, /function WindowBar\(\{ maximized \}/);
assert.match(app, /window\.nexus\?\.toggleMaximize\(\)/);
assert.doesNotMatch(app, /toggleFullscreen|isFullscreen|onFullscreen/);
assert.match(app, /Глобальные параметры языка, оформления и поведения NEXUS/);
assert.match(app, /Язык интерфейса/);
assert.match(app, /Тема/);
assert.match(app, /Оформление/);
assert.match(app, /appearance-options/);
assert.match(app, /if \(name === 'settings'\) return <GearIcon \/>/);
assert.match(app, /nexus-sidebar-collapsed/);
assert.match(app, /aria-label=\{sidebarCollapsed \? 'Развернуть боковую панель' : 'Свернуть боковую панель'\}/);
// Пункт «О программе» остаётся на месте; текст проходит через перевод, поэтому
// в разметке он записан вызовом словаря, а не строкой.
assert.match(app, />\{t\('О программе'\)\}<\/span>/);
assert.match(app, /<h1>\{t\('О программе'\)\}<\/h1>/);
// Кнопка быстрого перехода к логам осталась на месте; текст проходит через
// словарь перевода, поэтому в разметке он записан вызовом, а не строкой.
assert.match(app, /<span>\{t\('Логи'\)\}<\/span>/);
assert.match(app, /<h1>Логи<\/h1>/);
assert.match(app, /role="tablist" aria-label="Источники логов"/);
assert.match(app, /Основной лог/);
assert.match(app, /Лог туннеля/);
assert.match(app, /log-console-line/);
assert.match(app, /profile-chevron/);
assert.doesNotMatch(app, />⌄<\/b>/, 'the profile menu must use the animated SVG chevron');
assert.match(main, /vpn\.getLogs\(\)/, 'the initial log list must include retained Jey2Ray events');
assert.match(vpnManager, /getLogs\(\): ModuleLog\[\]/);

assert.match(styles, /\.tunnel-session-counter \{[^}]*font-family: var\(--font-body\)/);
assert.match(styles, /\.mode-switch button \{[^}]*font-family: var\(--font-body\)[^}]*text-transform: uppercase/);
assert.match(styles, /\.power-orb\.is-on \.orb-halo-primary \{ animation: orb-wave-primary/);
assert.match(styles, /\.power-orb\.is-on \.orb-halo-follow \{ animation: orb-wave-follow/);
assert.match(styles, /\.power-orb\.is-wait \.orb-halo-wait \{ animation: orb-wave-wait/);
assert.match(styles, /100% \{ transform: scale\(1\.82\); opacity: 0; \}/);
assert.match(styles, /\.global-settings-hero \{/);
assert.match(styles, /\.app-settings-tabs \{[^}]*grid-template-columns: repeat\(2/);
assert.match(styles, /\.app-settings-tab\.is-active \{/);
assert.match(styles, /\.app-settings-page \.app-settings-card-head h3 \{ font-size: 18px/);
assert.match(styles, /\.appearance-graphite \{[\s\S]*--bg: #090909/);
for (const graphiteArea of ['.sidebar', '.hero', '.module-card-inner', '.jey-hero', '.app-settings-tabs', '.subscription-card', '.diagnostics-report-card']) {
  assert.ok(styles.includes(`.appearance-graphite ${graphiteArea}`), `Graphite appearance must restyle ${graphiteArea}`);
}
assert.match(styles, /\.appearance-graphite \.app-settings-tab\.is-active \{[^}]*rgba\(224,224,224/);
assert.match(styles, /\.appearance-graphite \.primary-button \{[^}]*#e5e5e5/);
assert.match(styles, /\.app-shell\.is-sidebar-collapsed \.sidebar \{[^}]*flex-basis: 82px/);
assert.match(styles, /\.profile-chevron \{[^}]*transition:/);
assert.match(styles, /\.window-bar \{[^}]*height: 36px/);
assert.match(styles, /\.window-control svg \{[^}]*width: 16px/);
assert.doesNotMatch(app, />−<|>×</, 'window controls must use crisp SVG paths instead of text glyphs');
assert.match(styles, /\.sidebar-about \.about-nav-ring \{ stroke-width: 1\.85/);
assert.match(styles, /\.sidebar-about \.about-nav-dot \{ fill: currentColor; stroke: none/);
assert.match(styles, /\.tunnel-route-track i \{[^}]*animation: tunnel-travel 2\.45s linear infinite/);
assert.match(styles, /@keyframes tunnel-travel \{[\s\S]*0% \{[^}]*opacity: 0[\s\S]*96%, 100% \{[^}]*opacity: 0/, 'route marker must cross the loop boundary while invisible');
assert.doesNotMatch(styles, /animation:[^;]*(?:alternate|reverse)/, 'continuous CSS animations must not reverse direction');
const thirdPartyClientPattern = new RegExp(`\\b${['Ha', 'pp'].join('')}\\b`, 'i');
for (const [name, visibleSource] of [
  ['App', app],
  ['Jey2Ray', page],
  ['Subscription manager', subscriptionManager],
  ['renderer fallback', rendererMain],
  ['VPN errors', vpnManager],
  ['subscription transport', subscriptionSource],
  ['Xray bootstrap', ensureXray],
  ['sing-box bootstrap', ensureSingbox],
]) {
  assert.doesNotMatch(visibleSource, thirdPartyClientPattern, `${name} must not expose third-party client branding`);
  assert.doesNotMatch(visibleSource, /(?<![\p{L}\p{N}_])(?:вставь|добавь|нажми|выбери|отключи|измени|проверь|повтори|закрой|освободи|пришли|скинь|открой|укажи|задай|запусти|перезапусти|скачай|включи|выключи|дождись|обнови|попробуй|используй|перейди|вернись|удали|сохрани|положи)(?![\p{L}\p{N}_])/iu, `${name} must address a broad audience formally`);
}
assert.doesNotMatch(app, /Flowseal GitHub|github\.com\/Flowseal/, 'the update strip must use neutral product wording');
const legacyThirdPartyPrefix = `.${['ha', 'pp'].join('')}-`;
assert.equal(`${app}\n${page}\n${styles}`.toLowerCase().includes(legacyThirdPartyPrefix), false, 'legacy third-party CSS prefixes must be removed');
assert.match(styles, /\.fragmentation-note \{[^}]*line-height: 1\.55/);
assert.match(styles, /\.log-source-tabs \{[^}]*grid-template-columns: repeat\(6/);
assert.match(styles, /Graphite is strictly achromatic\. Server flags are the only colour exception/);
assert.match(styles, /\.appearance-graphite \.server-flag-svg \{ filter: none; \}/, 'Graphite flags must keep their original colour');
assert.match(styles, /\.appearance-graphite \.server-row\.is-live \{[^}]*#d6d6d6/, 'the live server row surrounding a flag must stay grayscale');
assert.match(styles, /\.appearance-graphite \.tunnel-route-server \{[^}]*rgba\(211,211,211/, 'the route endpoint surrounding a flag must stay grayscale');
assert.match(styles, /\.appearance-graphite:not\(:has\(\.server-flag-svg\)\) > \.app-shell/);
assert.match(styles, /\.appearance-graphite \*:has\(\.server-flag-svg\) > \*:not\(:has\(\.server-flag-svg\)\)/, 'only flag-free sibling branches may be desaturated');
assert.doesNotMatch(styles, /\.appearance-graphite \.server-flag-svg \{ filter: saturate/, 'Graphite must not mute server flags');
const graphiteBlocks = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((match) => match[1].includes('.appearance-graphite') && !match[1].includes('.server-flag-svg'));
for (const [, selectors, declarations] of graphiteBlocks) {
  const colors = declarations.matchAll(/#([0-9a-fA-F]{6})\b|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g);
  for (const color of colors) {
    const channels = color[1]
      ? [0, 2, 4].map((offset) => Number.parseInt(color[1].slice(offset, offset + 2), 16))
      : [Number(color[2]), Number(color[3]), Number(color[4])];
    assert.equal(new Set(channels).size, 1, `Graphite colour ${color[0]} in ${selectors.trim()} must be exact grayscale`);
  }
}
assert.doesNotMatch(styles, /Graphite keeps its neutral base while retaining restrained semantic colour/);
assert.doesNotMatch(styles, /\.settings-tab\.active \{|\.tunnel-ping|\.power-session/);

assert.match(main, /function coreVersion\(executable: string, product: 'xray' \| 'sing-box'\)/);
assert.match(main, /execFile\(executable, \['version'\]/);
assert.match(main, /timeout: 2_500/);
assert.match(main, /maxBuffer: 64 \* 1024/);
assert.match(main, /coreVersion\(vpn\.xrayPath\(\), 'xray'\)/);
assert.match(main, /coreVersion\(vpn\.singboxPath\(\), 'sing-box'\)/);
assert.match(main, /ipcMain\.handle\('about:get-info', \(\) => aboutSystemInfo\(\)\)/);
// Проверка выполняется реальным апдейтером, а не функцией-заглушкой.
assert.match(main, /ipcMain\.handle\('about:check-update', \(\) => appUpdater\.check\(\)\)/);
assert.match(main, /ipcMain\.handle\('about:install-update'/);
assert.match(main, /fullscreenable: false/);
assert.match(main, /ipcMain\.handle\('window:toggle-maximize'/);
assert.match(main, /mainWindow\.isMaximized\(\)\) mainWindow\.unmaximize\(\)/);
assert.match(main, /else mainWindow\.maximize\(\)/);
assert.match(main, /mainWindow\.on\('maximize',[\s\S]*'window:maximized', true/);
assert.match(main, /mainWindow\.on\('unmaximize',[\s\S]*'window:maximized', false/);
assert.match(preload, /toggleMaximize: \(\): Promise<boolean> => ipcRenderer\.invoke\('window:toggle-maximize'\)/);
assert.match(preload, /isMaximized: \(\): Promise<boolean> => ipcRenderer\.invoke\('window:is-maximized'\)/);
assert.match(env, /toggleMaximize\(\): Promise<boolean>/);
assert.match(env, /onMaximized\(callback: \(value: boolean\) => void\): \(\) => void/);
for (const source of [main, preload, env, app]) assert.doesNotMatch(source, /toggle-fullscreen|is-fullscreen|window:fullscreen|setFullScreen|isFullScreen/);
assert.match(app, /Версия Xray Core/);
assert.match(app, /Версия sing-box/);
assert.match(app, /Компьютер \/ ОС/);
// Канал обновления заработал: бейдж отражает текущий этап, а кнопка установки
// становится активной, когда обновление действительно загружено.
assert.match(app, /about-update-badge status-\$\{updateStatus\}/);
assert.match(app, /'ГОТОВО К УСТАНОВКЕ'/);
assert.match(app, /about-install-button is-ready/);

assert.match(main, /const TRAY_FRAME_FILES = \{[\s\S]*disconnected:[\s\S]*connecting:[\s\S]*connected:/, 'tray branding must expose three visual VPN states');
assert.match(main, /function stopTrayAnimation\(\): void/);
assert.match(main, /if \(trayAnimation\) clearInterval\(trayAnimation\)/);
assert.match(main, /visualState === 'connecting' \? 150 : 420/);
assert.match(main, /trayAnimation\.unref\(\)/, 'tray animation must not keep the process alive');
assert.match(main, /setTrayVpnStatus\(snapshot\.runtime\.status\)/, 'VPN state events must immediately update the tray');
assert.match(main, /const snapshot = vpn\.snapshot\(\)/, 'tray menu must be generated from live VPN state');
for (const trayLabel of ['Подключить VPN', 'Отключить VPN', 'Сменить сервер', 'Транспорт ·', 'Импортировать из буфера', 'Маршрутизация', 'Показать окно NEXUS', 'Выход']) {
  assert.ok(main.includes(trayLabel), `tray menu must provide “${trayLabel}”`);
}
assert.match(main, /clipboard\.readText\(\)\.trim\(\)/);
assert.match(main, /profiles\.map\(\(profile\) => \(\{/);
assert.match(main, /setTrayVpnMode\('proxy'\)/);
assert.match(main, /setTrayVpnMode\('tun'\)/);
assert.match(main, /setTrayRouting\('system'\)/);
assert.match(main, /setTrayRouting\('include'\)/);
assert.match(main, /setTrayRouting\('exclude'\)/);
assert.match(main, /await connectVpnProfile\(profileId, settings\.vpnMode, current\.connectedAt\)/, 'changing the selected tray server must live-reconnect');
assert.match(main, /settings\.vpnFragmentation/, 'the common connect path must pass the saved fragmentation switch');
assert.match(main, /stopTrayAnimation\(\);[\s\S]*tray\?\.destroy\(\)/, 'quitting must release the tray timer before destroying the tray');
assert.match(main, /icon: assetPath\('nexus-app\.png'\)/);
assert.match(app, /function NexusMark\(\)[\s\S]*nexus-infinity-mark/);
assert.match(app, /function NexusShowcaseMark\(\)/);
assert.match(app, /<div className="about-mark"><NexusShowcaseMark \/><\/div>/);
assert.match(styles, /\.nexus-infinity-mark \.nexus-ribbon/);
assert.match(styles, /\.nexus-showcase-mark \{ animation: showcase-hover/);

const resourceFilters = packageJson.build.extraResources.flatMap((entry) => entry.filter ?? []);
for (const resource of ['nexus-tray.png', 'nexus-app.png', 'nexus.ico', 'tray/**/*']) {
  assert.ok(resourceFilters.includes(resource), `${resource} must be copied outside ASAR for native window and tray use`);
}
const trayAssets = [
  'nexus-off.png',
  ...Array.from({ length: 8 }, (_, index) => `nexus-connecting-${index}.png`),
  ...Array.from({ length: 6 }, (_, index) => `nexus-connected-${index}.png`),
];
for (const asset of trayAssets) {
  assert.deepEqual(pngDimensions(path.join(root, 'assets', 'tray', asset)), { width: 32, height: 32 }, `${asset} must stay sharp at Windows tray density`);
}
assert.deepEqual(pngDimensions(path.join(root, 'assets', 'nexus-tray.png')), { width: 32, height: 32 });
assert.deepEqual(pngDimensions(path.join(root, 'assets', 'nexus-app.png')), { width: 256, height: 256 });
const icoHeader = fs.readFileSync(path.join(root, 'assets', 'nexus.ico')).subarray(0, 4).toString('hex');
assert.equal(icoHeader, '00000100', 'the Windows build icon must remain a valid ICO container');

console.log('VPN fragmentation, maximize controls, functional tray, About and monochrome Graphite regression checks passed.');
