import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  approveReview,
  canMerge,
  enterReviewGate,
  isAwaitingReview,
  rejectReview,
} from '@foundry/planner/build/review.js';
import type { BuildState } from '@foundry/core/types/build.js';

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
