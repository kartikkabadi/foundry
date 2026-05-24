import {
  formatRunSummary,
  resumeRun,
  findLatestPausedRun,
  RunStateError,
} from '../state/run-writer.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  handlePlanError,
  printPlanCompleteBanner,
  resumePlanFromCheckpoint,
} from '../plan/orchestrate.js';

export function runResume(args: string[]): void {
  const projectRoot = process.cwd();
  const runId = args[0];

  try {
    const paused = findLatestPausedRun(projectRoot, runId);
    if (!paused) {
      if (runId) {
        throw new RunStateError('NOT_FOUND', `No paused run found with id: ${runId}`);
      }
      throw new RunStateError('NO_PAUSED_RUN', 'No paused run found in this repo.');
    }

    if (
      paused.run.mode === 'plan' &&
      (paused.run.phase !== 'init' ||
        paused.run.artifacts.length > 0 ||
        existsSync(join(paused.runDir, 'intake.md')))
    ) {
      resumePlanFromCheckpoint({ projectRoot, ref: paused })
        .then((ref) => {
          if (ref.run.status === 'awaiting_approval') {
            printPlanCompleteBanner(ref);
          } else {
            console.log('Run resumed.');
            console.log(formatRunSummary(ref));
          }
          process.exit(0);
        })
        .catch(handlePlanError);
      return;
    }

    const resumed = resumeRun(projectRoot, runId);
    console.log('Run resumed.');
    console.log(formatRunSummary(resumed));
    process.exit(0);
  } catch (error) {
    if (error instanceof RunStateError) {
      console.error(`foundry resume: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
