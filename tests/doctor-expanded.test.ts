import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DoctorDeps } from '@foundry/doctor/deps.js';
import type { CursorAdapter } from '@foundry/adapters/cursor.js';
import {
  checkBrowserCapture,
  checkComposer25Fast,
  checkCuadriverComputerUse,
  checkPiRuntime,
  checkSkillsTeamPacks,
} from '@foundry/doctor/checks/index.js';
import { runDoctorChecks } from '@foundry/doctor/run.js';
import { parseDoctorReport } from '@foundry/core/schema/doctor-report.js';

function mockDeps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-doctor-expanded-'));
  const distDir = path.join(tmpRoot, 'packages', 'cli', 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'cli.js'), '#!/usr/bin/env node\n', 'utf8');

  const cursorAdapter: CursorAdapter = {
    async smokeComposerStandard() {
      return { ok: true, message: 'standard ok' };
    },
    async smokeComposerFast() {
      return { ok: true, message: 'fast ok' };
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
      const table: Record<string, { ok: boolean; stdout: string; stderr: string }> = {
        'npm::--version': { ok: true, stdout: '10.0.0', stderr: '' },
        'pi::--version': { ok: true, stdout: 'pi 1.0.0', stderr: '' },
        'pi::run --version': { ok: true, stdout: 'pi runtime 1.0.0', stderr: '' },
        'which::pi': { ok: true, stdout: '/usr/local/bin/pi', stderr: '' },
        'which::cuadriver': { ok: true, stdout: '/usr/local/bin/cuadriver', stderr: '' },
        'npx::playwright --version': { ok: true, stdout: '1.0.0', stderr: '' },
      };
      return table[key] ?? { ok: false, stdout: '', stderr: `${key} not mocked` };
    },
    fileExists(p: string) {
      return fs.existsSync(p);
    },
    resolveModule(specifier: string) {
      return specifier === '@cursor/sdk';
    },
    cursorAdapter,
    skillsDir: path.join(tmpRoot, '.cursor', 'skills'),
  };

  return { ...base, ...overrides };
}

describe('expanded doctor checks (V2-8)', () => {
  it('checkPiRuntime passes when pi runtime responds', () => {
    assert.strictEqual(checkPiRuntime(mockDeps()).status, 'pass');
  });

  it('checkPiRuntime fails when pi runtime unavailable', () => {
    const deps = mockDeps({
      exec(command: string, args: string[] = []) {
        if (command === 'pi' && args[0] === 'run') {
          return { ok: false, stdout: '', stderr: 'runtime missing' };
        }
        if (command === 'pi') return { ok: true, stdout: 'pi 1.0.0', stderr: '' };
        if (command === 'npm') return { ok: true, stdout: '10.0.0', stderr: '' };
        return { ok: false, stdout: '', stderr: '' };
      },
    });
    assert.strictEqual(checkPiRuntime(deps).status, 'fail');
  });

  it('checkComposer25Fast skips without --deep', async () => {
    const result = await checkComposer25Fast(mockDeps(), { deep: false, explicit: false });
    assert.strictEqual(result.status, 'skip');
  });

  it('checkComposer25Fast warns on failure unless explicit', async () => {
    const deps = mockDeps({
      cursorAdapter: {
        async smokeComposerStandard() {
          return { ok: true, message: 'ok' };
        },
        async smokeComposerFast() {
          return { ok: false, message: 'fast unavailable' };
        },
      },
    });
    const warned = await checkComposer25Fast(deps, { deep: true, explicit: false });
    assert.strictEqual(warned.status, 'warn');

    const failed = await checkComposer25Fast(deps, { deep: true, explicit: true });
    assert.strictEqual(failed.status, 'fail');
  });

  it('checkBrowserCapture warns when playwright missing', () => {
    const deps = mockDeps({
      exec() {
        return { ok: false, stdout: '', stderr: 'missing' };
      },
    });
    assert.strictEqual(checkBrowserCapture(deps).status, 'warn');
  });

  it('checkBrowserCapture passes when capture probe succeeds', () => {
    assert.strictEqual(checkBrowserCapture(mockDeps()).status, 'pass');
  });

  it('checkCuadriverComputerUse warns when cuadriver missing', () => {
    const deps = mockDeps({
      exec() {
        return { ok: false, stdout: '', stderr: 'missing' };
      },
    });
    assert.strictEqual(checkCuadriverComputerUse(deps, false).status, 'warn');
  });

  it('checkCuadriverComputerUse passes when cuadriver available', () => {
    assert.strictEqual(checkCuadriverComputerUse(mockDeps(), true).status, 'pass');
  });

  it('checkSkillsTeamPacks warns when skills dir missing', () => {
    assert.strictEqual(checkSkillsTeamPacks(mockDeps()).status, 'warn');
  });

  it('checkSkillsTeamPacks passes when skills dir exists', () => {
    const deps = mockDeps();
    fs.mkdirSync(deps.skillsDir!, { recursive: true });
    fs.writeFileSync(path.join(deps.skillsDir!, 'team-pack.md'), '# team', 'utf8');
    assert.strictEqual(checkSkillsTeamPacks(deps).status, 'pass');
  });
});

describe('expanded doctor matrix --for all', () => {
  it('includes expanded optional checks in JSON report', async () => {
    const deps = mockDeps();
    fs.mkdirSync(path.join(deps.cwd, '.foundry'), { recursive: true });
    fs.writeFileSync(path.join(deps.cwd, '.foundry', 'config.toml'), 'version = 1\n', 'utf8');
    fs.mkdirSync(deps.skillsDir!, { recursive: true });

    const report = await runDoctorChecks(deps, {
      forTarget: 'all',
      deep: true,
      strict: false,
      composerFastExplicit: false,
    });

    const ids = report.checks.map((c) => c.id);
    for (const id of [
      'pi-runtime',
      'composer-2.5-fast',
      'browser-capture',
      'cuadriver-computer-use',
      'skills-team-packs',
    ]) {
      assert.ok(ids.includes(id), `missing check ${id}`);
    }

    parseDoctorReport(report);
    assert.strictEqual(report.exitCode, 0);
  });

  it('--for plan excludes expanded optional checks', async () => {
    const deps = mockDeps();
    fs.mkdirSync(path.join(deps.cwd, '.foundry'), { recursive: true });
    fs.writeFileSync(path.join(deps.cwd, '.foundry', 'config.toml'), 'version = 1\n', 'utf8');

    const report = await runDoctorChecks(deps, {
      forTarget: 'plan',
      deep: false,
      strict: false,
      composerFastExplicit: false,
    });

    const expanded = [
      'pi-runtime',
      'composer-2.5-fast',
      'browser-capture',
      'cuadriver-computer-use',
      'skills-team-packs',
    ];
    assert.ok(expanded.every((id) => !report.checks.some((c) => c.id === id)));
  });
});
