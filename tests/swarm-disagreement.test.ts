import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectSwarmDisagreement } from '@foundry/planner/plan/swarm-disagreement.js';

describe('swarm disagreement (#37)', () => {
  it('detects opposing scope signals across branches', () => {
    const result = detectSwarmDisagreement([
      { branchId: 'a', citation: 'x', summary: 'Recommend mobile-only MVP' },
      { branchId: 'b', citation: 'y', summary: 'Prefer desktop-first delivery' },
    ]);
    assert.ok(result);
    assert.match(result!.summary, /disagree/i);
  });

  it('returns null when branches align', () => {
    const result = detectSwarmDisagreement([
      { branchId: 'a', citation: 'x', summary: 'Ship a CLI tool with tests' },
      { branchId: 'b', citation: 'y', summary: 'Same CLI scope with docs' },
    ]);
    assert.strictEqual(result, null);
  });
});
