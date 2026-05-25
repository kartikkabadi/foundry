import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertComposerOnlyModel,
  FoundryRateLimitError,
  FORBIDDEN_MODEL_PATTERNS,
} from '@foundry/adapters/agent-errors.js';
import { COMPOSER_MODEL_STANDARD, createFoundryAgent } from '@foundry/adapters/foundry-agent.js';
import { initProject, createRun, findLatestPausedRun } from '@foundry/core/state/run-writer.js';
import { invokeAgentWithCheckpoint } from '@foundry/planner/agent-invoke.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('rate-limit checkpoint (#36)', () => {
  it('simulated 429 pauses run with same composer model on checkpoint', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-rate-'));
    initProject(projectRoot);
    const ref = createRun(projectRoot, '0.1.0', {
      mode: 'plan',
      budget: 'deep',
      phase: 'research',
      status: 'running',
      agent_pass_budget: { max_active: 1, used: 0, limit: 10 },
      next_actions: [],
    });

    const prev = process.env.FOUNDRY_AGENT_RATE_LIMIT;
    process.env.FOUNDRY_AGENT_RATE_LIMIT = '1';
    try {
      await assert.rejects(
        () =>
          invokeAgentWithCheckpoint({
            ref,
            projectRoot,
            phase: 'research',
            fn: () => createFoundryAgent('test-key').prompt('x', projectRoot),
          }),
        (err: unknown) => err instanceof FoundryRateLimitError,
      );

      const paused = findLatestPausedRun(projectRoot);
      assert.ok(paused);
      assert.strictEqual(paused.run.composer_speed, 'standard');
      assert.match(paused.run.next_actions[0] ?? '', /rate limited/i);
      assert.match(paused.run.next_actions[0] ?? '', /composer-2\.5/);
    } finally {
      if (prev === undefined) {
        delete process.env.FOUNDRY_AGENT_RATE_LIMIT;
      } else {
        process.env.FOUNDRY_AGENT_RATE_LIMIT = prev;
      }
    }
  });

  it('assertComposerOnlyModel rejects non-Composer models', () => {
    assert.throws(() => assertComposerOnlyModel('gpt-4o'));
    assert.throws(() => assertComposerOnlyModel('claude-3-opus'));
  });

  it('grep guard: adapters source has no forbidden model strings as defaults', () => {
    const tsPath = join(import.meta.dirname, '../packages/adapters/src/foundry-agent.ts');
    const src = readFileSync(tsPath, 'utf8');
    for (const pattern of FORBIDDEN_MODEL_PATTERNS) {
      const match = src.match(pattern);
      if (match) {
        assert.fail(`Forbidden model pattern matched in foundry-agent: ${match[0]}`);
      }
    }
    assert.strictEqual(COMPOSER_MODEL_STANDARD, 'composer-2.5');
  });
});
