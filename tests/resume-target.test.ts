import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveResumeTarget } from '@foundry/core/resume-target.js';
import type { RunJson } from '@foundry/core/types/run.js';

describe('resolveResumeTarget (V4 Task 4b)', () => {
  it('routes build mode to build', () => {
    const run = { mode: 'build', phase: 'build_executing' } as RunJson;
    assert.strictEqual(resolveResumeTarget(run, '/tmp'), 'build');
  });

  it('routes plan with artifacts to plan', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-target-'));
    const run = {
      mode: 'plan',
      phase: 'algorithm_pass',
      artifacts: ['summary.md'],
    } as RunJson;
    assert.strictEqual(resolveResumeTarget(run, dir), 'plan');
  });

  it('routes bare init to state-only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-target-'));
    const run = { mode: 'plan', phase: 'init', artifacts: [] } as RunJson;
    assert.strictEqual(resolveResumeTarget(run, dir), 'state-only');
  });
});
