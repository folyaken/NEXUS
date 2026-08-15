import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { readDpiExpertOptions } from '../main/dpi-arguments';
import { readTgProxyOptions } from '../main/tg-proxy-options';
import type { DpiExpertOptions, ModuleManifest, ModuleStatusReport, TgProxyOptions } from '../main/types';

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

/** Значение по умолчанию, если релиз содержит стандартный набор профилей. */
const DEFAULT_STRATEGY = 'general (ALT10)';

function DpiExpertSection({ module, onToast }: { module: ModuleManifest; onToast: (message: string) => void }) {
  const saved = useMemo(() => readDpiExpertOptions(module.extra_args), [module.extra_args]);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<DpiExpertOptions>(saved);
  const [busy, setBusy] = useState(false);

  // Сохранённые значения — источник истины: после перезапуска модуля форма
  // должна показывать то, что реально записано в манифест.
  useEffect(() => setOptions(saved), [saved]);

  const dirty = JSON.stringify(options) !== JSON.stringify(saved);
  const isRunning = module.status === 'running' || module.status === 'starting';

  const patch = (next: Partial<DpiExpertOptions>) => setOptions((current) => ({ ...current, ...next }));

  const numberValue = (value: number | null) => (value === null ? '' : String(value));
  const parseNumber = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await window.nexus?.setModuleExtraArgs(module.id, options);
      onToast(isRunning ? 'Параметры сохранены, модуль перезапущен' : 'Параметры сохранены');
    } catch (error) {
      onToast(cleanError(error));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => setOptions(saved);

  return <section className="module-settings-card expert-card">
    <button
      type="button"
      className={`expert-toggle ${open ? 'is-open' : ''}`}
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
    >
      <span className="expert-chevron" aria-hidden="true">
        <svg viewBox="0 0 20 20"><path d="m7.5 5.5 5 4.5-5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="expert-toggle-copy">
        <strong>Экспертные параметры</strong>
        <small>Тонкая настройка обхода для опытных пользователей</small>
      </span>
      {saved.hostcase || saved.hostdot || saved.wssize !== null || saved.desyncRepeats !== null || saved.custom
        ? <span className="expert-active-badge">включены</span>
        : null}
    </button>

    {open && <div className="expert-body">
      <div className="expert-warning">
        <span aria-hidden="true">!</span>
        <p>Изменяйте только если уверены. Неправильные параметры могут нарушить работу.</p>
      </div>

      <label className="expert-check">
        <input type="checkbox" checked={options.hostcase} onChange={(event) => patch({ hostcase: event.target.checked })} />
        <span><strong>Включить hostcase</strong><small>--hostcase</small></span>
      </label>

      <label className="expert-check">
        <input type="checkbox" checked={options.hostdot} onChange={(event) => patch({ hostdot: event.target.checked })} />
        <span><strong>Включить hostdot</strong><small>--hostdot</small></span>
      </label>

      <label className="expert-check">
        <input
          type="checkbox"
          checked={options.wssize !== null}
          onChange={(event) => patch({ wssize: event.target.checked ? 4 : null })}
        />
        <span><strong>Размер фрагмента</strong><small>--wssize</small></span>
        <input
          type="number"
          className="expert-number"
          min={1}
          max={65535}
          disabled={options.wssize === null}
          value={numberValue(options.wssize)}
          aria-label="Размер фрагмента"
          onChange={(event) => patch({ wssize: parseNumber(event.target.value) })}
        />
      </label>

      <label className="expert-check">
        <input
          type="checkbox"
          checked={options.desyncRepeats !== null}
          onChange={(event) => patch({ desyncRepeats: event.target.checked ? 6 : null })}
        />
        <span><strong>Повторы</strong><small>--dpi-desync-repeats</small></span>
        <input
          type="number"
          className="expert-number"
          min={1}
          max={50}
          disabled={options.desyncRepeats === null}
          value={numberValue(options.desyncRepeats)}
          aria-label="Число повторов"
          onChange={(event) => patch({ desyncRepeats: parseNumber(event.target.value) })}
        />
      </label>

      <div className="expert-custom">
        <label htmlFor="dpi-custom-args">Дополнительные аргументы</label>
        <input
          id="dpi-custom-args"
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder="--hostcase --wssize=4"
          value={options.custom}
          onChange={(event) => patch({ custom: event.target.value })}
        />
        <p className="dpi-host-hint">Через пробел, каждый начинается с двух дефисов. Списки сайтов и порты NEXUS задаёт сам.</p>
      </div>

      <div className="expert-actions">
        <button type="button" className="primary-button small" disabled={!dirty || busy} onClick={() => void save()}>
          <b>{busy ? 'Сохранение…' : 'Сохранить'}</b>
        </button>
        <button type="button" className="quiet-button" disabled={!dirty || busy} onClick={reset}>Отменить</button>
        {isRunning && <span className="expert-restart-note">Модуль перезапустится автоматически</span>}
      </div>
    </div>}
  </section>;
}

function TgProxySection({ module, onToast }: { module: ModuleManifest; onToast: (message: string) => void }) {
  const saved = useMemo(() => readTgProxyOptions(module), [module.args, module.healthcheck]);
  const [options, setOptions] = useState<TgProxyOptions>(saved);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ModuleStatusReport | null>(null);
  const [checking, setChecking] = useState(false);

  // Манифест — источник истины: после перезапуска форма показывает то, что
  // действительно сохранено, а не последнее введённое значение.
  useEffect(() => setOptions(saved), [saved]);

  const isRunning = module.status === 'running' || module.status === 'starting';
  const dirty = options.port !== saved.port || options.mode !== saved.mode;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await window.nexus?.setTgProxyOptions(module.id, options);
      setStatus(null);
      onToast(isRunning ? 'Параметры сохранены, модуль перезапущен' : 'Параметры сохранены');
    } catch (error) {
      onToast(cleanError(error));
    } finally {
      setBusy(false);
    }
  };

  const checkStatus = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const report = await window.nexus?.checkModuleStatus(module.id);
      if (report) setStatus(report);
    } catch (error) {
      onToast(cleanError(error));
    } finally {
      setChecking(false);
    }
  };

  return <section className="module-settings-card">
    <div className="module-settings-card-head">
      <div>
        <h3>Основные параметры</h3>
        <p>Порт, на котором работает прокси, и набор обслуживаемых запросов.</p>
      </div>
    </div>

    <div className="tg-option-row">
      <label htmlFor="tg-proxy-port">
        <strong>Порт прокси</strong>
        <small>Локальный порт, который слушает модуль</small>
      </label>
      <input
        id="tg-proxy-port"
        type="number"
        className="expert-number"
        min={1024}
        max={65535}
        value={options.port}
        onChange={(event) => setOptions((current) => ({ ...current, port: Number(event.target.value) }))}
      />
    </div>

    <div className="tg-mode-list" role="radiogroup" aria-label="Режим работы">
      <button
        type="button"
        role="radio"
        aria-checked={options.mode === 'telegram'}
        className={`module-strategy-option ${options.mode === 'telegram' ? 'is-active' : ''}`}
        onClick={() => setOptions((current) => ({ ...current, mode: 'telegram' }))}
      >
        <i className="settings-radio" />
        <span><strong>Только Telegram</strong><small>Стандартный режим. Через прокси идёт только Telegram.</small></span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={options.mode === 'universal'}
        className={`module-strategy-option ${options.mode === 'universal' ? 'is-active' : ''}`}
        onClick={() => setOptions((current) => ({ ...current, mode: 'universal' }))}
      >
        <i className="settings-radio" />
        <span><strong>Все прокси-запросы</strong><small>Универсальный прокси: подойдёт для браузера и других программ.</small></span>
      </button>
    </div>

    <div className="expert-actions">
      <button type="button" className="primary-button small" disabled={!dirty || busy} onClick={() => void save()}>
        <b>{busy ? 'Сохранение…' : 'Сохранить'}</b>
      </button>
      <button type="button" className="quiet-button" disabled={!dirty || busy} onClick={() => setOptions(saved)}>Отменить</button>
      {dirty && isRunning && <span className="expert-restart-note">Модуль перезапустится автоматически</span>}
    </div>

    <div className="tg-status-block">
      <button type="button" className="quiet-button" disabled={checking} onClick={() => void checkStatus()}>
        {checking ? 'Проверяем…' : 'Проверить статус'}
      </button>

      {status && <div className={`tg-status-report ${status.running && status.portListening ? 'is-ok' : status.running ? 'is-warning' : ''}`}>
        <strong>{status.summary}</strong>
        <ul>
          <li><span>Процесс</span><b>{status.running ? 'активен' : 'не запущен'}</b></li>
          <li><span>PID</span><b>{status.pid ?? '—'}</b></li>
          <li><span>Порт {status.host}:{status.port}</span><b>{status.portListening ? 'прослушивается' : 'не отвечает'}</b></li>
        </ul>
      </div>}
    </div>
  </section>;
}

/**
 * Выпадающий список профилей в стиле NEXUS.
 *
 * Нативный список рисуется средствами Windows и не поддаётся оформлению —
 * поэтому список собран вручную. Клавиатура и чтение с экрана сохранены:
 * роль listbox, стрелки, Home/End, Enter и Escape работают как в обычном select.
 */
function StrategySelect({ options, value, disabled, onSelect }: {
  options: string[];
  value: string;
  disabled?: boolean;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.indexOf(value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside, true);
    return () => document.removeEventListener('pointerdown', closeOnOutside, true);
  }, [open]);

  useEffect(() => {
    if (open) setActiveIndex(Math.max(0, options.indexOf(value)));
  }, [open, options, value]);

  // Выделенный пункт удерживается в зоне видимости при навигации с клавиатуры.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const choose = (index: number) => {
    const next = options[index];
    if (!next) return;
    setOpen(false);
    if (next !== value) onSelect(next);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(options.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(activeIndex);
    }
  };

  return <div className={`nx-select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`} ref={rootRef} onKeyDown={onKeyDown}>
    <button
      type="button"
      className="nx-select-trigger"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label="Профиль обхода"
      disabled={disabled}
      onClick={() => setOpen((current) => !current)}
    >
      <span className="nx-select-value">{value || 'Профиль не выбран'}</span>
      <span className="nx-select-caret" aria-hidden="true">
        <svg viewBox="0 0 20 20"><path d="m5.5 8 4.5 4.5L14.5 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    </button>

    {open && <div className="nx-select-list" role="listbox" aria-label="Профиль обхода" ref={listRef} tabIndex={-1}>
      {options.map((option, index) => {
        const selected = option === value;
        return <button
          key={option}
          type="button"
          role="option"
          aria-selected={selected}
          data-active={index === activeIndex}
          className={`nx-select-option ${selected ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(index)}
        >
          <span className="nx-select-mark" aria-hidden="true" />
          <span className="nx-select-label">{option}</span>
          {selected && <span className="nx-select-current">активен</span>}
        </button>;
      })}
    </div>}
  </div>;
}

export function ModuleSettings({ module, onClose, onToast, onStrategyChange }: {
  module: ModuleManifest;
  onClose: () => void;
  onToast: (message: string) => void;
  onStrategyChange: (module: ModuleManifest, strategy: string) => void;
}) {
  const strategies = Object.keys(module.strategies ?? {});
  const isRunning = module.status === 'running' || module.status === 'starting';
  const [scanning, setScanning] = useState(false);

  // Профили сохраняются в манифест при установке. У пользователей, обновивших
  // NEXUS поверх старого релиза, список пуст — тогда его нужно пересобрать.
  const scanStrategies = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const next = await window.nexus?.refreshModuleStrategies(module.id);
      onToast(next ? `Найдено профилей: ${Object.keys(next.strategies ?? {}).length}` : 'Профили не найдены');
    } catch (error) {
      onToast(cleanError(error));
    } finally {
      setScanning(false);
    }
  };

  const activeStrategy = module.strategy && strategies.includes(module.strategy)
    ? module.strategy
    : strategies.includes(DEFAULT_STRATEGY) ? DEFAULT_STRATEGY : strategies[0] ?? '';

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

    {module.id === 'zapret' && strategies.length === 0 && <section className="module-settings-card">
      <div className="module-settings-card-head">
        <div>
          <h3>Профиль обхода</h3>
          <p>Профили ещё не загружены из релиза Zapret. Нажмите кнопку ниже — NEXUS найдёт их в установленном модуле.</p>
        </div>
      </div>
      <div className="expert-actions">
        <button type="button" className="primary-button small" disabled={scanning} onClick={() => void scanStrategies()}>
          <b>{scanning ? 'Поиск…' : 'Найти профили'}</b>
        </button>
      </div>
      <p className="dpi-host-hint">Если профили не найдены, откройте «Модули» и нажмите «Проверить обновления».</p>
    </section>}

    {strategies.length > 0 && <section className="module-settings-card">
      <div className="module-settings-card-head">
        <div>
          <h3>Профиль обхода</h3>
          <p>Если какой-то сайт не открывается, попробуйте другой профиль. По умолчанию используется {DEFAULT_STRATEGY}.</p>
        </div>
        <span className="module-settings-count">{strategies.length}</span>
      </div>
      <div className="strategy-select-row">
        <StrategySelect
          options={strategies}
          value={activeStrategy}
          disabled={isRunning}
          onSelect={(strategy) => onStrategyChange(module, strategy)}
        />
      </div>
      {isRunning
        ? <p className="dpi-host-hint">Остановите модуль, чтобы сменить профиль.</p>
        : <p className="dpi-host-hint">Профили загружаются из релиза Zapret — доступны все, что в нём есть.</p>}
      <div className="expert-actions">
        <button type="button" className="quiet-button" disabled={scanning || isRunning} onClick={() => void scanStrategies()}>
          {scanning ? 'Поиск…' : 'Обновить список профилей'}
        </button>
      </div>
    </section>}

    {module.id === 'tg-ws-proxy' && <TgProxySection module={module} onToast={onToast} />}

    {module.id === 'zapret' && <DpiExpertSection module={module} onToast={onToast} />}

    {module.id !== 'zapret' && !strategies.length && <div className="empty-state">
      <span>⚙</span>
      <h3>Настроек пока нет</h3>
      <p>У этого модуля нет параметров — он работает сразу после запуска.</p>
    </div>}
  </section>;
}
