import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { promises as fs, createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Open } from 'unzipper';
import type { ModuleManifest, UpdateInfo, UpdateStatus } from './types';
import { ModuleManager } from './module-manager';
import { tgWsProxyAssetCandidates, xrayAssetCandidates } from './platform-assets';

type GithubRelease = {
  tag_name: string;
  name: string;
  html_url: string;
  assets: { name: string; browser_download_url: string; size: number; digest?: string | null }[];
};

type UpdateTarget = {
  id: string;
  name: string;
  repo: string;
  releaseTag?: string;
  assetKind: 'zip' | 'executable';
  selectAsset: (assets: GithubRelease['assets']) => GithubRelease['assets'][number] | undefined;
  install: (assetPath: string, version: string, assetName: string) => Promise<string>;
};

type VersionRecord = { version: string; asset: string; sha256: string; installedAt: string };

const GITHUB_API = 'https://api.github.com/repos';
// v26.3.27 is the latest stable release, but lacks Windows TUN auto-routing.
// This reviewed release supports the routing schema used by Split Tunneling.
export const XRAY_TUN_RELEASE = 'v26.7.28';
// Official GitHub release metadata for the pinned fallback. It remains
// verifiable even when the GitHub API is temporarily unavailable.
const XRAY_TUN_ASSETS: Record<string, { size: number; sha256: string }> = {
  'Xray-linux-64.zip': { size: 21164807, sha256: '8195d909f1109b8f3d99eefe401a3c451d7bf4af71f24d3815420f77e5dd2a40' },
  'Xray-windows-32.zip': { size: 20544832, sha256: 'e10308e5abcf375eee1bb044fcdfcd885dbefdac4212888b7e37e8bbea724d7b' },
  'Xray-windows-64.zip': { size: 20987981, sha256: 'c7172078fca4711bcd92a4774dcd1822544579c58816197575c47533317fd8d1' },
  'Xray-windows-arm64-v8a.zip': { size: 19341449, sha256: '2d61646f79fdc6724e68a41eb235f6a7253cfac2809caa736ad065f6c10e14a2' },
};
const MAX_DOWNLOAD_REDIRECTS = 5;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const TRUSTED_MIRROR_HOSTS = new Set(['ghproxy.net', 'mirror.ghproxy.com']);

export class GithubUpdater extends EventEmitter {
  private readonly updates = new Map<string, UpdateInfo>();
  private readonly syncInFlight = new Map<string, Promise<void>>();
  private readonly ensureInFlight = new Map<string, Promise<void>>();
  private readonly versionsFile: string;
  private versions: Record<string, VersionRecord> = {};

  constructor(
    private readonly modulesDir: string,
    private readonly manager: ModuleManager,
    private readonly isExternallyRunning: (id: string) => boolean = () => false,
  ) {
    super();
    this.versionsFile = path.join(modulesDir, '.nexus-versions.json');
    this.loadVersionRecords();
    this.registerTargets();
  }

  list(): UpdateInfo[] {
    return [...this.updates.values()];
  }

  async syncAll(): Promise<UpdateInfo[]> {
    for (const target of this.targets) {
      await this.syncOne(target);
    }
    return this.list();
  }

  ensure(id: string): Promise<void> {
    const active = this.ensureInFlight.get(id);
    if (active) return active;

    const task = this.ensureTarget(id);
    this.ensureInFlight.set(id, task);
    task.then(
      () => this.ensureInFlight.delete(id),
      () => this.ensureInFlight.delete(id),
    );
    return task;
  }

  private async ensureTarget(id: string): Promise<void> {
    const target = this.targets.find((item) => item.id === id);
    if (!target) throw new Error(`Нет цели обновления: ${id}`);
    if (this.moduleExecutableExists(id)) return;
    await this.syncOne(target);
    if (this.moduleExecutableExists(id)) return;
    if (id === 'jey2ray') await this.installXrayFromMirrors();
    if (!this.moduleExecutableExists(id)) {
      throw new Error(this.updates.get(id)?.error || `Не удалось скачать ${target.name}. Проверьте подключение к интернету и повторите попытку.`);
    }
  }

  private readonly targets: UpdateTarget[] = [];

  private registerTargets(): void {
    this.targets.push({
      id: 'zapret',
      name: 'Обход DPI',
      repo: 'Flowseal/zapret-discord-youtube',
      assetKind: 'zip',
      selectAsset: (assets) => process.platform === 'win32' ? assets.find((asset) => asset.name.endsWith('.zip') && asset.name.includes('zapret-discord-youtube')) : undefined,
      install: (assetPath, version) => this.installZapret(assetPath, version),
    });
    this.targets.push({
      id: 'tg-ws-proxy',
      name: 'TG WS Proxy',
      repo: 'Flowseal/tg-ws-proxy',
      assetKind: 'executable',
      selectAsset: (assets) => {
        for (const candidate of tgWsProxyAssetCandidates()) {
          const asset = assets.find((item) => item.name === candidate);
          if (asset) return asset;
        }
        return undefined;
      },
      install: (assetPath, version, assetName) => this.installDirect(assetPath, version, assetName),
    });
    this.targets.push({
      id: 'jey2ray',
      name: 'Jey2Ray / Xray-core',
      repo: 'XTLS/Xray-core',
      releaseTag: XRAY_TUN_RELEASE,
      assetKind: 'zip',
      selectAsset: (assets) => {
        for (const candidate of xrayAssetCandidates()) {
          const asset = assets.find((item) => item.name === candidate);
          if (asset) return asset;
        }
        return undefined;
      },
      install: (assetPath, version) => this.installXray(assetPath, version),
    });
    for (const target of this.targets) {
      this.updates.set(target.id, this.info(target, { status: 'checking' }));
    }
  }

  private syncOne(target: UpdateTarget): Promise<void> {
    const active = this.syncInFlight.get(target.id);
    if (active) return active;

    const task = this.performSync(target);
    this.syncInFlight.set(target.id, task);
    task.then(
      () => this.syncInFlight.delete(target.id),
      () => this.syncInFlight.delete(target.id),
    );
    return task;
  }

  private async performSync(target: UpdateTarget): Promise<void> {
    this.setStatus(target, 'checking');
    let temporaryDirectory: string | undefined;
    let releaseUpdateLock: (() => void) | undefined;
    try {
      if (this.isExternallyRunning(target.id) || await this.manager.hasRunningProcess(target.id)) {
        throw new Error(target.id === 'jey2ray' ? 'Отключите VPN перед обновлением Xray-core' : 'Остановите модуль перед обновлением');
      }
      releaseUpdateLock = this.manager.beginUpdate(target.id);
      const release = await this.fetchRelease(target.repo, target.releaseTag);
      const asset = target.selectAsset(release.assets);
      if (!asset) {
        this.setStatus(target, 'unsupported', { latestVersion: release.tag_name, error: `Для ${process.platform}/${os.arch()} нет подходящего файла релиза` });
        return;
      }
      const installed = this.versions[target.id];
      const executableExists = this.moduleExecutableExists(target.id);
      if (installed?.version === release.tag_name && installed.asset === asset.name && executableExists) {
        this.setStatus(target, 'up-to-date', { latestVersion: release.tag_name, installedVersion: installed.version, asset: asset.name });
        return;
      }
      this.setStatus(target, 'downloading', { latestVersion: release.tag_name, asset: asset.name });
      temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-updater-'));
      const safeAssetName = path.basename(asset.name).replace(/[^a-z0-9._-]/gi, '_');
      const temporaryAsset = path.join(temporaryDirectory, safeAssetName);
      await this.downloadReleaseAsset(asset, temporaryAsset, target);
      const hash = await this.sha256(temporaryAsset);
      const publishedDigest = asset.digest?.trim();
      const digestMatch = publishedDigest?.match(/^sha256:([a-f0-9]{64})$/i);
      if (publishedDigest && !digestMatch) {
        throw new Error(`GitHub опубликовал неподдерживаемый формат контрольной суммы для ${asset.name}`);
      }
      const expectedDigest = digestMatch?.[1].toLowerCase();
      if (expectedDigest && hash.toLowerCase() !== expectedDigest) {
        throw new Error(`Контрольная сумма GitHub asset ${asset.name} не совпала`);
      }
      if (this.isExternallyRunning(target.id) || await this.manager.hasRunningProcess(target.id)) {
        throw new Error(target.id === 'jey2ray' ? 'VPN был включён во время загрузки. Отключите VPN и повторите обновление.' : 'Модуль был запущен во время загрузки');
      }
      const executable = await target.install(temporaryAsset, release.tag_name, asset.name);
      this.versions[target.id] = { version: release.tag_name, asset: asset.name, sha256: hash, installedAt: new Date().toISOString() };
      await this.saveVersionRecords();
      await this.manager.reload();
      this.setStatus(target, 'installed', { latestVersion: release.tag_name, installedVersion: release.tag_name, asset: asset.name, executable, sha256: hash });
    } catch (error) {
      this.setStatus(target, 'error', { error: this.userFacingError(error) });
    } finally {
      releaseUpdateLock?.();
      if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async fetchRelease(repo: string, releaseTag?: string): Promise<GithubRelease> {
    let lastError: Error | null = null;
    const endpoint = releaseTag ? `releases/tags/${encodeURIComponent(releaseTag)}` : 'releases/latest';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(`${GITHUB_API}/${repo}/${endpoint}`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NEXUS-Network-Control-Plane' },
        });
        if (response.status === 403) throw new Error('GitHub API: лимит запросов (HTTP 403). Повторите позже.');
        if (!response.ok) throw new Error(`GitHub API: HTTP ${response.status}`);
        return await response.json() as GithubRelease;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('GitHub API недоступен');
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      }
    }
    throw lastError ?? new Error('GitHub API недоступен');
  }

  private validateDownloadUrl(rawUrl: string | URL, repo: string, allowGithubAssetHost: boolean): URL {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl.toString());
    } catch {
      throw new Error(`Загрузка заблокирована: некорректный URL (${repo})`);
    }

    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error(`Загрузка заблокирована: недоверенный адрес ${hostname || 'unknown'} (${repo})`);
    }

    const repoPrefix = `/${repo}/`.toLowerCase();
    if (hostname === 'github.com') {
      if (!parsed.pathname.toLowerCase().startsWith(repoPrefix)) {
        throw new Error(`Загрузка заблокирована: asset не принадлежит https://github.com/${repo}`);
      }
      return parsed;
    }

    if (TRUSTED_MIRROR_HOSTS.has(hostname)) {
      const mirrorTarget = parsed.pathname.slice(1).toLowerCase();
      if (!mirrorTarget.startsWith(`https://github.com${repoPrefix}`)) {
        throw new Error(`Загрузка заблокирована: зеркало ${hostname} запрашивает другой репозиторий`);
      }
      return parsed;
    }

    const githubAssetHost = hostname === 'githubusercontent.com' || hostname.endsWith('.githubusercontent.com');
    if (allowGithubAssetHost && githubAssetHost) return parsed;

    throw new Error(`Загрузка заблокирована: недоверенный домен ${hostname || 'unknown'} (${repo})`);
  }

  private async downloadReleaseAsset(
    asset: GithubRelease['assets'][number],
    destination: string,
    target: UpdateTarget,
  ): Promise<void> {
    const urls = [
      asset.browser_download_url,
      `https://ghproxy.net/${asset.browser_download_url}`,
      `https://mirror.ghproxy.com/${asset.browser_download_url}`,
    ];
    let lastError: unknown = new Error('Не удалось скачать GitHub asset');
    for (const url of urls) {
      try {
        await this.downloadAsset(url, destination, target.repo);
        await this.assertAsset(destination, target.assetKind, asset.size, asset.name);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private async downloadAsset(url: string, destination: string, repo: string): Promise<void> {
    await fs.rm(destination, { force: true }).catch(() => undefined);
    try {
      let currentUrl = url;
      for (let redirectCount = 0; ; redirectCount += 1) {
        const parsed = this.validateDownloadUrl(currentUrl, repo, redirectCount > 0);
        const response = await fetch(parsed, {
          headers: { 'User-Agent': 'NEXUS-Network-Control-Plane' },
          redirect: 'manual',
        });

        if (REDIRECT_STATUS_CODES.has(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel().catch(() => undefined);
          if (!location) throw new Error(`GitHub asset: перенаправление HTTP ${response.status} без адреса`);
          if (redirectCount >= MAX_DOWNLOAD_REDIRECTS) {
            throw new Error(`GitHub asset: превышен лимит перенаправлений (${MAX_DOWNLOAD_REDIRECTS})`);
          }
          let redirected: URL;
          try {
            redirected = new URL(location, parsed);
          } catch {
            throw new Error('GitHub asset: получен некорректный адрес перенаправления');
          }
          this.validateDownloadUrl(redirected, repo, true);
          currentUrl = redirected.toString();
          continue;
        }

        this.validateDownloadUrl(response.url || parsed, repo, redirectCount > 0);
        if (!response.ok || !response.body) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error(`GitHub asset: HTTP ${response.status}`);
        }

        const totalBytes = Number(response.headers.get('content-length') ?? 0);
        let downloadedBytes = 0;
        const target = this.targets.find((item) => item.repo === repo);
        const input = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
        input.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (target) this.setStatus(target, 'downloading', { downloadedBytes, totalBytes: totalBytes || undefined, asset: path.basename(destination) });
        });
        await pipeline(input, createWriteStream(destination, { flags: 'w' }));
        return;
      }
    } catch (error) {
      await fs.rm(destination, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async assertAsset(filePath: string, kind: UpdateTarget['assetKind'], expectedSize: number, assetName: string): Promise<void> {
    const stat = await fs.stat(filePath);
    if (stat.size < 1024) {
      throw new Error(`GitHub asset ${assetName} слишком мал (${stat.size} байт)`);
    }
    if (expectedSize > 0 && stat.size !== expectedSize) {
      throw new Error(`GitHub asset ${assetName} скачан не полностью: ${stat.size} из ${expectedSize} байт`);
    }

    const handle = await fs.open(filePath, 'r');
    const signature = Buffer.alloc(4);
    try {
      await handle.read(signature, 0, signature.length, 0);
    } finally {
      await handle.close();
    }

    if (kind === 'zip') {
      if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
        throw new Error(`GitHub asset ${assetName} не является ZIP-архивом (нет сигнатуры PK)`);
      }
      return;
    }

    const validExecutable = process.platform === 'win32'
      ? signature[0] === 0x4d && signature[1] === 0x5a
      : signature[0] === 0x7f && signature[1] === 0x45 && signature[2] === 0x4c && signature[3] === 0x46;
    if (!validExecutable) {
      const format = process.platform === 'win32' ? 'Windows EXE' : 'Linux ELF';
      throw new Error(`GitHub asset ${assetName} не является исполняемым файлом ${format}`);
    }
  }

  private async installXrayFromMirrors(): Promise<void> {
    const file = xrayAssetCandidates()[0];
    if (!file) throw new Error(`Для ${process.platform}/${os.arch()} нет совместимой сборки Xray-core`);
    const expectedAsset = XRAY_TUN_ASSETS[file];
    if (!expectedAsset) throw new Error(`Нет проверочной суммы для сборки Xray-core ${file}`);
    if (this.isExternallyRunning('jey2ray')) throw new Error('Отключите VPN перед установкой Xray-core');
    const releasePath = `releases/download/${XRAY_TUN_RELEASE}`;
    const mirrors = [
      `https://github.com/XTLS/Xray-core/${releasePath}/${file}`,
      `https://ghproxy.net/https://github.com/XTLS/Xray-core/${releasePath}/${file}`,
      `https://mirror.ghproxy.com/https://github.com/XTLS/Xray-core/${releasePath}/${file}`,
    ];
    const jey = this.targets.find((item) => item.id === 'jey2ray');
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-xray-download-'));
    const temporaryAsset = path.join(temporaryDirectory, file);
    let releaseUpdateLock: (() => void) | undefined;
    let lastError = 'Не удалось скачать Xray ни с одного зеркала';
    try {
      releaseUpdateLock = this.manager.beginUpdate('jey2ray');
      let downloaded = false;
      for (const url of mirrors) {
        try {
          if (jey) this.setStatus(jey, 'downloading', { asset: file });
          await this.downloadAsset(url, temporaryAsset, 'XTLS/Xray-core');
          await this.assertAsset(temporaryAsset, 'zip', expectedAsset.size, file);
          const downloadedHash = await this.sha256(temporaryAsset);
          if (downloadedHash.toLowerCase() !== expectedAsset.sha256) {
            throw new Error(`Контрольная сумма GitHub asset ${file} не совпала`);
          }
          downloaded = true;
          break;
        } catch (error) {
          lastError = this.userFacingError(error);
        }
      }
      if (!downloaded) throw new Error(lastError);
      if (this.isExternallyRunning('jey2ray')) {
        throw new Error('VPN был включён во время загрузки. Отключите VPN и повторите обновление.');
      }
      const hash = await this.sha256(temporaryAsset);
      const executable = await this.installXray(temporaryAsset, XRAY_TUN_RELEASE);
      this.versions.jey2ray = {
        version: XRAY_TUN_RELEASE,
        asset: file,
        sha256: hash,
        installedAt: new Date().toISOString(),
      };
      await this.saveVersionRecords();
      await this.manager.reload();
      if (jey) this.setStatus(jey, 'installed', {
        latestVersion: XRAY_TUN_RELEASE,
        installedVersion: XRAY_TUN_RELEASE,
        asset: file,
        executable,
        sha256: hash,
        error: undefined,
      });
    } finally {
      releaseUpdateLock?.();
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async installXray(assetPath: string, version: string): Promise<string> {
    const extractRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-xray-extract-'));
    try {
      await (await Open.file(assetPath)).extract({ path: extractRoot });
      const binaryName = process.platform === 'win32' ? 'xray.exe' : 'xray';
      const found = await this.findFile(extractRoot, binaryName);
      if (!found) throw new Error(`В ZIP Xray-core не найден ${binaryName}`);
      const destination = path.join(this.modulesDir, 'bin', binaryName);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await this.atomicReplaceFile(found, destination, process.platform === 'win32' ? undefined : 0o755);
      const geoip = await this.findFile(extractRoot, 'geoip.dat');
      const geosite = await this.findFile(extractRoot, 'geosite.dat');
      if (geoip) await this.atomicReplaceFile(geoip, path.join(this.modulesDir, 'bin', 'geoip.dat'));
      if (geosite) await this.atomicReplaceFile(geosite, path.join(this.modulesDir, 'bin', 'geosite.dat'));
      await this.updateManifest('jey2ray', {
        executable: `./bin/${binaryName}`,
        working_dir: './bin',
        args: ['-config', './configs/vpn/generated_config.json'],
        installed_version: version,
        development: false,
      });
      return `./bin/${binaryName}`;
    } finally {
      await fs.rm(extractRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async installDirect(assetPath: string, version: string, assetName: string): Promise<string> {
    const filename = path.basename(assetName);
    if (!tgWsProxyAssetCandidates().includes(filename)) throw new Error(`Неподходящий файл TG WS Proxy: ${filename}`);
    const destination = path.join(this.modulesDir, 'bin', filename);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await this.atomicReplaceFile(assetPath, destination, process.platform === 'win32' ? undefined : 0o755);
    await this.updateManifest('tg-ws-proxy', {
      executable: `./bin/${filename}`,
      args: ['--portable'],
      working_dir: './bin',
      launch_mode: 'executable',
      worker_name: filename,
      healthcheck: { type: 'tcp', host: '127.0.0.1', port: 1443, timeout_ms: 15000 },
      upstream_log_file: './bin/TgWsProxy_data/proxy.log',
      installed_version: version,
      development: false,
    });
    return `./bin/${filename}`;
  }

  private async installZapret(assetPath: string, version: string): Promise<string> {
    const binDirectory = path.join(this.modulesDir, 'bin');
    const installRoot = path.join(binDirectory, 'zapret');
    const stagingRoot = path.join(binDirectory, `.zapret-installing-${process.pid}-${Date.now()}`);
    const backupRoot = path.join(binDirectory, `.zapret-backup-${process.pid}-${Date.now()}`);
    await fs.mkdir(binDirectory, { recursive: true });
    await fs.rm(stagingRoot, { recursive: true, force: true });
    await fs.mkdir(stagingRoot, { recursive: true });
    let previousMoved = false;
    let swapped = false;
    let committed = false;
    try {
      await (await Open.file(assetPath)).extract({ path: stagingRoot });
      const stagedExecutable = await this.findFile(stagingRoot, 'winws.exe');
      if (!stagedExecutable) throw new Error('В GitHub ZIP не найден winws.exe');
      const stagedStrategies: Record<string, string> = {};
      for (const strategy of ['general (ALT10)', 'general (ALT11)', 'general (ALT12)']) {
        const strategyPath = await this.findFile(stagingRoot, `${strategy}.bat`);
        if (strategyPath) stagedStrategies[strategy] = path.relative(stagingRoot, strategyPath);
      }
      if (!Object.keys(stagedStrategies).length) {
        throw new Error('В GitHub ZIP не найдены general (ALT10/ALT11/ALT12).bat');
      }

      await fs.rm(backupRoot, { recursive: true, force: true });
      if (existsSync(installRoot)) {
        await fs.rename(installRoot, backupRoot);
        previousMoved = true;
      }
      await fs.rename(stagingRoot, installRoot);
      swapped = true;

      const executablePath = path.join(installRoot, path.relative(stagingRoot, stagedExecutable));
      const relativeExecutable = `./${path.relative(this.modulesDir, executablePath).split(path.sep).join('/')}`;
      const executableDir = path.dirname(executablePath);
      const releaseRoot = path.basename(executableDir).toLowerCase() === 'bin' ? path.dirname(executableDir) : installRoot;
      const relativeWorkingDir = `./${path.relative(this.modulesDir, releaseRoot).split(path.sep).join('/')}`;
      const strategies: Record<string, string> = {};
      for (const [strategy, relativePath] of Object.entries(stagedStrategies)) {
        strategies[strategy] = `./${path.relative(this.modulesDir, path.join(installRoot, relativePath)).split(path.sep).join('/')}`;
      }
      await this.updateManifest('zapret', {
        executable: relativeExecutable,
        working_dir: relativeWorkingDir,
        launch_mode: 'batch',
        strategy: strategies['general (ALT10)'] ? 'general (ALT10)' : Object.keys(strategies)[0],
        strategies,
        args: ['--wf-tcp=80,443', '--hostlist=lists/list-general.txt'],
        installed_version: version,
      });
      committed = true;
      await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
      return relativeExecutable;
    } catch (error) {
      if (swapped) await fs.rm(installRoot, { recursive: true, force: true }).catch(() => undefined);
      if (previousMoved && existsSync(backupRoot)) {
        await fs.rename(backupRoot, installRoot).catch(() => undefined);
      }
      throw error;
    } finally {
      await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      if (committed || !previousMoved) await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private userFacingError(error: unknown): string {
    const candidate = error as NodeJS.ErrnoException;
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка обновления';
    const code = candidate?.code?.toUpperCase();
    if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || /\b(?:EPERM|EACCES|EBUSY)\b/i.test(message)) {
      return 'Windows временно заблокировал файл обновления. Закройте лишние экземпляры NEXUS и повторите попытку.';
    }
    if (code === 'ENOSPC' || /\bENOSPC\b/i.test(message)) {
      return 'Недостаточно свободного места для обновления. Освободите место на системном диске и повторите попытку.';
    }
    if (/fetch failed|network error|socket hang up/i.test(message)) {
      return 'Не удалось связаться с сервером обновлений. Проверьте подключение к интернету и повторите попытку.';
    }
    return message;
  }

  private async atomicReplaceFile(source: string, destination: string, mode?: number): Promise<void> {
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const staged = `${destination}.nexus-new-${suffix}`;
    const backup = `${destination}.nexus-backup-${suffix}`;
    let hadPrevious = false;
    let previousMoved = false;
    let replacementVerified = false;
    try {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      hadPrevious = existsSync(destination);
      await fs.copyFile(source, staged);
      if (mode !== undefined) await fs.chmod(staged, mode);
      const [sourceStat, stagedStat] = await Promise.all([fs.stat(source), fs.stat(staged)]);
      if (sourceStat.size !== stagedStat.size) throw new Error(`Файл ${path.basename(destination)} скопирован не полностью`);
      if (existsSync(destination)) {
        await fs.rename(destination, backup);
        previousMoved = true;
      }
      await fs.rename(staged, destination);
      const installedStat = await fs.stat(destination);
      if (installedStat.size !== sourceStat.size) throw new Error(`Файл ${path.basename(destination)} установлен не полностью`);
      replacementVerified = true;
      await fs.rm(backup, { force: true }).catch(() => undefined);
    } catch (error) {
      await fs.rm(staged, { force: true }).catch(() => undefined);
      if (!replacementVerified) {
        // If Windows refused to move a locked old file, leave that file intact.
        // Remove destination only after the old file was moved successfully, or
        // when there was no previous installation to preserve.
        if (previousMoved || !hadPrevious) await fs.rm(destination, { force: true }).catch(() => undefined);
        if (previousMoved && existsSync(backup)) await fs.rename(backup, destination).catch(() => undefined);
      }
      throw error;
    } finally {
      if (replacementVerified) await fs.rm(backup, { force: true }).catch(() => undefined);
    }
  }

  private async updateManifest(id: string, patch: Record<string, unknown>): Promise<void> {
    const entries = await fs.readdir(this.modulesDir, { withFileTypes: true });
    let manifestPath = path.join(this.modulesDir, `${id}.module.json`);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.module.json')) continue;
      try {
        const raw = JSON.parse(await fs.readFile(path.join(this.modulesDir, entry.name), 'utf8')) as { id?: string };
        if (raw.id === id) {
          manifestPath = path.join(this.modulesDir, entry.name);
          break;
        }
      } catch { /* skip broken */ }
    }
    const current = existsSync(manifestPath) ? JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown> : { id, name: id, enabled: false, args: [], status: 'stopped', pid: null, category: 'other', icon: '◈', log_file: `./logs/${id}.log` };
    await fs.writeFile(manifestPath, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, 'utf8');
  }

  private async findFile(root: string, filename: string): Promise<string | null> {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(root, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return candidate;
      if (entry.isDirectory()) {
        const nested = await this.findFile(candidate, filename);
        if (nested) return nested;
      }
    }
    return null;
  }

  private moduleExecutableExists(id: string): boolean {
    if (id === 'jey2ray') {
      const binary = process.platform === 'win32' ? 'xray.exe' : 'xray';
      return existsSync(path.join(this.modulesDir, 'bin', binary));
    }
    const module = this.manager.list().find((item) => item.id === id);
    if (!module) return false;
    const executable = path.isAbsolute(module.executable) ? module.executable : path.resolve(this.modulesDir, module.executable.replace(/^\.\//, ''));
    return existsSync(executable);
  }

  private info(target: UpdateTarget, patch: Partial<UpdateInfo> = {}): UpdateInfo {
    return { id: target.id, name: target.name, repo: target.repo, source: 'GitHub', latestVersion: null, installedVersion: this.versions[target.id]?.version ?? null, asset: null, status: 'idle', ...patch };
  }

  private setStatus(target: UpdateTarget, status: UpdateStatus, patch: Partial<UpdateInfo> = {}): void {
    const current = this.updates.get(target.id) ?? this.info(target);
    this.updates.set(target.id, { ...current, status, ...patch });
    this.emit('changed', this.list());
  }

  private loadVersionRecords(): void {
    try {
      if (existsSync(this.versionsFile)) this.versions = JSON.parse(readFileSync(this.versionsFile, 'utf8')) as Record<string, VersionRecord>;
    } catch {
      this.versions = {};
    }
  }

  private async saveVersionRecords(): Promise<void> {
    await fs.writeFile(this.versionsFile, `${JSON.stringify(this.versions, null, 2)}\n`, 'utf8');
  }

  private async sha256(filePath: string): Promise<string> {
    return await new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.once('end', () => resolve(hash.digest('hex')));
      stream.once('error', reject);
    });
  }
}
