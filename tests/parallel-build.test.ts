import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeBuild } from '@foundry/planner/build/orchestrate.js';
import { cleanupFoundryWorktrees } from '@foundry/adapters/worktree.js';
import {
  FIXTURE_ISSUE_PLAN_INDEPENDENT,
  mockBuildDeps,
  seedApprovedBuildRun,
} from './build-fixtures.js';

describe('executeBuild parallel integration (V4-1 #31)', () => {
  let projectRoot: string;
  const prevMock = process.env.FOUNDRY_BUILD_MOCK;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-parallel-build-'));
    process.env.FOUNDRY_BUILD_MOCK = '1';
  });

  afterEach(() => {
    try {
      cleanupFoundryWorktrees(projectRoot);
    } catch {
      // ignore
    }
    fs.rmSync(projectRoot, { recursive: true, force: true });
    if (prevMock === undefined) {
      delete process.env.FOUNDRY_BUILD_MOCK;
    } else {
      process.env.FOUNDRY_BUILD_MOCK = prevMock;
    }
  });

  it('parallel=2 runs two independent issues in the same wave', async () => {
    const ref = seedApprovedBuildRun(
      projectRoot,
      '0.1.0',
      FIXTURE_ISSUE_PLAN_INDEPENDENT,
    );

    let agentCalls = 0;
    let inflight = 0;
    let maxInflight = 0;

    const baseDeps = mockBuildDeps(projectRoot, true);
    const baseRunAgent = baseDeps.workerDeps!.runAgent;

    const deps = {
      ...baseDeps,
      workerDeps: {
        ...baseDeps.workerDeps!,
        async runAgent(
          opts: Parameters<NonNullable<typeof baseRunAgent>>[0],
        ): Promise<Awaited<ReturnType<NonNullable<typeof baseRunAgent>>>> {
          agentCalls += 1;
          inflight += 1;
          maxInflight = Math.max(maxInflight, inflight);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 25);
          });
          const result = await baseRunAgent(opts);
          inflight -= 1;
          return result;
        },
      },
    };

    const result = await executeBuild({
      projectRoot,
      ref,
      parallel: 2,
      deps,
    });

    assert.strictEqual(agentCalls, 2, 'expected two worker agent invocations');
    assert.strictEqual(
      maxInflight,
      2,
      'expected both workers in flight concurrently (same wave)',
    );
    assert.strictEqual(result.run.build?.issues.every((i) => i.status === 'completed'), true);
    assert.strictEqual(result.run.build?.goal_complete, true);
  });
});
