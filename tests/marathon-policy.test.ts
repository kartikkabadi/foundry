import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  marathonPolicyForBudget,
  shouldMarathonReviewPause,
} from '@foundry/core/marathon/policy.js';

describe('marathon policy (#45)', () => {
  it('marathon triggers review pause at interval', () => {
    const policy = marathonPolicyForBudget('marathon');
    assert.ok(policy);
    assert.strictEqual(shouldMarathonReviewPause(5, policy), true);
    assert.strictEqual(shouldMarathonReviewPause(4, policy), false);
  });

  it('non-marathon budgets have no marathon policy', () => {
    assert.strictEqual(marathonPolicyForBudget('deep'), null);
  });

  it('marathon has stricter loop thresholds than deep', () => {
    const policy = marathonPolicyForBudget('marathon');
    assert.ok(policy);
    assert.ok(policy.loopPauseThreshold < 7);
  });
});
