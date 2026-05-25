import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertPublishAllowed,
  GateError,
} from '@foundry/core/gates.js';
import { createRun, initProject } from '@foundry/core/state/run-writer.js';
import { publishIssuePlan } from '@foundry/planner/publish/orchestrate.js';
import { readRunJson } from '@foundry/core/state/run-writer.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'packages', 'cli', 'bin', 'foundry.js');

const FIXTURE_ISSUE_PLAN = `## Issue 1: Gate test issue

Body for publish gate test.
`;

function seedPublishableRun(
  projectRoot: string,
  status: 'awaiting_approval' | 'approved',
): { runDir: string; issuePlanPath: string } {
  const { runDir } = createRun(projectRoot, '0.1.0', {
    status,
    phase: status === 'awaiting_approval' ? 'awaiting_approval' : 'awaiting_approval',
  });
  const issuePlanPath = path.join(runDir, 'issue-plan.md');
  fs.writeFileSync(issuePlanPath, FIXTURE_ISSUE_PLAN, 'utf8');
  return { runDir, issuePlanPath };
}

describe('publish approval gate (Phase 1 Task 1.1)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-publish-gate-'));
    initProject(projectRoot);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('assertPublishAllowed rejects awaiting_approval without force', () => {
    const run = readRunJson(
      path.join(seedPublishableRun(projectRoot, 'awaiting_approval').runDir, 'run.json'),
    );
    assert.throws(
      () => assertPublishAllowed(run),
      (err: unknown) => err instanceof GateError && err.message.includes('awaiting approval'),
    );
  });

  it('assertPublishAllowed allows awaiting_approval with force', () => {
    const run = readRunJson(
      path.join(seedPublishableRun(projectRoot, 'awaiting_approval').runDir, 'run.json'),
    );
    assert.doesNotThrow(() => assertPublishAllowed(run, { force: true }));
  });

  it('publishIssuePlan rejects when run is awaiting_approval', async () => {
    const { runDir, issuePlanPath } = seedPublishableRun(projectRoot, 'awaiting_approval');
    const run = readRunJson(path.join(runDir, 'run.json'));

    await assert.rejects(
      () =>
        publishIssuePlan({
          issuePlanPath,
          runDir,
          approve: false,
          run,
        }),
      (err: unknown) => err instanceof GateError,
    );
  });

  it('publishIssuePlan succeeds when run is approved', async () => {
    const { runDir, issuePlanPath } = seedPublishableRun(projectRoot, 'approved');
    const run = readRunJson(path.join(runDir, 'run.json'));

    const result = await publishIssuePlan({
      issuePlanPath,
      runDir,
      approve: false,
      run,
      deps: {
        execGh() {
          return { ok: false, stdout: '', stderr: 'not available' };
        },
        async confirm() {
          return false;
        },
        writeFile(filePath, content) {
          fs.writeFileSync(filePath, content, 'utf8');
        },
        mkdir(dir) {
          fs.mkdirSync(dir, { recursive: true });
        },
      },
    });

    assert.strictEqual(result.localFallback.length, 1);
  });

  it('foundry publish CLI rejects unapproved latest run', () => {
    seedPublishableRun(projectRoot, 'awaiting_approval');

    assert.throws(
      () => execSync(`node "${CLI}" publish`, { encoding: 'utf8', cwd: projectRoot }),
      (err: NodeJS.ErrnoException & { status?: number; stderr?: string }) => {
        assert.notStrictEqual(err.status, 0);
        assert.ok(String(err.stderr ?? '').includes('awaiting approval'));
        return true;
      },
    );
  });

  it('foundry publish --force warns and writes local drafts', () => {
    const { runDir } = seedPublishableRun(projectRoot, 'awaiting_approval');

    const { status, stderr } = spawnSync('node', [CLI, 'publish', '--force'], {
      encoding: 'utf8',
      cwd: projectRoot,
    });

    assert.strictEqual(status, 0);
    assert.match(stderr, /--force/);
    assert.ok(fs.existsSync(path.join(runDir, 'issues', 'issue-01.md')));
  });
});
