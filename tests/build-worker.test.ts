import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeIssueWorker, mockAgentWriteFile } from '@foundry/planner/build/worker.js';
import { parseIssuePlanGraph } from '@foundry/planner/build/issue-plan-graph.js';
import { cleanupFoundryWorktrees } from '@foundry/adapters/worktree.js';
import { FIXTURE_ISSUE_PLAN, seedApprovedBuildRun } from './build-fixtures.js';

describe('serial build worker (V3-4)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-build-worker-'));
  });

  afterEach(() => {
    try {
      cleanupFoundryWorktrees(projectRoot);
    } catch {
      // ignore
    }
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('serial worker completes fixture issue #1', async () => {
    const ref = seedApprovedBuildRun(projectRoot);
    const nodes = parseIssuePlanGraph(FIXTURE_ISSUE_PLAN);
    const issue = nodes[0]!;

    const build = {
      issues: nodes.map((node) => ({
        number: node.number,
        title: node.title,
        type: node.type,
        status: 'pending' as const,
        blocked_by: node.blocked_by,
      })),
      deferred: [],
      goal_complete: false,
    };

    const result = await executeIssueWorker({
      projectRoot,
      runDir: ref.runDir,
      issue,
      build,
      deps: {
        runAgent: async (opts) => mockAgentWriteFile(opts),
        autoApproveReview: true,
      },
    });

    assert.strictEqual(result.issue.number, 1);
    assert.strictEqual(result.issue.status, 'completed');
    assert.ok(fs.existsSync(result.proofPath));

    const worktreeFile = path.join(
      projectRoot,
      '.worktrees',
      'foundry-build-1',
      'foundry-issue-1.txt',
    );
    assert.ok(fs.existsSync(worktreeFile));
  });
});
