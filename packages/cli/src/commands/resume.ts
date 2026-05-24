import {
  formatRunSummary,
  resumeRun,
  findLatestPausedRun,
  RunStateError,
} from '@foundry/core/state/run-writer.js';
import { resolveResumeTarget } from '@foundry/core/resume-target.js';
import {
  handlePlanError,
  printPlanCompleteBanner,
  resumePlanFromCheckpoint,
} from '@foundry/planner/plan/orchestrate.js';
import { resumeBuildFromCheckpoint, handleBuildError } from '@foundry/planner/build/orchestrate.js';

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

    if (resolveResumeTarget(paused.run, paused.runDir) === 'plan') {
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

    if (resolveResumeTarget(paused.run, paused.runDir) === 'build') {
      resumeBuildFromCheckpoint({ projectRoot, ref: paused })
        .then((ref) => {
          console.log('Build resumed.');
          console.log(formatRunSummary(ref));
          process.exit(0);
        })
        .catch(handleBuildError);
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
