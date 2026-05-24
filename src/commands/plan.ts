import { executePlan, handlePlanError, printPlanCompleteBanner } from '../plan/orchestrate.js';

export function parsePlanArgs(args: string[]): string | null {
  if (args.length === 0) {
    return null;
  }

  const joined = args.join(' ').trim();
  if (!joined) {
    return null;
  }

  if ((joined.startsWith('"') && joined.endsWith('"')) || (joined.startsWith("'") && joined.endsWith("'"))) {
    return joined.slice(1, -1).trim();
  }

  return joined;
}

export function runPlan(args: string[]): void {
  const idea = parsePlanArgs(args);
  if (!idea) {
    console.error('Usage: foundry plan "<rough software idea>"');
    console.error('Example: foundry plan "CLI that converts markdown PRDs to GitHub issues"');
    process.exit(1);
  }

  executePlan({ idea, projectRoot: process.cwd() })
    .then((ref) => {
      printPlanCompleteBanner(ref);
      process.exit(0);
    })
    .catch(handlePlanError);
}
