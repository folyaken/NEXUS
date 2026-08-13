import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, UpdateInfo, VpnProfile, VpnRuntime, VpnSubscriptionInfo } from '../main/types';
import { canConnect, displayName } from '../main/vpn-classify';
import { Flag } from './Flag';

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
  mode: 'proxy',
};

function subscriptionKey(profile: VpnProfile): string {
  return profile.subscriptionUrl || 'manual';
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
  const [profiles, setProfiles] = useState<VpnProfile[]>([]);
  const [runtime, setRuntime] = useState<VpnRuntime>(EMPTY_RUNTIME);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<'refresh' | 'ping' | null>(null);
  const [tab, setTab] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(settings.lastVpnProfileId);
  const desktop = Boolean(window.nexus);
  const xrayUpdate = updates.find((item) => item.id === 'jey2ray');
  const mode = settings.vpnMode === 'tun' ? 'tun' : 'proxy';

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
  const info: VpnSubscriptionInfo | undefined = (runtime.subscriptions ?? []).find((item) => tab !== 'all' && item.url === tab) ?? runtime.subscriptions?.[0];
  const selected = nodes.find((item) => item.id === selectedId) ?? nodes.find((item) => !canConnect(item)) ?? nodes[0] ?? null;
  const onAir = runtime.status === 'connected' && runtime.activeProfileId === selected?.id;
  const otherLive = runtime.status === 'connected' && runtime.activeProfileId !== selected?.id;
  const used = (info?.upload ?? 0) + (info?.download ?? 0);
  const quota = info?.total ? formatBytes(info.total) : '∞';
  const title = telegramOf(info) || 'Jey2Ray';

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

  const ping = () => holdAction('ping', async () => {
    try {
      const next = await window.nexus?.pingVpn();
      if (next) setProfiles(next);
      onToast('Пинг измерен');
    } catch (error) {
      onToast(cleanError(error));
    }
  }, 2200);

  const powerLabel = onAir
    ? `Работает · ${mode.toUpperCase()} · 127.0.0.1:${runtime.inboundPort + 1}`
    : otherLive
      ? 'Другой сервер онлайн. Нажми — переключить сюда'
      : runtime.status === 'connecting'
        ? 'Подключаем…'
        : runtime.status === 'error'
          ? (runtime.error || 'Ошибка')
          : 'Выключено';

  return <section className="page-section jey-page happ-shell">
    <div className="happ-left">
      <div className="jey-toolbar tight">
        <h2>Серверы</h2>
        <div className="jey-toolbar-actions">
          <button className="ghost-action" onClick={() => setImportOpen((value) => !value)}>
            <svg className="ico" viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            Добавить подписку
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
          {key === 'all' ? `Все · ${nodes.length}` : `${(runtime.subscriptions ?? []).find((item) => item.url === key)?.title || 'подписка'} · ${nodes.filter((item) => subscriptionKey(item) === key).length}`}
        </button>)}
      </div>}

      <div className="happ-card">
        <div className="happ-card-top">
          <strong>{title}</strong>
          <span>узлов {visible.length}</span>
        </div>
        <div className="happ-card-meta">
          <span>{formatBytes(used)} / {quota}</span>
          <span>истекает {formatExpire(info?.expireAt)}</span>
          <span>обновлено {formatWhen(info?.lastSync)}</span>
        </div>
        {info?.announce && <div className="happ-ribbon">{info.announce}</div>}
      </div>

      <div className="happ-list">
        {visible.map((profile) => {
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
        <strong>{selected ? displayName(selected) : 'Сервер не выбран'}</strong>
        <small>{powerLabel}</small>
      </div>
      <div className="mode-switch">
        <button className={mode === 'proxy' ? 'active' : ''} onClick={() => onSettings({ ...settings, vpnMode: 'proxy' })}>Proxy</button>
        <button className={mode === 'tun' ? 'active' : ''} onClick={() => onSettings({ ...settings, vpnMode: 'tun' })}>TUN</button>
      </div>
      <p className="mode-hint">
        {mode === 'proxy'
          ? 'Proxy: Windows получит системный HTTP-прокси. Браузер начнёт ходить через выбранный сервер.'
          : 'TUN: весь трафик системы. Нужны права администратора. Если не стартует — вернись на Proxy.'}
      </p>
      <button type="button" className={`nx-switch ${settings.autoConnectVpn ? 'is-on' : ''}`} onClick={() => onSettings({ ...settings, autoConnectVpn: !settings.autoConnectVpn })}>
        <i />
        <span>Автоподключение</span>
      </button>
      {!runtime.xrayReady && <div className="jey-note"><span>i</span><div><strong>Ставим ядро</strong><p>{xrayUpdate?.error || 'Качаем Xray / sing-box. Потом нажми большую кнопку.'}</p></div></div>}
    </aside>
  </section>;
}
