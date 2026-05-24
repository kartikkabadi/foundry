import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DoctorDeps } from '../src/doctor/deps.ts';
import {
  checkComposer25Standard,
  checkCursorSdk,
  checkFoundryInstall,
  checkNodePackageManager,
  checkPiCli,
  checkProjectFoundryConfig,
  checkSystem,
} from '../src/doctor/checks/index.ts';
import { computeExitCode, runDoctorChecks } from '../src/doctor/run.ts';
import { formatDoctorJson, formatDoctorTable } from '../src/doctor/report.ts';
import { DOCTOR_SCHEMA_VERSION } from '../src/types/doctor.ts';
import type { CursorAdapter } from '../src/adapters/cursor.ts';

function mockDeps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-doctor-'));
  const distDir = path.join(tmpRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'cli.js'), '#!/usr/bin/env node\n', 'utf8');

  const commands = new Map<string, { ok: boolean; stdout: string; stderr: string }>([
    ['npm::--version', { ok: true, stdout: '10.0.0', stderr: '' }],
    ['pnpm::--version', { ok: false, stdout: '', stderr: 'not found' }],
    ['pi::--version', { ok: true, stdout: 'pi 1.0.0', stderr: '' }],
    ['which::pi', { ok: true, stdout: '/usr/local/bin/pi', stderr: '' }],
    ['gh::auth status', { ok: true, stdout: 'logged in', stderr: '' }],
    ['git::worktree list', { ok: true, stdout: '', stderr: '' }],
    ['git::remote get-url origin', { ok: true, stdout: 'git@github.com:org/repo.git', stderr: '' }],
  ]);

  const cursorAdapter: CursorAdapter = {
    async smokeComposerStandard() {
      return { ok: true, message: 'Composer 2.5 Standard smoke passed (mock)' };
    },
  };

  const base: DoctorDeps = {
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: 'v22.0.0',
    cwd: tmpRoot,
    env: { CURSOR_API_KEY: 'test-key' },
    foundryRoot: tmpRoot,
    piAuthPath: path.join(tmpRoot, 'missing-auth.json'),
    exec(command: string, args: string[] = []) {
      const key = `${command}::${args.join(' ')}`;
      return commands.get(key) ?? { ok: false, stdout: '', stderr: `${key} not mocked` };
    },
    fileExists(p: string) {
      return fs.existsSync(p);
    },
    resolveModule(specifier: string) {
      return specifier === '@cursor/sdk';
    },
    cursorAdapter,
  };

  return { ...base, ...overrides };
}

describe('doctor checks (injected deps, no network)', () => {
  it('checkSystem passes for known platform/arch', () => {
    const result = checkSystem(mockDeps());
    assert.strictEqual(result.status, 'pass');
    assert.match(result.message, /darwin\/arm64/);
  });

  it('checkSystem fails for unknown platform', () => {
    const result = checkSystem(mockDeps({ platform: 'unknown' as NodeJS.Platform }));
    assert.strictEqual(result.status, 'fail');
  });

  it('checkNodePackageManager passes when npm available', () => {
    const result = checkNodePackageManager(mockDeps());
    assert.strictEqual(result.status, 'pass');
    assert.match(result.message, /npm/);
  });

  it('checkNodePackageManager fails when neither npm nor pnpm available', () => {
    const deps = mockDeps({
      exec() {
        return { ok: false, stdout: '', stderr: 'missing' };
      },
    });
    assert.strictEqual(checkNodePackageManager(deps).status, 'fail');
  });

  it('checkFoundryInstall passes with Node 20+ and built CLI', () => {
    assert.strictEqual(checkFoundryInstall(mockDeps()).status, 'pass');
  });

  it('checkFoundryInstall fails when dist/cli.js missing', () => {
    const deps = mockDeps({ foundryRoot: path.join(os.tmpdir(), 'no-cli-' + Date.now()) });
    assert.strictEqual(checkFoundryInstall(deps).status, 'fail');
  });

  it('checkPiCli passes when pi responds', () => {
    assert.strictEqual(checkPiCli(mockDeps()).status, 'pass');
  });

  it('checkCursorSdk passes with API key and resolvable SDK', () => {
    assert.strictEqual(checkCursorSdk(mockDeps()).status, 'pass');
  });

  it('checkCursorSdk fails without CURSOR_API_KEY or Pi auth', () => {
    const deps = mockDeps({ env: {} });
    assert.strictEqual(checkCursorSdk(deps).status, 'fail');
  });

  it('checkCursorSdk passes with Pi auth fallback', () => {
    const authPath = path.join(os.tmpdir(), `foundry-pi-auth-${Date.now()}.json`);
    fs.writeFileSync(
      authPath,
      JSON.stringify({ cursor: { type: 'api_key', key: 'pi-test-key' } }),
      'utf8',
    );
    const deps = mockDeps({ env: {}, piAuthPath: authPath });
    assert.strictEqual(checkCursorSdk(deps).status, 'pass');
    fs.unlinkSync(authPath);
  });

  it('checkComposer25Standard skips without --deep', async () => {
    const result = await checkComposer25Standard(mockDeps(), false);
    assert.strictEqual(result.status, 'skip');
  });

  it('checkComposer25Standard passes with --deep and mock adapter', async () => {
    const result = await checkComposer25Standard(mockDeps(), true);
    assert.strictEqual(result.status, 'pass');
  });

  it('checkComposer25Standard fails when mock adapter returns not ok', async () => {
    const deps = mockDeps({
      cursorAdapter: {
        async smokeComposerStandard() {
          return { ok: false, message: 'Composer unavailable' };
        },
      },
    });
    const result = await checkComposer25Standard(deps, true);
    assert.strictEqual(result.status, 'fail');
  });

  it('checkProjectFoundryConfig warns when config missing', () => {
    const result = checkProjectFoundryConfig(mockDeps());
    assert.strictEqual(result.status, 'warn');
  });

  it('checkProjectFoundryConfig passes when config exists', () => {
    const deps = mockDeps();
    const configDir = path.join(deps.cwd, '.foundry');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.toml'), 'version = 1\n', 'utf8');
    assert.strictEqual(checkProjectFoundryConfig(deps).status, 'pass');
  });
});

describe('doctor run + report', () => {
  it('runDoctorChecks --for plan includes only required checks', async () => {
    const deps = mockDeps();
    const configDir = path.join(deps.cwd, '.foundry');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.toml'), 'version = 1\n', 'utf8');

    const report = await runDoctorChecks(deps, {
      forTarget: 'plan',
      deep: false,
      strict: false,
    });

    assert.strictEqual(report.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.strictEqual(report.for, 'plan');
    assert.strictEqual(report.checks.length, 7);
    assert.ok(report.checks.every((c) => c.id !== 'git-github'));
    assert.strictEqual(report.exitCode, 0);
  });

  it('runDoctorChecks exits 1 when required check fails', async () => {
    const deps = mockDeps({
      exec(command: string, args: string[] = []) {
        if (command === 'pi') return { ok: false, stdout: '', stderr: 'missing' };
        if (command === 'which' && args[0] === 'pi') return { ok: false, stdout: '', stderr: '' };
        if (command === 'npm') return { ok: true, stdout: '10.0.0', stderr: '' };
        return { ok: false, stdout: '', stderr: '' };
      },
    });

    const report = await runDoctorChecks(deps, {
      forTarget: 'plan',
      deep: false,
      strict: false,
    });

    assert.strictEqual(report.exitCode, 1);
    assert.ok(report.checks.some((c) => c.id === 'pi-cli' && c.status === 'fail'));
  });

  it('computeExitCode strict treats warn as failure', () => {
    const checks = [{ id: 'project-foundry-config' as const, status: 'warn' as const, message: 'missing' }];
    assert.strictEqual(computeExitCode(checks, false), 0);
    assert.strictEqual(computeExitCode(checks, true), 1);
  });

  it('formatDoctorTable renders readable output', async () => {
    const report = await runDoctorChecks(mockDeps(), {
      forTarget: 'plan',
      deep: false,
      strict: false,
    });
    const table = formatDoctorTable(report);
    assert.ok(table.includes('Foundry doctor'));
    assert.ok(table.includes('system'));
    assert.ok(table.includes('Exit code:'));
  });

  it('formatDoctorJson emits stable DoctorReport schema', async () => {
    const report = await runDoctorChecks(mockDeps(), {
      forTarget: 'plan',
      deep: false,
      strict: false,
    });
    const parsed = JSON.parse(formatDoctorJson(report));
    assert.strictEqual(parsed.schemaVersion, '1');
    assert.ok(Array.isArray(parsed.checks));
    assert.ok([0, 1, 2].includes(parsed.exitCode));
  });
});
