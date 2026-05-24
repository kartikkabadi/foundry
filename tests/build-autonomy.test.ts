import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  evaluateAutonomyAction,
  parseAutonomyProfile,
} from '@foundry/planner/build/autonomy.js';
import { FIXTURE_AUTONOMY_PRODUCTIVE, FIXTURE_AUTONOMY_SAFE } from './build-fixtures.js';

describe('build autonomy enforcement (V3-6)', () => {
  it('safe profile denies npm install without approval', () => {
    const profile = parseAutonomyProfile(FIXTURE_AUTONOMY_SAFE);
    const decision = evaluateAutonomyAction(profile, 'npm_install');
    assert.strictEqual(decision.allowed, false);
    assert.match(decision.reason, /install blocked/i);
  });

  it('productive profile allows npm install', () => {
    const profile = parseAutonomyProfile(FIXTURE_AUTONOMY_PRODUCTIVE);
    const install = evaluateAutonomyAction(profile, 'npm_install');
    const commit = evaluateAutonomyAction(profile, 'git_commit');
    assert.strictEqual(install.allowed, true);
    assert.strictEqual(commit.allowed, true);
  });

  it('safe profile allows install with explicit approval', () => {
    const profile = parseAutonomyProfile(FIXTURE_AUTONOMY_SAFE);
    const decision = evaluateAutonomyAction(profile, 'npm_install', true);
    assert.strictEqual(decision.allowed, true);
  });

  it('safe profile denies git commit', () => {
    const profile = parseAutonomyProfile(FIXTURE_AUTONOMY_SAFE);
    const decision = evaluateAutonomyAction(profile, 'git_commit');
    assert.strictEqual(decision.allowed, false);
  });
});
