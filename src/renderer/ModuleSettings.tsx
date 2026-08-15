import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModuleManifest } from '../main/types';

/**
 * Панель настроек одного модуля.
 *
 * Открывается шестерёнкой на карточке: настроек у модуля немного, поэтому
 * отдельный раздел со списком всех модулей был бы лишним шагом.
 */

function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim();
}

/** Предпросмотр нормализации: человек вставляет ссылку, а в список идёт домен. */
function previewHost(input: string): string {
  let value = input.trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split(/[/?#]/, 1)[0];
  const atIndex = value.lastIndexOf('@');
  if (atIndex >= 0) value = value.slice(atIndex + 1);
  return value.replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '').replace(/^www\./, '');
}

function DpiHostlistSection({ onToast }: { onToast: (message: string) => void }) {
  const [hosts, setHosts] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const api = window.nexus;
    if (!api?.getDpiHosts) {
      setLoaded(true);
      return;
    }
    void api.getDpiHosts()
      .then(setHosts)
      .catch((error: unknown) => onToast(cleanError(error)))
      .finally(() => setLoaded(true));
  }, [onToast]);

  const normalized = useMemo(() => previewHost(draft), [draft]);
  const duplicate = Boolean(normalized) && hosts.includes(normalized);

  const addHost = async () => {
    const value = draft.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const next = await window.nexus?.addDpiHost(value);
      if (next) setHosts(next);
      setDraft('');
      inputRef.current?.focus();
      onToast(`${normalized} добавлен в обход DPI`);
    } catch (error) {
      onToast(cleanError(error));
    } finally {
      setBusy(false);
    }
  };

  const removeHost = async (host: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await window.nexus?.removeDpiHost(host);
      if (next) setHosts(next);
      onToast(`${host} удалён из списка`);
    } catch (error) {
      onToast(cleanError(error));
    } finally {
      setBusy(false);
    }
  };

  return <section className="module-settings-card">
    <div className="module-settings-card-head">
      <div>
        <h3>Свои сайты</h3>
        <p>Добавьте сайты, которые нужно открывать в обход блокировок. Встроенный список YouTube и Discord продолжает работать.</p>
      </div>
      <span className="module-settings-count">{hosts.length}</span>
    </div>

    <form
      className="dpi-host-form"
      onSubmit={(event) => {
        event.preventDefault();
        void addHost();
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        placeholder="instagram.com"
        aria-label="Адрес сайта"
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="submit" className="primary-button small" disabled={!draft.trim() || busy || duplicate}>
        <b>Добавить</b>
      </button>
    </form>

    {duplicate
      ? <p className="dpi-host-hint is-warning">{normalized} уже есть в списке</p>
      : normalized && normalized !== draft.trim().toLowerCase()
        ? <p className="dpi-host-hint">Будет добавлен как <b>{normalized}</b></p>
        : <p className="dpi-host-hint">Можно вставить и полную ссылку — адрес определится сам.</p>}

    {!loaded ? <p className="dpi-host-hint">Загрузка списка…</p> : hosts.length ? <>
      <ul className="dpi-host-list">
        {hosts.map((host) => <li key={host}>
          <span className="dpi-host-dot" aria-hidden="true" />
          <span className="dpi-host-name">{host}</span>
          <button
            type="button"
            className="dpi-host-remove"
            disabled={busy}
            aria-label={`Удалить ${host}`}
            onClick={() => void removeHost(host)}
          >×</button>
        </li>)}
      </ul>
      <p className="dpi-host-note">Изменения применяются при следующем запуске модуля. Если он уже работает — выключите и включите его снова.</p>
    </> : <div className="dpi-host-empty">
      <strong>Список пуст</strong>
      <p>Добавьте первый сайт, например instagram.com.</p>
    </div>}
  </section>;
}

export function ModuleSettings({ module, onClose, onToast, onStrategyChange }: {
  module: ModuleManifest;
  onClose: () => void;
  onToast: (message: string) => void;
  onStrategyChange: (module: ModuleManifest, strategy: string) => void;
}) {
  const strategies = Object.keys(module.strategies ?? {});
  const isRunning = module.status === 'running' || module.status === 'starting';

  return <section className="page-section module-settings-page">
    <div className="page-heading">
      <div>
        <span className="section-kicker">НАСТРОЙКИ МОДУЛЯ</span>
        <h1>{module.name}</h1>
        <p>{module.description}</p>
      </div>
      <button className="quiet-button" onClick={onClose}><span>←</span> К модулям</button>
    </div>

    {isRunning && <div className="module-settings-notice">
      <span aria-hidden="true">i</span>
      <div><strong>Модуль сейчас работает</strong><p>Новые настройки вступят в силу после перезапуска модуля.</p></div>
    </div>}

    {module.id === 'zapret' && <DpiHostlistSection onToast={onToast} />}

    {strategies.length > 0 && <section className="module-settings-card">
      <div className="module-settings-card-head">
        <div>
          <h3>Профиль обхода</h3>
          <p>Если какой-то сайт не открывается, попробуйте другой профиль.</p>
        </div>
      </div>
      <div className="module-settings-strategies" role="radiogroup" aria-label="Профиль обхода">
        {strategies.map((strategy) => <button
          key={strategy}
          type="button"
          role="radio"
          aria-checked={module.strategy === strategy}
          className={`module-strategy-option ${module.strategy === strategy ? 'is-active' : ''}`}
          disabled={isRunning}
          onClick={() => onStrategyChange(module, strategy)}
        >
          <i className="settings-radio" />
          <span>{strategy}</span>
        </button>)}
      </div>
    </section>}

    {module.id !== 'zapret' && !strategies.length && <div className="empty-state">
      <span>⚙</span>
      <h3>Настроек пока нет</h3>
      <p>У этого модуля нет параметров — он работает сразу после запуска.</p>
    </div>}
  </section>;
}
