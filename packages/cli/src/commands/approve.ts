import { approveRun, formatRunSummary, RunStateError } from '@foundry/core/state/run-writer.js';

export function runApprove(args: string[]): void {
  const projectRoot = process.cwd();
  const runId = args[0];

  try {
    const approved = approveRun(projectRoot, runId);
    console.log('Plan approved.');
    console.log(formatRunSummary(approved));
    process.exit(0);
  } catch (error) {
    if (error instanceof RunStateError) {
      console.error(`foundry approve: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
