import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parsePlanArgs } from '../packages/cli/src/commands/plan.ts';

describe('parsePlanArgs', () => {
  it('parses --swarm-branches and enables swarm research', () => {
    const parsed = parsePlanArgs(['"my idea"', '--swarm-branches', '3']);
    assert.strictEqual(parsed.idea, 'my idea');
    assert.strictEqual(parsed.swarmResearch, true);
    assert.strictEqual(parsed.swarmBranches, 3);
  });

});
