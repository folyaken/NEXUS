import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RunningApp } from '../main/running-apps';
import type { VpnSplitApp } from '../main/types';
import { t } from '../main/i18n';

/**
 * Выбор приложений для правил маршрутизации.
 *
 * Раньше был единственный способ — искать .exe в проводнике: нужно помнить,
 * куда установлена программа, и опознать её среди системных файлов. Здесь
 * добавлен привычный путь: список уже открытых программ со значками, где
 * нужное находится взглядом. Выбор файлом остался для программ, которые
 * сейчас закрыты.
 */

interface Props {
  /** Уже добавленные программы: их нельзя выбрать повторно. */
  selected: VpnSplitApp[];
  onClose: () => void;
  onConfirm: (apps: VpnSplitApp[]) => void;
  /** Выбор файлом через проводник Windows. */
  onBrowse: () => void;
}

type LoadState = 'loading' | 'ready' | 'empty' | 'unavailable';

export default function AppPicker({ selected, onClose, onConfirm, onBrowse }: Props) {
  const [apps, setApps] = useState<RunningApp[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const alreadyAdded = useMemo(
    () => new Set(selected.map((app) => app.executable.toLocaleLowerCase('en-US'))),
    [selected],
  );

  const load = async () => {
    setState('loading');
    try {
      const list = await window.nexus?.listRunningApps();
      if (!list) {
        setState('unavailable');
        return;
      }
      setApps(list);
      setState(list.length ? 'ready' : 'empty');
    } catch {
      setState('unavailable');
    }
  };

  useEffect(() => {
    void load();
    // Поиск получает фокус сразу: чаще всего нужное ищут набором имени.
    const timer = setTimeout(() => searchRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, []);

  // Escape закрывает окно, Tab не выпускает фокус за его пределы: иначе
  // клавиатурой можно уйти на элементы под затемнением.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru');
    if (!needle) return apps;
    return apps.filter((app) => app.title.toLocaleLowerCase('ru').includes(needle)
      || app.executable.toLocaleLowerCase('ru').includes(needle)
      || app.path.toLocaleLowerCase('ru').includes(needle));
  }, [apps, query]);

  const toggle = (app: RunningApp) => {
    if (alreadyAdded.has(app.executable.toLocaleLowerCase('en-US'))) return;
    setPicked((current) => {
      const next = new Set(current);
      const key = app.path.toLowerCase();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const confirm = () => {
    const chosen = apps
      .filter((app) => picked.has(app.path.toLowerCase()))
      .map((app) => ({ executable: app.executable, path: app.path }));
    if (!chosen.length) return;
    onConfirm(chosen);
  };

  return <div className="app-picker-backdrop" role="presentation" onPointerDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div className="app-picker" role="dialog" aria-modal="true" aria-labelledby="app-picker-title" ref={dialogRef}>
      <header className="app-picker-head">
        <div>
          <h3 id="app-picker-title">{t('Выберите приложение')}</h3>
          <p>{t('Отметьте программы из списка открытых или укажите файл вручную.')}</p>
        </div>
        <button type="button" className="app-picker-close" onClick={onClose} aria-label={t('Закрыть')}>
          <svg viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </header>

      <div className="app-picker-search">
        <svg viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5L14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        <input
          ref={searchRef}
          type="text"
          value={query}
          placeholder={t('Поиск по названию или пути…')}
          aria-label={t('Поиск приложения')}
          onChange={(event) => setQuery(event.target.value.slice(0, 120))}
        />
        {query && <button type="button" className="app-picker-search-clear" onClick={() => setQuery('')} aria-label={t('Очистить поиск')}>×</button>}
      </div>

      <div className="app-picker-body">
        {state === 'loading' && <div className="app-picker-state">
          <span className="app-picker-spinner" aria-hidden />
          <strong>{t('Читаем список открытых программ…')}</strong>
          <p>{t('Это занимает несколько секунд.')}</p>
        </div>}

        {state === 'unavailable' && <div className="app-picker-state">
          <strong>{t('Список открытых программ недоступен')}</strong>
          <p>Такое бывает, если Windows ограничила доступ к сведениям о процессах. Добавьте программу файлом — результат будет тот же.</p>
          <button type="button" className="app-picker-secondary" onClick={onBrowse}>{t('Выбрать файл…')}</button>
        </div>}

        {state === 'empty' && <div className="app-picker-state">
          <strong>{t('Открытых программ не найдено')}</strong>
          <p>Запустите нужную программу и обновите список либо укажите её файл вручную.</p>
          <button type="button" className="app-picker-secondary" onClick={() => void load()}>{t('Обновить список')}</button>
        </div>}

        {state === 'ready' && (visible.length ? <div className="app-picker-list" role="listbox" aria-multiselectable="true">
          {visible.map((app) => {
            const added = alreadyAdded.has(app.executable.toLocaleLowerCase('en-US'));
            const active = picked.has(app.path.toLowerCase());
            return <button
              type="button"
              key={app.path}
              role="option"
              aria-selected={active}
              disabled={added}
              className={`app-picker-row ${active ? 'is-picked' : ''} ${added ? 'is-added' : ''}`}
              onClick={() => toggle(app)}
              title={app.path}
            >
              <span className="app-picker-icon">
                {app.icon
                  ? <img src={app.icon} alt="" aria-hidden />
                  : <svg viewBox="0 0 24 24" aria-hidden><rect x="4" y="3.5" width="16" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 8h8M8 12h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
              </span>
              <span className="app-picker-copy">
                <strong>{app.title}</strong>
                <small>{app.path}</small>
              </span>
              {added
                ? <span className="app-picker-added">{t('Уже добавлено')}</span>
                : <span className="app-picker-check" aria-hidden>
                  <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>}
            </button>;
          })}
        </div> : <div className="app-picker-state">
          <strong>{t('Ничего не найдено')}</strong>
          <p>{t('Попробуйте другое название или добавьте программу файлом.')}</p>
        </div>)}
      </div>

      <footer className="app-picker-foot">
        <button type="button" className="app-picker-secondary" onClick={onBrowse}>
          <svg viewBox="0 0 16 16" aria-hidden><path d="M2 4.5h4l1.2 1.5H14v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          Выбрать файл…
        </button>
        <div className="app-picker-actions">
          {state === 'ready' && <button type="button" className="app-picker-refresh" onClick={() => void load()}>{t('Обновить')}</button>}
          <button type="button" className="app-picker-cancel" onClick={onClose}>{t('Отмена')}</button>
          <button type="button" className="app-picker-confirm" disabled={!picked.size} onClick={confirm}>
            {picked.size ? `Добавить · ${picked.size}` : 'Добавить'}
          </button>
        </div>
      </footer>
    </div>
  </div>;
}
