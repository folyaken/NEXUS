import { useEffect, useMemo, useState } from 'react';
import { animated, config, useSpring } from '@react-spring/web';
import type { AppSettings, ModuleLog, ModuleManifest, ModuleStatus, UpdateInfo, UserProfile, VpnAppRoutingMode, VpnStatus } from '../main/types';
import { DEFAULT_SETTINGS } from '../main/types';
import { Jey2RayPage } from './Jey2RayPage';

type Page = 'dashboard' | 'modules' | 'jey2ray' | 'logs' | 'settings';
type SettingsTab = 'general' | 'applications';
type Tone = 'green' | 'amber' | 'red' | 'muted';

const DEMO_MODULES: ModuleManifest[] = [
  { id: 'zapret', name: 'Обход DPI', description: 'Профиль для Zapret: YouTube, Discord и другие сервисы.', enabled: false, executable: './bin/winws.exe', args: ['--wf-tcp=80,443', '--hostlist=list.txt'], status: 'stopped', category: 'dpi', icon: '🛡️', pid: null, log_file: './logs/zapret.log' },
  { id: 'tg-ws-proxy', name: 'TG WS Proxy', description: 'WebSocket-транспорт для стабильного подключения к Telegram.', enabled: false, executable: './bin/tg-ws-proxy.exe', args: ['--listen', '127.0.0.1:8080'], status: 'stopped', category: 'proxy', icon: '◈', pid: null, log_file: './logs/tg-ws-proxy.log' },
  { id: 'exitlag-sdk', name: 'ExitLag SDK', description: 'Профиль маршрутизации для игровых и realtime-соединений.', enabled: false, executable: './bin/exitlag-sdk.exe', args: ['--profile', 'balanced'], status: 'stopped', category: 'sdk', icon: '✦', pid: null, log_file: './logs/exitlag-sdk.log' },
  { id: 'dns-guard', name: 'DNS Guard', description: 'Локальный DNS-профиль с быстрым переключением конфигурации.', enabled: false, executable: './bin/dns-guard.exe', args: ['--mode', 'secure'], status: 'stopped', category: 'dns', icon: '⌁', pid: null, log_file: './logs/dns-guard.log' },
];

const DEMO_LOGS: ModuleLog[] = [
  { id: 'system', level: 'success', message: 'Сканирование завершено: найдено модулей — 4', timestamp: new Date(Date.now() - 1000 * 60 * 4).toISOString() },
  { id: 'tg-ws-proxy', level: 'info', message: 'Конфигурация готова к запуску', timestamp: new Date(Date.now() - 1000 * 60 * 9).toISOString() },
  { id: 'system', level: 'info', message: 'NEXUS control plane инициализирован', timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString() },
];

const DEMO_UPDATES: UpdateInfo[] = [
  { id: 'zapret', name: 'Обход DPI', repo: 'Flowseal/zapret-discord-youtube', source: 'GitHub', latestVersion: '1.10.1', installedVersion: null, asset: null, status: 'idle' },
  { id: 'tg-ws-proxy', name: 'TG WS Proxy', repo: 'Flowseal/tg-ws-proxy', source: 'GitHub', latestVersion: 'v1.9.1', installedVersion: null, asset: null, status: 'idle' },
];

const navItems: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Обзор', icon: 'home' },
  { id: 'modules', label: 'Модули', icon: 'modules' },
  { id: 'jey2ray', label: 'Jey2Ray', icon: 'jey' },
  { id: 'logs', label: 'Журнал', icon: 'logs' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
];

const categoryNames: Record<string, string> = { dpi: 'DPI', proxy: 'PROXY', sdk: 'SDK', dns: 'DNS', other: 'OTHER' };
const zapretStrategies = ['general (ALT10)', 'general (ALT11)', 'general (ALT12)'];

function statusTone(status: ModuleStatus): Tone {
  if (status === 'running') return 'green';
  if (status === 'error') return 'red';
  if (status === 'starting' || status === 'stopping') return 'amber';
  return 'muted';
}

function statusLabel(status: ModuleStatus): string {
  return ({ running: 'Активен', stopped: 'Остановлен', error: 'Ошибка', starting: 'Запуск…', stopping: 'Остановка…' })[status];
}

function moduleTone(module: ModuleManifest): Tone {
  return module.development ? 'amber' : statusTone(module.status);
}

function moduleLabel(module: ModuleManifest): string {
  return module.development ? 'В разработке' : statusLabel(module.status);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim();
}

function IconMark({ children }: { children: string }) {
  return <span className="icon-mark" aria-hidden="true">{children}</span>;
}

function NexusMark() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5 12 2l5 2.5v5.8L12 13l-5-2.7Z" /><path d="m7 13.7 5 2.8 5-2.8v5.8L12 22l-5-2.5Z" /><path d="m7 4.5-3 1.8v5.4l3 2" /><path d="m17 4.5 3 1.8v5.4l-3 2" /><circle cx="12" cy="7.7" r="1.4" /></svg>;
}

function GearIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z" /><path d="m19.4 15 .1.1a1.4 1.4 0 0 1-2 2l-.1-.1a1.4 1.4 0 0 0-2.4 1v.2a1.4 1.4 0 0 1-2.8 0V18a1.4 1.4 0 0 0-2.4-1l-.1.1a1.4 1.4 0 1 1-2-2l.1-.1a1.4 1.4 0 0 0-1-2.4h-.2a1.4 1.4 0 0 1 0-2.8h.2a1.4 1.4 0 0 0 1-2.4l-.1-.1a1.4 1.4 0 1 1 2-2l.1.1a1.4 1.4 0 0 0 2.4-1v-.2a1.4 1.4 0 0 1 2.8 0v.2a1.4 1.4 0 0 0 2.4 1l.1-.1a1.4 1.4 0 1 1 2 2l-.1.1a1.4 1.4 0 0 0 1 2h.2a1.4 1.4 0 0 1 0 2.8h-.2a1.4 1.4 0 0 0-1 2.4Z" /></svg>;
}

function NavGlyph({ name }: { name: string }) {
  if (name === 'home') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></svg>;
  if (name === 'settings') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z" /><path d="m19.4 15 .1.1a1.4 1.4 0 0 1-2 2l-.1-.1a1.4 1.4 0 0 0-2.4 1v.2a1.4 1.4 0 0 1-2.8 0V18a1.4 1.4 0 0 0-2.4-1l-.1.1a1.4 1.4 0 1 1-2-2l.1-.1a1.4 1.4 0 0 0-1-2.4h-.2a1.4 1.4 0 0 1 0-2.8h.2a1.4 1.4 0 0 0 1-2.4l-.1-.1a1.4 1.4 0 1 1 2-2l.1.1a1.4 1.4 0 0 0 2.4-1v-.2a1.4 1.4 0 0 1 2.8 0v.2a1.4 1.4 0 0 0 2.4 1l.1-.1a1.4 1.4 0 1 1 2 2l-.1.1a1.4 1.4 0 0 0 1 2h.2a1.4 1.4 0 0 1 0 2.8h-.2a1.4 1.4 0 0 0-1 2.4Z" /></svg>;
  if (name === 'jey') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" /><path d="M12 5V2M12 22v-3M5 12H2M22 12h-3M7 7 5 5M19 19l-2-2M17 7l2-2M7 17l-2 2" /></svg>;
  if (name === 'logs') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14M5 12h14M5 19h9" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="5" height="5" rx="1" /><rect x="14" y="5" width="5" height="5" rx="1" /><rect x="5" y="14" width="5" height="5" rx="1" /><rect x="14" y="14" width="5" height="5" rx="1" /></svg>;
}

function WindowBar({ fullscreen }: { fullscreen: boolean }) {
  return <div className="window-bar">
    <div className="window-drag"><span className="window-brand-mark">✦</span><strong>NEXUS</strong><span className="window-separator">/</span><span>Network Control Plane</span></div>
    <div className="window-actions"><button className="window-control minimize" aria-label="Свернуть" onClick={() => void window.nexus?.minimizeWindow()}>−</button><button className="window-control fullscreen" aria-label={fullscreen ? 'Оконный режим' : 'На весь экран'} title={fullscreen ? 'Оконный режим (Esc)' : 'На весь экран'} onClick={() => void window.nexus?.toggleFullscreen()}>{fullscreen ? '❐' : '⛶'}</button><button className="window-control close" aria-label="Закрыть" onClick={() => void window.nexus?.closeWindow()}>×</button></div>
  </div>;
}

function StatusDot({ tone }: { tone: Tone }) {
  const pulse = useSpring({ from: { scale: 0.9, opacity: 0.65, glow: 0.1 }, to: { scale: 1.1, opacity: 1, glow: 0.42 }, loop: { reverse: true }, config: { duration: 1100 } });
  const color = tone === 'green' ? '#71f4b8' : tone === 'amber' ? '#f8c76c' : tone === 'red' ? '#ff718f' : '#78849d';
  return <animated.span className={`status-dot ${tone}`} style={{ opacity: pulse.opacity, transform: pulse.scale.to((value) => `scale(${value})`), boxShadow: pulse.glow.to((value) => `0 0 ${10 + value * 16}px rgba(${tone === 'green' ? '113,244,184' : tone === 'amber' ? '248,199,108' : tone === 'red' ? '255,113,143' : '120,132,157'}, ${value})`), background: color }} />;
}

function Toggle({ checked, onChange, busy = false, disabled = false }: { checked: boolean; onChange: () => void; busy?: boolean; disabled?: boolean }) {
  const spring = useSpring({ x: checked ? 21 : 0, background: checked ? '#5ce7b0' : '#252d3c', shadow: checked ? '0 0 22px rgba(92,231,176,.35)' : '0 5px 14px rgba(0,0,0,.24)', config: config.gentle });
  return <animated.button className={`toggle ${checked ? 'is-on' : ''}`} aria-label={checked ? 'Выключить модуль' : 'Включить модуль'} disabled={busy || disabled} onClick={onChange} style={{ background: spring.background, boxShadow: spring.shadow }}><animated.span className="toggle-knob" style={{ transform: spring.x.to((x) => `translateX(${x}px)`) }} /></animated.button>;
}

function ModuleCard({ module, index, onToggle, onStrategyChange }: { module: ModuleManifest; index: number; onToggle: (module: ModuleManifest) => void; onStrategyChange: (module: ModuleManifest, strategy: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const entry = useSpring({ opacity: 1, y: 0, config: { tension: 240, friction: 24 }, delay: Math.min(index * 65, 260) });
  const hover = useSpring({ y: hovered ? -4 : 0, shadow: hovered ? '0 26px 56px rgba(0, 0, 0, .32), 0 0 0 1px rgba(124, 242, 214, .18)' : '0 18px 45px rgba(0, 0, 0, .20), 0 0 0 1px rgba(255,255,255,.055)', config: config.gentle });
  const isBusy = module.status === 'starting' || module.status === 'stopping';
  const isRunning = module.status === 'running';
  const isDevelopment = Boolean(module.development);
  const tone = moduleTone(module);
  return <animated.article className="module-card" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ opacity: entry.opacity, transform: entry.y.to((y) => `translateY(${y}px)`) }}><animated.div className="module-card-inner" style={{ transform: hover.y.to((y) => `translateY(${y}px)`), boxShadow: hover.shadow }}>
    <div className="card-head"><div className={`module-icon ${module.category}`}><span>{module.icon}</span></div><div className="card-head-copy"><div className="eyebrow-row"><span className="category-chip">{categoryNames[module.category] ?? 'OTHER'}</span><StatusDot tone={tone} /><span className={`status-copy ${tone}`}>{moduleLabel(module)}</span></div><h3>{module.name}</h3></div><Toggle checked={isRunning} busy={isBusy} disabled={isDevelopment} onChange={() => onToggle(module)} /></div>
    {(module.id === 'zapret' || module.strategies) && <div className="strategy-row"><label htmlFor={`strategy-${module.id}`}>Профиль запуска</label><select id={`strategy-${module.id}`} value={module.strategy ?? Object.keys(module.strategies ?? {})[0] ?? zapretStrategies[0]} disabled={isRunning || isBusy} onChange={(event) => onStrategyChange(module, event.target.value)}>{(Object.keys(module.strategies ?? {}).length ? Object.keys(module.strategies ?? {}) : zapretStrategies).map((strategy) => <option key={strategy} value={strategy}>{strategy}</option>)}</select></div>}
    <p className={`module-description ${module.status === 'error' ? 'error-copy' : ''} ${isDevelopment ? 'development-copy' : ''}`}>{isDevelopment ? 'Интеграция будет добавлена в следующей версии.' : module.status === 'error' && module.error ? module.error : module.description}</p><div className="card-divider" /><div className="card-foot"><span className="module-meta"><span className="meta-dot" />{isDevelopment ? 'Скоро' : module.pid ? `PID ${module.pid}` : 'Готов к запуску'}</span><button className={`module-action ${isDevelopment ? 'is-disabled' : ''}`} disabled={isDevelopment} onClick={() => onToggle(module)}>{isDevelopment ? 'В разработке' : isRunning ? 'Остановить' : isBusy ? 'Подождите' : 'Запустить'} <span>↗</span></button></div>
  </animated.div></animated.article>;
}

function StatCard({ label, value, note, icon, tone, index }: { label: string; value: string; note: string; icon: string; tone: string; index: number }) {
  const spring = useSpring({ from: { opacity: 0, y: 12 }, to: { opacity: 1, y: 0 }, delay: 100 + index * 70, config: config.gentle });
  return <animated.div className="stat-card" style={{ opacity: spring.opacity, transform: spring.y.to((y) => `translateY(${y}px)`) }}><div className={`stat-icon ${tone}`}><IconMark>{icon}</IconMark></div><div><span className="stat-label">{label}</span><strong>{value}</strong><span className="stat-note">{note}</span></div></animated.div>;
}

function PulsePanel({ running, total, errors }: { running: number; total: number; errors: number }) {
  const progress = total ? Math.round((running / total) * 100) : 0;
  const spring = useSpring({ from: { opacity: 0, x: 12 }, to: { opacity: 1, x: 0 }, delay: 260, config: config.gentle });
  return <animated.aside className="pulse-panel" style={{ opacity: spring.opacity, transform: spring.x.to((x) => `translateX(${x}px)`) }}><div className="panel-topline"><span className="mini-label">SYSTEM PULSE</span><span className="live-badge"><StatusDot tone={errors ? 'red' : running ? 'green' : 'muted'} /> {errors ? 'ALERT' : 'LIVE'}</span></div><div className="pulse-title"><div><strong>{errors ? 'Есть ошибки' : running ? 'Контур активен' : 'Контур готов'}</strong><span>{running} из {total} модулей запущено</span></div><span className="pulse-score">{progress}%</span></div><div className="pulse-chart" aria-hidden="true"><svg viewBox="0 0 330 110" preserveAspectRatio="none"><defs><linearGradient id="pulseFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#71f4b8" stopOpacity=".34" /><stop offset="1" stopColor="#71f4b8" stopOpacity="0" /></linearGradient></defs><path className="chart-grid" d="M0 22H330 M0 54H330 M0 86H330" /><path className="chart-fill" d="M0 78 C20 76, 23 58, 42 66 S66 94, 87 63 S111 34, 133 55 S160 78, 180 48 S204 31, 225 53 S247 80, 270 39 S300 50, 330 23 L330 110 L0 110 Z" /><path className="chart-line" d="M0 78 C20 76, 23 58, 42 66 S66 94, 87 63 S111 34, 133 55 S160 78, 180 48 S204 31, 225 53 S247 80, 270 39 S300 50, 330 23" /></svg></div><div className="pulse-foot"><span><i className="legend-line mint" /> Запущено</span><span>{errors ? `${errors} ошиб. ` : ''}{running}/{total}</span></div></animated.aside>;
}

function HeroVisual() {
  const orbitA = useSpring({ from: { turn: 0, scale: 1 }, to: { turn: 360, scale: 1.04 }, loop: { reverse: true }, config: { duration: 18000 } });
  const orbitB = useSpring({ from: { turn: 360, scale: 1.05 }, to: { turn: 0, scale: .96 }, loop: { reverse: true }, config: { duration: 24000 } });
  const core = useSpring({ from: { scale: .92, opacity: .72 }, to: { scale: 1.08, opacity: 1 }, loop: { reverse: true }, config: { duration: 2200 } });
  return <div className="hero-visual">
    <animated.div className="orbit orbit-a" style={{ transform: orbitA.turn.to((turn) => `rotate(${turn}deg) scale(${1 + (turn % 180) / 1800})`) }} />
    <animated.div className="orbit orbit-b" style={{ transform: orbitB.turn.to((turn) => `rotate(${turn - 35}deg) scale(${1 + (turn % 180) / 2200})`) }} />
    <animated.div className="planet-track track-a" style={{ transform: orbitA.turn.to((turn) => `rotate(${turn}deg)`) }}><span className="planet planet-a" /></animated.div>
    <animated.div className="planet-track track-b" style={{ transform: orbitB.turn.to((turn) => `rotate(${turn}deg)`) }}><span className="planet planet-b" /></animated.div>
    <animated.div className="core-glow" style={{ transform: core.scale.to((scale) => `scale(${scale})`), opacity: core.opacity }}><span>✦</span></animated.div>
    <div className="visual-caption"><span className="visual-live"><i /> LIVE</span><span>LOCAL / ENCRYPTED</span></div>
  </div>;
}

function GithubUpdateStrip({ updates, syncing, onSync }: { updates: UpdateInfo[]; syncing: boolean; onSync: () => void }) {
  const latest = updates.filter((item) => item.latestVersion).map((item) => `${item.name} ${item.latestVersion}`).join(' · ');
  const installed = updates.filter((item) => item.status === 'installed').length;
  const downloading = updates.find((item) => item.status === 'downloading');
  const progress = downloading && downloading.totalBytes ? Math.round(((downloading.downloadedBytes ?? 0) / downloading.totalBytes) * 100) : null;
  const failed = updates.find((item) => item.status === 'error');
  return <div className="github-strip"><div className="github-logo">◉</div><div className="github-copy"><strong>Flowseal GitHub · автообновление модулей</strong><span className={failed ? 'github-error' : ''}>{failed?.error || latest || 'Проверяем последние релизы…'}{progress !== null ? ` · загрузка ${progress}%` : ''}{installed ? ` · обновлено: ${installed}` : ''}</span></div><span className="github-lock">Только github.com/Flowseal</span><button className="github-button" disabled={syncing} onClick={onSync}>{syncing ? (progress !== null ? `${progress}%` : 'Синхронизация…') : 'Проверить GitHub'} <span>↗</span></button></div>;
}

function ProfilePopover({ open, profile, draft, setDraft, onSave }: { open: boolean; profile: UserProfile; draft: string; setDraft: (value: string) => void; onSave: () => void }) {
  const spring = useSpring({ opacity: open ? 1 : 0, y: open ? 0 : -8, config: config.gentle });
  return <animated.div className="profile-popover" style={{ opacity: spring.opacity, transform: spring.y.to((y) => `translateY(${y}px)`), pointerEvents: open ? 'auto' : 'none' }}><span className="popover-label">ЛОКАЛЬНЫЙ ПРОФИЛЬ</span><strong>{profile.deviceId || 'NX-LOCAL'}</strong><label>Ваше имя<input autoFocus={open} value={draft} maxLength={32} onChange={(event) => setDraft(event.target.value)} placeholder="Введите имя" /></label><button onClick={onSave}>Сохранить профиль <span>✓</span></button><small>Настройки сохраняются локально и привязаны к этому устройству.</small></animated.div>;
}

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [modules, setModules] = useState<ModuleManifest[]>(DEMO_MODULES);
  const [logs, setLogs] = useState<ModuleLog[]>(DEMO_LOGS);
  const [updates, setUpdates] = useState<UpdateInfo[]>(DEMO_UPDATES);
  // Search is intentionally hidden for now (CSS .search-box already exists).
  // const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [logFilter, setLogFilter] = useState('all');
  const [toast, setToast] = useState('');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [syncing, setSyncing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>({ displayName: '', deviceId: 'NX-LOCAL', deviceName: 'Локальное устройство' });
  const [profileDraft, setProfileDraft] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const desktop = Boolean(window.nexus);

  useEffect(() => {
    let alive = true;
    const api = window.nexus;
    if (!api) {
      const savedName = localStorage.getItem('nexus-display-name') ?? '';
      const deviceId = localStorage.getItem('nexus-device-id') ?? `NX-DEMO-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      localStorage.setItem('nexus-device-id', deviceId);
      setProfile({ displayName: savedName, deviceId, deviceName: 'Локальное устройство' });
      setProfileDraft(savedName);
      try {
        const raw = localStorage.getItem('nexus-settings');
        if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) as AppSettings });
      } catch { /* keep defaults */ }
      return () => { alive = false; };
    }
    void Promise.all([api.getModules(), api.getLogs(), api.getUpdates(), api.getProfile(), api.getSettings(), api.getLastScan(), api.isFullscreen()]).then(([nextModules, nextLogs, nextUpdates, nextProfile, nextSettings, scan, isFull]) => {
      if (!alive) return;
      setModules(nextModules); setLogs(nextLogs); setUpdates(nextUpdates); setProfile(nextProfile); setProfileDraft(nextProfile.displayName);
      setSettings(nextSettings); setLastScan(scan); setFullscreen(isFull);
    }).catch((error: Error) => setToast(error.message));
    const offModules = api.onModulesChanged(setModules);
    const offLogs = api.onLog((log) => setLogs((current) => [log, ...current].slice(0, 200)));
    const offUpdates = api.onUpdatesChanged(setUpdates);
    const offFull = api.onFullscreen(setFullscreen);
    const offScan = api.onScan(setLastScan);
    return () => { alive = false; offModules(); offLogs(); offUpdates(); offFull(); offScan(); };
  }, []);

  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(''), 3600); return () => window.clearTimeout(timeout); }, [toast]);

  const filteredModules = useMemo(() => modules.filter((module) => {
    // const matchesQuery = `${module.name} ${module.description} ${module.category}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = moduleFilter === 'all' || (moduleFilter === 'running' ? module.status === 'running' : module.status !== 'running');
    return matchesFilter;
  }), [modules, moduleFilter]);
  const running = modules.filter((module) => module.status === 'running').length;
  const errors = modules.filter((module) => module.status === 'error').length;
  const healthy = modules.length - errors;
  const visibleLogs = useMemo(() => logFilter === 'all' ? logs : logs.filter((log) => log.id === logFilter), [logs, logFilter]);
  const lastScanLabel = lastScan ? formatTime(lastScan) : 'только что';
  const systemTone: Tone = errors ? 'red' : running ? 'green' : 'muted';
  const systemTitle = errors ? 'Есть ошибки модулей' : running ? 'Контур активен' : 'Система в норме';
  const systemNote = errors ? `${errors} модуль(ей) в ошибке` : running ? `${running} запущено` : 'Ожидание запуска';
  const profileName = profile.displayName || 'Выбрать имя';
  const profileInitial = profile.displayName.trim().charAt(0).toUpperCase() || 'N';

  const handleToggle = async (module: ModuleManifest) => {
    if (module.development) {
      setToast(`${module.name}: интеграция в разработке`);
      return;
    }
    try {
      if (desktop) {
        if (module.status === 'running') await window.nexus?.stopModule(module.id);
        else if (module.status === 'stopped' || module.status === 'error') await window.nexus?.startModule(module.id);
      } else {
        const nextRunning = module.status !== 'running';
        setModules((current) => current.map((item) => item.id === module.id ? { ...item, status: nextRunning ? 'running' : 'stopped', pid: nextRunning ? 4812 : null } : item));
        setLogs((current) => [{ id: module.id, level: nextRunning ? 'success' : 'info', message: nextRunning ? 'Демо-модуль активирован' : 'Демо-модуль остановлен', timestamp: new Date().toISOString() }, ...current]);
      }
    } catch (error) { setToast(error instanceof Error ? error.message : 'Не удалось изменить состояние модуля'); }
  };

  const handleStrategyChange = async (module: ModuleManifest, strategy: string) => {
    try {
      if (desktop) {
        const next = await window.nexus?.setModuleStrategy(module.id, strategy);
        if (next) setModules((current) => current.map((item) => item.id === next.id ? next : item));
      } else {
        setModules((current) => current.map((item) => item.id === module.id ? { ...item, strategy, launch_mode: 'batch' } : item));
      }
      setToast(`Выбрана стратегия ${strategy}`);
    } catch (error) { setToast(error instanceof Error ? error.message : 'Не удалось выбрать стратегию'); }
  };

  const handleReload = async () => {
    try {
      if (desktop) await window.nexus?.reloadModules();
      else setLogs((current) => [{ id: 'system', level: 'success', message: `Повторное сканирование: найдено модулей — ${modules.length}`, timestamp: new Date().toISOString() }, ...current]);
      setLastScan(new Date().toISOString());
      setToast('Модули синхронизированы');
    } catch (error) { setToast(error instanceof Error ? error.message : 'Ошибка сканирования'); }
  };

  const handleSyncUpdates = async () => {
    setSyncing(true);
    try {
      if (desktop) {
        const result = await window.nexus?.syncUpdates();
        if (result) setUpdates(result);
      } else {
        setUpdates((current) => current.map((item) => ({ ...item, status: 'up-to-date', installedVersion: item.latestVersion })));
      }
      setToast('Проверка Flowseal GitHub завершена');
    } catch (error) { setToast(error instanceof Error ? error.message : 'Не удалось проверить GitHub'); }
    finally { setSyncing(false); }
  };

  const handleSaveProfile = async () => {
    const name = profileDraft.trim() || 'Локальный пользователь';
    if (desktop) {
      const next = await window.nexus?.saveProfile(name);
      if (next) setProfile(next);
    } else {
      localStorage.setItem('nexus-display-name', name);
      setProfile((current) => ({ ...current, displayName: name }));
    }
    setProfileDraft(name); setProfileOpen(false); setToast('Профиль сохранён на этом устройстве');
  };

  const persistSettings = async (next: AppSettings) => {
    setSettings(next);
    try {
      if (desktop) {
        const saved = await window.nexus?.saveSettings(next);
        if (saved) setSettings(saved);
      } else {
        localStorage.setItem('nexus-settings', JSON.stringify(next));
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Не удалось сохранить настройки');
    }
  };

  return <div className="app-frame"><WindowBar fullscreen={fullscreen} /><div className="app-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <aside className="sidebar"><div className="brand"><div className="brand-orb"><NexusMark /></div><div><strong>NEXUS</strong><span>NETWORK CONTROL</span></div></div><div className="workspace-selector workspace-static"><span className="workspace-avatar">N</span><div><span className="workspace-label">DEVICE PROFILE · {profile.deviceId}</span><strong>{profile.deviceName || 'Локальное устройство'}</strong></div><span className="workspace-badge">LOCAL</span></div><div className="nav-label">CONTROL CENTER</div><nav>{navItems.map((item) => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); if (item.id === 'settings') setSettingsTab('general'); }}><span className="nav-glyph"><NavGlyph name={item.icon} /></span><span>{item.label}</span>{item.id === 'logs' && logs.length > 0 ? <em>{Math.min(logs.length, 99)}</em> : null}</button>)}</nav><div className="sidebar-bottom"><div className="system-status"><StatusDot tone={systemTone} /><div><span>{systemTitle}</span><small>{systemNote}</small></div></div><div className="version-row"><span>NEXUS v1.0.0</span><span className="online-dot" /> LOCAL</div></div></aside>

    <main className="main-content"><header className="topbar"><div className="breadcrumb"><span>CONTROL CENTER</span><b>/</b><strong>{navItems.find((item) => item.id === page)?.label}</strong></div><div className="top-actions"><button className="circle-button" aria-label="Журнал событий" title="Открыть журнал" onClick={() => setPage('logs')}><span>♢</span>{logs.some((log) => log.level === 'error') ? <i /> : null}</button><div className="profile-wrap"><button className="user-chip" onClick={() => setProfileOpen((value) => !value)}><span className="user-avatar">{profileInitial}</span><span>{profileName}</span><b>⌄</b></button><ProfilePopover open={profileOpen} profile={profile} draft={profileDraft} setDraft={setProfileDraft} onSave={handleSaveProfile} /></div></div></header>

      {page === 'dashboard' && <><section className="hero"><div className="hero-copy"><div className="hero-kicker"><span className="spark-line">✦</span> LOCAL NETWORK ORCHESTRATOR <span className="hero-line" /></div><h1>Сеть, которая<br /><span>работает на тебя.</span></h1><p>Единый центр для спокойного управления сетевыми инструментами,<br />локальными прокси и профилями маршрутизации.</p><div className="hero-actions"><button className="primary-button" onClick={() => setPage('modules')}><span>Открыть модули</span><b>↗</b></button><button className="quiet-button" onClick={handleReload}><span>⟳</span> Сканировать заново</button></div></div><HeroVisual /></section><section className="stats-grid"><StatCard label="ВСЕГО МОДУЛЕЙ" value={String(modules.length).padStart(2, '0')} note="обнаружено локально" icon="◈" tone="cyan" index={0} /><StatCard label="АКТИВНЫЕ" value={String(running).padStart(2, '0')} note={running ? 'контур запущен' : 'готовы к запуску'} icon="ϟ" tone="violet" index={1} /><StatCard label="ЗДОРОВЬЕ" value={`${modules.length ? Math.round((healthy / modules.length) * 100) : 100}%`} note={errors ? `${errors} с ошибкой` : 'без критических ошибок'} icon="⌁" tone="mint" index={2} /><StatCard label="ПОСЛЕДНИЙ СКАН" value={lastScanLabel} note={settings.autoStart ? 'автозапуск включён' : 'автозапуск выключен'} icon="◷" tone="amber" index={3} /></section><section className="section-heading"><div><span className="section-kicker">YOUR TOOLKIT</span><h2>Быстрый доступ</h2></div><button className="text-button" onClick={() => setPage('modules')}>Все модули <span>→</span></button></section><div className="dashboard-grid"><div className="module-grid compact">{filteredModules.slice(0, 4).map((module, index) => <ModuleCard key={module.id} module={module} index={index} onToggle={handleToggle} onStrategyChange={handleStrategyChange} />)}</div><PulsePanel running={running} total={modules.length} errors={errors} /></div></>}

      {page === 'modules' && <section className="page-section"><div className="page-heading"><div><span className="section-kicker">MODULE REGISTRY</span><h1>Все модули</h1><p>Манифесты из <code>./modules</code> · {modules.length} подключено</p></div><button className="primary-button small" onClick={handleReload}><span>⟳</span><b>Сканировать</b></button></div><GithubUpdateStrip updates={updates} syncing={syncing} onSync={handleSyncUpdates} /><div className="filter-row"><span className="filter-label">ФИЛЬТР:</span><button className={`filter-chip ${moduleFilter === 'all' ? 'active' : ''}`} onClick={() => setModuleFilter('all')}>Все <b>{modules.length}</b></button><button className={`filter-chip ${moduleFilter === 'running' ? 'active' : ''}`} onClick={() => setModuleFilter('running')}>Активные <b>{running}</b></button><button className={`filter-chip ${moduleFilter === 'stopped' ? 'active' : ''}`} onClick={() => setModuleFilter('stopped')}>Остановлены <b>{modules.length - running}</b></button></div><div className="module-grid full">{filteredModules.map((module, index) => <ModuleCard key={module.id} module={module} index={index} onToggle={handleToggle} onStrategyChange={handleStrategyChange} />)}</div>{filteredModules.length === 0 && <div className="empty-state"><span>⌕</span><h3>Ничего не найдено</h3><p>Смените фильтр или просканируйте modules ещё раз.</p></div>}</section>}

      {page === 'jey2ray' && <Jey2RayPage settings={settings} updates={updates} syncing={syncing} onSync={handleSyncUpdates} onSettings={(next) => void persistSettings(next)} onToast={setToast} />}

      {page === 'logs' && <section className="page-section"><div className="page-heading"><div><span className="section-kicker">EVENT STREAM</span><h1>Журнал событий</h1><p>Последние сигналы от модулей и NEXUS runtime.</p></div><div className="log-live"><StatusDot tone="green" /> поток в реальном времени</div></div><div className="filter-row"><span className="filter-label">ИСТОЧНИК:</span><button className={`filter-chip ${logFilter === 'all' ? 'active' : ''}`} onClick={() => setLogFilter('all')}>Все <b>{logs.length}</b></button>{['system', ...modules.map((module) => module.id)].map((id) => <button key={id} className={`filter-chip ${logFilter === id ? 'active' : ''}`} onClick={() => setLogFilter(id)}>{id === 'system' ? 'NEXUS' : id}</button>)}</div><div className="logs-card"><div className="logs-toolbar"><span>СЕГОДНЯ</span><span>{visibleLogs.length} событий</span></div>{visibleLogs.length ? visibleLogs.map((log, index) => <LogRow key={`${log.timestamp}-${index}`} log={log} />) : <div className="empty-state"><span>≡</span><h3>Журнал пуст</h3><p>События появятся после запуска модуля.</p></div>}</div></section>}

      {page === 'settings' && <Settings settings={settings} onChange={(next) => void persistSettings(next)} updates={updates} activeTab={settingsTab} onTabChange={setSettingsTab} onToast={setToast} />}
    </main><Toast message={toast} />
  </div></div>;
}

function LogRow({ log }: { log: ModuleLog }) {
  const tone: Tone = log.level === 'success' ? 'green' : log.level === 'error' ? 'red' : log.level === 'warn' ? 'amber' : 'muted';
  return <div className="log-row"><span className="log-time">{formatTime(log.timestamp)}</span><span className={`status-dot ${tone}`} /><span className="log-source">{log.id === 'system' ? 'NEXUS' : log.id}</span><span className="log-message" title={log.message}>{log.message}</span><span className={`log-level ${tone}`}>{log.level}</span></div>;
}

function Settings({ settings, onChange, updates, activeTab, onTabChange, onToast }: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  updates: UpdateInfo[];
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  onToast: (message: string) => void;
}) {
  return <section className="page-section settings-page">
    <div className="page-heading"><div><span className="section-kicker">PREFERENCES</span><h1>Настройки</h1><p>Поведение локального control plane и правила приложений.</p></div></div>
    <div className="settings-tabs" role="tablist" aria-label="Разделы настроек">
      <button type="button" role="tab" aria-selected={activeTab === 'general'} className={`settings-tab ${activeTab === 'general' ? 'active' : ''}`} onClick={() => onTabChange('general')}>
        <span className="settings-tab-icon"><GearIcon /></span><span><strong>Основные</strong><small>Runtime и обновления</small></span>
      </button>
      <button type="button" role="tab" aria-selected={activeTab === 'applications'} className={`settings-tab ${activeTab === 'applications' ? 'active' : ''}`} onClick={() => onTabChange('applications')}>
        <span className="settings-tab-icon applications"><svg viewBox="0 0 24 24" aria-hidden><rect x="4" y="3.5" width="16" height="17" rx="3" /><path d="M8 8h8M8 12h5" /></svg></span><span><strong>Настройки приложений</strong><small>Маршрутизация через VPN</small></span>
      </button>
    </div>

    {activeTab === 'general' ? <div className="settings-tab-panel" role="tabpanel">
      <div className="settings-layout">
        <div className="settings-card"><div className="settings-card-head"><div className="settings-symbol"><GearIcon /></div><div><h3>Runtime</h3><p>Как NEXUS управляет процессами.</p></div></div><SettingRow label="Автозапуск модулей" description="Запускать ранее включённые модули при старте приложения." checked={settings.autoStart} onChange={() => onChange({ ...settings, autoStart: !settings.autoStart })} /><SettingRow label="Уведомления о событиях" description="Системные уведомления при ошибках модулей и сворачивании в трей." checked={settings.notifications} onChange={() => onChange({ ...settings, notifications: !settings.notifications })} /><SettingRow label="Закрывать в трей" description="Крестик прячет окно. Полный выход — из меню трея." checked={settings.closeToTray} onChange={() => onChange({ ...settings, closeToTray: !settings.closeToTray })} /></div>
        <div className="settings-card"><div className="settings-card-head"><div className="settings-symbol violet">◈</div><div><h3>Module registry</h3><p>Релизы с GitHub Flowseal и XTLS/Xray-core.</p></div></div><div className="source-list"><div><span>Flowseal / zapret-discord-youtube</span><b>{updates.find((item) => item.id === 'zapret')?.latestVersion ?? '—'}</b></div><div><span>Flowseal / tg-ws-proxy</span><b>{updates.find((item) => item.id === 'tg-ws-proxy')?.latestVersion ?? '—'}</b></div><div><span>XTLS / Xray-core</span><b>{updates.find((item) => item.id === 'jey2ray')?.latestVersion ?? '—'}</b></div></div><div className="path-setting"><span className="setting-label">ПОЛИТИКА ПРОЦЕССОВ</span><code>shell: false</code><small>stdout и stderr записываются в log_file манифеста.</small></div></div>
      </div>
      <div className="info-callout"><span>i</span><div><strong>Локальный профиль и обновления</strong><p>Имя и device key хранятся только локально. Автообновление принимает только HTTPS-релизы с github.com/Flowseal и сохраняет SHA-256 скачанного файла.</p></div></div>
    </div> : <ApplicationSettings settings={settings} onChange={onChange} onToast={onToast} />}
  </section>;
}

function ApplicationSettings({ settings, onChange, onToast }: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onToast: (message: string) => void;
}) {
  const [runtimeStatus, setRuntimeStatus] = useState<VpnStatus>('disconnected');
  const desktop = Boolean(window.nexus);
  const mode = settings.vpnMode === 'tun' ? 'tun' : 'proxy';
  const splitApps = settings.vpnSplitApps ?? [];
  const storedAppRouting: VpnAppRoutingMode = settings.vpnAppRouting === 'exclude' || settings.vpnAppRouting === 'include'
    ? settings.vpnAppRouting
    : settings.vpnSplitTunnel
      ? 'include'
      : 'system';
  const appRouting: VpnAppRoutingMode = mode === 'tun' && splitApps.length ? storedAppRouting : 'system';
  const routeSettingsLocked = runtimeStatus === 'connecting' || runtimeStatus === 'connected';

  useEffect(() => {
    const api = window.nexus;
    if (!api?.getVpn) return;
    let alive = true;
    void api.getVpn().then((snapshot) => {
      if (alive) setRuntimeStatus(snapshot.runtime.status);
    }).catch((error: Error) => onToast(cleanError(error)));
    const off = api.onVpnChanged((snapshot) => setRuntimeStatus(snapshot.runtime.status));
    return () => { alive = false; off(); };
  }, [onToast]);

  const addSplitApps = async (activate: VpnAppRoutingMode = appRouting) => {
    if (routeSettingsLocked) {
      onToast('Сначала отключи VPN, затем измени список приложений');
      return;
    }
    if (!desktop) {
      onToast('Выбор .exe работает в окне Electron (npm start)');
      return;
    }
    try {
      const picked = await window.nexus?.pickVpnApps();
      if (!picked?.length) return;
      const merged = new Map(splitApps.map((app) => [app.executable.toLocaleLowerCase('en-US'), app]));
      for (const app of picked) merged.set(app.executable.toLocaleLowerCase('en-US'), app);
      onChange({
        ...settings,
        vpnMode: activate === 'system' ? mode : 'tun',
        vpnAppRouting: activate,
        vpnSplitTunnel: activate === 'include',
        vpnSplitApps: [...merged.values()],
      });
    } catch (error) {
      onToast(cleanError(error) || 'Не удалось выбрать приложение');
    }
  };

  const selectAppRouting = (next: VpnAppRoutingMode) => {
    if (routeSettingsLocked) {
      onToast('Сначала отключи VPN, затем измени маршрутизацию приложений');
      return;
    }
    if (next !== 'system' && !splitApps.length) {
      void addSplitApps(next);
      return;
    }
    onChange({
      ...settings,
      vpnMode: next === 'system' ? mode : 'tun',
      vpnAppRouting: next,
      vpnSplitTunnel: next === 'include',
    });
  };

  const removeSplitApp = (executable: string) => {
    if (routeSettingsLocked) {
      onToast('Сначала отключи VPN, затем измени список приложений');
      return;
    }
    const next = splitApps.filter((app) => app.executable !== executable);
    const nextRouting: VpnAppRoutingMode = next.length ? appRouting : 'system';
    onChange({
      ...settings,
      vpnSplitApps: next,
      vpnAppRouting: nextRouting,
      vpnSplitTunnel: nextRouting === 'include',
    });
  };

  return <div className="settings-tab-panel settings-applications-panel" role="tabpanel">
    <div className="settings-applications-intro">
      <div><span>JEY2RAY ROUTING</span><h2>Настройки приложений</h2><p>Управляй автоподключением и маршрутами отдельных программ Windows из общего раздела настроек.</p></div>
      <span className={`app-route-state ${appRouting !== 'system' ? 'is-on' : ''}`}><i />{appRouting !== 'system' ? 'Маршрутизация включена' : 'Общие настройки'}</span>
    </div>

    <div className="app-settings-scroll">
      {routeSettingsLocked && <div className="app-settings-lock">
        <span>i</span>
        <div><strong>VPN сейчас работает</strong><p>Отключи подключение, чтобы изменить маршрутизацию или список приложений.</p></div>
      </div>}

      <section className="app-settings-card auto-settings-card">
        <div className="app-settings-card-head compact">
          <div><span className="settings-step">01</span><div><h3>Автоподключение</h3><p>Запускать последний сервер вместе с NEXUS.</p></div></div>
          <button type="button" className={`settings-toggle ${settings.autoConnectVpn ? 'is-on' : ''}`} onClick={() => onChange({ ...settings, autoConnectVpn: !settings.autoConnectVpn })} aria-label={settings.autoConnectVpn ? 'Выключить автоподключение' : 'Включить автоподключение'}><i /></button>
        </div>
        <div className={`auto-status ${settings.autoConnectVpn ? 'is-on' : ''}`}><i />{settings.autoConnectVpn ? 'Включено' : 'Выключено'}</div>
      </section>

      <section className="app-settings-card routing-settings-card">
        <div className="app-settings-card-head"><div><span className="settings-step">02</span><div><h3>Настройки прокси для приложений</h3><p>Выбери общую политику. Конкретные приложения можно добавить ниже.</p></div></div></div>
        <div className="routing-choice-list" role="radiogroup" aria-label="Режим маршрутизации приложений">
          <button type="button" role="radio" aria-checked={appRouting === 'system'} className={`routing-choice ${appRouting === 'system' ? 'is-active' : ''}`} disabled={routeSettingsLocked} onClick={() => selectAppRouting('system')}><i className="settings-radio" /><span><strong>Системные настройки</strong><small>Без отдельных правил. Используется общий режим {mode === 'tun' ? 'TUN' : 'PROXY'}.</small></span><em>По умолчанию</em></button>
          <button type="button" role="radio" aria-checked={appRouting === 'exclude'} className={`routing-choice ${appRouting === 'exclude' ? 'is-active' : ''}`} disabled={routeSettingsLocked} onClick={() => selectAppRouting('exclude')}><i className="settings-radio" /><span><strong>Прямое подключение для выбранных приложений</strong><small>Выбранные приложения обходят VPN, все остальные идут через VPN.</small></span><em>Исключения</em></button>
          <button type="button" role="radio" aria-checked={appRouting === 'include'} className={`routing-choice ${appRouting === 'include' ? 'is-active' : ''}`} disabled={routeSettingsLocked} onClick={() => selectAppRouting('include')}><i className="settings-radio" /><span><strong>VPN только для выбранных приложений</strong><small>Выбранные приложения идут через VPN, все остальные — напрямую.</small></span><em>Split Tunneling</em></button>
        </div>
      </section>

      <section className="app-settings-card selected-apps-card">
        <div className="app-settings-card-head selected-apps-head">
          <div><span className="settings-step">03</span><div><h3>Выбранные приложения</h3><p>{splitApps.length ? `Добавлено: ${splitApps.length}` : 'Добавь приложения Windows, для которых будут действовать правила выше.'}</p></div></div>
          <button type="button" className="app-add-button" disabled={routeSettingsLocked} onClick={() => void addSplitApps(appRouting)}><svg viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>Добавить приложение</button>
        </div>
        {splitApps.length ? <div className="selected-app-list">
          {splitApps.map((app) => <div className="selected-app-row" key={app.executable.toLocaleLowerCase('en-US')} title={app.path}>
            <span className="selected-app-icon"><svg viewBox="0 0 24 24" aria-hidden><rect x="4" y="3.5" width="16" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 8h8M8 12h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span>
            <span className="selected-app-copy"><strong>{app.executable}</strong><small>{app.path}</small></span>
            <span className={`selected-app-route ${appRouting === 'exclude' ? 'is-direct' : appRouting === 'include' ? 'is-vpn' : ''}`}>{appRouting === 'exclude' ? 'Напрямую' : appRouting === 'include' ? 'Через VPN' : 'Не активно'}</span>
            <button type="button" className="selected-app-remove" disabled={routeSettingsLocked} onClick={() => removeSplitApp(app.executable)} aria-label={`Удалить ${app.executable}`}>×</button>
          </div>)}
        </div> : <div className="selected-app-empty"><span><svg viewBox="0 0 32 32" aria-hidden><rect x="7" y="5" width="18" height="22" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M12 12h8M12 17h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span><strong>Приложения ещё не выбраны</strong><p>Нажми «Добавить приложение» и выбери один или несколько файлов .exe.</p></div>}
      </section>
    </div>
  </div>;
}

function SettingRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return <div className="setting-row"><div><strong>{label}</strong><p>{description}</p></div><Toggle checked={checked} onChange={onChange} /></div>;
}

function Toast({ message }: { message: string }) {
  const spring = useSpring({ opacity: message ? 1 : 0, y: message ? 0 : 12, config: config.gentle });
  return <animated.div className="toast" style={{ opacity: spring.opacity, transform: spring.y.to((y) => `translate(-50%, ${y}px)`) }}><StatusDot tone="green" />{message}</animated.div>;
}

export default App;
