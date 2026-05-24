import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRun, initProject } from '../src/state/run-writer.ts';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'src', 'cli.ts');

const TEST_HOME = path.join(os.tmpdir(), 'FOUNDRY_CLI_TEST_' + process.pid + '_' + Date.now());

describe('foundry CLI bootstrap (Issue 1 ACs: --version, --help, state dir)', () => {
  beforeEach(() => {
    process.env.FOUNDRY_HOME = path.join(TEST_HOME, 'home');
    fs.rmSync(process.env.FOUNDRY_HOME, { recursive: true, force: true });
  });

  afterEach(() => {
    if (process.env.FOUNDRY_HOME) {
      fs.rmSync(process.env.FOUNDRY_HOME, { recursive: true, force: true });
    }
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    delete process.env.FOUNDRY_HOME;
  });

  it('--version prints the package version (0.1.0)', () => {
    const out = execSync(`npx tsx "${CLI}" --version`, {
      encoding: 'utf8',
      env: { ...process.env, FOUNDRY_HOME: process.env.FOUNDRY_HOME }
    }).trim();
    assert.strictEqual(out, '0.1.0');
  });

  it('--help lists the v1 commands', () => {
    const out = execSync(`npx tsx "${CLI}" --help`, {
      encoding: 'utf8',
      env: { ...process.env, FOUNDRY_HOME: process.env.FOUNDRY_HOME }
    });
    assert.ok(out.includes('init'));
    assert.ok(out.includes('doctor'));
    assert.ok(out.includes('setup'));
    assert.ok(out.includes('plan'));
    assert.ok(out.includes('publish'));
    assert.ok(out.includes('status'));
    assert.ok(out.includes('pause'));
    assert.ok(out.includes('resume'));
    assert.ok(out.includes('build'));
  });

  it('init creates project .foundry layout in cwd', () => {
    const projectDir = path.join(TEST_HOME, 'project-init');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync(`npx tsx "${CLI}" init`, {
      encoding: 'utf8',
      cwd: projectDir,
      env: { ...process.env, FOUNDRY_HOME: process.env.FOUNDRY_HOME }
    });
    assert.ok(fs.existsSync(path.join(projectDir, '.foundry', 'config.toml')));
    assert.ok(fs.existsSync(path.join(projectDir, '.foundry', 'runs')));

    const config = fs.readFileSync(path.join(projectDir, '.foundry', 'config.toml'), 'utf8');
    assert.ok(config.includes('default = "productive"'));
  });

  it('doctor prints capability table', () => {
    let out = '';
    try {
      out = execSync(`npx tsx "${CLI}" doctor --for plan`, {
        encoding: 'utf8',
        env: { ...process.env, FOUNDRY_HOME: process.env.FOUNDRY_HOME },
      });
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stdout?: string };
      out = String(e.stdout ?? '');
    }
    assert.ok(out.includes('Foundry doctor'));
    assert.ok(out.includes('system'));
    assert.ok(out.includes('Exit code:'));
  });

  it('doctor --json emits DoctorReport schema', () => {
    let out = '';
    try {
      out = execSync(`npx tsx "${CLI}" doctor --for plan --json`, {
        encoding: 'utf8',
        env: { ...process.env, FOUNDRY_HOME: process.env.FOUNDRY_HOME },
      });
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stdout?: string };
      out = String(e.stdout ?? '');
    }
    const report = JSON.parse(out);
    assert.strictEqual(report.schemaVersion, '1');
    assert.strictEqual(report.for, 'plan');
    assert.ok(Array.isArray(report.checks));
  });
});

describe('foundry CLI state commands (Issue #4)', () => {
  let projectDir: string;

  beforeEach(() => {
    process.env.FOUNDRY_HOME = path.join(TEST_HOME, 'home');
    fs.rmSync(process.env.FOUNDRY_HOME, { recursive: true, force: true });

    projectDir = path.join(TEST_HOME, 'project-state');
    fs.mkdirSync(projectDir, { recursive: true });
    initProject(projectDir);
  });

  afterEach(() => {
    if (process.env.FOUNDRY_HOME) {
      fs.rmSync(process.env.FOUNDRY_HOME, { recursive: true, force: true });
    }
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    delete process.env.FOUNDRY_HOME;
  });

  it('status reports no runs when runs dir is empty', () => {
    const out = execSync(`npx tsx "${CLI}" status`, {
      encoding: 'utf8',
      cwd: projectDir,
      env: { ...process.env, FOUNDRY_HOME: process.env.FOUNDRY_HOME }
    });
    assert.ok(out.includes('No runs yet'));
  });

  it('status summarizes latest run', () => {
    createRun(projectDir, '0.1.0', { run_id: 'demo-run', phase: 'research' });

    const out = execSync(`npx tsx "${CLI}" status`, {
      encoding: 'utf8',
      cwd: projectDir,
      env: { ...process.env, FOUNDRY_HOME: process.env.FOUNDRY_HOME }
    });
    assert.ok(out.includes('demo-run'));
    assert.ok(out.includes('research'));
  });

  it('pause and resume flip run status', () => {
    createRun(projectDir, '0.1.0', { run_id: 'flip-run' });

    const pauseOut = execSync(`npx tsx "${CLI}" pause`, {
      encoding: 'utf8',
      cwd: projectDir,
      env: { ...process.env, FOUNDRY_HOME: process.env.FOUNDRY_HOME }
    });
    assert.ok(pauseOut.includes('paused'));

    const runJson = JSON.parse(
      fs.readFileSync(path.join(projectDir, '.foundry', 'runs', 'flip-run', 'run.json'), 'utf8'),
    );
    assert.strictEqual(runJson.status, 'paused');

    const resumeOut = execSync(`npx tsx "${CLI}" resume`, {
      encoding: 'utf8',
      cwd: projectDir,
      env: { ...process.env, FOUNDRY_HOME: process.env.FOUNDRY_HOME }
    });
    assert.ok(resumeOut.includes('resumed'));

    const runJsonAfter = JSON.parse(
      fs.readFileSync(path.join(projectDir, '.foundry', 'runs', 'flip-run', 'run.json'), 'utf8'),
    );
    assert.strictEqual(runJsonAfter.status, 'running');
  });

  it('status exits non-zero when project not initialized', () => {
    const bareDir = path.join(TEST_HOME, 'bare');
    fs.mkdirSync(bareDir, { recursive: true });

    assert.throws(
      () =>
        execSync(`npx tsx "${CLI}" status`, {
          encoding: 'utf8',
          cwd: bareDir,
          env: { ...process.env, FOUNDRY_HOME: process.env.FOUNDRY_HOME }
        }),
      (err: NodeJS.ErrnoException & { status?: number; stderr?: string }) => {
        assert.notStrictEqual(err.status, 0);
        const msg = String(err.stderr ?? err.message);
        assert.ok(msg.includes('not initialized'));
        return true;
      },
    );
  });
});
