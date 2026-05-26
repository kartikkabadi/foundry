import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function spawnDetachedDaemon(options: {
  cliPath: string;
  projectRoot: string;
  pidPath: string;
  heartbeatPath: string;
}): number {
  const child = spawn(
    process.execPath,
    [options.cliPath, 'daemon', 'run', '--project', options.projectRoot],
    {
      detached: true,
      stdio: 'ignore',
      cwd: options.projectRoot,
      env: { ...process.env },
    },
  );
  child.unref();
  const pid = child.pid;
  if (!pid) {
    throw new Error('Failed to start daemon child process');
  }
  writeFileSync(options.pidPath, String(pid), 'utf8');
  writeFileSync(options.heartbeatPath, new Date().toISOString(), 'utf8');
  return pid;
}

export function stopDaemonProcess(pidPath: string): { stopped: boolean; pid?: number } {
  if (!existsSync(pidPath)) {
    return { stopped: false };
  }
  const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
  if (!Number.isFinite(pid)) {
    unlinkSync(pidPath);
    return { stopped: false };
  }
  if (isProcessAlive(pid)) {
    process.kill(pid, 'SIGTERM');
  }
  unlinkSync(pidPath);
  return { stopped: true, pid };
}

export function defaultCliPath(): string {
  return join(fileURLToPath(new URL('../../bin/foundry.js', import.meta.url)));
}
