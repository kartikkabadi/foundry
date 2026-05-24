import { executePlan, handlePlanError, printPlanCompleteBanner } from '../plan/orchestrate.js';
import type { RunBudget } from '../types/run.js';

export function parsePlanArgs(args: string[]): { idea: string | null; budget: RunBudget } {
  let budget: RunBudget = 'deep';
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--budget') {
      const value = args[++i];
      if (!value || !['quick', 'deep', 'marathon'].includes(value)) {
        console.error('Usage: foundry plan "<idea>" [--budget quick|deep|marathon]');
        process.exit(1);
      }
      budget = value as RunBudget;
      continue;
    }
    positional.push(arg);
  }

  if (positional.length === 0) {
    return { idea: null, budget };
  }

  const joined = positional.join(' ').trim();
  if (!joined) {
    return { idea: null, budget };
  }

  let idea = joined;
  if ((joined.startsWith('"') && joined.endsWith('"')) || (joined.startsWith("'") && joined.endsWith("'"))) {
    idea = joined.slice(1, -1).trim();
  }

  return { idea, budget };
}

export function runPlan(args: string[]): void {
  const { idea, budget } = parsePlanArgs(args);
  if (!idea) {
    console.error('Usage: foundry plan "<rough software idea>" [--budget quick|deep|marathon]');
    console.error('Example: foundry plan "CLI that converts markdown PRDs to GitHub issues" --budget quick');
    process.exit(1);
  }

  executePlan({ idea, projectRoot: process.cwd(), budget })
    .then((ref) => {
      printPlanCompleteBanner(ref);
      process.exit(0);
    })
    .catch(handlePlanError);
}
