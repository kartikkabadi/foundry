import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRun, initProject } from '@foundry/core/state/run-writer.js';
import { parseRunJson, RunJsonValidationError } from '@foundry/core/schema/run-json.js';
import { parseDoctorReport, DoctorReportValidationError } from '@foundry/core/schema/doctor-report.js';
import { runDoctorChecks } from '@foundry/doctor/run.js';
import type { DoctorDeps } from '@foundry/doctor/deps.js';
import type { CursorAdapter } from '@foundry/adapters/cursor.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'packages', 'cli', 'bin', 'foundry.js');
const TEST_ROOT = path.join(os.tmpdir(), 'FOUNDRY_SCHEMA_' + process.pid + '_' + Date.now());

function validRunJson(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    run_id: 'test-run',
    foundry_version: '0.1.0',
    mode: 'plan',
    budget: 'quick',
    status: 'running',
    phase: 'init',
    composer_speed: 'standard',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    agent_pass_budget: { max_active: 5, used: 0, limit: 12 },
    artifacts: [],
    blocked_actions: [],
    next_actions: [],
    ...overrides,
  };
}

function mockDoctorDeps(): DoctorDeps {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-schema-doctor-'));
  const distDir = path.join(tmpRoot, 'packages', 'cli', 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'cli.js'), '#!/usr/bin/env node\n', 'utf8');

  const cursorAdapter: CursorAdapter = {
    async smokeComposerStandard() {
      return { ok: true, message: 'ok' };
    },
  };

  return {
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: 'v22.0.0',
    cwd: tmpRoot,
    env: { CURSOR_API_KEY: 'test-key' },
    foundryRoot: tmpRoot,
    piAuthPath: path.join(tmpRoot, 'missing-auth.json'),
    exec(command: string, args: string[] = []) {
      if (command === 'npm') return { ok: true, stdout: '10.0.0', stderr: '' };
      if (command === 'pi') return { ok: true, stdout: 'pi 1.0.0', stderr: '' };
      if (command === 'which' && args[0] === 'pi') return { ok: true, stdout: '/usr/local/bin/pi', stderr: '' };
      return { ok: false, stdout: '', stderr: 'missing' };
    },
    fileExists(p: string) {
      return fs.existsSync(p);
    },
    resolveModule(specifier: string) {
      return specifier === '@cursor/sdk';
    },
    cursorAdapter,
  };
}

describe('run.json schema validation (V2-2)', () => {
  it('parseRunJson accepts valid run.json from createRun', () => {
    const projectRoot = path.join(TEST_ROOT, 'valid-run');
    fs.mkdirSync(projectRoot, { recursive: true });
    initProject(projectRoot);
    const created = createRun(projectRoot, '0.1.0', { run_id: 'valid-run-id' });
    const raw = JSON.parse(fs.readFileSync(created.runJsonPath, 'utf8'));

    const parsed = parseRunJson(raw);
    assert.strictEqual(parsed.run_id, 'valid-run-id');
    assert.strictEqual(parsed.schema_version, 1);
  });

  it('parseRunJson rejects missing required fields with actionable error', () => {
    assert.throws(
      () => parseRunJson({ run_id: 'x' }),
      (error: unknown) => {
        assert.ok(error instanceof RunJsonValidationError);
        assert.match(error.message, /schema_version|required/i);
        return true;
      },
    );
  });

  it('parseRunJson rejects invalid enum values', () => {
    assert.throws(
      () => parseRunJson(validRunJson({ status: 'not-a-status' })),
      (error: unknown) => {
        assert.ok(error instanceof RunJsonValidationError);
        assert.match(error.message, /status/i);
        return true;
      },
    );
  });

  it('parseRunJson rejects malformed agent_pass_budget', () => {
    assert.throws(
      () => parseRunJson(validRunJson({ agent_pass_budget: { max_active: 'five' } })),
      (error: unknown) => {
        assert.ok(error instanceof RunJsonValidationError);
        assert.match(error.message, /agent_pass_budget/i);
        return true;
      },
    );
  });
});

describe('doctor JSON schema validation (V2-2)', () => {
  it('parseDoctorReport accepts runDoctorChecks output', async () => {
    const report = await runDoctorChecks(mockDoctorDeps(), {
      forTarget: 'plan',
      deep: false,
      strict: false,
    });

    const parsed = parseDoctorReport(report);
    assert.strictEqual(parsed.schemaVersion, '1');
    assert.ok(parsed.checks.length > 0);
  });

  it('parseDoctorReport rejects malformed doctor report', () => {
    assert.throws(
      () => parseDoctorReport({ schemaVersion: '1', checks: 'not-an-array' }),
      (error: unknown) => {
        assert.ok(error instanceof DoctorReportValidationError);
        return true;
      },
    );
  });
});

describe('foundry status/resume with malformed run.json (V2-2)', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = path.join(TEST_ROOT, 'cli-' + Math.random().toString(36).slice(2));
    fs.mkdirSync(projectDir, { recursive: true });
    initProject(projectDir);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('status exits non-zero when latest run.json is malformed', () => {
    const runDir = path.join(projectDir, '.foundry', 'runs', 'bad-run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ run_id: 'bad-run' }), 'utf8');

    assert.throws(
      () =>
        execSync(`node "${CLI}" status`, {
          encoding: 'utf8',
          cwd: projectDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      (err: NodeJS.ErrnoException & { status?: number; stderr?: Buffer }) => {
        assert.notStrictEqual(err.status, 0);
        const msg = String(err.stderr ?? '');
        assert.match(msg, /malformed|invalid run\.json/i);
        return true;
      },
    );
  });

  it('resume exits non-zero when paused run.json is malformed', () => {
    const runDir = path.join(projectDir, '.foundry', 'runs', 'paused-bad');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'run.json'),
      JSON.stringify({ run_id: 'paused-bad', status: 'paused' }),
      'utf8',
    );

    assert.throws(
      () =>
        execSync(`node "${CLI}" resume`, {
          encoding: 'utf8',
          cwd: projectDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      (err: NodeJS.ErrnoException & { status?: number; stderr?: Buffer }) => {
        assert.notStrictEqual(err.status, 0);
        const msg = String(err.stderr ?? '');
        assert.match(msg, /malformed|invalid run\.json/i);
        return true;
      },
    );
  });
});
