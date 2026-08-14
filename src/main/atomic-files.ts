import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const TRANSACTION_PREFIX = '.nexus-transaction-';
const READY_MARKER = 'READY';
const COMMITTED_MARKER = 'COMMITTED';
const MANIFEST_FILE = 'manifest.json';
const MAX_TRANSACTION_FILES = 10_000;
const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9_.-]{0,100}$/i;

type ManifestOperation = {
  name: string;
  action: 'write' | 'remove';
  hadOriginal: boolean;
};

type TransactionManifest = {
  version: 1;
  operations: ManifestOperation[];
};

export type AtomicFileWrite = {
  name: string;
  content: string;
};

export type AtomicFileTransaction = {
  writes: AtomicFileWrite[];
  removals?: string[];
};

export type AtomicFileTransactionHooks = {
  /** Deterministic failure injection used by the transaction regression test. */
  beforeApply?: (name: string, index: number) => void | Promise<void>;
};

function assertSafeName(name: string): void {
  if (!SAFE_FILE_NAME.test(name) || name === '.' || name === '..' || path.basename(name) !== name) {
    throw new Error('Недопустимое имя файла транзакции');
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('Ожидался обычный файл транзакции');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function writeDurable(filePath: string, content: string): Promise<void> {
  const handle = await fs.open(filePath, 'wx');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function createDurableMarker(directory: string, name: string, content: string): Promise<void> {
  const temporary = path.join(directory, `${name}.tmp`);
  await writeDurable(temporary, content);
  await fs.rename(temporary, path.join(directory, name));
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await fs.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch {
    // Windows does not consistently allow opening directories. File sync plus same-volume
    // renames still provides the recoverable transaction semantics used below.
  }
}

function validateManifest(value: unknown): TransactionManifest {
  if (!value || typeof value !== 'object') throw new Error('Повреждён журнал файловой транзакции');
  const candidate = value as Partial<TransactionManifest>;
  if (candidate.version !== 1 || !Array.isArray(candidate.operations)
    || candidate.operations.length > MAX_TRANSACTION_FILES) {
    throw new Error('Повреждён журнал файловой транзакции');
  }
  const seen = new Set<string>();
  const operations: ManifestOperation[] = [];
  for (const item of candidate.operations) {
    if (!item || typeof item !== 'object') throw new Error('Повреждён журнал файловой транзакции');
    const operation = item as Partial<ManifestOperation>;
    if (typeof operation.name !== 'string'
      || (operation.action !== 'write' && operation.action !== 'remove')
      || typeof operation.hadOriginal !== 'boolean') {
      throw new Error('Повреждён журнал файловой транзакции');
    }
    assertSafeName(operation.name);
    const key = operation.name.toLowerCase();
    if (seen.has(key)) throw new Error('Повреждён журнал файловой транзакции');
    seen.add(key);
    operations.push({
      name: operation.name,
      action: operation.action,
      hadOriginal: operation.hadOriginal,
    });
  }
  return { version: 1, operations };
}

async function readManifest(transactionDir: string): Promise<TransactionManifest> {
  const manifestPath = path.join(transactionDir, MANIFEST_FILE);
  const stat = await fs.stat(manifestPath);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Повреждён журнал файловой транзакции');
  return validateManifest(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
}

async function rollbackTransaction(root: string, transactionDir: string, manifest: TransactionManifest): Promise<void> {
  const backupDir = path.join(transactionDir, 'backup');
  for (const operation of [...manifest.operations].reverse()) {
    const target = path.join(root, operation.name);
    const backup = path.join(backupDir, operation.name);
    if (await pathExists(backup)) {
      await fs.rm(target, { force: true });
      await fs.rename(backup, target);
    } else if (!operation.hadOriginal) {
      await fs.rm(target, { force: true });
    }
  }
  await syncDirectory(root);
}

/**
 * Recover interrupted transactions before profile files are loaded.
 * A transaction without READY never touched destination files. A transaction without
 * COMMITTED is rolled back; a committed one only needs its backup directory removed.
 */
export async function recoverAtomicFileTransactions(root: string): Promise<number> {
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  let recovered = 0;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !entry.name.startsWith(TRANSACTION_PREFIX)) continue;
    const transactionDir = path.join(root, entry.name);
    const ready = await pathExists(path.join(transactionDir, READY_MARKER));
    if (!ready) {
      await fs.rm(transactionDir, { recursive: true, force: true });
      recovered += 1;
      continue;
    }
    const manifest = await readManifest(transactionDir);
    const committed = await pathExists(path.join(transactionDir, COMMITTED_MARKER));
    if (!committed) await rollbackTransaction(root, transactionDir, manifest);
    await fs.rm(transactionDir, { recursive: true, force: true });
    recovered += 1;
  }
  return recovered;
}

/**
 * Replace a related set of files as one recoverable transaction. Destination files are
 * changed only after every new file has been fully written and synced in a staging folder.
 */
export async function commitAtomicFileTransaction(
  root: string,
  transaction: AtomicFileTransaction,
  hooks: AtomicFileTransactionHooks = {},
): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const writeNames = new Set<string>();
  const writes = transaction.writes.map((write) => {
    assertSafeName(write.name);
    if (typeof write.content !== 'string') throw new Error('Некорректное содержимое файловой транзакции');
    const key = write.name.toLowerCase();
    if (writeNames.has(key)) throw new Error('Повторяющийся файл в транзакции');
    writeNames.add(key);
    return write;
  });
  const removals: string[] = [];
  for (const name of transaction.removals ?? []) {
    assertSafeName(name);
    const key = name.toLowerCase();
    if (writeNames.has(key)) continue;
    if (removals.some((existing) => existing.toLowerCase() === key)) continue;
    removals.push(name);
  }
  if (writes.length + removals.length > MAX_TRANSACTION_FILES) {
    throw new Error('Слишком много файлов в транзакции');
  }
  if (!writes.length && !removals.length) return;

  const transactionDir = path.join(root, `${TRANSACTION_PREFIX}${randomUUID()}`);
  const stagedDir = path.join(transactionDir, 'staged');
  const backupDir = path.join(transactionDir, 'backup');
  await fs.mkdir(stagedDir, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });

  let manifest: TransactionManifest | undefined;
  let ready = false;
  let committed = false;
  let rolledBack = false;
  try {
    for (const write of writes) {
      await writeDurable(path.join(stagedDir, write.name), write.content);
    }
    const operations: ManifestOperation[] = [];
    for (const write of writes) {
      operations.push({
        name: write.name,
        action: 'write',
        hadOriginal: await pathExists(path.join(root, write.name)),
      });
    }
    for (const name of removals) {
      operations.push({
        name,
        action: 'remove',
        hadOriginal: await pathExists(path.join(root, name)),
      });
    }
    manifest = { version: 1, operations };
    await writeDurable(path.join(transactionDir, MANIFEST_FILE), `${JSON.stringify(manifest)}\n`);
    await createDurableMarker(transactionDir, READY_MARKER, 'ready\n');
    ready = true;
    await syncDirectory(transactionDir);

    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      await hooks.beforeApply?.(operation.name, index);
      const target = path.join(root, operation.name);
      const backup = path.join(backupDir, operation.name);
      if (operation.hadOriginal) await fs.rename(target, backup);
      if (operation.action === 'write') {
        await fs.rename(path.join(stagedDir, operation.name), target);
      }
    }
    await syncDirectory(root);
    await createDurableMarker(transactionDir, COMMITTED_MARKER, 'committed\n');
    committed = true;
    await syncDirectory(transactionDir);
  } catch (error) {
    if (ready && manifest && !committed) {
      try {
        await rollbackTransaction(root, transactionDir, manifest);
        rolledBack = true;
      } catch {
        throw new Error('Не удалось завершить файловую транзакцию; восстановление будет повторено при следующем запуске');
      }
    }
    throw error;
  } finally {
    if (committed || rolledBack || !ready) {
      await fs.rm(transactionDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  await fs.rm(transactionDir, { recursive: true, force: true }).catch(() => undefined);
}
