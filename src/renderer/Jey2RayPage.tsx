import { useEffect, useMemo, useState } from 'react';
import { animated, config, useSpring } from '@react-spring/web';
import type { AppSettings, UpdateInfo, VpnProfile, VpnRuntime } from '../main/types';

const EMPTY_RUNTIME: VpnRuntime = {
  status: 'disconnected',
  activeProfileId: null,
  activeName: null,
  pid: null,
  inboundPort: 10808,
  xrayReady: false,
  xrayVersion: null,
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

function subscriptionTitle(key: string): string {
  if (key === 'manual') return 'Ручные';
  try {
    return new URL(key).host.replace(/^www\./, '');
  } catch {
    return 'Подписка';
  }
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
  const [showNotices, setShowNotices] = useState(false);
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

  const nodes = useMemo(() => profiles.filter((item) => item.kind !== 'notice'), [profiles]);
  const notices = useMemo(() => profiles.filter((item) => item.kind === 'notice'), [profiles]);
  const tabs = useMemo(() => {
    const keys = [...new Set(nodes.map(subscriptionKey))];
    return ['all', ...keys];
  }, [nodes]);

  const visible = useMemo(() => {
    const scoped = tab === 'all' ? nodes : nodes.filter((item) => subscriptionKey(item) === tab);
    return scoped;
  }, [nodes, tab]);

  const byCountry = useMemo(() => {
    const groups = new Map<string, VpnProfile[]>();
    for (const profile of visible) {
      const key = `${profile.flag ?? '🌐'} ${profile.countryName ?? 'Другие'}`;
      const list = groups.get(key) ?? [];
      list.push(profile);
      groups.set(key, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  }, [visible]);

  const importLink = async () => {
    try {
      setBusy(true);
      if (desktop) {
        const imported = await window.nexus?.importVpn(link, name || undefined);
        if (imported?.length) {
          setLink('');
          const firstSub = imported[0].subscriptionUrl;
          if (firstSub) setTab(firstSub);
          onToast(imported.length > 1 ? `Подписка: серверов ${imported.length}` : `Профиль «${imported[0].name}» сохранён`);
        }
      } else {
        onToast('Импорт ссылок работает в окне Electron (npm start)');
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

  const remove = async (id: string) => {
    try {
      if (desktop) await window.nexus?.removeVpn(id);
      else setProfiles((current) => current.filter((item) => item.id !== id));
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Не удалось удалить профиль');
    }
  };

  const purgeNotices = async () => {
    for (const item of notices) await remove(item.id);
    onToast('Служебные карточки удалены');
  };

  const statusText = runtime.status === 'connected' ? `Подключено · SOCKS 127.0.0.1:${runtime.inboundPort}` : runtime.status === 'connecting' ? 'Подключение…' : runtime.status === 'error' ? (runtime.error || 'Ошибка') : 'Отключено';

  return <section className="page-section jey-page">
    <animated.div className="jey-hero" style={{ opacity: intro.opacity, transform: intro.y.to((y) => `translateY(${y}px)`) }}>
      <div>
        <span className="section-kicker">PRIVATE NETWORK LAYER</span>
        <h1>Jey2Ray</h1>
        <p>Подписки и шаринг-ссылки, как в Happ: отдельно по кабинету и по странам. Служебные уведомления панели скрываются.</p>
        <span className={`coming-badge ${runtime.status === 'connected' ? 'is-live' : ''}`}><i /> {statusText}</span>
      </div>
      <JeyVisual />
    </animated.div>

    <div className="jey-import">
      <div>
        <span className="section-kicker">ADD PROFILE</span>
        <h2>Ссылка или подписка</h2>
      </div>
      <textarea className="jey-link" rows={3} value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://vlv.on/…   или   vless://…" />
      <div className="jey-import-row">
        <input className="jey-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя (для одной ссылки)" />
        <button className="primary-button small" disabled={busy || !link.trim()} onClick={() => void importLink()}><span>Добавить</span><b>↗</b></button>
      </div>
    </div>

    <div className="jey-toolbar">
      <div>
        <span className="section-kicker">SAVED ENDPOINTS</span>
        <h2>Профили подключения</h2>
      </div>
      <div className="jey-toolbar-actions">
        <label className="jey-autostart">
          <input type="checkbox" checked={settings.autoConnectVpn} onChange={() => onSettings({ ...settings, autoConnectVpn: !settings.autoConnectVpn })} />
          Автоподключение
        </label>
        <button className="quiet-button" disabled={busy} onClick={() => void window.nexus?.refreshVpn().then((count) => onToast(count ? `Подписки обновлены · ${count} серверов` : 'Нет сохранённых подписок')).catch((error: Error) => onToast(error.message))}>Обновить подписки</button>
        <button className="quiet-button" disabled={syncing} onClick={onSync}>{runtime.xrayReady ? 'Обновить Xray' : 'Скачать Xray'} {xrayUpdate?.latestVersion ? `· ${xrayUpdate.latestVersion}` : ''}</button>
        {runtime.status === 'connected' && <button className="primary-button small" disabled={busy} onClick={() => void disconnect()}>Отключить</button>}
      </div>
    </div>

    {tabs.length > 1 && <div className="jey-subs">
      {tabs.map((key) => <button key={key} className={`jey-sub ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
        {key === 'all' ? `Все · ${nodes.length}` : `${subscriptionTitle(key)} · ${nodes.filter((item) => subscriptionKey(item) === key).length}`}
      </button>)}
    </div>}

    {visible.length === 0 && <div className="empty-state"><span>✦</span><h3>Серверов нет</h3><p>Обнови подписку с HWID или вставь обычную vless-ссылку. Уведомления панели сюда больше не попадают.</p></div>}

    {byCountry.map(([country, list]) => <div key={country} className="jey-country">
      <div className="jey-country-head"><strong>{country}</strong><span>{list.length}</span></div>
      <div className="jey-profile-grid">
        {list.map((profile) => {
          const active = runtime.activeProfileId === profile.id && runtime.status === 'connected';
          return <article key={profile.id} className={`jey-profile ${active ? 'is-active' : ''}`}>
            <div className="jey-profile-head">
              <span className={`jey-proto ${profile.protocol}`}>{profile.protocol}</span>
              <span className={`status-copy ${active ? 'green' : 'muted'}`}>{active ? 'Подключено' : 'Отключено'}</span>
            </div>
            <h3>{profile.name}</h3>
            <p>{profile.server}:{profile.port}</p>
            <div className="jey-profile-actions">
              {active
                ? <button className="primary-button small" disabled={busy} onClick={() => void disconnect()}>Отключить</button>
                : <button className="primary-button small" disabled={busy} onClick={() => void connect(profile.id)}>Подключить</button>}
              <button className="quiet-button" disabled={busy} onClick={() => void remove(profile.id)}>Удалить</button>
            </div>
          </article>;
        })}
      </div>
    </div>)}

    {notices.length > 0 && <div className="jey-notices">
      <button className="quiet-button" onClick={() => setShowNotices((value) => !value)}>{showNotices ? 'Скрыть' : 'Показать'} уведомления панели ({notices.length})</button>
      <button className="quiet-button" onClick={() => void purgeNotices()}>Удалить мусор</button>
      {showNotices && <div className="jey-notice-list">{notices.map((item) => <span key={item.id}>{item.name}</span>)}</div>}
    </div>}

    {!runtime.xrayReady && <div className="jey-note"><span>i</span><div><strong>Нужен Xray-core</strong><p>Нажми «Скачать Xray». Пока бинарника нет, подключение не стартует.</p></div></div>}
    {runtime.error && runtime.status === 'error' && <div className="jey-note"><span>!</span><div><strong>Ошибка подключения</strong><p>{runtime.error}</p></div></div>}
  </section>;
}
