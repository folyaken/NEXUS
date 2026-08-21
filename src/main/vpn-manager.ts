import { EventEmitter } from 'node:events';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createServer, Socket } from 'node:net';
import { connect as connectTls, type TLSSocket } from 'node:tls';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createProfileFromLink, isSubscriptionUrl } from './share-link';
import { fetchSubscriptionMaterial, validateSubscriptionUrl } from './subscription';
import { readSubscriptionUrlFromPage } from './subscription-page';
import { canConnect, enrichProfile, isServiceNode, looksLikeHost } from './vpn-classify';
import { profileConnectionKey, profileIdentityKey, profileSourceKey, stableProfileId } from './vpn-identity';
import { applyGeo } from './vpn-geo';
import { buildXrayConfig } from './xray-config';
import { buildSingboxConfig } from './singbox-config';
import type { RoutingRule } from './routing-rules';
import { inboundListenAddress, lanEndpoints } from './lan-share';
import { clearSystemProxy, setSystemProxy } from './system-proxy';
import { createVpnDiagnostics } from './vpn-diagnostics';
import type { ModuleLog, VpnAppRoutingMode, VpnDiagnosticCheck, VpnDiagnostics, VpnLatencySample, VpnProfile, VpnRuntime, VpnSplitApp, VpnStatus, VpnSubscriptionInfo } from './types';
import { isElevated, tunElevationMessage } from './elevation';
import { describeVpnFailure, parseVpnLogLine, stripAnsi } from './vpn-log';
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
  private connectedAt: string | null = null;
  private pid: number | null = null;
  private error?: string;
  private inboundPort = 10808;
  private hwid = 'NX-LOCAL';
  private subscriptions = new Map<string, VpnSubscriptionInfo>();
  private mode: 'proxy' | 'tun' = 'proxy';
  private allowLan = false;
  private systemProxyConfigured = false;
  private diagnosticEvents: ModuleLog[] = [];
  private profileMutationQueue: Promise<void> = Promise.resolve();
  private subscriptionImportsInFlight = new Map<string, Promise<VpnProfile[]>>();
  private refreshInFlight: Promise<number> | null = null;
  private latencyProbeInFlight: Promise<VpnLatencySample | null> | null = null;
  private lastLatencySample: VpnLatencySample | null = null;
  /** Групповые правила попали в последний собранный конфиг. */
  private lastConfigIncludedGeo = false;
  /**
   * Ядро упало на групповых правилах: следующие подключения идут без них,
   * пока приложение не перезапустят (после обновления ядра).
   */
  private geoRulesForbidden = false;

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

  /**
   * Проверяет наличие драйвера виртуального адаптера для режима TUN.
   *
   * Библиотека wintun.dll обязана лежать рядом с ядром: ядро загружает её при
   * создании адаптера. Возвращает готовое объяснение для пользователя либо
   * null, если всё на месте.
   */
  private missingTunDriver(enginePath: string): string | null {
    const engineDir = path.dirname(enginePath);
    if (existsSync(path.join(engineDir, 'wintun.dll'))) return null;

    // Драйвер мог остаться во вложенной в установщик папке, если приложение
    // работает из другого каталога: переносим, вместо того чтобы отказывать.
    for (const candidate of this.tunDriverCandidates()) {
      if (!existsSync(candidate)) continue;
      try {
        copyFileSync(candidate, path.join(engineDir, 'wintun.dll'));
        this.emitLog('info', 'Драйвер TUN перенесён к ядру.');
        return null;
      } catch {
        // Каталог может быть защищён от записи — пробуем следующий источник.
      }
    }

    return 'Для режима TUN не хватает драйвера сетевого адаптера (wintun.dll). '
      + 'Он не попал в установленную сборку. Проще всего обновить NEXUS до свежей версии '
      + '(«О программе» → «Проверить»). Режим PROXY работает без этого драйвера.';
  }

  /** Места, где может лежать драйвер, кроме папки ядра. */
  private tunDriverCandidates(): string[] {
    const places = [
      path.join(this.modulesDir, 'bin', 'wintun.dll'),
      path.join(this.vpnRoot(), 'bin', 'wintun.dll'),
      path.join(process.cwd(), 'modules', 'bin', 'wintun.dll'),
    ];
    try {
      const { app } = require('electron') as typeof import('electron');
      if (app?.isPackaged) places.unshift(path.join(process.resourcesPath, 'modules', 'bin', 'wintun.dll'));
    } catch { /* вне Electron */ }
    return places;
  }

  /**
   * Есть ли рядом с ядром файлы наборов адресов.
   *
   * Правило вида `geosite:ru` без `geosite.dat` роняет Xray сразу после
   * запуска — с кодом 23 и без внятного объяснения. Проверяем заранее, чтобы
   * отбросить такие правила и сохранить работающее подключение: остальные
   * правила при этом продолжают действовать.
   *
   * Файл считается годным только при ненулевом размере: оборванная загрузка
   * оставляет пустышку, и ядро падает на ней так же, как на отсутствующем.
   */
  hasGeoFiles(): boolean {
    return ['geoip.dat', 'geosite.dat'].every((name) => this.validGeoFile(this.binPath(name)));
  }

  /** Файл существует и не пустышка от оборванной загрузки. */
  private validGeoFile(file: string): boolean {
    if (!existsSync(file)) return false;
    try { return statSync(file).size > 1024; } catch { return false; }
  }

  /** Места, где могут лежать наборы адресов, кроме папки самого ядра. */
  private geoFileCandidates(name: string): string[] {
    const places = [
      path.join(this.modulesDir, 'bin', name),
      path.join(this.vpnRoot(), 'bin', name),
      path.join(process.cwd(), 'modules', 'bin', name),
    ];
    try {
      const { app } = require('electron') as typeof import('electron');
      if (app?.isPackaged) places.unshift(path.join(process.resourcesPath, 'modules', 'bin', name));
    } catch { /* вне Electron */ }
    return places;
  }

  /**
   * Кладёт валидные наборы адресов рядом с ядром, из которого будет запуск.
   *
   * Ядро ищет geosite.dat и geoip.dat в своей рабочей папке. После обновления
   * ядра файлы могут оказаться в другом каталоге (например, докачаться в
   * пользовательскую папку, пока само ядро осталось в папке установки) —
   * тогда hasGeoFiles() видит файлы, правила попадают в конфиг, а ядро падает
   * с кодом 23. Валидная копия переносится к ядру — тем же способом, каким
   * переносится драйвер wintun. Битые копии удаляются, чтобы их не подхватило
   * ни ядро, ни следующая проверка.
   */
  private ensureGeoFilesBesideEngine(enginePath: string): boolean {
    const engineDir = path.dirname(enginePath);
    return ['geoip.dat', 'geosite.dat'].every((name) => {
      const beside = path.join(engineDir, name);
      if (this.validGeoFile(beside)) {
        this.placeGeoAlias(beside);
        return true;
      }
      for (const candidate of this.geoFileCandidates(name)) {
        if (candidate === beside) continue;
        if (!existsSync(candidate)) continue;
        if (!this.validGeoFile(candidate)) {
          // Пустышка от оборванной загрузки: убираем, иначе она так и будет
          // выглядеть «файлом на месте» при следующей проверке.
          try {
            rmSync(candidate, { force: true });
            this.emitLog('warn', `Удалён повреждённый файл ${name} — набор будет загружен заново при проверке обновлений.`);
          } catch { /* нет прав — пропускаем */ }
          continue;
        }
        try {
          mkdirSync(engineDir, { recursive: true });
          copyFileSync(candidate, beside);
          this.placeGeoAlias(beside);
          this.emitLog('info', `${name} перенесён к ядру VPN.`);
          return true;
        } catch {
          // Папка установки может быть защищена от записи — пробуем дальше.
        }
      }
      return false;
    });
  }

  /**
   * Кладёт рядом с ядром копию набора без расширения.
   *
   * Старые ядра Xray (26.1.13–26.1.17) искали файл `geosite` без `.dat` и
   * падали с кодом 23, даже когда geosite.dat лежал рядом — обновление ядра
   * при этом ничего не меняло. Копия без расширения лечит такие ядра и не
   * мешает новым: они её не ищут.
   */
  private placeGeoAlias(datFile: string): void {
    const alias = datFile.replace(/\.dat$/i, '');
    if (alias === datFile || existsSync(alias)) return;
    try { copyFileSync(datFile, alias); } catch { /* не критично */ }
  }

  /** После падения с кодом 23 убираем битые копии наборов адресов. */
  private dropBrokenGeoFiles(): void {
    for (const name of ['geoip.dat', 'geosite.dat']) {
      const places = [path.join(path.dirname(this.xrayPath()), name), ...this.geoFileCandidates(name)];
      for (const file of new Set(places)) {
        if (existsSync(file) && !this.validGeoFile(file)) {
          try { rmSync(file, { force: true }); } catch { /* нет прав — оставляем */ }
        }
      }
    }
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
      connectedAt: this.connectedAt,
      pid: this.pid,
      inboundPort: this.inboundPort,
      xrayReady: existsSync(this.xrayPath()),
      xrayVersion: null,
      error: this.error,
      subscriptions: [...this.subscriptions.values()],
      lanShared: this.allowLan && this.status === 'connected',
      lanEndpoints: this.allowLan && this.status === 'connected' ? lanEndpoints(true, this.inboundPort) : [],
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

  importSubscription(url: string): Promise<VpnProfile[]> {
    let normalizedUrl: string;
    try {
      normalizedUrl = validateSubscriptionUrl(url.trim()).toString();
    } catch (error) {
      return Promise.reject(error);
    }
    const source = profileSourceKey(normalizedUrl);
    const existing = this.subscriptionImportsInFlight.get(source);
    if (existing) return existing;

    const task = this.enqueueProfileMutation(() => this.importSubscriptionUnlocked(normalizedUrl));
    this.subscriptionImportsInFlight.set(source, task);
    void task.then(
      () => { if (this.subscriptionImportsInFlight.get(source) === task) this.subscriptionImportsInFlight.delete(source); },
      () => { if (this.subscriptionImportsInFlight.get(source) === task) this.subscriptionImportsInFlight.delete(source); },
    );
    return task;
  }

  private async importSubscriptionUnlocked(url: string): Promise<VpnProfile[]> {
    const parsed = validateSubscriptionUrl(url);
    this.emitLog('info', `Загрузка подписки ${parsed.host}…`);
    const logProgress = (message: string) => this.emitLog('info', message);
    let material = await fetchSubscriptionMaterial(url, this.hwid, logProgress);

    // Панель могла отдать не конфигурацию, а страницу, которая рисует себя
    // скриптами уже в браузере. В её исходном тексте ссылок нет, поэтому
    // страница открывается так же, как её видит человек, и адрес читается
    // из кнопки «Добавить подписку». Это последняя попытка: она нужна только
    // когда ни один из обычных способов ничего не дал.
    if (!material.links.length && !material.clash.length) {
      const pageUrl = await readSubscriptionUrlFromPage(url, logProgress);
      if (pageUrl && profileSourceKey(pageUrl) !== profileSourceKey(url)) {
        material = await fetchSubscriptionMaterial(pageUrl, this.hwid, logProgress);
      }
    }

    // Сетевой отказ показывается только теперь, когда испробованы все способы,
    // включая чтение страницы. Так пользователь видит настоящую причину
    // («сервер отклонил запрос»), а не общий рассказ про формат подписки.
    if (!material.links.length && !material.clash.length && material.firstFailure) {
      throw material.firstFailure;
    }
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
      throw new Error('Панель выдаёт конфигурацию только своим приложениям. Откройте ссылку в браузере и нажмите «Получить ссылку» (Get Link) в правом верхнем углу страницы — скопированный адрес вставьте сюда. Если такой кнопки нет, выберите на странице любое приложение и скопируйте адрес из кнопки «Добавить подписку» через правую кнопку мыши.');
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

  sampleLatency(): Promise<VpnLatencySample | null> {
    if (this.status !== 'connected' || !this.activeProfileId) return Promise.resolve(null);
    const cachedAt = this.lastLatencySample ? Date.parse(this.lastLatencySample.measuredAt) : 0;
    if (this.lastLatencySample && Number.isFinite(cachedAt) && Date.now() - cachedAt < 1500) {
      return Promise.resolve(this.lastLatencySample);
    }
    if (this.latencyProbeInFlight) return this.latencyProbeInFlight;

    const activeProfileId = this.activeProfileId;
    const task = this.measureTunnelLatency().then((sample) => {
      if (this.status !== 'connected' || this.activeProfileId !== activeProfileId) return null;
      if (sample) this.lastLatencySample = sample;
      return sample;
    }).finally(() => {
      if (this.latencyProbeInFlight === task) this.latencyProbeInFlight = null;
    });
    this.latencyProbeInFlight = task;
    return task;
  }

  private measureTunnelLatency(timeoutMs = 4500): Promise<VpnLatencySample | null> {
    const targets = [
      { host: 'cp.cloudflare.com', path: '/generate_204', status: 204, delayMs: 0 },
      { host: 'www.gstatic.com', path: '/generate_204', status: 204, delayMs: 700 },
      { host: 'detectportal.firefox.com', path: '/success.txt', status: 200, delayMs: 1400 },
    ] as const;
    const controller = new AbortController();
    return new Promise((resolve) => {
      let settled = false;
      let completed = 0;
      const launchTimers: NodeJS.Timeout[] = [];
      let overallTimer: NodeJS.Timeout;
      const finish = (sample: VpnLatencySample | null) => {
        if (settled) return;
        settled = true;
        for (const timer of launchTimers) clearTimeout(timer);
        clearTimeout(overallTimer);
        controller.abort();
        resolve(sample);
      };
      const onResult = (sample: VpnLatencySample | null) => {
        completed += 1;
        if (settled) return;
        if (sample) {
          finish(sample);
          return;
        }
        if (completed === targets.length) finish(null);
      };

      overallTimer = setTimeout(() => finish(null), timeoutMs + 100);
      for (const target of targets) {
        const launch = () => {
          if (settled) return;
          void this.probeTunnelLatencyTarget(
            target.host,
            target.path,
            target.status,
            Math.max(1200, timeoutMs - target.delayMs),
            controller.signal,
          ).then(onResult, () => onResult(null));
        };
        if (target.delayMs === 0) launch();
        else launchTimers.push(setTimeout(launch, target.delayMs));
      }
    });
  }

  private probeTunnelLatencyTarget(
    targetHost: string,
    targetPath: string,
    expectedStatus: number,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<VpnLatencySample | null> {
    return new Promise((resolve) => {
      const socket = new Socket();
      let secureSocket: TLSSocket | null = null;
      let settled = false;
      let measuredStartedAt = 0;
      let proxyResponse = '';
      let remoteResponse = '';
      const timer = setTimeout(() => done(null), timeoutMs);
      const done = (sample: VpnLatencySample | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (secureSocket) secureSocket.destroy();
        else socket.destroy();
        resolve(sample);
      };
      const onAbort = () => done(null);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        done(null);
        return;
      }
      const sendRemoteProbe = () => {
        const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const separator = targetPath.includes('?') ? '&' : '?';
        measuredStartedAt = Date.now();
        secureSocket?.write([
          `GET ${targetPath}${separator}nexus=${nonce} HTTP/1.1`,
          `Host: ${targetHost}`,
          'Accept: */*',
          'Cache-Control: no-cache, no-store',
          'Pragma: no-cache',
          'Connection: close',
          'User-Agent: NEXUS-Latency/1.0',
          '',
          '',
        ].join('\r\n'));
      };

      const onRemoteData = (chunk: Buffer) => {
        remoteResponse += chunk.toString('latin1');
        if (remoteResponse.length > 8192) {
          done(null);
          return;
        }
        const end = remoteResponse.indexOf('\r\n\r\n');
        if (end < 0) return;
        const statusLine = remoteResponse.slice(0, remoteResponse.indexOf('\r\n'));
        const status = Number(statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})\b/i)?.[1] || 0);
        if (status !== expectedStatus || !measuredStartedAt) {
          done(null);
          return;
        }
        done({
          // TLS verification proves this is a remote response through the active VPN,
          // while starting after secureConnect excludes local CONNECT/TLS setup time.
          pingMs: Math.max(1, Date.now() - measuredStartedAt),
          measuredAt: new Date().toISOString(),
        });
      };

      const onProxyData = (chunk: Buffer) => {
        proxyResponse += chunk.toString('latin1');
        if (proxyResponse.length > 4096) {
          done(null);
          return;
        }
        const end = proxyResponse.indexOf('\r\n\r\n');
        if (end < 0) return;
        const statusLine = proxyResponse.slice(0, proxyResponse.indexOf('\r\n'));
        if (!/^HTTP\/1\.[01]\s+200\b/i.test(statusLine)) {
          done(null);
          return;
        }
        socket.removeListener('data', onProxyData);
        try {
          secureSocket = connectTls({
            socket,
            servername: targetHost,
            ALPNProtocols: ['http/1.1'],
            rejectUnauthorized: true,
          });
          secureSocket.once('error', () => done(null));
          secureSocket.on('data', onRemoteData);
          secureSocket.once('secureConnect', sendRemoteProbe);
        } catch {
          done(null);
        }
      };

      socket.setNoDelay(true);
      socket.once('error', () => done(null));
      socket.once('close', () => done(null));
      socket.on('data', onProxyData);
      socket.connect({ host: '127.0.0.1', port: this.inboundPort + 1 }, () => {
        socket.write(`CONNECT ${targetHost}:443 HTTP/1.1\r\nHost: ${targetHost}:443\r\nProxy-Connection: keep-alive\r\n\r\n`);
      });
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
    continuedSessionAt: string | null = null,
    fragmentation = true,
    allowLan = false,
    dnsServers: string[] = [],
    routingRules: RoutingRule[] = [],
  ): Promise<VpnRuntime> {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error('Профиль не найден');
    const blocked = canConnect(profile);
    if (blocked) throw new Error(blocked);
    // TUN поднимает виртуальный адаптер. Без прав ядро стартует и тут же
    // падает, поэтому причина объясняется заранее, до запуска процесса.
    if (mode === 'tun' && !(await isElevated())) {
      const message = tunElevationMessage();
      this.setState('error', null, null, message);
      throw new Error(message);
    }
    const useSingbox = profile.protocol === 'hysteria2';
    const engine = useSingbox ? this.singboxPath() : this.xrayPath();
    if (!existsSync(engine)) {
      const message = useSingbox
        ? 'sing-box не найден. Перезапустите npm start — SagerNet/sing-box для Hysteria будет загружен автоматически.'
        : 'Xray-core не найден. Перезапустите npm start — XTLS/Xray-core будет загружен автоматически.';
      this.setState('error', null, null, message);
      throw new Error(message);
    }
    // Режим TUN опирается на драйвер виртуального адаптера Wintun: библиотека
    // должна лежать рядом с ядром. Без неё процесс завершается мгновенно с
    // кодом −1 и пустым журналом — по такому сообщению причину не найти,
    // поэтому она проверяется заранее.
    if (mode === 'tun' && process.platform === 'win32') {
      const missing = this.missingTunDriver(engine);
      if (missing) {
        this.setState('error', null, null, missing);
        throw new Error(missing);
      }
    }

    if (this.child) await this.disconnect();

    this.mode = mode;
    this.allowLan = allowLan;
    this.systemProxyConfigured = false;
    this.setState('connecting', id, null);
    const port = await this.pickPort(preferredPort);
    this.inboundPort = port;
    const activeAppRouting: VpnAppRoutingMode = mode === 'tun' && splitApps.length && appRouting !== 'system'
      ? appRouting
      : 'system';
    const activeSplitApps = activeAppRouting === 'system' ? [] : splitApps;
    // Групповые наборы работают только когда рядом с ядром лежат файлы с их
    // содержимым. Валидные копии переносятся к ядру; если их нигде нет, такие
    // правила молча отбрасываются: лучше подключиться без части правил, чем
    // не подключиться вовсе. Для sing-box проверка не нужна: групповые наборы
    // в его конфиг не попадают вовсе.
    const geoReady = useSingbox || this.ensureGeoFilesBesideEngine(engine);
    // Если прошлое подключение упало на групповых правилах, этот запуск идёт
    // без них: ядро не сможет загрузить наборы и упадёт снова. Флаг живёт до
    // перезапуска приложения — после обновления ядра правила вернутся сами.
    const geoRulesAllowed = geoReady && !this.geoRulesForbidden;
    const usableRules = geoRulesAllowed
      ? routingRules
      : routingRules.filter((rule) => !/^(geosite|geoip|ext):/i.test(rule.value));
    // Запоминаем, попали ли групповые правила в этот конфиг: если ядро упадёт
    // с кодом 23, именно они под подозрением, и следующая попытка пойдёт без них.
    this.lastConfigIncludedGeo = !useSingbox && geoRulesAllowed
      && routingRules.some((rule) => /^(geosite|geoip|ext):/i.test(rule.value));
    if (this.geoRulesForbidden && !useSingbox) {
      this.emitLog('warn', 'Групповые правила отключены: ядро VPN не смогло загрузить наборы адресов. После обновления ядра перезапустите NEXUS, и правила вернутся.');
    }
    if (!geoReady && usableRules.length !== routingRules.length) {
      this.emitLog('warn', 'Файлы наборов адресов не найдены — групповые правила пропущены. Нажмите «Проверить обновления» в разделе модулей.');
    }
    const config = useSingbox
      ? buildSingboxConfig(profile.params, port, mode, activeSplitApps, activeAppRouting, allowLan, dnsServers, routingRules)
      : buildXrayConfig(profile.params, port, mode, activeSplitApps, activeAppRouting, fragmentation, allowLan, dnsServers, usableRules);
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
      // В файл журнала пишется исходная строка без раскраски: она нужна для
      // разбора инцидентов, а ANSI-коды делают файл нечитаемым.
      logStream.write(`[${new Date().toISOString()}] ${stripAnsi(text)}\n`);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      logStream.write(`[${new Date().toISOString()}] ${stripAnsi(text)}\n`);

      for (const rawLine of text.split(/\r?\n/)) {
        const parsed = parseVpnLogLine(rawLine);
        if (!parsed) continue;
        // Причиной падения считается только настоящий отказ: обрыв соединения
        // произошёл бы и при исправном туннеле.
        if (parsed.fatal) lastErr = stripAnsi(rawLine).slice(-300);
        // Обрывы отдельных соединений остаются в файле, но не всплывают в
        // интерфейсе: при обычном сёрфинге их десятки в минуту.
        if (parsed.noise) continue;
        if (parsed.level === 'error' || parsed.level === 'warn') {
          this.emitLog(parsed.level, parsed.message);
        }
      }
    });
    child.once('error', (error) => {
      logStream.end();
      this.child = null;
      this.systemProxyConfigured = false;
      this.setState('error', id, null, error.message);
    });
    child.once('exit', (code) => {
      logStream.end();
      this.child = null;
      this.pid = null;
      this.systemProxyConfigured = false;
      this.allowLan = false;
      void clearSystemProxy();
      void fs.rm(this.generatedPath(), { force: true });
      if (this.status === 'connecting' || this.status === 'connected') {
        const failed = code !== 0 && code !== null;
        let reason: string | undefined;
        if (failed && code === 23) {
          // Код 23 — ядро не смогло стартовать. Настоящая причина пишется в
          // stderr (lastErr): показываем её, а не общий текст. Отдельно
          // выделяем наборы адресов: их не может загрузить ни старое ядро
          // (ищет файл без расширения), ни битые/отсутствующие файлы.
          const geoFailure = /geosite|geoip|no such file|not found|cannot find/i.test(lastErr);
          if (geoFailure || !lastErr) {
            reason = 'VPN-ядро не смогло загрузить наборы адресов (код 23). Программа подключит без групповых правил; после «Проверить обновления» и перезапуска они вернутся.';
          } else {
            reason = describeVpnFailure(lastErr, mode);
          }
          this.dropBrokenGeoFiles();
          // Групповые правила были в конфиге — похоже, именно они уронили
          // ядро. Следующая попытка пойдёт без них, чтобы VPN точно включился.
          if (this.lastConfigIncludedGeo) this.geoRulesForbidden = true;
        } else {
          reason = failed ? (lastErr ? describeVpnFailure(lastErr, mode) : `VPN-ядро завершилось с кодом ${code}`) : undefined;
        }
        this.setState(failed ? 'error' : 'disconnected', failed ? id : null, null, reason);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (!this.child) {
      // Подсказка про администратора уже входит в describeVpnFailure, поэтому
      // добавляется только когда конкретная причина неизвестна.
      if (this.error) throw new Error(this.error);
      if (lastErr) throw new Error(describeVpnFailure(lastErr, mode));
      const hint = mode === 'tun' ? ' Для TUN часто требуется запуск NEXUS от имени администратора. Попробуйте режим PROXY.' : '';
      throw new Error('Не удалось запустить VPN-ядро.' + hint);
    }
    if (mode === 'proxy') {
      try {
        await setSystemProxy('127.0.0.1', port + 1);
        this.systemProxyConfigured = true;
        this.emitLog('info', `Системный прокси: 127.0.0.1:${port + 1}`);
      } catch (error) {
        this.systemProxyConfigured = false;
        this.emitLog('warn', `Не удалось выставить системный прокси: ${error instanceof Error ? error.message : 'ошибка'}`);
      }
    }
    const validContinuedSessionAt = continuedSessionAt && Number.isFinite(Date.parse(continuedSessionAt))
      ? continuedSessionAt
      : null;
    this.setState('connected', id, child.pid ?? null, undefined, validContinuedSessionAt);
    const routeMode = activeAppRouting === 'include'
      ? `TUN · через VPN только ${activeSplitApps.length} прилож.`
      : activeAppRouting === 'exclude'
        ? `TUN · напрямую ${activeSplitApps.length} прилож.`
        : mode.toUpperCase();
    this.emitLog('success', `Включено: ${profile.name} · ${routeMode} · HTTP 127.0.0.1:${port + 1}`);
    if (allowLan) {
      const endpoints = lanEndpoints(true, port);
      this.emitLog(
        endpoints.length ? 'info' : 'warn',
        endpoints.length
          ? `Раздача в локальную сеть включена · SOCKS ${endpoints.map((item) => item.socks).join(', ')}`
          : 'Раздача включена, но приватный IPv4-адрес не найден. Проверьте подключение к домашней сети.',
      );
    }
    return this.runtime();
  }

  async diagnostics(profileId: string | null = null, preferredMode: 'proxy' | 'tun' = this.mode): Promise<VpnDiagnostics> {
    if (profileId && !isSafeProfileId(profileId)) throw new Error('Некорректный идентификатор профиля');
    const currentProfileId = this.status === 'disconnected' ? profileId : (this.activeProfileId ?? profileId);
    const profile = currentProfileId ? this.profiles.get(currentProfileId) ?? null : null;
    const mode = this.status === 'disconnected' ? preferredMode : this.mode;
    const useSingbox = profile?.protocol === 'hysteria2';
    const engineName = useSingbox ? 'sing-box' : 'Xray-core';
    const enginePath = useSingbox ? this.singboxPath() : this.xrayPath();
    const engineReady = existsSync(enginePath);
    const processAlive = Boolean(this.child?.pid && this.child.exitCode === null && !this.child.killed);
    const configReady = existsSync(useSingbox ? this.singboxConfigPath() : this.generatedPath());
    const shouldProbeLocal = this.status === 'connected';
    // A direct probe from the NEXUS process can be captured by an active TUN
    // route and loop back through the VPN itself, so it is skipped in that case.
    const shouldProbeEndpoint = Boolean(profile && profile.protocol !== 'hysteria2' && !(this.status === 'connected' && mode === 'tun'));
    const [socksListening, httpListening, endpointReachable] = await Promise.all([
      shouldProbeLocal ? this.probeTcp('127.0.0.1', this.inboundPort, 1200) : Promise.resolve(false),
      shouldProbeLocal ? this.probeTcp('127.0.0.1', this.inboundPort + 1, 1200) : Promise.resolve(false),
      shouldProbeEndpoint && profile ? this.probeTcp(profile.server, profile.port, 1800) : Promise.resolve(false),
    ]);

    const checks: VpnDiagnosticCheck[] = [{
      id: 'core',
      title: 'VPN-ядро',
      tone: engineReady ? 'ok' : 'error',
      summary: engineReady ? `${engineName} готово к запуску` : `${engineName} не найдено`,
      detail: engineReady ? 'Исполняемый файл установлен локально' : 'Перезапустите npm start, чтобы восстановить ядро',
    }];

    if (!profile) {
      checks.push({
        id: 'profile', title: 'Профиль', tone: 'warning', summary: 'Сервер не выбран', detail: 'Выберите профиль Jey2Ray перед подключением',
      });
    } else {
      const profileProblem = canConnect(profile);
      checks.push({
        id: 'profile',
        title: 'Профиль',
        tone: profileProblem ? 'error' : 'ok',
        summary: profileProblem || `${profile.name} · ${profile.protocol.toUpperCase()}`,
        detail: `${profile.server}:${profile.port}`,
      });
    }

    if (this.status === 'connected' || this.status === 'connecting') {
      checks.push({
        id: 'config',
        title: 'Конфигурация',
        tone: configReady ? 'ok' : 'error',
        summary: configReady ? 'Временная конфигурация создана' : 'Файл конфигурации не найден',
        detail: 'Секретные параметры конфигурации не читаются и не выводятся',
      });
    } else {
      checks.push({
        id: 'config', title: 'Конфигурация', tone: 'info', summary: 'Будет создана при подключении', detail: null,
      });
    }

    if (this.status === 'error') {
      checks.push({
        id: 'process', title: 'Процесс', tone: 'error', summary: 'Ядро завершилось с ошибкой', detail: this.error || 'Причина не получена',
      });
    } else if (this.status === 'connected') {
      checks.push({
        id: 'process',
        title: 'Процесс',
        tone: processAlive ? 'ok' : 'error',
        summary: processAlive ? 'Процесс VPN работает' : 'Состояние процесса не совпадает с подключением',
        detail: processAlive && this.pid ? `PID ${this.pid}` : null,
      });
    } else if (this.status === 'connecting') {
      checks.push({
        id: 'process', title: 'Процесс', tone: 'warning', summary: 'Ядро запускается', detail: this.pid ? `PID ${this.pid}` : null,
      });
    } else {
      checks.push({
        id: 'process', title: 'Процесс', tone: 'info', summary: 'VPN сейчас выключен', detail: null,
      });
    }

    if (this.status === 'connected') {
      const localReady = socksListening && httpListening;
      checks.push({
        id: 'local-ports',
        title: 'Локальные порты',
        tone: localReady ? 'ok' : 'error',
        summary: localReady ? 'SOCKS и HTTP принимают подключения' : 'Один из локальных портов не отвечает',
        detail: `127.0.0.1:${this.inboundPort} · 127.0.0.1:${this.inboundPort + 1}`,
      });
    } else {
      checks.push({
        id: 'local-ports', title: 'Локальные порты', tone: 'info', summary: 'Проверка начнётся после включения VPN', detail: `SOCKS ${this.inboundPort} · HTTP ${this.inboundPort + 1}`,
      });
    }

    if (this.allowLan && this.status === 'connected') {
      const endpoints = lanEndpoints(true, this.inboundPort);
      checks.push({
        id: 'lan-share',
        title: 'Раздача в сеть',
        tone: endpoints.length ? 'ok' : 'warning',
        summary: endpoints.length ? `Доступно устройствам сети: ${endpoints.length} адрес(ов)` : 'Приватный IPv4-адрес не найден',
        detail: endpoints.length ? endpoints.map((item) => item.socks).join(' · ') : 'Проверьте, что компьютер подключён к домашней сети',
      });
    }

    if (!profile) {
      checks.push({
        id: 'endpoint', title: 'Сервер', tone: 'info', summary: 'Нет сервера для проверки', detail: null,
      });
    } else if (profile.protocol === 'hysteria2') {
      checks.push({
        id: 'endpoint', title: 'Сервер', tone: 'info', summary: 'Hysteria2 использует UDP', detail: 'TCP-проверка намеренно не выполняется',
      });
    } else if (this.status === 'connected' && mode === 'tun') {
      checks.push({
        id: 'endpoint', title: 'Сервер', tone: 'info', summary: 'Канал контролируется работающим TUN-ядром', detail: 'Прямая TCP-проверка пропущена, чтобы не создавать петлю маршрутизации',
      });
    } else {
      checks.push({
        id: 'endpoint',
        title: 'Сервер',
        tone: endpointReachable ? 'ok' : 'warning',
        summary: endpointReachable ? 'Удалённый порт доступен' : 'Удалённый порт не ответил на быструю проверку',
        detail: endpointReachable ? `${profile.server}:${profile.port}` : 'Это может быть временная сетевая блокировка или фильтрация сервера',
      });
    }

    if (mode === 'proxy' && process.platform !== 'win32') {
      checks.push({
        id: 'routing', title: 'Маршрутизация', tone: 'info', summary: 'Системный proxy не изменяется на этой платформе', detail: `Локальный HTTP ${this.inboundPort + 1}`,
      });
    } else if (mode === 'proxy') {
      const proxyReady = this.status === 'connected' && this.systemProxyConfigured;
      checks.push({
        id: 'routing',
        title: 'Маршрутизация',
        tone: this.status !== 'connected' ? 'info' : proxyReady ? 'ok' : 'warning',
        summary: this.status !== 'connected' ? 'Системный proxy будет включён после запуска' : proxyReady ? 'Системный proxy включён' : 'Системный proxy не подтверждён',
        detail: `HTTP 127.0.0.1:${this.inboundPort + 1}`,
      });
    } else {
      checks.push({
        id: 'routing',
        title: 'Маршрутизация',
        tone: this.status === 'connected' && processAlive ? 'ok' : this.status === 'error' ? 'error' : 'info',
        summary: this.status === 'connected' && processAlive ? 'Ядро запущено в режиме TUN' : 'TUN активируется вместе с VPN',
        detail: 'Системный HTTP-proxy в режиме TUN не используется',
      });
    }

    const overall = checks.some((check) => check.tone === 'error')
      ? 'error'
      : checks.some((check) => check.tone === 'warning') ? 'warning' : 'ok';
    const headline = overall === 'error'
      ? 'Найдены проблемы подключения'
      : overall === 'warning'
        ? (this.status === 'connected' ? 'Подключение требует внимания' : 'Не всё готово к запуску')
        : (this.status === 'connected' ? 'Подключение работает' : 'Готово к подключению');
    const endpoint = profile ? `${profile.server.includes(':') ? `[${profile.server}]` : profile.server}:${profile.port}` : null;

    return createVpnDiagnostics({
      generatedAt: new Date().toISOString(),
      overall,
      headline,
      runtimeStatus: this.status,
      mode,
      engine: engineName,
      profileName: profile?.name ?? null,
      protocol: profile?.protocol ?? null,
      endpoint,
      localSocks: `127.0.0.1:${this.inboundPort}`,
      localHttp: `127.0.0.1:${this.inboundPort + 1}`,
      checks,
      events: this.diagnosticEvents.map(({ timestamp, level, message }) => ({ timestamp, level, message })),
    });
  }

  getLogs(): ModuleLog[] {
    return this.diagnosticEvents.map((log) => ({ ...log }));
  }

  async disconnect(): Promise<VpnRuntime> {
    const child = this.child;
    if (!child?.pid) {
      await clearSystemProxy().catch(() => undefined);
      this.systemProxyConfigured = false;
      this.allowLan = false;
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
    await clearSystemProxy().catch(() => undefined);
    this.systemProxyConfigured = false;
    await fs.rm(this.generatedPath(), { force: true });
    await fs.rm(this.singboxConfigPath(), { force: true });
    this.allowLan = false;
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

  private probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new Socket();
      let settled = false;
      const finish = (reachable: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(reachable);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.connect({ host, port });
    });
  }

  private isFree(port: number): Promise<boolean> {
    // При раздаче в LAN ядро занимает порт на всех интерфейсах, поэтому и проверять
    // занятость нужно на 0.0.0.0 — иначе свободный 127.0.0.1 скроет чужой слушатель.
    const host = inboundListenAddress(this.allowLan);
    return new Promise((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.listen(port, host, () => {
        server.close(() => resolve(true));
      });
    });
  }


  private async persist(profile: VpnProfile): Promise<void> {
    await fs.mkdir(this.configsDir(), { recursive: true });
    await fs.writeFile(path.join(this.configsDir(), `${profile.id}.json`), `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  }

  private setState(
    status: VpnStatus,
    profileId: string | null,
    pid: number | null,
    error?: string,
    continuedSessionAt: string | null = null,
  ): void {
    if (status !== 'connected' || profileId !== this.activeProfileId) this.lastLatencySample = null;
    if (status === 'connected') {
      this.connectedAt = continuedSessionAt ?? this.connectedAt ?? new Date().toISOString();
    } else if (status !== 'connecting') {
      this.connectedAt = null;
    }
    this.status = status;
    this.activeProfileId = profileId;
    this.pid = pid;
    this.error = error;
    this.emit('changed', this.snapshot());
  }

  private emitLog(level: ModuleLog['level'], message: string): void {
    const log: ModuleLog = { id: 'jey2ray', level, message, timestamp: new Date().toISOString() };
    this.diagnosticEvents = [log, ...this.diagnosticEvents].slice(0, 40);
    this.emit('log', log);
  }
}
