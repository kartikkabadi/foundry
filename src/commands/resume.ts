import { RunStateError, formatRunSummary, resumeRun } from '../state/run-writer.js';

export function runResume(args: string[]): void {
  const projectRoot = process.cwd();
  const runId = args[0];

  try {
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
