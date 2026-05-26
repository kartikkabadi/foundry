import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject, createRun } from '@foundry/core/state/run-writer.js';
import {
  AgentPassCheckpointError,
  evaluateAgentPassAfterIncrement,
} from '@foundry/planner/plan/agent-pass-policy.js';

describe('agent-pass-policy', () => {
  it('marathon review pause fires at pass 5 before checkpoint interval 10', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-marathon-pass-'));
    initProject(projectRoot);
    const ref = createRun(projectRoot, '0.1.0', {
      mode: 'plan',
      budget: 'marathon',
      phase: 'research',
      status: 'running',
      agent_pass_budget: { max_active: 24, used: 5, limit: 120 },
      next_actions: [],
    });

    assert.throws(
      () => evaluateAgentPassAfterIncrement(ref, projectRoot, 'research'),
      AgentPassCheckpointError,
    );

    const runJson = JSON.parse(
      fs.readFileSync(path.join(ref.runDir, 'run.json'), 'utf8'),
    ) as {
      status: string;
      next_actions: string[];
      marathon?: { review_pause_at_passes: number[] };
    };
    assert.strictEqual(runJson.status, 'paused');
    assert.match(runJson.next_actions[0] ?? '', /Marathon review/i);
    assert.ok(runJson.marathon?.review_pause_at_passes.includes(5));
  });
});
