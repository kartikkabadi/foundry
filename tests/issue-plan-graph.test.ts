import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  IssuePlanGraphError,
  formatExecutionOrder,
  parseIssuePlanGraph,
  topologicalOrder,
} from '@foundry/planner/build/issue-plan-graph.js';
import { FIXTURE_ISSUE_PLAN, FIXTURE_ISSUE_PLAN_CYCLE } from './build-fixtures.js';

describe('issue-plan execution graph (V3-2)', () => {
  it('parses issue types and dependencies', () => {
    const nodes = parseIssuePlanGraph(FIXTURE_ISSUE_PLAN);
    assert.strictEqual(nodes.length, 2);
    assert.strictEqual(nodes[0]?.type, 'code');
    assert.deepStrictEqual(nodes[1]?.blocked_by, [1]);
  });

  it('topologicalOrder orders linear plan correctly', () => {
    const nodes = parseIssuePlanGraph(FIXTURE_ISSUE_PLAN);
    const ordered = topologicalOrder(nodes);
    assert.deepStrictEqual(
      ordered.map((n) => n.number),
      [1, 2],
    );
  });

  it('rejects cycles with actionable error', () => {
    const nodes = parseIssuePlanGraph(FIXTURE_ISSUE_PLAN_CYCLE);
    assert.throws(() => topologicalOrder(nodes), IssuePlanGraphError);
  });

  it('formatExecutionOrder lists dry-run order', () => {
    const nodes = parseIssuePlanGraph(FIXTURE_ISSUE_PLAN);
    const output = formatExecutionOrder(nodes);
    assert.match(output, /#1: Add CLI flag \(code\)/);
    assert.match(output, /#2: Update docs \(docs\)/);
  });
});
