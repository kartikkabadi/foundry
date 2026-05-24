import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { BuildState } from '@foundry/core/types/build.js';
import type { IssuePlanNode } from '@foundry/core/types/build.js';
import { depsSatisfied } from '@foundry/planner/build/issue-plan-graph.js';
import { nextPendingIssue } from '@foundry/planner/build/orchestrate.js';

const nodes: IssuePlanNode[] = [
  { number: 1, title: 'First', type: 'code', blocked_by: [], body: '' },
  { number: 2, title: 'Second', type: 'docs', blocked_by: [1], body: '' },
];

function buildWith(
  issues: BuildState['issues'],
  deferred: number[] = [],
): BuildState {
  return {
    issues,
    deferred,
    goal_complete: false,
  };
}

describe('build blocked_by scheduling (V4 Task 0.1)', () => {
  it('depsSatisfied is false while blocker is pending', () => {
    const build = buildWith([
      { number: 1, title: 'First', type: 'code', status: 'pending', blocked_by: [] },
      { number: 2, title: 'Second', type: 'docs', status: 'pending', blocked_by: [1] },
    ]);
    assert.strictEqual(depsSatisfied(build, nodes[1]!), false);
  });

  it('depsSatisfied is true when blocker completed', () => {
    const build = buildWith([
      { number: 1, title: 'First', type: 'code', status: 'completed', blocked_by: [] },
      { number: 2, title: 'Second', type: 'docs', status: 'pending', blocked_by: [1] },
    ]);
    assert.strictEqual(depsSatisfied(build, nodes[1]!), true);
  });

  it('depsSatisfied is true when blocker deferred', () => {
    const build = buildWith(
      [
        { number: 1, title: 'First', type: 'code', status: 'pending', blocked_by: [] },
        { number: 2, title: 'Second', type: 'docs', status: 'pending', blocked_by: [1] },
      ],
      [1],
    );
    assert.strictEqual(depsSatisfied(build, nodes[1]!), true);
  });

  it('nextPendingIssue skips issue 2 until issue 1 completes', () => {
    const pendingOnly = buildWith([
      { number: 1, title: 'First', type: 'code', status: 'pending', blocked_by: [] },
      { number: 2, title: 'Second', type: 'docs', status: 'pending', blocked_by: [1] },
    ]);
    assert.strictEqual(nextPendingIssue(pendingOnly, nodes)?.number, 1);

    const afterFirst = buildWith([
      { number: 1, title: 'First', type: 'code', status: 'completed', blocked_by: [] },
      { number: 2, title: 'Second', type: 'docs', status: 'pending', blocked_by: [1] },
    ]);
    assert.strictEqual(nextPendingIssue(afterFirst, nodes)?.number, 2);
  });
});
