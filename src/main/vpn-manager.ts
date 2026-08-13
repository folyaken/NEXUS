import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createServer, Socket } from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createProfileFromLink, isSubscriptionUrl } from './share-link';
import { fetchSubscriptionMaterial } from './subscription';
import { canConnect, enrichProfile, isServiceNode, looksLikeHost } from './vpn-classify';

function looksHuman(name: string): boolean {
  return Boolean(name.trim()) && !looksLikeHost(name);
}
import { applyGeo } from './vpn-geo';
import { buildXrayConfig } from './xray-config';
import { buildSingboxConfig } from './singbox-config';
import { clearSystemProxy, setSystemProxy } from './system-proxy';
import type { ModuleLog, VpnProfile, VpnRuntime, VpnStatus, VpnSubscriptionInfo } from './types';
import { waitForExit } from './process-watch';

export class VpnManager extends EventEmitter {
  private profiles = new Map<string, VpnProfile>();
  private child: ChildProcess | null = null;
  private status: VpnStatus = 'disconnected';
  private activeProfileId: string | null = null;
  private pid: number | null = null;
  private error?: string;
  private inboundPort = 10808;
  private hwid = 'NX-LOCAL';
  private subscriptions = new Map<string, VpnSubscriptionInfo>();
  private mode: 'proxy' | 'tun' = 'proxy';

  constructor(private readonly modulesDir: string) {
    super();
  }

  setHwid(value: string): void {
    this.hwid = value || 'NX-LOCAL';
  }

  private vpnRoot(): string { return path.join(this.modulesDir, 'vpn'); }
  private configsDir(): string { return path.join(this.modulesDir, 'configs', 'vpn'); }
  private generatedPath(): string { return path.join(this.configsDir(), 'generated_config.json'); }
  private singboxConfigPath(): string { return path.join(this.configsDir(), 'generated_singbox.json'); }
  private logPath(): string { return path.join(this.modulesDir, 'logs', 'vpn.log'); }

  hasXray(): boolean {
    return existsSync(this.xrayPath());
  }

  xrayPath(): string {
    return this.binPath(process.platform === 'win32' ? 'xray.exe' : 'xray');
  }

  singboxPath(): string {
    return this.binPath(process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');
  }

  private binPath(name: string): string {
    const candidates = [
      path.join(this.modulesDir, 'bin', name),
      path.join(this.vpnRoot(), 'bin', name),
      path.join(process.cwd(), 'modules', 'bin', name),
    ];
    try {
      const { app } = require('electron') as typeof import('electron');
      if (app?.isPackaged) candidates.unshift(path.join(process.resourcesPath, 'modules', 'bin', name));
    } catch { /* not in electron yet */ }
    return candidates.find((item) => existsSync(item)) ?? candidates[0];
  }

  runtime(): VpnRuntime {
    return {
      status: this.status,
      activeProfileId: this.activeProfileId,
      activeName: this.activeProfileId ? this.profiles.get(this.activeProfileId)?.name ?? null : null,
      pid: this.pid,
      inboundPort: this.inboundPort,
      xrayReady: existsSync(this.xrayPath()),
      xrayVersion: null,
      error: this.error,
      subscriptions: [...this.subscriptions.values()],
    };
  }

  list(): VpnProfile[] {
    return [...this.profiles.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async init(): Promise<void> {
    await fs.mkdir(this.configsDir(), { recursive: true });
    await fs.mkdir(path.join(this.vpnRoot(), 'bin'), { recursive: true });
    await fs.mkdir(path.dirname(this.logPath()), { recursive: true });
    const entries = await fs.readdir(this.configsDir(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('generated_') || entry.name === 'subscriptions.json') continue;
      try {
        const profile = enrichProfile(JSON.parse(await fs.readFile(path.join(this.configsDir(), entry.name), 'utf8')) as VpnProfile);
        if (profile.id && profile.shareLink && profile.kind !== 'notice') this.profiles.set(profile.id, profile);
        else if (profile.kind === 'notice') await fs.rm(path.join(this.configsDir(), entry.name), { force: true });
      } catch {
        this.emitLog('warn', `Пропущен повреждённый профиль ${entry.name}`);
      }
    }
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.configsDir(), 'subscriptions.json'), 'utf8')) as VpnSubscriptionInfo[];
      for (const item of raw) if (item.url) this.subscriptions.set(item.url, item);
    } catch { /* first run */ }
    const located = await applyGeo(this.list(), path.join(this.configsDir(), 'geo-cache.json'));
    for (const profile of located) this.profiles.set(profile.id, profile);
    this.emit('changed', this.snapshot());
  }

  snapshot(): { profiles: VpnProfile[]; runtime: VpnRuntime } {
    return { profiles: this.list(), runtime: this.runtime() };
  }

  async importInput(input: string, name?: string): Promise<VpnProfile[]> {
    const raw = input.trim();
    if (isSubscriptionUrl(raw)) return this.importSubscription(raw);
    const profile = enrichProfile(createProfileFromLink(raw, name));
    if (profile.kind === 'notice') {
      this.emitLog('warn', `Служебная ссылка пропущена: ${profile.name}`);
      throw new Error('Это служебное уведомление панели, не сервер. Нужна подписка с HWID или обычная vless-ссылка.');
    }
    await this.saveProfile(profile);
    this.emitLog('success', `Профиль «${profile.name}» сохранён (${profile.protocol} ${profile.server}:${profile.port})`);
    this.emit('changed', this.snapshot());
    return [profile];
  }

  async importLink(link: string, name?: string): Promise<VpnProfile> {
    const [profile] = await this.importInput(link, name);
    return profile;
  }

  async importSubscription(url: string): Promise<VpnProfile[]> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Подписка только по HTTPS');
    this.emitLog('info', `Загрузка подписки ${parsed.host} (HWID ${this.hwid.slice(0, 8)}…)…`);
    const material = await fetchSubscriptionMaterial(url, this.hwid, (message) => this.emitLog('info', message));
    const imported: VpnProfile[] = [];
    const keep = new Set<string>();
    let notices = 0;

    const accept = async (profile: VpnProfile) => {
      profile.subscriptionUrl = url;
      const next = enrichProfile(profile);
      if (next.kind === 'notice' || isServiceNode(next)) {
        notices += 1;
        return;
      }
      await this.saveProfile(next);
      imported.push(next);
      keep.add(next.id);
    };

    for (const profile of material.clash) {
      try { await accept(profile); }
      catch (error) { this.emitLog('warn', `Пропуск clash-узла: ${error instanceof Error ? error.message : 'ошибка'}`); }
    }
    for (const link of material.links) {
      try { await accept(createProfileFromLink(link)); }
      catch (error) { this.emitLog('warn', `Пропуск узла: ${error instanceof Error ? error.message : 'битая ссылка'}`); }
    }

    if (!material.links.length && !material.clash.length) {
      throw new Error('Панель отдала лендинг или формат Happ. Jey2Ray запрашивает как v2rayN/Clash. Вставь полный URL и обнови ещё раз.');
    }
    for (const profile of this.list()) {
      if (profile.subscriptionUrl === url && !keep.has(profile.id) && profile.kind !== 'notice') {
        this.profiles.delete(profile.id);
        await fs.rm(path.join(this.configsDir(), `${profile.id}.json`), { force: true });
      }
    }
    if (!imported.length) {
      throw new Error(notices
        ? `Панель вернула только уведомления (${notices}), без серверов.`
        : 'Ссылки в подписке не удалось разобрать');
    }
    const unique = new Map<string, VpnProfile>();
    for (const profile of imported) {
      const key = `${profile.protocol}|${profile.server}|${profile.port}|${profile.params.network}|${profile.params.security}`;
      const prev = unique.get(key);
      if (!prev || (looksHuman(profile.name) && !looksHuman(prev.name))) unique.set(key, profile);
    }
    imported.length = 0;
    imported.push(...unique.values());
    const located = await applyGeo(imported, path.join(this.configsDir(), 'geo-cache.json'));
    imported.length = 0;
    for (const profile of located) {
      await this.saveProfile(profile);
      imported.push(profile);
      keep.add(profile.id);
    }
    this.subscriptions.set(url, {
      url,
      title: material.info?.title || parsed.host,
      supportUrl: material.info?.supportUrl,
      announce: material.info?.announce,
      description: material.info?.description,
      expireAt: material.info?.expireAt,
      upload: material.info?.upload ?? 0,
      download: material.info?.download ?? 0,
      total: material.info?.total ?? 0,
      updateHours: material.info?.updateHours ?? 1,
      lastSync: new Date().toISOString(),
    });
    await this.persistSubscriptions();
    this.emitLog('success', `Подписка ${parsed.host}: узлов ${imported.length}${notices ? `, служебных скрыто ${notices}` : ''}`);
    this.emit('changed', this.snapshot());
    return imported;
  }

  async pingAll(): Promise<VpnProfile[]> {
    const nodes = this.list().filter((item) => item.kind !== 'notice');
    const queue = [...nodes];
    const workers = Array.from({ length: Math.min(6, queue.length || 1) }, async () => {
      while (queue.length) {
        const profile = queue.shift();
        if (!profile) break;
        const ms = await this.tcpPing(profile.server, profile.port);
        profile.pingMs = ms ?? -1;
        this.profiles.set(profile.id, profile);
        this.emit('changed', this.snapshot());
      }
    });
    await Promise.all(workers);
    this.emitLog('info', 'Тест пинга завершён');
    return this.list();
  }

  private tcpPing(host: string, port: number): Promise<number | null> {
    return new Promise((resolve) => {
      const started = Date.now();
      const socket = new Socket();
      const done = (value: number | null) => {
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(2500);
      socket.once('connect', () => done(Date.now() - started));
      socket.once('timeout', () => done(null));
      socket.once('error', () => done(null));
      socket.connect(port, host);
    });
  }

  async refreshSubscriptions(): Promise<number> {
    const urls = [...new Set(this.list().map((item) => item.subscriptionUrl).filter((item): item is string => Boolean(item)))];
    let total = 0;
    for (const url of urls) total += (await this.importSubscription(url)).length;
    return total;
  }

  private async saveProfile(profile: VpnProfile): Promise<void> {
    const existing = this.profiles.get(profile.id);
    if (existing) profile.createdAt = existing.createdAt;
    this.profiles.set(profile.id, enrichProfile(profile));
    await this.persist(profile);
  }

  async remove(id: string): Promise<void> {
    if (this.activeProfileId === id) await this.disconnect();
    this.profiles.delete(id);
    const file = path.join(this.configsDir(), `${id}.json`);
    await fs.rm(file, { force: true });
    this.emitLog('info', `Профиль ${id} удалён`);
    this.emit('changed', this.snapshot());
  }

  async connect(id: string, preferredPort = 10808, mode: 'proxy' | 'tun' = 'proxy'): Promise<VpnRuntime> {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error('Профиль не найден');
    const blocked = canConnect(profile);
    if (blocked) throw new Error(blocked);
    const useSingbox = profile.protocol === 'hysteria2';
    const engine = useSingbox ? this.singboxPath() : this.xrayPath();
    if (!existsSync(engine)) {
      const message = useSingbox
        ? 'sing-box не найден. Перезапусти npm start — скачается SagerNet/sing-box для Hysteria.'
        : 'Xray-core не найден. Перезапусти npm start — скачается XTLS/Xray-core.';
      this.setState('error', null, null, message);
      throw new Error(message);
    }
    if (this.child) await this.disconnect();

    this.mode = mode;
    this.setState('connecting', id, null);
    const port = await this.pickPort(preferredPort);
    this.inboundPort = port;
    const config = useSingbox ? buildSingboxConfig(profile.params, port) : buildXrayConfig(profile.params, port, mode);
    const configFile = useSingbox ? this.singboxConfigPath() : this.generatedPath();
    await fs.mkdir(this.configsDir(), { recursive: true });
    await fs.writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    mkdirSync(path.dirname(this.logPath()), { recursive: true });
    const logStream = createWriteStream(this.logPath(), { flags: 'a' });
    let lastErr = '';
    const args = useSingbox ? ['run', '-c', configFile] : ['-config', configFile];
    const child = spawn(engine, args, {
      cwd: path.dirname(engine),
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.pid = child.pid ?? null;

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      logStream.write(`[${new Date().toISOString()}] ${text}\n`);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      lastErr = text.slice(-300);
      logStream.write(`[${new Date().toISOString()}] ${text}\n`);
      if (/failed|error|fatal|invalid/i.test(text)) this.emitLog('error', text.slice(0, 240));
    });
    child.once('error', (error) => {
      logStream.end();
      this.child = null;
      this.setState('error', id, null, error.message);
    });
    child.once('exit', (code) => {
      logStream.end();
      this.child = null;
      this.pid = null;
      void clearSystemProxy();
      void fs.rm(this.generatedPath(), { force: true });
      if (this.status === 'connecting' || this.status === 'connected') {
        const failed = code !== 0 && code !== null;
        this.setState(failed ? 'error' : 'disconnected', failed ? id : null, null, failed ? (lastErr || `Xray завершился с кодом ${code}`) : undefined);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (!this.child) {
      const hint = mode === 'tun' ? ' TUN часто требует запуск NEXUS от администратора. Попробуй режим Proxy.' : '';
      throw new Error((this.error || lastErr || 'Xray не запустился') + hint);
    }
    if (mode === 'proxy') {
      try {
        await setSystemProxy('127.0.0.1', port + 1);
        this.emitLog('info', `Системный прокси: 127.0.0.1:${port + 1}`);
      } catch (error) {
        this.emitLog('warn', `Не удалось выставить системный прокси: ${error instanceof Error ? error.message : 'ошибка'}`);
      }
    }
    this.setState('connected', id, child.pid ?? null);
    this.emitLog('success', `Включено: ${profile.name} · ${mode.toUpperCase()} · HTTP 127.0.0.1:${port + 1}`);
    return this.runtime();
  }

  async disconnect(): Promise<VpnRuntime> {
    const child = this.child;
    if (!child?.pid) {
      this.setState('disconnected', null, null);
      return this.runtime();
    }
    this.setState('disconnected', this.activeProfileId, child.pid);
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
      } else {
        child.kill('SIGTERM');
      }
    } catch { /* already gone */ }
    await waitForExit(child, 5000);
    this.child = null;
    this.pid = null;
    await fs.rm(this.generatedPath(), { force: true });
    await fs.rm(this.singboxConfigPath(), { force: true });
    this.setState('disconnected', null, null);
    this.emitLog('info', 'VPN отключён');
    return this.runtime();
  }

  private async pickPort(start: number): Promise<number> {
    for (let port = start; port < start + 20; port += 1) {
      const free = await this.isFree(port);
      if (free) return port;
    }
    throw new Error(`Порт ${start} и следующие 20 заняты. Смените локальный SOCKS-порт в настройках.`);
  }

  private isFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
    });
  }


  private async persistSubscriptions(): Promise<void> {
    await fs.writeFile(path.join(this.configsDir(), 'subscriptions.json'), `${JSON.stringify([...this.subscriptions.values()], null, 2)}\n`, 'utf8');
  }

  private async persist(profile: VpnProfile): Promise<void> {
    await fs.mkdir(this.configsDir(), { recursive: true });
    await fs.writeFile(path.join(this.configsDir(), `${profile.id}.json`), `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  }

  private setState(status: VpnStatus, profileId: string | null, pid: number | null, error?: string): void {
    this.status = status;
    this.activeProfileId = profileId;
    this.pid = pid;
    this.error = error;
    this.emit('changed', this.snapshot());
  }

  private emitLog(level: ModuleLog['level'], message: string): void {
    const log: ModuleLog = { id: 'jey2ray', level, message, timestamp: new Date().toISOString() };
    this.emit('log', log);
  }
}
