import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approveRun,
  createRun,
  initProject,
} from '@foundry/core/state/run-writer.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'packages', 'cli', 'bin', 'foundry.js');

describe('foundry approve (V2-7)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-approve-'));
    initProject(projectRoot);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('approve transitions awaiting_approval to approved', () => {
    createRun(projectRoot, '0.1.0', {
      run_id: 'approve-me',
      status: 'awaiting_approval',
      phase: 'awaiting_approval',
      blocked_actions: ['build'],
    });

    const approved = approveRun(projectRoot, 'approve-me');
    assert.strictEqual(approved.run.status, 'approved');
    assert.deepStrictEqual(approved.run.blocked_actions, []);
  });

  it('approve is idempotent for already approved runs', () => {
    createRun(projectRoot, '0.1.0', {
      run_id: 'already-approved',
      status: 'approved',
      phase: 'awaiting_approval',
    });

    const again = approveRun(projectRoot, 'already-approved');
    assert.strictEqual(again.run.status, 'approved');
  });

  it('build rejects unapproved run via CLI', () => {
    createRun(projectRoot, '0.1.0', {
      run_id: 'unapproved',
      status: 'awaiting_approval',
      phase: 'awaiting_approval',
    });

    assert.throws(
      () =>
        execSync(`node "${CLI}" build`, {
          encoding: 'utf8',
          cwd: projectRoot,
        }),
      (err: NodeJS.ErrnoException & { status?: number; stderr?: string }) => {
        assert.notStrictEqual(err.status, 0);
        assert.ok(String(err.stderr ?? '').includes('not approved'));
        return true;
      },
    );
  });

  it('build passes approval gate when run is approved', () => {
    createRun(projectRoot, '0.1.0', {
      run_id: 'approved-run',
      status: 'approved',
      phase: 'awaiting_approval',
    });

    const out = execSync(`node "${CLI}" build`, {
      encoding: 'utf8',
      cwd: projectRoot,
    });
    assert.ok(out.includes('preflight passed'));
  });

  it('foundry approve CLI transitions status', () => {
    createRun(projectRoot, '0.1.0', {
      run_id: 'cli-approve',
      status: 'awaiting_approval',
      phase: 'awaiting_approval',
    });

    const out = execSync(`node "${CLI}" approve`, {
      encoding: 'utf8',
      cwd: projectRoot,
    });
    assert.ok(out.includes('approved'));

    const runJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, '.foundry', 'runs', 'cli-approve', 'run.json'), 'utf8'),
    );
    assert.strictEqual(runJson.status, 'approved');
  });
});
