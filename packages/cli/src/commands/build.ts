import { assertApproved, GateError } from '@foundry/core/gates.js';
import { findLatestRun, RunStateError } from '@foundry/core/state/run-writer.js';
import {
  executeBuild,
  handleBuildError,
} from '@foundry/planner/build/orchestrate.js';

export interface ParsedBuildArgs {
  dryRun: boolean;
  deferIssue?: number;
  parallel: number;
}

export function parseBuildArgs(args: string[]): ParsedBuildArgs {
  let dryRun = false;
  let deferIssue: number | undefined;
  let parallel = 1;

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

  return { dryRun, deferIssue, parallel };
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

    try {
      assertApproved(latest.run);
    } catch (error) {
      const message = error instanceof GateError ? error.message : String(error);
      console.error(`foundry build: ${message}`);
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
