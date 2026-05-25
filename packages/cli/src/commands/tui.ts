import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRunJson } from '@foundry/core/schema/run-json.js';
import { findLatestRun, RunStateError } from '@foundry/core/state/run-writer.js';
import { renderRunPanels } from '../tui/render.js';

export function runTui(args: string[]): void {
  const projectRoot = process.cwd();
  const runId = args[0];

  try {
    let runDir: string;
    if (runId) {
      runDir = join(projectRoot, '.foundry', 'runs', runId);
    } else {
      const latest = findLatestRun(projectRoot);
      if (!latest) {
        throw new RunStateError('NO_RUNS', 'No runs found.');
      }
      runDir = latest.runDir;
    }

    const run = parseRunJson(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')));
    const statusMd = readFileSync(join(runDir, 'status.md'), 'utf8');
    console.log(renderRunPanels(run));
    console.log('\n--- status.md ---\n');
    console.log(statusMd.trim());
    process.exit(0);
  } catch (err) {
    if (err instanceof RunStateError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
