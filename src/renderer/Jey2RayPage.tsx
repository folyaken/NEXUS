import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, UpdateInfo, VpnAppRoutingMode, VpnProfile, VpnRuntime, VpnSubscriptionInfo } from '../main/types';
import { canConnect, displayName } from '../main/vpn-classify';
import { Flag } from './Flag';
import { SubscriptionManager, type SubscriptionAction } from './SubscriptionManager';

function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim();
}

const EMPTY_RUNTIME: VpnRuntime = {
  status: 'disconnected',
  activeProfileId: null,
  activeName: null,
  pid: null,
  inboundPort: 10808,
  xrayReady: false,
  xrayVersion: null,
  subscriptions: [],
};

function subscriptionKey(profile: VpnProfile): string {
  return profile.subscriptionUrl || 'manual';
}

function sameSubscription(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  try {
    const first = new URL(left.trim());
    const second = new URL(right.trim());
    first.hash = '';
    second.hash = '';
    return first.toString() === second.toString();
  } catch {
    return left.trim() === right.trim();
  }
}

function formatBytes(value?: number): string {
  if (!value) return '0 MB';
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function formatWhen(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatExpire(value?: string): string {
  if (!value) return 'без срока';
  const date = new Date(value);
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  const stamp = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  if (days < 0) return `${stamp} · истекла`;
  if (days === 0) return `${stamp} · сегодня`;
  return `${stamp} · ещё ${days} дн.`;
}

function stackOf(profile: VpnProfile): string {
  return profile.stack || `${profile.protocol.toUpperCase()} / ${(profile.params.network || 'TCP').toUpperCase()} / ${(profile.params.security || 'NONE').toUpperCase()} / JSON`;
}

function telegramOf(info?: VpnSubscriptionInfo): string | null {
  const blob = `${info?.title || ''} ${info?.supportUrl || ''} ${info?.announce || ''}`;
  const match = blob.match(/@[\w_]{4,}/);
  if (match) return match[0];
  try {
    if (info?.supportUrl && /t\.me\//i.test(info.supportUrl)) return `@${new URL(info.supportUrl).pathname.replace(/^\//, '')}`;
  } catch { /* ignore */ }
  return info?.title || null;
}

function latencyScore(profile: VpnProfile): number {
  if (typeof profile.pingMs === 'number' && profile.pingMs >= 0) return profile.pingMs;
  if (profile.pingMs === -1) return 8_000;
  return 40_000;
}

function pickFastest(list: VpnProfile[]): VpnProfile | null {
  const ready = list.filter((item) => !canConnect(item));
  if (!ready.length) return null;
  return [...ready].sort((a, b) => latencyScore(a) - latencyScore(b))[0];
}

function Signal({ ms }: { ms?: number | null }) {
  if (ms == null) {
    return <span className="happ-ping off" title="Ещё не измеряли"><span className="happ-signal off">{[1, 2, 3, 4].map((bar) => <i key={bar} />)}</span><em>—</em></span>;
  }
  if (ms < 0) {
    return <span className="happ-ping soft" title="Порт не отвечает на TCP, но узел рабочий (часто Reality / Hysteria)">
      <span className="happ-signal soft">{[1, 2, 3, 4].map((bar) => <i key={bar} className={bar <= 3 ? 'on' : ''} />)}</span>
      <em>ок</em>
    </span>;
  }
  const level = ms < 60 ? 4 : ms < 120 ? 3 : ms < 220 ? 2 : 1;
  const tone = level >= 3 ? 'good' : level === 2 ? 'ok' : 'weak';
  return <span className={`happ-ping ${tone}`} title={`${ms} мс`}>
    <span className={`happ-signal ${tone}`}>{[1, 2, 3, 4].map((bar) => <i key={bar} className={bar <= level ? 'on' : ''} />)}</span>
    <em>{ms}</em>
  </span>;
}

export function Jey2RayPage({
  settings,
  updates,
  syncing,
  onSync,
  onSettings,
  onToast,
}: {
  settings: AppSettings;
  updates: UpdateInfo[];
  syncing: boolean;
  onSync: () => void;
  onSettings: (next: AppSettings) => void;
  onToast: (message: string) => void;
}) {
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false);
  const [profiles, setProfiles] = useState<VpnProfile[]>([]);
  const [runtime, setRuntime] = useState<VpnRuntime>(EMPTY_RUNTIME);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<'refresh' | 'ping' | null>(null);
  const [subscriptionAction, setSubscriptionAction] = useState<SubscriptionAction | null>(null);
  const [tab, setTab] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(settings.lastVpnProfileId);
  const autoPing = useRef(false);
  const desktop = Boolean(window.nexus);
  const xrayUpdate = updates.find((item) => item.id === 'jey2ray');
  const mode = settings.vpnMode === 'tun' ? 'tun' : 'proxy';
  const splitApps = settings.vpnSplitApps ?? [];
  const storedAppRouting: VpnAppRoutingMode = settings.vpnAppRouting === 'exclude' || settings.vpnAppRouting === 'include'
    ? settings.vpnAppRouting
    : settings.vpnSplitTunnel
      ? 'include'
      : 'system';
  const appRouting: VpnAppRoutingMode = mode === 'tun' && splitApps.length ? storedAppRouting : 'system';
  const appRoutingActive = appRouting === 'include' || appRouting === 'exclude';
  const routeSettingsLocked = runtime.status === 'connecting' || runtime.status === 'connected';

  useEffect(() => {
    const api = window.nexus;
    if (!api?.getVpn) return;
    void api.getVpn().then((snapshot) => {
      setProfiles(snapshot.profiles);
      setRuntime(snapshot.runtime);
      if (snapshot.runtime.activeProfileId) setSelectedId(snapshot.runtime.activeProfileId);
    }).catch((error: Error) => onToast(cleanError(error)));
    return api.onVpnChanged((snapshot) => {
      setProfiles(snapshot.profiles);
      setRuntime(snapshot.runtime);
    });
  }, [onToast]);

  useEffect(() => {
    if (!desktop || runtime.xrayReady) return;
    void window.nexus?.ensureVpnCore().then(() => window.nexus?.getVpn()).then((snapshot) => {
      if (snapshot) setRuntime(snapshot.runtime);
    }).catch((error: Error) => onToast(cleanError(error)));
  }, [desktop, runtime.xrayReady, onToast]);

  const nodes = useMemo(() => profiles.filter((item) => item.kind !== 'notice'), [profiles]);
  const tabs = useMemo(() => ['all', ...new Set(nodes.map(subscriptionKey))], [nodes]);
  const visible = useMemo(() => tab === 'all' ? nodes : nodes.filter((item) => subscriptionKey(item) === tab), [nodes, tab]);
  const fastest = useMemo(() => pickFastest(visible), [visible]);
  const listed = useMemo(
    () => fastest ? [fastest, ...visible.filter((item) => item.id !== fastest.id)] : visible,
    [fastest, visible],
  );
  const info: VpnSubscriptionInfo | undefined = tab !== 'all' && tab !== 'manual'
    ? (runtime.subscriptions ?? []).find((item) => item.url === tab)
    : undefined;
  const selected = nodes.find((item) => item.id === selectedId) ?? fastest ?? nodes.find((item) => !canConnect(item)) ?? nodes[0] ?? null;
  const onAir = runtime.status === 'connected' && runtime.activeProfileId === selected?.id;
  const otherLive = runtime.status === 'connected' && runtime.activeProfileId !== selected?.id;
  const used = (info?.upload ?? 0) + (info?.download ?? 0);
  const quota = info?.total ? formatBytes(info.total) : '∞';
  const title = tab === 'all' ? 'Все серверы' : tab === 'manual' ? 'Ручные профили' : telegramOf(info) || 'Подписка';

  const importLink = async () => {
    try {
      setBusy(true);
      if (!desktop) {
        onToast('Импорт ссылок работает в окне Electron (npm start)');
        return;
      }
      const imported = await window.nexus?.importVpn(link, name || undefined);
      if (imported?.length) {
        setLink('');
        setImportOpen(false);
        if (imported[0].subscriptionUrl) setTab(imported[0].subscriptionUrl);
        setSelectedId(imported[0].id);
        onToast(`Подписка: серверов ${imported.length}`);
      }
    } catch (error) {
      onToast(cleanError(error) || 'Не удалось импортировать ссылку');
    } finally {
      setBusy(false);
    }
  };

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
      onSettings({
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
    onSettings({
      ...settings,
      vpnMode: next === 'system' ? mode : 'tun',
      vpnAppRouting: next,
      vpnSplitTunnel: next === 'include',
    });
  };

  const selectConnectionMode = (next: 'proxy' | 'tun') => {
    if (routeSettingsLocked) {
      onToast('Сначала отключи VPN, затем измени режим подключения');
      return;
    }
    onSettings({
      ...settings,
      vpnMode: next,
      vpnAppRouting: next === 'proxy' ? 'system' : appRouting,
      vpnSplitTunnel: next === 'tun' && appRouting === 'include',
    });
  };

  const removeSplitApp = (executable: string) => {
    if (routeSettingsLocked) {
      onToast('Сначала отключи VPN, затем измени список приложений');
      return;
    }
    const next = splitApps.filter((app) => app.executable !== executable);
    const nextRouting: VpnAppRoutingMode = next.length ? appRouting : 'system';
    onSettings({
      ...settings,
      vpnSplitApps: next,
      vpnAppRouting: nextRouting,
      vpnSplitTunnel: nextRouting === 'include',
    });
  };

  const connect = async (id: string) => {
    const profile = nodes.find((item) => item.id === id);
    const blocked = profile ? canConnect(profile) : 'Сервер не найден';
    if (blocked) {
      onToast(blocked);
      return;
    }
    try {
      setBusy(true);
      setSelectedId(id);
      if (!desktop) {
        setRuntime({ ...runtime, status: 'connected', activeProfileId: id, pid: 4400 });
        return;
      }
      await window.nexus?.connectVpn(id);
    } catch (error) {
      onToast(cleanError(error) || 'Не удалось подключиться');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    try {
      setBusy(true);
      if (desktop) await window.nexus?.disconnectVpn();
      else setRuntime({ ...runtime, status: 'disconnected', activeProfileId: null, pid: null });
    } catch (error) {
      onToast(cleanError(error) || 'Не удалось отключить VPN');
    } finally {
      setBusy(false);
    }
  };

  const togglePower = async () => {
    if (!selected) {
      onToast('Сначала выбери сервер слева');
      return;
    }
    if (onAir) await disconnect();
    else await connect(selected.id);
  };

  const holdAction = async (kind: 'refresh' | 'ping', work: () => Promise<void>, minMs: number) => {
    setAction(kind);
    const started = Date.now();
    try {
      await work();
    } finally {
      const wait = minMs - (Date.now() - started);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      setAction(null);
    }
  };

  const refresh = () => holdAction('refresh', async () => {
    try {
      const count = await window.nexus?.refreshVpn();
      onToast(count ? `Обновлено · ${count}` : 'Нет подписок');
    } catch (error) {
      onToast(cleanError(error));
    }
  }, 1100);

  const addManagedSubscription = async (url: string): Promise<boolean> => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        onToast('Подписка должна использовать только HTTPS');
        return false;
      }
      if (!desktop) {
        onToast('Добавление подписок работает в окне Electron (npm start)');
        return false;
      }
      setSubscriptionAction({ kind: 'add', url });
      const imported = await window.nexus?.importVpn(url);
      if (!imported?.length) return false;
      const subscriptionUrl = imported[0].subscriptionUrl || url;
      setTab(subscriptionUrl);
      setSelectedId(imported[0].id);
      onToast(`Подписка добавлена · серверов ${imported.length}`);
      return true;
    } catch (error) {
      onToast(cleanError(error) || 'Не удалось добавить подписку');
      return false;
    } finally {
      setSubscriptionAction(null);
    }
  };

  const refreshManagedSubscription = async (url: string): Promise<void> => {
    try {
      setSubscriptionAction({ kind: 'refresh', url });
      const count = await window.nexus?.refreshVpn(url);
      onToast(`Подписка обновлена · серверов ${count ?? 0}`);
    } catch (error) {
      onToast(cleanError(error) || 'Не удалось обновить подписку');
    } finally {
      setSubscriptionAction(null);
    }
  };

  const refreshManagedSubscriptions = async (): Promise<void> => {
    try {
      setSubscriptionAction({ kind: 'refresh-all' });
      const count = await window.nexus?.refreshVpn();
      onToast(count ? `Все подписки обновлены · серверов ${count}` : 'Нет подписок');
    } catch (error) {
      onToast(cleanError(error) || 'Не удалось обновить подписки');
    } finally {
      setSubscriptionAction(null);
    }
  };

  const removeManagedSubscription = async (url: string): Promise<boolean> => {
    try {
      setSubscriptionAction({ kind: 'remove', url });
      await window.nexus?.removeVpnSubscription(url);
      if (sameSubscription(tab, url)) setTab('all');
      const selectedProfile = profiles.find((profile) => profile.id === selectedId);
      if (sameSubscription(selectedProfile?.subscriptionUrl, url)) setSelectedId(null);
      onToast('Подписка и её серверы удалены');
      return true;
    } catch (error) {
      onToast(cleanError(error) || 'Не удалось удалить подписку');
      return false;
    } finally {
      setSubscriptionAction(null);
    }
  };

  const ping = () => holdAction('ping', async () => {
    try {
      const next = await window.nexus?.pingVpn();
      if (next) setProfiles(next);
      onToast('Пинг измерен');
    } catch (error) {
      onToast(cleanError(error));
    }
  }, 2200);

  useEffect(() => {
    if (runtime.activeProfileId) return;
    if (fastest?.id) setSelectedId(fastest.id);
  }, [fastest?.id, runtime.activeProfileId]);

  useEffect(() => {
    if (!desktop || autoPing.current || !nodes.length) return;
    autoPing.current = true;
    void ping();
  }, [desktop, nodes.length]);

  const routeLabel = appRouting === 'include'
    ? `VPN только для выбранных · ${splitApps.length}`
    : appRouting === 'exclude'
      ? `Напрямую выбранные · ${splitApps.length}`
      : mode === 'tun'
        ? 'Весь трафик через VPN'
        : 'Системный Proxy';
  const routeDescription = appRouting === 'include'
    ? 'Остальные приложения подключаются напрямую.'
    : appRouting === 'exclude'
      ? 'Остальные приложения используют VPN.'
      : mode === 'tun'
        ? 'Общий TUN без правил для отдельных приложений.'
        : 'HTTP-прокси Windows без маршрутизации по приложениям.';
  const powerLabel = onAir
    ? `Работает · ${routeLabel} · 127.0.0.1:${runtime.inboundPort + 1}`
    : otherLive
      ? 'Другой сервер онлайн. Нажми — переключить сюда'
      : runtime.status === 'connecting'
        ? 'Подключаем…'
        : runtime.status === 'error'
          ? (runtime.error || 'Ошибка')
          : 'Выключено';

  if (subscriptionsOpen) return <SubscriptionManager
    subscriptions={runtime.subscriptions ?? []}
    profiles={profiles}
    action={subscriptionAction}
    onBack={() => setSubscriptionsOpen(false)}
    onAdd={addManagedSubscription}
    onRefresh={refreshManagedSubscription}
    onRefreshAll={refreshManagedSubscriptions}
    onRemove={removeManagedSubscription}
  />;

  if (settingsOpen) return <section className="page-section jey-page app-settings-page">
    <div className="app-settings-toolbar">
      <button type="button" className="app-settings-back" onClick={() => setSettingsOpen(false)} aria-label="Вернуться к серверам">
        <svg viewBox="0 0 20 20" aria-hidden><path d="m12.5 4.5-5 5.5 5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Серверы
      </button>
      <div>
        <span>Jey2Ray</span>
        <h2>Настройки приложений</h2>
      </div>
      <span className={`app-route-state ${appRoutingActive ? 'is-on' : ''}`}>
        <i />{appRoutingActive ? 'Маршрутизация включена' : 'Общие настройки'}
      </span>
    </div>

    <div className="app-settings-scroll">
      {routeSettingsLocked && <div className="app-settings-lock">
        <span>i</span>
        <div><strong>VPN сейчас работает</strong><p>Отключи подключение, чтобы изменить режим или список приложений.</p></div>
      </div>}

      <section className="app-settings-card auto-settings-card">
        <div className="app-settings-card-head compact">
          <div><span className="settings-step">01</span><div><h3>Автоподключение</h3><p>Запускать последний сервер вместе с NEXUS.</p></div></div>
          <button
            type="button"
            className={`settings-toggle ${settings.autoConnectVpn ? 'is-on' : ''}`}
            onClick={() => onSettings({ ...settings, autoConnectVpn: !settings.autoConnectVpn })}
            aria-label={settings.autoConnectVpn ? 'Выключить автоподключение' : 'Включить автоподключение'}
          ><i /></button>
        </div>
        <div className={`auto-status ${settings.autoConnectVpn ? 'is-on' : ''}`}><i />{settings.autoConnectVpn ? 'Включено' : 'Выключено'}</div>
      </section>

      <section className="app-settings-card routing-settings-card">
        <div className="app-settings-card-head">
          <div><span className="settings-step">02</span><div><h3>Настройки прокси для приложений</h3><p>Выбери общую политику. Конкретные приложения можно добавить ниже.</p></div></div>
        </div>
        <div className="routing-choice-list" role="radiogroup" aria-label="Режим маршрутизации приложений">
          <button type="button" role="radio" aria-checked={appRouting === 'system'} className={`routing-choice ${appRouting === 'system' ? 'is-active' : ''}`} disabled={routeSettingsLocked} onClick={() => selectAppRouting('system')}>
            <i className="settings-radio" />
            <span><strong>Системные настройки</strong><small>Без отдельных правил. Используется общий режим {mode === 'tun' ? 'TUN' : 'Proxy'}.</small></span>
            <em>По умолчанию</em>
          </button>
          <button type="button" role="radio" aria-checked={appRouting === 'exclude'} className={`routing-choice ${appRouting === 'exclude' ? 'is-active' : ''}`} disabled={routeSettingsLocked} onClick={() => selectAppRouting('exclude')}>
            <i className="settings-radio" />
            <span><strong>Прямое подключение для выбранных приложений</strong><small>Выбранные приложения обходят VPN, все остальные идут через VPN.</small></span>
            <em>Исключения</em>
          </button>
          <button type="button" role="radio" aria-checked={appRouting === 'include'} className={`routing-choice ${appRouting === 'include' ? 'is-active' : ''}`} disabled={routeSettingsLocked} onClick={() => selectAppRouting('include')}>
            <i className="settings-radio" />
            <span><strong>VPN только для выбранных приложений</strong><small>Выбранные приложения идут через VPN, все остальные — напрямую.</small></span>
            <em>Split Tunneling</em>
          </button>
        </div>
      </section>

      <section className="app-settings-card selected-apps-card">
        <div className="app-settings-card-head selected-apps-head">
          <div><span className="settings-step">03</span><div><h3>Выбранные приложения</h3><p>{splitApps.length ? `Добавлено: ${splitApps.length}` : 'Добавь приложения Windows, для которых будут действовать правила выше.'}</p></div></div>
          <button type="button" className="app-add-button" disabled={routeSettingsLocked} onClick={() => void addSplitApps(appRouting)}>
            <svg viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            Добавить приложение
          </button>
        </div>
        {splitApps.length ? <div className="selected-app-list">
          {splitApps.map((app) => <div className="selected-app-row" key={app.executable.toLocaleLowerCase('en-US')} title={app.path}>
            <span className="selected-app-icon"><svg viewBox="0 0 24 24" aria-hidden><rect x="4" y="3.5" width="16" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 8h8M8 12h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span>
            <span className="selected-app-copy"><strong>{app.executable}</strong><small>{app.path}</small></span>
            <span className={`selected-app-route ${appRouting === 'exclude' ? 'is-direct' : appRouting === 'include' ? 'is-vpn' : ''}`}>
              {appRouting === 'exclude' ? 'Напрямую' : appRouting === 'include' ? 'Через VPN' : 'Не активно'}
            </span>
            <button type="button" className="selected-app-remove" disabled={routeSettingsLocked} onClick={() => removeSplitApp(app.executable)} aria-label={`Удалить ${app.executable}`}>×</button>
          </div>)}
        </div> : <div className="selected-app-empty">
          <span><svg viewBox="0 0 32 32" aria-hidden><rect x="7" y="5" width="18" height="22" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M12 12h8M12 17h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span>
          <strong>Приложения ещё не выбраны</strong>
          <p>Нажми «Добавить приложение» и выбери один или несколько файлов .exe.</p>
        </div>}
      </section>
    </div>
  </section>;

  return <section className="page-section jey-page happ-shell">
    <div className="happ-left">
      <div className="jey-toolbar tight">
        <h2>Серверы</h2>
        <div className="jey-toolbar-actions">
          <button type="button" className="ghost-action settings-gear-button" onClick={() => setSettingsOpen(true)} title="Настройки приложений" aria-label="Открыть настройки приложений">
            <svg className="ico" viewBox="0 0 20 20" aria-hidden>
              <path d="M7.9 2.7h4.2l.45 1.75c.4.17.78.39 1.13.65l1.72-.5 2.1 3.65-1.27 1.25c.03.2.04.42.04.64s-.01.43-.04.64l1.27 1.25-2.1 3.65-1.72-.5c-.35.26-.73.48-1.13.65l-.45 1.75H7.9l-.45-1.75a6.4 6.4 0 0 1-1.13-.65l-1.72.5-2.1-3.65 1.27-1.25a4.7 4.7 0 0 1 0-1.28L2.5 8.25 4.6 4.6l1.72.5c.35-.26.73-.48 1.13-.65L7.9 2.7Z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
              <circle cx="10" cy="10.15" r="2.35" fill="none" stroke="currentColor" strokeWidth="1.35" />
            </svg>
          </button>
          <button type="button" className="ghost-action subscription-manager-button" disabled={busy || Boolean(action)} onClick={() => setSubscriptionsOpen(true)}>
            <svg className="ico" viewBox="0 0 20 20" aria-hidden><path d="M4 5.25h12M4 10h12M4 14.75h12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="6" cy="5.25" r="1" fill="currentColor" /><circle cx="6" cy="10" r="1" fill="currentColor" /><circle cx="6" cy="14.75" r="1" fill="currentColor" /></svg>
            Подписки <span>{runtime.subscriptions?.length ?? 0}</span>
          </button>
          <button className="ghost-action" onClick={() => setImportOpen((value) => !value)}>
            <svg className="ico" viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            Добавить ссылку
          </button>
          <button className={`ghost-action ${action === 'refresh' ? 'is-spin' : ''}`} disabled={busy || Boolean(action)} onClick={() => void refresh()}>
            <svg className="ico spin-ico" viewBox="0 0 24 24" aria-hidden>
              <path fill="currentColor" d="M11.2 3.15A8.85 8.85 0 1 0 19 7.55l-1.95 1.15A6.55 6.55 0 1 1 11.2 5.45v2.7L17.45 5 11.2.65z" />
            </svg>
            Обновить
          </button>
          <button className={`ghost-action ${action === 'ping' ? 'is-rev' : ''}`} disabled={busy || Boolean(action)} onClick={() => void ping()}>
            <svg className="ico gauge-ico" viewBox="0 0 20 14" aria-hidden>
              <path d="M2.3 11.6a7.7 7.7 0 0 1 15.4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path className="gauge-needle" d="M10 11.55 5.35 6.55" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
              <circle cx="10" cy="11.55" r="1.15" fill="currentColor" />
            </svg>
            Тест пинга
          </button>
          {!runtime.xrayReady && <button className="ghost-action" disabled={syncing} onClick={onSync}>Скачать ядро {xrayUpdate?.latestVersion ?? ''}</button>}
        </div>
      </div>

      {importOpen && <div className="jey-import compact slide-in">
        <textarea className="jey-link" rows={2} value={link} onChange={(event) => setLink(event.target.value)} placeholder="Подписка https://… или vless:// hy2://" />
        <div className="jey-import-row">
          <input className="jey-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя (необязательно)" />
          <button className="primary-button small" disabled={busy || !link.trim()} onClick={() => void importLink()}>Добавить</button>
        </div>
      </div>}

      {tabs.length > 1 && <div className="jey-subs">
        {tabs.map((key) => <button key={key} className={`jey-sub ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
          {key === 'all'
            ? `Все · ${nodes.length}`
            : key === 'manual'
              ? `Ручные · ${nodes.filter((item) => subscriptionKey(item) === key).length}`
              : `${(runtime.subscriptions ?? []).find((item) => item.url === key)?.title || 'Подписка'} · ${nodes.filter((item) => subscriptionKey(item) === key).length}`}
        </button>)}
      </div>}

      <div className="happ-card">
        <div className="happ-card-top">
          <strong>{title}</strong>
          <span>узлов {visible.length}</span>
        </div>
        <div className="happ-card-meta">
          {info ? <>
            <span>{formatBytes(used)} / {quota}</span>
            <span className="happ-expire">истекает {formatExpire(info.expireAt)}</span>
            <span>обновлено {formatWhen(info.lastSync)}</span>
          </> : <>
            <span>подписок {runtime.subscriptions?.length ?? 0}</span>
            <span>{tab === 'manual' ? 'добавлены вручную' : 'выбери подписку для подробностей'}</span>
          </>}
        </div>
        {info?.announce && <div className="happ-ribbon">{info.announce}</div>}
      </div>

      <div className="happ-list">
        {listed.map((profile) => {
          const live = runtime.status === 'connected' && runtime.activeProfileId === profile.id;
          const picked = selected?.id === profile.id;
          const blocked = canConnect(profile);
          return <button key={profile.id} className={`happ-row ${live ? 'is-live' : ''} ${picked ? 'is-active' : ''} ${blocked ? 'is-off' : ''}`} onClick={() => setSelectedId(profile.id)} onDoubleClick={() => { if (blocked) onToast(blocked); else void connect(profile.id); }}>
            <Flag code={profile.country} />
            <span className="happ-copy">
              <strong>{displayName(profile)}</strong>
              <small>{blocked || stackOf(profile)}</small>
            </span>
            {live ? <em className="happ-on">ВКЛ</em> : <Signal ms={profile.pingMs} />}
            <span className="happ-go">›</span>
          </button>;
        })}
      </div>
    </div>

    <aside className="happ-right">
      <button
        className={`power-orb ${onAir ? 'is-on' : ''} ${otherLive ? 'is-other' : ''} ${runtime.status === 'connecting' ? 'is-wait' : ''}`}
        disabled={busy}
        onClick={() => void togglePower()}
        aria-label={onAir ? 'Выключить VPN' : otherLive ? 'Переключить сервер' : 'Включить VPN'}
      >
        <span className="orb-halo" />
        <span className="orb-core">⏻</span>
      </button>
      <div className="power-meta">
        {selected ? <Flag code={selected.country} /> : null}
        <strong>{selected ? (fastest?.id === selected.id ? 'Самый быстрый' : displayName(selected)) : 'Сервер не выбран'}</strong>
        <small>{powerLabel}</small>
      </div>
      <div className="mode-switch" aria-label="Режим подключения">
        <span className="mode-switch-title">Режим подключения</span>
        <div className="mode-switch-options">
          <button
            type="button"
            className={mode === 'proxy' ? 'active' : ''}
            aria-pressed={mode === 'proxy'}
            disabled={routeSettingsLocked}
            onClick={() => selectConnectionMode('proxy')}
          >PROXY</button>
          <button
            type="button"
            className={mode === 'tun' ? 'active' : ''}
            aria-pressed={mode === 'tun'}
            disabled={routeSettingsLocked}
            onClick={() => selectConnectionMode('tun')}
          >TUN</button>
        </div>
      </div>
      <div className={`routing-summary ${appRoutingActive ? 'is-on' : ''}`}>
        <span className="routing-summary-icon">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M6 5v8a4 4 0 0 0 4 4h8M14.5 13.5 18 17l-3.5 3.5M10 8.5 6 4.5 2 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <span><small>{mode.toUpperCase()} · приложения</small><strong>{routeLabel}</strong><em>{routeDescription}</em></span>
      </div>
      <div className={`auto-connect-summary ${settings.autoConnectVpn ? 'is-on' : ''}`}><i /><span>Автоподключение {settings.autoConnectVpn ? 'включено' : 'выключено'}</span></div>
      {!runtime.xrayReady && <div className="jey-note"><span>i</span><div><strong>Ставим ядро</strong><p>{xrayUpdate?.error || 'Качаем Xray / sing-box. Потом нажми большую кнопку.'}</p></div></div>}
    </aside>
  </section>;
}
