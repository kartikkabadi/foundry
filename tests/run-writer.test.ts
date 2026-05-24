import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RunStateError,
  assertProjectInitialized,
  createRun,
  findActiveRun,
  findLatestPausedRun,
  findLatestRun,
  initProject,
  pauseRun,
  readRunJson,
  resumeRun,
  statusMarkdown,
} from '../src/state/run-writer.ts';

const TEST_ROOT = path.join(os.tmpdir(), 'FOUNDRY_RUN_WRITER_' + process.pid + '_' + Date.now());

describe('run-writer (Issue #4)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = path.join(TEST_ROOT, 'project-' + Math.random().toString(36).slice(2));
    fs.mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('initProject creates .foundry/config.toml with autonomy default productive', () => {
    const result = initProject(projectRoot);

    assert.ok(fs.existsSync(result.configPath));
    assert.ok(fs.existsSync(result.runsDir));
    assert.strictEqual(result.createdConfig, true);

    const config = fs.readFileSync(result.configPath, 'utf8');
    assert.ok(config.includes('version = 1'));
    assert.ok(config.includes('default = "productive"'));
  });

  it('initProject is idempotent for config.toml', () => {
    initProject(projectRoot);
    const second = initProject(projectRoot);
    assert.strictEqual(second.createdConfig, false);
  });

  it('createRun writes run.json and status.md under .foundry/runs/<id>/', () => {
    initProject(projectRoot);
    const created = createRun(projectRoot, '0.1.0');

    assert.ok(fs.existsSync(created.runJsonPath));
    assert.ok(fs.existsSync(created.statusMdPath));

    const run = JSON.parse(fs.readFileSync(created.runJsonPath, 'utf8'));
    assert.strictEqual(run.run_id, created.runId);
    assert.strictEqual(run.foundry_version, '0.1.0');
    assert.strictEqual(run.schema_version, 1);
    assert.strictEqual(run.status, 'running');
    assert.strictEqual(run.phase, 'init');

    const status = fs.readFileSync(created.statusMdPath, 'utf8');
    assert.ok(status.includes(created.runId));
    assert.ok(status.includes('running'));
  });

  it('createRun requires initialized project', () => {
    assert.throws(
      () => createRun(projectRoot, '0.1.0'),
      (error: unknown) => {
        assert.ok(error instanceof RunStateError);
        assert.strictEqual(error.code, 'NOT_INITIALIZED');
        return true;
      },
    );
  });

  it('findLatestRun returns most recently updated run', () => {
    initProject(projectRoot);
    const older = createRun(projectRoot, '0.1.0', {
      run_id: 'older-run',
      updated_at: '2020-01-01T00:00:00.000Z',
      created_at: '2020-01-01T00:00:00.000Z',
    });
    const newer = createRun(projectRoot, '0.1.0', {
      run_id: 'newer-run',
      updated_at: '2025-01-01T00:00:00.000Z',
      created_at: '2025-01-01T00:00:00.000Z',
    });

    const latest = findLatestRun(projectRoot);
    assert.ok(latest);
    assert.strictEqual(latest!.runId, newer.runId);
    assert.notStrictEqual(latest!.runId, older.runId);
  });

  it('pauseRun marks active run paused and records next action', () => {
    initProject(projectRoot);
    createRun(projectRoot, '0.1.0', { run_id: 'active-run' });

    const paused = pauseRun(projectRoot, 'Continue planning');
    assert.strictEqual(paused.run.status, 'paused');
    assert.deepStrictEqual(paused.run.next_actions, ['Continue planning']);

    const onDisk = readRunJson(paused.runJsonPath);
    assert.strictEqual(onDisk.status, 'paused');

    const status = fs.readFileSync(paused.statusMdPath, 'utf8');
    assert.ok(status.includes('paused'));
    assert.ok(status.includes('Continue planning'));
  });

  it('resumeRun finds latest paused run and sets status running', () => {
    initProject(projectRoot);
    createRun(projectRoot, '0.1.0', {
      run_id: 'paused-run',
      status: 'paused',
      next_actions: ['Resume me'],
    });

    const resumed = resumeRun(projectRoot);
    assert.strictEqual(resumed.runId, 'paused-run');
    assert.strictEqual(resumed.run.status, 'running');
    assert.deepStrictEqual(resumed.run.next_actions, []);
  });

  it('resumeRun accepts explicit run id', () => {
    initProject(projectRoot);
    createRun(projectRoot, '0.1.0', {
      run_id: 'run-a',
      status: 'paused',
      updated_at: '2025-01-02T00:00:00.000Z',
      created_at: '2025-01-02T00:00:00.000Z',
    });
    createRun(projectRoot, '0.1.0', {
      run_id: 'run-b',
      status: 'paused',
      updated_at: '2025-01-01T00:00:00.000Z',
      created_at: '2025-01-01T00:00:00.000Z',
    });

    const resumed = resumeRun(projectRoot, 'run-b');
    assert.strictEqual(resumed.runId, 'run-b');
    assert.strictEqual(resumed.run.status, 'running');
  });

  it('readRunJson throws MALFORMED for invalid JSON', () => {
    initProject(projectRoot);
    const badPath = path.join(projectRoot, '.foundry', 'runs', 'bad', 'run.json');
    fs.mkdirSync(path.dirname(badPath), { recursive: true });
    fs.writeFileSync(badPath, '{not json', 'utf8');

    assert.throws(
      () => readRunJson(badPath),
      (error: unknown) => {
        assert.ok(error instanceof RunStateError);
        assert.strictEqual(error.code, 'MALFORMED');
        return true;
      },
    );
  });

  it('readRunJson throws MALFORMED for missing required fields', () => {
    initProject(projectRoot);
    const badPath = path.join(projectRoot, '.foundry', 'runs', 'bad', 'run.json');
    fs.mkdirSync(path.dirname(badPath), { recursive: true });
    fs.writeFileSync(badPath, JSON.stringify({ run_id: 'x' }), 'utf8');

    assert.throws(
      () => readRunJson(badPath),
      (error: unknown) => {
        assert.ok(error instanceof RunStateError);
        assert.strictEqual(error.code, 'MALFORMED');
        return true;
      },
    );
  });

  it('readRunJson throws NOT_FOUND for missing file', () => {
    assert.throws(
      () => readRunJson(path.join(projectRoot, 'missing', 'run.json')),
      (error: unknown) => {
        assert.ok(error instanceof RunStateError);
        assert.strictEqual(error.code, 'NOT_FOUND');
        return true;
      },
    );
  });

  it('pauseRun throws NO_ACTIVE_RUN when no running run exists', () => {
    initProject(projectRoot);
    createRun(projectRoot, '0.1.0', { run_id: 'done-run', status: 'complete' });

    assert.throws(
      () => pauseRun(projectRoot),
      (error: unknown) => {
        assert.ok(error instanceof RunStateError);
        assert.strictEqual(error.code, 'NO_ACTIVE_RUN');
        return true;
      },
    );
  });

  it('resumeRun throws NO_PAUSED_RUN when none exist', () => {
    initProject(projectRoot);
    createRun(projectRoot, '0.1.0', { run_id: 'running-run', status: 'running' });

    assert.throws(
      () => resumeRun(projectRoot),
      (error: unknown) => {
        assert.ok(error instanceof RunStateError);
        assert.strictEqual(error.code, 'NO_PAUSED_RUN');
        return true;
      },
    );
  });

  it('assertProjectInitialized throws when config missing', () => {
    assert.throws(
      () => assertProjectInitialized(projectRoot),
      (error: unknown) => {
        assert.ok(error instanceof RunStateError);
        assert.strictEqual(error.code, 'NOT_INITIALIZED');
        return true;
      },
    );
  });

  it('findActiveRun returns running run', () => {
    initProject(projectRoot);
    createRun(projectRoot, '0.1.0', { run_id: 'paused-run', status: 'paused' });
    createRun(projectRoot, '0.1.0', { run_id: 'active-run', status: 'running' });

    const active = findActiveRun(projectRoot);
    assert.ok(active);
    assert.strictEqual(active!.runId, 'active-run');
  });

  it('findLatestPausedRun returns most recent paused run', () => {
    initProject(projectRoot);
    createRun(projectRoot, '0.1.0', {
      run_id: 'old-paused',
      status: 'paused',
      updated_at: '2024-01-01T00:00:00.000Z',
      created_at: '2024-01-01T00:00:00.000Z',
    });
    createRun(projectRoot, '0.1.0', {
      run_id: 'new-paused',
      status: 'paused',
      updated_at: '2025-01-01T00:00:00.000Z',
      created_at: '2025-01-01T00:00:00.000Z',
    });

    const paused = findLatestPausedRun(projectRoot);
    assert.ok(paused);
    assert.strictEqual(paused!.runId, 'new-paused');
  });

  it('statusMarkdown includes next and blocked actions', () => {
    const md = statusMarkdown({
      schema_version: 1,
      run_id: 'abc',
      foundry_version: '0.1.0',
      mode: 'plan',
      budget: 'quick',
      status: 'paused',
      phase: 'research',
      composer_speed: 'standard',
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z',
      agent_pass_budget: { max_active: 5, used: 0, limit: 12 },
      artifacts: [],
      blocked_actions: ['install deps'],
      next_actions: ['resume research'],
    });

    assert.ok(md.includes('resume research'));
    assert.ok(md.includes('install deps'));
  });
});
