import { EventEmitter } from 'node:events';
import type { NexusUpdateCheck, NexusUpdateStatus } from './types';

/**
 * Обновление самого приложения.
 *
 * Исходный код лежит в приватном репозитории, поэтому встроенный провайдер
 * `github` не подходит: для приватных репозиториев electron-updater требует
 * положить токен GitHub внутрь установщика. Любой пользователь может распаковать
 * asar и прочитать его, получив доступ ко всем репозиториям аккаунта.
 *
 * Вместо этого используется провайдер `generic`: сборки выкладываются на
 * публичный адрес (объектное хранилище или отдельный репозиторий только с
 * релизами), а исходники остаются закрытыми. Токен в установщик не попадает.
 *
 * Пока адрес публикации не задан, обновление отключается штатно: приложение
 * продолжает работать, а интерфейс честно сообщает, что канал не настроен.
 */

/** Минимальная часть electron-updater, которая нам нужна. */
interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  logger: unknown;
  setFeedURL(options: { provider: 'generic'; url: string; channel?: string }): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

type UpdateInfoLike = {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string | { note?: string }[] | null;
};

type ProgressLike = { percent?: number; transferred?: number; total?: number };

function plainReleaseNotes(notes: UpdateInfoLike['releaseNotes']): string | null {
  if (!notes) return null;
  const text = Array.isArray(notes)
    ? notes.map((item) => (typeof item === 'string' ? item : item?.note ?? '')).join('\n')
    : String(notes);
  // Примечания приходят из сети и попадают в интерфейс: разметку и управляющие
  // символы вырезаем, длину ограничиваем.
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600) || null;
}

/** Адрес публикации сборок. Задаётся при сборке, в исходниках его нет. */
export function updateFeedUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.NEXUS_UPDATE_URL ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    // Только HTTPS: по открытому HTTP канал обновления можно подменить и
    // подсунуть пользователю чужой установщик.
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export class AppUpdater extends EventEmitter {
  private state: NexusUpdateCheck;
  private updater: AutoUpdaterLike | null = null;
  private checking = false;

  constructor(
    private readonly currentVersion: string,
    private readonly isPackaged: boolean,
    private readonly feedUrl: string | null = updateFeedUrl(),
  ) {
    super();
    this.state = {
      status: 'idle',
      currentVersion,
      latestVersion: null,
      canInstall: false,
      checkedAt: new Date().toISOString(),
      message: 'Нажмите «Проверить», чтобы узнать о новой версии.',
    };
  }

  snapshot(): NexusUpdateCheck {
    return { ...this.state };
  }

  private setState(status: NexusUpdateStatus, patch: Partial<NexusUpdateCheck> = {}): NexusUpdateCheck {
    this.state = { ...this.state, status, checkedAt: new Date().toISOString(), ...patch };
    this.emit('changed', this.snapshot());
    return this.snapshot();
  }

  /** Причина, по которой обновление недоступно, либо null. */
  private unavailableReason(): string | null {
    if (!this.isPackaged) {
      return 'Обновление работает только в установленной версии. Сейчас приложение запущено из исходников.';
    }
    if (!this.feedUrl) {
      return 'Канал обновлений не настроен в этой сборке.';
    }
    return null;
  }

  private loadUpdater(): AutoUpdaterLike | null {
    if (this.updater) return this.updater;
    try {
      // Загружается по требованию: модуль тянет зависимости и в среде разработки
      // без канала обновлений он не нужен вовсе.
      const { autoUpdater } = require('electron-updater') as { autoUpdater: AutoUpdaterLike };
      autoUpdater.autoDownload = false;          // решение о загрузке принимает пользователь
      autoUpdater.autoInstallOnAppQuit = false;  // VPN и модули нужно останавливать штатно
      autoUpdater.allowPrerelease = false;
      autoUpdater.setFeedURL({ provider: 'generic', url: this.feedUrl as string });

      autoUpdater.on('download-progress', (...args: never[]) => {
        const progress = args[0] as ProgressLike | undefined;
        const percent = Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)));
        this.setState('downloading', {
          percent,
          downloadedBytes: progress?.transferred,
          totalBytes: progress?.total,
          message: `Загрузка обновления — ${percent}%`,
        });
      });

      autoUpdater.on('error', (...args: never[]) => {
        const error = args[0] as Error | undefined;
        this.setState('error', { message: this.userFacingError(error) });
      });

      this.updater = autoUpdater;
      return autoUpdater;
    } catch {
      return null;
    }
  }

  private userFacingError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|fetch failed|net::/i.test(message)) {
      return 'Сервер обновлений недоступен. Проверьте подключение к интернету и повторите попытку.';
    }
    if (/404/.test(message)) {
      return 'На сервере обновлений нет сведений о новой версии.';
    }
    if (/signature|sha512|checksum/i.test(message)) {
      return 'Проверка подлинности обновления не пройдена. Файл повреждён или подменён — установка отменена.';
    }
    if (/EPERM|EACCES/i.test(message)) {
      return 'Недостаточно прав для установки обновления. Запустите NEXUS от имени администратора.';
    }
    return 'Не удалось проверить обновления. Повторите попытку позже.';
  }

  async check(): Promise<NexusUpdateCheck> {
    const unavailable = this.unavailableReason();
    if (unavailable) return this.setState('disabled', { message: unavailable, canInstall: false });
    // Повторное нажатие не должно запускать вторую проверку параллельно.
    if (this.checking) return this.snapshot();

    const updater = this.loadUpdater();
    if (!updater) {
      return this.setState('disabled', { message: 'Компонент обновления недоступен в этой сборке.' });
    }

    this.checking = true;
    this.setState('checking', { message: 'Проверяем наличие новой версии…' });
    try {
      const result = await updater.checkForUpdates() as { updateInfo?: UpdateInfoLike } | null;
      const info = result?.updateInfo;
      const latestVersion = typeof info?.version === 'string' ? info.version : null;

      if (!latestVersion || latestVersion === this.currentVersion) {
        return this.setState('up-to-date', {
          latestVersion,
          canInstall: false,
          message: `Установлена последняя версия ${this.currentVersion}.`,
        });
      }

      return this.setState('available', {
        latestVersion,
        canInstall: false,
        releaseNotes: plainReleaseNotes(info?.releaseNotes),
        releaseDate: typeof info?.releaseDate === 'string' ? info.releaseDate : null,
        message: `Доступна версия ${latestVersion}. Нажмите «Скачать», чтобы загрузить обновление.`,
      });
    } catch (error) {
      return this.setState('error', { message: this.userFacingError(error) });
    } finally {
      this.checking = false;
    }
  }

  async download(): Promise<NexusUpdateCheck> {
    if (this.state.status !== 'available' && this.state.status !== 'error') return this.snapshot();
    const updater = this.loadUpdater();
    if (!updater) return this.setState('disabled', { message: 'Компонент обновления недоступен в этой сборке.' });

    this.setState('downloading', { percent: 0, message: 'Загрузка обновления…' });
    try {
      await updater.downloadUpdate();
      return this.setState('downloaded', {
        canInstall: true,
        percent: 100,
        message: 'Обновление загружено. Оно установится при перезапуске NEXUS.',
      });
    } catch (error) {
      return this.setState('error', { canInstall: false, message: this.userFacingError(error) });
    }
  }

  /**
   * Устанавливает загруженное обновление.
   *
   * Перед перезапуском обязательно остановить VPN и модули: иначе после
   * установки в системе останутся запущенные winws.exe и изменённый системный
   * прокси, а пользователь потеряет сеть.
   */
  async install(beforeQuit: () => Promise<void>): Promise<NexusUpdateCheck> {
    if (!this.state.canInstall) return this.snapshot();
    const updater = this.loadUpdater();
    if (!updater) return this.snapshot();

    try {
      await beforeQuit();
    } catch {
      // Даже если остановить что-то не удалось, установку продолжаем:
      // прерывать её на этом шаге хуже, чем оставить процесс.
    }
    updater.quitAndInstall(false, true);
    return this.snapshot();
  }
}
