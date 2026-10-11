import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Перенос данных со «старого места».
 *
 * Одна из прошлых сборок размещала свой каталог данных внутри
 * `userData/chromium-cache/nexus-network-tools`. Из-за этого на машинах,
 * где такая версия стояла раньше, оставались две параллельные «вселенные»:
 * новые версии работали с данными в `userData`, а настройки, профиль и
 * загруженные ядра лежали в забытой вложенной папке — пользователь видел
 * «пустую» программу и качал Zapret заново, а старый каталог бесконечно
 * напоминал о себе сообщениями запускаемого из него ядра.
 *
 * Функция переносит всё ценное в настоящий `userData` и убирает вложенную
 * копию. Файлы, занятые работающей старой копией (такое бывает, пока та не
 * удалена), пропускаются без ошибки — перенос завершится при одном из
 * следующих запусков, когда мешающий процесс будет закрыт.
 */

/** Вложенная папка внутри chromium-cache, в которую писала старая сборка. */
export const LEGACY_DATA_SUBPATH = path.join('chromium-cache', 'nexus-network-tools');

/** Файлы первого уровня, без которых программа считает себя «пустой». */
const TOP_LEVEL_FILES = ['settings.json', 'profile.json'] as const;

export interface MigrationResult {
  /** Нашлась ли старая папка. */
  found: boolean;
  /** Имена файлов и каталогов, перенесённых в настоящий userData. */
  moved: string[];
  /** Имена файлов, которые не удалось убрать из старой папки (заняты). */
  locked: string[];
}

/** Что делать с одним файлом верхнего уровня: копировать, если цели ещё нет. */
async function migrateTopLevelFile(legacyDir: string, userDataDir: string, name: string, moved: string[]): Promise<void> {
  const source = path.join(legacyDir, name);
  const target = path.join(userDataDir, name);
  // Чужие настройки не перекрываем: у пользователя уже есть свои.
  if (!existsSync(source) || existsSync(target)) return;
  await fs.copyFile(source, target);
  moved.push(name);
}

/**
 * Ядра (modules/bin) переносятся целиком, но без затирания: скачанное новой
 * версией новее вложенного в старую копию. Так же копирует ядро и установщик
 * (adoptBundledBinaries) — правило одно для всех источников.
 */
async function migrateModules(legacyDir: string, userDataDir: string, moved: string[]): Promise<void> {
  const source = path.join(legacyDir, 'modules');
  if (!existsSync(source)) return;
  const target = path.join(userDataDir, 'modules');
  await fs.mkdir(target, { recursive: true });
  await fs.cp(source, target, { recursive: true, force: false, errorOnExist: false });
  moved.push(path.join('modules', '…'));
}

/** Убирает вложенную копию; занятые файлы перечисляет, но не считает ошибкой. */
async function removeLegacyTree(legacyDir: string, locked: string[]): Promise<void> {
  for (const entry of await fs.readdir(legacyDir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(legacyDir, entry.name);
    try {
      await fs.rm(full, { recursive: true, force: true });
    } catch {
      locked.push(entry.name);
    }
  }
  try {
    await fs.rmdir(legacyDir);
  } catch {
    locked.push('.');
  }
}

export async function migrateLegacyUserData(userDataDir: string): Promise<MigrationResult> {
  const legacyDir = path.join(userDataDir, LEGACY_DATA_SUBPATH);
  if (!existsSync(legacyDir)) return { found: false, moved: [], locked: [] };

  const moved: string[] = [];
  const locked: string[] = [];
  for (const name of TOP_LEVEL_FILES) {
    await migrateTopLevelFile(legacyDir, userDataDir, name, moved);
  }
  await migrateModules(legacyDir, userDataDir, moved);
  await removeLegacyTree(legacyDir, locked);
  return { found: true, moved, locked };
}
