import { executePlan, handlePlanError, printPlanCompleteBanner } from '@foundry/planner/plan/orchestrate.js';
import type { RunBudget } from '@foundry/core/types/run.js';

export interface ParsedPlanArgs {
  idea: string | null;
  budget: RunBudget;
  referenceUrl?: string;
  swarmResearch: boolean;
}

export function parsePlanArgs(args: string[]): ParsedPlanArgs {
  let budget: RunBudget = 'deep';
  let referenceUrl: string | undefined;
  let swarmResearch = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--budget') {
      const value = args[++i];
      if (!value || !['quick', 'deep', 'marathon'].includes(value)) {
        console.error(
          'Usage: foundry plan "<idea>" [--budget quick|deep|marathon] [--reference URL] [--swarm research]',
        );
        process.exit(1);
      }
      budget = value as RunBudget;
      continue;
    }
    if (arg === '--reference') {
      referenceUrl = args[++i];
      if (!referenceUrl) {
        console.error('Usage: foundry plan --reference <url> "<idea>"');
        process.exit(1);
      }
      continue;
    }
    if (arg === '--swarm') {
      const mode = args[++i];
      if (mode !== 'research') {
        console.error('Usage: foundry plan "<idea>" --swarm research');
        process.exit(1);
      }
      swarmResearch = true;
      continue;
    }
    positional.push(arg);
  }

  if (positional.length === 0) {
    return { idea: null, budget, referenceUrl, swarmResearch };
  }

  const joined = positional.join(' ').trim();
  if (!joined) {
    return { idea: null, budget, referenceUrl, swarmResearch };
  }

  let idea = joined;
  if ((joined.startsWith('"') && joined.endsWith('"')) || (joined.startsWith("'") && joined.endsWith("'"))) {
    idea = joined.slice(1, -1).trim();
  }

  return { idea, budget, referenceUrl, swarmResearch };
}

export function runPlan(args: string[]): void {
  const { idea, budget, referenceUrl, swarmResearch } = parsePlanArgs(args);
  if (!idea) {
    console.error(
      'Usage: foundry plan "<rough software idea>" [--budget quick|deep|marathon] [--reference URL] [--swarm research]',
    );
    console.error('Example: foundry plan "CLI tool" --reference https://example.com --swarm research');
    process.exit(1);
  }

  executePlan({ idea, projectRoot: process.cwd(), budget, referenceUrl, swarmResearch })
    .then((ref) => {
      printPlanCompleteBanner(ref);
      process.exit(0);
    })
    .catch(handlePlanError);
}
