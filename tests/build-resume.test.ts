import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resumeBuildFromCheckpoint } from '@foundry/planner/build/orchestrate.js';
import { writeRunState } from '@foundry/core/state/run-writer.js';
import { cleanupFoundryWorktrees } from '@foundry/adapters/worktree.js';
import { mockDoctorDeps, seedApprovedBuildRun } from './build-fixtures.js';

describe('foundry build resume (V3-9)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-build-resume-'));
  });

  afterEach(() => {
    try {
      cleanupFoundryWorktrees(projectRoot);
    } catch {
      // ignore
    }
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('pause mid-build preserves checkpoint; resume completes remaining issue', async () => {
    const ref = seedApprovedBuildRun(projectRoot);

    const paused = writeRunState({
      ...ref,
      run: {
        ...ref.run,
        mode: 'build',
        status: 'paused',
        phase: 'build_executing',
        build: {
          current_issue: 2,
          goal_complete: false,
          deferred: [],
          issues: [
            {
              number: 1,
              title: 'Add CLI flag',
              type: 'code',
              status: 'completed',
              blocked_by: [],
              worktree: path.join(projectRoot, '.worktrees', 'foundry-build-1'),
            },
            {
              number: 2,
              title: 'Update docs',
              type: 'docs',
              status: 'pending',
              blocked_by: [1],
            },
          ],
        },
        proofs: [
          {
            issue: 1,
            type: 'code',
            path: path.join(ref.runDir, 'proofs', 'issue-01.json'),
            valid: true,
          },
        ],
        next_actions: ['Resume with `foundry resume`'],
      },
    });

    const pausedRef = { ...ref, run: paused };

    const resumed = await resumeBuildFromCheckpoint({
      projectRoot,
      ref: pausedRef,
      deps: { doctorDeps: mockDoctorDeps(projectRoot) },
    });

    assert.strictEqual(resumed.run.mode, 'build');
    assert.strictEqual(resumed.run.status, 'complete');
    assert.ok(resumed.run.build?.goal_complete);
    assert.ok(resumed.run.proofs && resumed.run.proofs.length >= 2);
  });
});
