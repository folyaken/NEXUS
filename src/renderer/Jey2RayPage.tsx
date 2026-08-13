import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, UpdateInfo, VpnProfile, VpnRuntime, VpnSubscriptionInfo } from '../main/types';
import { canConnect, displayName } from '../main/vpn-classify';

function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim();
}
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

function formatWhen(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
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

function Signal({ ms }: { ms?: number | null }) {
  const level = ms == null ? 0 : ms < 90 ? 4 : ms < 160 ? 3 : ms < 260 ? 2 : 1;
  const tone = level >= 3 ? 'good' : level === 2 ? 'ok' : level === 1 ? 'weak' : 'off';
  return <span className={`happ-signal ${tone}`} title={ms == null ? 'Нет замера' : `${ms} мс`}>
    {[1, 2, 3, 4].map((bar) => <i key={bar} className={bar <= level ? 'on' : ''} />)}
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
  const selected = nodes.find((item) => item.id === selectedId) ?? nodes.find((item) => !canConnect(item)) ?? nodes[0] ?? null;
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
      if (!runtime.xrayReady) onToast('Скачиваем Xray-core, затем подключаемся…');
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
          <button className="quiet-button" disabled={busy} onClick={() => {
            setBusy(true);
            void window.nexus?.pingVpn().then((next) => {
              if (next) setProfiles(next);
              onToast('Пинг измерен');
            }).catch((error: Error) => onToast(error.message)).finally(() => setBusy(false));
          }}>Тест пинга</button>
          {!runtime.xrayReady && <button className="quiet-button" disabled={syncing} onClick={onSync}>Скачать ядро {xrayUpdate?.latestVersion ?? ''}</button>}
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
        <div className="happ-quota happ-quota-soft">
          <span>Обновлено {formatWhen(info?.lastSync)}</span>
        </div>
        {info?.announce && <div className="happ-announce">{info.announce}</div>}
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
      <button className={`power-btn ${onAir ? 'is-on' : ''} ${runtime.status === 'connecting' ? 'is-wait' : ''}`} disabled={busy} onClick={() => void togglePower()} aria-label={onAir ? 'Выключить VPN' : 'Включить VPN'}>
        <b className="radar-ring r1" />
        <b className="radar-ring r2" />
        <b className="radar-ring r3" />
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
      <button type="button" className={`nx-switch ${settings.autoConnectVpn ? 'is-on' : ''}`} onClick={() => onSettings({ ...settings, autoConnectVpn: !settings.autoConnectVpn })}>
        <i />
        <span>Автоподключение</span>
      </button>
      {!runtime.xrayReady && <div className="jey-note"><span>i</span><div><strong>Ставим Xray</strong><p>{xrayUpdate?.error || 'Качаем ядро с GitHub. Потом нажми большую кнопку.'}</p></div></div>}
    </aside>
  </section>;
}
