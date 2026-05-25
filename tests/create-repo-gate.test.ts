import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateCreateRepoGate } from '@foundry/planner/build/create-repo-gate.js';

describe('create repo gate (#47)', () => {
  it('blocked without approval', () => {
    const gate = evaluateCreateRepoGate(
      { name: 'productive', allow_install: true, allow_commit: true },
      { explicitApproval: false },
    );
    assert.strictEqual(gate.allowed, false);
  });

  it('blocked in safe profile even with approval flag', () => {
    const gate = evaluateCreateRepoGate(
      { name: 'safe', allow_install: false, allow_commit: false },
      { explicitApproval: true },
    );
    assert.strictEqual(gate.allowed, false);
  });

  it('allowed with explicit approval in productive profile', () => {
    const gate = evaluateCreateRepoGate(
      { name: 'productive', allow_install: true, allow_commit: true },
      { explicitApproval: true },
    );
    assert.strictEqual(gate.allowed, true);
  });
});
