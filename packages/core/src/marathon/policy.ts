import type { RunBudget } from '../types/run.js';

export interface MarathonCheckpointPolicy {
  checkpointIntervalPasses: number;
  loopWarnThreshold: number;
  loopPauseThreshold: number;
  reviewPauseEveryPasses: number;
}

export function marathonPolicyForBudget(budget: RunBudget): MarathonCheckpointPolicy | null {
  if (budget !== 'marathon') {
    return null;
  }

  return {
    checkpointIntervalPasses: 3,
    loopWarnThreshold: 2,
    loopPauseThreshold: 4,
    reviewPauseEveryPasses: 5,
  };
}

export function shouldMarathonReviewPause(usedPasses: number, policy: MarathonCheckpointPolicy): boolean {
  return usedPasses > 0 && usedPasses % policy.reviewPauseEveryPasses === 0;
}
