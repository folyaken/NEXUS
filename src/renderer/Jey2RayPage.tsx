import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, UpdateInfo, VpnAppRoutingMode, VpnProfile, VpnRuntime, VpnSplitApp, VpnSubscriptionInfo } from '../main/types';
import { canConnect, displayName } from '../main/vpn-classify';
import { Flag } from './Flag';
import { ConnectionDiagnostics } from './ConnectionDiagnostics';
import { SubscriptionManager, type SubscriptionAction } from './SubscriptionManager';
import AppPicker from './AppPicker';
import { dateLocale, t } from '../main/i18n';
import { DNS_PROVIDERS, isValidDnsAddress } from '../main/dns-servers';
import { MAX_ROUTING_RULES, ROUTING_PRESETS, isValidRoutingValue } from '../main/routing-rules';

function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim();
  // Ошибки приходят из main-процесса готовой строкой по-русски: там текст
  // служит ключом. Перевод применяется здесь — иначе в английском интерфейсе
  // всплывала русская плашка поверх переведённого экрана.
  return t(text);
}

const EMPTY_RUNTIME: VpnRuntime = {
  status: 'disconnected',
  activeProfileId: null,
  activeName: null,
  connectedAt: null,
  pid: null,
  inboundPort: 10808,
  xrayReady: false,
  xrayVersion: null,
  subscriptions: [],
  lanShared: false,
  lanEndpoints: [],
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
  return new Intl.DateTimeFormat(dateLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatSessionDuration(connectedAt: string | null, now: number): string {
  const started = connectedAt ? Date.parse(connectedAt) : Number.NaN;
  const elapsedSeconds = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function formatExpire(value?: string): string {
  if (!value) return t('без срока');
  const date = new Date(value);
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  const stamp = new Intl.DateTimeFormat(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  if (days < 0) return `${stamp} · ${t('истекла')}`;
  if (days === 0) return `${stamp} · ${t('сегодня')}`;
  return `${stamp} · ${t('ещё')} ${days} ${t('дн.')}`;
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
    return <span className="server-ping off" title={t('Ещё не измеряли')}><span className="server-signal off">{[1, 2, 3, 4].map((bar) => <i key={bar} />)}</span><em>—</em></span>;
  }
  if (ms < 0) {
    return <span className="server-ping soft" title={t('Порт не отвечает на TCP, но узел рабочий (часто Reality / Hysteria)')}>
      <span className="server-signal soft">{[1, 2, 3, 4].map((bar) => <i key={bar} className={bar <= 3 ? 'on' : ''} />)}</span>
      <em>{t('ок')}</em>
    </span>;
  }
  const level = ms < 60 ? 4 : ms < 120 ? 3 : ms < 220 ? 2 : 1;
  const tone = level >= 3 ? 'good' : level === 2 ? 'ok' : 'weak';
  return <span className={`server-ping ${tone}`} title={`${ms} ${t('мс')}`}>
    <span className={`server-signal ${tone}`}>{[1, 2, 3, 4].map((bar) => <i key={bar} className={bar <= level ? 'on' : ''} />)}</span>
    <em>{ms}</em>
  </span>;
}

/**
 * Имя сервера для показа.
 *
 * displayName() собирает название из countryName, а его main-процесс отдаёт
 * всегда по-русски: там страна служит ключом и от языка интерфейса не зависит.
 * Поэтому перевод применяется здесь, при показе, к каждой части имени
 * отдельно — «Нидерланды · Амстердам» превращается в «Netherlands · Амстердам»,
 * где город остаётся как есть (его присылает провайдер).
 */
function localizedServerName(profile: VpnProfile): string {
  const shown = displayName(profile).trim();
  if (!shown) return shown;
  return shown.split(/(\s*[·•|]\s*)/).map((part) => (/^\s*[·•|]\s*$/.test(part) ? part : t(part.trim()))).join('');
}

/*
  Строка сервера вынесена в отдельный компонент и обёрнута в memo.

  На странице живёт секундный счётчик времени сессии. Он меняет состояние
  страницы, а вместе с ним React заново собирал разметку каждой строки списка —
  при полусотне серверов это полсотни флагов (SVG) и значков сигнала раз в
  секунду, на пустом месте. Отсюда и бралось ощущение подвисания.

  Теперь строка перерисовывается, только когда меняется что-то её собственное:
  выделение, состояние подключения или пинг. Тиканье счётчика её больше не
  трогает. Внешне не изменилось ничего.
*/
type ServerRowProps = {
  profile: VpnProfile;
  live: boolean;
  picked: boolean;
  blocked: string | null;
  isBest: boolean;
  onSelect: (id: string) => void;
  onLaunch: (profile: VpnProfile, blocked: string | null) => void;
};

const ServerRow = memo(function ServerRow({ profile, live, picked, blocked, isBest, onSelect, onLaunch }: ServerRowProps) {
  return <button
    className={`server-row ${live ? 'is-live' : ''} ${picked ? 'is-active' : ''} ${blocked ? 'is-off' : ''} ${isBest ? 'is-best' : ''}`}
    onClick={() => onSelect(profile.id)}
    onDoubleClick={() => onLaunch(profile, blocked)}
  >
    {isBest && <span className="server-crown" title={t('Самый быстрый сервер')} aria-label={t('Самый быстрый сервер')}>
      <svg viewBox="0 0 24 24" aria-hidden><path d="M4 17.5 3 6.8l5 3.6L12 4l4 6.4 5-3.6-1 10.7z" /><path d="M4.2 19.6h15.6" /></svg>
    </span>}
    <Flag code={profile.country} />
    <span className="server-copy">
      <strong>{localizedServerName(profile)}</strong>
      <small>{blocked ? t(blocked) : stackOf(profile)}</small>
    </span>
    {live ? <em className="server-on">{t('ВКЛ')}</em> : <Signal ms={profile.pingMs} />}
    <span className="server-go">›</span>
  </button>;
});

function profileLocation(profile: VpnProfile | null): { country: string; detail: string } {
  if (!profile) return { country: t('Сервер не выбран'), detail: t('Выберите сервер слева') };
  const shownName = displayName(profile).trim();
  const knownCountry = profile.countryName?.trim();
  // Сравнение идёт с русским оригиналом: countryName приходит из main-процесса
  // (vpn-classify), где страна-заглушка всегда называется «Другие» независимо
  // от языка интерфейса. С переведённой строкой сравнение перестало бы
  // срабатывать в английском режиме, и в названии сервера выводилось бы «Other».
  const country = knownCountry && knownCountry !== 'Другие' ? t(knownCountry) : shownName;
  const city = profile.city?.trim();
  if (city) return { country, detail: `${country} · ${city}` };
  const parts = shownName.split(/\s*[·•|]\s*/).filter(Boolean);
  if (parts.length > 1 && parts[0].toLocaleLowerCase('ru-RU') === country.toLocaleLowerCase('ru-RU')) {
    return { country, detail: `${country} · ${parts.slice(1).join(' · ')}` };
  }
  return { country, detail: country };
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
  const [settingsTab, setSettingsTab] = useState<'general' | 'dns' | 'applications' | 'routing'>('general');
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false);
  /** Открытый выбор приложений и режим, который к ним применится. */
  const [pickerRouting, setPickerRouting] = useState<VpnAppRoutingMode | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  // «Проверить сеть»: прокси, адаптеры туннелей и маршруты уходят в журнал
  // NEXUS одной кнопкой. По отчёту видно, кто перехватывает трафик, когда
  // правило в ядре работает, а браузер показывает чужой IP.
  const runNetworkReport = async () => {
    if (!desktop || !window.nexus?.netDiagnose) {
      onToast(t('Проверка сети доступна в установленной программе'));
      return;
    }
    try {
      await window.nexus.netDiagnose();
      onToast(t('Отчёт сети записан в журнал'));
    } catch {
      onToast(t('Не удалось собрать отчёт сети'));
    }
  };
  const [profiles, setProfiles] = useState<VpnProfile[]>([]);
  const [runtime, setRuntime] = useState<VpnRuntime>(EMPTY_RUNTIME);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<'refresh' | 'ping' | null>(null);
  const [subscriptionAction, setSubscriptionAction] = useState<SubscriptionAction | null>(null);
  const [tab, setTab] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(settings.lastVpnProfileId);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [latencyUnavailable, setLatencyUnavailable] = useState(false);
  const [modeSwitching, setModeSwitching] = useState<'proxy' | 'tun' | null>(null);
  const [sessionNow, setSessionNow] = useState(Date.now());
  // Свой адрес DNS редактируется черновиком: сохранять на каждое нажатие
  // клавиши нельзя — недописанный адрес оборвал бы разрешение имён.
  const [dnsDraft, setDnsDraft] = useState(settings.vpnDnsCustom ?? '');
  const [ruleDraft, setRuleDraft] = useState('');
  const [ruleOutbound, setRuleOutbound] = useState<'proxy' | 'direct' | 'block'>('direct');
  const [dnsCheck, setDnsCheck] = useState<{ ok: boolean; latencyMs: number | null; error?: string } | null>(null);
  const [dnsBusy, setDnsBusy] = useState<'check' | 'measure' | null>(null);
  const [dnsRanking, setDnsRanking] = useState<{ providerId: string; title: string; latencyMs: number | null; ok: boolean }[]>([]);
  const subscriptionImportInFlight = useRef(false);
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

  /** Проверка выбранного справочника: настоящий запрос, а не просто «порт открыт». */
  const runDnsCheck = async () => {
    if (dnsBusy) return;
    setDnsBusy('check');
    setDnsCheck(null);
    try {
      const result = await window.nexus?.checkCurrentDns();
      if (!result) {
        onToast(t('Выбран справочник Windows — проверять нечего'));
        return;
      }
      setDnsCheck(result);
      onToast(result.ok
        ? `${t('Справочник отвечает')} · ${result.latencyMs ?? '—'} ${t('мс')}`
        : `${t('Справочник не отвечает')}: ${result.error ?? ''}`);
    } catch {
      onToast(t('Не удалось проверить справочник'));
    } finally {
      setDnsBusy(null);
    }
  };

  /**
   * Подбор самого быстрого справочника.
   *
   * Скорость зависит от сети и провайдера: в одной быстрее Cloudflare, в другой
   * Google. Угадать заранее нельзя — поэтому измеряем на месте.
   */
  const runDnsMeasure = async () => {
    if (dnsBusy) return;
    setDnsBusy('measure');
    setDnsRanking([]);
    try {
      const results = await window.nexus?.measureDnsProviders();
      if (!results?.length) {
        onToast(t('Не удалось измерить справочники'));
        return;
      }
      setDnsRanking(results);
      const best = results.find((item) => item.ok);
      onToast(best
        ? `${t('Самый быстрый')}: ${t(best.title)} · ${best.latencyMs ?? '—'} ${t('мс')}`
        : t('Ни один справочник не ответил'));
    } catch {
      onToast(t('Не удалось измерить справочники'));
    } finally {
      setDnsBusy(null);
    }
  };

  const exportRules = async () => {
    try {
      const result = await window.nexus?.exportRoutingRules();
      if (result?.saved) onToast(t('Набор правил сохранён'));
    } catch {
      onToast(t('Не удалось сохранить набор'));
    }
  };

  const importRules = async () => {
    try {
      const result = await window.nexus?.importRoutingRules();
      if (!result) return;
      if (result.error) {
        onToast(result.error);
        return;
      }
      if (!result.added) {
        onToast(t('Новых правил в файле нет'));
        return;
      }
      const skipped = result.skipped ? ` · ${t('пропущено')} ${result.skipped}` : '';
      onToast(`${t('Добавлено правил')}: ${result.added}${skipped}`);
    } catch {
      onToast(t('Не удалось загрузить набор'));
    }
  };

  const routingRules = settings.vpnRoutingRules ?? [];

  const updateRoutingRules = (next: typeof routingRules) => {
    onSettings({ ...settings, vpnRoutingRules: next });
  };

  const addRoutingRule = (presetValue?: string) => {
    const value = (presetValue ?? ruleDraft).trim();
    if (!value) return;
    // Проверяем до сохранения: неверная строка не даёт ядру запуститься, и VPN
    // перестаёт подключаться — с виду без причины.
    if (!isValidRoutingValue(value)) {
      onToast(t('Неверный адрес. Пример: example.com, *.example.com или 10.0.0.0/8'));
      return;
    }
    if (routingRules.some((rule) => rule.value.toLowerCase() === value.toLowerCase())) {
      onToast(t('Такое правило уже есть'));
      return;
    }
    if (routingRules.length >= MAX_ROUTING_RULES) {
      onToast(t('Достигнут предел числа правил'));
      return;
    }
    // Готовые наборы почти всегда нужны для прямого доступа, кроме рекламы —
    // её логичнее блокировать. Это лишь начальное значение, его видно и можно
    // сменить прямо в списке.
    const outbound = presetValue
      ? (presetValue.includes('ads') ? 'block' as const : 'direct' as const)
      : ruleOutbound;
    updateRoutingRules([...routingRules, { id: `rule-${Date.now().toString(36)}`, value, outbound, enabled: true }]);
    if (!presetValue) setRuleDraft('');
    onToast(`${t('Правило добавлено')}${runtime.status === 'connected' ? t(' · подключение перезапускается') : ''}`);
  };

  const moveRoutingRule = (index: number, shift: number) => {
    const target = index + shift;
    if (target < 0 || target >= routingRules.length) return;
    const next = [...routingRules];
    [next[index], next[target]] = [next[target], next[index]];
    updateRoutingRules(next);
  };
  const lanEndpoints = runtime.lanEndpoints ?? [];

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
      // Подключение состоялось — значит выбран именно этот сервер. Без этой
      // строки кнопка оставалась оранжевой («работает другой сервер») после
      // переключения страны на живом VPN: список профилей мог пересобраться,
      // и прежний выбор переставал совпадать с активным.
      if (snapshot.runtime.status === 'connected' && snapshot.runtime.activeProfileId) {
        setSelectedId(snapshot.runtime.activeProfileId);
      }
    });
  }, [onToast]);

  useEffect(() => {
    if (!desktop || runtime.xrayReady) return;
    void window.nexus?.ensureVpnCore().then(() => window.nexus?.getVpn()).then((snapshot) => {
      if (snapshot) setRuntime(snapshot.runtime);
    }).catch((error: Error) => onToast(cleanError(error)));
  }, [desktop, runtime.xrayReady, onToast]);

  useEffect(() => {
    setSessionNow(Date.now());
    if (runtime.status !== 'connected' || !runtime.connectedAt) return;
    const timer = window.setInterval(() => setSessionNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runtime.status, runtime.connectedAt]);

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
  const activeProfile = nodes.find((item) => item.id === runtime.activeProfileId) ?? null;
  const onAir = runtime.status === 'connected' && runtime.activeProfileId === selected?.id;
  const otherLive = runtime.status === 'connected' && runtime.activeProfileId !== selected?.id;
  const panelProfile = runtime.status === 'connected' ? (activeProfile || selected) : selected;
  const panelLocation = profileLocation(panelProfile);
  const displayedMode = modeSwitching ?? mode;
  const sessionDuration = formatSessionDuration(runtime.connectedAt, sessionNow);
  const used = (info?.upload ?? 0) + (info?.download ?? 0);
  const quota = info?.total ? formatBytes(info.total) : '∞';
  const title = tab === 'all' ? t('Все серверы') : tab === 'manual' ? t('Ручные профили') : telegramOf(info) || t('Подписка');

  const importLink = async () => {
    if (subscriptionImportInFlight.current) return;
    subscriptionImportInFlight.current = true;
    try {
      setBusy(true);
      if (!desktop) {
        onToast(t('Импорт ссылок работает в окне Electron (npm start)'));
        return;
      }
      const imported = await window.nexus?.importVpn(link, name || undefined);
      if (imported?.length) {
        setLink('');
        setImportOpen(false);
        if (imported[0].subscriptionUrl) setTab(imported[0].subscriptionUrl);
        setSelectedId(imported[0].id);
        onToast(`${t('Подписка: серверов')} ${imported.length}`);
      }
    } catch (error) {
      onToast(cleanError(error) || t('Не удалось импортировать ссылку'));
    } finally {
      subscriptionImportInFlight.current = false;
      setBusy(false);
    }
  };

  /** Сохраняет выбранные программы, не теряя уже добавленные. */
  const mergeSplitApps = (picked: VpnSplitApp[], activate: VpnAppRoutingMode) => {
    if (!picked.length) return;
    const merged = new Map(splitApps.map((app) => [app.executable.toLocaleLowerCase('en-US'), app]));
    for (const app of picked) merged.set(app.executable.toLocaleLowerCase('en-US'), app);
    onSettings({
      ...settings,
      vpnMode: activate === 'system' ? mode : 'tun',
      vpnAppRouting: activate,
      vpnSplitTunnel: activate === 'include',
      vpnSplitApps: [...merged.values()],
    });
  };

  /** Выбор файлом через проводник — для программ, которые сейчас закрыты. */
  const browseForApps = async (activate: VpnAppRoutingMode = appRouting) => {
    if (!desktop) {
      onToast(t('Выбор .exe работает в окне Electron (npm start)'));
      return;
    }
    try {
      const picked = await window.nexus?.pickVpnApps();
      if (!picked?.length) return;
      setPickerRouting(null);
      mergeSplitApps(picked, activate);
    } catch (error) {
      onToast(cleanError(error) || t('Не удалось выбрать приложение'));
    }
  };

  const addSplitApps = (activate: VpnAppRoutingMode = appRouting) => {
    if (routeSettingsLocked) {
      onToast(t('Сначала отключите VPN, затем измените список приложений'));
      return;
    }
    if (!desktop) {
      onToast(t('Выбор .exe работает в окне Electron (npm start)'));
      return;
    }
    // Сначала предлагается список открытых программ: так нужное находится
    // взглядом, без поиска файла по папкам.
    setPickerRouting(activate);
  };

  const selectAppRouting = (next: VpnAppRoutingMode) => {
    if (routeSettingsLocked) {
      onToast(t('Сначала отключите VPN, затем измените маршрутизацию приложений'));
      return;
    }
    if (next !== 'system' && !splitApps.length) {
      addSplitApps(next);
      return;
    }
    onSettings({
      ...settings,
      vpnMode: next === 'system' ? mode : 'tun',
      vpnAppRouting: next,
      vpnSplitTunnel: next === 'include',
    });
  };

  const removeSplitApp = (executable: string) => {
    if (routeSettingsLocked) {
      onToast(t('Сначала отключите VPN, затем измените список приложений'));
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

  const selectConnectionMode = async (next: 'proxy' | 'tun') => {
    if (next === mode || modeSwitching) return;
    if (runtime.status === 'connecting' || busy) {
      onToast(t('Дождитесь завершения текущего подключения'));
      return;
    }
    const nextSettings = {
      ...settings,
      vpnMode: next,
      vpnAppRouting: storedAppRouting,
      vpnSplitTunnel: next === 'tun' && storedAppRouting === 'include',
    };
    if (!desktop || runtime.status !== 'connected') {
      onSettings(nextSettings);
      return;
    }

    try {
      setBusy(true);
      setModeSwitching(next);
      await window.nexus?.switchVpnMode(next);
      onSettings(nextSettings);
      onToast(`${t('Режим')} ${next.toUpperCase()} ${t('включён · VPN переподключён')}`);
    } catch (error) {
      const persisted = await window.nexus?.getSettings().catch(() => null);
      if (persisted) onSettings(persisted);
      onToast(cleanError(error) || t('Не удалось переключить режим VPN'));
    } finally {
      setModeSwitching(null);
      setBusy(false);
    }
  };

  const connect = async (id: string) => {
    const profile = nodes.find((item) => item.id === id);
    const blocked = profile ? canConnect(profile) : t('Сервер не найден');
    if (blocked) {
      // Причина приходит из vpn-classify по-русски: там текст служит ключом.
      onToast(t(blocked));
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
      onToast(cleanError(error) || t('Не удалось подключиться'));
    } finally {
      setBusy(false);
    }
  };

  /*
    Обработчики строк держим неизменными между перерисовками.

    memo сравнивает свойства по ссылке: если передавать стрелки, созданные
    прямо в разметке, каждая перерисовка страницы давала бы новые функции, и
    все строки обновлялись бы despite memo — смысл оптимизации пропал бы.
    Ссылку на актуальный connect храним в ref, поэтому сами обработчики
    создаются один раз, но всегда вызывают свежую версию.
  */
  const connectRef = useRef(connect);
  connectRef.current = connect;

  const selectServer = useCallback((id: string) => setSelectedId(id), []);
  const launchServer = useCallback((profile: VpnProfile, blocked: string | null) => {
    if (blocked) onToast(t(blocked));
    else void connectRef.current(profile.id);
  }, [onToast]);

  const disconnect = async () => {
    try {
      setBusy(true);
      if (desktop) await window.nexus?.disconnectVpn();
      else setRuntime({ ...runtime, status: 'disconnected', activeProfileId: null, pid: null });
    } catch (error) {
      onToast(cleanError(error) || t('Не удалось отключить VPN'));
    } finally {
      setBusy(false);
    }
  };

  const togglePower = async () => {
    if (!selected) {
      onToast(t('Сначала выберите сервер слева'));
      return;
    }
    if (onAir) await disconnect();
    else await connect(selected.id);
  };

  /*
    «Подключиться к лучшему»: человек не выбирает сервер руками — кнопка сама
    измеряет пинг (если ещё не мерили) и подключает самый быстрый из доступных.
    Пока идёт замер, крутится стрелка на кнопке «Обновить» сверху — тот же
    индикатор, что у обычного замера пинга.
  */
  const quickConnect = async () => {
    if (busy) return;
    if (runtime.status === 'connected' && runtime.activeProfileId === fastest?.id) {
      onToast(t('Уже подключены к самому быстрому серверу'));
      return;
    }
    // Пинги измерялись не всегда: без свежего замера «самый быстрый» был бы
    // просто первым в списке. Поэтому сперва замеряем, затем выбираем.
    const unmeasured = visible.some((item) => !canConnect(item) && item.pingMs == null);
    let fresh = visible;
    if (unmeasured && desktop) {
      setAction('ping');
      const started = Date.now();
      try {
        const next = await window.nexus?.pingVpn();
        if (next) {
          setProfiles(next);
          fresh = next.filter((item) => item.kind !== 'notice');
        }
      } catch (error) {
        onToast(cleanError(error) || t('Не удалось измерить пинг'));
        return;
      } finally {
        const wait = 2200 - (Date.now() - started);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        setAction(null);
      }
    }
    const target = pickFastest(fresh);
    if (!target) {
      onToast(t('Нет доступных серверов'));
      return;
    }
    setSelectedId(target.id);
    await connect(target.id);
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
      onToast(count ? `${t('Обновлено')} · ${count}` : t('Нет подписок'));
    } catch (error) {
      onToast(cleanError(error));
    }
  }, 1100);

  const addManagedSubscription = async (url: string): Promise<boolean> => {
    if (subscriptionImportInFlight.current) return false;
    subscriptionImportInFlight.current = true;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        onToast(t('Подписка должна использовать только HTTPS'));
        return false;
      }
      if (!desktop) {
        onToast(t('Добавление подписок работает в окне Electron (npm start)'));
        return false;
      }
      setSubscriptionAction({ kind: 'add', url });
      const imported = await window.nexus?.importVpn(url);
      if (!imported?.length) return false;
      const subscriptionUrl = imported[0].subscriptionUrl || url;
      setTab(subscriptionUrl);
      setSelectedId(imported[0].id);
      onToast(`${t('Подписка добавлена · серверов')} ${imported.length}`);
      return true;
    } catch (error) {
      onToast(cleanError(error) || t('Не удалось добавить подписку'));
      return false;
    } finally {
      subscriptionImportInFlight.current = false;
      setSubscriptionAction(null);
    }
  };

  const refreshManagedSubscription = async (url: string): Promise<void> => {
    try {
      setSubscriptionAction({ kind: 'refresh', url });
      const count = await window.nexus?.refreshVpn(url);
      onToast(`${t('Подписка обновлена · серверов')} ${count ?? 0}`);
    } catch (error) {
      onToast(cleanError(error) || t('Не удалось обновить подписку'));
    } finally {
      setSubscriptionAction(null);
    }
  };

  const refreshManagedSubscriptions = async (): Promise<void> => {
    try {
      setSubscriptionAction({ kind: 'refresh-all' });
      const count = await window.nexus?.refreshVpn();
      onToast(count ? `${t('Все подписки обновлены · серверов')} ${count}` : t('Нет подписок'));
    } catch (error) {
      onToast(cleanError(error) || t('Не удалось обновить подписки'));
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
      onToast(t('Подписка и её серверы удалены'));
      return true;
    } catch (error) {
      onToast(cleanError(error) || t('Не удалось удалить подписку'));
      return false;
    } finally {
      setSubscriptionAction(null);
    }
  };

  const ping = () => holdAction('ping', async () => {
    try {
      const next = await window.nexus?.pingVpn();
      if (next) setProfiles(next);
      onToast(t('Пинг измерен'));
    } catch (error) {
      onToast(cleanError(error));
    }
  }, 2200);

  useEffect(() => {
    if (runtime.activeProfileId) return;
    if (fastest?.id) setSelectedId(fastest.id);
  }, [fastest?.id, runtime.activeProfileId]);

  useEffect(() => {
    setLatencyMs(null);
    setLatencyUnavailable(false);
    if (!desktop || runtime.status !== 'connected' || !runtime.activeProfileId || settingsOpen || subscriptionsOpen || diagnosticsOpen) return;
    let cancelled = false;
    let pending = false;
    const sample = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await window.nexus?.sampleVpnLatency();
        if (cancelled) return;
        if (next && Number.isFinite(next.pingMs) && next.pingMs > 0) {
          setLatencyMs(Math.round(next.pingMs));
          setLatencyUnavailable(false);
        } else {
          setLatencyUnavailable(true);
        }
      } catch {
        if (!cancelled) setLatencyUnavailable(true);
      } finally {
        pending = false;
      }
    };
    void sample();
    const timer = window.setInterval(() => void sample(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [desktop, runtime.status, runtime.activeProfileId, settingsOpen, subscriptionsOpen, diagnosticsOpen]);

  const powerState = runtime.status === 'connecting'
    ? t('Подключаем…')
    : runtime.status === 'error'
      ? (runtime.error || t('Ошибка подключения'))
      : t('Выключено');

  if (settingsOpen) return <section className="page-section jey-page app-settings-page">
    <div className="app-settings-toolbar">
      <button type="button" className="app-settings-back" onClick={() => setSettingsOpen(false)} aria-label={t('Вернуться к серверам')}>
        <svg viewBox="0 0 20 20" aria-hidden><path d="m12.5 4.5-5 5.5 5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {t('Серверы')}
      </button>
      <div>
        <span>Jey2Ray</span>
        <h2>{t('Настройки Jey2Ray')}</h2>
      </div>
      <span className={`app-route-state ${settingsTab === 'applications' && appRoutingActive ? 'is-on' : ''} ${settingsTab === 'dns' && settings.vpnDnsProvider !== 'system' ? 'is-on' : ''}`}>
        <i />{settingsTab === 'applications'
          ? (appRoutingActive ? t('Маршрутизация включена') : t('Системная маршрутизация'))
          : settingsTab === 'dns'
            ? (settings.vpnDnsProvider === 'system' ? t('Справочник Windows') : t('Свой справочник'))
            : settingsTab === 'routing'
              ? t('Правила маршрутизации')
              : t('Общие параметры')}
      </span>
    </div>

    <div className="app-settings-tabs" role="tablist" aria-label={t('Разделы настроек Jey2Ray')}>
      <button
        type="button"
        id="jey-settings-general-tab"
        role="tab"
        aria-controls="jey-settings-panel"
        aria-selected={settingsTab === 'general'}
        className={`app-settings-tab ${settingsTab === 'general' ? 'is-active' : ''}`}
        onClick={() => setSettingsTab('general')}
      >
        <span className="app-settings-tab-icon">
          <svg viewBox="0 0 20 20" aria-hidden><path d="M4 5h12M6.5 10h7M8 15h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="8" cy="5" r="1.5" /><circle cx="11.5" cy="10" r="1.5" /><circle cx="10" cy="15" r="1.5" /></svg>
        </span>
        <span><strong>{t('Общие')}</strong><small>{t('Автоподключение и параметры модуля')}</small></span>
      </button>
      <button
        type="button"
        id="jey-settings-dns-tab"
        role="tab"
        aria-controls="jey-settings-panel"
        aria-selected={settingsTab === 'dns'}
        className={`app-settings-tab ${settingsTab === 'dns' ? 'is-active' : ''}`}
        onClick={() => setSettingsTab('dns')}
      >
        <span className="app-settings-tab-icon dns">
          <svg viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.45" /><path d="M3 10h14M10 3a11 11 0 0 1 0 14M10 3a11 11 0 0 0 0 14" fill="none" stroke="currentColor" strokeWidth="1.45" /></svg>
        </span>
        <span><strong>{t('Справочник имён')}</strong><small>{t('DNS-сервер для определения адресов')}</small></span>
      </button>
      <button
        type="button"
        id="jey-settings-applications-tab"
        role="tab"
        aria-controls="jey-settings-panel"
        aria-selected={settingsTab === 'applications'}
        className={`app-settings-tab ${settingsTab === 'applications' ? 'is-active' : ''}`}
        onClick={() => setSettingsTab('applications')}
      >
        <span className="app-settings-tab-icon applications">
          <svg viewBox="0 0 20 20" aria-hidden><rect x="3" y="3.5" width="14" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.45" /><path d="M3.5 7.5h13M7 11h6M8.5 14h3" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" /></svg>
        </span>
        <span><strong>{t('Настройка приложений')}</strong><small>{t('Маршрутизация и выбранные программы')}</small></span>
      </button>
      <button
        type="button"
        id="jey-settings-routing-tab"
        role="tab"
        aria-controls="jey-settings-panel"
        aria-selected={settingsTab === 'routing'}
        className={`app-settings-tab ${settingsTab === 'routing' ? 'is-active' : ''}`}
        onClick={() => setSettingsTab('routing')}
      >
        <span className="app-settings-tab-icon routing">
          <svg viewBox="0 0 20 20" aria-hidden><path d="M4 4v5a3 3 0 0 0 3 3h9M4 16h4" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /><path d="m13.5 9 2.5 3-2.5 3" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /><circle cx="4" cy="4" r="1.6" /><circle cx="8" cy="16" r="1.6" /></svg>
        </span>
        <span><strong>{t('Маршрутизация')}</strong><small>{t('Правила: домен → прямо или через VPN')}</small></span>
      </button>
    </div>

    <div
      id="jey-settings-panel"
      role="tabpanel"
      aria-labelledby={`jey-settings-${settingsTab}-tab`}
      className={`app-settings-scroll is-${settingsTab}`}
    >
      {settingsTab === 'general' ? <>
        <section className="app-settings-card auto-settings-card">
          <div className="app-settings-card-head compact">
            <div><span className="settings-step">01</span><div><h3>{t('Автоподключение')}</h3><p>{t('Запускать последний сервер вместе с NEXUS.')}</p></div></div>
            <button
              type="button"
              className={`settings-toggle ${settings.autoConnectVpn ? 'is-on' : ''}`}
              onClick={() => onSettings({ ...settings, autoConnectVpn: !settings.autoConnectVpn })}
              aria-label={settings.autoConnectVpn ? t('Выключить автоподключение') : t('Включить автоподключение')}
            ><i /></button>
          </div>
          <div className={`auto-status ${settings.autoConnectVpn ? 'is-on' : ''}`}><i />{settings.autoConnectVpn ? t('Включено') : t('Выключено')}</div>
        </section>

        <section className="app-settings-card fragmentation-settings-card">
          <div className="app-settings-card-head compact">
            <div><span className="settings-step">02</span><div><h3>{t('Включить фрагментацию')}</h3><p>{t('Разделять TLS ClientHello на небольшие фрагменты, чтобы повысить устойчивость соединения при DPI-фильтрации.')}</p></div></div>
            <button
              type="button"
              className={`settings-toggle ${settings.vpnFragmentation ? 'is-on' : ''}`}
              onClick={() => {
                const enabled = !settings.vpnFragmentation;
                onSettings({ ...settings, vpnFragmentation: enabled });
                onToast(`${enabled ? t('Фрагментация включена') : t('Фрагментация выключена')}${runtime.status === 'connected' ? t(' · применится при следующем подключении') : ''}`);
              }}
              aria-label={settings.vpnFragmentation ? t('Выключить фрагментацию') : t('Включить фрагментацию')}
              aria-pressed={settings.vpnFragmentation}
            ><i /></button>
          </div>
          <div className={`auto-status ${settings.vpnFragmentation ? 'is-on' : ''}`}><i />{settings.vpnFragmentation ? t('Включено по умолчанию') : t('Выключено')}</div>
          <p className="fragmentation-note">{t('Работает для Xray-профилей с TCP/TLS, включая Reality. Hysteria2 использует QUIC и не поддерживает TCP-фрагментацию ClientHello.')}</p>
        </section>

        <section className="app-settings-card lan-share-card">
          <div className="app-settings-card-head compact">
            <div><span className="settings-step">03</span><div><h3>{t('Раздача в локальную сеть')}</h3><p>{t('Открыть локальный SOCKS/HTTP для других устройств домашней сети: ТВ, консоли, телефона.')}</p></div></div>
            <button
              type="button"
              className={`settings-toggle ${settings.vpnAllowLan ? 'is-on' : ''}`}
              onClick={() => {
                const enabled = !settings.vpnAllowLan;
                onSettings({ ...settings, vpnAllowLan: enabled });
                onToast(enabled
                  ? `${t('Раздача включена')}${runtime.status === 'connected' ? t(' · подключение перезапускается') : ''}`
                  : t('Раздача в локальную сеть выключена'));
              }}
              aria-label={settings.vpnAllowLan ? t('Выключить раздачу в локальную сеть') : t('Включить раздачу в локальную сеть')}
              aria-pressed={settings.vpnAllowLan}
            ><i /></button>
          </div>
          <div className={`auto-status ${settings.vpnAllowLan ? 'is-on' : ''}`}><i />{settings.vpnAllowLan ? t('Включено') : t('Выключено')}</div>
          {settings.vpnAllowLan && (lanEndpoints.length ? <div className="lan-endpoint-list">
            {lanEndpoints.map((endpoint) => <div className="lan-endpoint-row" key={endpoint.address}>
              <span className="lan-endpoint-name">{endpoint.interfaceName}</span>
              <span className="lan-endpoint-values"><b>SOCKS</b> {endpoint.socks}<em>·</em><b>HTTP</b> {endpoint.http}</span>
            </div>)}
          </div> : <p className="fragmentation-note">
            {runtime.status === 'connected'
              ? t('Приватный IPv4-адрес не найден — проверьте подключение к домашней сети.')
              : t('Адреса появятся здесь после подключения VPN.')}
          </p>)}
          <p className="fragmentation-note">{t('Включайте только в доверенной сети: прокси станет доступен всем устройствам этого сегмента без пароля. Может потребоваться разрешение в брандмауэре Windows.')}</p>
        </section>
      </> : settingsTab === 'dns' ? <>
        <section className="app-settings-card dns-settings-card">
          <div className="app-settings-card-head compact">
            <div><span className="settings-step">01</span><div><h3>{t('Справочник имён (DNS)')}</h3><p>{t('Через него определяются адреса сайтов. Свой справочник скрывает от провайдера список посещённых сайтов и обходит блокировки на этом уровне.')}</p></div></div>
          </div>
          <div className="dns-provider-list" role="radiogroup" aria-label={t('Справочник имён (DNS)')}>
            {DNS_PROVIDERS.map((provider) => <button
              key={provider.id}
              type="button"
              role="radio"
              aria-checked={settings.vpnDnsProvider === provider.id}
              className={`dns-provider-option ${settings.vpnDnsProvider === provider.id ? 'is-active' : ''}`}
              onClick={() => {
                onSettings({ ...settings, vpnDnsProvider: provider.id });
                if (provider.id !== 'custom') {
                  onToast(`${t('Справочник имён:')} ${t(provider.title)}${runtime.status === 'connected' ? t(' · подключение перезапускается') : ''}`);
                }
              }}
            >
              <span className="dns-provider-mark"><i /></span>
              <span className="dns-provider-copy">
                <strong>{t(provider.title)}</strong>
                <small>{t(provider.description)}</small>
              </span>
            </button>)}
          </div>
          {settings.vpnDnsProvider === 'custom' && <div className="dns-custom-row">
            <input
              value={dnsDraft}
              onChange={(event) => setDnsDraft(event.target.value)}
              placeholder="1.1.1.1"
              aria-label={t('Адрес DNS-сервера')}
              spellCheck={false}
            />
            <button
              type="button"
              className="ghost-action"
              disabled={!dnsDraft.trim() || dnsDraft.trim() === settings.vpnDnsCustom}
              onClick={() => {
                const value = dnsDraft.trim();
                // Неверный адрес молча сломал бы разрешение имён: интернет
                // «пропал» бы без объяснения причины. Проверяем до сохранения.
                if (!isValidDnsAddress(value)) {
                  onToast(t('Неверный адрес. Пример: 1.1.1.1 или https://dns.example.com/dns-query'));
                  return;
                }
                onSettings({ ...settings, vpnDnsCustom: value });
                onToast(`${t('Справочник имён:')} ${value}${runtime.status === 'connected' ? t(' · подключение перезапускается') : ''}`);
              }}
            >{t('Применить')}</button>
          </div>}
          <div className="dns-tools">
            <button type="button" className="ghost-action" disabled={dnsBusy !== null} onClick={() => void runDnsCheck()}>
              {dnsBusy === 'check' ? t('Проверяем…') : t('Проверить DNS')}
            </button>
            <button type="button" className="ghost-action" disabled={dnsBusy !== null} onClick={() => void runDnsMeasure()}>
              {dnsBusy === 'measure' ? t('Измеряем…') : t('Найти самый быстрый')}
            </button>
            {dnsCheck && <span className={`dns-check-result ${dnsCheck.ok ? 'is-ok' : 'is-bad'}`}>
              <i />{dnsCheck.ok ? `${dnsCheck.latencyMs ?? '—'} ${t('мс')}` : (dnsCheck.error ?? t('Нет ответа'))}
            </span>}
          </div>

          {/* Замеры показываются списком: человеку важно не только «какой
              быстрее», но и насколько — разница в 5 мс не повод менять. */}
          {dnsRanking.length > 0 && <ul className="dns-ranking">
            {dnsRanking.map((item, index) => <li key={item.providerId} className={item.ok ? '' : 'is-bad'}>
              <span className="dns-ranking-place">{index + 1}</span>
              <span className="dns-ranking-name">{t(item.title)}</span>
              <span className="dns-ranking-time">{item.ok ? `${item.latencyMs} ${t('мс')}` : t('нет ответа')}</span>
              {item.ok && settings.vpnDnsProvider !== item.providerId && <button
                type="button"
                className="dns-ranking-apply"
                onClick={() => {
                  onSettings({ ...settings, vpnDnsProvider: item.providerId });
                  onToast(`${t('Справочник имён:')} ${t(item.title)}${runtime.status === 'connected' ? t(' · подключение перезапускается') : ''}`);
                }}
              >{t('Выбрать')}</button>}
              {settings.vpnDnsProvider === item.providerId && <span className="dns-ranking-current">{t('выбран')}</span>}
            </li>)}
          </ul>}

          <p className="fragmentation-note">{t('Подходит обычный адрес вроде 1.1.1.1 или защищённый https://…/dns-query. Изменение применяется сразу: активное подключение перезапустится.')}</p>
        </section>
      </> : settingsTab === 'routing' ? <>
        {/* Вкладка-заготовка. Показываем честно, что раздел готовится:
            пустая вкладка без объяснений выглядит как поломка. */}
        <section className="app-settings-card">
          <div className="app-settings-card-head compact">
            <div><span className="settings-step">01</span><div><h3>{t('Правила маршрутизации')}</h3><p>{t('Одни сайты идут напрямую, другие через VPN, третьи не открываются вовсе. Работает только для VPN.')}</p></div></div>
          </div>

          <div className="routing-add-row">
            <input
              value={ruleDraft}
              onChange={(event) => setRuleDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') addRoutingRule(); }}
              placeholder={t('example.com, *.example.com или 10.0.0.0/8')}
              aria-label={t('Домен или адрес')}
              spellCheck={false}
            />
            <div className="routing-outbound-picker" role="radiogroup" aria-label={t('Куда направить')}>
              {(['proxy', 'direct', 'block'] as const).map((value) => <button
                key={value}
                type="button"
                role="radio"
                aria-checked={ruleOutbound === value}
                className={`routing-outbound-chip is-${value} ${ruleOutbound === value ? 'is-active' : ''}`}
                onClick={() => setRuleOutbound(value)}
              >{value === 'proxy' ? t('Через VPN') : value === 'direct' ? t('Напрямую') : t('Блокировать')}</button>)}
            </div>
            <button type="button" className="ghost-action" disabled={!ruleDraft.trim()} onClick={addRoutingRule}>{t('Добавить')}</button>
          </div>

          {/* Готовые наборы: перечислять тысячи адресов вручную бессмысленно,
              их списки уже собраны внутри ядра. */}
          <div className="routing-presets">
            <span className="routing-presets-label">{t('Готовые наборы')}</span>
            <div className="routing-presets-list">
              {ROUTING_PRESETS.map((preset) => <button
                key={preset.value}
                type="button"
                className="routing-preset-chip"
                disabled={routingRules.some((rule) => rule.value === preset.value)}
                title={t(preset.description)}
                onClick={() => addRoutingRule(preset.value)}
              >{t(preset.title)}</button>)}
            </div>
          </div>

          {routingRules.length ? <ul className="routing-rule-list">
            {routingRules.map((rule, index) => <li key={rule.id} className={`routing-rule ${rule.enabled ? '' : 'is-off'}`}>
              {/* Номер показывает приоритет: срабатывает первое совпавшее правило. */}
              <span className="routing-rule-order">{index + 1}</span>
              <span className="routing-rule-value" title={rule.value}>{rule.value}</span>
              <span className={`routing-rule-outbound is-${rule.outbound}`}>
                {rule.outbound === 'proxy' ? t('Через VPN') : rule.outbound === 'direct' ? t('Напрямую') : t('Блокировать')}
              </span>
              <button
                type="button"
                className="routing-rule-move"
                disabled={index === 0}
                aria-label={t('Поднять правило выше')}
                onClick={() => moveRoutingRule(index, -1)}
              ><svg viewBox="0 0 24 24" aria-hidden><path d="m6 14 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
              <button
                type="button"
                className={`settings-toggle small ${rule.enabled ? 'is-on' : ''}`}
                aria-label={rule.enabled ? t('Выключить правило') : t('Включить правило')}
                onClick={() => updateRoutingRules(routingRules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item))}
              ><i /></button>
              <button
                type="button"
                className="routing-rule-remove"
                aria-label={`${t('Удалить')} ${rule.value}`}
                onClick={() => updateRoutingRules(routingRules.filter((item) => item.id !== rule.id))}
              ><svg viewBox="0 0 24 24" aria-hidden><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
            </li>)}
          </ul> : <div className="routing-empty-state">
            <span className="routing-empty-icon">
              <svg viewBox="0 0 24 24" aria-hidden><path d="M4 5v6a4 4 0 0 0 4 4h10M4 19h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="m15 11 3 4-3 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <strong>{t('Правил пока нет')}</strong>
            <p>{t('Весь трафик идёт через VPN. Добавьте правило или выберите готовый набор выше.')}</p>
          </div>}

          <div className="routing-transfer">
            <button type="button" className="ghost-action" onClick={() => void importRules()}>
              <svg className="ico" viewBox="0 0 20 20" aria-hidden><path d="M10 3v9m0 0-3.2-3.2M10 12l3.2-3.2M4 15.5h12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {t('Загрузить набор')}
            </button>
            <button type="button" className="ghost-action" disabled={!routingRules.length} onClick={() => void exportRules()}>
              <svg className="ico" viewBox="0 0 20 20" aria-hidden><path d="M10 13V4m0 0L6.8 7.2M10 4l3.2 3.2M4 15.5h12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {t('Сохранить набор')}
            </button>
            <span className="routing-transfer-hint">{t('Набором можно поделиться: обычный файл JSON.')}</span>
          </div>

          <p className="fragmentation-note">{t('Правила применяются сверху вниз: срабатывает первое подходящее. Изменения вступают в силу сразу — активное подключение перезапустится.')}</p>
        </section>
      </> : <>
        {routeSettingsLocked && <div className="app-settings-lock">
          <span>i</span>
          <div><strong>{t('VPN сейчас работает')}</strong><p>{t('Отключите подключение, чтобы изменить маршрутизацию или список приложений.')}</p></div>
        </div>}

        <section className="app-settings-card routing-settings-card">
          <div className="app-settings-card-head">
            <div><span className="settings-step">01</span><div><h3>{t('Настройки прокси для приложений')}</h3><p>{t('Выберите общую политику. Конкретные приложения можно добавить ниже.')}</p></div></div>
          </div>
          <div className="routing-choice-list" role="radiogroup" aria-label={t('Режим маршрутизации приложений')}>
            <button type="button" role="radio" aria-checked={appRouting === 'system'} className={`routing-choice ${appRouting === 'system' ? 'is-active' : ''}`} disabled={routeSettingsLocked} onClick={() => selectAppRouting('system')}>
              <i className="settings-radio" />
              <span><strong>{t('Системные настройки')}</strong><small>{t('Без отдельных правил. Используется общий режим')} {mode === 'tun' ? 'TUN' : 'Proxy'}.</small></span>
              <em>{t('По умолчанию')}</em>
            </button>
            <button type="button" role="radio" aria-checked={appRouting === 'exclude'} className={`routing-choice ${appRouting === 'exclude' ? 'is-active' : ''}`} disabled={routeSettingsLocked} onClick={() => selectAppRouting('exclude')}>
              <i className="settings-radio" />
              <span><strong>{t('Прямое подключение для выбранных приложений')}</strong><small>{t('Выбранные приложения обходят VPN, все остальные идут через VPN.')}</small></span>
              <em>{t('Исключения')}</em>
            </button>
            <button type="button" role="radio" aria-checked={appRouting === 'include'} className={`routing-choice ${appRouting === 'include' ? 'is-active' : ''}`} disabled={routeSettingsLocked} onClick={() => selectAppRouting('include')}>
              <i className="settings-radio" />
              <span><strong>{t('VPN только для выбранных приложений')}</strong><small>{t('Выбранные приложения идут через VPN, все остальные — напрямую.')}</small></span>
              <em>Split Tunneling</em>
            </button>
          </div>
        </section>

        <section className="app-settings-card selected-apps-card">
          <div className="app-settings-card-head selected-apps-head">
            <div><span className="settings-step">02</span><div><h3>{t('Выбранные приложения')}</h3><p>{splitApps.length ? `${t('Добавлено:')} ${splitApps.length}` : t('Добавьте приложения Windows, для которых будут действовать правила выше.')}</p></div></div>
            <button type="button" className="app-add-button" disabled={routeSettingsLocked} onClick={() => addSplitApps(appRouting)}>
              <svg viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              {t('Добавить приложение')}
            </button>
          </div>
          {splitApps.length ? <div className="selected-app-list">
            {splitApps.map((app) => <div className="selected-app-row" key={app.executable.toLocaleLowerCase('en-US')} title={app.path}>
              <span className="selected-app-icon"><svg viewBox="0 0 24 24" aria-hidden><rect x="4" y="3.5" width="16" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 8h8M8 12h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span>
              <span className="selected-app-copy"><strong>{app.executable}</strong><small>{app.path}</small></span>
              <span className={`selected-app-route ${appRouting === 'exclude' ? 'is-direct' : appRouting === 'include' ? 'is-vpn' : ''}`}>
                {appRouting === 'exclude' ? t('Напрямую') : appRouting === 'include' ? t('Через VPN') : t('Не активно')}
              </span>
              <button type="button" className="selected-app-remove" disabled={routeSettingsLocked} onClick={() => removeSplitApp(app.executable)} aria-label={`${t('Удалить')} ${app.executable}`}>×</button>
            </div>)}
          </div> : <div className="selected-app-empty">
            <span><svg viewBox="0 0 32 32" aria-hidden><rect x="7" y="5" width="18" height="22" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M12 12h8M12 17h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span>
            <strong>{t('Приложения ещё не выбраны')}</strong>
            <p>{t('Нажмите «Добавить приложение» и отметьте нужные программы из списка открытых.')}</p>
          </div>}
        </section>
      </>}
    </div>

    {pickerRouting && <AppPicker
      selected={splitApps}
      onClose={() => setPickerRouting(null)}
      onBrowse={() => void browseForApps(pickerRouting)}
      onConfirm={(picked) => {
        setPickerRouting(null);
        mergeSplitApps(picked, pickerRouting);
      }}
    />}
  </section>;

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

  if (diagnosticsOpen) return <ConnectionDiagnostics
    profileId={runtime.activeProfileId ?? selected?.id ?? null}
    onBack={() => setDiagnosticsOpen(false)}
    onToast={onToast}
  />;

  return <section className="page-section jey-page server-shell">
    <div className="server-left">
      <div className="jey-toolbar tight">
        <h2>{t('Серверы')}</h2>
        <div className="jey-toolbar-actions">
          <button type="button" className="ghost-action settings-gear-button" onClick={() => { setSettingsTab('general'); setSettingsOpen(true); }} title={t('Настройки Jey2Ray')} aria-label={t('Открыть настройки Jey2Ray')}>
            <svg className="ico" viewBox="0 0 20 20" aria-hidden>
              <path d="M7.9 2.7h4.2l.45 1.75c.4.17.78.39 1.13.65l1.72-.5 2.1 3.65-1.27 1.25c.03.2.04.42.04.64s-.01.43-.04.64l1.27 1.25-2.1 3.65-1.72-.5c-.35.26-.73.48-1.13.65l-.45 1.75H7.9l-.45-1.75a6.4 6.4 0 0 1-1.13-.65l-1.72.5-2.1-3.65 1.27-1.25a4.7 4.7 0 0 1 0-1.28L2.5 8.25 4.6 4.6l1.72.5c.35-.26.73-.48 1.13-.65L7.9 2.7Z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
              <circle cx="10" cy="10.15" r="2.35" fill="none" stroke="currentColor" strokeWidth="1.35" />
            </svg>
          </button>
          <button type="button" className="ghost-action subscription-manager-button" disabled={busy || Boolean(action)} onClick={() => setSubscriptionsOpen(true)} title={t('Управление подписками')}>
            <svg className="ico" viewBox="0 0 20 20" aria-hidden><path d="M4 5.25h12M4 10h12M4 14.75h12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="6" cy="5.25" r="1" fill="currentColor" /><circle cx="6" cy="10" r="1" fill="currentColor" /><circle cx="6" cy="14.75" r="1" fill="currentColor" /></svg>
            {t('Подписки')} <span>{runtime.subscriptions?.length ?? 0}</span>
          </button>
          <button className="ghost-action" onClick={() => setImportOpen((value) => !value)} title={t('Добавить подписку или отдельную ссылку')}>
            <svg className="ico" viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            {t('Добавить')}
          </button>
          <button className={`ghost-action ${action === 'refresh' ? 'is-spin' : ''}`} disabled={busy || Boolean(action)} onClick={() => void refresh()}>
            <svg className="ico spin-ico" viewBox="0 0 24 24" aria-hidden>
              <path fill="currentColor" d="M11.2 3.15A8.85 8.85 0 1 0 19 7.55l-1.95 1.15A6.55 6.55 0 1 1 11.2 5.45v2.7L17.45 5 11.2.65z" />
            </svg>
            {t('Обновить')}
          </button>
          <button className={`ghost-action ${action === 'ping' ? 'is-rev' : ''}`} disabled={busy || Boolean(action)} onClick={() => void ping()} title={t('Проверить задержку всех серверов')}>
            <svg className="ico gauge-ico" viewBox="0 0 20 14" aria-hidden>
              <path d="M2.3 11.6a7.7 7.7 0 0 1 15.4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path className="gauge-needle" d="M10 11.55 5.35 6.55" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
              <circle cx="10" cy="11.55" r="1.15" fill="currentColor" />
            </svg>
            {t('Пинг')}
          </button>
          {!runtime.xrayReady && <button className="ghost-action core-download-action" disabled={syncing} onClick={onSync}>{t('Скачать ядро')} {xrayUpdate?.latestVersion ?? ''}</button>}
        </div>
      </div>

      {importOpen && <div className="jey-import compact slide-in">
        <textarea className="jey-link" rows={2} value={link} onChange={(event) => setLink(event.target.value)} placeholder={t('Подписка https://… или vless:// hy2://')} />
        <div className="jey-import-row">
          <input className="jey-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('Имя (необязательно)')} />
          <button className="primary-button small" disabled={busy || !link.trim()} onClick={() => void importLink()}>{t('Добавить')}</button>
        </div>
      </div>}

      {tabs.length > 1 && <div className="jey-subs">
        {tabs.map((key) => <button key={key} className={`jey-sub ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
          {key === 'all'
            ? `${t('Все')} · ${nodes.length}`
            : key === 'manual'
              ? `${t('Ручные')} · ${nodes.filter((item) => subscriptionKey(item) === key).length}`
              : `${(runtime.subscriptions ?? []).find((item) => item.url === key)?.title || t('Подписка')} · ${nodes.filter((item) => subscriptionKey(item) === key).length}`}
        </button>)}
      </div>}

      <div className={`server-card ${info ? 'is-subscription' : 'is-overview'}`}>
        <div className="server-card-main">
          <span className="server-card-symbol" aria-hidden>
            <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.45" /><rect x="4" y="14" width="16" height="6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.45" /><circle cx="7.5" cy="7" r=".9" fill="currentColor" /><circle cx="7.5" cy="17" r=".9" fill="currentColor" /><path d="M11 7h5.5M11 17h5.5" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /></svg>
          </span>
          <div className="server-card-copy">
            <small>{info ? t('Выбранная подписка') : t('Текущая выборка')}</small>
            <strong>{title}</strong>
            <span>{info
              ? `${t('Обновлено')} ${formatWhen(info.lastSync)}`
              : tab === 'manual'
                ? t('Серверы, добавленные отдельными ссылками')
                : t('Серверы из всех доступных источников')}</span>
          </div>
        </div>
        <div className="server-card-metrics">
          <span><small>{t('Серверов')}</small><strong>{visible.length}</strong></span>
          <span><small>{info ? t('Трафик') : t('Подписок')}</small><strong>{info ? `${formatBytes(used)} / ${quota}` : runtime.subscriptions?.length ?? 0}</strong></span>
        </div>
        {info && <div className="server-card-details">
          <span className="server-expire">{t('Истекает')} {formatExpire(info.expireAt)}</span>
          <span>{info.updateHours ? `${t('Автообновление: каждые')} ${info.updateHours} ${t('ч.')}` : t('Интервал обновления не задан')}</span>
        </div>}
        {info?.announce && <div className="server-ribbon">{info.announce}</div>}
      </div>

      <div className="server-list">
        {listed.map((profile) => {
          const live = runtime.status === 'connected' && runtime.activeProfileId === profile.id;
          const blocked = canConnect(profile);
          return <ServerRow
            key={profile.id}
            profile={profile}
            live={live}
            picked={selected?.id === profile.id}
            blocked={blocked}
            // Лучший сервер уже стоит первым, но глазом это не читается: строки
            // одинаковые. Корона отвечает на вопрос «а какой выбрать» сразу.
            isBest={fastest?.id === profile.id && !blocked}
            onSelect={selectServer}
            onLaunch={launchServer}
          />;
        })}
      </div>
    </div>

    <aside className="server-right">
      {runtime.status === 'connected' && <span className="tunnel-session-counter" aria-label={`${t('Время подключения')} ${sessionDuration}`}>{sessionDuration}</span>}
      {runtime.status === 'connected' && panelProfile && <div className="tunnel-route" aria-label={`${t('Защищённый маршрут к серверу')} ${panelLocation.detail}`}>
        <span className="tunnel-route-device" title={t('Это устройство')}>
          <svg viewBox="0 0 24 24" aria-hidden><rect x="4" y="3.5" width="16" height="12" rx="2" /><path d="M8 20h8M10 15.5 9 20m5-4.5 1 4.5" /></svg>
        </span>
        <span className="tunnel-route-track" aria-hidden><i /></span>
        <span className="tunnel-route-server" title={panelLocation.detail}><Flag code={panelProfile.country} /></span>
      </div>}
      <button
        className={`power-orb ${onAir ? 'is-on' : ''} ${otherLive ? 'is-other' : ''} ${runtime.status === 'connecting' ? 'is-wait' : ''}`}
        disabled={busy}
        onClick={() => void togglePower()}
        aria-label={onAir ? t('Выключить VPN') : otherLive ? t('Переключить сервер') : t('Включить VPN')}
      >
        <span className="orb-halo orb-halo-primary" />
        <span className="orb-halo orb-halo-follow" />
        <span className="orb-halo orb-halo-wait" />
        <span className="orb-core">⏻</span>
      </button>
      <div className="power-meta">
        <strong>{panelLocation.country}</strong>
        {panelLocation.detail !== panelLocation.country && <small className="power-location">{panelLocation.detail}</small>}
        {runtime.status === 'connected'
          ? <span className={`power-connected ${latencyUnavailable ? 'is-unavailable' : ''}`}><i />{t('Подключено')} {latencyMs != null ? <>· <b>{latencyMs} {t('мс')}</b></> : latencyUnavailable ? t('· пинг недоступен') : t('· замеряем…')}</span>
          : <span className={`power-state ${runtime.status === 'error' ? 'is-error' : ''}`}>{powerState}</span>}
      </div>
      <button
        type="button"
        className={`quick-connect ${action === 'ping' || runtime.status === 'connecting' ? 'is-working' : ''} ${runtime.status === 'connected' && runtime.activeProfileId === fastest?.id ? 'is-done' : ''}`}
        disabled={busy || Boolean(action) || runtime.status === 'connecting'}
        onClick={() => void quickConnect()}
      >
        {runtime.status === 'connected' && runtime.activeProfileId === fastest?.id
          ? <svg className="quick-connect-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          : <svg className="quick-connect-bolt" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2.6 5 13.4h5.2l-.8 8 8.4-11H12.4l.8-7.8Z" /></svg>}
        {action === 'ping' ? t('Замеряем пинг…')
          : runtime.status === 'connecting' ? t('Подключаемся…')
          : runtime.status === 'connected' && runtime.activeProfileId === fastest?.id ? t('Подключено к лучшему')
          : t('Подключиться к лучшему')}
      </button>
      <div className="mode-switch" aria-label={t('Режим подключения')}>
        <div className="mode-switch-options">
          <button
            type="button"
            className={displayedMode === 'proxy' ? 'active' : ''}
            aria-pressed={displayedMode === 'proxy'}
            disabled={busy || runtime.status === 'connecting'}
            onClick={() => void selectConnectionMode('proxy')}
          >PROXY</button>
          <button
            type="button"
            className={displayedMode === 'tun' ? 'active' : ''}
            aria-pressed={displayedMode === 'tun'}
            disabled={busy || runtime.status === 'connecting'}
            onClick={() => void selectConnectionMode('tun')}
          >TUN</button>
        </div>
      </div>
      <button type="button" className="diagnostics-entry" onClick={() => setDiagnosticsOpen(true)}>
        <span className="diagnostics-entry-icon"><svg viewBox="0 0 24 24" aria-hidden><path d="M4 13h3l2-6 4 11 2-5h5" /><circle cx="12" cy="12" r="9" /></svg></span>
        <span><strong>{t('Диагностика')}</strong><small>{t('Ядро, процесс и порты')}</small></span>
        <b>→</b>
      </button>
      <button type="button" className="diagnostics-entry" onClick={() => void runNetworkReport()}>
        <span className="diagnostics-entry-icon"><svg viewBox="0 0 24 24" aria-hidden><path d="M4 19h16M7 15v4m5-8v8m5-12v12" /></svg></span>
        <span><strong>{t('Проверить сеть')}</strong><small>{t('Прокси, адаптеры и маршруты')}</small></span>
        <b>→</b>
      </button>
      <div className={`auto-connect-summary ${settings.autoConnectVpn ? 'is-on' : ''}`}><i /><span>{t('Автоподключение')} {settings.autoConnectVpn ? t('включено') : t('выключено')}</span></div>
      {runtime.lanShared && <div className="auto-connect-summary is-on lan-share-summary"><i /><span>{t('Раздача в сеть')}{lanEndpoints.length ? ` · ${lanEndpoints[0].socks}` : ''}</span></div>}
      {!runtime.xrayReady && <div className="jey-note"><span>i</span><div><strong>{t('Подготовка VPN-ядра')}</strong><p>{xrayUpdate?.error || t('Выполняется загрузка Xray / sing-box. Кнопка подключения станет доступна после установки.')}</p></div></div>}
    </aside>
  </section>;
}
