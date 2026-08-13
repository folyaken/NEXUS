import { useEffect, useState } from 'react';
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

  const importLink = async () => {
    try {
      setBusy(true);
      if (desktop) {
        const imported = await window.nexus?.importVpn(link, name || undefined);
        if (imported?.length) {
          setLink('');
          onToast(imported.length > 1 ? `Подписка: добавлено узлов — ${imported.length}` : `Профиль «${imported[0].name}» сохранён`);
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

  const statusText = runtime.status === 'connected' ? `Подключено · SOCKS 127.0.0.1:${runtime.inboundPort}` : runtime.status === 'connecting' ? 'Подключение…' : runtime.status === 'error' ? (runtime.error || 'Ошибка') : 'Отключено';

  return <section className="page-section jey-page">
    <animated.div className="jey-hero" style={{ opacity: intro.opacity, transform: intro.y.to((y) => `translateY(${y}px)`) }}>
      <div>
        <span className="section-kicker">PRIVATE NETWORK LAYER</span>
        <h1>Jey2Ray</h1>
        <p>Вставь шаринг-ссылку (vless/vmess/trojan/ss) или HTTPS-подписку вроде happ/vlv.on. Локальный SOCKS — 127.0.0.1:{settings.vpnInboundPort}.</p>
        <span className={`coming-badge ${runtime.status === 'connected' ? 'is-live' : ''}`}><i /> {statusText}</span>
      </div>
      <JeyVisual />
    </animated.div>

    <div className="jey-import">
      <div>
        <span className="section-kicker">ADD PROFILE</span>
        <h2>Ссылка или подписка</h2>
      </div>
      <textarea className="jey-link" rows={3} value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://vlv.on/…   или   vless://…  vmess://…  trojan://…  ss://…" />
      <div className="jey-import-row">
        <input className="jey-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя профиля (необязательно)" />
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
        <button className="quiet-button" disabled={busy} onClick={() => void window.nexus?.refreshVpn().then((count) => onToast(count ? `Подписки обновлены · ${count} узлов` : 'Нет сохранённых подписок')).catch((error: Error) => onToast(error.message))}>Обновить подписки</button>
        <button className="quiet-button" disabled={syncing} onClick={onSync}>{runtime.xrayReady ? 'Обновить Xray' : 'Скачать Xray'} {xrayUpdate?.latestVersion ? `· ${xrayUpdate.latestVersion}` : ''}</button>
        {runtime.status === 'connected' && <button className="primary-button small" disabled={busy} onClick={() => void disconnect()}>Отключить</button>}
      </div>
    </div>

    {profiles.length === 0 && <div className="empty-state"><span>✦</span><h3>Профилей пока нет</h3><p>Вставь ссылку от провайдера выше. Xray качается с GitHub XTLS/Xray-core.</p></div>}

    <div className="jey-profile-grid">
      {profiles.map((profile) => {
        const active = runtime.activeProfileId === profile.id && runtime.status === 'connected';
        return <article key={profile.id} className={`jey-profile ${active ? 'is-active' : ''}`}>
          <div className="jey-profile-head">
            <span className={`jey-proto ${profile.protocol}`}>{profile.protocol}</span>
            <span className={`status-copy ${active ? 'green' : runtime.activeProfileId === profile.id && runtime.status === 'error' ? 'red' : 'muted'}`}>{active ? 'Подключено' : 'Отключено'}</span>
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

    {!runtime.xrayReady && <div className="jey-note"><span>i</span><div><strong>Нужен Xray-core</strong><p>Нажми «Скачать Xray» — NEXUS возьмёт последний релиз с github.com/XTLS/Xray-core и положит `modules/bin/xray.exe`. Пока бинарника нет, подключение не стартует.</p></div></div>}
    {runtime.error && runtime.status === 'error' && <div className="jey-note"><span>!</span><div><strong>Ошибка подключения</strong><p>{runtime.error}</p></div></div>}
  </section>;
}
