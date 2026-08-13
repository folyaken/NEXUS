import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { ModuleLog, ModuleManifest, ModuleStatus } from './types';

type ManagedProcess = ChildProcess & { moduleId?: string };

export class ModuleManager extends EventEmitter {
  private readonly modules = new Map<string, ModuleManifest>();
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly logs = new Map<string, ModuleLog[]>();

  constructor(private readonly modulesDir: string) { super(); }

  async init(): Promise<void> { await this.reload(); }

  getModulesDir(): string { return this.modulesDir; }
  isRunning(id: string): boolean { return this.processes.has(id); }

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
      if (!manifests.some((module) => module.id === id) && !this.processes.has(id)) this.modules.delete(id);
    }
    this.emit('changed', this.list());
    this.emitLog('system', 'success', `Сканирование завершено: найдено модулей — ${manifests.length}`);
    return this.list();
  }

  list(): ModuleManifest[] {
    return [...this.modules.values()].map((module) => ({
      ...module,
      args: [...module.args],
      strategies: module.strategies ? { ...module.strategies } : undefined,
    }));
  }

  getLogs(id?: string): ModuleLog[] {
    if (id) return [...(this.logs.get(id) ?? [])];
    return [...this.logs.values()].flat().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async setStrategy(id: string, strategy: string): Promise<ModuleManifest> {
    const module = this.modules.get(id);
    if (!module) throw new Error('Модуль не найден');
    if (id !== 'zapret') throw new Error('Стратегии доступны только для Zapret');
    if (this.isRunning(id)) throw new Error('Сначала остановите модуль');

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

  async start(id: string): Promise<ModuleManifest> {
    const module = this.modules.get(id);
    if (!module) throw new Error('Модуль не найден');
    if (this.processes.has(id)) return module;

    let executable: string;
    let args: string[] = [...module.args];
    let cwd: string;

    if (module.launch_mode === 'batch') {
      const strategy = module.strategy ?? 'general (ALT10)';
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
        module.error = message;
        this.setStatus(module, 'error', null);
        this.emitLog(id, 'error', message);
        throw new Error(message);
      }
      const runnerFile = await this.createBatchRunner(id, batchFile);
      executable = process.env.ComSpec ?? 'cmd.exe';
      // Use CALL as a separate cmd argument. Embedding quotes into the argument
      // creates doubled quotes on Windows (""C:\\...""), which makes cmd exit with code 1.
      args = ['/d', '/c', 'call', runnerFile];
      cwd = module.working_dir ? this.resolvePath(module.working_dir) : path.dirname(batchFile);
      this.emitLog(id, 'info', `Запуск стратегии ${strategy} через ${path.basename(batchFile)}`);
    } else {
      executable = this.resolvePath(module.executable);
      if (!existsSync(executable)) {
        const fallbackName = id === 'zapret' ? 'winws.exe' : id === 'tg-ws-proxy' ? (process.platform === 'win32' ? 'TgWsProxy_windows.exe' : 'TgWsProxy_linux_amd64') : null;
        const discovered = fallbackName ? await this.findFile(this.modulesDir, fallbackName) : null;
        if (discovered) {
          executable = discovered;
          module.executable = `./${path.relative(this.modulesDir, discovered).split(path.sep).join('/')}`;
          this.emitLog(id, 'info', `Найден бинарник в modules: ${module.executable}`);
        }
      }
      const detectedBinRoot = path.basename(path.dirname(executable)).toLowerCase() === 'bin' ? path.dirname(path.dirname(executable)) : path.dirname(executable);
      cwd = module.working_dir ? this.resolvePath(module.working_dir) : detectedBinRoot;
      this.emitLog(id, 'info', `Запуск: ${module.executable} ${module.args.join(' ')}`);
      if (!existsSync(executable)) {
        const message = `Исполняемый файл не найден: ${executable}. Нажмите «Проверить GitHub» или положите бинарник в modules/bin.`;
        module.error = message;
        this.setStatus(module, 'error', null);
        this.emitLog(id, 'error', message);
        throw new Error(message);
      }
    }

    this.setStatus(module, 'starting', null);
    const logPath = this.resolvePath(module.log_file);
    mkdirSync(path.dirname(logPath), { recursive: true });
    const logStream = createWriteStream(logPath, { flags: 'a' });
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }) as ManagedProcess;
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
    child.once('error', (error) => {
      this.processes.delete(id);
      logStream.end();
      module.error = error.message;
      this.setStatus(module, 'error', null);
      this.emitLog(id, 'error', error.message);
    });
    child.once('exit', (code, signal) => {
      this.processes.delete(id);
      logStream.end();
      const failed = code !== null && code !== 0;
      if (failed) module.error = `Процесс завершён с кодом ${code ?? '—'}`;
      this.setStatus(module, failed ? 'error' : 'stopped', null);
      this.emitLog(id, failed ? 'error' : 'info', `Процесс завершён (code=${code ?? '—'}, signal=${signal ?? '—'})`);
    });

    this.setStatus(module, 'running', child.pid ?? null);
    this.emitLog(id, 'success', `Модуль активен · PID ${child.pid ?? '—'}`);
    return module;
  }

  async stop(id: string): Promise<ModuleManifest> {
    const module = this.modules.get(id);
    if (!module) throw new Error('Модуль не найден');
    const child = this.processes.get(id);
    if (!child || !child.pid) { this.setStatus(module, 'stopped', null); return module; }
    this.setStatus(module, 'stopping', child.pid);
    this.emitLog(id, 'info', 'Остановка модуля…');
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    else child.kill('SIGTERM');
    return module;
  }

  private normalize(parsed: Partial<ModuleManifest>, filename: string): ModuleManifest {
    if (!parsed.id || !parsed.name || !parsed.executable) throw new Error(`${filename}: обязательны поля id, name и executable`);
    return {
      id: parsed.id,
      name: parsed.name,
      description: parsed.description ?? 'Локальный сетевой инструмент',
      enabled: Boolean(parsed.enabled),
      executable: parsed.executable,
      args: Array.isArray(parsed.args) ? parsed.args.map(String) : [],
      status: this.processes.has(parsed.id) ? 'running' : 'stopped',
      category: parsed.category ?? 'other',
      icon: parsed.icon ?? '◈',
      pid: this.processes.get(parsed.id)?.pid ?? null,
      log_file: parsed.log_file ?? `./logs/${parsed.id}.log`,
      working_dir: parsed.working_dir,
      launch_mode: parsed.launch_mode,
      strategy: parsed.strategy,
      strategies: parsed.strategies,
      error: parsed.error,
      development: Boolean(parsed.development ?? (parsed.id === 'dns-guard' || parsed.id === 'exitlag-sdk')),
    };
  }

  private setStatus(module: ModuleManifest, status: ModuleStatus, pid: number | null): void {
    module.status = status;
    module.pid = pid;
    if (status === 'starting' || status === 'running' || status === 'stopped') module.error = undefined;
    this.emit('changed', this.list());
    this.emit('state', { ...module });
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
        await fs.writeFile(filePath, `${JSON.stringify({ ...raw, strategy: module.strategy, launch_mode: module.launch_mode, strategies: module.strategies }, null, 2)}\n`, 'utf8');
        return;
      } catch { /* reload will surface malformed manifests separately */ }
    }
  }

  private async createBatchRunner(id: string, batchFile: string): Promise<string> {
    const cacheDir = path.join(this.modulesDir, '.cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const runnerFile = path.join(cacheDir, `nexus-${id}-runner.cmd`);
    // timeout.exe refuses redirected stdin. The runner is intentionally headless,
    // so use ping as a stdin-independent keep-alive delay instead.
    const content = ['@echo off', 'chcp 65001 >nul', `call "${batchFile}"`, ':nexus_keepalive', 'ping 127.0.0.1 -n 3 >nul', 'goto nexus_keepalive', ''].join('\r\n');
    await fs.writeFile(runnerFile, content, 'utf8');
    return runnerFile;
  }

  private resolvePath(value: string): string {
    if (path.isAbsolute(value)) return value;
    return path.resolve(this.modulesDir, value.replace(/^\.\//, ''));
  }

  private async findFile(root: string, filename: string): Promise<string | null> {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.cache') continue;
      const candidate = path.join(root, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return candidate;
      if (entry.isDirectory()) {
        const nested = await this.findFile(candidate, filename);
        if (nested) return nested;
      }
    }
    return null;
  }
}
