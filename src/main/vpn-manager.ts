import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createServer, Socket } from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createProfileFromLink, isSubscriptionUrl } from './share-link';
import { fetchSubscriptionMaterial, validateSubscriptionUrl } from './subscription';
import { canConnect, enrichProfile, isServiceNode, looksLikeHost } from './vpn-classify';
import { profileConnectionKey, profileIdentityKey, profileSourceKey, stableProfileId } from './vpn-identity';
import { applyGeo } from './vpn-geo';
import { buildXrayConfig } from './xray-config';
import { buildSingboxConfig } from './singbox-config';
import { clearSystemProxy, setSystemProxy } from './system-proxy';
import type { ModuleLog, VpnAppRoutingMode, VpnProfile, VpnRuntime, VpnSplitApp, VpnStatus, VpnSubscriptionInfo } from './types';
import { waitForExit } from './process-watch';
import { commitAtomicFileTransaction, recoverAtomicFileTransactions } from './atomic-files';

function looksHuman(name: string): boolean {
  return Boolean(name.trim()) && !looksLikeHost(name);
}

function betterNamedProfile(current: VpnProfile, candidate: VpnProfile): VpnProfile {
  return looksHuman(candidate.name) && !looksHuman(current.name) ? candidate : current;
}

type LoadedProfile = { profile: VpnProfile; filePath: string };

function isSafeProfileId(id: string): boolean {
  if (!/^[a-z0-9_-]{1,64}$/i.test(id)) return false;
  if (/^(?:subscriptions|geo-cache)$/i.test(id) || /^generated_/i.test(id)) return false;
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) return false;
  return true;
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
  private profileMutationQueue: Promise<void> = Promise.resolve();
  private refreshInFlight: Promise<number> | null = null;

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

  async init(preferredProfileId: string | null = null): Promise<void> {
    await fs.mkdir(this.configsDir(), { recursive: true });
    await fs.mkdir(path.join(this.vpnRoot(), 'bin'), { recursive: true });
    await fs.mkdir(path.dirname(this.logPath()), { recursive: true });
    const recoveredTransactions = await recoverAtomicFileTransactions(this.configsDir());
    if (recoveredTransactions) {
      this.emitLog('warn', `Восстановлено незавершённых обновлений подписок: ${recoveredTransactions}`);
    }
    const entries = (await fs.readdir(this.configsDir(), { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const loaded: LoadedProfile[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('generated_') || entry.name === 'subscriptions.json' || entry.name === 'geo-cache.json') continue;
      const filePath = path.join(this.configsDir(), entry.name);
      try {
        const profile = enrichProfile(JSON.parse(await fs.readFile(filePath, 'utf8')) as VpnProfile);
        if (profile.id && profile.shareLink && profile.kind !== 'notice') loaded.push({ profile, filePath });
        else if (profile.kind === 'notice') await fs.rm(filePath, { force: true });
      } catch {
        this.emitLog('warn', `Пропущен повреждённый профиль ${entry.name}`);
      }
    }
    await this.reconcileLoadedProfiles(loaded, preferredProfileId);
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.configsDir(), 'subscriptions.json'), 'utf8')) as VpnSubscriptionInfo[];
      for (const item of raw) if (item.url) this.subscriptions.set(item.url, item);
    } catch { /* first run */ }
    const located = await applyGeo(this.list(), path.join(this.configsDir(), 'geo-cache.json'));
    for (const profile of located) this.profiles.set(profile.id, profile);
    this.emit('changed', this.snapshot());
  }

  private async reconcileLoadedProfiles(loaded: LoadedProfile[], preferredProfileId: string | null): Promise<void> {
    this.profiles.clear();
    const groups = new Map<string, LoadedProfile[]>();
    for (const item of loaded) {
      const identity = profileIdentityKey(item.profile);
      const group = groups.get(identity) ?? [];
      group.push(item);
      groups.set(identity, group);
    }

    const grouped = [...groups.entries()].sort(([, left], [, right]) => {
      const leftPreferred = left.some((item) => item.profile.id === preferredProfileId);
      const rightPreferred = right.some((item) => item.profile.id === preferredProfileId);
      return Number(rightPreferred) - Number(leftPreferred);
    });
    const usedIds = new Set<string>();
    const destinations = new Set<string>();
    let repairedIds = 0;

    for (const [, group] of grouped) {
      let best = group[0];
      for (const candidate of group.slice(1)) {
        if (betterNamedProfile(best.profile, candidate.profile) === candidate.profile) best = candidate;
      }
      const keeper = group.find((item) => item.profile.id === preferredProfileId) ?? best;
      const measured = group.find((item) => typeof item.profile.pingMs === 'number')?.profile.pingMs;
      const profile = enrichProfile({
        ...best.profile,
        id: keeper.profile.id,
        createdAt: keeper.profile.createdAt || best.profile.createdAt,
        pingMs: keeper.profile.pingMs ?? best.profile.pingMs ?? measured,
      });

      if (!isSafeProfileId(profile.id) || usedIds.has(profile.id)) {
        profile.id = this.availableStableId(profile, (candidate) => usedIds.has(candidate));
        repairedIds += 1;
      }
      usedIds.add(profile.id);
      const destination = path.join(this.configsDir(), `${profile.id}.json`);
      await this.persist(profile);
      this.profiles.set(profile.id, profile);
      destinations.add(path.resolve(destination));
    }

    for (const item of loaded) {
      if (!destinations.has(path.resolve(item.filePath))) await fs.rm(item.filePath, { force: true });
    }

    const duplicates = loaded.length - groups.size;
    if (duplicates || repairedIds) {
      this.emitLog('info', `Профили очищены: дубликатов ${duplicates}, конфликтов ID ${repairedIds}`);
    }
  }

  private availableStableId(profile: VpnProfile, occupied: (candidate: string) => boolean): string {
    const base = stableProfileId(profile, profile.subscriptionUrl);
    let candidate = base;
    let suffix = 2;
    while (occupied(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  snapshot(): { profiles: VpnProfile[]; runtime: VpnRuntime } {
    return { profiles: this.list(), runtime: this.runtime() };
  }

  private enqueueProfileMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.profileMutationQueue.then(operation, operation);
    this.profileMutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async importInput(input: string, name?: string): Promise<VpnProfile[]> {
    const raw = input.trim();
    if (isSubscriptionUrl(raw)) return this.importSubscription(raw);
    return this.enqueueProfileMutation(() => this.importProfileInput(raw, name));
  }

  private async importProfileInput(raw: string, name?: string): Promise<VpnProfile[]> {
    const profile = enrichProfile(createProfileFromLink(raw, name));
    if (profile.kind === 'notice') {
      this.emitLog('warn', `Служебная ссылка пропущена: ${profile.name}`);
      throw new Error('Это служебное уведомление панели, не сервер. Нужна подписка с HWID или обычная vless-ссылка.');
    }
    const connection = profileConnectionKey(profile);
    const existing = this.list().find((item) => !item.subscriptionUrl && profileConnectionKey(item) === connection);
    if (existing) {
      profile.id = existing.id;
      profile.createdAt = existing.createdAt;
      profile.pingMs = existing.pingMs;
    } else {
      profile.id = stableProfileId(profile);
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
    return this.enqueueProfileMutation(() => this.importSubscriptionUnlocked(url));
  }

  private async importSubscriptionUnlocked(url: string): Promise<VpnProfile[]> {
    const parsed = validateSubscriptionUrl(url);
    this.emitLog('info', `Загрузка подписки ${parsed.host}…`);
    const material = await fetchSubscriptionMaterial(url, this.hwid, (message) => this.emitLog('info', message));
    const candidates: VpnProfile[] = [];
    let notices = 0;

    const accept = (profile: VpnProfile) => {
      const next = enrichProfile({ ...profile, subscriptionUrl: url });
      if (next.kind === 'notice' || isServiceNode(next)) {
        notices += 1;
        return;
      }
      candidates.push(next);
    };

    for (const profile of material.clash) {
      try { accept(profile); }
      catch (error) { this.emitLog('warn', `Пропуск clash-узла: ${error instanceof Error ? error.message : 'ошибка'}`); }
    }
    for (const link of material.links) {
      try { accept(createProfileFromLink(link)); }
      catch (error) { this.emitLog('warn', `Пропуск узла: ${error instanceof Error ? error.message : 'битая ссылка'}`); }
    }

    if (!material.links.length && !material.clash.length) {
      throw new Error('Панель отдала лендинг или формат Happ. Jey2Ray запрашивает как v2rayN/Clash. Вставь полный URL и обнови ещё раз.');
    }
    if (!candidates.length) {
      throw new Error(notices
        ? `Панель вернула только уведомления (${notices}), без серверов.`
        : 'Ссылки в подписке не удалось разобрать');
    }

    const unique = new Map<string, VpnProfile>();
    for (const profile of candidates) {
      const connection = profileConnectionKey(profile);
      const previous = unique.get(connection);
      unique.set(connection, previous ? betterNamedProfile(previous, profile) : profile);
    }

    const source = profileSourceKey(url);
    const existingProfiles = this.list().filter((profile) => profileSourceKey(profile.subscriptionUrl) === source);
    const existingByConnection = new Map<string, VpnProfile>();
    for (const profile of existingProfiles) {
      const connection = profileConnectionKey(profile);
      const previous = existingByConnection.get(connection);
      if (!previous || profile.id === this.activeProfileId || betterNamedProfile(previous, profile) === profile) {
        existingByConnection.set(connection, profile);
      }
    }

    const prepared: VpnProfile[] = [];
    for (const [connection, profile] of unique) {
      const existing = existingByConnection.get(connection);
      profile.id = existing?.id ?? stableProfileId(profile, url);
      profile.createdAt = existing?.createdAt ?? profile.createdAt;
      profile.pingMs = existing?.pingMs;
      prepared.push(profile);
    }

    const located = await applyGeo(prepared, path.join(this.configsDir(), 'geo-cache.json'));
    const occupied = new Map(this.profiles);
    for (const profile of existingProfiles) {
      if (profile.id !== this.activeProfileId) occupied.delete(profile.id);
    }
    for (const profile of located) {
      const identity = profileIdentityKey(profile);
      const collision = occupied.get(profile.id);
      if (collision && profileIdentityKey(collision) !== identity) {
        profile.id = this.availableStableId(profile, (candidate) => {
          const item = occupied.get(candidate);
          return Boolean(item && profileIdentityKey(item) !== identity);
        });
      }
      occupied.set(profile.id, profile);
    }

    const imported = [...located];
    const keep = new Set(imported.map((profile) => profile.id));
    const nextProfiles = new Map(this.profiles);
    const removals: string[] = [];
    let retainedActive = 0;
    for (const profile of existingProfiles) {
      if (keep.has(profile.id) || profile.kind === 'notice') continue;
      if (profile.id === this.activeProfileId && this.child) {
        retainedActive += 1;
        continue;
      }
      nextProfiles.delete(profile.id);
      removals.push(`${profile.id}.json`);
    }
    for (const profile of imported) nextProfiles.set(profile.id, profile);

    const nextSubscriptions = new Map(this.subscriptions);
    for (const existingUrl of nextSubscriptions.keys()) {
      if (existingUrl !== url && profileSourceKey(existingUrl) === source) nextSubscriptions.delete(existingUrl);
    }
    nextSubscriptions.set(url, {
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

    await commitAtomicFileTransaction(this.configsDir(), {
      writes: [
        ...imported.map((profile) => ({
          name: `${profile.id}.json`,
          content: `${JSON.stringify(profile, null, 2)}\n`,
        })),
        {
          name: 'subscriptions.json',
          content: `${JSON.stringify([...nextSubscriptions.values()], null, 2)}\n`,
        },
      ],
      removals,
    });

    this.profiles = nextProfiles;
    this.subscriptions = nextSubscriptions;
    if (retainedActive) {
      this.emitLog('warn', 'Активный узел исчез из подписки и временно сохранён до следующего обновления после отключения VPN');
    }
    this.emitLog('success', `Подписка ${parsed.host}: узлов ${imported.length}${notices ? `, служебных скрыто ${notices}` : ''}`);
    this.emit('changed', this.snapshot());
    return imported;
  }

  async pingAll(): Promise<VpnProfile[]> {
    return this.enqueueProfileMutation(() => this.pingAllUnlocked());
  }

  private async pingAllUnlocked(): Promise<VpnProfile[]> {
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

  async refreshSubscription(url: string): Promise<number> {
    return (await this.importSubscription(url)).length;
  }

  refreshSubscriptions(): Promise<number> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const task = this.enqueueProfileMutation(() => this.refreshSubscriptionsUnlocked());
    this.refreshInFlight = task;
    void task.then(
      () => { if (this.refreshInFlight === task) this.refreshInFlight = null; },
      () => { if (this.refreshInFlight === task) this.refreshInFlight = null; },
    );
    return task;
  }

  private async refreshSubscriptionsUnlocked(): Promise<number> {
    const urlsBySource = new Map<string, string>();
    const knownUrls = [
      ...this.subscriptions.keys(),
      ...this.list().map((item) => item.subscriptionUrl).filter((item): item is string => Boolean(item)),
    ];
    for (const url of knownUrls) {
      const source = profileSourceKey(url);
      if (!urlsBySource.has(source)) urlsBySource.set(source, url);
    }
    const urls = [...urlsBySource.values()];
    let total = 0;
    let succeeded = 0;
    let failed = 0;
    for (const url of urls) {
      try {
        total += (await this.importSubscriptionUnlocked(url)).length;
        succeeded += 1;
      } catch (error) {
        failed += 1;
        let host = 'неизвестный источник';
        try { host = validateSubscriptionUrl(url).host; } catch { /* malformed legacy URL */ }
        const reason = error instanceof Error ? error.message : 'неизвестная ошибка';
        this.emitLog('warn', `Подписка ${host} не обновлена: ${reason}. Старые профили сохранены.`);
      }
    }
    if (failed && !succeeded) {
      throw new Error(`Не удалось обновить подписки (${failed}). Старые профили сохранены.`);
    }
    if (failed) this.emitLog('warn', `Обновление завершено частично: успешно ${succeeded}, с ошибкой ${failed}`);
    return total;
  }

  private async saveProfile(profile: VpnProfile): Promise<void> {
    const identity = profileIdentityKey(profile);
    let existing = this.profiles.get(profile.id);
    if (existing && profileIdentityKey(existing) !== identity) {
      profile.id = this.availableStableId(profile, (candidate) => {
        const occupied = this.profiles.get(candidate);
        return Boolean(occupied && profileIdentityKey(occupied) !== identity);
      });
      existing = this.profiles.get(profile.id);
    }
    if (existing) profile.createdAt = existing.createdAt;
    const next = enrichProfile(profile);
    Object.assign(profile, next);
    await this.persist(next);
    this.profiles.set(profile.id, next);
  }

  async remove(id: string): Promise<void> {
    return this.enqueueProfileMutation(() => this.removeUnlocked(id));
  }

  private async removeUnlocked(id: string): Promise<void> {
    if (this.activeProfileId === id) await this.disconnect();
    await commitAtomicFileTransaction(this.configsDir(), {
      writes: [],
      removals: [`${id}.json`],
    });
    this.profiles.delete(id);
    this.emitLog('info', `Профиль ${id} удалён`);
    this.emit('changed', this.snapshot());
  }

  async removeSubscription(url: string): Promise<void> {
    return this.enqueueProfileMutation(() => this.removeSubscriptionUnlocked(url));
  }

  private async removeSubscriptionUnlocked(url: string): Promise<void> {
    const parsed = validateSubscriptionUrl(url.trim());
    const source = profileSourceKey(parsed.toString());
    const matchedUrls = [...this.subscriptions.keys()].filter((item) => profileSourceKey(item) === source);
    const matchedProfiles = this.list().filter((profile) => profileSourceKey(profile.subscriptionUrl) === source);
    if (!matchedUrls.length && !matchedProfiles.length) throw new Error('Подписка не найдена');

    if (matchedProfiles.some((profile) => profile.id === this.activeProfileId)) await this.disconnect();

    const nextProfiles = new Map(this.profiles);
    for (const profile of matchedProfiles) nextProfiles.delete(profile.id);
    const nextSubscriptions = new Map(this.subscriptions);
    for (const existingUrl of matchedUrls) nextSubscriptions.delete(existingUrl);

    await commitAtomicFileTransaction(this.configsDir(), {
      writes: [{
        name: 'subscriptions.json',
        content: `${JSON.stringify([...nextSubscriptions.values()], null, 2)}\n`,
      }],
      removals: matchedProfiles.map((profile) => `${profile.id}.json`),
    });

    this.profiles = nextProfiles;
    this.subscriptions = nextSubscriptions;
    this.emitLog('info', `Подписка ${parsed.host} удалена вместе с профилями: ${matchedProfiles.length}`);
    this.emit('changed', this.snapshot());
  }

  async connect(
    id: string,
    preferredPort = 10808,
    mode: 'proxy' | 'tun' = 'proxy',
    splitApps: VpnSplitApp[] = [],
    appRouting: VpnAppRoutingMode = 'include',
  ): Promise<VpnRuntime> {
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
    const activeAppRouting: VpnAppRoutingMode = mode === 'tun' && splitApps.length && appRouting !== 'system'
      ? appRouting
      : 'system';
    const activeSplitApps = activeAppRouting === 'system' ? [] : splitApps;
    const config = useSingbox
      ? buildSingboxConfig(profile.params, port, mode, activeSplitApps, activeAppRouting)
      : buildXrayConfig(profile.params, port, mode, activeSplitApps, activeAppRouting);
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
    const routeMode = activeAppRouting === 'include'
      ? `TUN · через VPN только ${activeSplitApps.length} прилож.`
      : activeAppRouting === 'exclude'
        ? `TUN · напрямую ${activeSplitApps.length} прилож.`
        : mode.toUpperCase();
    this.emitLog('success', `Включено: ${profile.name} · ${routeMode} · HTTP 127.0.0.1:${port + 1}`);
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
      const [socksFree, httpFree] = await Promise.all([
        this.isFree(port),
        this.isFree(port + 1),
      ]);
      if (socksFree && httpFree) return port;
    }
    throw new Error(`Не найдена свободная пара SOCKS/HTTP-портов, начиная с ${start}. Смените локальный SOCKS-порт в настройках.`);
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
