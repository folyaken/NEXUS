import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createServer, Socket } from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createProfileFromLink, isSubscriptionUrl } from './share-link';
import { fetchSubscriptionMaterial } from './subscription';
import { canConnect, enrichProfile, isServiceNode, looksLikeHost } from './vpn-classify';
import { applyGeo } from './vpn-geo';
import { buildXrayConfig } from './xray-config';
import { buildSingboxConfig } from './singbox-config';
import { clearSystemProxy, setSystemProxy } from './system-proxy';

import type { ModuleLog, VpnProfile, VpnRuntime, VpnStatus, VpnSubscriptionInfo } from './types';
import { waitForExit } from './process-watch';

function looksHuman(name: string): boolean {
  return Boolean(name.trim()) && !looksLikeHost(name);
}

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
