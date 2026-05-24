import { findLatestRunIssuePlan, publishIssuePlan } from '@foundry/planner/publish/orchestrate.js';
import { summarizePublishResult } from '@foundry/planner/publish/issue-plan.js';
import { safeErrorMessage } from '@foundry/core/config/secrets.js';

export function parsePublishArgs(args: string[]): { approve: boolean; runDir?: string } {
  let approve = false;
  let runDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--approve') {
      approve = true;
      continue;
    }
    if (arg === '--run-dir') {
      runDir = args[++i];
      continue;
    }
    console.error(`Unknown publish option: ${arg}`);
    process.exit(2);
  }

  return { approve, runDir };
}

export function runPublish(args: string[]): void {
  executePublish(args).catch((err) => {
    console.error(`foundry publish: ${safeErrorMessage(err)}`);
    process.exit(1);
  });
}

async function executePublish(args: string[]): Promise<void> {
  const { approve, runDir: explicitRunDir } = parsePublishArgs(args);
  const projectRoot = process.cwd();

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

  const result = await publishIssuePlan({
    issuePlanPath,
    runDir: runDir!,
    approve,
  });

  console.log('\n' + summarizePublishResult(result));
  if (result.created.length > 0) {
    console.log('\nCreated issues:');
    for (const issue of result.created) {
      console.log(`  ${issue.title}: ${issue.url}`);
    }
  }
}
