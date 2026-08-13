import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, UpdateInfo, VpnProfile, VpnRuntime, VpnSubscriptionInfo } from '../main/types';
import { displayName } from '../main/vpn-classify';
import { Flag } from './Flag';

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

function formatExpire(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

function stackOf(profile: VpnProfile): string {
  return profile.stack || `${profile.protocol.toUpperCase()} / ${(profile.params.network || 'TCP').toUpperCase()} / ${(profile.params.security || 'NONE').toUpperCase()} / JSON`;
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
  const [profiles, setProfiles] = useState<VpnProfile[]>([]);
  const [runtime, setRuntime] = useState<VpnRuntime>(EMPTY_RUNTIME);
  const [busy, setBusy] = useState(false);
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
    }).catch((error: Error) => onToast(error.message));
    return api.onVpnChanged((snapshot) => {
      setProfiles(snapshot.profiles);
      setRuntime(snapshot.runtime);
    });
  }, [onToast]);

  useEffect(() => {
    if (!desktop || runtime.xrayReady) return;
    void window.nexus?.ensureVpnCore().then(() => window.nexus?.getVpn()).then((snapshot) => {
      if (snapshot) setRuntime(snapshot.runtime);
    }).catch((error: Error) => onToast(error.message));
  }, [desktop, runtime.xrayReady, onToast]);

  const nodes = useMemo(() => profiles.filter((item) => item.kind !== 'notice'), [profiles]);
  const tabs = useMemo(() => ['all', ...new Set(nodes.map(subscriptionKey))], [nodes]);
  const visible = useMemo(() => tab === 'all' ? nodes : nodes.filter((item) => subscriptionKey(item) === tab), [nodes, tab]);
  const info: VpnSubscriptionInfo | undefined = (runtime.subscriptions ?? []).find((item) => tab !== 'all' && item.url === tab) ?? runtime.subscriptions?.[0];
  const selected = nodes.find((item) => item.id === selectedId) ?? nodes[0] ?? null;
  const onAir = runtime.status === 'connected' && runtime.activeProfileId === selected?.id;
  const used = (info?.upload ?? 0) + (info?.download ?? 0);
  const quota = info?.total ? formatBytes(info.total) : '∞';

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
        if (imported[0].subscriptionUrl) setTab(imported[0].subscriptionUrl);
        setSelectedId(imported[0].id);
        onToast(`Подписка: серверов ${imported.length}`);
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Не удалось импортировать ссылку');
    } finally {
      setBusy(false);
    }
  };

  const connect = async (id: string) => {
    try {
      setBusy(true);
      setSelectedId(id);
      if (!desktop) {
        setRuntime({ ...runtime, status: 'connected', activeProfileId: id, pid: 4400 });
        return;
      }
      if (!runtime.xrayReady) onToast('Скачиваем Xray-core, затем подключаемся…');
      await window.nexus?.connectVpn(id);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Не удалось подключиться');
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
      onToast(error instanceof Error ? error.message : 'Не удалось отключить VPN');
    } finally {
      setBusy(false);
    }
  };

  const togglePower = async () => {
    if (!selected) {
      onToast('Сначала выбери сервер слева');
      return;
    }
    if (onAir || runtime.status === 'connected') await disconnect();
    else await connect(selected.id);
  };

  return <section className="page-section jey-page happ-shell">
    <div className="happ-left">
      <div className="jey-import compact">
        <textarea className="jey-link" rows={2} value={link} onChange={(event) => setLink(event.target.value)} placeholder="Подписка https://… или vless:// hy2://" />
        <div className="jey-import-row">
          <input className="jey-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя (необязательно)" />
          <button className="primary-button small" disabled={busy || !link.trim()} onClick={() => void importLink()}>Добавить</button>
        </div>
      </div>

      <div className="jey-toolbar tight">
        <h2>Серверы</h2>
        <div className="jey-toolbar-actions">
          <button className="quiet-button" disabled={busy} onClick={() => void window.nexus?.refreshVpn().then((count) => onToast(count ? `Обновлено · ${count}` : 'Нет подписок')).catch((error: Error) => onToast(error.message))}>Обновить</button>
          <button className="quiet-button" disabled={syncing} onClick={onSync}>{runtime.xrayReady ? 'Xray ок' : 'Скачать Xray'} {xrayUpdate?.latestVersion ?? ''}</button>
        </div>
      </div>

      {tabs.length > 1 && <div className="jey-subs">
        {tabs.map((key) => <button key={key} className={`jey-sub ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
          {key === 'all' ? `Все · ${nodes.length}` : `${(runtime.subscriptions ?? []).find((item) => item.url === key)?.title || 'подписка'} · ${nodes.filter((item) => subscriptionKey(item) === key).length}`}
        </button>)}
      </div>}

      <div className="happ-subhead">
        <div className="happ-subhead-top">
          <strong>{info?.title || 'Jey2Ray'}</strong>
          <span>узлов {visible.length}</span>
        </div>
        <div className="happ-quota">
          <span>{formatBytes(used)} / {quota}</span>
          <em>Истекает: {formatExpire(info?.expireAt)}</em>
        </div>
        {info?.announce && <div className="happ-announce">{info.announce}</div>}
      </div>

      <div className="happ-list">
        {visible.map((profile) => {
          const live = runtime.status === 'connected' && runtime.activeProfileId === profile.id;
          const picked = selected?.id === profile.id;
          return <button key={profile.id} className={`happ-row ${live ? 'is-live' : ''} ${picked ? 'is-active' : ''}`} onClick={() => setSelectedId(profile.id)} onDoubleClick={() => void connect(profile.id)}>
            <Flag code={profile.country} />
            <span className="happ-copy">
              <strong>{displayName(profile)}</strong>
              <small>{stackOf(profile)}</small>
            </span>
            {live && <em className="happ-on">ВКЛ</em>}
            <span className="happ-go">›</span>
          </button>;
        })}
      </div>
    </div>

    <aside className="happ-right">
      <button className={`power-btn ${onAir ? 'is-on' : ''} ${runtime.status === 'connecting' ? 'is-wait' : ''}`} disabled={busy} onClick={() => void togglePower()} aria-label={onAir ? 'Выключить VPN' : 'Включить VPN'}>
        <span>⏻</span>
      </button>
      <div className="power-meta">
        {selected ? <Flag code={selected.country} /> : null}
        <strong>{selected ? displayName(selected) : 'Сервер не выбран'}</strong>
        <small>
          {runtime.status === 'connected' ? `Работает · ${mode.toUpperCase()} · 127.0.0.1:${runtime.inboundPort + 1}` : runtime.status === 'connecting' ? 'Подключаем…' : runtime.status === 'error' ? (runtime.error || 'Ошибка') : 'Выключено'}
        </small>
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
      <label className="jey-autostart">
        <input type="checkbox" checked={settings.autoConnectVpn} onChange={() => onSettings({ ...settings, autoConnectVpn: !settings.autoConnectVpn })} />
        Автоподключение
      </label>
      {!runtime.xrayReady && <div className="jey-note"><span>i</span><div><strong>Ставим Xray</strong><p>{xrayUpdate?.error || 'Качаем ядро с GitHub. Потом нажми большую кнопку.'}</p></div></div>}
    </aside>
  </section>;
}
