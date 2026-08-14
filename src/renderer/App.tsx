import { useEffect, useMemo, useRef, useState } from 'react';
import { animated, config, useSpring } from '@react-spring/web';
import type { AboutSystemInfo, AppSettings, ModuleLog, ModuleManifest, ModuleStatus, NexusUpdateCheck, UpdateInfo, UserProfile } from '../main/types';
import { DEFAULT_SETTINGS } from '../main/types';
import { Jey2RayPage } from './Jey2RayPage';

type Page = 'dashboard' | 'modules' | 'jey2ray' | 'logs' | 'settings' | 'about';
type LogCategory = 'main' | 'core' | 'tunnel' | 'antifilter' | 'subscriptions' | 'service';
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
  { id: 'logs', label: 'Логи', icon: 'logs' },
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
  return <svg className="nexus-infinity-mark" viewBox="0 0 24 24" aria-hidden="true">
    <path className="nexus-ribbon-shadow" d="M4.2 14.2v-4l3-3 4.8 5.2 4.8-5.2 3 3v4l-3 3-4.8-5.2-4.8 5.2-3-3Z" />
    <path className="nexus-ribbon" d="M4.2 13.6v-4l3-3 4.8 5.2 4.8-5.2 3 3v4l-3 3-4.8-5.2-4.8 5.2-3-3Z" />
    <circle className="nexus-ribbon-core" cx="12" cy="11.8" r="1" />
  </svg>;
}

function NexusShowcaseMark() {
  return <svg className="nexus-showcase-mark" viewBox="0 0 220 170" aria-hidden="true">
    <defs>
      <linearGradient id="showcase-n-front" x1="65" y1="39" x2="154" y2="132" gradientUnits="userSpaceOnUse"><stop stopColor="#92f3b7" /><stop offset="1" stopColor="#39c77d" /></linearGradient>
      <linearGradient id="showcase-n-side" x1="76" y1="58" x2="163" y2="140" gradientUnits="userSpaceOnUse"><stop stopColor="#7e63e8" /><stop offset="1" stopColor="#4c358e" /></linearGradient>
      <linearGradient id="showcase-orbit" x1="35" y1="130" x2="192" y2="42" gradientUnits="userSpaceOnUse"><stop stopColor="#6ee9a2" /><stop offset=".52" stopColor="#a98cff" /><stop offset="1" stopColor="#7154dc" /></linearGradient>
    </defs>
    <ellipse className="showcase-orbit orbit-back" cx="111" cy="87" rx="89" ry="42" transform="rotate(-18 111 87)" />
    <path className="showcase-n-extrusion" d="M66 128V45h27l42 52V45h27v83h-27L93 76v52H66Z" transform="translate(7 7)" />
    <path className="showcase-n-face" d="M66 128V45h27l42 52V45h27v83h-27L93 76v52H66Z" />
    <path className="showcase-n-highlight" d="M76 116V56h12l47 58M145 55v58" />
    <path className="showcase-orbit orbit-front" d="M29 112c24 33 79 42 127 20 31-14 49-36 51-55" />
    <circle className="showcase-orbit-node node-green" cx="31" cy="113" r="5" />
    <circle className="showcase-orbit-node node-violet" cx="196" cy="51" r="4" />
  </svg>;
}

function GearIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.73v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.73l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
  </svg>;
}

function NavGlyph({ name }: { name: string }) {
  if (name === 'home') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></svg>;
  if (name === 'settings') return <GearIcon />;
  if (name === 'jey') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" /><path d="M12 5V2M12 22v-3M5 12H2M22 12h-3M7 7 5 5M19 19l-2-2M17 7l2-2M7 17l-2 2" /></svg>;
  if (name === 'logs') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14M5 12h14M5 19h9" /></svg>;
  if (name === 'about') return <svg className="about-nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle className="about-nav-ring" cx="12" cy="12" r="9" /><path className="about-nav-stem" d="M12 11.25v5.5" /><circle className="about-nav-dot" cx="12" cy="7.25" r="1.2" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="5" height="5" rx="1" /><rect x="14" y="5" width="5" height="5" rx="1" /><rect x="5" y="14" width="5" height="5" rx="1" /><rect x="14" y="14" width="5" height="5" rx="1" /></svg>;
}

function WindowBar({ maximized }: { maximized: boolean }) {
  const maximizeLabel = maximized ? 'Восстановить окно' : 'Развернуть окно';
  return <div className="window-bar">
    <div className="window-drag"><span className="window-brand-mark"><NexusMark /></span><strong>NEXUS</strong><span className="window-separator">/</span><span>Network Control Plane</span></div>
    <div className="window-actions">
      <button type="button" className="window-control minimize" aria-label="Свернуть" title="Свернуть" onClick={() => void window.nexus?.minimizeWindow()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5h10" /></svg></button>
      <button type="button" className="window-control maximize" aria-label={maximizeLabel} title={maximizeLabel} onClick={() => void window.nexus?.toggleMaximize()}><svg viewBox="0 0 16 16" aria-hidden="true">{maximized ? <><rect x="3.5" y="5.5" width="7" height="7" rx=".5" /><path d="M5.5 5.5v-2h7v7h-2" /></> : <rect x="3.5" y="3.5" width="9" height="9" rx=".5" />}</svg></button>
      <button type="button" className="window-control close" aria-label="Закрыть" title="Закрыть" onClick={() => void window.nexus?.closeWindow()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
    </div>
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
  const linear = (value: number) => value;
  const orbitA = useSpring({ from: { turn: -18 }, to: { turn: 342 }, loop: true, config: { duration: 22000, easing: linear } });
  const orbitB = useSpring({ from: { turn: 24 }, to: { turn: 384 }, loop: true, config: { duration: 31000, easing: linear } });
  return <div className="hero-visual" aria-hidden="true">
    <div className="visual-grid" />
    <animated.div className="orbit orbit-a" style={{ transform: orbitA.turn.to((turn) => `rotate(${turn}deg)`) }}><span className="planet planet-a" /><span className="orbit-node orbit-node-a" /></animated.div>
    <animated.div className="orbit orbit-b" style={{ transform: orbitB.turn.to((turn) => `rotate(${turn}deg)`) }}><span className="planet planet-b" /><span className="orbit-node orbit-node-b" /></animated.div>
    <div className="core-glow"><span className="core-ring" /><span className="core-mark"><NexusMark /></span></div>
    <div className="visual-caption"><span className="visual-live"><i /> LIVE</span><span>LOCAL / ENCRYPTED</span></div>
  </div>;
}

function GithubUpdateStrip({ updates, syncing, onSync }: { updates: UpdateInfo[]; syncing: boolean; onSync: () => void }) {
  const latest = updates.filter((item) => item.latestVersion).map((item) => `${item.name} ${item.latestVersion}`).join(' · ');
  const installed = updates.filter((item) => item.status === 'installed').length;
  const downloading = updates.find((item) => item.status === 'downloading');
  const progress = downloading && downloading.totalBytes ? Math.round(((downloading.downloadedBytes ?? 0) / downloading.totalBytes) * 100) : null;
  const failed = updates.find((item) => item.status === 'error');
  return <div className="github-strip"><div className="github-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7.5A7 7 0 0 1 18.2 6L20 8M20 4v4h-4M17 16.5A7 7 0 0 1 5.8 18L4 16m0 4v-4h4" /></svg></div><div className="github-copy"><strong>Обновление сетевых модулей</strong><span className={failed ? 'github-error' : ''}>{failed?.error || latest || 'Проверяются последние релизы…'}{progress !== null ? ` · загрузка ${progress}%` : ''}{installed ? ` · обновлено: ${installed}` : ''}</span></div><span className="github-lock">Проверенные репозитории GitHub</span><button className="github-button" disabled={syncing} onClick={onSync}>{syncing ? (progress !== null ? `${progress}%` : 'Синхронизация…') : 'Проверить обновления'} <span>↗</span></button></div>;
}

function ProfilePopover({ open, profile, draft, setDraft, onSave }: { open: boolean; profile: UserProfile; draft: string; setDraft: (value: string) => void; onSave: () => void }) {
  const spring = useSpring({ opacity: open ? 1 : 0, y: open ? 0 : -8, config: config.gentle });
  return <animated.div className="profile-popover" role="dialog" aria-label="Локальный профиль" aria-hidden={!open} style={{ opacity: spring.opacity, transform: spring.y.to((y) => `translateY(${y}px)`), pointerEvents: open ? 'auto' : 'none', visibility: open ? 'visible' : 'hidden' }}><span className="popover-label">ЛОКАЛЬНЫЙ ПРОФИЛЬ</span><strong>{profile.deviceId || 'NX-LOCAL'}</strong><label>Ваше имя<input autoFocus={open} value={draft} maxLength={32} onChange={(event) => setDraft(event.target.value)} placeholder="Введите имя" /></label><button onClick={onSave}>Сохранить профиль <span>✓</span></button><small>Настройки сохраняются локально и привязаны к этому устройству.</small></animated.div>;
}

const LOG_CATEGORIES: { id: LogCategory; label: string }[] = [
  { id: 'main', label: 'Основной лог' },
  { id: 'core', label: 'Лог ядра' },
  { id: 'tunnel', label: 'Лог туннеля' },
  { id: 'antifilter', label: 'Лог AntiFilter' },
  { id: 'subscriptions', label: 'Лог подписок' },
  { id: 'service', label: 'Лог службы' },
];

function isTunnelLog(log: ModuleLog): boolean {
  return log.id === 'jey2ray' && /\b(?:tun|proxy|vpn)\b|туннел|маршрут|подключ|отключ|задерж|системн/i.test(log.message);
}

function isSubscriptionLog(log: ModuleLog): boolean {
  return log.id === 'jey2ray' && /подпис|subscription|обновлен|импорт|профил|узл/i.test(log.message);
}

function matchesLogCategory(log: ModuleLog, category: LogCategory): boolean {
  if (category === 'main') return true;
  if (category === 'core') return log.id === 'jey2ray' && !isTunnelLog(log) && !isSubscriptionLog(log);
  if (category === 'tunnel') return isTunnelLog(log);
  if (category === 'antifilter') return /zapret|antifilter|anti-filter|обход|\bdpi\b/i.test(`${log.id} ${log.message}`);
  if (category === 'subscriptions') return isSubscriptionLog(log);
  return log.id === 'system' || (log.id !== 'jey2ray' && !/zapret|antifilter|anti-filter/i.test(log.id));
}

function logSourceLabel(id: string): string {
  if (id === 'system') return 'NEXUS';
  if (id === 'jey2ray') return 'Jey2Ray';
  if (id === 'zapret') return 'AntiFilter';
  return id.replace(/[^a-zа-яё0-9_-]/gi, '').slice(0, 24) || 'module';
}

function formatLogTimestamp(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  if (Number.isNaN(date.getTime())) return '--.--.-- --:--:--';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${pad(date.getFullYear() % 100)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function LogsPage({ logs, category, setCategory, onNotice }: { logs: ModuleLog[]; category: LogCategory; setCategory: (category: LogCategory) => void; onNotice: (text: string) => void }) {
  const consoleRef = useRef<HTMLDivElement>(null);
  const visibleLogs = useMemo(() => logs.filter((log) => matchesLogCategory(log, category)).slice().reverse(), [logs, category]);
  const reportText = useMemo(() => visibleLogs.map((log) => `[${formatLogTimestamp(log.timestamp)}] [${logSourceLabel(log.id)}] [${log.level.toUpperCase()}] ${log.message}`).join('\n'), [visibleLogs]);

  const copyReport = async () => {
    if (!reportText) {
      onNotice('В этой категории пока нет событий');
      return;
    }
    try {
      await navigator.clipboard.writeText(`NEXUS LOG REPORT\n${reportText}\n`);
      onNotice('Отчёт логов скопирован в буфер обмена');
    } catch {
      onNotice('Не удалось скопировать отчёт');
    }
  };

  useEffect(() => {
    const consoleElement = consoleRef.current;
    if (consoleElement) consoleElement.scrollTop = consoleElement.scrollHeight;
  }, [category, visibleLogs.length]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        void copyReport();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [reportText]);

  return <section className="page-section logs-page">
    <div className="page-heading logs-heading"><div><span className="section-kicker">RUNTIME CONSOLE</span><h1>Логи</h1><p>Системные события NEXUS в реальном времени.</p></div><button className="logs-report-button" onClick={() => void copyReport()}><NavGlyph name="logs" /> Скопировать отчёт</button></div>
    <div className="logs-hint"><span className="logs-hint-icon">i</span><span>Нажмите <kbd>Ctrl</kbd> + <kbd>R</kbd>, чтобы скопировать отчёт выбранной категории.</span><span className="logs-live-state"><i /> LIVE</span></div>
    <div className="log-source-tabs" role="tablist" aria-label="Источники логов">
      {LOG_CATEGORIES.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={category === tab.id} className={category === tab.id ? 'is-active' : ''} onClick={() => setCategory(tab.id)}>{tab.label}</button>)}
    </div>
    <div className="log-console-shell">
      <div className="log-console-toolbar"><span><i /> NEXUS / {LOG_CATEGORIES.find((tab) => tab.id === category)?.label.toUpperCase()}</span><span>{visibleLogs.length} {visibleLogs.length === 1 ? 'СОБЫТИЕ' : 'СОБЫТИЙ'}</span></div>
      <div className="log-console" ref={consoleRef} role="tabpanel" aria-live="polite">
        {visibleLogs.length ? visibleLogs.map((log, index) => <div className={`log-console-line level-${log.level}`} key={`${log.timestamp}-${log.id}-${index}`}><time>[{formatLogTimestamp(log.timestamp)}]</time><span className="log-console-source">[{logSourceLabel(log.id)}]:</span><span className="log-console-message">{log.message}</span></div>) : <div className="log-console-empty"><span>_</span><strong>Событий пока нет</strong><p>Новые записи появятся здесь автоматически.</p></div>}
      </div>
    </div>
  </section>;
}

function AboutPage() {
  const [info, setInfo] = useState<AboutSystemInfo>({
    nexusVersion: '1.1.1',
    xrayVersion: null,
    singBoxVersion: null,
    hwid: 'NX-LOCAL',
    computer: typeof navigator === 'undefined' ? 'Локальное устройство' : `${navigator.platform || 'Desktop'} · локальное устройство`,
  });
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<NexusUpdateCheck | null>(null);

  useEffect(() => {
    let alive = true;
    if (!window.nexus) {
      setLoadingInfo(false);
      return () => { alive = false; };
    }
    void window.nexus.getAboutInfo()
      .then((next) => { if (alive) setInfo(next); })
      .catch(() => { /* keep safe fallback values */ })
      .finally(() => { if (alive) setLoadingInfo(false); });
    return () => { alive = false; };
  }, []);

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const result = window.nexus
        ? await window.nexus.checkNexusUpdate()
        : {
          status: 'placeholder' as const,
          currentVersion: info.nexusVersion,
          latestVersion: null,
          canInstall: false as const,
          checkedAt: new Date().toISOString(),
          message: 'Канал автоматических обновлений пока не подключён. Установка станет доступна после публикации первого релиза NEXUS.',
        };
      setUpdateCheck(result);
    } catch {
      setUpdateCheck({
        status: 'placeholder',
        currentVersion: info.nexusVersion,
        latestVersion: null,
        canInstall: false,
        checkedAt: new Date().toISOString(),
        message: 'Не удалось обратиться к временному каналу обновлений. Автоматическая установка пока недоступна.',
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const coreValue = (value: string | null) => loadingInfo ? 'Определение…' : value || 'Не обнаружен';
  const checkedAt = updateCheck ? new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(updateCheck.checkedAt)) : null;

  return <section className="page-section about-page">
    <div className="page-heading"><div><span className="section-kicker">ABOUT NEXUS</span><h1>О программе</h1><p>Версии компонентов, сведения об устройстве и обновление NEXUS.</p></div><span className="about-version-pill">VERSION {info.nexusVersion}</span></div>
    <div className="about-hero-card">
      <div className="about-mark"><NexusShowcaseMark /></div>
      <div className="about-hero-copy"><span>NETWORK CONTROL PLANE</span><h2>NEXUS</h2><p>Быстрое управление VPN, маршрутами и локальными сетевыми модулями в одном аккуратном интерфейсе.</p></div>
      <div className="about-build"><span>STABLE CHANNEL</span><strong>{info.nexusVersion}</strong><small>Desktop for Windows</small></div>
    </div>

    <div className="about-system-layout">
      <article className="about-system-card">
        <div className="about-panel-heading"><div className="about-panel-icon"><NavGlyph name="settings" /></div><div><span>СИСТЕМА</span><h3>Техническая информация</h3></div></div>
        <div className="about-system-table">
          <div className="about-system-row"><span>Версия NEXUS</span><strong>{info.nexusVersion}</strong></div>
          <div className="about-system-row"><span>Версия Xray Core</span><strong className={!info.xrayVersion && !loadingInfo ? 'is-missing' : ''}>{coreValue(info.xrayVersion)}</strong></div>
          <div className="about-system-row"><span>Версия sing-box</span><strong className={!info.singBoxVersion && !loadingInfo ? 'is-missing' : ''}>{coreValue(info.singBoxVersion)}</strong></div>
          <div className="about-system-row"><span>HWID</span><div className="about-hwid"><strong>{info.hwid}</strong></div></div>
          <div className="about-system-row about-computer-row"><span>Компьютер / ОС</span><strong>{loadingInfo ? 'Определение…' : info.computer}</strong></div>
        </div>
        <p className="about-local-note"><i /> Данные определяются локально и не отправляются в сеть.</p>
      </article>

      <article className="about-update-card">
        <div className="about-update-badge"><i /> ВРЕМЕННЫЙ КАНАЛ</div>
        <div className="about-update-visual" aria-hidden="true">
          <svg viewBox="0 0 96 96"><rect x="20" y="22" width="56" height="42" rx="8" /><path d="M38 75h20M48 64v11" /><path className="about-update-arrow" d="M35 42a15 15 0 0 1 25-8l4 5m0-10v10H54M61 47a15 15 0 0 1-25 8l-4-5m0 10V50h10" /></svg>
        </div>
        <div className="about-update-copy"><span>ОБНОВЛЕНИЕ NEXUS</span><h3>{updateCheck ? 'Канал пока не подключён' : 'Проверить новую версию'}</h3><p>{updateCheck?.message || `Текущая версия ${info.nexusVersion}. Проверка доступна уже сейчас; автоматическая установка появится вместе с первым релизом.`}</p></div>
        {checkedAt && <div className="about-update-checked"><i /> Проверено сегодня в {checkedAt}</div>}
        <div className="about-update-actions">
          <button type="button" className="about-check-button" disabled={checkingUpdate} onClick={() => void checkUpdate()}>{checkingUpdate ? 'Проверяем…' : updateCheck ? 'Проверить снова' : 'Проверить'}</button>
          <button type="button" className="about-install-button" disabled title="Установка станет доступна после подключения канала релизов">Установить</button>
        </div>
      </article>
    </div>

    <div className="about-footer-card"><div><strong>NEXUS</strong><span>Разработано для безопасной локальной работы</span></div><div><span>ХРАНЕНИЕ</span><strong>Только на устройстве</strong></div><div><span>КАНАЛ</span><strong>Stable</strong></div></div>
  </section>;
}

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [modules, setModules] = useState<ModuleManifest[]>(DEMO_MODULES);
  const [logs, setLogs] = useState<ModuleLog[]>(DEMO_LOGS);
  const [updates, setUpdates] = useState<UpdateInfo[]>(DEMO_UPDATES);
  // Search is intentionally hidden for now (CSS .search-box already exists).
  // const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [logCategory, setLogCategory] = useState<LogCategory>('main');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('nexus-sidebar-collapsed') === 'true'; }
    catch { return false; }
  });
  const [toast, setToast] = useState('');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [syncing, setSyncing] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>({ displayName: '', deviceId: 'NX-LOCAL', deviceName: 'Локальное устройство' });
  const [profileDraft, setProfileDraft] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const profileWrapRef = useRef<HTMLDivElement>(null);
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
    void Promise.all([api.getModules(), api.getLogs(), api.getUpdates(), api.getProfile(), api.getSettings(), api.getLastScan(), api.isMaximized()]).then(([nextModules, nextLogs, nextUpdates, nextProfile, nextSettings, scan, isMax]) => {
      if (!alive) return;
      setModules(nextModules); setLogs(nextLogs); setUpdates(nextUpdates); setProfile(nextProfile); setProfileDraft(nextProfile.displayName);
      setSettings(nextSettings); setLastScan(scan); setMaximized(isMax);
    }).catch((error: Error) => setToast(error.message));
    const offModules = api.onModulesChanged(setModules);
    const offLogs = api.onLog((log) => setLogs((current) => [log, ...current].slice(0, 200)));
    const offUpdates = api.onUpdatesChanged(setUpdates);
    const offMaximized = api.onMaximized(setMaximized);
    const offScan = api.onScan(setLastScan);
    return () => { alive = false; offModules(); offLogs(); offUpdates(); offMaximized(); offScan(); };
  }, []);

  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(''), 3600); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    try { localStorage.setItem('nexus-sidebar-collapsed', String(sidebarCollapsed)); }
    catch { /* preference persistence is optional */ }
  }, [sidebarCollapsed]);
  useEffect(() => {
    if (!profileOpen) return undefined;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && profileWrapRef.current?.contains(target)) return;
      setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileOpen(false);
    };
    const closeOnWindowBlur = () => setProfileOpen(false);
    document.addEventListener('pointerdown', closeOnOutsidePress, true);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('blur', closeOnWindowBlur);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress, true);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('blur', closeOnWindowBlur);
    };
  }, [profileOpen]);
  useEffect(() => { setProfileOpen(false); }, [page]);

  const filteredModules = useMemo(() => modules.filter((module) => {
    // const matchesQuery = `${module.name} ${module.description} ${module.category}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = moduleFilter === 'all' || (moduleFilter === 'running' ? module.status === 'running' : module.status !== 'running');
    return matchesFilter;
  }), [modules, moduleFilter]);
  const running = modules.filter((module) => module.status === 'running').length;
  const errors = modules.filter((module) => module.status === 'error').length;
  const healthy = modules.length - errors;
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
      setToast('Проверка обновлений завершена');
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

  return <div className={`app-frame appearance-${settings.appearance}`}><WindowBar maximized={maximized} /><div className={`app-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}><div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <aside className="sidebar">
      <button type="button" className="sidebar-collapse-button" aria-label={sidebarCollapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'} title={sidebarCollapsed ? 'Развернуть панель' : 'Свернуть панель'} aria-pressed={sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg></button>
      <div className="brand"><div className="brand-orb"><NexusMark /></div><div className="sidebar-copy"><strong>NEXUS</strong><span>NETWORK CONTROL</span></div></div>
      <div className="workspace-selector workspace-static" title={sidebarCollapsed ? (profile.deviceName || 'Локальное устройство') : undefined}><span className="workspace-avatar">N</span><div className="sidebar-copy"><span className="workspace-label">DEVICE PROFILE · {profile.deviceId}</span><strong>{profile.deviceName || 'Локальное устройство'}</strong></div><span className="workspace-badge sidebar-copy">LOCAL</span></div>
      <div className="nav-label sidebar-copy">CONTROL CENTER</div>
      <nav>{navItems.map((item) => <button key={item.id} aria-label={item.label} title={sidebarCollapsed ? item.label : undefined} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}><span className="nav-glyph"><NavGlyph name={item.icon} /></span><span className="nav-item-label sidebar-copy">{item.label}</span>{item.id === 'logs' && logs.length > 0 ? <em className="sidebar-copy">{Math.min(logs.length, 99)}</em> : null}</button>)}</nav>
      <div className="sidebar-bottom">
        <button type="button" aria-label="О программе" title={sidebarCollapsed ? 'О программе' : undefined} className={`nav-item sidebar-about ${page === 'about' ? 'active' : ''}`} onClick={() => setPage('about')}><span className="nav-glyph"><NavGlyph name="about" /></span><span className="nav-item-label sidebar-copy">О программе</span></button>
        <div className="system-status" title={sidebarCollapsed ? `${systemTitle}: ${systemNote}` : undefined}><StatusDot tone={systemTone} /><div className="sidebar-copy"><span>{systemTitle}</span><small>{systemNote}</small></div></div>
        <div className="version-row sidebar-copy"><span>NEXUS v1.1.1</span><span className="online-dot" /> LOCAL</div>
      </div>
    </aside>

    <main className="main-content"><header className="topbar"><div className="breadcrumb"><span>CONTROL CENTER</span><b>/</b><strong>{page === 'about' ? 'О программе' : navItems.find((item) => item.id === page)?.label}</strong></div><div className="top-actions"><button className={`logs-shortcut ${page === 'logs' ? 'is-active' : ''}`} aria-label="Открыть логи" onClick={() => setPage('logs')}><span className="logs-shortcut-icon"><NavGlyph name="logs" /></span><span>Логи</span>{logs.some((log) => log.level === 'error') ? <i /> : null}</button><div className="profile-wrap" ref={profileWrapRef}><button className={`user-chip ${profileOpen ? 'is-open' : ''}`} aria-expanded={profileOpen} aria-haspopup="dialog" onClick={() => setProfileOpen((value) => !value)}><span className="user-avatar">{profileInitial}</span><span>{profileName}</span><span className="profile-chevron"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 7.5 4.5 4.5 4.5-4.5" /></svg></span></button><ProfilePopover open={profileOpen} profile={profile} draft={profileDraft} setDraft={setProfileDraft} onSave={handleSaveProfile} /></div></div></header>

      {page === 'dashboard' && <><section className="hero"><div className="hero-copy"><div className="hero-kicker"><span className="spark-line">✦</span> LOCAL NETWORK ORCHESTRATOR <span className="hero-line" /></div><h1>Сеть, которая<br /><span>остаётся под контролем.</span></h1><p>Единый центр для спокойного управления сетевыми инструментами,<br />локальными прокси и профилями маршрутизации.</p><div className="hero-actions"><button className="primary-button" onClick={() => setPage('modules')}><span>Открыть модули</span><b>↗</b></button><button className="quiet-button" onClick={handleReload}><span>⟳</span> Сканировать заново</button></div></div><HeroVisual /></section><section className="stats-grid"><StatCard label="ВСЕГО МОДУЛЕЙ" value={String(modules.length).padStart(2, '0')} note="обнаружено локально" icon="◈" tone="cyan" index={0} /><StatCard label="АКТИВНЫЕ" value={String(running).padStart(2, '0')} note={running ? 'контур запущен' : 'готовы к запуску'} icon="ϟ" tone="violet" index={1} /><StatCard label="ЗДОРОВЬЕ" value={`${modules.length ? Math.round((healthy / modules.length) * 100) : 100}%`} note={errors ? `${errors} с ошибкой` : 'без критических ошибок'} icon="⌁" tone="mint" index={2} /><StatCard label="ПОСЛЕДНИЙ СКАН" value={lastScanLabel} note={settings.autoStart ? 'автозапуск включён' : 'автозапуск выключен'} icon="◷" tone="amber" index={3} /></section><section className="section-heading"><div><span className="section-kicker">YOUR TOOLKIT</span><h2>Быстрый доступ</h2></div><button className="text-button" onClick={() => setPage('modules')}>Все модули <span>→</span></button></section><div className="dashboard-grid"><div className="module-grid compact">{filteredModules.slice(0, 4).map((module, index) => <ModuleCard key={module.id} module={module} index={index} onToggle={handleToggle} onStrategyChange={handleStrategyChange} />)}</div><PulsePanel running={running} total={modules.length} errors={errors} /></div></>}

      {page === 'modules' && <section className="page-section"><div className="page-heading"><div><span className="section-kicker">MODULE REGISTRY</span><h1>Все модули</h1><p>Манифесты из <code>./modules</code> · {modules.length} подключено</p></div><button className="primary-button small" onClick={handleReload}><span>⟳</span><b>Сканировать</b></button></div><GithubUpdateStrip updates={updates} syncing={syncing} onSync={handleSyncUpdates} /><div className="filter-row"><span className="filter-label">ФИЛЬТР:</span><button className={`filter-chip ${moduleFilter === 'all' ? 'active' : ''}`} onClick={() => setModuleFilter('all')}>Все <b>{modules.length}</b></button><button className={`filter-chip ${moduleFilter === 'running' ? 'active' : ''}`} onClick={() => setModuleFilter('running')}>Активные <b>{running}</b></button><button className={`filter-chip ${moduleFilter === 'stopped' ? 'active' : ''}`} onClick={() => setModuleFilter('stopped')}>Остановлены <b>{modules.length - running}</b></button></div><div className="module-grid full">{filteredModules.map((module, index) => <ModuleCard key={module.id} module={module} index={index} onToggle={handleToggle} onStrategyChange={handleStrategyChange} />)}</div>{filteredModules.length === 0 && <div className="empty-state"><span>⌕</span><h3>Ничего не найдено</h3><p>Смените фильтр или просканируйте modules ещё раз.</p></div>}</section>}

      {page === 'jey2ray' && <Jey2RayPage settings={settings} updates={updates} syncing={syncing} onSync={handleSyncUpdates} onSettings={(next) => void persistSettings(next)} onToast={setToast} />}

      {page === 'logs' && <LogsPage logs={logs} category={logCategory} setCategory={setLogCategory} onNotice={setToast} />}

      {page === 'settings' && <Settings settings={settings} onChange={(next) => void persistSettings(next)} />}
      {page === 'about' && <AboutPage />}
    </main><Toast message={toast} />
  </div></div>;
}

function Settings({ settings, onChange }: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
}) {
  return <section className="page-section settings-page global-settings-page">
    <div className="page-heading"><div><span className="section-kicker">NEXUS PREFERENCES</span><h1>Настройки</h1><p>Глобальные параметры языка, оформления и поведения NEXUS.</p></div></div>

    <div className="global-settings-hero">
      <span className="global-settings-hero-icon"><GearIcon /></span>
      <div><span>ОБЩИЕ НАСТРОЙКИ</span><h2>Интерфейс NEXUS</h2><p>Эти параметры относятся ко всему приложению. Настройки VPN находятся внутри Jey2Ray.</p></div>
      <div className="global-settings-badges"><span>RU</span><span>Тёмная тема</span></div>
    </div>

    <div className="settings-layout global-settings-layout">
      <div className="settings-card global-preferences-card">
        <div className="settings-card-head"><div className="settings-symbol"><GearIcon /></div><div><h3>Язык и оформление</h3><p>Внешний вид всего приложения.</p></div></div>
        <div className="global-preference-row">
          <div><strong>Язык интерфейса</strong><p>Основной язык меню, подсказок и уведомлений.</p></div>
          <span className="global-preference-value">Русский</span>
        </div>
        <div className="global-preference-row">
          <div><strong>Тема</strong><p>Комфортная тёмная тема для длительной работы.</p></div>
          <span className="global-preference-value"><i />Тёмная</span>
        </div>
        <div className="global-preference-row appearance-preference-row">
          <div><strong>Оформление</strong><p>Выберите характер акцентов интерфейса.</p></div>
          <div className="appearance-options" role="radiogroup" aria-label="Оформление NEXUS">
            <button type="button" role="radio" aria-checked={settings.appearance === 'indigo'} className={settings.appearance === 'indigo' ? 'active' : ''} onClick={() => onChange({ ...settings, appearance: 'indigo' })}><i className="indigo" />Индиго</button>
            <button type="button" role="radio" aria-checked={settings.appearance === 'graphite'} className={settings.appearance === 'graphite' ? 'active' : ''} onClick={() => onChange({ ...settings, appearance: 'graphite' })}><i className="graphite" />Графит</button>
          </div>
        </div>
      </div>

      <div className="settings-card global-behavior-card">
        <div className="settings-card-head"><div className="settings-symbol violet">✦</div><div><h3>Поведение NEXUS</h3><p>Общие действия приложения в Windows.</p></div></div>
        <SettingRow label="Автозапуск модулей" description="Запускать ранее включённые модули при старте приложения." checked={settings.autoStart} onChange={() => onChange({ ...settings, autoStart: !settings.autoStart })} />
        <SettingRow label="Уведомления о событиях" description="Показывать системные уведомления об ошибках и важных событиях." checked={settings.notifications} onChange={() => onChange({ ...settings, notifications: !settings.notifications })} />
        <SettingRow label="Закрывать в трей" description="Крестик прячет окно. Полный выход доступен из меню трея." checked={settings.closeToTray} onChange={() => onChange({ ...settings, closeToTray: !settings.closeToTray })} />
      </div>
    </div>

    <div className="info-callout global-settings-note"><span>i</span><div><strong>Настройки модулей разделены</strong><p>Параметры конкретного модуля открываются внутри его страницы. Здесь остаются только общие настройки NEXUS.</p></div></div>
  </section>;
}

function SettingRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return <div className="setting-row"><div><strong>{label}</strong><p>{description}</p></div><Toggle checked={checked} onChange={onChange} /></div>;
}

function Toast({ message }: { message: string }) {
  const spring = useSpring({ opacity: message ? 1 : 0, y: message ? 0 : 12, config: config.gentle });
  return <animated.div className="toast" style={{ opacity: spring.opacity, transform: spring.y.to((y) => `translate(-50%, ${y}px)`) }}><StatusDot tone="green" />{message}</animated.div>;
}

export default App;
