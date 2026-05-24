import { existsSync } from 'node:fs';
import { findLatestRunIssuePlan, publishIssuePlan } from '@foundry/planner/publish/orchestrate.js';
import { summarizePublishResult } from '@foundry/planner/publish/issue-plan.js';
import { GateError } from '@foundry/core/gates.js';
import { readRunJson } from '@foundry/core/state/run-writer.js';
import { safeErrorMessage } from '@foundry/core/config/secrets.js';

export function parsePublishArgs(args: string[]): {
  approve: boolean;
  force: boolean;
  runDir?: string;
} {
  let approve = false;
  let force = false;
  let runDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--approve') {
      approve = true;
      continue;
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--run-dir') {
      runDir = args[++i];
      continue;
    }
    console.error(`Unknown publish option: ${arg}`);
    process.exit(2);
  }

  return { approve, force, runDir };
}

export function runPublish(args: string[]): void {
  executePublish(args).catch((err) => {
    const message =
      err instanceof GateError ? err.message : safeErrorMessage(err);
    console.error(`foundry publish: ${message}`);
    process.exit(1);
  });
}

async function executePublish(args: string[]): Promise<void> {
  const { approve, force, runDir: explicitRunDir } = parsePublishArgs(args);
  const projectRoot = process.cwd();

  if (force) {
    console.warn(
      'Warning: --force bypasses plan approval gate. Prefer `foundry approve` before publishing.',
    );
  }

  let runDir = explicitRunDir;
  let issuePlanPath: string | undefined;

  if (runDir) {
    issuePlanPath = `${runDir}/issue-plan.md`;
  } else {
    const latest = findLatestRunIssuePlan(projectRoot);
    if (!latest) {
      console.error('No issue-plan.md found. Run `foundry plan` first or pass --run-dir.');
      process.exit(1);
    }
    runDir = latest.runDir;
    issuePlanPath = latest.path;
  }

  if (!issuePlanPath) {
    console.error('issue-plan.md path could not be resolved.');
    process.exit(1);
  }

  console.log(`Publishing from ${issuePlanPath}`);
  if (!approve) {
    console.log('Local markdown drafts only (pass --approve to gate GitHub issue creation).');
  }

  const runJsonPath = `${runDir}/run.json`;
  if (!runDir || !existsSync(runJsonPath)) {
    console.error(`foundry publish: run.json not found in ${runDir}`);
    process.exit(1);
  }
  const run = readRunJson(runJsonPath);

  const result = await publishIssuePlan({
    issuePlanPath,
    runDir: runDir!,
    approve,
    run,
    force,
  });

  console.log('\n' + summarizePublishResult(result));
  if (result.created.length > 0) {
    console.log('\nCreated issues:');
    for (const issue of result.created) {
      console.log(`  ${issue.title}: ${issue.url}`);
    }
  }
}
