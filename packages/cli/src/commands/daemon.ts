import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectFoundryDir } from '@foundry/core/state/run-writer.js';
import {
  defaultCliPath,
  isProcessAlive,
  spawnDetachedDaemon,
  stopDaemonProcess,
} from '../daemon/process.js';

export function daemonPidPath(projectRoot: string): string {
  return join(getProjectFoundryDir(projectRoot), 'daemon.pid');
}

export function daemonHeartbeatPath(projectRoot: string): string {
  return join(getProjectFoundryDir(projectRoot), 'daemon.heartbeat');
}

export function daemonStart(projectRoot: string): { started: boolean; pid: number } {
  mkdirSync(getProjectFoundryDir(projectRoot), { recursive: true });
  const pidPath = daemonPidPath(projectRoot);
  if (process.env.FOUNDRY_DAEMON_MOCK === '1') {
    const mockPid = 42_042;
    writeFileSync(pidPath, String(mockPid), 'utf8');
    writeFileSync(daemonHeartbeatPath(projectRoot), new Date().toISOString(), 'utf8');
    return { started: true, pid: mockPid };
  }
  if (existsSync(pidPath)) {
    const existing = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
    if (Number.isFinite(existing) && isProcessAlive(existing)) {
      return { started: false, pid: existing };
    }
  }

  const pid = spawnDetachedDaemon({
    cliPath: defaultCliPath(),
    projectRoot,
    pidPath,
    heartbeatPath: daemonHeartbeatPath(projectRoot),
  });
  return { started: true, pid };
}

export function daemonStop(projectRoot: string): { stopped: boolean; pid?: number } {
  const pidPath = daemonPidPath(projectRoot);
  const heartbeatPath = daemonHeartbeatPath(projectRoot);

  if (process.env.FOUNDRY_DAEMON_MOCK === '1') {
    let pid: number | undefined;
    let hadPidFile = false;
    if (existsSync(pidPath)) {
      hadPidFile = true;
      const parsed = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        pid = parsed;
      }
      unlinkSync(pidPath);
    }
    if (existsSync(heartbeatPath)) {
      unlinkSync(heartbeatPath);
    }
    return { stopped: hadPidFile, pid };
  }

  const result = stopDaemonProcess(pidPath);
  if (existsSync(heartbeatPath)) {
    unlinkSync(heartbeatPath);
  }
  return result;
}

export function daemonStatus(projectRoot: string): {
  running: boolean;
  pid?: number;
  stale?: boolean;
} {
  const pidPath = daemonPidPath(projectRoot);
  if (!existsSync(pidPath)) {
    return { running: false };
  }
  const raw = readFileSync(pidPath, 'utf8').trim();
  const numeric = Number.parseInt(raw, 10);
  if (process.env.FOUNDRY_DAEMON_MOCK === '1') {
    return {
      running: true,
      pid: Number.isInteger(numeric) && numeric > 0 ? numeric : undefined,
    };
  }
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return { running: false, stale: true };
  }
  if (!isProcessAlive(numeric)) {
    return { running: false, stale: true, pid: numeric };
  }
  return { running: true, pid: numeric };
}

function runDaemonWatch(projectRoot: string): void {
  const heartbeatPath = daemonHeartbeatPath(projectRoot);
  mkdirSync(getProjectFoundryDir(projectRoot), { recursive: true });
  writeFileSync(heartbeatPath, new Date().toISOString(), 'utf8');
  const interval = setInterval(() => {
    writeFileSync(heartbeatPath, new Date().toISOString(), 'utf8');
  }, 5000);
  process.on('SIGTERM', () => {
    clearInterval(interval);
    process.exit(0);
  });
}

export function runDaemon(args: string[]): void {
  if (args[0] === 'run') {
    let projectRoot = process.cwd();
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--project') {
        projectRoot = args[++i] ?? projectRoot;
      }
    }
    runDaemonWatch(projectRoot);
    return;
  }

  const sub = args[0];
  const projectRoot = process.cwd();

  if (!sub || !['start', 'stop', 'status'].includes(sub)) {
    console.error('Usage: foundry daemon start|stop|status|run');
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
  } else if (status.stale) {
    console.log(`Daemon not running (stale pid file${status.pid ? `: ${status.pid}` : ''})`);
  } else {
    console.log('Daemon not running');
  }
  process.exit(0);
}
