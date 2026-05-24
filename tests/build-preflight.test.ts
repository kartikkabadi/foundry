import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BuildPreflightError,
  executeBuild,
  runBuildPreflight,
} from '@foundry/planner/build/orchestrate.js';
import {
  mergeDoctorCheckOptions,
  resolvePreflightOptions,
} from '@foundry/doctor/preflight-options.js';
import { createDefaultDeps } from '@foundry/doctor/deps.js';
import { createRun, initProject } from '@foundry/core/state/run-writer.js';
import {
  FIXTURE_ISSUE_PLAN,
  mockBuildDeps,
  mockDoctorDeps,
  seedApprovedBuildRun,
} from './build-fixtures.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'packages', 'cli', 'bin', 'foundry.js');

describe('foundry build preflight (V3-1)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-build-preflight-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('build rejects unapproved run via CLI', () => {
    initProject(projectRoot);
    createRun(projectRoot, '0.1.0', {
      status: 'awaiting_approval',
      phase: 'awaiting_approval',
    });

    assert.throws(
      () => execSync(`node "${CLI}" build`, { encoding: 'utf8', cwd: projectRoot }),
      (err: NodeJS.ErrnoException & { status?: number; stderr?: string }) => {
        assert.notStrictEqual(err.status, 0);
        assert.ok(String(err.stderr ?? '').includes('not approved'));
        return true;
      },
    );
  });

  it('resolvePreflightOptions: plan always deep; build deep unless FOUNDRY_BUILD_MOCK', () => {
    assert.strictEqual(resolvePreflightOptions('plan').deep, true);
    assert.strictEqual(resolvePreflightOptions('build', {}).deep, true);
    assert.strictEqual(resolvePreflightOptions('build', { FOUNDRY_BUILD_MOCK: '1' }).deep, false);
  });

  it('mergeDoctorCheckOptions applies mode policy when CLI omits --deep', () => {
    assert.strictEqual(
      mergeDoctorCheckOptions({ forTarget: 'build', deep: false, strict: false }, {}).deep,
      true,
    );
    assert.strictEqual(
      mergeDoctorCheckOptions(
        { forTarget: 'build', deep: false, strict: false },
        { FOUNDRY_BUILD_MOCK: '1' },
      ).deep,
      false,
    );
    assert.strictEqual(
      mergeDoctorCheckOptions({ forTarget: 'build', deep: true, strict: false }, {}).deep,
      true,
    );
  });

  it('runBuildPreflight passes with FOUNDRY_BUILD_MOCK=1 without API key', async () => {
    initProject(projectRoot);
    fs.mkdirSync(path.join(projectRoot, '.foundry'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.foundry', 'config.toml'), 'version = 1\n', 'utf8');
    const prevMock = process.env.FOUNDRY_BUILD_MOCK;
    const prevKey = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
    process.env.FOUNDRY_BUILD_MOCK = '1';
    try {
      await runBuildPreflight(projectRoot, createDefaultDeps(projectRoot));
    } finally {
      if (prevMock === undefined) delete process.env.FOUNDRY_BUILD_MOCK;
      else process.env.FOUNDRY_BUILD_MOCK = prevMock;
      if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = prevKey;
    }
  });

  it('executeBuild aborts when deep build preflight fails (non-mock)', async () => {
    const ref = seedApprovedBuildRun(projectRoot);
    const doctorDeps = mockDoctorDeps(projectRoot);
    doctorDeps.cursorAdapter = {
      async smokeComposerStandard() {
        return { ok: false, message: 'Composer smoke failed (test)' };
      },
      async smokeComposerFast() {
        return { ok: true, message: 'mock fast' };
      },
    };
    const prevMock = process.env.FOUNDRY_BUILD_MOCK;
    delete process.env.FOUNDRY_BUILD_MOCK;
    try {
      await assert.rejects(
        () =>
          executeBuild({
            projectRoot,
            ref,
            deps: { doctorDeps, workerDeps: mockBuildDeps(projectRoot).workerDeps! },
          }),
        (err: unknown) => err instanceof BuildPreflightError,
      );
    } finally {
      if (prevMock === undefined) delete process.env.FOUNDRY_BUILD_MOCK;
      else process.env.FOUNDRY_BUILD_MOCK = prevMock;
    }
  });

  it('runBuildPreflight passes with mock doctor deps', async () => {
    initProject(projectRoot);
    fs.mkdirSync(path.join(projectRoot, '.foundry'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.foundry', 'config.toml'), 'version = 1\n', 'utf8');
    await runBuildPreflight(projectRoot, mockDoctorDeps(projectRoot));
  });

  it('executeBuild dry-run leaves run in plan mode', async () => {
    const ref = seedApprovedBuildRun(projectRoot, '0.1.0', FIXTURE_ISSUE_PLAN);
    const result = await executeBuild({
      projectRoot,
      ref,
      dryRun: true,
      deps: { doctorDeps: mockDoctorDeps(projectRoot) },
    });

    assert.strictEqual(result.run.mode, 'plan');
  });

  it('approved run with issue-plan starts build execution', async () => {
    const ref = seedApprovedBuildRun(projectRoot);
    const result = await executeBuild({
      projectRoot,
      ref,
      deps: mockBuildDeps(projectRoot),
    });

    assert.strictEqual(result.run.mode, 'build');
    assert.ok(result.run.phase.startsWith('build_'));
    assert.ok(result.run.proofs && result.run.proofs.length > 0);
  });
});
