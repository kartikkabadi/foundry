import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CursorAdapter } from '../adapters/cursor.js';
import { createCursorAdapter } from '../adapters/cursor.js';

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface DoctorDeps {
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  foundryRoot: string;
  exec(command: string, args?: string[]): ExecResult;
  fileExists(path: string): boolean;
  resolveModule(specifier: string, fromDir?: string): boolean;
  cursorAdapter: CursorAdapter;
}

function execCommand(command: string, args: string[] = []): ExecResult {
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: stdout.trim(), stderr: '' };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: String(e.stdout ?? '').trim(),
      stderr: String(e.stderr ?? e.message ?? '').trim(),
    };
  }
}

function resolveModule(specifier: string, fromDir?: string): boolean {
  try {
    const require = createRequire(fromDir ? join(fromDir, 'package.json') : import.meta.url);
    require.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

export function getFoundryRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function createDefaultDeps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  const foundryRoot = overrides.foundryRoot ?? getFoundryRoot();
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cwd: process.cwd(),
    env: process.env,
    foundryRoot,
    exec: execCommand,
    fileExists: existsSync,
    resolveModule: (specifier, fromDir) => resolveModule(specifier, fromDir ?? foundryRoot),
    cursorAdapter: createCursorAdapter(),
    ...overrides,
  };
}
