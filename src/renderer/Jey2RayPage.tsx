import { useEffect, useMemo, useState } from 'react';
import { animated, config, useSpring } from '@react-spring/web';
import type { AppSettings, UpdateInfo, VpnProfile, VpnRuntime, VpnSubscriptionInfo } from '../main/types';

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

function JeyVisual() {
  const spin = useSpring({ from: { turn: 0 }, to: { turn: 360 }, loop: true, config: { duration: 15000 } });
  const reverse = useSpring({ from: { turn: 360 }, to: { turn: 0 }, loop: true, config: { duration: 21000 } });
  const core = useSpring({ from: { scale: .9, opacity: .72 }, to: { scale: 1.08, opacity: 1 }, loop: { reverse: true }, config: { duration: 2200 } });
  return <div className="jey-orb">
    <animated.div className="jey-ring ring-one" style={{ transform: spin.turn.to((turn) => `rotate(${turn}deg) scaleY(.48)`) }} />
    <animated.div className="jey-ring ring-two" style={{ transform: reverse.turn.to((turn) => `rotate(${turn - 32}deg) scaleY(.42)`) }} />
    <animated.div className="jey-planet-track planet-track-one" style={{ transform: spin.turn.to((turn) => `rotate(${turn}deg)`) }}><span className="jey-planet planet-one" /></animated.div>
    <animated.div className="jey-planet-track planet-track-two" style={{ transform: reverse.turn.to((turn) => `rotate(${turn}deg)`) }}><span className="jey-planet planet-two" /></animated.div>
    <animated.span className="jey-core" style={{ transform: core.scale.to((scale) => `scale(${scale})`), opacity: core.opacity }}>✦</animated.span>
  </div>;
}

function subscriptionKey(profile: VpnProfile): string {
  return profile.subscriptionUrl || 'manual';
}

function formatBytes(value?: number): string {
  if (!value) return '0 MB';
  if (value < 1024) return `${value} B`;
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function formatExpire(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

function formatSync(value?: string): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function Flag({ code }: { code?: string }) {
  const iso = !code || code === 'UN' ? '' : code.toLowerCase();
  if (!iso) return <span className="happ-flag">🌐</span>;
  return <img className="happ-flag-img" alt="" src={`https://flagcdn.com/w80/${iso}.png`} />;
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
  const intro = useSpring({ from: { opacity: 0, y: 12 }, to: { opacity: 1, y: 0 }, config: config.gentle });
  const desktop = Boolean(window.nexus);
  const xrayUpdate = updates.find((item) => item.id === 'jey2ray');

  useEffect(() => {
    const api = window.nexus;
    if (!api?.getVpn) return;
    void api.getVpn().then((snapshot) => {
      setProfiles(snapshot.profiles);
      setRuntime(snapshot.runtime);
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
        onToast(imported.length > 1 ? `Подписка: серверов ${imported.length}` : `Профиль «${imported[0].name}» сохранён`);
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

  const used = (info?.upload ?? 0) + (info?.download ?? 0);
  const quota = info?.total ? formatBytes(info.total) : '∞';
  const statusText = runtime.status === 'connected' ? `Подключено · SOCKS 127.0.0.1:${runtime.inboundPort}` : runtime.status === 'connecting' ? 'Подключение…' : runtime.status === 'error' ? (runtime.error || 'Ошибка') : 'Отключено';

  return <section className="page-section jey-page">
    <animated.div className="jey-hero" style={{ opacity: intro.opacity, transform: intro.y.to((y) => `translateY(${y}px)`) }}>
      <div>
        <span className="section-kicker">PRIVATE NETWORK LAYER</span>
        <h1>Jey2Ray</h1>
        <p>Список как в Happ: страна, протокол, транспорт, REALITY/TLS, трафик и срок подписки.</p>
        <span className={`coming-badge ${runtime.status === 'connected' ? 'is-live' : ''}`}><i /> {statusText}</span>
      </div>
      <JeyVisual />
    </animated.div>

    <div className="jey-import">
      <div>
        <span className="section-kicker">ADD PROFILE</span>
        <h2>Ссылка или подписка</h2>
      </div>
      <textarea className="jey-link" rows={2} value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://connect.rsvps.tech/…   или   vless://  hy2://" />
      <div className="jey-import-row">
        <input className="jey-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя (для одной ссылки)" />
        <button className="primary-button small" disabled={busy || !link.trim()} onClick={() => void importLink()}><span>Добавить</span><b>↗</b></button>
      </div>
    </div>

    <div className="jey-toolbar">
      <div>
        <span className="section-kicker">ENDPOINTS</span>
        <h2>Серверы</h2>
      </div>
      <div className="jey-toolbar-actions">
        <label className="jey-autostart">
          <input type="checkbox" checked={settings.autoConnectVpn} onChange={() => onSettings({ ...settings, autoConnectVpn: !settings.autoConnectVpn })} />
          Автоподключение
        </label>
        <button className="quiet-button" disabled={busy} onClick={() => void window.nexus?.refreshVpn().then((count) => onToast(count ? `Обновлено · ${count}` : 'Нет подписок')).catch((error: Error) => onToast(error.message))}>Обновить</button>
        <button className="quiet-button" disabled={syncing} onClick={onSync}>{runtime.xrayReady ? 'Xray' : 'Скачать Xray'} {xrayUpdate?.latestVersion ?? ''}</button>
        {runtime.status === 'connected' && <button className="primary-button small" disabled={busy} onClick={() => void disconnect()}>Отключить</button>}
      </div>
    </div>

    {tabs.length > 1 && <div className="jey-subs">
      {tabs.map((key) => <button key={key} className={`jey-sub ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
        {key === 'all' ? `Все · ${nodes.length}` : `${(runtime.subscriptions ?? []).find((item) => item.url === key)?.title || new URL(key).host} · ${nodes.filter((item) => subscriptionKey(item) === key).length}`}
      </button>)}
    </div>}

    <div className="happ-subhead">
      <div className="happ-subhead-top">
        <strong>{info?.supportUrl?.includes('t.me') ? info.supportUrl.replace(/^https?:\/\/t\.me\//, 'tg: @') : (info?.title || 'Jey2Ray')}</strong>
        <span>{info?.lastSync ? `${formatSync(info.lastSync)} · ` : ''}автообновление · {info?.updateHours ?? 1}ч. · узлов {visible.length}</span>
      </div>
      <div className="happ-quota">
        <span>{formatBytes(used)} / {quota}</span>
        <em>Истекает: {formatExpire(info?.expireAt)}</em>
      </div>
      {info?.announce && <div className="happ-announce">{info.announce}</div>}
    </div>

    {visible.length === 0 && <div className="empty-state"><span>✦</span><h3>Серверов нет</h3><p>Добавь подписку — появятся страны и протоколы, как в Happ.</p></div>}

    <div className="happ-list">
      {visible.map((profile) => {
        const active = runtime.activeProfileId === profile.id && runtime.status === 'connected';
        return <button key={profile.id} className={`happ-row ${active ? 'is-active' : ''}`} onClick={() => void (active ? disconnect() : connect(profile.id))}>
          <Flag code={profile.country} />
          <span className="happ-copy">
            <strong>{profile.name}</strong>
            <small>{stackOf(profile)}</small>
            <small className="happ-meta">{profile.server}:{profile.port}{profile.params.sni ? ` · sni ${profile.params.sni}` : ''}{profile.params.flow ? ` · ${profile.params.flow}` : ''}</small>
          </span>
          {profile.isNew && <em className="happ-new">NEW</em>}
          <span className="happ-go">{active ? '●' : '›'}</span>
        </button>;
      })}
    </div>

    {!runtime.xrayReady && <div className="jey-note"><span>i</span><div><strong>Нужен Xray-core</strong><p>Нажми «Скачать Xray».</p></div></div>}
    {runtime.error && runtime.status === 'error' && <div className="jey-note"><span>!</span><div><strong>Ошибка</strong><p>{runtime.error}</p></div></div>}
  </section>;
}
