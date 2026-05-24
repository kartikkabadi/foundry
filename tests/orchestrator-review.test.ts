import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeBuild } from '@foundry/planner/build/orchestrate.js';
import { cleanupFoundryWorktrees } from '@foundry/adapters/worktree.js';
import {
  approveReview,
  canMerge,
  enterReviewGate,
  isAwaitingReview,
  rejectReview,
} from '@foundry/planner/build/review.js';
import type { BuildState } from '@foundry/core/types/build.js';
import {
  FIXTURE_ISSUE_PLAN_SINGLE,
  mockBuildDeps,
  seedApprovedBuildRun,
} from './build-fixtures.js';

function sampleBuild(): BuildState {
  return {
    issues: [
      {
        number: 1,
        title: 'Demo',
        type: 'code',
        status: 'in_progress',
        blocked_by: [],
      },
    ],
    deferred: [],
    goal_complete: false,
  };
}

describe('orchestrator review gate (V3-7)', () => {
  it('worker stops at review — merge blocked until approved', () => {
    let build = enterReviewGate(sampleBuild(), 1);
    assert.strictEqual(isAwaitingReview(build), true);
    assert.strictEqual(canMerge(build), false);

    build = approveReview(build, 1);
    assert.strictEqual(canMerge(build), true);
    assert.strictEqual(build.issues[0]?.status, 'completed');
  });

  it('reject returns issue to in_progress', () => {
    let build = enterReviewGate(sampleBuild(), 1);
    build = rejectReview(build, 1);
    assert.strictEqual(build.review_status, 'rejected');
    assert.strictEqual(build.issues[0]?.status, 'in_progress');
  });
});

describe('orchestrator review gate in executeBuild (V3-7 integration)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-build-review-'));
  });

  afterEach(() => {
    try {
      cleanupFoundryWorktrees(projectRoot);
    } catch {
      // ignore
    }
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('pauses at build_review when autoApproveReview is false', async () => {
    const ref = seedApprovedBuildRun(projectRoot, '0.1.0', FIXTURE_ISSUE_PLAN_SINGLE);
    const result = await executeBuild({
      projectRoot,
      ref,
      deps: mockBuildDeps(projectRoot, false),
    });

    assert.strictEqual(result.run.phase, 'build_review');
    assert.strictEqual(result.run.build?.review_status, 'pending');
    assert.strictEqual(isAwaitingReview(result.run.build!), true);
    assert.strictEqual(canMerge(result.run.build!), false);
    assert.strictEqual(result.run.build?.issues[0]?.status, 'awaiting_review');
  });
});
