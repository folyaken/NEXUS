import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Пользовательский список сайтов для обхода DPI.
 *
 * Zapret получает домены через файл `--hostlist`. Штатные списки приходят из
 * релиза и перезаписываются при каждом обновлении, поэтому пользовательские
 * домены хранятся отдельно, в `modules/configs/dpi/custom-hostlist.txt`, и
 * подмешиваются к профилю запуска. Так добавленные сайты переживают обновление
 * ядра Zapret.
 */

/** Домены длиннее этого не бывают: 253 октета по RFC 1035. */
const MAX_HOST_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const MAX_ENTRIES = 512;

export interface DpiHostlist {
  /** Домены, добавленные пользователем, в порядке добавления. */
  hosts: string[];
  /** Абсолютный путь файла, который передаётся Zapret. */
  filePath: string;
}

/**
 * Приводит пользовательский ввод к «голому» домену.
 *
 * Люди вставляют что угодно: `https://instagram.com/`, `www.Instagram.com`,
 * `instagram.com:443`. Всё это один и тот же сайт, и в списке он должен
 * оказаться ровно один раз.
 */
export function normalizeDpiHost(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;

  // Схема, путь, порт и учётные данные отбрасываются — Zapret ждёт только хост.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split(/[/?#]/, 1)[0];
  const atIndex = value.lastIndexOf('@');
  if (atIndex >= 0) value = value.slice(atIndex + 1);
  value = value.replace(/:\d+$/, '');
  value = value.replace(/^\.+|\.+$/g, '');
  // `www.` намеренно снимается: Zapret сопоставляет и поддомены тоже.
  value = value.replace(/^www\./, '');

  if (!value || value.length > MAX_HOST_LENGTH) return null;
  // IP-адреса не поддерживаются: hostlist работает по именам из SNI.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(':')) return null;

  const labels = value.split('.');
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!label || label.length > MAX_LABEL_LENGTH) return null;
    if (!/^[a-z0-9\u00a1-\uffff](?:[a-z0-9\u00a1-\uffff-]*[a-z0-9\u00a1-\uffff])?$/.test(label)) return null;
  }
  // Домен верхнего уровня не бывает числовым.
  if (/^\d+$/.test(labels[labels.length - 1])) return null;

  return value;
}

export function dpiConfigDir(modulesDir: string): string {
  return path.join(modulesDir, 'configs', 'dpi');
}

export function dpiHostlistPath(modulesDir: string): string {
  return path.join(dpiConfigDir(modulesDir), 'custom-hostlist.txt');
}

function parseHostlist(content: string): string[] {
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const host = normalizeDpiHost(line);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
    if (hosts.length >= MAX_ENTRIES) break;
  }
  return hosts;
}

export async function readDpiHostlist(modulesDir: string): Promise<DpiHostlist> {
  const filePath = dpiHostlistPath(modulesDir);
  if (!existsSync(filePath)) return { hosts: [], filePath };
  try {
    return { hosts: parseHostlist(await fs.readFile(filePath, 'utf8')), filePath };
  } catch {
    return { hosts: [], filePath };
  }
}

async function writeDpiHostlist(modulesDir: string, hosts: string[]): Promise<DpiHostlist> {
  const filePath = dpiHostlistPath(modulesDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const header = [
    '# Пользовательские сайты для обхода DPI.',
    '# Файл создаётся NEXUS и переживает обновления Zapret.',
    '# Один домен в строке, строки с # игнорируются.',
    '',
  ].join('\n');
  await fs.writeFile(filePath, `${header}${hosts.join('\n')}${hosts.length ? '\n' : ''}`, 'utf8');
  return { hosts, filePath };
}

export async function addDpiHost(modulesDir: string, input: string): Promise<DpiHostlist> {
  const host = normalizeDpiHost(input);
  if (!host) {
    throw new Error('Введите адрес сайта, например instagram.com');
  }
  const current = await readDpiHostlist(modulesDir);
  if (current.hosts.includes(host)) {
    throw new Error(`Сайт ${host} уже есть в списке`);
  }
  if (current.hosts.length >= MAX_ENTRIES) {
    throw new Error(`Список ограничен ${MAX_ENTRIES} сайтами. Удалите лишние записи.`);
  }
  return writeDpiHostlist(modulesDir, [...current.hosts, host]);
}

const BLOCK_START = '# --- NEXUS: сайты, добавленные пользователем ---';
const BLOCK_END = '# --- NEXUS: конец пользовательского списка ---';

/**
 * Переносит пользовательские домены в рабочий список Zapret.
 *
 * Профили запуска (.bat) жёстко ссылаются на свои файлы `lists/*.txt`, поэтому
 * добавить отдельный `--hostlist` нельзя. Домены дописываются в конец рабочего
 * файла отдельным блоком между маркерами: штатное содержимое релиза остаётся
 * нетронутым, а блок целиком перезаписывается при каждом запуске. Обновление
 * Zapret затирает файл, но источник истины лежит в `configs/dpi`, поэтому блок
 * восстанавливается автоматически.
 */
export async function syncDpiHostlistInto(
  targetFile: string,
  hosts: string[],
  options: { create?: boolean } = {},
): Promise<boolean> {
  // `list-general-user.txt` создаётся service.bat при первом запуске. Если файл
  // ещё не существует, его нужно создать самим — иначе домены не применятся.
  if (!existsSync(targetFile)) {
    if (!options.create || !hosts.length) return false;
    try {
      await fs.mkdir(path.dirname(targetFile), { recursive: true });
    } catch {
      return false;
    }
  }

  let original: string;
  try {
    original = existsSync(targetFile) ? await fs.readFile(targetFile, 'utf8') : '';
  } catch {
    return false;
  }

  const startIndex = original.indexOf(BLOCK_START);
  const base = startIndex >= 0 ? original.slice(0, startIndex).replace(/\s+$/, '') : original.replace(/\s+$/, '');
  const block = hosts.length
    ? [BLOCK_START, ...hosts, BLOCK_END, ''].join('\n')
    : '';
  const next = block ? `${base}\n\n${block}` : `${base}\n`;
  if (next === original) return false;

  await fs.writeFile(targetFile, next, 'utf8');
  return true;
}

export async function removeDpiHost(modulesDir: string, input: string): Promise<DpiHostlist> {
  const host = normalizeDpiHost(input);
  const current = await readDpiHostlist(modulesDir);
  if (!host || !current.hosts.includes(host)) return current;
  return writeDpiHostlist(modulesDir, current.hosts.filter((item) => item !== host));
}
