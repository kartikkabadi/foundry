import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEvents } from '@foundry/core/comms/events.js';
import {
  evaluateAutonomyAction,
  parseAutonomyProfile,
} from '@foundry/planner/build/autonomy.js';
import { parseIssuePlanGraph } from '@foundry/planner/build/issue-plan-graph.js';
import { BuildWorkerError, executeIssueWorker } from '@foundry/planner/build/worker.js';
import { cleanupFoundryWorktrees } from '@foundry/adapters/worktree.js';
import {
  FIXTURE_AUTONOMY_PRODUCTIVE,
  FIXTURE_AUTONOMY_SAFE,
  FIXTURE_ISSUE_PLAN_SINGLE,
  seedApprovedBuildRun,
} from './build-fixtures.js';

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

  describe('autonomy audit events', () => {
    let projectRoot: string;

    beforeEach(() => {
      projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-build-autonomy-audit-'));
    });

    afterEach(() => {
      try {
        cleanupFoundryWorktrees(projectRoot);
      } catch {
        // ignore
      }
      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('autonomy denial writes blocker_reported to events.jsonl', async () => {
      const ref = seedApprovedBuildRun(
        projectRoot,
        '0.1.0',
        FIXTURE_ISSUE_PLAN_SINGLE,
        FIXTURE_AUTONOMY_SAFE,
      );
      const issue = parseIssuePlanGraph(FIXTURE_ISSUE_PLAN_SINGLE)[0]!;
      const build = {
        issues: [
          {
            number: issue.number,
            title: issue.title,
            type: issue.type,
            status: 'pending' as const,
            blocked_by: issue.blocked_by,
          },
        ],
        deferred: [],
        goal_complete: false,
      };

      await assert.rejects(
        () =>
          executeIssueWorker({
            projectRoot,
            runDir: ref.runDir,
            issue,
            build,
            deps: {
              runAgent: async () => {
                throw new Error('agent should not run when install denied');
              },
            },
          }),
        (err: unknown) => err instanceof BuildWorkerError,
      );

      const events = readEvents(ref.runDir);
      const blockers = events.filter((e) => e.type === 'blocker_reported');
      assert.ok(blockers.length >= 1, 'expected blocker_reported in events.jsonl');
      assert.match(blockers[0]!.summary, /npm_install/i);
      assert.strictEqual(blockers[0]!.phase, 'build_executing');
    });
  });
});
