import type { RunBudget } from '../types/run.js';

export interface BudgetProfile {
  budget: RunBudget;
  max_active: number;
  agent_pass_limit: number;
  checkpoint_interval_passes: number;
}

export const BUDGET_PROFILES: Record<RunBudget, BudgetProfile> = {
  quick: {
    budget: 'quick',
    max_active: 5,
    agent_pass_limit: 12,
    checkpoint_interval_passes: 2,
  },
  deep: {
    budget: 'deep',
    max_active: 12,
    agent_pass_limit: 80,
    checkpoint_interval_passes: 5,
  },
  marathon: {
    budget: 'marathon',
    max_active: 24,
    agent_pass_limit: 120,
    checkpoint_interval_passes: 10,
  },
};

export const DEFAULT_BUDGET: RunBudget = 'deep';

export function resolveBudgetProfile(budget: RunBudget): BudgetProfile {
  return BUDGET_PROFILES[budget];
}

export function agentPassBudgetFromProfile(profile: BudgetProfile) {
  return {
    max_active: profile.max_active,
    used: 0,
    limit: profile.agent_pass_limit,
  };
}
