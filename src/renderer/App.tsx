import { useEffect, useMemo, useRef, useState } from 'react';
import { animated, config, useSpring } from '@react-spring/web';
import type { AboutSystemInfo, AppSettings, ModuleLog, ModuleManifest, ModuleStatus, NexusUpdateCheck, UpdateInfo, UserProfile } from '../main/types';
import { DEFAULT_SETTINGS } from '../main/types';
import { createTranslator, dateLocale, setInterfaceLanguage, t as translate } from '../main/i18n';
import { Jey2RayPage } from './Jey2RayPage';
import { ModuleSettings } from './ModuleSettings';

type Page = 'dashboard' | 'modules' | 'jey2ray' | 'logs' | 'settings' | 'about';
type LogCategory = 'main' | 'core' | 'tunnel' | 'antifilter' | 'subscriptions' | 'service';
type Tone = 'green' | 'amber' | 'red' | 'muted';

/**
 * Данные для просмотра интерфейса в браузере (`npm run dev:web`).
 *
 * В настольном приложении они не используются: там до ответа main-процесса
 * показывается состояние загрузки. Раньше эти записи успевали мелькнуть в
 * реальном окне, и пользователь видел выдуманные модули, журнал и обновления.
 */
const DEMO_MODULES: ModuleManifest[] = [
  { id: 'zapret', name: 'Обход DPI', description: 'Открывает YouTube, Discord и другие сайты без VPN.', enabled: false, executable: './bin/winws.exe', args: ['--wf-tcp=80,443', '--hostlist=list.txt'], status: 'stopped', category: 'dpi', icon: '🛡️', pid: null, log_file: './logs/zapret.log' },
  { id: 'tg-ws-proxy', name: 'TG WS Proxy', description: 'Возвращает доступ к Telegram, когда он заблокирован.', enabled: false, executable: './bin/TgWsProxy_windows_7_64bit.exe', args: ['--portable'], status: 'stopped', category: 'proxy', icon: '◈', pid: null, log_file: './logs/tg-ws-proxy.log', working_dir: './bin', healthcheck: { type: 'tcp', host: '127.0.0.1', port: 1443, timeout_ms: 15000 } },
  { id: 'exitlag-sdk', name: 'ExitLag SDK', description: 'Снижает пинг и убирает лаги в онлайн-играх.', enabled: false, executable: './bin/exitlag-sdk.exe', args: ['--profile', 'balanced'], status: 'stopped', category: 'sdk', icon: '✦', pid: null, log_file: './logs/exitlag-sdk.log' },
  { id: 'dns-guard', name: 'DNS Guard', description: 'Защищает от подмены сайтов и рекламы на уровне DNS.', enabled: false, executable: './bin/dns-guard.exe', args: ['--mode', 'secure'], status: 'stopped', category: 'dns', icon: '⌁', pid: null, log_file: './logs/dns-guard.log' },
];

const DEMO_LOGS: ModuleLog[] = [
  { id: 'system', level: 'success', message: 'Сканирование завершено: найдено модулей — 4', timestamp: new Date(Date.now() - 1000 * 60 * 4).toISOString() },
  { id: 'tg-ws-proxy', level: 'info', message: 'Конфигурация готова к запуску', timestamp: new Date(Date.now() - 1000 * 60 * 9).toISOString() },
  { id: 'system', level: 'info', message: 'NEXUS control plane инициализирован', timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString() },
];

const DEMO_UPDATES: UpdateInfo[] = [
  { id: 'zapret', name: 'Обход DPI', repo: 'Flowseal/zapret-discord-youtube', source: 'GitHub', latestVersion: '1.10.1', installedVersion: null, asset: null, status: 'idle' },
  { id: 'tg-ws-proxy', name: 'TG WS Proxy', repo: 'Flowseal/tg-ws-proxy', source: 'GitHub', latestVersion: 'v1.10.0', installedVersion: null, asset: null, status: 'idle' },
];

const navItems: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Обзор', icon: 'home' },
  { id: 'modules', label: 'Модули', icon: 'modules' },
  { id: 'jey2ray', label: 'Jey2Ray', icon: 'jey' },
  { id: 'logs', label: 'Логи', icon: 'logs' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
];

const categoryNames: Record<string, string> = { dpi: 'DPI', proxy: 'PROXY', sdk: 'SDK', dns: 'DNS', other: 'OTHER' };
const DEFAULT_ZAPRET_STRATEGY = 'general (ALT10)';

function statusTone(status: ModuleStatus): Tone {
  if (status === 'running') return 'green';
  if (status === 'error') return 'red';
  if (status === 'starting' || status === 'stopping') return 'amber';
  return 'muted';
}

function statusLabel(status: ModuleStatus): string {
  return translate(({ running: 'Активен', stopped: 'Остановлен', error: 'Ошибка', starting: 'Запуск…', stopping: 'Остановка…' })[status]);
}

function moduleTone(module: ModuleManifest): Tone {
  return module.development ? 'amber' : statusTone(module.status);
}

function moduleLabel(module: ModuleManifest): string {
  return module.development ? translate('В разработке') : statusLabel(module.status);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim();
  // Ошибки приходят из main-процесса готовой строкой по-русски: там текст
  // служит ключом. Перевод применяется здесь — иначе в английском интерфейсе
  // всплывала русская плашка поверх переведённого экрана.
  return translate(text);
}

/** Размер файла обновления: гигабайты для «весит 1.2 GB», мегабайты для остального. */
function formatBytes(value?: number): string {
  if (!value) return '0 MB';
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function IconMark({ children }: { children: string }) {
  return <span className="icon-mark" aria-hidden="true">{children}</span>;
}

/**
 * Значки карточек статистики.
 *
 * Раньше здесь стояли текстовые символы «◈ ϟ ⌁ ◷». Они брались из шрифта:
 * размер и толщина у них разные, часть символов в некоторых шрифтах Windows
 * отсутствует и показывается прямоугольником-заглушкой. Нарисованные значки
 * выглядят одинаково на любой системе и масштабируются без потери чёткости.
 */
/**
 * Значок обновления для кнопок сканирования.
 *
 * Тот же рисунок, что и у кнопки «Обновить» в Jey2Ray: сплошное кольцо со
 * стрелкой. Прежняя версия рисовалась двумя тонкими линиями и на 16 пикселях
 * смотрелась обрубленной палочкой.
 */
function RefreshGlyph() {
  return <svg className="spin-ico" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M11.2 3.15A8.85 8.85 0 1 0 19 7.55l-1.95 1.15A6.55 6.55 0 1 1 11.2 5.45v2.7L17.45 5 11.2.65z" />
  </svg>;
}

function StatGlyph({ name }: { name: string }) {
  if (name === 'modules') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z" />
      <path className="glyph-soft" d="M12 3v18M4 7.5l8 4.5 8-4.5" />
    </svg>;
  }
  if (name === 'active') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13.2 2.6 5 13.4h5.2l-.8 8 8.4-11H12.4l.8-7.8Z" />
    </svg>;
  }
  if (name === 'health') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 12.5h4l2.2-5.6 3 11 2.4-7.2 1.6 1.8h3.8" />
    </svg>;
  }
  // scan
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.2v5.1l3.3 2" />
  </svg>;
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
      <linearGradient id="showcase-n-front" x1="65" y1="39" x2="154" y2="132" gradientUnits="userSpaceOnUse"><stop className="gr-face-a" /><stop className="gr-face-b" offset="1" /></linearGradient>
      <linearGradient id="showcase-n-side" x1="76" y1="58" x2="163" y2="140" gradientUnits="userSpaceOnUse"><stop className="gr-side-a" /><stop className="gr-side-b" offset="1" /></linearGradient>
      <linearGradient id="showcase-orbit" x1="35" y1="130" x2="192" y2="42" gradientUnits="userSpaceOnUse"><stop className="gr-orbit-a" /><stop className="gr-orbit-b" offset=".52" /><stop className="gr-orbit-c" offset="1" /></linearGradient>
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
  const maximizeLabel = maximized ? translate('Восстановить окно') : translate('Развернуть окно');
  return <div className="window-bar">
    <div className="window-drag"><span className="window-brand-mark"><NexusMark /></span><strong>NEXUS</strong><span className="window-separator">/</span><span>Network Control Plane</span></div>
    <div className="window-actions">
      <button type="button" className="window-control minimize" aria-label={translate('Свернуть')} title={translate('Свернуть')} onClick={() => void window.nexus?.minimizeWindow()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5h10" /></svg></button>
      <button type="button" className="window-control maximize" aria-label={maximizeLabel} title={maximizeLabel} onClick={() => void window.nexus?.toggleMaximize()}><svg viewBox="0 0 16 16" aria-hidden="true">{maximized ? <><rect x="3.5" y="5.5" width="7" height="7" rx=".5" /><path d="M5.5 5.5v-2h7v7h-2" /></> : <rect x="3.5" y="3.5" width="9" height="9" rx=".5" />}</svg></button>
      <button type="button" className="window-control close" aria-label={translate('Закрыть')} title={translate('Закрыть')} onClick={() => void window.nexus?.closeWindow()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
    </div>
  </div>;
}

// Пульсация вынесена в CSS: раньше каждая точка крутила бесконечную пружину и
// пересобирала строку box-shadow на каждом кадре, нагружая главный поток даже в
// покое. Композитор справляется с этим сам, без участия JavaScript.
function StatusDot({ tone }: { tone: Tone }) {
  return <span className={`status-dot ${tone}`} />;
}

/*
 * Цвет переключателя раньше задавался прямо здесь, из JavaScript. Из-за этого
 * он оставался зелёным в любом оформлении: оформление живёт в таблице стилей,
 * а вписанный в разметку цвет её перебивает. Теперь из кода приходит только
 * положение бегунка, а цвет и свечение берутся из стиля — и тема их меняет.
 */
function Toggle({ checked, onChange, busy = false, disabled = false }: { checked: boolean; onChange: () => void; busy?: boolean; disabled?: boolean }) {
  const spring = useSpring({ x: checked ? 21 : 0, config: config.gentle });
  return <animated.button className={`toggle ${checked ? 'is-on' : ''}`} aria-label={checked ? translate('Выключить модуль') : translate('Включить модуль')} disabled={busy || disabled} onClick={onChange}><animated.span className="toggle-knob" style={{ transform: spring.x.to((x) => `translateX(${x}px)`) }} /></animated.button>;
}

/**
 * Номер версии модуля для показа.
 *
 * Версия приходит из имени метки релиза GitHub, а разработчики часто уже
 * ставят там «v» — получалось «vv1.10.1». Буква добавляется только когда её нет.
 */
function formatModuleVersion(version: string): string {
  const value = version.trim();
  return /^v/i.test(value) ? value : `v${value}`;
}

function ModuleCard({ module, index, onToggle, onStrategyChange, onOpenSettings, t }: { module: ModuleManifest; index: number; onToggle: (module: ModuleManifest) => void; onStrategyChange: (module: ModuleManifest, strategy: string) => void; onOpenSettings?: (module: ModuleManifest) => void; t: (text: string) => string }) {
  const entry = useSpring({ opacity: 1, y: 0, config: { tension: 240, friction: 24 }, delay: Math.min(index * 65, 260) });
  const isBusy = module.status === 'starting' || module.status === 'stopping';
  const isRunning = module.status === 'running';
  const isDevelopment = Boolean(module.development);
  const tone = moduleTone(module);
  return <animated.article className="module-card" style={{ opacity: entry.opacity, transform: entry.y.to((y) => `translateY(${y}px)`) }}><div className="module-card-inner">
    <div className="card-head"><div className={`module-icon ${module.category}`}><span>{module.icon}</span></div><div className="card-head-copy"><div className="eyebrow-row"><span className="category-chip">{categoryNames[module.category] ?? 'OTHER'}</span><StatusDot tone={tone} /><span className={`status-copy ${tone}`}>{moduleLabel(module)}</span></div><h3>{module.name}</h3></div><div className="card-head-controls">{onOpenSettings && !isDevelopment && <button type="button" className="module-settings-button" aria-label={`${t('Настройки модуля')}: ${module.name}`} title={t('Настройки модуля')} onClick={() => onOpenSettings(module)}><GearIcon /></button>}<Toggle checked={isRunning} busy={isBusy} disabled={isDevelopment} onChange={() => onToggle(module)} /></div></div>
    {(module.id === 'zapret' || module.strategies) && <div className="strategy-summary"><span className="strategy-summary-label">{t('Профиль')}</span><b>{module.strategy ?? Object.keys(module.strategies ?? {})[0] ?? DEFAULT_ZAPRET_STRATEGY}</b>{onOpenSettings && !isDevelopment && <button type="button" className="strategy-summary-link" onClick={() => onOpenSettings(module)}>{t('Изменить')}</button>}</div>}
    <p className={`module-description ${module.status === 'error' ? 'error-copy' : ''} ${isDevelopment ? 'development-copy' : ''}`}>{isDevelopment ? t('Интеграция будет добавлена в следующей версии.') : module.status === 'error' && module.error ? module.error : t(module.description)}</p><div className="card-divider" /><div className="card-foot"><span className="module-meta"><span className="meta-dot" />{isDevelopment ? t('Скоро') : module.pid ? `PID ${module.pid}` : t('Готов к запуску')}{!isDevelopment && module.installed_version ? <em className="module-version" title={t('Установленная версия модуля')}>{formatModuleVersion(module.installed_version)}</em> : null}</span><button className={`module-action ${isDevelopment ? 'is-disabled' : ''}`} disabled={isDevelopment} onClick={() => onToggle(module)}>{isDevelopment ? t('В разработке') : isRunning ? t('Остановить') : isBusy ? t('Подождите') : t('Запустить')} <span>↗</span></button></div>
  </div></animated.article>;
}

/** Заглушки карточек на время загрузки: пустой экран читается как «модулей нет». */
function ModuleSkeletons({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, index) => <div className="module-card module-card-skeleton" key={index} aria-hidden="true">
    <div className="module-card-inner">
      <div className="card-head">
        <span className="skeleton-block skeleton-icon" />
        <div className="card-head-copy">
          <span className="skeleton-block skeleton-line short" />
          <span className="skeleton-block skeleton-line" />
        </div>
      </div>
      <span className="skeleton-block skeleton-line" />
      <span className="skeleton-block skeleton-line short" />
    </div>
  </div>)}</>;
}

function StatCard({ label, value, note, glyph, tone, index, meter }: { label: string; value: string; note: string; glyph: string; tone: string; index: number; meter?: number | null }) {
  const spring = useSpring({ from: { opacity: 0, y: 12 }, to: { opacity: 1, y: 0 }, delay: 100 + index * 70, config: config.gentle });
  return <animated.div className="stat-card-shell" style={{ opacity: spring.opacity, transform: spring.y.to((y) => `translateY(${y}px)`) }}>
    <div className={`stat-card tone-${tone}`}>
      <div className={`stat-icon ${tone}`}><StatGlyph name={glyph} /></div>
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        <strong>{value}</strong>
        <span className="stat-note">{note}</span>
        {/* Полоска показывает величину наглядно: число «73%» само по себе
            ни с чем не сравнивается, а заполненность видна сразу. */}
        {meter != null && <span className="stat-meter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} /></span>}
      </div>
    </div>
  </animated.div>;
}

function PulsePanel({ running, total, errors }: { running: number; total: number; errors: number }) {
  const progress = total ? Math.round((running / total) * 100) : 0;
  const spring = useSpring({ from: { opacity: 0, x: 12 }, to: { opacity: 1, x: 0 }, delay: 260, config: config.gentle });
  return <animated.aside className="pulse-panel" style={{ opacity: spring.opacity, transform: spring.x.to((x) => `translateX(${x}px)`) }}><div className="panel-topline"><span className="mini-label">SYSTEM PULSE</span><span className="live-badge"><StatusDot tone={errors ? 'red' : running ? 'green' : 'muted'} /> {errors ? 'ALERT' : 'LIVE'}</span></div><div className="pulse-title"><div><strong>{errors ? translate('Есть ошибки') : running ? translate('Контур активен') : translate('Контур готов')}</strong><span>{running} {translate('из')} {total} {translate('модулей запущено')}</span></div><span className="pulse-score">{progress}%</span></div><div className="pulse-chart" aria-hidden="true"><svg viewBox="0 0 330 110" preserveAspectRatio="none"><defs><linearGradient id="pulseFill" x1="0" x2="0" y1="0" y2="1"><stop className="gr-pulse-a" offset="0" stopOpacity=".34" /><stop className="gr-pulse-b" offset="1" stopOpacity="0" /></linearGradient></defs><path className="chart-grid" d="M0 22H330 M0 54H330 M0 86H330" /><path className="chart-fill" d="M0 78 C20 76, 23 58, 42 66 S66 94, 87 63 S111 34, 133 55 S160 78, 180 48 S204 31, 225 53 S247 80, 270 39 S300 50, 330 23 L330 110 L0 110 Z" /><path className="chart-line" d="M0 78 C20 76, 23 58, 42 66 S66 94, 87 63 S111 34, 133 55 S160 78, 180 48 S204 31, 225 53 S247 80, 270 39 S300 50, 330 23" /></svg></div><div className="pulse-foot"><span><i className="legend-line mint" /> {translate('Запущено')}</span><span>{errors ? `${errors} ошиб. ` : ''}{running}/{total}</span></div></animated.aside>;
}

// Орбиты вращаются средствами CSS. Две бесконечные пружины держали JavaScript
// занятым всё время, пока открыта главная, и конкурировали с отрисовкой hover.
/**
 * Живой фон оформления «Графит»: светящаяся пыль и лавандовые пятна.
 *
 * Первая версия рисовала сеть узлов со связями. Идея была верной по смыслу —
 * сетевая программа, — но линии тянулись через весь экран и проходили прямо
 * под карточками: фон читался как чертёж поверх интерфейса и мешал.
 * Осталась только пыль: она даёт ощущение глубины и никуда не «ведёт».
 *
 * Разметка статична, всё движение — на CSS. Так его считает видеокарта, а
 * главный поток остаётся свободен: на подвисания и без того жаловались,
 * добавлять к ним расчёт частиц в JavaScript было бы странно.
 *
 * Координаты заданы вручную, а не случайными числами: случайная россыпь при
 * каждом запуске выглядит по-разному, и половина раскладок получается
 * неудачной — частицы сбиваются в кучу или выстраиваются в линию.
 *
 * В других оформлениях узор скрыт: это отличительная черта «Графита».
 */
function NodeWeb() {
  // x, y — доля от размера окна; size — размер в пикселях; d — задержка,
  // чтобы частицы двигались вразнобой, а не пульсировали разом.
  const motes = [
    { x: 6, y: 18, size: 2, d: 0 }, { x: 14, y: 62, size: 1, d: -7 },
    { x: 21, y: 34, size: 3, d: -3 }, { x: 27, y: 81, size: 1, d: -11 },
    { x: 33, y: 12, size: 2, d: -5 }, { x: 38, y: 49, size: 1, d: -14 },
    { x: 44, y: 88, size: 2, d: -2 }, { x: 51, y: 26, size: 1, d: -9 },
    { x: 57, y: 68, size: 3, d: -6 }, { x: 63, y: 41, size: 1, d: -13 },
    { x: 69, y: 15, size: 2, d: -4 }, { x: 74, y: 77, size: 1, d: -10 },
    { x: 80, y: 52, size: 2, d: -1 }, { x: 86, y: 29, size: 1, d: -8 },
    { x: 91, y: 71, size: 3, d: -12 }, { x: 96, y: 44, size: 1, d: -15 },
    { x: 11, y: 92, size: 1, d: -16 }, { x: 47, y: 6, size: 1, d: -18 },
  ];
  return <div className="node-web" aria-hidden="true">
    <span className="node-web-glow one" />
    <span className="node-web-glow two" />
    {motes.map((mote, index) => <i
      key={index}
      className="node-mote"
      style={{
        left: `${mote.x}%`,
        top: `${mote.y}%`,
        width: `${mote.size}px`,
        height: `${mote.size}px`,
        animationDelay: `${mote.d}s`,
      }}
    />)}
  </div>;
}

function HeroVisual() {
  return <div className="hero-visual" aria-hidden="true">
    <div className="visual-grid" />
    <div className="orbit orbit-a"><span className="planet planet-a" /><span className="orbit-node orbit-node-a" /></div>
    <div className="orbit orbit-b"><span className="planet planet-b" /><span className="orbit-node orbit-node-b" /></div>
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
  return <div className="github-strip"><div className="github-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7.5A7 7 0 0 1 18.2 6L20 8M20 4v4h-4M17 16.5A7 7 0 0 1 5.8 18L4 16m0 4v-4h4" /></svg></div><div className="github-copy"><strong>{translate('Обновление сетевых модулей')}</strong><span className={failed ? 'github-error' : ''}>{failed?.error || latest || translate('Проверяются последние релизы…')}{progress !== null ? ` · ${translate('загрузка')} ${progress}%` : ''}{installed ? ` · ${translate('обновлено:')} ${installed}` : ''}</span></div><span className="github-lock">{translate('Проверенные репозитории GitHub')}</span><button className={`github-button ${syncing ? 'is-busy' : ''}`} disabled={syncing} onClick={onSync}>
    {/* Значок обновления вместо символа ↗: тот же, что на кнопках сканирования.
        Во время проверки он вращается — раньше кнопка просто гасла, и было
        непонятно, идёт работа или программа зависла. */}
    <span className="github-button-icon"><RefreshGlyph /></span>
    <span>{syncing ? (progress !== null ? `${progress}%` : translate('Синхронизация…')) : translate('Проверить обновления')}</span>
    {/* Полоска хода загрузки: проценты в подписи мелкие и теряются. */}
    {progress !== null && <i className="github-button-progress" style={{ width: `${progress}%` }} aria-hidden="true" />}
  </button></div>;
}

function ProfilePopover({ open, profile, draft, setDraft, onSave }: { open: boolean; profile: UserProfile; draft: string; setDraft: (value: string) => void; onSave: () => void }) {
  const spring = useSpring({ opacity: open ? 1 : 0, y: open ? 0 : -8, config: config.gentle });
  return <animated.div className="profile-popover" role="dialog" aria-label={translate('Локальный профиль')} aria-hidden={!open} style={{ opacity: spring.opacity, transform: spring.y.to((y) => `translateY(${y}px)`), pointerEvents: open ? 'auto' : 'none', visibility: open ? 'visible' : 'hidden' }}><span className="popover-label">{translate('ЛОКАЛЬНЫЙ ПРОФИЛЬ')}</span><strong>{profile.deviceId || 'NX-LOCAL'}</strong><label>{translate('Ваше имя')}<input autoFocus={open} value={draft} maxLength={32} onChange={(event) => setDraft(event.target.value)} placeholder={translate('Введите имя')} /></label><button onClick={onSave}>{translate('Сохранить профиль')} <span>✓</span></button><small>{translate('Настройки сохраняются локально и привязаны к этому устройству.')}</small></animated.div>;
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

function LogsPage({ logs, category, setCategory, onNotice, t }: { logs: ModuleLog[]; category: LogCategory; setCategory: (category: LogCategory) => void; onNotice: (text: string) => void; t: (text: string) => string }) {
  const consoleRef = useRef<HTMLDivElement>(null);
  const visibleLogs = useMemo(() => logs.filter((log) => matchesLogCategory(log, category)).slice().reverse(), [logs, category]);
  const reportText = useMemo(() => visibleLogs.map((log) => `[${formatLogTimestamp(log.timestamp)}] [${logSourceLabel(log.id)}] [${log.level.toUpperCase()}] ${log.message}`).join('\n'), [visibleLogs]);

  const copyReport = async () => {
    if (!reportText) {
      onNotice(t('В этой категории пока нет событий'));
      return;
    }
    try {
      await navigator.clipboard.writeText(`NEXUS LOG REPORT\n${reportText}\n`);
      onNotice(t('Отчёт логов скопирован в буфер обмена'));
    } catch {
      onNotice(t('Не удалось скопировать отчёт'));
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
    <div className="page-heading logs-heading"><div><span className="section-kicker">{t('КОНСОЛЬ СОБЫТИЙ')}</span><h1>{t('Логи')}</h1><p>{t('Системные события NEXUS в реальном времени.')}</p></div><button className="logs-report-button" onClick={() => void copyReport()}><NavGlyph name="logs" /> {t('Скопировать отчёт')}</button></div>
    <div className="logs-hint"><span className="logs-hint-icon">i</span><span>{t('Нажмите')} <kbd>Ctrl</kbd> + <kbd>R</kbd>{t(', чтобы скопировать отчёт выбранной категории.')}</span><span className="logs-live-state"><i /> LIVE</span></div>
    <div className="log-source-tabs" role="tablist" aria-label={t('Источники логов')}>
      {LOG_CATEGORIES.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={category === tab.id} className={category === tab.id ? 'is-active' : ''} onClick={() => setCategory(tab.id)}>{t(tab.label)}</button>)}
    </div>
    <div className="log-console-shell">
      <div className="log-console-toolbar"><span><i /> NEXUS / {t(LOG_CATEGORIES.find((tab) => tab.id === category)?.label ?? '').toUpperCase()}</span><span>{visibleLogs.length} {visibleLogs.length === 1 ? t('СОБЫТИЕ') : t('СОБЫТИЙ')}</span></div>
      <div className="log-console" ref={consoleRef} role="tabpanel" aria-live="polite">
        {visibleLogs.length ? visibleLogs.map((log, index) => <div className={`log-console-line level-${log.level}`} key={`${log.timestamp}-${log.id}-${index}`}><time>[{formatLogTimestamp(log.timestamp)}]</time><span className="log-console-source">[{logSourceLabel(log.id)}]:</span><span className="log-console-message">{log.message}</span></div>) : <div className="log-console-empty"><span>_</span><strong>{t('Событий пока нет')}</strong><p>{t('Новые записи появятся здесь автоматически.')}</p></div>}
      </div>
    </div>
  </section>;
}

/**
 * Карточка сообщества.
 *
 * Пользователю негде было узнать, что вышла новая версия или почему что-то не
 * работает: он оставался один на один с программой. Кнопка ведёт в канал, где
 * это публикуется. Ссылку открывает main-процесс: окно программы работает с
 * правами администратора, и сторонняя страница внутри него — лишний риск.
 */
/**
 * Значки площадок в фирменных цветах.
 *
 * Контурные значки в один цвет читались хуже: обе кнопки выглядели одинаково,
 * и понять, где какая площадка, можно было только по подписи. Здесь взяты
 * официальные формы логотипов и родные цвета — Telegram узнаётся по голубому
 * самолётику, Discord по фиолетовому силуэту.
 *
 * Логотипы нарисованы контурами прямо в коде, а не подгружаются картинками:
 * так они остаются чёткими при любом масштабе и не тянут за собой файлы.
 */
function CommunityGlyph({ id }: { id: string }) {
  if (id === 'discord') {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="community-item-glyph brand-discord">
      <path fill="#5865F2" d="M20.32 4.94A19.8 19.8 0 0 0 15.43 3.4a.07.07 0 0 0-.08.04c-.21.38-.44.87-.61 1.26a18.3 18.3 0 0 0-5.48 0 12.6 12.6 0 0 0-.62-1.26.08.08 0 0 0-.08-.04c-1.71.3-3.35.81-4.89 1.54a.07.07 0 0 0-.03.03C.44 9.6-.26 14.13.08 18.61c0 .02.02.05.04.06a19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .09-.03c.46-.63.87-1.3 1.23-2a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.89.08.08 0 0 1 0-.13l.37-.29a.07.07 0 0 1 .08 0 14.2 14.2 0 0 0 12.06 0 .07.07 0 0 1 .08 0l.37.3a.08.08 0 0 1 0 .12c-.6.35-1.22.65-1.87.89a.08.08 0 0 0-.04.11c.36.7.78 1.36 1.23 2a.08.08 0 0 0 .09.03 19.9 19.9 0 0 0 6.02-3.03.08.08 0 0 0 .03-.06c.4-5.18-.67-9.67-2.85-13.64a.06.06 0 0 0-.03-.03ZM8.02 15.88c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42Zm7.98 0c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42Z" />
    </svg>;
  }
  // Telegram: белый самолётик на голубом круге — так его узнают с первого взгляда.
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="community-item-glyph brand-telegram">
    <defs>
      <linearGradient id="tg-brand" x1="12" y1="1" x2="12" y2="23" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#37BBFE" /><stop offset="1" stopColor="#007DBB" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="11" fill="url(#tg-brand)" />
    <path fill="#fff" d="M5.9 11.9c3.4-1.5 5.7-2.5 6.8-2.9 3.3-1.4 3.9-1.6 4.3-1.6.1 0 .3 0 .4.1.1.1.1.2.2.3v.5c-.3 2.6-1 6.3-1.3 8-.2.7-.4 1-.7 1-.6.1-1-.4-1.6-.8l-2.3-1.5c-1-.7-.4-1 .2-1.6.2-.2 3-2.7 3-2.9v-.2c-.1-.1-.2 0-.3 0-.2 0-2 1.2-5.4 3.6-.5.3-1 .5-1.3.5-.5 0-1.3-.3-2-.5-.8-.3-1.4-.4-1.4-.8.1-.3.5-.5 1.4-.9Z" />
  </svg>;
}

function CommunityCard({ t }: { t: (text: string) => string }) {
  const [links, setLinks] = useState<{ id: string; title: string; description: string; url: string }[]>([]);

  useEffect(() => {
    let active = true;
    void window.nexus?.getCommunityLinks().then((result) => { if (active) setLinks(result ?? []); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!links.length) return null;

  return <article className="about-community-card">
    <div className="about-panel-heading">
      <div className="about-panel-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="community-glyph"><path d="M3.6 11.4 20 5.2 17.1 19.4l-4.9-3.4-2.6 2.5-.5-4.1z" /><path d="m9.1 14.4 8-6.4-9.6 5.1" /></svg>
      </div>
      <div><span>{t('СООБЩЕСТВО')}</span><h3>{t('Связь с автором')}</h3></div>
    </div>
    <p className="about-community-lead">{t('Новости и обновления — в канале. С вопросом или проблемой можно написать напрямую.')}</p>
    <div className="about-community-links">
      {links.map((link) => <button
        key={link.id}
        type="button"
        className="about-community-button"
        onClick={() => void window.nexus?.openCommunityLink(link.url)}
      >
        <span className="about-community-button-icon"><CommunityGlyph id={link.id} /></span>
        <span className="about-community-button-copy">
          <strong>{t(link.title)}</strong>
          <span>{t(link.description)}</span>
        </span>
      </button>)}
    </div>
  </article>;
}

function AboutPage({ t }: { t: (text: string) => string }) {
  const [info, setInfo] = useState<AboutSystemInfo>({
    nexusVersion: __APP_VERSION__,
    xrayVersion: null,
    singBoxVersion: null,
    hwid: 'NX-LOCAL',
    computer: typeof navigator === 'undefined' ? translate('Локальное устройство') : `${navigator.platform || 'Desktop'} · ${translate('локальное устройство')}`,
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

  // Состояние приходит из main-процесса: прогресс загрузки обновляется событиями,
  // поэтому локальную копию держать нельзя — она разойдётся с реальностью.
  useEffect(() => {
    const api = window.nexus;
    if (!api?.getNexusUpdateState) return undefined;
    void api.getNexusUpdateState().then(setUpdateCheck).catch(() => undefined);
    return api.onNexusUpdateChanged(setUpdateCheck);
  }, []);

  const runUpdateAction = async (action: 'check' | 'download' | 'install') => {
    const api = window.nexus;
    if (!api) {
      setUpdateCheck({
        status: 'disabled',
        currentVersion: info.nexusVersion,
        latestVersion: null,
        canInstall: false,
        checkedAt: new Date().toISOString(),
        message: t('Обновление доступно только в установленной версии приложения.'),
      });
      return;
    }
    setCheckingUpdate(true);
    try {
      const result = action === 'check'
        ? await api.checkNexusUpdate()
        : action === 'download'
          ? await api.downloadNexusUpdate()
          : await api.installNexusUpdate();
      setUpdateCheck(result);
    } catch (error) {
      setUpdateCheck({
        status: 'error',
        currentVersion: info.nexusVersion,
        latestVersion: null,
        canInstall: false,
        checkedAt: new Date().toISOString(),
        message: cleanError(error),
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const coreValue = (value: string | null) => loadingInfo ? t('Определение…') : value || t('Не обнаружен');
  const updateStatus = updateCheck?.status ?? 'idle';
  const updateBadge = ({
    idle: t('СТАБИЛЬНАЯ ВЕРСИЯ'),
    checking: t('ПРОВЕРКА'),
    available: t('ДОСТУПНО ОБНОВЛЕНИЕ'),
    downloading: t('ЗАГРУЗКА'),
    downloaded: t('ГОТОВО К УСТАНОВКЕ'),
    'up-to-date': t('АКТУАЛЬНАЯ ВЕРСИЯ'),
    disabled: t('КАНАЛ НЕДОСТУПЕН'),
    error: t('ОШИБКА ПРОВЕРКИ'),
  } as Record<string, string>)[updateStatus] ?? t('СТАБИЛЬНАЯ ВЕРСИЯ');
  const updateHeadline = ({
    idle: t('Проверить новую версию'),
    checking: t('Проверяем обновления…'),
    available: `${t('Доступна версия')} ${updateCheck?.latestVersion ?? ''}`.trim(),
    downloading: t('Загружаем обновление'),
    downloaded: t('Обновление готово'),
    'up-to-date': t('У вас последняя версия'),
    disabled: t('Обновление недоступно'),
    error: t('Не удалось проверить обновления'),
  } as Record<string, string>)[updateStatus] ?? t('Проверить новую версию');
  // Формат времени тоже зависит от языка: в английском режиме «14:05» уместнее
  // показать по правилам en-GB, а не ru-RU.
  const checkedAt = updateCheck ? new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(updateCheck.checkedAt)) : null;

  return <section className="page-section about-page">
    <div className="page-heading"><div><span className="section-kicker">{t('О ПРОГРАММЕ')}</span><h1>{t('О программе')}</h1><p>{t('Версии компонентов, сведения об устройстве и обновление NEXUS.')}</p></div><span className="about-version-pill">{t('ВЕРСИЯ')} {info.nexusVersion}</span></div>
    <div className="about-hero-card">
      <div className="about-mark"><NexusShowcaseMark /></div>
      <div className="about-hero-copy"><span>{t('УПРАВЛЕНИЕ СЕТЬЮ')}</span><h2>NEXUS</h2><p>{t('Быстрое управление VPN, маршрутами и локальными сетевыми модулями в одном аккуратном интерфейсе.')}</p></div>
      <div className="about-build"><span>{t('СТАБИЛЬНАЯ ВЕРСИЯ')}</span><strong>{info.nexusVersion}</strong><small>{t('Для Windows')}</small></div>
    </div>

    <div className="about-system-layout">
      <article className="about-system-card">
        <div className="about-panel-heading"><div className="about-panel-icon"><NavGlyph name="settings" /></div><div><span>{t('СИСТЕМА')}</span><h3>{t('Техническая информация')}</h3></div></div>
        <div className="about-system-table">
          <div className="about-system-row"><span>{t('Версия NEXUS')}</span><strong>{info.nexusVersion}</strong></div>
          <div className="about-system-row"><span>{t('Версия Xray Core')}</span><strong className={!info.xrayVersion && !loadingInfo ? 'is-missing' : ''}>{coreValue(info.xrayVersion)}</strong></div>
          <div className="about-system-row"><span>{t('Версия sing-box')}</span><strong className={!info.singBoxVersion && !loadingInfo ? 'is-missing' : ''}>{coreValue(info.singBoxVersion)}</strong></div>
          <div className="about-system-row"><span>HWID</span><div className="about-hwid"><strong>{info.hwid}</strong></div></div>
          <div className="about-system-row about-computer-row"><span>{t('Компьютер / ОС')}</span><strong>{loadingInfo ? t('Определение…') : info.computer}</strong></div>
        </div>
        <p className="about-local-note"><i /> {t('Данные определяются локально и не отправляются в сеть.')}</p>
      </article>

      <article className="about-update-card">
        <div className={`about-update-badge status-${updateStatus}`}><i /> {updateBadge}</div>
        <div className="about-update-visual" aria-hidden="true">
          <svg viewBox="0 0 96 96"><rect x="20" y="22" width="56" height="42" rx="8" /><path d="M38 75h20M48 64v11" /><path className="about-update-arrow" d="M35 42a15 15 0 0 1 25-8l4 5m0-10v10H54M61 47a15 15 0 0 1-25 8l-4-5m0 10V50h10" /></svg>
        </div>
        <div className="about-update-copy"><span>{t('ОБНОВЛЕНИЕ NEXUS')}</span><h3>{updateHeadline}</h3><p>{(updateCheck?.message && t(updateCheck.message)) || `Текущая версия ${info.nexusVersion}. Нажмите «Проверить», чтобы узнать о новой.`}</p></div>
        {updateStatus === 'downloading' && <div className="about-update-progress-block">
          {/* Полоска была плоской заливкой и выглядела дёшево. Теперь по ней
              бежит светящаяся комета, а сама заливка переливается — видно, что
              загрузка идёт, даже когда процент меняется редко. */}
          {/* Самолётик летит над полосой и тянет за собой след. Позиция
              задаётся процентом загрузки, поэтому движение честное: он
              действительно показывает, сколько пройдено. */}
          <div className="about-update-flight" style={{ ['--nx-progress' as string]: `${Math.round(updateCheck?.percent ?? 0)}%` }}>
            <span className="about-update-plane">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12.2 21 4.6l-5.1 15.2-3.6-5.3-2.6 3.1-.5-4.6z" /><path d="m9.9 13.6 8-6.8" /></svg>
            </span>
          </div>
          <div className="about-update-progress">
            <div className="about-update-progress-bar" style={{ width: `${Math.round(updateCheck?.percent ?? 0)}%` }}>
              <span className="about-update-spark" />
            </div>
            {/* Насечки делают полосу «мерной»: видно четверти пути, а не просто
                цветную заливку неизвестной длины. */}
            <span className="about-update-ticks" aria-hidden="true" />
          </div>
          <div className="about-update-progress-meta">
            <strong>{Math.round(updateCheck?.percent ?? 0)}%</strong>
            {updateCheck?.totalBytes ? <span>{formatBytes(updateCheck.downloadedBytes ?? 0)} / {formatBytes(updateCheck.totalBytes)}</span> : null}
          </div>
        </div>}
        {updateStatus === 'downloaded' && <div className="about-update-landed">
          <span className="about-update-landed-mark">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path className="about-update-tick" d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          </span>
          <span>{t('Загружено — можно устанавливать')}</span>
        </div>}
        {updateCheck?.releaseNotes && <p className="about-update-notes">{updateCheck.releaseNotes}</p>}
        {checkedAt && <div className="about-update-checked"><i /> {t('Проверено в')} {checkedAt}</div>}
        {/* Три шага показывают весь путь целиком. Раньше состояние читалось
            только по подписи кнопки, и было неясно, что произойдёт после
            нажатия — особенно на шаге установки. */}
        <div className="about-update-actions">
          <button type="button" className="about-check-button" disabled={checkingUpdate || updateStatus === 'downloading'} onClick={() => void runUpdateAction('check')}>{checkingUpdate && updateStatus !== 'downloading' ? t('Проверяем…') : updateCheck ? t('Проверить снова') : t('Проверить')}</button>
          {updateStatus === 'available' && <button type="button" className="about-install-button is-ready" disabled={checkingUpdate} onClick={() => void runUpdateAction('download')}>{t('Скачать')}</button>}
          {updateStatus === 'downloaded' && <button type="button" className="about-install-button is-ready" onClick={() => void runUpdateAction('install')}>{t('Перезапустить и установить')}</button>}
          {updateStatus !== 'available' && updateStatus !== 'downloaded' && <button type="button" className="about-install-button" disabled title={updateStatus === 'disabled' ? t('Канал обновлений недоступен в этой сборке') : t('Сначала проверьте наличие обновления')}>{t('Установить')}</button>}
        </div>
      </article>
    </div>

    <CommunityCard t={t} />

    <article className="about-license-card">
      <div className="about-panel-heading"><div className="about-panel-icon"><NavGlyph name="about" /></div><div><span>{t('ПРАВОВАЯ ИНФОРМАЦИЯ')}</span><h3>{t('Лицензии')}</h3></div></div>
      <p className="about-license-lead">{t('NEXUS — проприетарное программное обеспечение. Copyright © 2026 NEXUS. Все права защищены.')}</p>
      <div className="about-license-list">
        <div className="about-license-row"><span>Xray-core</span><strong>MPL-2.0</strong></div>
        <div className="about-license-row"><span>sing-box</span><strong>GPL-3.0</strong></div>
        <div className="about-license-row"><span>Zapret</span><strong>MIT</strong></div>
        <div className="about-license-row"><span>TG WS Proxy</span><strong>MIT</strong></div>
        <div className="about-license-row"><span>Electron, React</span><strong>MIT</strong></div>
        <div className="about-license-row"><span>Inter, JetBrains Mono, Space Grotesk</span><strong>OFL-1.1</strong></div>
      </div>
      <p className="about-license-note">{t('Сетевые ядра и модули — самостоятельные программы сторонних разработчиков. Они загружаются с официальных репозиториев и запускаются отдельными процессами. Полный перечень условий приведён в файле THIRD-PARTY-NOTICES.md рядом с приложением.')}</p>
    </article>

    <div className="about-footer-card"><div><strong>NEXUS</strong><span>{t('Разработано для безопасной локальной работы')}</span></div><div><span>{t('ХРАНЕНИЕ')}</span><strong>{t('Только на устройстве')}</strong></div><div><span>{t('КАНАЛ')}</span><strong>Stable</strong></div></div>
  </section>;
}

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  // window.nexus есть только в настольном приложении. В браузере показываем
  // демо-набор, в приложении — пустые списки до ответа main-процесса.
  const isDesktop = typeof window !== 'undefined' && Boolean(window.nexus);
  const [modules, setModules] = useState<ModuleManifest[]>(isDesktop ? [] : DEMO_MODULES);
  const [logs, setLogs] = useState<ModuleLog[]>(isDesktop ? [] : DEMO_LOGS);
  const [updates, setUpdates] = useState<UpdateInfo[]>(isDesktop ? [] : DEMO_UPDATES);
  // До первого ответа main-процесса интерфейс не должен выглядеть как «модулей нет».
  const [loadingModules, setLoadingModules] = useState(isDesktop);
  // Отдельно от loadingModules: тот описывает только первую загрузку списка,
  // а значок на кнопке должен крутиться при каждом повторном сканировании.
  const [scanning, setScanning] = useState(false);
  // Search is intentionally hidden for now (CSS .search-box already exists).
  // const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [settingsModuleId, setSettingsModuleId] = useState<string | null>(null);
  const [logCategory, setLogCategory] = useState<LogCategory>('main');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('nexus-sidebar-collapsed') === 'true'; }
    catch { return false; }
  });
  const [toast, setToast] = useState('');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  // Перевод интерфейса: словарь выбирается по языку из настроек.
  const t = useMemo(() => {
    // Язык задаётся глобально: вложенные экраны берут перевод функцией t из
    // модуля, без передачи через свойства — так его нельзя случайно потерять.
    setInterfaceLanguage(settings.language);
    return createTranslator(settings.language);
  }, [settings.language]);
  // Найденное при запуске обновление: отмечается точкой у пункта «О программе».
  // Ничего не скачивается само — решение принимает пользователь.
  const [updateReady, setUpdateReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    const api = window.nexus;
    if (!api?.onNexusUpdateChanged) return undefined;
    const remember = (state: NexusUpdateCheck) => {
      setUpdateReady(state.status === 'available' || state.status === 'downloaded');
    };
    void api.getNexusUpdateState?.().then(remember).catch(() => undefined);
    return api.onNexusUpdateChanged(remember);
  }, []);

  const [maximized, setMaximized] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>({ displayName: '', deviceId: 'NX-LOCAL', deviceName: translate('Локальное устройство') });
  const [profileDraft, setProfileDraft] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const profileWrapRef = useRef<HTMLDivElement>(null);
  // Прокручивается не окно, а область содержимого: у неё own overflow-y.
  // Через window.scrollTo вернуть страницу наверх не получилось бы вовсе.
  const mainContentRef = useRef<HTMLElement>(null);
  const desktop = Boolean(window.nexus);

  useEffect(() => {
    let alive = true;
    const api = window.nexus;
    if (!api) {
      const savedName = localStorage.getItem('nexus-display-name') ?? '';
      const deviceId = localStorage.getItem('nexus-device-id') ?? `NX-DEMO-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      localStorage.setItem('nexus-device-id', deviceId);
      setProfile({ displayName: savedName, deviceId, deviceName: translate('Локальное устройство') });
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
    }).catch((error: Error) => setToast(error.message)).finally(() => {
      if (alive) setLoadingModules(false);
    });
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
  const lastScanLabel = lastScan ? formatTime(lastScan) : t('только что');
  const systemTone: Tone = errors ? 'red' : running ? 'green' : 'muted';
  const systemTitle = errors ? t('Есть ошибки модулей') : running ? t('Контур активен') : t('Система в норме');
  const systemNote = errors ? `${errors} ${t('модуль(ей) в ошибке')}` : running ? `${running} ${t('запущено')}` : t('Ожидание запуска');
  const profileName = profile.displayName || t('Выбрать имя');
  const profileInitial = profile.displayName.trim().charAt(0).toUpperCase() || 'N';

  const handleToggle = async (module: ModuleManifest) => {
    if (module.development) {
      setToast(`${module.name}: ${t('интеграция в разработке')}`);
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
    } catch (error) { setToast(error instanceof Error ? error.message : t('Не удалось изменить состояние модуля')); }
  };

  // Карточка берётся из актуального списка, поэтому статус и профиль в панели
  // настроек обновляются вместе с модулем, без отдельной копии состояния.
  const settingsModule = settingsModuleId ? modules.find((item) => item.id === settingsModuleId) ?? null : null;

  useEffect(() => {
    if (page !== 'modules' && page !== 'dashboard') setSettingsModuleId(null);
  }, [page]);

  /**
   * Переход по пункту меню.
   *
   * Раньше нажатие на пункт, который уже открыт, не делало ничего. Из настроек
   * модуля кнопка «Модули» в боковой панели выглядела нажимаемой, но экран не
   * менялся — казалось, что интерфейс завис. Теперь повторное нажатие
   * возвращает раздел к началу: закрывает настройки модуля и прокручивает
   * страницу наверх. Это привычное поведение — так же ведут себя вкладки в
   * браузере и мобильных приложениях.
   */
  const openPage = (next: Page) => {
    if (page === next) {
      if (next === 'modules') setSettingsModuleId(null);
      mainContentRef.current?.scrollTo({ top: 0, behavior: settings.motion === 'reduced' ? 'auto' : 'smooth' });
      return;
    }
    setPage(next);
  };

  // Из «Быстрого доступа» настройки открываются без захода в раздел модулей.
  const openModuleSettings = (module: ModuleManifest) => {
    setSettingsModuleId(module.id);
    setPage('modules');
  };

  const handleStrategyChange = async (module: ModuleManifest, strategy: string) => {
    try {
      if (desktop) {
        const next = await window.nexus?.setModuleStrategy(module.id, strategy);
        if (next) setModules((current) => current.map((item) => item.id === next.id ? next : item));
      } else {
        setModules((current) => current.map((item) => item.id === module.id ? { ...item, strategy, launch_mode: 'batch' } : item));
      }
      setToast(`${t('Выбрана стратегия')} ${strategy}`);
    } catch (error) { setToast(error instanceof Error ? error.message : t('Не удалось выбрать стратегию')); }
  };

  const handleReload = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      if (desktop) await window.nexus?.reloadModules();
      else setLogs((current) => [{ id: 'system', level: 'success', message: `${t('Повторное сканирование: найдено модулей —')} ${modules.length}`, timestamp: new Date().toISOString() }, ...current]);
      setLastScan(new Date().toISOString());
      setToast(t('Модули синхронизированы'));
    } catch (error) { setToast(error instanceof Error ? error.message : t('Ошибка сканирования')); }
    finally {
      // Оборот значка длится 1.1 с. Если ответ пришёл мгновенно, анимация
      // оборвалась бы на середине и выглядела бы дёрганой — даём ей доиграть.
      window.setTimeout(() => setScanning(false), 1100);
    }
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
      setToast(t('Проверка обновлений завершена'));
    } catch (error) { setToast(error instanceof Error ? error.message : t('Не удалось проверить GitHub')); }
    finally { setSyncing(false); }
  };

  const handleSaveProfile = async () => {
    const name = profileDraft.trim() || t('Локальный пользователь');
    if (desktop) {
      const next = await window.nexus?.saveProfile(name);
      if (next) setProfile(next);
    } else {
      localStorage.setItem('nexus-display-name', name);
      setProfile((current) => ({ ...current, displayName: name }));
    }
    setProfileDraft(name); setProfileOpen(false); setToast(t('Профиль сохранён на этом устройстве'));
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
      setToast(error instanceof Error ? error.message : t('Не удалось сохранить настройки'));
    }
  };

  return <div className={`app-frame appearance-${settings.appearance} ${settings.motion === 'full' ? 'motion-force' : ''} ${settings.motion === 'reduced' ? 'motion-off' : ''}`}><WindowBar maximized={maximized} /><div className={`app-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}><div className="ambient ambient-one" /><div className="ambient ambient-two" /><NodeWeb />
    <aside className="sidebar">
      <button type="button" className="sidebar-collapse-button" aria-label={sidebarCollapsed ? t('Развернуть боковую панель') : t('Свернуть боковую панель')} title={sidebarCollapsed ? t('Развернуть панель') : t('Свернуть панель')} aria-pressed={sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg></button>
      <div className="brand"><div className="brand-orb"><NexusMark /></div><div className="sidebar-copy"><strong>NEXUS</strong><span>NETWORK CONTROL</span></div></div>
      <div className="workspace-selector workspace-static" title={sidebarCollapsed ? (profile.deviceName || t('Локальное устройство')) : undefined}><span className="workspace-avatar">N</span><div className="sidebar-copy"><span className="workspace-label">DEVICE PROFILE · {profile.deviceId}</span><strong>{profile.deviceName || t('Локальное устройство')}</strong></div><span className="workspace-badge sidebar-copy">LOCAL</span></div>
      <div className="nav-label sidebar-copy">CONTROL CENTER</div>
      <nav>{navItems.map((item) => <button key={item.id} aria-label={t(item.label)} title={sidebarCollapsed ? t(item.label) : undefined} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => openPage(item.id)}><span className="nav-glyph"><NavGlyph name={item.icon} /></span><span className="nav-item-label sidebar-copy">{t(item.label)}</span>{item.id === 'logs' && logs.length > 0 ? <em className="sidebar-copy">{Math.min(logs.length, 99)}</em> : null}</button>)}</nav>
      <div className="sidebar-bottom">
        <button type="button" aria-label={t('О программе')} title={sidebarCollapsed ? t('О программе') : undefined} className={`nav-item sidebar-about ${page === 'about' ? 'active' : ''} ${updateReady ? 'has-update' : ''}`} onClick={() => openPage('about')}><span className="nav-glyph"><NavGlyph name="about" /></span><span className="nav-item-label sidebar-copy">{t('О программе')}</span>{updateReady ? <em className="nav-update-dot" title={t('Доступно обновление — откройте, чтобы установить')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v11" /><path d="m7 12 5 5 5-5" /></svg></em> : null}</button>
        <div className="system-status" title={sidebarCollapsed ? `${systemTitle}: ${systemNote}` : undefined}><StatusDot tone={systemTone} /><div className="sidebar-copy"><span>{systemTitle}</span><small>{systemNote}</small></div></div>
        <div className="version-row sidebar-copy"><span>NEXUS v{__APP_VERSION__}</span><span className="online-dot" /> LOCAL</div>
      </div>
    </aside>

    <main className="main-content" ref={mainContentRef}><header className="topbar"><div className="breadcrumb"><span>{t('ЦЕНТР УПРАВЛЕНИЯ')}</span><b>/</b><strong>{page === 'about' ? t('О программе') : t(navItems.find((item) => item.id === page)?.label ?? '')}</strong></div><div className="top-actions"><button className={`logs-shortcut ${page === 'logs' ? 'is-active' : ''}`} aria-label={t('Логи')} onClick={() => openPage('logs')}><span className="logs-shortcut-icon"><NavGlyph name="logs" /></span><span>{t('Логи')}</span>{logs.some((log) => log.level === 'error') ? <i /> : null}</button><div className="profile-wrap" ref={profileWrapRef}><button className={`user-chip ${profileOpen ? 'is-open' : ''}`} aria-expanded={profileOpen} aria-haspopup="dialog" onClick={() => setProfileOpen((value) => !value)}><span className="user-avatar">{profileInitial}</span><span>{profileName}</span><span className="profile-chevron"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 7.5 4.5 4.5 4.5-4.5" /></svg></span></button><ProfilePopover open={profileOpen} profile={profile} draft={profileDraft} setDraft={setProfileDraft} onSave={handleSaveProfile} /></div></div></header>

      {page === 'dashboard' && <><section className="hero"><div className="hero-copy"><div className="hero-kicker"><span className="spark-line">✦</span> {t('УПРАВЛЕНИЕ ЛОКАЛЬНОЙ СЕТЬЮ')} <span className="hero-line" /></div><h1>{t('Сеть, которая')}<br /><span>{t('остаётся под контролем.')}</span></h1><p>{t('Единый центр для спокойного управления сетевыми инструментами,')}<br />{t('локальными прокси и профилями маршрутизации.')}</p><div className="hero-actions">
      <button className="primary-button" onClick={() => openPage('modules')}>
        <span>{t('Открыть модули')}</span>
        <b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16 8M9.5 8H16v6.5" /></svg></b>
      </button>
      <button className={`quiet-button ${scanning ? 'is-spin' : ''}`} disabled={scanning} onClick={handleReload}>
        <span className="quiet-button-icon"><RefreshGlyph /></span>
        {t('Сканировать заново')}
      </button>
    </div></div><HeroVisual /></section><section className="stats-grid"><StatCard label={t('ВСЕГО МОДУЛЕЙ')} value={String(modules.length).padStart(2, '0')} note={t('обнаружено локально')} glyph="modules" tone="cyan" index={0} /><StatCard label={t('АКТИВНЫЕ')} value={String(running).padStart(2, '0')} note={running ? t('контур запущен') : t('готовы к запуску')} glyph="active" tone="violet" index={1} meter={modules.length ? (running / modules.length) * 100 : 0} /><StatCard label={t('ЗДОРОВЬЕ')} value={`${modules.length ? Math.round((healthy / modules.length) * 100) : 100}%`} note={errors ? `${errors} ${t('с ошибкой')}` : t('без критических ошибок')} glyph="health" tone={errors ? 'red' : 'mint'} index={2} meter={modules.length ? Math.round((healthy / modules.length) * 100) : 100} /><StatCard label={t('ПОСЛЕДНИЙ СКАН')} value={lastScanLabel} note={settings.autoStart ? t('автозапуск включён') : t('автозапуск выключен')} glyph="scan" tone="amber" index={3} /></section><section className="section-heading"><div><span className="section-kicker">{t('ВАШИ ИНСТРУМЕНТЫ')}</span><h2>{t('Быстрый доступ')}</h2></div><button className="text-button" onClick={() => openPage('modules')}>
        <span className="text-button-label">{t('Все модули')}</span>
        <em className="text-button-count">{modules.length}</em>
        <span className="text-button-arrow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12.5 6.5 19 12l-6.5 5.5" /></svg></span>
      </button></section><div className="dashboard-grid"><div className="module-grid compact">{loadingModules ? <ModuleSkeletons count={4} /> : filteredModules.slice(0, 4).map((module, index) => <ModuleCard key={module.id} module={module} index={index} onToggle={handleToggle} onStrategyChange={handleStrategyChange} onOpenSettings={openModuleSettings} t={t} />)}</div><PulsePanel running={running} total={modules.length} errors={errors} /></div></>}

      {page === 'modules' && settingsModule && <ModuleSettings
        module={settingsModule}
        onClose={() => setSettingsModuleId(null)}
        onToast={setToast}
        onStrategyChange={handleStrategyChange}
      />}

      {page === 'modules' && !settingsModule && <section className="page-section"><div className="page-heading"><div><span className="section-kicker">{t('РЕЕСТР МОДУЛЕЙ')}</span><h1>{t('Все модули')}</h1><p>{t('Манифесты из')} <code>./modules</code> · {modules.length} {t('подключено')}</p></div><button className={`primary-button small ${scanning ? 'is-spin' : ''}`} disabled={scanning} onClick={handleReload}><span className="quiet-button-icon"><RefreshGlyph /></span><b>{t('Сканировать')}</b></button></div><GithubUpdateStrip updates={updates} syncing={syncing} onSync={handleSyncUpdates} /><div className="filter-row"><span className="filter-label">{t('ФИЛЬТР:')}</span><button className={`filter-chip ${moduleFilter === 'all' ? 'active' : ''}`} onClick={() => setModuleFilter('all')}>{t('Все')} <b>{modules.length}</b></button><button className={`filter-chip ${moduleFilter === 'running' ? 'active' : ''}`} onClick={() => setModuleFilter('running')}>{t('Активные')} <b>{running}</b></button><button className={`filter-chip ${moduleFilter === 'stopped' ? 'active' : ''}`} onClick={() => setModuleFilter('stopped')}>{t('Остановлены')} <b>{modules.length - running}</b></button></div><div className="module-grid full">{loadingModules ? <ModuleSkeletons count={4} /> : filteredModules.map((module, index) => <ModuleCard key={module.id} module={module} index={index} onToggle={handleToggle} onStrategyChange={handleStrategyChange} onOpenSettings={openModuleSettings} t={t} />)}</div>{!loadingModules && filteredModules.length === 0 && <div className="empty-state"><span>⌕</span><h3>{t('Ничего не найдено')}</h3><p>{t('Смените фильтр или просканируйте modules ещё раз.')}</p></div>}</section>}

      {page === 'jey2ray' && <Jey2RayPage settings={settings} updates={updates} syncing={syncing} onSync={handleSyncUpdates} onSettings={(next) => void persistSettings(next)} onToast={setToast} />}

      {page === 'logs' && <LogsPage logs={logs} category={logCategory} setCategory={setLogCategory} onNotice={setToast} t={t} />}

      {page === 'settings' && <Settings settings={settings} onChange={(next) => void persistSettings(next)} />}
      {page === 'about' && <AboutPage t={t} />}
    </main><Toast message={toast} />
  </div></div>;
}

function Settings({ settings, onChange }: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
}) {
  const t = createTranslator(settings.language);
  return <section className="page-section settings-page global-settings-page">
    <div className="page-heading"><div><span className="section-kicker">{t('ПАРАМЕТРЫ NEXUS')}</span><h1>{t('Настройки')}</h1><p>{t('Глобальные параметры языка, оформления и поведения NEXUS.')}</p></div></div>

    <div className="global-settings-hero">
      <span className="global-settings-hero-icon"><GearIcon /></span>
      <div><span>{t('ОБЩИЕ НАСТРОЙКИ')}</span><h2>{t('Интерфейс NEXUS')}</h2><p>{t('Эти параметры относятся ко всему приложению. Настройки VPN находятся внутри Jey2Ray.')}</p></div>
      <div className="global-settings-badges"><span>{settings.language === 'en' ? 'EN' : 'RU'}</span><span>{t('Тёмная тема')}</span></div>
    </div>

    <div className="settings-layout global-settings-layout">
      <div className="settings-card global-preferences-card">
        <div className="settings-card-head"><div className="settings-symbol"><GearIcon /></div><div><h3>{t('Язык и оформление')}</h3><p>{t('Внешний вид всего приложения.')}</p></div></div>
        <div className="global-preference-row appearance-preference-row">
          <div><strong>{t('Язык интерфейса')}</strong><p>{t('Основной язык меню, подсказок и уведомлений.')}</p></div>
          <div className="appearance-options" role="radiogroup" aria-label={t('Язык интерфейса')}>
            <button type="button" role="radio" aria-checked={settings.language === 'ru'} className={settings.language === 'ru' ? 'active' : ''} onClick={() => onChange({ ...settings, language: 'ru' })}>Русский</button>
            <button type="button" role="radio" aria-checked={settings.language === 'en'} className={settings.language === 'en' ? 'active' : ''} onClick={() => onChange({ ...settings, language: 'en' })}>English</button>
          </div>
        </div>
        <div className="global-preference-row">
          <div><strong>{t('Тема')}</strong><p>{t('Комфортная тёмная тема для длительной работы.')}</p></div>
          <span className="global-preference-value"><i />{t('Тёмная')}</span>
        </div>
        <div className="global-preference-row appearance-preference-row">
          <div><strong>{t('Анимации')}</strong><p>{t('Плавные переходы и подсветка. Выключите, если интерфейс должен реагировать мгновенно.')}</p></div>
          <div className="appearance-options" role="radiogroup" aria-label={t('Анимации интерфейса')}>
            <button type="button" role="radio" aria-checked={settings.motion === 'full'} className={settings.motion === 'full' ? 'active' : ''} onClick={() => onChange({ ...settings, motion: 'full' })}>{t('Включены')}</button>
            <button type="button" role="radio" aria-checked={settings.motion === 'reduced'} className={settings.motion === 'reduced' ? 'active' : ''} onClick={() => onChange({ ...settings, motion: 'reduced' })}>{t('Выключены')}</button>
          </div>
        </div>
        <div className="global-preference-row appearance-preference-row">
          <div><strong>{t('Оформление')}</strong><p>{t('Выберите характер акцентов интерфейса.')}</p></div>
          {/* Переключатель оформления — кружки цветов, а не подписи.
              Цвет объясняет тему быстрее слова, а три полноценные кнопки в
              ряд заняли бы всю строку. Название показывается у выбранного и
              при наведении на остальные: так понятно, что именно выбираешь. */}
          <div className="theme-dots" role="radiogroup" aria-label={t('Оформление NEXUS')}>
            {([
              ['indigo', t('Индиго')],
              ['graphite', t('Графит')],
              ['crimson', t('Багровое')],
            ] as const).map(([id, label]) => <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.appearance === id}
              aria-label={label}
              title={label}
              className={`theme-dot theme-${id} ${settings.appearance === id ? 'is-active' : ''}`}
              onClick={() => onChange({ ...settings, appearance: id })}
            >
              <i />
              <span className="theme-dot-label">{label}</span>
            </button>)}
          </div>
        </div>
      </div>

      <div className="settings-card global-behavior-card">
        <div className="settings-card-head"><div className="settings-symbol violet">✦</div><div><h3>{t('Поведение NEXUS')}</h3><p>{t('Общие действия приложения в Windows.')}</p></div></div>
        <SettingRow label={t('Запускать вместе с Windows')} description={t('NEXUS откроется в трее сразу после входа в систему.')} checked={settings.launchAtLogin} onChange={() => onChange({ ...settings, launchAtLogin: !settings.launchAtLogin })} />
        <SettingRow label={t('Автозапуск модулей')} description={t('Запускать ранее включённые модули при старте приложения.')} checked={settings.autoStart} onChange={() => onChange({ ...settings, autoStart: !settings.autoStart })} />
        <SettingRow label={t('Уведомления о событиях')} description={t('Показывать системные уведомления об ошибках и важных событиях.')} checked={settings.notifications} onChange={() => onChange({ ...settings, notifications: !settings.notifications })} />
        <SettingRow label={t('Закрывать в трей')} description={t('Крестик прячет окно. Полный выход доступен из меню трея.')} checked={settings.closeToTray} onChange={() => onChange({ ...settings, closeToTray: !settings.closeToTray })} />
      </div>
    </div>

    <div className="info-callout global-settings-note"><span>i</span><div><strong>{t('Настройки модулей разделены')}</strong><p>{t('Параметры конкретного модуля открываются внутри его страницы. Здесь остаются только общие настройки NEXUS.')}</p></div></div>
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
