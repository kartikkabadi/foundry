import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { IssuePlanNode } from '@foundry/core/types/build.js';
import {
  computeBuildWaves,
  issuePathKeys,
} from '@foundry/planner/build/parallel-schedule.js';

const independent: IssuePlanNode[] = [
  {
    number: 1,
    title: 'Alpha',
    type: 'code',
    blocked_by: [],
    body: 'Paths: src/a.ts',
  },
  {
    number: 2,
    title: 'Beta',
    type: 'code',
    blocked_by: [],
    body: 'Paths: src/b.ts',
  },
];

describe('computeBuildWaves (V4-1)', () => {
  it('issuePathKeys defaults to whole-repo when Paths missing', () => {
    assert.deepStrictEqual(issuePathKeys({ number: 1, title: 'x', type: 'code', blocked_by: [], body: '' }), [
      '**',
    ]);
  });

  it('packs two independent issues into one wave', () => {
    const waves = computeBuildWaves(independent, { maxParallel: 3 });
    assert.strictEqual(waves.length, 1);
    assert.deepStrictEqual(waves[0]!.sort(), [1, 2]);
  });

  it('serializes issues that share a path', () => {
    const nodes: IssuePlanNode[] = [
      {
        number: 1,
        title: 'A',
        type: 'code',
        blocked_by: [],
        body: 'Paths: src/shared.ts',
      },
      {
        number: 2,
        title: 'B',
        type: 'code',
        blocked_by: [],
        body: 'Paths: src/shared.ts',
      },
    ];
    const waves = computeBuildWaves(nodes, { maxParallel: 3 });
    assert.strictEqual(waves.length, 2);
    assert.strictEqual(waves[0]!.length, 1);
    assert.strictEqual(waves[1]!.length, 1);
  });

  it('respects blocked_by via wave order', () => {
    const nodes: IssuePlanNode[] = [
      { number: 1, title: 'First', type: 'code', blocked_by: [], body: 'Paths: a/' },
      { number: 2, title: 'Second', type: 'docs', blocked_by: [1], body: 'Paths: b/' },
    ];
    const waves = computeBuildWaves(nodes, { maxParallel: 3 });
    assert.deepStrictEqual(waves[0], [1]);
    assert.deepStrictEqual(waves[1], [2]);
  });
});
