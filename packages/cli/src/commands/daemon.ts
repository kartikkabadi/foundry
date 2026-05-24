import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectFoundryDir } from '@foundry/core/state/run-writer.js';

export function daemonPidPath(projectRoot: string): string {
  return join(getProjectFoundryDir(projectRoot), 'daemon.pid');
}

export function daemonStart(projectRoot: string, pid = process.pid): { started: boolean; pid: number } {
  mkdirSync(getProjectFoundryDir(projectRoot), { recursive: true });
  const pidPath = daemonPidPath(projectRoot);
  if (existsSync(pidPath)) {
    return { started: false, pid: Number(readFileSync(pidPath, 'utf8').trim()) };
  }
  writeFileSync(pidPath, String(pid), 'utf8');
  return { started: true, pid };
}

export function daemonStop(projectRoot: string): { stopped: boolean; pid?: string } {
  const pidPath = daemonPidPath(projectRoot);
  if (!existsSync(pidPath)) {
    return { stopped: false };
  }
  const pid = readFileSync(pidPath, 'utf8').trim();
  unlinkSync(pidPath);
  return { stopped: true, pid };
}

export function daemonStatus(projectRoot: string): { running: boolean; pid?: string } {
  const pidPath = daemonPidPath(projectRoot);
  if (!existsSync(pidPath)) {
    return { running: false };
  }
  return { running: true, pid: readFileSync(pidPath, 'utf8').trim() };
}

export function runDaemon(args: string[]): void {
  const sub = args[0];
  const projectRoot = process.cwd();

  if (!sub || !['start', 'stop', 'status'].includes(sub)) {
    console.error('Usage: foundry daemon start|stop|status');
    process.exit(1);
  }

  if (sub === 'start') {
    const result = daemonStart(projectRoot);
    if (result.started) {
      console.log(`Daemon started (pid ${result.pid})`);
    } else {
      console.log(`Daemon already running (pid ${result.pid})`);
    }
    process.exit(0);
  }

  if (sub === 'stop') {
    const result = daemonStop(projectRoot);
    if (result.stopped) {
      console.log(`Daemon stopped (was pid ${result.pid})`);
    } else {
      console.log('Daemon not running');
    }
    process.exit(0);
  }

  const status = daemonStatus(projectRoot);
  if (status.running) {
    console.log(`Daemon running (pid ${status.pid})`);
  } else {
    console.log('Daemon not running');
  }
  process.exit(0);
}
