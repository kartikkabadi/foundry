import { RunStateError, formatRunSummary, pauseRun } from '@foundry/core/state/run-writer.js';

export function runPause(_args: string[]): void {
  const projectRoot = process.cwd();

  try {
    const paused = pauseRun(projectRoot);
    console.log('Run paused.');
    console.log(formatRunSummary(paused));
    process.exit(0);
  } catch (error) {
    if (error instanceof RunStateError) {
      console.error(`foundry pause: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
