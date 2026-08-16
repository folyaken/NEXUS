import { spawn, ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { ModuleHealthcheck, ModuleLog, ModuleManifest, ModuleStatus, ModuleStatusReport } from './types';
import { buildDpiExtraArgs, normalizeDpiExpertOptions } from './dpi-arguments';
import { elevationMessage, isElevated, moduleNeedsElevation } from './elevation';
import { expandDpiHosts } from './dpi-companions';
import { buildTgProxyArgs, normalizeTgProxyOptions, readTgProxyOptions } from './tg-proxy-options';
import { readDpiHostlist, syncDpiHostlistInto } from './dpi-hostlist';
import { tgWsProxyAssetCandidates } from './platform-assets';
import { buildZapretLaunch, ensureZapretUserLists } from './zapret-profile';
import { listPidsByImage, waitForExit } from './process-watch';
import { sanitizeDiagnosticText } from './vpn-diagnostics';

type ManagedProcess = ChildProcess & { moduleId?: string };

const TG_WS_PROXY_ID = 'tg-ws-proxy';
const WORKER_BY_ID: Record<string, string> = {
  zapret: process.platform === 'win32' ? 'winws.exe' : 'winws',
};
const TG_WS_DESCRIPTION = 'Возвращает доступ к Telegram, когда он заблокирован.';
const TG_WS_HEALTHCHECK: ModuleHealthcheck = { type: 'tcp', host: '127.0.0.1', port: 8080, timeout_ms: 15000 };

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Порядок модулей в интерфейсе.
 *
 * Готовые к работе идут первыми, недоделанные — в конец списка. Иначе человек
 * первым делом видит то, что включить нельзя, и решает, что программа не
 * работает. Внутри каждой группы порядок задан явно: сначала обход блокировок,
 * затем доступ к Telegram — ими пользуются чаще всего.
 */
const MODULE_DISPLAY_ORDER: readonly string[] = ['zapret', TG_WS_PROXY_ID];

function compareModulesForDisplay(left: ModuleManifest, right: ModuleManifest): number {
  const leftReady = left.development ? 1 : 0;
  const rightReady = right.development ? 1 : 0;
  if (leftReady !== rightReady) return leftReady - rightReady;

  const leftRank = MODULE_DISPLAY_ORDER.indexOf(left.id);
  const rightRank = MODULE_DISPLAY_ORDER.indexOf(right.id);
  const leftPlace = leftRank < 0 ? MODULE_DISPLAY_ORDER.length : leftRank;
  const rightPlace = rightRank < 0 ? MODULE_DISPLAY_ORDER.length : rightRank;
  if (leftPlace !== rightPlace) return leftPlace - rightPlace;

  return left.name.localeCompare(right.name, 'ru');
}

export class ModuleManager extends EventEmitter {
  private readonly modules = new Map<string, ModuleManifest>();
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly workerPids = new Map<string, number>();
  private readonly workerMisses = new Map<string, number>();
  private readonly logs = new Map<string, ModuleLog[]>();
  private readonly watchers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly updatesInProgress = new Set<string>();
  private readonly upstreamLogLines = new Map<string, Set<string>>();
  private lastScanAt: string | null = null;

  /**
   * Поиск уже запущенных «чужих» процессов модуля по имени образа.
   *
   * Вынесен в поле, чтобы тесты могли подставить детерминированную заглушку:
   * иначе прогон зависит от того, что реально работает на машине, и, например,
   * запущенный TgWsProxy.exe валит обновление с «Остановите модуль перед обновлением».
   */
  private discoverPids: (imageName: string) => Promise<number[]> = listPidsByImage;

  constructor(private readonly modulesDir: string) { super(); }

  /** Только для тестов: подменяет сканер процессов операционной системы. */
  setProcessScanner(scanner: (imageName: string) => Promise<number[]>): void {
    this.discoverPids = scanner;
  }

  async init(): Promise<void> { await this.reload(); }

  getModulesDir(): string { return this.modulesDir; }
  getLastScanAt(): string | null { return this.lastScanAt; }
  isRunning(id: string): boolean { return this.processes.has(id) || this.workerPids.has(id); }
  isUpdating(id: string): boolean { return this.updatesInProgress.has(id); }

  async hasRunningProcess(id: string): Promise<boolean> {
    if (this.isRunning(id)) return true;
    const module = this.modules.get(id);
    return module ? Boolean(await this.discoverWorker(module)) : false;
  }

  beginUpdate(id: string): () => void {
    if (this.isRunning(id)) throw new Error('Остановите модуль перед обновлением');
    if (this.updatesInProgress.has(id)) throw new Error('Обновление этого модуля уже выполняется');
    this.updatesInProgress.add(id);
    return () => this.updatesInProgress.delete(id);
  }

  async reload(): Promise<ModuleManifest[]> {
    if (!existsSync(this.modulesDir)) mkdirSync(this.modulesDir, { recursive: true });
    const entries = await fs.readdir(this.modulesDir, { withFileTypes: true });
    const manifests: ModuleManifest[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.module.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.modulesDir, entry.name), 'utf8');
        const parsed = JSON.parse(raw) as Partial<ModuleManifest>;
        const manifest = this.normalize(parsed, entry.name);
        manifests.push(manifest);
        this.modules.set(manifest.id, manifest);
        if (!this.logs.has(manifest.id)) this.logs.set(manifest.id, []);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
        this.emitLog('system', 'error', `Не удалось загрузить ${entry.name}: ${message}`);
      }
    }
    for (const id of [...this.modules.keys()]) {
      if (!manifests.some((module) => module.id === id) && !this.isRunning(id)) this.modules.delete(id);
    }
    this.lastScanAt = new Date().toISOString();
    this.emit('changed', this.list());
    this.emit('scan', this.lastScanAt);
    this.emitLog('system', 'success', `Сканирование завершено: найдено модулей — ${manifests.length}`);
    return this.list();
  }

  list(): ModuleManifest[] {
    return [...this.modules.values()]
      .filter((module) => module.id !== 'jey2ray')
      .map((module) => ({
        ...module,
        args: [...module.args],
        strategies: module.strategies ? { ...module.strategies } : undefined,
        healthcheck: module.healthcheck ? { ...module.healthcheck } : undefined,
      }))
      .sort(compareModulesForDisplay);
  }

  getLogs(id?: string): ModuleLog[] {
    if (id) return [...(this.logs.get(id) ?? [])];
    return [...this.logs.values()].flat().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async startEnabled(): Promise<void> {
    for (const module of this.modules.values()) {
      if (!module.enabled || module.development || module.id === 'jey2ray') continue;
      if (this.isRunning(module.id)) continue;
      try {
        await this.start(module.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Ошибка автозапуска';
        this.emitLog(module.id, 'error', `Автозапуск: ${message}`);
      }
    }
  }

  async setStrategy(id: string, strategy: string): Promise<ModuleManifest> {
    const module = this.modules.get(id);
    if (!module) throw new Error('Модуль не найден');
    if (!module.strategies && id !== 'zapret') throw new Error('У этого модуля нет профилей запуска');
    if (this.isRunning(id)) throw new Error('Сначала остановите модуль');
    if (this.isUpdating(id)) throw new Error('Дождитесь завершения обновления модуля');

    const strategyFile = await this.findFile(this.modulesDir, `${strategy}.bat`);
    const strategies = { ...(module.strategies ?? {}) };
    if (strategyFile) strategies[strategy] = `./${path.relative(this.modulesDir, strategyFile).split(path.sep).join('/')}`;
    module.strategy = strategy;
    module.launch_mode = 'batch';
    module.strategies = strategies;
    await this.persistModule(module);
    this.emit('changed', this.list());
    this.emitLog(id, 'info', `Выбрана стратегия: ${strategy}`);
    return module;
  }

  /**
   * Сохраняет экспертные аргументы модуля и, если он работал, перезапускает его.
   *
   * Аргументы читаются только при старте процесса, поэтому без перезапуска
   * изменения выглядели бы применёнными, но фактически не действовали.
   */
  async setExtraArgs(id: string, options: unknown): Promise<ModuleManifest> {
    const module = this.modules.get(id);
    if (!module) throw new Error('Модуль не найден');
    if (this.isUpdating(id)) throw new Error('Дождитесь завершения обновления модуля');

    const extraArgs = buildDpiExtraArgs(normalizeDpiExpertOptions(options));
    const wasRunning = this.isRunning(id);
    if (wasRunning) await this.stop(id, { persistEnabled: true });

    module.extra_args = extraArgs;
    await this.persistModule(module);
    this.emit('changed', this.list());
    this.emitLog(id, 'info', extraArgs.length
      ? `Экспертные параметры сохранены: ${extraArgs.join(' ')}`
      : 'Экспертные параметры очищены');

    if (wasRunning) {
      await this.start(id);
      this.emitLog(id, 'info', 'Модуль перезапущен с новыми параметрами');
    }
    return this.modules.get(id) ?? module;
  }

  /**
   * Сохраняет основные параметры TG WS Proxy и перезапускает модуль при необходимости.
   *
   * Порт обновляется сразу в трёх местах: аргументах запуска, healthcheck и
   * конфигурации самого прокси. Рассинхронизация любого из них означала бы, что
   * процесс слушает один порт, а NEXUS проверяет другой.
   */
  async setTgProxyOptions(id: string, options: unknown): Promise<ModuleManifest> {
    const module = this.modules.get(id);
    if (!module) throw new Error('Модуль не найден');
    if (this.isUpdating(id)) throw new Error('Дождитесь завершения обновления модуля');

    const normalized = normalizeTgProxyOptions(options);
    const wasRunning = this.isRunning(id);

    // Занятый порт выявляется до остановки рабочего процесса, иначе пользователь
    // остался бы без работающего прокси из-за неудачной настройки.
    const portChanged = readTgProxyOptions(module).port !== normalized.port;
    if (portChanged && await this.isTcpOpen('127.0.0.1', normalized.port, 350)) {
      throw new Error(`Порт ${normalized.port} уже занят другим приложением. Выберите свободный порт.`);
    }

    if (wasRunning) await this.stop(id, { persistEnabled: true });

    module.args = buildTgProxyArgs(normalized);
    module.healthcheck = { ...(module.healthcheck ?? { type: 'tcp', timeout_ms: 15000 }), type: 'tcp', host: '127.0.0.1', port: normalized.port };
    await this.persistModule(module);
    this.emit('changed', this.list());
    this.emitLog(id, 'info', `Параметры сохранены · порт ${normalized.port} · режим ${normalized.mode === 'universal' ? 'все запросы' : 'только Telegram'}`);

    if (wasRunning) {
      await this.start(id);
      this.emitLog(id, 'info', 'Модуль перезапущен с новыми параметрами');
    }
    return this.modules.get(id) ?? module;
  }

  /**
   * Применяет изменённый список сайтов к работающему модулю.
   *
   * Zapret читает домены только при старте, поэтому без перезапуска добавленный
   * сайт продолжал бы блокироваться, хотя в списке уже значился.
   */
  async reapplyDpiHosts(id: string): Promise<boolean> {
    const module = this.modules.get(id);
    if (!module || id !== 'zapret') return false;
    if (this.isUpdating(id) || !this.isRunning(id)) return false;

    await this.stop(id, { persistEnabled: true });
    await this.start(id);
    this.emitLog(id, 'info', 'Модуль перезапущен — новый список сайтов активен');
    return true;
  }

  /** Фактическое состояние модуля: процесс, PID и доступность порта. */
  async checkStatus(id: string): Promise<ModuleStatusReport> {
    const module = this.modules.get(id);
    if (!module) throw new Error('Модуль не найден');

    const host = module.healthcheck?.host ?? '127.0.0.1';
    const port = module.healthcheck?.port ?? readTgProxyOptions(module).port;
    const pid = this.processes.get(id)?.pid ?? this.workerPids.get(id) ?? await this.discoverWorker(module);
    const running = Boolean(pid);
    const portListening = await this.isTcpOpen(host, port, 700);

    const summary = running && portListening
      ? 'Модуль работает и принимает подключения'
      : running
        ? 'Процесс запущен, но порт не отвечает'
        : portListening
          ? 'Порт занят другим приложением'
          : 'Модуль остановлен';

    return {
      id,
      running,
      pid: pid ?? null,
      host,
      port,
      portListening,
      checkedAt: new Date().toISOString(),
      summary,
    };
  }

  /**
   * Пересобирает список профилей из уже установленного релиза.
   *
   * Раньше профили записывались только в момент установки Zapret, поэтому у
   * пользователей с ранее скачанным релизом список оставался пустым (или содержал
   * три устаревшие записи), и секция выбора профиля не появлялась вовсе.
   */
  async refreshStrategies(id: string): Promise<ModuleManifest> {
    const module = this.modules.get(id);
    if (!module) throw new Error('Модуль не найден');
    if (this.isUpdating(id)) throw new Error('Дождитесь завершения обновления модуля');

    const searchRoot = module.working_dir ? this.resolvePath(module.working_dir) : path.join(this.modulesDir, 'bin');
    const discovered = await this.findBatchProfiles(searchRoot);
    if (!discovered.length) {
      throw new Error('Профили не найдены. Нажмите «Проверить обновления» и дождитесь загрузки модуля.');
    }

    const strategies: Record<string, string> = {};
    for (const file of discovered) {
      strategies[path.basename(file, '.bat')] = `./${path.relative(this.modulesDir, file).split(path.sep).join('/')}`;
    }

    module.strategies = strategies;
    module.launch_mode = 'batch';
    if (!module.strategy || !strategies[module.strategy]) {
      module.strategy = strategies['general (ALT10)'] ? 'general (ALT10)' : Object.keys(strategies)[0];
    }
    await this.persistModule(module);
    this.emit('changed', this.list());
    this.emitLog(id, 'success', `Найдено профилей запуска: ${Object.keys(strategies).length}`);
    return module;
  }

  /** Профили запуска (.bat) внутри установленного релиза, без служебных скриптов. */
  private async findBatchProfiles(root: string): Promise<string[]> {
    const found: string[] = [];
    const skip = /^(?:service|check_?updates?|cleanup|diagnos|install|remove|uninstall|stop|kill|update|preset|blockcheck)/i;

    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 5 || found.length >= 64) return;
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'ru'))) {
        if (entry.name === '.cache' || entry.name === 'logs') continue;
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(candidate, depth + 1);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bat') && !skip.test(entry.name)) found.push(candidate);
      }
    };

    await walk(root, 0);
    return found;
  }

  async start(id: string): Promise<ModuleManifest> {
    const module = this.modules.get(id);
    if (!module) throw new Error('Модуль не найден');
    if (id === 'jey2ray') throw new Error('Jey2Ray управляется во вкладке Jey2Ray: добавьте ссылку и нажмите «Подключить».');
    if (module.development) throw new Error(`${module.name}: интеграция ещё находится в разработке`);
    if (this.isUpdating(id)) throw new Error('Дождитесь завершения обновления модуля');
    // Проверка до запуска: иначе процесс стартует и сразу падает с невнятной
    // ошибкой драйвера, из которой пользователю неясно, чего не хватило.
    if (moduleNeedsElevation(id) && !(await isElevated())) {
      const message = elevationMessage(module.name);
      this.failModule(module, message);
      throw new Error(message);
    }
    if (this.isRunning(id)) return module;

    const existingWorker = await this.discoverWorker(module);
    if (existingWorker) {
      if (module.healthcheck) {
        try {
          await this.waitForTcpHealth(module, module.healthcheck);
        } catch {
          const message = `${module.name} уже запущен (PID ${existingWorker}), но локальный сервис не подтвердил готовность. Закройте этот процесс и повторите запуск.`;
          this.failModule(module, message);
          throw new Error(message);
        }
      }
      this.workerPids.set(id, existingWorker);
      module.enabled = true;
      await this.persistModule(module);
      this.setStatus(module, 'running', existingWorker);
      this.watchWorker(module);
      this.emitLog(id, 'success', `Подключён уже запущенный процесс · PID ${existingWorker}`);
      return module;
    }

    let executable: string;
    let args: string[] = [...module.args];
    let cwd: string;
    // Ядро запускается напрямую, без командного файла-посредника: тогда
    // созданный процесс и есть рабочий, а не лаунчер, который сразу завершится.
    let directWorkerLaunch = false;

    if (module.launch_mode === 'batch') {
      const strategy = module.strategy ?? Object.keys(module.strategies ?? {})[0] ?? 'general (ALT10)';
      let strategyValue = module.strategies?.[strategy];
      if (!strategyValue) {
        const discovered = await this.findFile(this.modulesDir, `${strategy}.bat`);
        if (discovered) {
          strategyValue = `./${path.relative(this.modulesDir, discovered).split(path.sep).join('/')}`;
          module.strategies = { ...(module.strategies ?? {}), [strategy]: strategyValue };
          module.strategy = strategy;
        }
      }
      const batchFile = strategyValue ? this.resolvePath(strategyValue) : '';
      if (!batchFile || !existsSync(batchFile)) {
        const message = `Стратегия ${strategy}.bat не найдена. Нажмите «Проверить GitHub» и дождитесь загрузки Zapret.`;
        this.failModule(module, message);
        throw new Error(message);
      }
      const releaseRoot = module.working_dir ? this.resolvePath(module.working_dir) : path.dirname(batchFile);
      if (id === 'zapret') {
        // Списки, которые обычно создаёт service.bat. Ядро запускается напрямую,
        // поэтому позаботиться о них должно приложение.
        await ensureZapretUserLists(releaseRoot);
        await this.applyCustomDpiHosts(module, batchFile);
      }

      // Основной путь: строка запуска читается из профиля и передаётся ядру
      // массивом аргументов. Командный интерпретатор в цепочке не участвует,
      // поэтому перенос строки через `^` больше ничего сломать не может —
      // именно он приводил к ошибке «'--filter-udp' is not recognized».
      const direct = await buildZapretLaunch(batchFile, releaseRoot, module.extra_args ?? []);
      if (direct) {
        executable = direct.executable;
        args = direct.args;
        cwd = direct.cwd;
        directWorkerLaunch = true;
        this.emitLog(id, 'info', `Запуск стратегии ${strategy}: ${path.basename(direct.executable)} · параметров — ${direct.args.length}`);
      } else {
        // Запасной путь для профилей необычного вида: как раньше, через
        // интерпретатор. Он менее надёжен, поэтому используется только когда
        // разобрать профиль не удалось.
        const runnerFile = await this.createBatchRunner(id, batchFile, module.extra_args);
        executable = process.env.ComSpec ?? 'cmd.exe';
        args = ['/d', '/c', 'call', runnerFile];
        cwd = releaseRoot;
        this.emitLog(id, 'warn', `Профиль ${path.basename(batchFile)} имеет нестандартный вид — запуск через командный файл`);
      }
    } else {
      executable = this.resolvePath(module.executable);
      if (!existsSync(executable)) {
        const fallbackNames = id === 'zapret' ? ['winws.exe'] : id === TG_WS_PROXY_ID ? tgWsProxyAssetCandidates() : [];
        for (const fallbackName of fallbackNames) {
          const discovered = await this.findFile(this.modulesDir, fallbackName);
          if (!discovered) continue;
          executable = discovered;
          module.executable = `./${path.relative(this.modulesDir, discovered).split(path.sep).join('/')}`;
          if (id === TG_WS_PROXY_ID) module.worker_name = path.basename(discovered);
          await this.persistModule(module);
          this.emitLog(id, 'info', `Найден бинарник в modules: ${module.executable}`);
          break;
        }
      }
      const detectedBinRoot = path.basename(path.dirname(executable)).toLowerCase() === 'bin' ? path.dirname(path.dirname(executable)) : path.dirname(executable);
      cwd = module.working_dir ? this.resolvePath(module.working_dir) : detectedBinRoot;
      this.emitLog(id, 'info', `Запуск: ${module.executable} ${module.args.join(' ')}`);
      if (!existsSync(executable)) {
        const message = `Исполняемый файл не найден: ${executable}. Нажмите «Проверить GitHub» и дождитесь загрузки модуля.`;
        this.failModule(module, message);
        throw new Error(message);
      }

      if (id === TG_WS_PROXY_ID && module.healthcheck && await this.isTcpOpen(module.healthcheck.host, module.healthcheck.port, 350)) {
        const message = `Порт ${module.healthcheck.host}:${module.healthcheck.port} уже занят другим приложением. Закройте другой локальный прокси и повторите запуск.`;
        this.failModule(module, message);
        throw new Error(message);
      }
    }

    let runtimeTempDirectory: string | undefined;
    if (id === TG_WS_PROXY_ID) {
      try {
        await this.prepareTgWsProxy(executable, module);
        if (process.platform === 'win32') {
          const runtimeRoot = path.join(os.tmpdir(), 'NEXUS-TgWsProxy');
          await fs.mkdir(runtimeRoot, { recursive: true });
          runtimeTempDirectory = await fs.mkdtemp(path.join(runtimeRoot, 'run-'));
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'неизвестная ошибка';
        const message = `Не удалось подготовить переносимый профиль TG WS Proxy: ${detail}`;
        this.failModule(module, message);
        throw new Error(message);
      }
    }

    this.setStatus(module, 'starting', null);
    const logPath = this.resolvePath(module.log_file);
    mkdirSync(path.dirname(logPath), { recursive: true });
    this.rotateLogIfNeeded(logPath);
    const logStream = createWriteStream(logPath, { flags: 'a' });
    let logClosed = false;
    const closeLog = () => {
      if (logClosed) return;
      logClosed = true;
      logStream.end();
    };
    const childEnvironment = runtimeTempDirectory
      ? { ...process.env, TEMP: runtimeTempDirectory, TMP: runtimeTempDirectory }
      : process.env;
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnvironment,
    }) as ManagedProcess;
    child.moduleId = id;
    this.processes.set(id, child);

    const write = (chunk: Buffer, level: 'info' | 'error') => {
      const text = chunk.toString().trim();
      if (!text) return;
      logStream.write(`[${new Date().toISOString()}] ${text}\n`);
      text.split(/\r?\n/).forEach((line) => this.emitLog(id, level, line));
    };
    child.stdout?.on('data', (chunk: Buffer) => write(chunk, 'info'));
    child.stderr?.on('data', (chunk: Buffer) => write(chunk, 'error'));

    let startupComplete = false;
    let startupAborted = false;
    const batchStartup = { error: null as Error | null };
    let rejectStartup: (error: Error) => void = () => undefined;
    const startupFailure = new Promise<never>((_resolve, reject) => { rejectStartup = reject; });

    child.once('error', (error) => {
      this.processes.delete(id);
      this.clearWatch(id);
      closeLog();
      if (runtimeTempDirectory) void fs.rm(runtimeTempDirectory, { recursive: true, force: true }).catch(() => undefined);
      if (startupAborted) return;
      const message = this.spawnFailureMessage(module, error);
      if (!startupComplete) {
        if (module.launch_mode === 'batch') batchStartup.error = new Error(message);
        else rejectStartup(new Error(message));
        return;
      }
      this.failModule(module, message);
    });
    child.once('exit', (code, signal) => {
      this.processes.delete(id);
      closeLog();
      if (runtimeTempDirectory) void fs.rm(runtimeTempDirectory, { recursive: true, force: true }).catch(() => undefined);
      if (startupAborted) return;
      if (!startupComplete) {
        if (module.launch_mode === 'batch' && (code !== 0 || signal)) {
          batchStartup.error = new Error(this.exitFailureMessage(module, code, signal));
        } else if (module.launch_mode !== 'batch') {
          rejectStartup(new Error(this.exitFailureMessage(module, code, signal)));
        }
        return;
      }
      void this.onLauncherExit(module, code, signal);
    });

    if (module.launch_mode !== 'batch') {
      try {
        const readiness = module.healthcheck
          ? this.waitForTcpHealth(module, module.healthcheck)
          : delay(750);
        await Promise.race([readiness, startupFailure]);
        await Promise.race([delay(175), startupFailure]);
        if (child.exitCode !== null) throw new Error(this.exitFailureMessage(module, child.exitCode, child.signalCode));
        startupComplete = true;
      } catch (error) {
        startupAborted = true;
        startupComplete = true;
        this.processes.delete(id);
        this.clearWatch(id);
        if (child.exitCode === null && child.pid) {
          await this.killTree(child.pid);
          await waitForExit(child, 4000);
        }
        closeLog();
        if (runtimeTempDirectory) await fs.rm(runtimeTempDirectory, { recursive: true, force: true }).catch(() => undefined);
        const message = error instanceof Error ? error.message : 'Модуль не подтвердил готовность';
        module.enabled = false;
        await this.persistModule(module);
        this.failModule(module, message);
        await this.emitUpstreamLogTail(module, 'error');
        throw new Error(message);
      }
    } else {
      // При прямом запуске созданный процесс и есть ядро: искать его в списке
      // задач незачем, достаточно убедиться, что он не завершился сразу.
      let worker: number | null = null;
      if (directWorkerLaunch) {
        for (let attempt = 0; attempt < 8 && !batchStartup.error; attempt += 1) {
          await delay(200);
          if (child.exitCode !== null) break;
        }
        if (child.exitCode === null && child.pid) worker = child.pid;
      } else {
        // Командный файл — лишь лаунчер: активным модуль считается только
        // после появления настоящего winws.exe.
        for (let attempt = 0; attempt < 15 && !worker && !batchStartup.error; attempt += 1) {
          worker = await this.discoverWorker(module);
          if (!worker) await delay(200);
        }
      }
      if (!worker) {
        startupAborted = true;
        startupComplete = true;
        this.processes.delete(id);
        if (child.exitCode === null && child.pid) {
          await this.killTree(child.pid);
          await waitForExit(child, 4000);
        }
        closeLog();
        const message = batchStartup.error?.message
          ?? `${module.name}: лаунчер запущен, но рабочий процесс не появился.`;
        module.enabled = false;
        await this.persistModule(module);
        this.failModule(module, message);
        throw new Error(message);
      }
      this.workerPids.set(id, worker);
      startupComplete = true;
    }

    module.enabled = true;
    await this.persistModule(module);
    const activePid = module.launch_mode === 'batch' ? (this.workerPids.get(id) ?? child.pid ?? null) : (child.pid ?? null);
    this.setStatus(module, 'running', activePid);
    this.emitLog(id, 'success', `Модуль активен · PID ${activePid ?? '—'}`);
    if (module.launch_mode === 'batch') this.watchWorker(module);
    await this.emitUpstreamLogTail(module, 'info');
    return module;
  }

  async stop(id: string, options: { persistEnabled?: boolean } = {}): Promise<ModuleManifest> {
    const module = this.modules.get(id);
    if (!module) throw new Error('Модуль не найден');
    const child = this.processes.get(id);
    const workerPid = this.workerPids.get(id);
    if (!child && !workerPid) {
      if (options.persistEnabled !== false) {
        module.enabled = false;
        await this.persistModule(module);
      }
      this.setStatus(module, 'stopped', null);
      return module;
    }
    this.setStatus(module, 'stopping', workerPid ?? child?.pid ?? null);
    this.emitLog(id, 'info', 'Остановка модуля…');
    this.clearWatch(id);
    const targets = [...new Set([workerPid, child?.pid].filter((pid): pid is number => Boolean(pid)))];
    for (const pid of targets) await this.killTree(pid);
    if (child) await waitForExit(child, 8000);
    this.processes.delete(id);
    this.workerPids.delete(id);
    if (options.persistEnabled !== false) {
      module.enabled = false;
      await this.persistModule(module);
    }
    this.setStatus(module, 'stopped', null);
    this.emitLog(id, 'info', 'Модуль остановлен');
    return module;
  }

  async stopAll(options: { persistEnabled?: boolean } = {}): Promise<void> {
    const ids = new Set([...this.processes.keys(), ...this.workerPids.keys()]);
    await Promise.all([...ids].map((id) => this.stop(id, options).catch(() => undefined)));
  }

  private async onLauncherExit(module: ModuleManifest, code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (module.status === 'stopping') {
      this.workerPids.delete(module.id);
      this.clearWatch(module.id);
      this.setStatus(module, 'stopped', null);
      return;
    }
    if (module.launch_mode === 'batch') {
      let worker: number | null = null;
      for (let attempt = 0; attempt < 4 && !worker; attempt += 1) {
        worker = await this.discoverWorker(module);
        if (!worker) await delay(200);
      }
      if (worker) {
        this.workerPids.set(module.id, worker);
        this.setStatus(module, 'running', worker);
        this.emitLog(module.id, 'info', `Лаунчер завершился, рабочий процесс PID ${worker}`);
        this.watchWorker(module);
        return;
      }
    }
    this.workerPids.delete(module.id);
    this.clearWatch(module.id);
    module.enabled = false;
    await this.persistModule(module);
    const failed = signal !== null || (code !== null && code !== 0);
    const message = failed ? this.exitFailureMessage(module, code, signal) : undefined;
    if (message) module.error = message;
    this.setStatus(module, failed ? 'error' : 'stopped', null);
    this.emitLog(module.id, failed ? 'error' : 'info', message ?? `Процесс завершён (${this.formatExitDetails(code, signal)})`);
    await this.emitUpstreamLogTail(module, failed ? 'error' : 'info');
  }

  private watchWorker(module: ModuleManifest): void {
    this.clearWatch(module.id);
    const timer = setInterval(() => { void this.refreshWorker(module); }, 2000);
    this.watchers.set(module.id, timer);
    void this.refreshWorker(module);
  }

  private async refreshWorker(module: ModuleManifest): Promise<void> {
    const pid = await this.discoverWorker(module);
    if (pid) {
      this.workerMisses.delete(module.id);
      if (this.workerPids.get(module.id) !== pid || module.pid !== pid) {
        this.workerPids.set(module.id, pid);
        if (module.status !== 'stopping') this.setStatus(module, 'running', pid);
      }
      return;
    }
    if (this.processes.has(module.id)) return;
    const misses = (this.workerMisses.get(module.id) ?? 0) + 1;
    this.workerMisses.set(module.id, misses);
    if (misses < 3) return;
    this.workerPids.delete(module.id);
    this.clearWatch(module.id);
    if (module.status === 'running') {
      module.enabled = false;
      await this.persistModule(module);
      module.error = 'Рабочий процесс завершился';
      this.setStatus(module, 'error', null);
      this.emitLog(module.id, 'error', module.id === 'zapret' ? 'Рабочий процесс Zapret больше не запущен' : 'Рабочий процесс модуля больше не запущен');
      await this.emitUpstreamLogTail(module, 'error');
    }
  }

  private workerImages(module: ModuleManifest): string[] {
    const images = [module.worker_name, WORKER_BY_ID[module.id]];
    if (module.id === TG_WS_PROXY_ID) images.push(...tgWsProxyAssetCandidates());
    return [...new Set(images.filter((image): image is string => Boolean(image)))];
  }

  private async discoverWorker(module: ModuleManifest): Promise<number | null> {
    const images = this.workerImages(module);
    if (!images.length) return this.workerPids.get(module.id) ?? null;
    for (const image of images) {
      const pids = await this.discoverPids(image);
      if (pids[0]) return pids[0];
    }
    return null;
  }

  private async killTree(pid: number): Promise<void> {
    try {
      if (process.platform === 'win32') {
        await new Promise<void>((resolve) => {
          const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
          killer.once('exit', () => resolve());
          killer.once('error', () => resolve());
          setTimeout(resolve, 4000);
        });
        return;
      }
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }

  private clearWatch(id: string): void {
    const timer = this.watchers.get(id);
    if (timer) clearInterval(timer);
    this.watchers.delete(id);
    this.workerMisses.delete(id);
  }

  private normalize(parsed: Partial<ModuleManifest>, filename: string): ModuleManifest {
    if (!parsed.id || !parsed.name || !parsed.executable) throw new Error(`${filename}: обязательны поля id, name и executable`);
    const runningPid = this.workerPids.get(parsed.id) ?? this.processes.get(parsed.id)?.pid ?? null;
    const isTgWsProxy = parsed.id === TG_WS_PROXY_ID;
    const preferredTgAsset = tgWsProxyAssetCandidates()[0];
    const knownTgNames = new Set([
      'tg-ws-proxy.exe',
      'tgwsproxy_windows.exe',
      'tgwsproxy_windows_7_32bit.exe',
      'tgwsproxy_windows_7_64bit.exe',
      'tgwsproxy_windows_arm64.exe',
      'tgwsproxy_linux_amd64',
    ]);
    const parsedExecutableName = path.basename(parsed.executable).toLowerCase();
    const executable = isTgWsProxy && preferredTgAsset && knownTgNames.has(parsedExecutableName)
      ? `./bin/${preferredTgAsset}`
      : parsed.executable;
    // Порт и режим настраиваются пользователем, поэтому фиксируется только форма
    // проверки, а сами значения читаются из манифеста. Иначе пересканирование
    // возвращало бы модуль на исходный порт и сбрасывало настройки.
    const tgOptions = isTgWsProxy ? readTgProxyOptions({ args: Array.isArray(parsed.args) ? parsed.args.map(String) : [], healthcheck: parsed.healthcheck }) : null;
    const healthcheck = isTgWsProxy
      ? { ...TG_WS_HEALTHCHECK, port: tgOptions?.port ?? TG_WS_HEALTHCHECK.port }
      : this.normalizeHealthcheck(parsed.healthcheck, filename);
    return {
      id: parsed.id,
      name: parsed.name,
      description: isTgWsProxy ? TG_WS_DESCRIPTION : parsed.description ?? 'Локальный сетевой инструмент',
      enabled: Boolean(parsed.enabled),
      executable,
      args: isTgWsProxy && tgOptions ? buildTgProxyArgs(tgOptions) : Array.isArray(parsed.args) ? parsed.args.map(String) : [],
      status: this.isRunning(parsed.id) ? 'running' : 'stopped',
      category: parsed.category ?? 'other',
      icon: parsed.icon ?? '◈',
      pid: runningPid,
      log_file: parsed.log_file ?? `./logs/${parsed.id}.log`,
      working_dir: isTgWsProxy ? './bin' : parsed.working_dir,
      launch_mode: isTgWsProxy ? 'executable' : parsed.launch_mode,
      strategy: parsed.strategy,
      strategies: parsed.strategies,
      error: parsed.error,
      worker_name: isTgWsProxy ? path.basename(executable) : parsed.worker_name,
      healthcheck,
      upstream_log_file: isTgWsProxy ? './bin/TgWsProxy_data/proxy.log' : parsed.upstream_log_file,
      installed_version: parsed.installed_version,
      extra_args: Array.isArray(parsed.extra_args)
        ? parsed.extra_args.filter((value): value is string => typeof value === 'string')
        : undefined,
      development: Boolean(parsed.development ?? (parsed.id === 'dns-guard' || parsed.id === 'exitlag-sdk')),
    };
  }

  private normalizeHealthcheck(value: ModuleManifest['healthcheck'], filename: string): ModuleHealthcheck | undefined {
    if (!value) return undefined;
    if (value.type !== 'tcp' || !['127.0.0.1', 'localhost', '::1'].includes(value.host)) {
      throw new Error(`${filename}: healthcheck поддерживает только локальный TCP-адрес`);
    }
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
      throw new Error(`${filename}: некорректный TCP-порт healthcheck`);
    }
    return {
      type: 'tcp',
      host: value.host,
      port: value.port,
      timeout_ms: Math.min(60000, Math.max(500, Number(value.timeout_ms) || 10000)),
    };
  }

  private setStatus(module: ModuleManifest, status: ModuleStatus, pid: number | null): void {
    module.status = status;
    module.pid = pid;
    if (status === 'starting' || status === 'running' || status === 'stopped') module.error = undefined;
    this.emit('changed', this.list());
    this.emit('state', { ...module, healthcheck: module.healthcheck ? { ...module.healthcheck } : undefined });
  }

  private failModule(module: ModuleManifest, message: string): void {
    module.error = message;
    this.setStatus(module, 'error', null);
    module.error = message;
    this.emitLog(module.id, 'error', message);
  }

  private emitLog(id: string, level: ModuleLog['level'], message: string): void {
    const log: ModuleLog = { id, level, message, timestamp: new Date().toISOString() };
    const current = this.logs.get(id) ?? [];
    this.logs.set(id, [log, ...current].slice(0, 200));
    this.emit('log', log);
  }

  private async persistModule(module: ModuleManifest): Promise<void> {
    const entries = await fs.readdir(this.modulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.module.json')) continue;
      const filePath = path.join(this.modulesDir, entry.name);
      try {
        const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<ModuleManifest>;
        if (raw.id !== module.id) continue;
        const persisted = {
          ...raw,
          description: module.description,
          enabled: module.enabled,
          executable: module.executable,
          args: module.args,
          log_file: module.log_file,
          working_dir: module.working_dir,
          launch_mode: module.launch_mode,
          strategy: module.strategy,
          strategies: module.strategies,
          worker_name: module.worker_name,
          healthcheck: module.healthcheck,
          upstream_log_file: module.upstream_log_file,
          installed_version: module.installed_version,
          extra_args: module.extra_args,
          development: module.development,
        };
        await fs.writeFile(filePath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
        return;
      } catch {
        /* reload will surface malformed manifests separately */
      }
    }
  }

  /**
   * Подмешивает пользовательские домены в списки, которые читает выбранный профиль.
   *
   * Пути внутри .bat записаны через переменные (`%LISTS%list-general.txt`,
   * `%~dp0lists\...`). Раньше разворачивался только `%~dp0`, поэтому имя файла
   * оставалось буквальным `%LISTS%list-general.txt`, не находилось на диске и
   * список молча не применялся — добавленные сайты не работали.
   */
  private async applyCustomDpiHosts(module: ModuleManifest, batchFile: string): Promise<void> {
    try {
      const { hosts } = await readDpiHostlist(this.modulesDir);
      const releaseRoot = module.working_dir ? this.resolvePath(module.working_dir) : path.dirname(batchFile);
      const script = await fs.readFile(batchFile, 'utf8');

      // Значения переменных берутся из самого профиля: у разных стратегий
      // каталоги могут отличаться.
      const variables = new Map<string, string>([['bin', 'bin/'], ['lists', 'lists/']]);
      for (const match of script.matchAll(/set\s+"?([A-Za-z_][A-Za-z0-9_]*)=([^"\r\n]*)"?/g)) {
        const value = match[2].replace(/%~dp0/gi, '').replace(/\\/g, '/').trim();
        if (value) variables.set(match[1].toLowerCase(), value);
      }

      const expand = (raw: string): string | null => {
        let value = raw.replace(/%~dp0/gi, '').replace(/\\/g, '/');
        for (let pass = 0; pass < 4 && value.includes('%'); pass += 1) {
          value = value.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name: string) => variables.get(name.toLowerCase()) ?? whole);
        }
        // Неразвёрнутые переменные означают путь, которого мы не понимаем.
        return value.includes('%') ? null : value.replace(/^\.\//, '');
      };

      const referenced = new Set<string>();
      for (const match of script.matchAll(/--hostlist(?:-auto)?[=\s]+"?([^"\s^]+\.txt)"?/gi)) {
        const resolved = expand(match[1]);
        if (resolved) referenced.add(resolved);
      }

      // Пользовательский список Zapret создаёт специально для таких доменов и не
      // перезаписывает его при обновлении — он и есть приоритетная цель записи.
      const userList = [...referenced].find((item) => /list-general-user\.txt$/i.test(item));
      const targets = userList ? [userList] : [...referenced];
      if (!targets.length) targets.push('lists/list-general-user.txt');

      // В файл уходит расширенный набор: сайты часто отдают контент с отдельных
      // доменов (cdninstagram.com, sndcdn.com), которые поддоменами не являются
      // и автоматикой ядра не покрываются. В интерфейсе список остаётся коротким.
      const expanded = expandDpiHosts(hosts);

      let updated = 0;
      const applied: string[] = [];
      for (const relative of targets) {
        const target = path.resolve(releaseRoot, relative);
        // Защита от выхода за пределы установленного релиза.
        if (!target.startsWith(path.resolve(releaseRoot))) continue;
        // Файл может отсутствовать до первого запуска service.bat — создаём сами,
        // иначе домены снова остались бы неприменёнными.
        if (await syncDpiHostlistInto(target, expanded, { create: true })) {
          updated += 1;
          applied.push(path.basename(target));
        }
      }

      if (!hosts.length) return;
      if (updated) {
        const extra = expanded.length - hosts.length;
        const suffix = extra > 0 ? ` (+${extra} связанных)` : '';
        this.emitLog(module.id, 'success', `Свои сайты применены: ${hosts.length}${suffix} → ${applied.join(', ')}`);
      } else {
        this.emitLog(module.id, 'warn', 'Не удалось найти список доменов Zapret — свои сайты не применены');
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'неизвестная ошибка';
      this.emitLog(module.id, 'warn', `Не удалось применить список своих сайтов: ${reason}`);
    }
  }

  private async createBatchRunner(id: string, batchFile: string, extraArgs: string[] = []): Promise<string> {
    const cacheDir = path.join(this.modulesDir, '.cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const runnerFile = path.join(cacheDir, `nexus-${id}-runner.cmd`);

    // Профили Zapret не принимают параметры: они собирают строку запуска
    // winws.exe сами. Передача аргументов в `call` приводила к тому, что cmd
    // пытался выполнить их как отдельные команды — отсюда ошибка
    // «'--filter-udp' is not recognized as an internal or external command».
    // Экспертные параметры применяются через переменную окружения, которую
    // читает обёртка ниже.
    const safeArgs = extraArgs
      .filter((value) => typeof value === 'string' && /^--[a-z0-9][a-z0-9-]*(?:=[A-Za-z0-9_,.:+/@-]*)?$/i.test(value))
      .slice(0, 32);

    const lines = ['@echo off', 'chcp 65001 >nul'];
    if (safeArgs.length) {
      // Значение попадает в GameFilter* только внутри профиля, поэтому здесь
      // оно лишь объявляется: сам .bat решает, как его использовать.
      lines.push(`set "NEXUS_EXTRA_ARGS=${safeArgs.join(' ')}"`);
    }
    lines.push(`call "${batchFile}"`, '');

    // Строгие CRLF: перенос строки в .cmd с продолжением через ^ ломается на
    // одиночном LF, и cmd разрывает команду пополам.
    await fs.writeFile(runnerFile, lines.join('\r\n'), 'utf8');
    return runnerFile;
  }

  private rotateLogIfNeeded(logPath: string): void {
    try {
      if (!existsSync(logPath)) return;
      if (statSync(logPath).size < 5 * 1024 * 1024) return;
      renameSync(logPath, `${logPath}.${Date.now()}.bak`);
    } catch {
      /* keep writing to the current file */
    }
  }

  private resolvePath(value: string): string {
    if (path.isAbsolute(value)) return value;
    return path.resolve(this.modulesDir, value.replace(/^\.\//, ''));
  }

  private async findFile(root: string, filename: string): Promise<string | null> {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (entry.name === '.cache' || entry.name === 'TgWsProxy_data' || entry.name === 'logs') continue;
      const candidate = path.join(root, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return candidate;
      if (entry.isDirectory()) {
        const nested = await this.findFile(candidate, filename);
        if (nested) return nested;
      }
    }
    return null;
  }

  private async prepareTgWsProxy(executable: string, module: ModuleManifest): Promise<void> {
    const dataDirectory = path.join(path.dirname(executable), 'TgWsProxy_data');
    const configPath = path.join(dataDirectory, 'config.json');
    await fs.mkdir(dataDirectory, { recursive: true });
    if (!existsSync(configPath) && process.platform === 'win32' && process.env.APPDATA) {
      const standardDirectory = path.join(process.env.APPDATA, 'TgWsProxy');
      try {
        for (const entry of await fs.readdir(standardDirectory, { withFileTypes: true })) {
          if (!entry.isFile() || /\.log|\.lock$/i.test(entry.name)) continue;
          const destination = path.join(dataDirectory, entry.name);
          if (!existsSync(destination)) await fs.copyFile(path.join(standardDirectory, entry.name), destination);
        }
        if (existsSync(configPath)) this.emitLog(module.id, 'info', 'Существующая конфигурация TG WS Proxy перенесена в переносимый профиль.');
      } catch {
        /* no previous AppData profile */
      }
    }
    let config: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(await fs.readFile(configPath, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed as Record<string, unknown>;
    } catch (error) {
      const candidate = error as NodeJS.ErrnoException;
      if (candidate.code !== 'ENOENT') {
        const backup = `${configPath}.invalid-${Date.now()}`;
        await fs.copyFile(configPath, backup).catch(() => undefined);
        this.emitLog(module.id, 'warn', `Повреждённая конфигурация сохранена как ${path.basename(backup)}; создана новая.`);
      }
    }
    config.host = '127.0.0.1';
    // Порт берётся из настроек модуля: зашитое значение возвращало бы прокси на
    // 1443 при каждом запуске и обесценивало выбор пользователя.
    config.port = readTgProxyOptions(module).port;
    config.check_updates = false;
    config.autostart = false;
    if (typeof config.secret !== 'string' || !/^[a-f0-9]{32}$/i.test(config.secret)) {
      config.secret = randomBytes(16).toString('hex');
    }
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') await fs.chmod(configPath, 0o600).catch(() => undefined);
    this.emitLog(module.id, 'info', 'Подготовлен переносимый профиль; обновления TG WS Proxy управляются NEXUS.');
  }

  private async waitForTcpHealth(module: ModuleManifest, healthcheck: ModuleHealthcheck): Promise<void> {
    const timeout = Math.min(60000, Math.max(500, healthcheck.timeout_ms ?? 10000));
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.isTcpOpen(healthcheck.host, healthcheck.port, 350)) {
        this.emitLog(module.id, 'success', `Проверка готовности пройдена: ${healthcheck.host}:${healthcheck.port} принимает подключения.`);
        return;
      }
      await delay(225);
    }
    if (module.id === TG_WS_PROXY_ID) {
      throw new Error(`TG WS Proxy запущен, но не открыл локальный порт ${healthcheck.host}:${healthcheck.port} за ${Math.ceil(timeout / 1000)} с. Закройте другой экземпляр TG WS Proxy и повторите запуск.`);
    }
    throw new Error(`${module.name} не подтвердил готовность: порт ${healthcheck.host}:${healthcheck.port} не открылся.`);
  }

  private async isTcpOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  private spawnFailureMessage(module: ModuleManifest, error: Error): string {
    const candidate = error as NodeJS.ErrnoException;
    if (candidate.code === 'EACCES' || candidate.code === 'EPERM') {
      return `Windows заблокировал запуск ${module.name}. Проверьте карантин Защитника Windows и разрешите файл в папке modules\\bin.`;
    }
    if (candidate.code === 'ENOENT') return `Исполняемый файл ${module.name} больше не доступен. Повторите проверку обновлений.`;
    return `Не удалось запустить ${module.name}: ${error.message}`;
  }

  private exitFailureMessage(module: ModuleManifest, code: number | null, signal: NodeJS.Signals | null): string {
    const unsigned = code === null ? null : code >>> 0;
    if (module.id === TG_WS_PROXY_ID && unsigned === 0xffffffff) {
      return 'TG WS Proxy не смог запуститься (код Windows −1 / 0xFFFFFFFF). NEXUS использует совместимую сборку и отдельный временный каталог; если ошибка повторяется, проверьте карантин Защитника Windows и разрешите файл в modules\\bin.';
    }
    return `${module.name}: процесс завершился до подтверждения готовности (${this.formatExitDetails(code, signal)}).`;
  }

  private formatExitDetails(code: number | null, signal: NodeJS.Signals | null): string {
    if (code === null) return `код —, сигнал ${signal ?? '—'}`;
    const unsigned = code >>> 0;
    const signed = unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
    const codeLabel = unsigned > 0x7fffffff
      ? `${signed} / 0x${unsigned.toString(16).toUpperCase().padStart(8, '0')}`
      : String(code);
    return `код ${codeLabel}, сигнал ${signal ?? '—'}`;
  }

  private async emitUpstreamLogTail(module: ModuleManifest, level: 'info' | 'error'): Promise<void> {
    if (!module.upstream_log_file) return;
    try {
      const source = await fs.readFile(this.resolvePath(module.upstream_log_file), 'utf8');
      const emitted = this.upstreamLogLines.get(module.id) ?? new Set<string>();
      const lines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/\bConfig:\s*/i.test(line))
        .slice(-16);
      for (const rawLine of lines) {
        const safeLine = sanitizeDiagnosticText(rawLine
          .replace(/tg:\/\/proxy\?\S+/gi, 'tg://proxy?[скрыто]')
          .replace(/\b[a-f0-9]{32,}\b/gi, '[скрыто]'));
        if (emitted.has(safeLine)) continue;
        emitted.add(safeLine);
        this.emitLog(module.id, level, `[proxy.log] ${safeLine}`);
      }
      if (emitted.size > 100) {
        const recent = [...emitted].slice(-60);
        this.upstreamLogLines.set(module.id, new Set(recent));
      } else {
        this.upstreamLogLines.set(module.id, emitted);
      }
    } catch {
      /* PyInstaller may fail before the upstream logger is initialized. */
    }
  }
}
