/** Frozen run.json contract (H0). Do not change without spec review. */

import type { BuildState, ProofRecord } from './build.js';

export const RUN_JSON_SCHEMA_VERSION = 1 as const;

export type RunMode = 'plan' | 'build';
export type RunBudget = 'quick' | 'deep' | 'marathon';
export type RunStatus =
  | 'running'
  | 'paused'
  | 'awaiting_approval'
  | 'approved'
  | 'complete'
  | 'failed';
export type RunPhase =
  | 'init'
  | 'research'
  | 'interview'
  | 'algorithm_pass'
  | 'synthesis'
  | 'awaiting_approval'
  | 'build_preflight'
  | 'build_executing'
  | 'build_review'
  | 'build_complete';
export type ComposerSpeed = 'standard' | 'fast';

export interface AgentPassBudget {
  max_active: number;
  used: number;
  limit: number;
}

export interface MarathonRunMetadata {
  review_pause_at_passes: number[];
  checkpoint_interval_passes: number;
}

export interface RunJson {
  schema_version: typeof RUN_JSON_SCHEMA_VERSION;
  run_id: string;
  foundry_version: string;
  mode: RunMode;
  budget: RunBudget;
  status: RunStatus;
  phase: RunPhase;
  composer_speed: ComposerSpeed;
  created_at: string;
  updated_at: string;
  agent_pass_budget: AgentPassBudget;
  artifacts: string[];
  blocked_actions: string[];
  next_actions: string[];
  proofs?: ProofRecord[];
  build?: BuildState;
  marathon?: MarathonRunMetadata;
}
