import { findLatestRun, RunStateError } from '@foundry/core/state/run-writer.js';

export function runBuild(_args: string[]): void {
  const projectRoot = process.cwd();

  try {
    const latest = findLatestRun(projectRoot);
    if (!latest) {
      console.error('foundry build: no runs found. Run `foundry plan` first.');
      process.exit(1);
    }

    if (latest.run.status !== 'approved') {
      console.error(
        'foundry build: plan not approved. Complete `foundry plan` and run `foundry approve` first.',
      );
      process.exit(1);
    }

    console.log('Build preflight passed (execution not yet implemented — V3).');
    process.exit(0);
  } catch (error) {
    if (error instanceof RunStateError) {
      console.error(`foundry build: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
