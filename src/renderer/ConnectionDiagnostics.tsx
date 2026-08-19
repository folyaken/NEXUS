import { useCallback, useEffect, useState } from 'react';
import type { VpnDiagnostics, VpnDiagnosticTone, VpnStatus } from '../main/types';
import { t } from '../main/i18n';

type Props = {
  profileId: string | null;
  onBack: () => void;
  onToast: (message: string) => void;
};

/**
 * Подпись состояния VPN.
 *
 * Намеренно функция, а не готовый объект: объект уровня модуля вычисляется один
 * раз при загрузке файла — раньше, чем приложение прочитает настройки и выберет
 * язык. Английский интерфейс показывал бы здесь русские подписи до перезапуска.
 */
function runtimeLabel(status: VpnStatus): string {
  return ({
    disconnected: t('VPN выключен'),
    connecting: t('Подключение…'),
    connected: t('VPN подключён'),
    error: t('Ошибка VPN'),
  } as Record<VpnStatus, string>)[status];
}

function StatusIcon({ tone }: { tone: VpnDiagnosticTone }) {
  if (tone === 'ok') return <svg viewBox="0 0 24 24" aria-hidden><path d="m5 12.5 4.2 4L19 7" /></svg>;
  if (tone === 'error') return <svg viewBox="0 0 24 24" aria-hidden><path d="m7 7 10 10M17 7 7 17" /></svg>;
  if (tone === 'warning') return <svg viewBox="0 0 24 24" aria-hidden><path d="M12 4 3.8 19h16.4L12 4Z" /><path d="M12 9v4M12 16.5v.1" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="8" /><path d="M12 10.5V17M12 7.2v.1" /></svg>;
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Packaged file:// windows can deny the async API; use a focused field.
    }
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error(t('Буфер обмена недоступен'));
}

export function ConnectionDiagnostics({ profileId, onBack, onToast }: Props) {
  const [snapshot, setSnapshot] = useState<VpnDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (showProgress = true) => {
    if (showProgress) setLoading(true);
    setError('');
    try {
      const api = window.nexus;
      if (!api) throw new Error(t('Диагностика доступна в приложении NEXUS'));
      setSnapshot(await api.getVpnDiagnostics(profileId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('Не удалось выполнить диагностику'));
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
    const off = window.nexus?.onVpnChanged(() => void load(false));
    return () => off?.();
  }, [load]);

  const copyReport = async () => {
    if (!snapshot) return;
    try {
      await writeClipboard(snapshot.report);
      onToast(t('Безопасный отчёт скопирован'));
    } catch (reason) {
      onToast(reason instanceof Error ? reason.message : t('Не удалось скопировать отчёт'));
    }
  };

  const issueCount = snapshot?.checks.filter((check) => check.tone === 'error' || check.tone === 'warning').length ?? 0;
  return <section className="page-section diagnostics-page">
    <div className="diagnostics-toolbar">
      <button type="button" className="diagnostics-back" onClick={onBack}>
        <svg viewBox="0 0 24 24" aria-hidden><path d="m15 5-7 7 7 7" /></svg>
        Назад
      </button>
      <div className="diagnostics-heading">
        <span>CONNECTION HEALTH</span>
        <h2>{t('Диагностика подключения')}</h2>
        <p>{t('Короткая проверка ядра, процесса, маршрутизации и портов.')}</p>
      </div>
      <button type="button" className={`diagnostics-refresh ${loading ? 'is-loading' : ''}`} disabled={loading} onClick={() => void load()}>
        <svg viewBox="0 0 24 24" aria-hidden><path d="M19 8V4l-2 2a8 8 0 1 0 2.2 8" /><path d="M19 4h-4" /></svg>
        {loading ? t('Проверяем…') : t('Проверить снова')}
      </button>
    </div>

    <div className="diagnostics-content">
      {error && <div className="diagnostics-error"><StatusIcon tone="error" /><div><strong>{t('Проверка не выполнена')}</strong><p>{error}</p></div><button type="button" onClick={() => void load()}>{t('Повторить')}</button></div>}

      {snapshot && <>
        <div className={`diagnostics-overview ${snapshot.overall}`}>
          <span className="diagnostics-overview-icon"><StatusIcon tone={snapshot.overall} /></span>
          <div>
            <span>{runtimeLabel(snapshot.runtimeStatus)}</span>
            <h3>{snapshot.headline}</h3>
            <p>{issueCount ? `Требуют внимания: ${issueCount}` : t('Все доступные проверки пройдены')}</p>
          </div>
          <div className="diagnostics-overview-meta">
            <span>{t('РЕЖИМ')}</span><strong>{snapshot.mode.toUpperCase()}</strong>
          </div>
        </div>

        <div className="diagnostics-facts">
          <div><span>{t('Ядро')}</span><strong>{snapshot.engine}</strong><small>{t('локальный runtime')}</small></div>
          <div><span>{t('Профиль')}</span><strong title={snapshot.profileName ?? undefined}>{snapshot.profileName ?? t('Не выбран')}</strong><small>{snapshot.protocol?.toUpperCase() ?? t('нет протокола')}</small></div>
          <div><span>{t('Сервер')}</span><strong title={snapshot.endpoint ?? undefined}>{snapshot.endpoint ?? '—'}</strong><small>{t('без данных доступа')}</small></div>
          <div><span>{t('Локальные порты')}</span><strong>{snapshot.localSocks.replace('127.0.0.1:', '')} / {snapshot.localHttp.replace('127.0.0.1:', '')}</strong><small>SOCKS / HTTP</small></div>
        </div>

        <div className="diagnostics-grid">
          <section className="diagnostics-checks-card">
            <div className="diagnostics-section-head"><div><span>{t('БЫСТРАЯ ПРОВЕРКА')}</span><h3>{t('Что работает')}</h3></div><small>{snapshot.checks.length} пунктов</small></div>
            <div className="diagnostics-check-list">
              {snapshot.checks.map((check) => <div className={`diagnostics-check ${check.tone}`} key={check.id}>
                <span className="diagnostics-check-icon"><StatusIcon tone={check.tone} /></span>
                <div><strong>{check.title}</strong><p>{check.summary}</p>{check.detail && <small>{check.detail}</small>}</div>
                <em>{check.tone === 'ok' ? t('ГОТОВО') : check.tone === 'error' ? t('ОШИБКА') : check.tone === 'warning' ? t('ВНИМАНИЕ') : t('ИНФО')}</em>
              </div>)}
            </div>
          </section>

          <aside className="diagnostics-report-card">
            <div className="diagnostics-report-icon"><svg viewBox="0 0 24 24" aria-hidden><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5M10 12h5M10 16h5" /></svg></div>
            <span>SAFE SUPPORT REPORT</span>
            <h3>{t('Отчёт для поддержки')}</h3>
            <p>Можно отправить этот текст при обращении за помощью. В нём нет ссылок подписок и ключей подключения.</p>
            <button type="button" onClick={() => void copyReport()}>
              <svg viewBox="0 0 24 24" aria-hidden><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
              Скопировать отчёт
            </button>
            <details><summary>{t('Посмотреть текст')}</summary><pre>{snapshot.report}</pre></details>
            <div className="diagnostics-privacy"><i>✓</i><span><strong>{t('Секреты скрыты')}</strong><small>UUID, пароли, токены, URL и локальное имя пользователя удаляются до показа.</small></span></div>
          </aside>
        </div>
      </>}
    </div>
  </section>;
}
