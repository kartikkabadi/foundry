import {
  RunStateError,
  assertProjectInitialized,
  findLatestRun,
  formatRunSummary,
} from '@foundry/core/state/run-writer.js';

export function runStatus(_args: string[]): void {
  const projectRoot = process.cwd();

  try {
    assertProjectInitialized(projectRoot);
    const latest = findLatestRun(projectRoot);

    if (!latest) {
      console.log('No runs yet. Start one with `foundry plan`.');
      process.exit(0);
    }

    console.log(formatRunSummary(latest));
    process.exit(0);
  } catch (error) {
    if (error instanceof RunStateError) {
      console.error(`foundry status: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
