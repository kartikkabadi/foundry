import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  deferIssue,
  evaluateBuildGoalComplete,
  formatDeferredSummary,
  resolveDeferred,
  waiveDeferred,
} from '@foundry/planner/build/defer.js';
import type { BuildState } from '@foundry/core/types/build.js';
import { BuildGoalIncompleteError } from '@foundry/planner/build/defer.js';

function sampleBuild(): BuildState {
  return {
    issues: [
      { number: 1, title: 'A', type: 'code', status: 'completed', blocked_by: [] },
      { number: 2, title: 'B', type: 'docs', status: 'pending', blocked_by: [1] },
    ],
    deferred: [],
    goal_complete: false,
  };
}

describe('deferred issues + build goal (V3-8)', () => {
  it('defer marks goal incomplete', () => {
    let build = deferIssue(sampleBuild(), 2, 'blocked');
    assert.deepStrictEqual(build.deferred, [2]);
    assert.strictEqual(build.goal_complete, false);
    assert.match(formatDeferredSummary(build), /#2/);
  });

  it('resolve deferred clears defer list', () => {
    let build = deferIssue(sampleBuild(), 2, 'blocked');
    build = resolveDeferred(build, 2);
    assert.deepStrictEqual(build.deferred, []);
  });

  it('goal completes when all issues done and no deferred', () => {
    let build: BuildState = {
      issues: [
        { number: 1, title: 'A', type: 'code', status: 'completed', blocked_by: [] },
        { number: 2, title: 'B', type: 'docs', status: 'completed', blocked_by: [] },
      ],
      deferred: [],
      goal_complete: false,
    };
    build = evaluateBuildGoalComplete(build);
    assert.strictEqual(build.goal_complete, true);
  });

  it('waive requires explicit approval', () => {
    let build = deferIssue(sampleBuild(), 2, 'blocked');
    assert.throws(() => waiveDeferred(build, 2, false), BuildGoalIncompleteError);
    build = waiveDeferred(build, 2, true);
    assert.strictEqual(build.issues[1]?.status, 'completed');
    assert.deepStrictEqual(build.deferred, []);
  });
});
