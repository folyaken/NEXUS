import { useMemo, useState } from 'react';
import type { VpnProfile, VpnSubscriptionInfo } from '../main/types';
import { dateLocale, t } from '../main/i18n';

export type SubscriptionAction = {
  kind: 'add' | 'refresh' | 'refresh-all' | 'remove';
  url?: string;
};

function sourceKey(value?: string): string {
  if (!value) return 'manual';
  try {
    const parsed = new URL(value.trim());
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value.trim();
  }
}

function sourceHost(value: string): string {
  try {
    return new URL(value).host.replace(/^www\./i, '');
  } catch {
    return t('Адрес подписки');
  }
}

function formatBytes(value?: number): string {
  if (!value || value < 0) return '0 MB';
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  if (gb < 1024) return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
  return `${(gb / 1024).toFixed(1)} TB`;
}

function formatWhen(value?: string): string {
  if (!value) return t('Ещё не обновлялась');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t('Время неизвестно');
  return new Intl.DateTimeFormat(dateLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function expiration(value?: string): { label: string; tone: 'normal' | 'soon' | 'expired' } {
  if (!value) return { label: t('Без ограничения срока'), tone: 'normal' };
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { label: t('Срок не указан'), tone: 'normal' };
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  const stamp = new Intl.DateTimeFormat(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  if (days < 0) return { label: `${t('Истекла')} ${stamp}`, tone: 'expired' };
  if (days === 0) return { label: `${t('Истекает сегодня')} · ${stamp}`, tone: 'soon' };
  return { label: `${t('Истекает')} ${stamp} · ${t('ещё')} ${days} ${t('дн.')}`, tone: days <= 7 ? 'soon' : 'normal' };
}

export function SubscriptionManager({
  subscriptions,
  profiles,
  action,
  onBack,
  onAdd,
  onRefresh,
  onRefreshAll,
  onRemove,
}: {
  subscriptions: VpnSubscriptionInfo[];
  profiles: VpnProfile[];
  action: SubscriptionAction | null;
  onBack: () => void;
  onAdd: (url: string) => Promise<boolean>;
  onRefresh: (url: string) => Promise<void>;
  onRefreshAll: () => Promise<void>;
  onRemove: (url: string) => Promise<boolean>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null);
  const busy = Boolean(action);
  const nodeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const profile of profiles) {
      if (!profile.subscriptionUrl || profile.kind === 'notice') continue;
      const key = sourceKey(profile.subscriptionUrl);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [profiles]);

  const submit = async () => {
    const candidate = url.trim();
    if (!candidate) return;
    if (await onAdd(candidate)) {
      setUrl('');
      setAddOpen(false);
    }
  };

  const remove = async (itemUrl: string) => {
    if (await onRemove(itemUrl)) setConfirmUrl(null);
  };

  return <section className="page-section jey-page subscriptions-page">
    <div className="subscriptions-toolbar">
      <button type="button" className="app-settings-back" onClick={onBack} aria-label={t('Вернуться к серверам')}>
        <svg viewBox="0 0 20 20" aria-hidden><path d="m12.5 4.5-5 5.5 5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {t('Серверы')}
      </button>
      <div className="subscriptions-heading">
        <span>Jey2Ray</span>
        <h2>{t('Управление подписками')}</h2>
        <p>{t('Добавляй источники, обновляй их по отдельности и контролируй срок действия.')}</p>
      </div>
      <div className="subscriptions-toolbar-actions">
        <button type="button" className="subscription-toolbar-button" disabled={busy} onClick={() => setAddOpen((value) => !value)}>
          <svg viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          {t('Добавить')}
        </button>
        <button type="button" className={`subscription-toolbar-button refresh ${action?.kind === 'refresh-all' ? 'is-loading' : ''}`} disabled={busy || !subscriptions.length} onClick={() => void onRefreshAll()}>
          <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M11.2 3.15A8.85 8.85 0 1 0 19 7.55l-1.95 1.15A6.55 6.55 0 1 1 11.2 5.45v2.7L17.45 5 11.2.65z" /></svg>
          {t('Обновить все')}
        </button>
      </div>
    </div>

    <div className="subscriptions-content">
      {addOpen && <section className="subscription-add-card slide-in">
        <div className="subscription-add-copy">
          <span className="subscription-source-icon">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M9.5 14.5 14.5 9M7.2 16.8l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M16.8 7.2l1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </span>
          <div><strong>{t('Новая подписка')}</strong><p>{t('Вставьте полный HTTPS-адрес, выданный провайдером. Адрес и его секретный токен не показываются в списке.')}</p></div>
        </div>
        <div className="subscription-add-form">
          <input
            type="url"
            value={url}
            disabled={busy}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
            placeholder="https://provider.example.com/sub/…"
            aria-label={t('Адрес новой подписки')}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" disabled={busy || !url.trim()} onClick={() => void submit()}>{action?.kind === 'add' ? t('Добавляем…') : t('Добавить подписку')}</button>
        </div>
      </section>}

      <div className="subscriptions-summary">
        <div><span>{t('Источников')}</span><strong>{subscriptions.length}</strong></div>
        <div><span>{t('Серверов в подписках')}</span><strong>{[...nodeCounts.values()].reduce((sum, count) => sum + count, 0)}</strong></div>
        <p>{t('Удаление источника удалит и его серверы. Если один из них подключён, VPN будет сначала безопасно отключён.')}</p>
      </div>

      {subscriptions.length ? <div className="subscription-list" aria-live="polite">
        {subscriptions.map((info) => {
          const key = sourceKey(info.url);
          const nodes = nodeCounts.get(key) ?? 0;
          const used = Math.max(0, (info.upload ?? 0) + (info.download ?? 0));
          const total = Math.max(0, info.total ?? 0);
          const progress = total ? Math.min(100, used / total * 100) : 0;
          const expires = expiration(info.expireAt);
          const state = expires.tone === 'expired'
            ? { tone: 'expired', label: t('Срок истёк') }
            : nodes > 0
              ? { tone: 'healthy', label: t('Исправна') }
              : { tone: 'empty', label: t('Нет серверов') };
          const isRefreshing = action?.kind === 'refresh' && action.url === info.url;
          const isRemoving = action?.kind === 'remove' && action.url === info.url;
          const confirming = confirmUrl === info.url;
          return <article className={`subscription-card ${confirming ? 'is-confirming' : ''}`} key={info.url}>
            <div className="subscription-card-head">
              <span className="subscription-source-icon">
                <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3a9 9 0 1 0 9 9M3.5 9h11M3.5 15h8M12 3c-2.1 2.4-3.2 5.4-3.2 9s1.1 6.6 3.2 9M12 3c1.2 1.4 2.1 3 2.6 4.8" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" /><path d="m16.4 12.5 1.7 1.7 3.3-3.5" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <div className="subscription-title">
                <span className={`subscription-state ${state.tone}`}><i /> {state.label}</span>
                <h3>{info.title || sourceHost(info.url)}</h3>
                <p title={t('Секретная часть адреса скрыта')}>{sourceHost(info.url)} · {t('адрес скрыт')}</p>
              </div>
              <span className="subscription-node-count"><strong>{nodes}</strong><small>{t('серверов')}</small></span>
            </div>

            <div className="subscription-metrics">
              <div><span>{t('Трафик')}</span><strong>{formatBytes(used)} <em>/ {total ? formatBytes(total) : t('без лимита')}</em></strong></div>
              <div><span>{t('Последнее обновление')}</span><strong>{formatWhen(info.lastSync)}</strong></div>
              <div><span>{t('Интервал панели')}</span><strong>{info.updateHours ? `${t('каждые')} ${info.updateHours} ${t('ч.')}` : t('не указан')}</strong></div>
            </div>
            {total > 0 && <div className="subscription-quota" title={`${t('Использовано')} ${progress.toFixed(1)}%`}><i style={{ width: `${progress}%` }} /></div>}
            <div className="subscription-card-foot">
              <span className={`subscription-expire ${expires.tone}`}>{expires.label}</span>
              <div className="subscription-card-actions">
                <button type="button" className={`subscription-refresh ${isRefreshing ? 'is-loading' : ''}`} disabled={busy} onClick={() => void onRefresh(info.url)}>
                  <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M11.2 3.15A8.85 8.85 0 1 0 19 7.55l-1.95 1.15A6.55 6.55 0 1 1 11.2 5.45v2.7L17.45 5 11.2.65z" /></svg>
                  {isRefreshing ? t('Обновляем…') : t('Обновить')}
                </button>
                <button type="button" className="subscription-delete" disabled={busy} onClick={() => setConfirmUrl(info.url)}>{t('Удалить')}</button>
              </div>
            </div>

            {confirming && <div className="subscription-confirm">
              <div><strong>{t('Удалить подписку?')}</strong><p>{t('Будут удалены все её серверы:')} {nodes}. {t('Это действие нельзя отменить.')}</p></div>
              <div><button type="button" disabled={busy} onClick={() => setConfirmUrl(null)}>{t('Отмена')}</button><button type="button" className="danger" disabled={busy} onClick={() => void remove(info.url)}>{isRemoving ? t('Удаляем…') : t('Удалить')}</button></div>
            </div>}
          </article>;
        })}
      </div> : <div className="subscriptions-empty">
        <span className="subscription-source-icon">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M9.5 14.5 14.5 9M7.2 16.8l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M16.8 7.2l1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </span>
        <strong>{t('Подписок пока нет')}</strong>
        <p>{t('Добавьте HTTPS-ссылку провайдера — серверы появятся в общем списке автоматически.')}</p>
        <button type="button" onClick={() => setAddOpen(true)}>{t('Добавить первую подписку')}</button>
      </div>}
    </div>
  </section>;
}
