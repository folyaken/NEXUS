import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function listPidsByImage(imageName: string): Promise<number[]> {
  const name = imageName.toLowerCase();
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], {
        windowsHide: true,
        timeout: 4000,
      });
      return stdout
        .split(/\r?\n/)
        .map((line) => {
          const cols = line.split('","').map((part) => part.replace(/^"|"$/g, ''));
          if (cols[0]?.toLowerCase() !== name) return null;
          const pid = Number(cols[1]);
          return Number.isFinite(pid) ? pid : null;
        })
        .filter((pid): pid is number => pid !== null);
    }

    const { stdout } = await execFileAsync('pgrep', ['-x', imageName], { timeout: 4000 });
    return stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
  } catch {
    return [];
  }
}

export async function waitForExit(child: { once: (event: 'exit', listener: () => void) => void; killed?: boolean; exitCode?: number | null; signalCode?: string | null }, timeoutMs = 8000): Promise<void> {
  if ((child.exitCode !== null && child.exitCode !== undefined) || child.signalCode) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
