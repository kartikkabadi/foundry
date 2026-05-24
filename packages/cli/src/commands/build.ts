import { findLatestRun, RunStateError } from '@foundry/core/state/run-writer.js';
import { loadAutonomyProfileFromRun } from '@foundry/planner/build/autonomy.js';
import { evaluateCreateRepoGate } from '@foundry/planner/build/create-repo-gate.js';
import {
  executeBuild,
  handleBuildError,
} from '@foundry/planner/build/orchestrate.js';

export interface ParsedBuildArgs {
  dryRun: boolean;
  deferIssue?: number;
  parallel: number;
  createRepo: boolean;
  approveCreateRepo: boolean;
}

export function parseBuildArgs(args: string[]): ParsedBuildArgs {
  let dryRun = false;
  let deferIssue: number | undefined;
  let parallel = 1;
  let createRepo = false;
  let approveCreateRepo = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--parallel') {
      const value = args[++i];
      parallel = Number.parseInt(value ?? '', 10);
      if (Number.isNaN(parallel) || parallel < 1 || parallel > 3) {
        console.error('foundry build: --parallel must be an integer from 1 to 3.');
        process.exit(2);
      }
      continue;
    }
    if (arg === '--create-repo') {
      createRepo = true;
      continue;
    }
    if (arg === '--approve-create-repo') {
      approveCreateRepo = true;
      continue;
    }
    if (arg === '--defer') {
      const value = args[++i];
      deferIssue = Number.parseInt(value ?? '', 10);
      if (Number.isNaN(deferIssue)) {
        console.error('foundry build: --defer requires an issue number.');
        process.exit(2);
      }
      continue;
    }
    console.error(`Unknown build option: ${arg}`);
    console.error('Usage: foundry build [--dry-run] [--defer <issue>] [--parallel N]');
    process.exit(2);
  }

  return { dryRun, deferIssue, parallel, createRepo, approveCreateRepo };
}

export function runBuild(args: string[]): void {
  const projectRoot = process.cwd();
  const parsed = parseBuildArgs(args);

  try {
    const latest = findLatestRun(projectRoot);
    if (!latest) {
      console.error('foundry build: no runs found. Run `foundry plan` first.');
      process.exit(1);
    }

    if (parsed.createRepo) {
      const profile = loadAutonomyProfileFromRun(latest.runDir);
      const gate = evaluateCreateRepoGate(profile, {
        explicitApproval: parsed.approveCreateRepo,
      });
      if (!gate.allowed) {
        console.error(`foundry build: ${gate.reason}`);
        process.exit(1);
      }
      console.log('create-repo: approved — would run gh repo create (not executed in v1 stub)');
    }

    if (latest.run.status !== 'approved' && latest.run.status !== 'running' && latest.run.status !== 'paused') {
      console.error(
        'foundry build: plan not approved. Complete `foundry plan` and run `foundry approve` first.',
      );
      process.exit(1);
    }

    executeBuild({
      projectRoot,
      ref: latest,
      dryRun: parsed.dryRun,
      deferIssueNumber: parsed.deferIssue,
      parallel: parsed.parallel,
    })
      .then((ref) => {
        if (parsed.dryRun) {
          process.exit(0);
        }
        if (ref.run.build?.goal_complete) {
          console.log('Build complete. Build goal satisfied.');
        } else if (ref.run.phase === 'build_review') {
          console.log('Build paused for orchestrator review.');
        } else {
          console.log('Build preflight passed and execution progressed.');
          if (ref.run.build) {
            console.log(ref.run.next_actions[0] ?? '');
          }
        }
        process.exit(0);
      })
      .catch(handleBuildError);
  } catch (error) {
    if (error instanceof RunStateError) {
      console.error(`foundry build: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
