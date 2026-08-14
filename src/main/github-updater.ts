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

type GithubRelease = {
  tag_name: string;
  name: string;
  html_url: string;
  assets: { name: string; browser_download_url: string; size: number }[];
};

type UpdateTarget = {
  id: string;
  name: string;
  repo: string;
  assetKind: 'zip' | 'executable';
  selectAsset: (assets: GithubRelease['assets']) => GithubRelease['assets'][number] | undefined;
  install: (assetPath: string, version: string) => Promise<string>;
};

type VersionRecord = { version: string; asset: string; sha256: string; installedAt: string };

const GITHUB_API = 'https://api.github.com/repos';
const MAX_DOWNLOAD_REDIRECTS = 5;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const TRUSTED_MIRROR_HOSTS = new Set(['ghproxy.net', 'mirror.ghproxy.com']);

export class GithubUpdater extends EventEmitter {
  private readonly updates = new Map<string, UpdateInfo>();
  private readonly versionsFile: string;
  private versions: Record<string, VersionRecord> = {};

  constructor(private readonly modulesDir: string, private readonly manager: ModuleManager) {
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

  async ensure(id: string): Promise<void> {
    const target = this.targets.find((item) => item.id === id);
    if (!target) throw new Error(`Нет цели обновления: ${id}`);
    if (this.moduleExecutableExists(id)) return;
    await this.syncOne(target);
    if (this.moduleExecutableExists(id)) return;
    if (id === 'jey2ray') await this.installXrayFromMirrors();
    if (!this.moduleExecutableExists(id)) {
      throw new Error(this.updates.get(id)?.error || 'Не удалось скачать Xray-core. Проверь интернет / GitHub, затем «Скачать Xray».');
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
        if (process.platform === 'win32') return assets.find((asset) => asset.name === 'TgWsProxy_windows.exe');
        if (process.platform === 'linux' && os.arch() === 'x64') return assets.find((asset) => asset.name === 'TgWsProxy_linux_amd64');
        return undefined;
      },
      install: (assetPath, version) => this.installDirect(assetPath, version),
    });
    this.targets.push({
      id: 'jey2ray',
      name: 'Jey2Ray / Xray-core',
      repo: 'XTLS/Xray-core',
      assetKind: 'zip',
      selectAsset: (assets) => {
        if (process.platform === 'win32') {
          return assets.find((asset) => asset.name === 'Xray-windows-64.zip')
            || assets.find((asset) => /windows-64\.zip$/i.test(asset.name) && !/arm/i.test(asset.name));
        }
        if (process.platform === 'linux' && os.arch() === 'x64') {
          return assets.find((asset) => asset.name === 'Xray-linux-64.zip')
            || assets.find((asset) => /linux-64\.zip$/i.test(asset.name) && !/arm/i.test(asset.name));
        }
        return undefined;
      },
      install: (assetPath, version) => this.installXray(assetPath, version),
    });
    for (const target of this.targets) {
      this.updates.set(target.id, this.info(target, { status: 'checking' }));
    }
  }

  private async syncOne(target: UpdateTarget): Promise<void> {
    this.setStatus(target, 'checking');
    let tempPath: string | undefined;
    try {
      const release = await this.fetchRelease(target.repo);
      const asset = target.selectAsset(release.assets);
      if (!asset) {
        this.setStatus(target, 'unsupported', { latestVersion: release.tag_name, error: `Для ${process.platform}/${os.arch()} нет подходящего GitHub asset` });
        return;
      }
      const installed = this.versions[target.id];
      const executableExists = this.moduleExecutableExists(target.id);
      if (installed?.version === release.tag_name && executableExists) {
        this.setStatus(target, 'up-to-date', { latestVersion: release.tag_name, installedVersion: installed.version, asset: asset.name });
        return;
      }
      if (this.manager.isRunning(target.id)) throw new Error('Остановите модуль перед обновлением');

      this.setStatus(target, 'downloading', { latestVersion: release.tag_name, asset: asset.name });
      const tempDir = path.join(this.modulesDir, '.cache');
      await fs.mkdir(tempDir, { recursive: true });
      tempPath = path.join(tempDir, `${target.id}-${release.tag_name.replace(/[^a-z0-9._-]/gi, '_')}-${asset.name}`);
      await this.downloadAsset(asset.browser_download_url, tempPath, target.repo);
      await this.assertAsset(tempPath, target.assetKind, asset.size, asset.name);
      const hash = await this.sha256(tempPath);
      const executable = await target.install(tempPath, release.tag_name);
      this.versions[target.id] = { version: release.tag_name, asset: asset.name, sha256: hash, installedAt: new Date().toISOString() };
      await this.saveVersionRecords();
      await this.manager.reload();
      this.setStatus(target, 'installed', { latestVersion: release.tag_name, installedVersion: release.tag_name, asset: asset.name, executable, sha256: hash });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка GitHub updater';
      this.setStatus(target, 'error', { error: message });
    } finally {
      if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private async fetchRelease(repo: string): Promise<GithubRelease> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(`${GITHUB_API}/${repo}/releases/latest`, {
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
    const file = process.platform === 'win32' ? 'Xray-windows-64.zip' : 'Xray-linux-64.zip';
    const mirrors = [
      `https://github.com/XTLS/Xray-core/releases/latest/download/${file}`,
      `https://ghproxy.net/https://github.com/XTLS/Xray-core/releases/latest/download/${file}`,
      `https://mirror.ghproxy.com/https://github.com/XTLS/Xray-core/releases/latest/download/${file}`,
    ];
    const jey = this.targets.find((item) => item.id === 'jey2ray');
    const tempPath = path.join(this.modulesDir, '.cache', file);
    await fs.mkdir(path.dirname(tempPath), { recursive: true });
    let lastError = 'Не удалось скачать Xray ни с одного зеркала';
    try {
      for (const url of mirrors) {
        try {
          if (jey) this.setStatus(jey, 'downloading', { asset: file });
          await this.downloadAsset(url, tempPath, 'XTLS/Xray-core');
          await this.assertAsset(tempPath, 'zip', 0, file);
          await this.installXray(tempPath, 'latest');
          return;
        } catch (error) {
          lastError = error instanceof Error ? error.message : lastError;
        }
      }
      throw new Error(lastError);
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private async installXray(assetPath: string, version: string): Promise<string> {
    const extractRoot = path.join(this.modulesDir, '.cache', 'xray-extract');
    await fs.rm(extractRoot, { recursive: true, force: true });
    await fs.mkdir(extractRoot, { recursive: true });
    try {
      await (await Open.file(assetPath)).extract({ path: extractRoot });
      const binaryName = process.platform === 'win32' ? 'xray.exe' : 'xray';
      const found = await this.findFile(extractRoot, binaryName);
      if (!found) throw new Error(`В ZIP Xray-core не найден ${binaryName}`);
      const destination = path.join(this.modulesDir, 'bin', binaryName);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(found, destination);
      if (process.platform !== 'win32') await fs.chmod(destination, 0o755);
      const geoip = await this.findFile(extractRoot, 'geoip.dat');
      const geosite = await this.findFile(extractRoot, 'geosite.dat');
      if (geoip) await fs.copyFile(geoip, path.join(this.modulesDir, 'bin', 'geoip.dat'));
      if (geosite) await fs.copyFile(geosite, path.join(this.modulesDir, 'bin', 'geosite.dat'));
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

  private async installDirect(assetPath: string, version: string): Promise<string> {
    const isWindows = process.platform === 'win32';
    const filename = isWindows ? 'TgWsProxy_windows.exe' : 'TgWsProxy_linux_amd64';
    const destination = path.join(this.modulesDir, 'bin', filename);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(assetPath, destination);
    if (!isWindows) await fs.chmod(destination, 0o755);
    await this.updateManifest('tg-ws-proxy', { executable: `./bin/${filename}`, installed_version: version });
    return `./bin/${filename}`;
  }

  private async installZapret(assetPath: string, version: string): Promise<string> {
    const installRoot = path.join(this.modulesDir, 'bin', 'zapret');
    await fs.rm(installRoot, { recursive: true, force: true });
    await fs.mkdir(installRoot, { recursive: true });
    await (await Open.file(assetPath)).extract({ path: installRoot });
    const executablePath = await this.findFile(installRoot, 'winws.exe');
    if (!executablePath) throw new Error('В GitHub ZIP не найден winws.exe');
    const relativeExecutable = `./${path.relative(this.modulesDir, executablePath).split(path.sep).join('/')}`;
    const executableDir = path.dirname(executablePath);
    const releaseRoot = path.basename(executableDir).toLowerCase() === 'bin' ? path.dirname(executableDir) : installRoot;
    const relativeWorkingDir = `./${path.relative(this.modulesDir, releaseRoot).split(path.sep).join('/')}`;
    const strategies: Record<string, string> = {};
    for (const strategy of ['general (ALT10)', 'general (ALT11)', 'general (ALT12)']) {
      const strategyPath = await this.findFile(installRoot, `${strategy}.bat`);
      if (strategyPath) strategies[strategy] = `./${path.relative(this.modulesDir, strategyPath).split(path.sep).join('/')}`;
    }
    if (!strategies['general (ALT10)'] && !strategies['general (ALT11)'] && !strategies['general (ALT12)']) {
      throw new Error('В GitHub ZIP не найдены general (ALT10/ALT11/ALT12).bat');
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
    return relativeExecutable;
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
